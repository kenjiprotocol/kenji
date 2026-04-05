const fs = require('fs-extra');
const path = require('path');
const {
  globalStacksDir,
  globalSkillsDir,
  projectSkillsDir,
  ensureGlobal,
  ensureProject,
  findSkillDir
} = require('./paths');

const { installFromGitHub, installFromGitHubTreeUrl, installFromRawUrl } = require('./installer');
const { fetchRepoContents, fetchRawFile, isGitHubTreeUrl, isGitHubBlobUrl, blobToRawUrl } = require('./github');
const { resolveRegistryItem } = require('./registry');

const axios = require('axios');

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
   STACK FILE LOOKUP (CASE-INSENSITIVE)
------------------------------- */

// Finds a stack JSON file case-insensitively, returns the real full path or null
async function findStackFile(name) {
  const target = name.toLowerCase() + '.json';
  try {
    const entries = await fs.readdir(globalStacksDir);
    const match = entries.find(e => e.toLowerCase() === target);
    return match ? path.join(globalStacksDir, match) : null;
  } catch {
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

  const stackPath = await findStackFile(name);
  if (!stackPath) {
    console.log(`\nStack '${name}' does not exist.\n`);
    console.log('Run:');
    console.log(`  kenji stack create ${name}\n`);
    return;
  }

  const stack = await fs.readJson(stackPath);

  // --- Resolution order ---
  // 1. Local installed skill
  const localMatch = await findSkillDir(projectSkillsDir, skill);
  if (localMatch) {
    const realName = path.basename(localMatch);
    const globalDest = path.join(globalSkillsDir, realName);

    // Promote to global if not already there
    if (!(await fs.pathExists(globalDest))) {
      await ensureGlobal();
      await fs.copy(localMatch, globalDest, { overwrite: false });
    }

    const entry = { type: 'global', value: realName };
    if (!hasDuplicate(stack.skills, entry)) {
      stack.skills.push(entry);
      await fs.writeJson(stackPath, stack, { spaces: 2 });
      console.log(`✓ Local skill '${realName}' promoted to global and added to stack.`);
    } else {
      console.log('Skill already exists in stack.');
    }
    return;
  }

  // 2. Global installed skill
  const globalMatch = await findSkillDir(globalSkillsDir, skill);
  if (globalMatch) {
    const realName = path.basename(globalMatch);
    const entry = { type: 'global', value: realName };
    if (!hasDuplicate(stack.skills, entry)) {
      stack.skills.push(entry);
      await fs.writeJson(stackPath, stack, { spaces: 2 });
      console.log(`✓ Added global skill '${realName}' to stack.`);
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

  const stackPath = await findStackFile(name);
  if (!stackPath) {
    console.log(`\nStack '${name}' does not exist.\n`);
    console.log('Run:');
    console.log(`  kenji stack create ${name}\n`);
    return;
  }

  const stack = await fs.readJson(stackPath);

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
        const globalPath = await findSkillDir(globalSkillsDir, value);
        if (!globalPath) {
          console.log(`  Skipped '${value}' — global skill not found.`);
          failed++;
          continue;
        }
        const dest = path.join(projectSkillsDir, path.basename(globalPath));
        await fs.copy(globalPath, dest, { overwrite: false });
        console.log(`  ✓ Copied global skill '${path.basename(globalPath)}'`);
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
  const stackPath = await findStackFile(name);
  if (!stackPath) {
    console.log(`\nStack '${name}' does not exist.\n`);
    return;
  }

  const stack = await fs.readJson(stackPath);
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
  const stackPath = await findStackFile(name);
  if (!stackPath) {
    console.log(`\nStack '${name}' does not exist.\n`);
    return;
  }
  await fs.remove(stackPath);
  console.log(`✓ Stack "${name}" deleted.`);
}

/* ------------------------------
   EXPORT STACK
------------------------------- */

async function exportStack(name, outputPath = null) {
  const stackPath = await findStackFile(name);
  if (!stackPath) {
    console.log(`\nStack '${name}' does not exist.\n`);
    return;
  }

  const stack = await fs.readJson(stackPath);

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

module.exports = {
  createStack,
  addToStack,
  installStack,
  deleteStack,
  exportStack,
  importStack,
  removeFromStack
};
