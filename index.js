#!/usr/bin/env node

const { program } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

const {
  projectSkillsDir,
  globalSkillsDir,
  ensureProject,
  ensureGlobal,
  getSkillMetadata,
  findSkillDir
} = require('./lib/paths');

const {
  installFromGitHub,
  installFromRawUrl,
  installFromGitHubTreeUrl
} = require('./lib/installer');

const { isGitHubTreeUrl, parseGitHubTreeUrl, fetchRepoContents, isGitHubBlobUrl, blobToRawUrl } = require('./lib/github');

/* Helper: detect exact GitHub bare-repo URL */
function isGitHubRepoUrl(str) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(str);
}

/* Helper: detect GitHub user-only URL */
function isGitHubUserUrl(str) {
  return /^https:\/\/github\.com\/[^/]+$/.test(str);
}

/* Helper: detect raw file URL */
function isRawGitHubUrl(str) {
  return str.startsWith('https://raw.githubusercontent.com/');
}

const {
  createStack,
  addToStack,
  installStack,
  deleteStack,
  exportStack,
  importStack,
  removeFromStack
} = require('./lib/stacks');

const { runDoctor } = require('./lib/doctor');

const os = require('os');

const pkg = require('./package.json');

program.name('kenji').version(pkg.version);

const { getRegistryCached, resolveRegistryItem } = require('./lib/registry');


/* ------------------------------
   REGISTRY UPDATE
------------------------------- */



/* ------------------------------
   INSTALL
------------------------------- */

program
  .command('install <target>')
  .option('-f, --force', 'Force reinstall')
  .option('-g, --global', 'Install globally')
  .description('Install a skill or stack')
  .action(async (target, options) => {

    const isGlobal = options.global || false;

    if (target.startsWith("http")) {
      // Blob URL: https://github.com/user/repo/blob/branch/path/file.md
      // → normalise to raw.githubusercontent.com first
      if (isGitHubBlobUrl(target)) {
        target = blobToRawUrl(target);
      }

      // GitHub tree URL: https://github.com/owner/repo/tree/branch/path
      if (isGitHubTreeUrl(target)) {
        await installFromGitHubTreeUrl(target, options.force, isGlobal);
        return;
      }

      // Raw GitHub file: https://raw.githubusercontent.com/...
      if (target.startsWith('https://raw.githubusercontent.com/')) {
        await installFromRawUrl(target, options.force, isGlobal);
        return;
      }

      // All other HTTP(S) URLs are rejected — Kenji is GitHub-only
      console.log('Invalid install source.');
      console.log('Kenji supports only GitHub repositories and GitHub file URLs.');
      return;
    }

    const registry = await getRegistryCached();

    const [namespace, name] = target.includes("/")
      ? target.split("/")
      : ["kenji", target];

    const ns = namespace.toLowerCase();
    const nm = name.toLowerCase();

    const skill =
      registry.skills.find(s => s.name.toLowerCase() === nm && s.namespace.toLowerCase() === ns);

    const stack =
      registry.stacks.find(s => s.name.toLowerCase() === nm && s.namespace.toLowerCase() === ns);

    // Interactive prompt helper
    const confirmInstall = async (item) => {
      // If force is passed, or it's official, no prompt
      if (options.force || item.official) return true;

      console.log(`\nThis skill is from a community registry and has not been reviewed by the Kenji team.`);
      console.log(`  Name:   ${item.namespace}/${item.name}`);
      console.log(`  Source: ${item.sourceRegistry}`);
      console.log(`  Repo:   ${item.repo || item.sourceRepo}`);
      console.log(`\nWe recommend viewing the source repo before installing: https://github.com/${item.repo || item.sourceRepo}`);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      return new Promise(resolve => {
        rl.question('\nProceed with installation? (y/N) ', answer => {
          rl.close();
          const proceed = answer.trim().toLowerCase() === 'y';
          if (!proceed) console.log('\nInstallation cancelled.');
          resolve(proceed);
        });
      });
    };

    if (skill) {
      if (!(await confirmInstall(skill))) return;

      console.log(`\nInstalling skill "${skill.name}" from Kenji registry...`);
      await installFromGitHub(skill.repo, options.force, isGlobal, skill.entry || null);
      return;
    }

    if (stack) {
      if (!Array.isArray(stack.skills) || !stack.skills.length) {
        console.log(`Stack "${stack.name}" has no skills listed in the registry.`);
        return;
      }

      if (!(await confirmInstall(stack))) return;

      console.log(`\nInstalling stack "${stack.name}" (${stack.skills.length} skill${stack.skills.length > 1 ? 's' : ''})...\n`);

      for (const entry of stack.skills) {
        if (entry.startsWith('http')) {
          if (isGitHubTreeUrl(entry)) {
            await installFromGitHubTreeUrl(entry, options.force, isGlobal);
          } else {
            await installFromRawUrl(entry, options.force, isGlobal);
          }
          continue;
        }

        const item = await resolveRegistryItem(entry);
        if (item && item.type === 'skill') {
          console.log(`Resolved "${entry}" from registry -> ${item.repo}`);
          await installFromGitHub(item.repo, options.force, isGlobal, item.entry);
        } else {
          await installFromGitHub(entry, options.force, isGlobal);
        }
      }

      console.log(`\n✓ Stack "${stack.name}" installed.`);
      return;
    }

    if (target.includes("/")) {
      await installFromGitHub(target, options.force, isGlobal);
      return;
    }

    console.log(`"${target}" not found in registry.`);
  });

/* ------------------------------
   LIST
------------------------------- */

program
  .command('list')
  .option('-g, --global', 'List globally installed skills')
  .description('List installed skills')
  .action(async (options) => {

    if (options.global) {

      await ensureGlobal();

      const skills = await fs.readdir(globalSkillsDir);

      if (!skills.length) {
        console.log("No global skills installed.");
        return;
      }

      console.log("\nGlobal skills:\n");

      skills.forEach(s => console.log(`- ${s}`));

    } else {

      await ensureProject();

      const skills = await fs.readdir(projectSkillsDir);

      if (!skills.length) {
        console.log("No local skills installed in this folder.");
        return;
      }

      console.log("\nLocal skills (current folder):\n");

      skills.forEach(s => console.log(`- ${s}`));
    }
  });

/* ------------------------------
   STACK
------------------------------- */

program
  .command('stack <action> [name] [skill]')
  .description('Manage global stacks')
  .action(async (action, name, skill) => {

    await ensureGlobal();

    if (action === 'create') {
      await createStack(name);
    }

    else if (action === 'add') {
      if (!name || !skill) {
        console.log('\nMissing arguments.\n');
        console.log('Usage:');
        console.log('  kenji stack add <stack-name> <skill>\n');
        console.log('Example:');
        console.log('  kenji stack add my-stack kenji/react-debug\n');
        return;
      }
      await addToStack(name, skill);
    }

    else if (action === 'remove-skill') {
      if (!name || !skill) {
        console.log('Usage: kenji stack remove-skill <stack> <skill>');
        return;
      }
      await removeFromStack(name, skill);
    }

    else if (action === 'install') {
      await installStack(name);
    }

    else if (action === 'delete') {
      await deleteStack(name);
    }

    else if (action === 'export') {
      await exportStack(name);
    }

    else if (action === 'import') {
      await importStack(name);
    }

    else if (action === 'list') {

      let files;
      try { files = await fs.readdir(globalStacksDir); } catch { files = []; }

      const stacks = files.filter(f => f.endsWith('.json'));
      if (!stacks.length) {
        console.log('No stacks created.');
        return;
      }

      console.log('\nStacks:\n');
      stacks.forEach(f => console.log(`- ${f.replace('.json', '')}`));
      console.log('');
    }

    else if (action === 'show') {

      if (!name) {
        console.log('Usage: kenji stack show <name>');
        return;
      }

      // Case-insensitive stack file lookup
      let showPath = null;
      try {
        const entries = await fs.readdir(globalStacksDir);
        const m = entries.find(e => e.toLowerCase() === name.toLowerCase() + '.json');
        if (m) showPath = path.join(globalStacksDir, m);
      } catch { }

      if (!showPath) {
        console.log(`\nStack '${name}' does not exist.\n`);
        console.log(`Run: kenji stack create ${name}\n`);
        return;
      }

      const stack = await fs.readJson(showPath);
      console.log(`\nStack: ${stack.name}`);
      console.log(`Skills (${stack.skills.length}):\n`);
      stack.skills.forEach((s, i) => {
        if (typeof s === 'object') {
          console.log(`  ${i + 1}. [${s.type}] ${s.value}`);
        } else {
          console.log(`  ${i + 1}. ${s}`);
        }
      });
      console.log('');
    }

    else {
      console.log("Available: create, add, remove-skill, install, delete, export, import, list, show");
    }

  });

/* ------------------------------
   REMOVE
------------------------------- */

program
  .command('remove <name>')
  .option('-g, --global', 'Remove global skill')
  .description('Remove an installed skill')
  .action(async (name, options) => {

    const isGlobal = options.global || false;

    if (isGlobal) {

      await ensureGlobal();

      const skillPath = await findSkillDir(globalSkillsDir, name);

      if (!skillPath) {
        console.log(`Global skill "${name}" not found.`);
        return;
      }

      await fs.remove(skillPath);
      console.log(`✓ Removed global skill ${path.basename(skillPath)}`);

    } else {

      await ensureProject();

      const skillPath = await findSkillDir(projectSkillsDir, name);

      if (!skillPath) {
        console.log(`Local skill "${name}" not found.`);
        return;
      }

      await fs.remove(skillPath);
      console.log(`✓ Removed local skill ${path.basename(skillPath)}`);
    }
  });

/* ------------------------------
   USE
------------------------------- */

program
  .command('use <skill>')
  .description('Copy a globally installed skill into the current project')
  .option('-f, --force', 'Overwrite if already installed locally')
  .action(async (skill, options) => {

    await ensureGlobal();
    await ensureProject();

    const globalPath = await findSkillDir(globalSkillsDir, skill);
    if (!globalPath) {
      console.log(`\nGlobal skill "${skill}" not found.`);
      console.log('Run: kenji list --global\n');
      return;
    }

    // Preserve the real folder name for the local copy
    const realName = path.basename(globalPath);
    const localPath = path.join(projectSkillsDir, realName);
    const existingLocal = await findSkillDir(projectSkillsDir, skill);

    if (existingLocal && !options.force) {
      console.log(`\nSkill "${realName}" already installed in this project.`);
      console.log('Use --force to overwrite.\n');
      return;
    }

    try {
      await fs.copy(globalPath, localPath, { overwrite: true });

      const meta = await getSkillMetadata(localPath);
      if (meta) {
        meta.scope = 'local';
        await fs.writeJson(path.join(localPath, 'kenji.json'), meta, { spaces: 2 });
      }

      console.log(`\n✓ Skill "${realName}" copied to current project.\n`);
    } catch (err) {
      console.log(`\nFailed to copy skill: ${err.message}\n`);
    }
  });

/* ------------------------------
   DOCTOR
------------------------------- */

program
  .command('doctor')
  .description('Show environment diagnostics')
  .action(async () => {
    await runDoctor();
  });

/* ------------------------------
   WHERE
------------------------------- */

program
  .command('where <skill>')
  .description('Show where a skill is installed and how it was sourced')
  .option('--json', 'Output as JSON')
  .option('--verbose', 'Show full metadata')
  .action(async (skill, options) => {

    const localPath = await findSkillDir(projectSkillsDir, skill);
    const globalPath = await findSkillDir(globalSkillsDir, skill);

    let foundPath = null;
    let scope = null;

    if (localPath) {
      foundPath = localPath;
      scope = 'local';
    } else if (globalPath) {
      foundPath = globalPath;
      scope = 'global';
    }

    if (!foundPath) {
      console.log(`\nSkill not installed locally or globally.\n`);
      return;
    }

    const meta = await getSkillMetadata(foundPath);
    const realName = path.basename(foundPath);

    const displayPath = scope === 'local'
      ? path.join('.kenji', 'skills', realName)
      : path.join('~', '.kenji', 'skills', realName);

    if (options.json) {
      console.log(JSON.stringify({
        skill: realName,
        scope: scope,
        path: foundPath,
        source: meta?.source || null,
        install_type: meta?.install_type || null,
        installed_at: meta?.installed_at || null
      }, null, 2));
      return;
    }

    console.log('');
    console.log(`  Skill:        ${realName}`);
    console.log(`  Location:     ${scope}`);
    console.log(`  Path:         ${displayPath}`);

    if (meta) {
      if (meta.source) console.log(`  Installed from: ${meta.source}`);
      if (meta.install_type) console.log(`  Install type:   ${meta.install_type}`);
      if (meta.installed_at) console.log(`  Installed at:   ${meta.installed_at}`);

      if (options.verbose) {
        console.log('');
        console.log('  Full metadata:');
        console.log(JSON.stringify(meta, null, 4).split('\n').map(l => '  ' + l).join('\n'));
      }
    } else {
      console.log('  (no kenji.json metadata found)');
    }

    console.log('');
  });

/* ------------------------------
   SEARCH
------------------------------- */

program
  .command('search <query>')
  .description('Search Kenji skill and stack registry')
  .option('--type <type>', 'Filter by type: skill or stack')
  .option('--namespace <ns>', 'Filter by namespace')
  .action(async (query, options) => {

    const axios = require('axios');
    const API_BASE = 'https://kenjiprotocol.com';

    let results;
    try {
      const res = await axios.get(`${API_BASE}/api/search`, {
        params: { q: query },
        timeout: 8000
      });
      results = Array.isArray(res.data) ? res.data : [];
    } catch {
      console.log('\nCould not reach the Kenji registry API. Check your internet connection.\n');
      return;
    }

    // Apply local filters after fetch
    if (options.type) results = results.filter(r => r.type === options.type);
    if (options.namespace) results = results.filter(r => r.namespace?.toLowerCase() === options.namespace.toLowerCase());

    if (!results.length) {
      console.log('\nNo registry results found.');
      console.log('');
      console.log('You can still install skills directly from:');
      console.log('  kenji install user/repo');
      console.log('  kenji install https://github.com/user/repo/tree/main/path/to/skill');
      console.log('  kenji install https://raw.githubusercontent.com/.../SKILL.md');
      console.log('');
      return;
    }

    const shown = results.slice(0, 5);
    console.log('');
    shown.forEach(r => {
      const isCommunity = r.sourceRegistry && r.sourceRegistry !== 'kenjiprotocol/registry';
      console.log(`${r.namespace}/${r.name}${isCommunity ? ' [community]' : ''}`);
      console.log(`  Type:    ${r.type}`);
      if (r.repo) console.log(`  Repo:    ${r.repo}`);
      if (r.tags?.length) console.log(`  Tags:    ${r.tags.join(', ')}`);
      if (r.description) console.log(`  Desc:    ${r.description}`);
      if (isCommunity) console.log(`  Source:  github.com/${r.sourceRegistry}`);
      console.log(`  Install: kenji install ${r.namespace}/${r.name}`);
      console.log('');
    });

    if (results.length > 5) {
      console.log(`  ... and ${results.length - 5} more.`);
    }
    console.log('  Explore more: https://kenjiprotocol.com/registry\n');
  });

/* ------------------------------
   INFO
------------------------------- */

program
  .command('info <name>')
  .description('Show details for registry item, GitHub repo, folder or raw skill URL')
  .action(async (name) => {

    const { getHeaders } = require('./lib/github');
    const axios = require('axios');

    // 1. GitHub user-only URL → not supported
    if (isGitHubUserUrl(name)) {
      console.log('\nKenji info requires a repository or registry item.');
      console.log('Example: kenji info user/repo\n');
      return;
    }

    // 2. Raw GitHub file URL
    if (isRawGitHubUrl(name)) {
      console.log('\nRaw Skill File');
      console.log(`  URL: ${name}`);
      console.log(`\n  Install with:\n  kenji install ${name}\n`);
      return;
    }

    // 3. GitHub tree URL → show folder info
    if (isGitHubTreeUrl(name)) {
      const parsed = parseGitHubTreeUrl(name);
      if (!parsed) {
        console.log('\nUnsupported URL format.\n');
        return;
      }
      console.log('\nGitHub Skill Folder');
      console.log(`  Repo:   ${parsed.owner}/${parsed.repo}`);
      console.log(`  Branch: ${parsed.branch}`);
      console.log(`  Path:   ${parsed.subpath || '(root)'}`);
      console.log(`\n  Install with:\n  kenji install ${name}\n`);
      return;
    }

    // 4. Full GitHub repo URL → normalise to owner/repo
    if (isGitHubRepoUrl(name)) {
      const match = name.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/);
      name = match[1];
    }

    // 5. Registry lookup (namespace/name or bare name)
    const registry = await getRegistryCached();

    const [namespace, item] = name.includes('/')
      ? name.split('/')
      : ['kenji', name];

    const ns2 = namespace.toLowerCase();
    const it2 = item.toLowerCase();
    const found =
      registry.skills.find(s => s.name.toLowerCase() === it2 && s.namespace.toLowerCase() === ns2) ||
      registry.stacks.find(s => s.name.toLowerCase() === it2 && s.namespace.toLowerCase() === ns2);

    if (found) {
      console.log('');
      console.log(`  ${found.namespace}/${found.name}`);
      console.log(`  Type:       ${found.type || 'skill'}`);
      if (found.description) console.log(`  Desc:       ${found.description}`);
      if (found.repo) console.log(`  Repo:       https://github.com/${found.repo}`);
      if (found.entry) console.log(`  Entry:      ${found.entry}`);
      if (found.tags?.length) console.log(`  Tags:       ${found.tags.join(', ')}`);
      console.log(`\n  Install with:\n  kenji install ${found.namespace}/${found.name}\n`);
      return;
    }

    // 6. GitHub repo API lookup (user/repo format)
    if (name.includes('/') && !name.startsWith('http')) {
      try {
        const apiUrl = `https://api.github.com/repos/${name}`;
        const res = await axios.get(apiUrl, { headers: getHeaders(apiUrl) });
        const repo = res.data;

        console.log('');
        console.log(`  ${repo.full_name}`);
        console.log(`  Source:  GitHub`);
        if (repo.description) console.log(`  Desc:    ${repo.description}`);
        console.log(`  URL:     ${repo.html_url}`);
        console.log(`\n  Install with:\n  kenji install ${repo.full_name}\n`);
      } catch (err) {
        console.log('\nRepository not found.\n');
      }
      return;
    }

    // 7. Nothing matched
    console.log('\nInvalid registry reference.\n');
  });

/* ------------------------------
   REGISTRY
------------------------------- */

program
  .command('registry <action> [args...]')
  .description('Manage Kenji registries')
  .action(async (action, args) => {

    if (action === 'add') {
      const input = args[0];
      if (!input) {
        console.log('\nUsage: kenji registry add <github-url-or-user/repo>\n');
        return;
      }

      // Normalise to user/repo
      const repo = input
        .replace(/^https?:\/\//, '')
        .replace(/^github\.com\//, '')
        .replace(/\/+$/, '')
        .split('/').slice(0, 2).join('/');

      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
        console.log('\nInvalid repository. Use: user/repo or https://github.com/user/repo\n');
        return;
      }

      const axios = require('axios');
      process.stdout.write(`Submitting ${repo} to Kenji registry...\n`);

      try {
        const res = await axios.post('https://kenjiprotocol.com/api/registry/add', { repo }, {
          timeout: 15000
        });
        if (res.data?.success) {
          const msg = res.data?.message || 'Registry added successfully.';
          console.log(`\n✓ ${msg}\n`);
          if (!res.data?.alreadyRegistered) {
            console.log('Your skills and stacks will appear in search results within a few seconds.');
            console.log('Tip: run `kenji search <your-skill>` to confirm.\n');
          }
        } else {
          console.log(`\nFailed: ${res.data?.error || 'Unknown error'}\n`);
        }
      } catch (err) {
        const msg = err.response?.data?.error || err.message;
        console.log(`\nFailed to add registry: ${msg}\n`);
      }
      return;
    }

    if (action === 'list') {
      console.log('\nKnown registries are managed at: https://kenjiprotocol.com/registry\n');
      return;
    }

    console.log('\nUsage:');
    console.log('  kenji registry add <user/repo>   Add a community registry');
    console.log('  kenji registry list              List known registries\n');
  });

program.parse();
