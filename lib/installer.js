const fs = require('fs-extra');
const path = require('path');
const {
  projectSkillsDir,
  globalSkillsDir,
  ensureProject,
  ensureGlobal
} = require('./paths');

const { fetchRepoContents, fetchRawFile, isRawGitHubUrl, parseGitHubTreeUrl } = require('./github');

/* ------------------------------
   RAW URL INSTALL
------------------------------- */

async function installFromRawUrl(url, force = false, isGlobal = false) {

  // Only accept raw.githubusercontent.com — all other hosts are rejected
  if (!url.startsWith('https://raw.githubusercontent.com/')) {
    console.log('Invalid install source.');
    console.log('Kenji supports only GitHub repositories and GitHub file URLs.');
    return;
  }

  // Parse: https://raw.githubusercontent.com/<owner>/<repo>/<branch>/[...subpath/]<file>
  const urlObj = new URL(url);
  const parts = urlObj.pathname.split('/').filter(Boolean);
  // parts[0] = owner, [1] = repo, [2] = branch, [3..n-1] = subpath, [n] = filename
  if (parts.length < 4) {
    console.log('Invalid GitHub raw URL format.');
    return;
  }

  const owner = parts[0];
  const repo = parts[1];
  // branch = parts[2] — not needed for naming
  const fileParts = parts.slice(3);                          // everything after branch
  const fileName = fileParts[fileParts.length - 1];
  const subpath = fileParts.slice(0, -1).join('-');        // intermediate folders → slug
  const baseName = fileName.replace(/\.[^/.]+$/, '');       // strip extension

  // Deterministic, collision-free: owner-repo[-subpath]-basename
  const skillFolder = subpath
    ? `${owner}-${repo}-${subpath}-${baseName}`
    : `${owner}-${repo}-${baseName}`;

  const targetDir = isGlobal ? globalSkillsDir : projectSkillsDir;
  if (isGlobal) await ensureGlobal();
  else await ensureProject();

  const skillPath = path.join(targetDir, skillFolder);

  if (await fs.pathExists(skillPath) && !force) {
    console.log(`"${skillFolder}" already installed.`);
    return;
  }

  if (force) await fs.remove(skillPath);

  const content = await fetchRawFile(url);

  await fs.ensureDir(skillPath);
  console.log(`[1/1] Downloading ${fileName}`);
  await fs.writeFile(path.join(skillPath, fileName), content);

  await fs.writeJson(
    path.join(skillPath, 'kenji.json'),
    {
      name: skillFolder,
      source: url,
      install_type: 'raw',
      scope: isGlobal ? 'global' : 'local',
      installed_at: new Date().toISOString()
    },
    { spaces: 2 }
  );

  console.log(`\n✔ Installation complete ${isGlobal ? '(global)' : ''}`);
}


/* ------------------------------
   GITHUB INSTALL
------------------------------- */

async function installFromGitHub(repo, force = false, isGlobal = false, entryFile = null) {
  if (!repo.includes('/')) {
    console.log("Use format user/repo");
    return;
  }

  const targetDir = isGlobal ? globalSkillsDir : projectSkillsDir;

  if (isGlobal) await ensureGlobal();
  else await ensureProject();

  const [owner, repoName] = repo.split('/');

  // Use owner-repo format to prevent collisions
  const skillFolder = `${owner}-${repoName}`;
  const skillPath = path.join(targetDir, skillFolder);

  if (await fs.pathExists(skillPath) && !force) {
    console.log(`"${skillFolder}" already installed.`);
    return;
  }

  if (force) await fs.remove(skillPath);

  const files = await fetchRepoContents(owner, repoName);

  // kenji.yaml is always downloaded if present — it's metadata, not a gating condition
  const kenjiyaml = files.find(f => f.type === 'file' && f.name === 'kenji.yaml');

  // Collect all non-README .md files — these are the actual skill files
  const mdFiles = files.filter(f =>
    f.type === 'file' &&
    f.name.toLowerCase().endsWith('.md') &&
    !f.name.toLowerCase().startsWith('readme')
  );

  await fs.ensureDir(skillPath);

  // If an exact entry file is specified, skip auto-discovery and just grab it
  if (entryFile) {
    let file;
    if (entryFile.includes('/')) {
      const axios = require('axios');
      const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${entryFile}`;
      try {
        const res = await axios.get(apiUrl, {
          headers: { 'User-Agent': 'kenji-cli' }
        });
        file = res.data;
      } catch (err) {
        console.log(`Entry file ${entryFile} not found in ${repoName}.`);
        return;
      }
    } else {
      file = files.find(f => f.name === entryFile);
    }

    if (!file) {
      console.log(`Entry file ${entryFile} not found in ${repoName}.`);
      return;
    }
    const totalFiles = 1 + (kenjiyaml && kenjiyaml.name !== entryFile ? 1 : 0);
    let fileIndex = 0;

    const content = await fetchRawFile(file.download_url);
    await fs.writeFile(path.join(skillPath, file.name), content);
    fileIndex++;
    console.log(`[${fileIndex}/${totalFiles}] Downloading ${file.name}`);

    // Download kenji.yaml metadata if present, but don't fail if missing
    if (kenjiyaml && kenjiyaml.name !== entryFile) {
      const yamlContent = await fetchRawFile(kenjiyaml.download_url);
      await fs.writeFile(path.join(skillPath, kenjiyaml.name), yamlContent);
      fileIndex++;
      console.log(`[${fileIndex}/${totalFiles}] Downloading ${kenjiyaml.name}`);
    }

    await fs.writeJson(
      path.join(skillPath, 'kenji.json'),
      {
        name: skillFolder,
        source: `github.com/${repo}#${entryFile}`,
        install_type: 'registry',
        scope: isGlobal ? 'global' : 'local',
        installed_at: new Date().toISOString()
      },
      { spaces: 2 }
    );
    console.log(`\n\u2714 Installation complete ${isGlobal ? '(global)' : ''}`);
    return;
  }

  if (!mdFiles.length) {
    console.log(`No skill files (.md) found in ${repoName}.`);
    console.log("The repo should contain at least one .md instruction file (not README).");
    return;
  }

  // Download kenji.yaml alongside skill files if it exists
  const allFiles = kenjiyaml ? [...mdFiles, kenjiyaml] : [...mdFiles];
  const total = allFiles.length;
  let idx = 0;

  if (kenjiyaml) {
    const content = await fetchRawFile(kenjiyaml.download_url);
    await fs.writeFile(path.join(skillPath, kenjiyaml.name), content);
    idx++;
    console.log(`[${idx}/${total}] Downloading ${kenjiyaml.name}`);
  }

  // Download all skill .md files
  for (const f of mdFiles) {
    const content = await fetchRawFile(f.download_url);
    await fs.writeFile(path.join(skillPath, f.name), content);
    idx++;
    console.log(`[${idx}/${total}] Downloading ${f.name}`);
  }

  await fs.writeJson(
    path.join(skillPath, 'kenji.json'),
    {
      name: skillFolder,
      source: `github.com/${repo}`,
      install_type: 'github',
      scope: isGlobal ? 'global' : 'local',
      installed_at: new Date().toISOString()
    },
    { spaces: 2 }
  );

  console.log(`\n\u2714 Installation complete ${isGlobal ? '(global)' : ''}`);
}


/* ------------------------------
   GITHUB TREE URL INSTALL
   e.g. https://github.com/owner/repo/tree/branch/subpath
------------------------------- */

async function installFromGitHubTreeUrl(url, force = false, isGlobal = false) {
  const parsed = parseGitHubTreeUrl(url);

  if (!parsed) {
    console.log("Could not parse GitHub URL.");
    return;
  }

  const { owner, repo, branch, subpath } = parsed;

  const targetDir = isGlobal ? globalSkillsDir : projectSkillsDir;
  if (isGlobal) await ensureGlobal();
  else await ensureProject();

  // Folder name: owner-repo[-subpath-slug]
  const subpathSlug = subpath ? '-' + subpath.replace(/\//g, '-') : '';
  const skillFolder = `${owner}-${repo}${subpathSlug}`;
  const skillPath = path.join(targetDir, skillFolder);

  if (await fs.pathExists(skillPath) && !force) {
    console.log(`"${skillFolder}" already installed. Use --force to reinstall.`);
    return;
  }

  if (force) await fs.remove(skillPath);

  // Fetch target subfolder contents via GitHub API
  const apiUrl = subpath
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${subpath}?ref=${branch}`
    : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`;

  let files;
  try {
    const axios = require('axios');
    const { getHeaders } = require('./github');
    const res = await axios.get(apiUrl, {
      headers: getHeaders(apiUrl)
    });
    files = res.data;
  } catch (err) {
    console.log(`Could not fetch contents from ${url}`);
    console.log("Check the URL is correct and the repo is public.");
    return;
  }

  if (!Array.isArray(files)) {
    console.log("Unexpected response from GitHub API.");
    return;
  }

  // Collect .md files, excluding README
  const mdFiles = files.filter(f =>
    f.type === 'file' &&
    f.name.toLowerCase().endsWith('.md') &&
    !f.name.toLowerCase().startsWith('readme')
  );

  if (!mdFiles.length) {
    console.log(`No skill files (.md) found in ${subpath || repo}.`);
    console.log("Make sure the folder contains .md instruction files (not just README).");
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
      name: skillFolder,
      source: url,
      install_type: 'github-tree',
      scope: isGlobal ? 'global' : 'local',
      installed_at: new Date().toISOString()
    },
    { spaces: 2 }
  );

  console.log(`\n\u2714 Installation complete ${isGlobal ? '(global)' : ''}`);
}


module.exports = {
  installFromGitHub,
  installFromRawUrl,
  installFromGitHubTreeUrl,
  isRawGitHubUrl
};
