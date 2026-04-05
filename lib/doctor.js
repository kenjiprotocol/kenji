const fs = require('fs-extra');
const path = require('path');
const {
  projectKenji,
  globalKenji,
  projectSkillsDir,
  globalSkillsDir,
  globalStacksDir
} = require('./paths');

async function runDoctor() {
  console.log("Kenji Doctor Report\n");

  console.log(`Current directory: ${process.cwd()}\n`);

  console.log("Local (current folder):");
  console.log(`  Skills path: ${projectSkillsDir}`);

  if (await fs.pathExists(projectSkillsDir)) {
    console.log("  ✓ Local skills directory exists\n");
  } else {
    console.log("  • No local skills installed yet\n");
  }

  console.log("Global (available everywhere):");
  console.log(`  Stacks path: ${globalStacksDir}`);
  console.log(`  Global skills path: ${globalSkillsDir}\n`);

  if (process.env.KENJI_GITHUB_TOKEN) {
    console.log("✓ GitHub token detected");
  } else {
    console.log("⚠ No GitHub token set (rate limits apply)");
  }
}

module.exports = {
  runDoctor
};
