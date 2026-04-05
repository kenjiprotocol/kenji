const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const projectRoot = process.cwd();
const projectKenji = path.join(projectRoot, '.kenji');
const projectSkillsDir = path.join(projectKenji, 'skills');

const globalKenji = path.join(os.homedir(), '.kenji');
const globalStacksDir = path.join(globalKenji, 'stacks');
const globalSkillsDir = path.join(globalKenji, 'skills');

async function ensureProject() {
  await fs.ensureDir(projectSkillsDir);
}

async function ensureGlobal() {
  await fs.ensureDir(globalStacksDir);
  await fs.ensureDir(globalSkillsDir);
}

module.exports = {
  projectSkillsDir,
  globalStacksDir,
  globalSkillsDir,
  ensureProject,
  ensureGlobal,
  projectKenji,
  globalKenji,
  getSkillMetadata,
  findSkillDir
};

// Reads kenji.json from a skill folder — returns null if missing or corrupt
async function getSkillMetadata(skillPath) {
  const metaFile = path.join(skillPath, 'kenji.json');
  try {
    if (!(await fs.pathExists(metaFile))) return null;
    return await fs.readJson(metaFile);
  } catch {
    return null;
  }
}

// Case-insensitive folder lookup — returns the real full path, or null if not found
async function findSkillDir(baseDir, name) {
  const target = name.toLowerCase();
  try {
    const entries = await fs.readdir(baseDir);
    const match = entries.find(e => e.toLowerCase() === target);
    return match ? path.join(baseDir, match) : null;
  } catch {
    return null;
  }
}
