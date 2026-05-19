# Kenji Protocol

**Kenji** is a CLI for installing and managing AI agent instruction sets (skills) and collections of skills (stacks).

Instead of copying prompts, rules, or skill files across projects, Kenji lets you install structured agent capabilities directly into your project with a single command.

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
- `kenji.json` metadata

Skills are installed inside your project (or globally) so agentic IDEs and AI tools can reference them during development.

---

## Directory Structure

Each installed skill gets its own folder inside a namespace folder named after its source repo. This prevents collisions when multiple skills come from the same repository.

### Project install *(default)*

```
.kenji/
  skills/
    <repo-slug>/
      <skill-slug>/
        SKILL.md
        kenji.json   ← install metadata
```

**Example:**

```
.kenji/
  skills/
    anthropics-skills/
      mcp-builder/
        SKILL.md
        kenji.json
      design-algorithmic-art/
        SKILL.md
        kenji.json
    someuser-kenji-registry/
      agents-prompt/
        Agents.md
        kenji.json
```

### Global install

```
~/.kenji/
  skills/
    <repo-slug>/
      <skill-slug>/
        SKILL.md
        kenji.json
  stacks/
    <stack-name>.json
```

The repo slug is derived from the source repo as `<owner>-<repo>`. The skill slug is derived from the registry skill name, or the folder name containing the skill file.

---

## Registry

Kenji has a multi-registry architecture backed by the official Kenji registry and optional community registries:

[https://kenjiprotocol.com/registry](https://kenjiprotocol.com/registry)

Registry data is indexed into Vercel KV when a registry is added or updated. Search results are served directly from this index — no runtime GitHub crawling occurs. Community registry data persists independently; it is never affected by official registry updates or cache rebuilds.

- No proprietary database
- Completely open protocol
- Community GitHub repositories can act as additional registries

### Update timing

| Event | Search results |
|---|---|
| `kenji registry add user/repo` | **Immediate** — crawled and indexed on submission |
| `kenji registry update user/repo` | **Immediate** — re-crawled and re-indexed on command |
| Edit to an existing `skill.json` in your repo | **After running** `kenji registry update user/repo` |
| Official registry changes | **Within 6 hours** — automatic cron refresh |

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
kenji install anthropics/skills
```

Kenji fetches the full repository tree in a single API call and automatically discovers all skills (any `.md` file that isn't a README). If more than one skill is found, a preview is shown and confirmation is requested before installing:

```
Discovered 3 skills in anthropics/skills:

  anthropics-skills/mcp-builder
  anthropics-skills/design-algorithmic-art
  anthropics-skills/prompt-engineering

Install all 3 skills? (Y/n)
```

If only one skill is found, it installs immediately without a prompt.

Each discovered skill is installed into its own `<repo-slug>/<skill-slug>/` folder.

**From GitHub folder (tree URL):**
```bash
kenji install https://github.com/user/repo/tree/main/skills/debug
```

Installs only the files inside that specific folder as a single skill.

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

---

### `kenji list`

List installed skills. Output shows `<repo-slug>/<skill-slug>` for each installed skill.

```bash
kenji list              # Project skills in ./.kenji/skills/
kenji list --global     # Global skills in ~/.kenji/skills/
```

**Example output:**
```
Local skills (current folder):

  anthropics-skills/mcp-builder
  anthropics-skills/design-algorithmic-art
  revanthjanumula-kenji-registry/agents-prompt
```

---

### `kenji remove`

Remove an installed skill. If the skill name matches more than one installed skill, Kenji shows all matches and asks you to specify the full path.

```bash
kenji remove <skill>             # Remove from current project
kenji remove <skill> --global    # Remove from global install

# Disambiguate when multiple repos have a skill with the same name:
kenji remove anthropics-skills/mcp-builder
```

After removal, the parent repo-slug folder is cleaned up automatically if it becomes empty.

---

### `kenji where`

Show where a skill is installed and how it was installed.

```bash
kenji where <skill>
kenji where <skill> --json
kenji where <skill> --verbose

# Disambiguate:
kenji where anthropics-skills/mcp-builder
```

Checks the local project first, then global. Displays scope, path (`<repo-slug>/<skill-slug>`), install source, and install type.

**Flags:**

| Flag | Description |
|---|---|
| `--json` | Output as JSON |
| `--verbose` | Show full metadata from `kenji.json` |

---

### `kenji use`

Copy a globally installed skill into the current project, preserving the `<repo-slug>/<skill-slug>` folder structure.

```bash
kenji use <skill>
kenji use <skill> --force

# Disambiguate:
kenji use anthropics-skills/mcp-builder
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

## Skill `kenji.json` Metadata

Every installed skill contains a `kenji.json` file with metadata about the install:

```json
{
  "name": "mcp-builder",
  "repo": "anthropics/skills",
  "source": "github.com/anthropics/skills#skills/mcp-builder",
  "install_type": "registry",
  "scope": "local",
  "installed_at": "2026-05-14T...",
  "skillPath": "anthropics-skills/mcp-builder"
}
```

| Field | Description |
|---|---|
| `name` | Skill slug |
| `repo` | Source GitHub repo |
| `source` | Full source reference |
| `install_type` | `registry`, `github`, `github-tree`, or `raw` |
| `scope` | `local` or `global` |
| `installed_at` | ISO timestamp |
| `skillPath` | `<repo-slug>/<skill-slug>` — the install path relative to the skills directory |

---

## Ambiguous Skill Names

If two different repos both contain a skill with the same name, commands like `remove`, `where`, `use`, and `stack add` will detect the ambiguity and show all matches:

```
Multiple installed skills match "mcp-builder":

  - anthropics-skills/mcp-builder
  - openai-skills/mcp-builder

Specify the full path:
  kenji remove anthropics-skills/mcp-builder
```

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
- `global` entries → copied from `~/.kenji/skills/` into `.kenji/skills/`, preserving the `<repo-slug>/<skill-slug>` structure

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
    { "type": "global",   "value": "my-skill-slug" }
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
| `"global"` | Skill slug | A locally installed global skill |

---

## Managing Registries

### `kenji registry add`

Add a community GitHub repository as a registry. Kenji crawls the repo immediately and indexes all valid skills and stacks into the search index.

```bash
kenji registry add user/kenji-registry
kenji registry add https://github.com/user/kenji-registry
```

The repo must contain at least one valid `skills/` or `stacks/` folder with conforming JSON files. Duplicate submissions are ignored.

### `kenji registry update`

Re-crawl a registered registry and refresh its index. Use this after updating your skill JSON files.

```bash
kenji registry update user/kenji-registry
```

Only that registry's index is updated. Other registries are not affected. If the crawl fails, the existing index is left intact.

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
