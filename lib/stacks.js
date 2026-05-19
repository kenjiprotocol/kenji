const fs = require('fs-extra');
const path = require('path');
const {
  globalStacksDir,
  globalSkillsDir,
  projectSkillsDir,
  ensureGlobal,
  ensureProject,
  findSkillsByName
} = require('./paths');

const { installFromGitHub, installFromGitHubTreeUrl, installFromRawUrl } = require('./installer');
const { fetchRepoContents, fetchRawFile, isGitHubTreeUrl, isGitHubBlobUrl, blobToRawUrl } = require('./github');
const { resolveRegistryItem } = require('./registry');

const axios = require('axios');

/* ------------------------------
   DEBUG LOGGING
------------------------------- */

function debugLog(...args) {
  if (process.env.KENJI_DEBUG) console.error('[kenji:debug]', ...args);
}

/* ------------------------------
   NAME SANITIZATION
------------------------------- */

// Only allow simple alphanumeric names — blocks path traversal like ../../etc
function sanitizeName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return null;
  }
  return name;
}

/* ------------------------------
   RESOLVE STACK (shared helper)
------------------------------- */

/**
 * Finds, reads, and returns { stackPath, stack } for a named stack.
 * - Normalises case (frontend / Frontend / FRONTEND all resolve)
 * - Appends .json automatically
 * - Searches only in globalStacksDir (~/.kenji/stacks)
 * - Prints an actionable error (checked path + available stacks) on miss
 * Returns null if not found or unreadable.
 */
async function resolveStack(name) {
  const normalised = (name || '').toLowerCase().trim();
  const targetFile = normalised + '.json';
  const checkedPath = path.join(globalStacksDir, targetFile);

  debugLog('resolveStack', { name, normalised, targetFile, globalStacksDir });

  let entries = [];
  try {
    entries = await fs.readdir(globalStacksDir);
  } catch {
    // dir doesn't exist yet
  }

  debugLog('entries in stacks dir:', entries);

  const match = entries.find(e => e.toLowerCase() === targetFile);
  const stackPath = match ? path.join(globalStacksDir, match) : null;

  debugLog('match:', match, '→ stackPath:', stackPath);

  if (!stackPath) {
    const available = entries
      .filter(e => e.endsWith('.json'))
      .map(e => `  - ${e.replace('.json', '')}`)
      .join('\n');
    console.log(`\nStack "${normalised}" was not found.`);
    console.log(`\nChecked:\n  ${checkedPath}`);
    if (available) {
      console.log(`\nAvailable stacks:\n${available}`);
    } else {
      console.log('\nNo stacks exist yet. Run: kenji stack create <name>');
    }
    console.log('');
    return null;
  }

  try {
    const stack = await fs.readJson(stackPath);
    return { stackPath, stack };
  } catch (err) {
    console.log(`\nFailed to read stack file: ${err.message}`);
    return null;
  }
}

/* ------------------------------
   CREATE STACK (GLOBAL)
------------------------------- */

async function createStack(name) {
  const safeName = sanitizeName(name);
  if (!safeName) {
    console.log('Invalid stack name. Use only letters, numbers, hyphens, and underscores.');
    return;
  }

  await fs.ensureDir(globalStacksDir);

  const stackPath = path.join(globalStacksDir, `${safeName}.json`);

  if (await fs.pathExists(stackPath)) {
    console.log('Stack already exists.');
    return;
  }

  await fs.writeJson(stackPath, {
    type: 'kenji-stack',
    version: '1.0',
    name: safeName,
    description: '',
    created_at: new Date().toISOString(),
    skills: []
  }, { spaces: 2 });

  console.log(`✓ Stack "${safeName}" created.`);
}

/* ------------------------------
   ADD TO STACK
------------------------------- */

async function addToStack(name, skill) {

  // Guard: both args required
  if (!name || !skill) {
    console.log('\nMissing arguments.\n');
    console.log('Usage:');
    console.log('  kenji stack add <stack-name> <skill>\n');
    console.log('Example:');
    console.log('  kenji stack add my-stack kenji/react-debug\n');
    return;
  }

  const safeName = sanitizeName(name);
  if (!safeName) {
    console.log('Invalid stack name. Use only letters, numbers, hyphens, and underscores.');
    return;
  }

  const resolved = await resolveStack(name);
  if (!resolved) return;
  const { stackPath, stack } = resolved;


  // --- Resolution order ---
  // 1. Local installed skill (promote to global if needed)
  const localMatches = await findSkillsByName(projectSkillsDir, skill);
  if (localMatches.length > 1) {
    console.log(`\nMultiple installed skills match "${skill}":\n`);
    localMatches.forEach(m => console.log(`  - ${m.repoSlug}/${m.skillSlug}`));
    console.log(`\nSpecify the full path, e.g.: kenji stack add ${name} ${localMatches[0].repoSlug}/${localMatches[0].skillSlug}\n`);
    return;
  }
  if (localMatches.length === 1) {
    const localMatch = localMatches[0];
    const globalDest = path.join(globalSkillsDir, localMatch.repoSlug, localMatch.skillSlug);
    if (!(await fs.pathExists(globalDest))) {
      await ensureGlobal();
      await fs.ensureDir(path.dirname(globalDest));
      await fs.copy(localMatch.fullPath, globalDest, { overwrite: false });
    }
    const entry = { type: 'global', value: localMatch.skillSlug };
    if (!hasDuplicate(stack.skills, entry)) {
      stack.skills.push(entry);
      await fs.writeJson(stackPath, stack, { spaces: 2 });
      console.log(`✓ Local skill '${localMatch.skillSlug}' promoted to global and added to stack.`);
    } else {
      console.log('Skill already exists in stack.');
    }
    return;
  }

  // 2. Global installed skill
  const globalMatches = await findSkillsByName(globalSkillsDir, skill);
  if (globalMatches.length > 1) {
    console.log(`\nMultiple installed skills match "${skill}":\n`);
    globalMatches.forEach(m => console.log(`  - ${m.repoSlug}/${m.skillSlug}`));
    console.log(`\nSpecify the full path, e.g.: kenji stack add ${name} ${globalMatches[0].repoSlug}/${globalMatches[0].skillSlug}\n`);
    return;
  }
  if (globalMatches.length === 1) {
    const globalMatch = globalMatches[0];
    const entry = { type: 'global', value: globalMatch.skillSlug };
    if (!hasDuplicate(stack.skills, entry)) {
      stack.skills.push(entry);
      await fs.writeJson(stackPath, stack, { spaces: 2 });
      console.log(`✓ Added global skill '${globalMatch.skillSlug}' to stack.`);
    } else {
      console.log('Skill already exists in stack.');
    }
    return;
  }

  // 3. Registry reference (namespace/name)
  const registryItem = await resolveRegistryItem(skill);
  if (registryItem && registryItem.type === 'skill') {
    const entry = { type: 'registry', value: skill };
    if (!hasDuplicate(stack.skills, entry)) {
      stack.skills.push(entry);
      await fs.writeJson(stackPath, stack, { spaces: 2 });
      console.log(`✓ Added registry skill '${skill}' to stack.`);
    } else {
      console.log('Skill already exists in stack.');
    }
    return;
  }

  // 4. GitHub user/repo
  if (!skill.startsWith('http') && skill.includes('/')) {
    const entry = { type: 'github', value: skill };
    if (!hasDuplicate(stack.skills, entry)) {
      stack.skills.push(entry);
      await fs.writeJson(stackPath, stack, { spaces: 2 });
      console.log(`✓ Added GitHub repo '${skill}' to stack.`);
    } else {
      console.log('Skill already exists in stack.');
    }
    return;
  }

  // 5. GitHub URLs (blob, tree, raw)
  if (skill.startsWith('http')) {
    let normalized = skill;
    if (isGitHubBlobUrl(skill)) normalized = blobToRawUrl(skill);

    const entry = { type: 'url', value: normalized };
    if (!hasDuplicate(stack.skills, entry)) {
      stack.skills.push(entry);
      await fs.writeJson(stackPath, stack, { spaces: 2 });
      console.log(`✓ Added URL '${normalized}' to stack.`);
    } else {
      console.log('Skill already exists in stack.');
    }
    return;
  }

  // Nothing matched
  console.log(`\nCould not resolve '${skill}'.\n`);
  console.log('Accepted formats:');
  console.log('  installed skill name (local or global)');
  console.log('  namespace/skill-name  (registry)');
  console.log('  user/repo            (GitHub)');
  console.log('  https://github.com/user/repo/tree/...');
  console.log('  https://github.com/user/repo/blob/...');
  console.log('  https://raw.githubusercontent.com/...\n');
}

/* Duplicate check — case-insensitive value comparison, same type */
function hasDuplicate(skills, entry) {
  return skills.some(s =>
    typeof s === 'object' &&
    s.type === entry.type &&
    s.value.toLowerCase() === entry.value.toLowerCase()
  );
}

/* ------------------------------
   INSTALL STACK (PROJECT LEVEL)
------------------------------- */

async function installStack(name) {

  const resolved = await resolveStack(name);
  if (!resolved) return;
  const { stack } = resolved;

  if (!stack.skills || !stack.skills.length) {
    console.log(`Stack '${stack.name}' has no skills.`);
    return;
  }

  console.log(`\nInstalling stack '${stack.name}' (${stack.skills.length} skill${stack.skills.length > 1 ? 's' : ''})...\n`);

  await ensureProject();

  let success = 0;
  let failed = 0;

  for (const entry of stack.skills) {

    // Strict: only structured { type, value } entries are supported
    if (typeof entry !== 'object' || !entry.type || !entry.value) {
      console.log(`  Skipped invalid entry — must be { type, value } object.`);
      failed++;
      continue;
    }

    const { type, value } = entry;

    try {
      if (type === 'global') {
        const globalMatches = await findSkillsByName(globalSkillsDir, value);
        if (!globalMatches.length) {
          console.log(`  Skipped '${value}' — global skill not found.`);
          failed++;
          continue;
        }
        // Prefer exact match, fall back to first
        const globalMatch = globalMatches[0];
        const dest = path.join(projectSkillsDir, globalMatch.repoSlug, globalMatch.skillSlug);
        await fs.ensureDir(path.dirname(dest));
        await fs.copy(globalMatch.fullPath, dest, { overwrite: false });
        console.log(`  ✓ Copied global skill '${globalMatch.skillSlug}'`);
        success++;

      } else if (type === 'registry') {
        const item = await resolveRegistryItem(value);
        if (!item || item.type !== 'skill') {
          console.log(`  Failed to install '${value}' — not found in registry.`);
          failed++;
          continue;
        }
        console.log(`  Resolved '${value}' → ${item.repo}`);
        await installFromGitHub(item.repo, false, false, item.entry);
        success++;

      } else if (type === 'github') {
        await installFromGitHub(value, false, false);
        success++;

      } else if (type === 'url') {
        if (isGitHubTreeUrl(value)) {
          await installFromGitHubTreeUrl(value, false, false);
        } else {
          await installFromRawUrl(value, false, false);
        }
        success++;

      } else {
        console.log(`  Skipped '${value}' — unknown entry type '${type}'.`);
        failed++;
      }

    } catch (err) {
      console.log(`  Failed to install '${value}' — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nStack installed: ${success} succeeded, ${failed} failed.\n`);
}



/* ------------------------------
   REMOVE SKILL FROM STACK
------------------------------- */

async function removeFromStack(name, skill) {
  const resolved = await resolveStack(name);
  if (!resolved) return;
  const { stackPath, stack } = resolved;
  const skillLower = skill.toLowerCase();

  const before = stack.skills.length;
  stack.skills = stack.skills.filter(s => {
    const val = typeof s === 'object' ? s.value : s;
    return val.toLowerCase() !== skillLower;
  });

  if (stack.skills.length === before) {
    console.log(`Skill '${skill}' not found in stack.`);
    return;
  }

  await fs.writeJson(stackPath, stack, { spaces: 2 });
  console.log(`✓ Removed '${skill}' from stack '${stack.name}'`);
}

/* ------------------------------
   DELETE STACK
------------------------------- */

async function deleteStack(name) {
  const resolved = await resolveStack(name);
  if (!resolved) return;
  const { stackPath, stack } = resolved;
  await fs.remove(stackPath);
  console.log(`✓ Stack "${stack.name}" deleted.`);
}

/* ------------------------------
   EXPORT STACK
------------------------------- */

async function exportStack(name, outputPath = null) {
  const resolved = await resolveStack(name);
  if (!resolved) return;
  const { stack } = resolved;

  const exportData = {
    type: 'kenji-stack',
    version: '1.0',
    name: stack.name,
    description: stack.description || '',
    skills: stack.skills
  };

  const fileName = outputPath || `${name}.kenji.json`;
  await fs.writeJson(fileName, exportData, { spaces: 2 });
  console.log(`✓ Stack exported to ${fileName}`);
}

/* ------------------------------
   VALIDATION (IMPORT)
------------------------------- */

function validateStackSchema(data) {
  if (data.type !== 'kenji-stack') return false;
  if (!data.version) return false;
  if (typeof data.name !== 'string') return false;
  if (!Array.isArray(data.skills)) return false;

  for (const skill of data.skills) {
    // Strict: only structured objects accepted
    if (typeof skill !== 'object' || !skill.type || !skill.value) return false;
    const validTypes = ['global', 'registry', 'github', 'url'];
    if (!validTypes.includes(skill.type)) return false;
  }

  return true;
}

/* ------------------------------
   IMPORT STACK
------------------------------- */

async function importStack(source) {
  let data;

  const {
    getHeaders,
    isGitHubBlobUrl,
    blobToRawUrl,
    isGitHubTreeUrl,
    parseGitHubTreeUrl
  } = require('./github');

  try {

    // 1. GitHub blob URL → convert to raw, fetch JSON directly
    if (isGitHubBlobUrl(source)) {
      const rawUrl = blobToRawUrl(source);
      console.log(`Fetching stack from blob URL...`);
      const res = await axios.get(rawUrl, { headers: getHeaders(rawUrl) });
      data = res.data;

      // 2. GitHub tree URL → scan folder for stack file via API
    } else if (isGitHubTreeUrl(source)) {
      const parsed = parseGitHubTreeUrl(source);
      if (!parsed) {
        console.log('Could not parse GitHub tree URL.');
        return;
      }
      const apiUrl = parsed.subpath
        ? `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.subpath}?ref=${parsed.branch}`
        : `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents?ref=${parsed.branch}`;
      console.log(`Scanning ${parsed.owner}/${parsed.repo} for stack file...`);
      const listing = await axios.get(apiUrl, { headers: getHeaders(apiUrl) });
      const stackFile = listing.data.find(f =>
        f.type === 'file' && (
          f.name === 'stack.kenji.json' ||
          f.name === 'kenji-stack.json' ||
          f.name.endsWith('.kenji.json')
        )
      );
      if (!stackFile) {
        console.log('No Kenji stack file (.kenji.json) found at that path.');
        return;
      }
      const raw = await axios.get(stackFile.download_url, { headers: getHeaders(stackFile.download_url) });
      data = raw.data;

      // 3. Other HTTP (raw.githubusercontent.com, direct JSON link)
    } else if (source.startsWith('http')) {
      console.log(`Fetching stack from URL...`);
      const res = await axios.get(source, { headers: getHeaders(source) });
      data = res.data;

      // 4. slash-ref: try registry first, then treat as GitHub user/repo
    } else if (source.includes('/')) {
      const registryItem = await resolveRegistryItem(source);

      if (registryItem && registryItem.type === 'stack') {
        // Registry stack → synthesise canonical data from registry object
        console.log(`Importing stack '${registryItem.name}' from registry...`);
        data = {
          type: 'kenji-stack',
          version: '1.0',
          name: registryItem.name,
          description: registryItem.description || '',
          skills: registryItem.skills || []
        };

      } else {
        // GitHub user/repo → look for stack JSON in repo root
        const [owner, repo] = source.split('/');
        console.log(`Fetching stack from ${source}...`);
        const files = await fetchRepoContents(owner, repo);
        const stackFile = files.find(file =>
          file.type === 'file' && (
            file.name === 'stack.kenji.json' ||
            file.name === 'kenji-stack.json' ||
            file.name === 'kenji.json'
          )
        );
        if (!stackFile) {
          console.log('No Kenji stack file found in repo.');
          return;
        }
        data = await fetchRawFile(stackFile.download_url);
      }

      // 5. Local file path
    } else {
      data = await fs.readJson(source);
    }

  } catch (err) {
    console.log(`Failed to fetch stack: ${err.message}`);
    return;
  }

  if (!validateStackSchema(data)) {
    console.log('Invalid Kenji stack format.');
    console.log('Expected: { type: "kenji-stack", version, name, skills: [{ type, value }] }');
    return;
  }

  const safeName = sanitizeName(data.name);
  if (!safeName) {
    console.log('Invalid stack name in imported file. Use only letters, numbers, hyphens, and underscores.');
    return;
  }

  await fs.ensureDir(globalStacksDir);
  const stackPath = path.join(globalStacksDir, `${safeName}.json`);

  await fs.writeJson(stackPath, {
    type: 'kenji-stack',
    version: '1.0',
    name: safeName,
    description: data.description || '',
    created_at: new Date().toISOString(),
    skills: data.skills
  }, { spaces: 2 });

  console.log(`\n✓ Stack "${safeName}" imported (${data.skills.length} skill${data.skills.length !== 1 ? 's' : ''}).\n`);
}

/* ------------------------------
   SHOW STACK
------------------------------- */

async function showStack(name) {
  if (!name) {
    console.log('Usage: kenji stack show <name>');
    return;
  }
  const resolved = await resolveStack(name);
  if (!resolved) return;
  const { stack } = resolved;
  console.log(`\nStack: ${stack.name}`);
  if (stack.description) console.log(`Description: ${stack.description}`);
  console.log(`\nSkills (${stack.skills.length}):\n`);
  if (!stack.skills.length) {
    console.log('  (empty)');
  } else {
    stack.skills.forEach((s, i) => {
      if (typeof s === 'object') {
        console.log(`  ${i + 1}. [${s.type}] ${s.value}`);
      } else {
        console.log(`  ${i + 1}. ${s}`);
      }
    });
  }
  console.log('');
}

/* ------------------------------
   LIST STACKS
------------------------------- */

async function listStacks() {
  let entries = [];
  try { entries = await fs.readdir(globalStacksDir); } catch { }
  const stacks = entries.filter(f => f.endsWith('.json'));
  if (!stacks.length) {
    console.log('\nNo stacks created.\n');
    return;
  }
  console.log('\nStacks:\n');
  stacks.forEach(f => console.log(`  - ${f.replace('.json', '')}`));
  console.log('');
}

module.exports = {
  createStack,
  addToStack,
  installStack,
  deleteStack,
  exportStack,
  importStack,
  removeFromStack,
  showStack,
  listStacks,
  resolveStack,
};
