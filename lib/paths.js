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

/**
 * Find all skill folders matching a name across the two-level structure.
 * Accepts either 'skill-slug' or 'repo-slug/skill-slug'.
 * Returns an array of { repoSlug, skillSlug, fullPath }.
 * Callers check .length: 0 = not found, 1 = unique, 2+ = ambiguous.
 */
async function findSkillsByName(baseDir, name) {
  const parts = name.split('/');
  const isFullPath = parts.length === 2;

  const results = [];
  try {
    const repoDirs = await fs.readdir(baseDir);
    for (const repoDir of repoDirs) {
      // If full repo/skill path given, only check the specified repo
      if (isFullPath && repoDir.toLowerCase() !== parts[0].toLowerCase()) continue;

      const repoPath = path.join(baseDir, repoDir);
      let stat;
      try { stat = await fs.stat(repoPath); } catch { continue; }
      if (!stat.isDirectory()) continue;

      let skillDirs;
      try { skillDirs = await fs.readdir(repoPath); } catch { continue; }

      const targetSkill = isFullPath ? parts[1].toLowerCase() : parts[0].toLowerCase();
      for (const skillDir of skillDirs) {
        if (skillDir.toLowerCase() === targetSkill) {
          const skillPath = path.join(repoPath, skillDir);
          try {
            const s = await fs.stat(skillPath);
            if (s.isDirectory()) {
              results.push({ repoSlug: repoDir, skillSlug: skillDir, fullPath: skillPath });
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* baseDir doesn't exist */ }
  return results;
}

/**
 * List every installed skill across the two-level structure.
 * Returns an array of { repoSlug, skillSlug, fullPath }.
 */
async function listAllSkills(baseDir) {
  const result = [];
  try {
    const repoDirs = await fs.readdir(baseDir);
    for (const repoDir of repoDirs) {
      const repoPath = path.join(baseDir, repoDir);
      let stat;
      try { stat = await fs.stat(repoPath); } catch { continue; }
      if (!stat.isDirectory()) continue;

      let skillDirs;
      try { skillDirs = await fs.readdir(repoPath); } catch { continue; }

      for (const skillDir of skillDirs) {
        const skillPath = path.join(repoPath, skillDir);
        try {
          const s = await fs.stat(skillPath);
          if (s.isDirectory()) {
            result.push({ repoSlug: repoDir, skillSlug: skillDir, fullPath: skillPath });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* baseDir doesn't exist */ }
  return result;
}

module.exports = {
  projectSkillsDir,
  globalSkillsDir,
  globalStacksDir,
  ensureProject,
  ensureGlobal,
  projectKenji,
  globalKenji,
  getSkillMetadata,
  findSkillsByName,
  listAllSkills,
};
