# Kenji Protocol

**Kenji** is a CLI for installing and managing AI agent instruction sets (skills) and collections of skills (stacks).

Instead of copying prompts, rules, or SKILL files across projects, Kenji lets you install structured agent capabilities directly into your project with a single command.

> Think of Kenji as package management for AI agent skills.

---

## Installation

```bash
npm install -g @kenji-protocol/kenji
```

Verify installation:

```bash
kenji doctor
```

> **Note on GitHub Tokens:** If `kenji doctor` warns that no GitHub token is set, do not worry. A token is **optional**. Registry search and `kenji info` do not use your personal GitHub token. It is only needed for direct GitHub installs to avoid API rate limits.

---

## Setting a GitHub Token (Optional)

Most users will not need a token. Set `KENJI_GITHUB_TOKEN` if you:

- Install frequently from `user/repo` targets or raw URLs
- Hit GitHub API rate limits during heavy usage

**Set temporarily:**
```bash
export KENJI_GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

**Set permanently:**
```bash
echo 'export KENJI_GITHUB_TOKEN=ghp_xxxxxxxxxxxx' >> ~/.bashrc
source ~/.bashrc
```

---

## What Kenji Installs

Kenji installs agent instruction assets such as:

- `SKILL.md` files
- structured instruction files (`*.md`)
- agent workflows, reasoning rules, prompt toolkits
- optional `kenji.json` metadata

Skills are installed inside your project (or globally) so agentic IDEs and AI tools can reference them during development.

---

## Directory Structure

### Project install *(default)*

```
.kenji/
  skills/
    <skill-name>/
      SKILL.md
      kenji.json   ← install metadata
```

### Global install

```
~/.kenji/
  skills/
    <skill-name>/
      SKILL.md
      kenji.json
  stacks/
    <stack-name>.json
```

---

## Registry

Kenji has a multi-registry architecture backed by the official Kenji registry and optional community registries:

[https://kenjiprotocol.com/registry](https://kenjiprotocol.com/registry)

The registry aggregates structured JSON metadata files sourced from GitHub repositories. Search runs against the Kenji API, which caches results via Vercel KV for global performance.

- No proprietary database
- Completely open protocol
- Community GitHub repositories can act as additional registries

---

## Core Commands

### `kenji search`

Search for skills and stacks across all connected registries.

```bash
kenji search <query>
```

```bash
kenji search react
kenji search react --type skill
kenji search react --type skill --namespace kenji
```

Results show up to 5 matches. Community registry items are labeled `[community]`. Full results are available at [kenjiprotocol.com/registry](https://kenjiprotocol.com/registry).

**Flags:**

| Flag | Description |
|---|---|
| `--type <skill\|stack>` | Filter by type |
| `--namespace <ns>` | Filter by namespace |

---

### `kenji info`

Show details for a registry item, GitHub repo, folder URL, or raw file URL.

```bash
kenji info <name>
```

```bash
kenji info kenji/react-debug
kenji info user/repo
kenji info https://github.com/user/repo/tree/main/skills/debug
kenji info https://raw.githubusercontent.com/user/repo/main/SKILL.md
```

---

### `kenji install`

Install a skill or stack. Supports multiple install sources.

```bash
kenji install <target> [--global] [--force]
```

**Flags:**

| Flag | Description |
|---|---|
| `-g, --global` | Install globally to `~/.kenji/skills/` |
| `-f, --force` | Force reinstall even if already installed |

**Install sources:**

**From registry (by name):**
```bash
kenji install react-debug
kenji install kenji/react-debug
```

If no namespace is provided, Kenji defaults to the `kenji` namespace.

**From GitHub repo:**
```bash
kenji install user/repo
kenji install anthropics/prompt-engineering
```

Downloads all valid instruction files (`*.md`, excluding README).

**From GitHub folder (tree URL):**
```bash
kenji install https://github.com/user/repo/tree/main/skills/debug
```

Installs only the files inside that folder.

**From GitHub blob URL:**
```bash
kenji install https://github.com/user/repo/blob/main/skills/react/SKILL.md
```

Blob URLs are automatically normalized to raw URLs.

**From raw file URL:**
```bash
kenji install https://raw.githubusercontent.com/user/repo/main/skills/react/SKILL.md
```

**Community skill confirmation:**

Before installing any skill from a non-official registry, Kenji shows the source details and asks for explicit confirmation:

```
This skill is from a community registry and has not been reviewed by the Kenji team.
  Name:   user/skill-name
  Source: user/their-registry
  Repo:   user/skill-repo

Proceed with installation? (y/N)
```

Use `--force` to skip the prompt only for reinstalls, not security confirmation.

---

### `kenji list`

List installed skills.

```bash
kenji list              # Project skills in ./.kenji/skills/
kenji list --global     # Global skills in ~/.kenji/skills/
```

---

### `kenji remove`

Remove an installed skill.

```bash
kenji remove <skill>             # Remove from current project
kenji remove <skill> --global    # Remove from global install
```

---

### `kenji where`

Show where a skill is installed and how it was installed.

```bash
kenji where <skill>
kenji where <skill> --json
kenji where <skill> --verbose
```

Checks the local project first, then global. Displays scope, path, install source, and install type.

**Flags:**

| Flag | Description |
|---|---|
| `--json` | Output as JSON |
| `--verbose` | Show full metadata from `kenji.json` |

---

### `kenji use`

Copy a globally installed skill into the current project.

```bash
kenji use <skill>
kenji use <skill> --force
```

Useful when you want to customize or commit a global skill inside a specific project. Use `--force` to overwrite an existing local copy.

---

### `kenji doctor`

Show environment diagnostics.

```bash
kenji doctor
```

Checks Node.js version, GitHub token status, and local installation paths.

---

## Stacks

Stacks are named collections of skills. They are stored globally in `~/.kenji/stacks/` and installed into projects on demand.

---

### `kenji stack create`

```bash
kenji stack create <name>
```

---

### `kenji stack add`

Add a skill to a stack. The skill reference can be any valid install source.

```bash
kenji stack add <stack> <skill>
```

```bash
kenji stack add my-stack kenji/react-debug
kenji stack add my-stack user/repo
kenji stack add my-stack https://raw.githubusercontent.com/user/repo/main/SKILL.md
kenji stack add my-stack https://github.com/user/repo/tree/main/skills/frontend
```

---

### `kenji stack remove-skill`

Remove a skill from a stack.

```bash
kenji stack remove-skill <stack> <skill>
```

---

### `kenji stack install`

Install all skills in a stack into the current project.

```bash
kenji stack install <stack>
```

Kenji resolves:

- `registry` entries → looked up in the aggregated registry, then installed from the referenced repo
- `github` entries → installed from `user/repo` directly
- `url` entries → installed from tree URL, blob URL, or raw file URL
- `global` entries → copied from `~/.kenji/skills/`

---

### `kenji stack show`

View the skills inside a stack.

```bash
kenji stack show <stack>
```

---

### `kenji stack list`

List all globally stored stacks.

```bash
kenji stack list
```

---

### `kenji stack delete`

```bash
kenji stack delete <stack>
```

---

### `kenji stack export`

Export a stack to a `.kenji.json` file in the current directory.

```bash
kenji stack export <stack>
```

Creates: `<stack-name>.kenji.json`

---

### `kenji stack import`

Import a stack from various sources.

```bash
kenji stack import <stack>            # Import from registry
kenji stack import user/repo          # Import from GitHub repo
kenji stack import ./my-stack.kenji.json   # Import from local file
```

---

## Stack File Schema

Stack files (produced by `kenji stack export`) follow this schema:

```json
{
  "type": "kenji-stack",
  "version": "1.0",
  "name": "my-stack",
  "description": "Optional description",
  "skills": [
    { "type": "registry", "value": "kenji/react-debug" },
    { "type": "github",   "value": "user/repo" },
    { "type": "url",      "value": "https://github.com/user/repo/tree/main/skills/frontend" },
    { "type": "global",   "value": "my-local-skill" }
  ]
}
```

> **Note:** Plain string entries in the `skills` array are not accepted. Each entry must be a structured `{ type, value }` object.

### Required fields

| Field | Description |
|---|---|
| `type` | Must be exactly `"kenji-stack"` |
| `version` | Must be a non-empty string (e.g. `"1.0"`) |
| `name` | Alphanumeric with hyphens and underscores only |
| `skills` | Array of `{ type, value }` objects |

### Skill entry types

| Type | Format | Description |
|---|---|---|
| `"registry"` | `namespace/name` | A skill from any Kenji registry |
| `"github"` | `user/repo` | A GitHub repository |
| `"url"` | Full URL | GitHub tree, blob, or raw file URL |
| `"global"` | Folder name | A locally installed global skill |

---

## Managing Registries

### `kenji registry add`

Add a community GitHub repository as a registry.

```bash
kenji registry add user/kenji-registry
kenji registry add https://github.com/user/kenji-registry
```

The repo must contain at least one valid `skills/` or `stacks/` folder with conforming JSON files. Duplicate submissions are ignored. Skills and stacks appear in global search almost immediately after submission.

### `kenji registry list`

```bash
kenji registry list
```

Prints the URL where all registered registries can be explored.

---

## Registry Namespace Model

```
skills/<namespace>/<skill-name>.json
stacks/<namespace>/<stack-name>.json
```

Namespaces match GitHub usernames or organization names by convention. They become the prefix in install commands:

```
kenji/react-debug
anthropics/prompt-engineering
yourname/your-skill
```

### Namespace validation rules

- Must match: `/^[a-zA-Z0-9_-]+$/`
- No slashes, spaces, or special characters

---

## Vision

Kenji aims to become foundational infrastructure for:

- AI agent skill distribution
- Reusable development instruction sets
- Composable agent workflows
- Reproducible agent environments

---

## License

MIT
