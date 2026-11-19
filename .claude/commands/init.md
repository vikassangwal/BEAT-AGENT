---
description: Analyze current workspace, detect architecture, frameworks, and generate or update CLAUDE.md
---

You are an expert software architect and systems engineer. Your objective is to thoroughly inspect the current project repository, understand its entire setup, architecture, and developer workflows, and create or update a comprehensive, high-density `CLAUDE.md` in the project root.

Execute the following steps methodically:

### Phase 1: Deep Repository Reconnaissance
Examine the workspace using file-listing, ripgrep/grep, and inspection tools:
1. **Directory Structure & Layout**:
   - Identify main source roots, configuration files, test suites, assets, and build outputs.
   - Determine repository type: Monorepo (pnpm/turborepo/lerna/nx/cargo workspace) or Single-package.
2. **Tech Stack & Tooling**:
   - Check dependency manifests: `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, etc.
   - Detect runtime versions, core frameworks (e.g., Next.js, FastAPI, Spring Boot, React), UI component libraries, ORMs, and database systems.
3. **Developer Workflows & Exact Commands**:
   - Find exact commands for:
     - Dependency installation
     - Local development server / watcher
     - Build / compilation
     - Type-checking / schema generation
     - Linting & code formatting
     - Test execution (all tests, unit tests, integration/e2e, single file test)
4. **Code Conventions & Architecture**:
   - Linter/formatter configs (`.eslintrc*`, `biome.json`, `prettier`, `ruff.toml`, `.editorconfig`).
   - Coding patterns (Clean Architecture, Feature-first, MVC, Serverless, etc.).
   - File & variable naming conventions (kebab-case, camelCase, PascalCase).
   - Error handling, logging, state management, and API design patterns.

---

### Phase 2: Create or Update `CLAUDE.md`
Generate or update the `CLAUDE.md` file in the root of the workspace. Ensure the instructions are compact, concrete, and directly usable by AI assistants. Replace all bracketed descriptions with real project specifics:

```markdown
# Project Overview
- **Name / Purpose**: <Concise 1-2 sentence description of what the project does>
- **Stack**: <Key languages, frameworks, runtime versions, databases>
- **Architecture**: <Monorepo/Modular/MVC/Clean, key patterns>

## Essential Commands
- **Install**: `<command>`
- **Dev**: `<command>`
- **Build**: `<command>`
- **Typecheck**: `<command>`
- **Lint**: `<command>`
- **Format**: `<command>`
- **Test (All)**: `<command>`
- **Test (Single File)**: `<command example>`

## Key Directory Structure
- `<core_dir>/`: <purpose and responsibility>
- `<components_or_services>/`: <purpose and responsibility>
- `<tests_dir>/`: <test layout>

## Code Conventions & Standards
- **Naming**: <conventions for files, components, functions, variables>
- **Type Safety**: <strict typing rules, schema validation libraries>
- **State & Data**: <state management, data fetching, ORM/DB patterns>
- **Error Handling**: <how errors should be handled, logged, and returned>

## Critical Constraints & Guidelines
- <Important environment variables (.env / .env.example)>
- <Strict rules: things Claude should never do or modify without explicit permission>
- <Known pitfalls, quirks, or legacy considerations>
```

---

### Phase 3: Validation & Summary Report
1. Verify that `CLAUDE.md` is saved successfully in the root directory.
2. Present a clean, structured summary to the user:
   - **Detected Stack**: Core languages and frameworks.
   - **Available Commands**: Dev, build, lint, and test commands found.
   - **CLAUDE.md Status**: Created or updated successfully.
   - **Observations**: Highlight any missing items (e.g., missing `.env`, missing lockfile, outdated dependencies).
