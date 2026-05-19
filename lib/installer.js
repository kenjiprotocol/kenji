const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const readline = require('readline');

const {
  projectSkillsDir,
  globalSkillsDir,
  ensureProject,
  ensureGlobal
} = require('./paths');

const { fetchRawFile, parseGitHubTreeUrl, getHeaders, fetchRepoTree } = require('./github');

/* ------------------------------------------------------------------
   SLUG HELPERS
------------------------------------------------------------------ */

function toSlug(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'skill';
}

function makeRepoSlug(owner, repoName) {
  return `${owner}-${repoName}`;
}

/**
 * Derive a skill slug.
 * Priority: explicit skillName > parent dir of entryFile > filename without extension
 */
function deriveSkillSlug(entryFile, skillName) {
  if (skillName) return toSlug(skillName);
  if (!entryFile) return 'skill';
  const parts = entryFile.replace(/\\/g, '/').split('/');
  if (parts.length >= 2) return toSlug(parts[parts.length - 2]);
  return toSlug(parts[parts.length - 1].replace(/\.[^/.]+$/, ''));
}

/* ------------------------------------------------------------------
   CONFIRM PROMPT
------------------------------------------------------------------ */

function confirmPrompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}

/* ------------------------------------------------------------------
   SINGLE SKILL INSTALL
   Used when installing from registry (entryFile + optional skillName)
   or when a specific entry path is known.
   Installs into: <targetDir>/<repoSlug>/<skillSlug>/
------------------------------------------------------------------ */

async function installSingleSkill({
  owner, repoName, entryFile, skillName,
  targetDir, force, isGlobal, installType
}) {
  const rSlug = makeRepoSlug(owner, repoName);
  const sSlug = deriveSkillSlug(entryFile, skillName);
  const skillPath = path.join(targetDir, rSlug, sSlug);

  if (await fs.pathExists(skillPath) && !force) {
    console.log(`"${rSlug}/${sSlug}" already installed. Use --force to reinstall.`);
    return;
  }

  if (force) await fs.remove(skillPath);
  await fs.ensureDir(skillPath);

  // Fetch via GitHub contents API — handles any branch + URL-encodes the path
  const encodedEntry = entryFile.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${encodedEntry}`;

  let file;
  try {
    const res = await axios.get(apiUrl, { headers: getHeaders(apiUrl) });
    file = res.data;
  } catch {
    console.log(`\nEntry file not found: ${entryFile}`);
    console.log(`Repo: ${owner}/${repoName}\n`);
    return;
  }

  if (!file || !file.download_url) {
    console.log(`Could not get download URL for: ${entryFile}`);
    return;
  }

  const fileName = path.basename(entryFile);
  console.log(`[1/1] Downloading ${fileName}`);
  const content = await fetchRawFile(file.download_url);
  await fs.writeFile(path.join(skillPath, fileName), content);

  await fs.writeJson(
    path.join(skillPath, 'kenji.json'),
    {
      name: sSlug,
      repo: `${owner}/${repoName}`,
      source: `github.com/${owner}/${repoName}#${entryFile}`,
      install_type: installType || 'registry',
      scope: isGlobal ? 'global' : 'local',
      installed_at: new Date().toISOString(),
      skillPath: `${rSlug}/${sSlug}`
    },
    { spaces: 2 }
  );

  console.log(`\n✔ Installed ${rSlug}/${sSlug}${isGlobal ? ' (global)' : ''}`);
}

/* ------------------------------------------------------------------
   MULTI-SKILL RECURSIVE INSTALL
   Used when `kenji install user/repo` with no entry file.
   Fetches the full git tree once, finds all non-README .md files,
   groups them by parent directory, and installs each group as its
   own skill folder.
------------------------------------------------------------------ */

async function installAllSkillsFromRepo({ owner, repoName, targetDir, force, isGlobal }) {
  const rSlug = makeRepoSlug(owner, repoName);

  let tree, branch;
  try {
    const result = await fetchRepoTree(owner, repoName);
    tree = result.tree;
    branch = result.branch;
  } catch (err) {
    console.log(`\nCould not fetch repo tree for ${owner}/${repoName}.`);
    console.log('Check the repo exists and is public.\n');
    return;
  }

  // Find all non-README .md blob files
  const mdFiles = tree.filter(item =>
    item.type === 'blob' &&
    item.path.toLowerCase().endsWith('.md') &&
    !path.basename(item.path).toLowerCase().startsWith('readme')
  );

  if (!mdFiles.length) {
    console.log(`\nNo skill files (.md) found in ${owner}/${repoName}.`);
    console.log('The repo should contain at least one .md instruction file (not README).\n');
    return;
  }

  // Group by parent directory.
  // Files at repo root have dirname = '.' — each becomes its own skill.
  // Files in a subdirectory — the directory is the skill container.
  const groups = new Map();
  for (const f of mdFiles) {
    const parentDir = path.dirname(f.path).replace(/\\/g, '/');
    if (!groups.has(parentDir)) groups.set(parentDir, []);
    groups.get(parentDir).push(f);
  }

  console.log(`\nDiscovered ${groups.size} skill${groups.size > 1 ? 's' : ''} in ${owner}/${repoName}:\n`);
  for (const [parentDir, files] of groups) {
    const sSlug = parentDir === '.'
      ? toSlug(files[0].path.replace(/\.[^/.]+$/, ''))
      : toSlug(path.basename(parentDir));
    console.log(`  ${rSlug}/${sSlug}`);
  }
  console.log('');

  // Confirm before installing multiple skills
  if (groups.size > 1) {
    const ok = await confirmPrompt(`Install all ${groups.size} skills? (Y/n) `);
    if (!ok) {
      console.log('\nInstallation cancelled.\n');
      return;
    }
    console.log('');
  }

  let installed = 0;
  let skipped = 0;

  for (const [parentDir, files] of groups) {
    const sSlug = parentDir === '.'
      ? toSlug(files[0].path.replace(/\.[^/.]+$/, ''))
      : toSlug(path.basename(parentDir));

    const skillPath = path.join(targetDir, rSlug, sSlug);

    if (await fs.pathExists(skillPath) && !force) {
      console.log(`  Skipping "${rSlug}/${sSlug}" — already installed.`);
      skipped++;
      continue;
    }

    if (force) await fs.remove(skillPath);
    await fs.ensureDir(skillPath);

    let downloaded = 0;
    for (const f of files) {
      const fileName = path.basename(f.path);
      const encodedPath = f.path.split('/').map(encodeURIComponent).join('/');
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${encodedPath}`;
      const content = await fetchRawFile(rawUrl);
      await fs.writeFile(path.join(skillPath, fileName), content);
      downloaded++;
    }

    await fs.writeJson(
      path.join(skillPath, 'kenji.json'),
      {
        name: sSlug,
        repo: `${owner}/${repoName}`,
        source: `github.com/${owner}/${repoName}#${parentDir === '.' ? files[0].path : parentDir}`,
        install_type: 'github',
        scope: isGlobal ? 'global' : 'local',
        installed_at: new Date().toISOString(),
        skillPath: `${rSlug}/${sSlug}`
      },
      { spaces: 2 }
    );

    console.log(`  ✔ ${rSlug}/${sSlug} (${downloaded} file${downloaded > 1 ? 's' : ''})`);
    installed++;
  }

  console.log('');
  if (installed > 0) {
    console.log(`✔ Installed ${installed} skill${installed > 1 ? 's' : ''} from ${owner}/${repoName}${isGlobal ? ' (global)' : ''}`);
  }
  if (skipped > 0) {
    console.log(`  (${skipped} already installed — use --force to reinstall)`);
  }
  console.log('');
}

/* ------------------------------------------------------------------
   installFromGitHub — main entry point
------------------------------------------------------------------ */

async function installFromGitHub(repo, force = false, isGlobal = false, entryFile = null, skillName = null) {
  if (!repo.includes('/')) {
    console.log('Use format user/repo');
    return;
  }

  const [owner, repoName] = repo.split('/');
  const targetDir = isGlobal ? globalSkillsDir : projectSkillsDir;
  if (isGlobal) await ensureGlobal();
  else await ensureProject();

  if (entryFile) {
    await installSingleSkill({ owner, repoName, entryFile, skillName, targetDir, force, isGlobal });
  } else {
    await installAllSkillsFromRepo({ owner, repoName, targetDir, force, isGlobal });
  }
}

/* ------------------------------------------------------------------
   RAW URL INSTALL
   https://raw.githubusercontent.com/owner/repo/branch/path/file.md
   → installs into <repoSlug>/<skill-slug>/
------------------------------------------------------------------ */

async function installFromRawUrl(url, force = false, isGlobal = false) {
  if (!url.startsWith('https://raw.githubusercontent.com/')) {
    console.log('Invalid install source.');
    console.log('Kenji supports only GitHub repositories and GitHub file URLs.');
    return;
  }

  const urlObj = new URL(url);
  const parts = urlObj.pathname.split('/').filter(Boolean);
  if (parts.length < 4) {
    console.log('Invalid GitHub raw URL format.');
    return;
  }

  const owner = parts[0];
  const repoName = parts[1];
  const fileParts = parts.slice(3);
  const fileName = decodeURIComponent(fileParts[fileParts.length - 1]);
  const baseName = fileName.replace(/\.[^/.]+$/, '');

  const rSlug = makeRepoSlug(owner, repoName);
  const sSlug = toSlug(baseName);
  const targetDir = isGlobal ? globalSkillsDir : projectSkillsDir;
  if (isGlobal) await ensureGlobal();
  else await ensureProject();

  const skillPath = path.join(targetDir, rSlug, sSlug);

  if (await fs.pathExists(skillPath) && !force) {
    console.log(`"${rSlug}/${sSlug}" already installed. Use --force to reinstall.`);
    return;
  }

  if (force) await fs.remove(skillPath);
  await fs.ensureDir(skillPath);

  console.log(`[1/1] Downloading ${fileName}`);
  const content = await fetchRawFile(url);
  await fs.writeFile(path.join(skillPath, fileName), content);

  await fs.writeJson(
    path.join(skillPath, 'kenji.json'),
    {
      name: sSlug,
      repo: `${owner}/${repoName}`,
      source: url,
      install_type: 'raw',
      scope: isGlobal ? 'global' : 'local',
      installed_at: new Date().toISOString(),
      skillPath: `${rSlug}/${sSlug}`
    },
    { spaces: 2 }
  );

  console.log(`\n✔ Installed ${rSlug}/${sSlug}${isGlobal ? ' (global)' : ''}`);
}

/* ------------------------------------------------------------------
   GITHUB TREE URL INSTALL
   https://github.com/owner/repo/tree/branch/subpath
   → installs the specific folder as one skill
------------------------------------------------------------------ */

async function installFromGitHubTreeUrl(url, force = false, isGlobal = false) {
  const parsed = parseGitHubTreeUrl(url);
  if (!parsed) {
    console.log('Could not parse GitHub URL.');
    return;
  }

  const { owner, repo: repoName, branch, subpath } = parsed;
  const targetDir = isGlobal ? globalSkillsDir : projectSkillsDir;
  if (isGlobal) await ensureGlobal();
  else await ensureProject();

  const rSlug = makeRepoSlug(owner, repoName);
  const sSlug = subpath ? toSlug(path.basename(subpath)) : toSlug(repoName);
  const skillPath = path.join(targetDir, rSlug, sSlug);

  if (await fs.pathExists(skillPath) && !force) {
    console.log(`"${rSlug}/${sSlug}" already installed. Use --force to reinstall.`);
    return;
  }

  if (force) await fs.remove(skillPath);

  const apiUrl = subpath
    ? `https://api.github.com/repos/${owner}/${repoName}/contents/${subpath}?ref=${branch}`
    : `https://api.github.com/repos/${owner}/${repoName}/contents?ref=${branch}`;

  let files;
  try {
    const res = await axios.get(apiUrl, { headers: getHeaders(apiUrl) });
    files = res.data;
  } catch {
    console.log(`Could not fetch contents from ${url}`);
    console.log('Check the URL is correct and the repo is public.');
    return;
  }

  if (!Array.isArray(files)) {
    console.log('Unexpected response from GitHub API.');
    return;
  }

  const mdFiles = files.filter(f =>
    f.type === 'file' &&
    f.name.toLowerCase().endsWith('.md') &&
    !f.name.toLowerCase().startsWith('readme')
  );

  if (!mdFiles.length) {
    console.log(`No skill files (.md) found at ${subpath || 'repo root'}.`);
    console.log('Make sure the folder contains .md instruction files (not just README).');
    return;
  }

  await fs.ensureDir(skillPath);

  const total = mdFiles.length;
  let idx = 0;
  for (const f of mdFiles) {
    const content = await fetchRawFile(f.download_url);
    await fs.writeFile(path.join(skillPath, f.name), content);
    idx++;
    console.log(`[${idx}/${total}] Downloading ${f.name}`);
  }

  await fs.writeJson(
    path.join(skillPath, 'kenji.json'),
    {
      name: sSlug,
      repo: `${owner}/${repoName}`,
      source: url,
      install_type: 'github-tree',
      scope: isGlobal ? 'global' : 'local',
      installed_at: new Date().toISOString(),
      skillPath: `${rSlug}/${sSlug}`
    },
    { spaces: 2 }
  );

  console.log(`\n✔ Installed ${rSlug}/${sSlug}${isGlobal ? ' (global)' : ''}`);
}

module.exports = {
  installFromGitHub,
  installFromRawUrl,
  installFromGitHubTreeUrl
};
