# AGENTS.md

## Project Identity

Project name: AiFA

AiFA is the AI Financial Assistant project. Core promise: One Input. AI Does the Rest.

Current shape:

- app/ contains the Expo React Native mobile application.
- packages/core/ contains \`@aifa/core\` (added Sprint 13, Phase 2): platform-agnostic business logic (data repositories, AI pipeline orchestration, the shared \`SqlDb\` adapter interface, pka/accounting_rules.json) shared between the mobile app and the future web app. This is a monorepo workspace (root package.json), wired into app/ via TypeScript paths, a Babel module-resolver alias, and a Jest moduleNameMapper — no build step required to consume it from app/.
- docs/architecture/v2.0/ contains the canonical Version 2.0 architecture documentation set.
- docs/sprint-plan/ contains Phase 1 MVP and Phase 2 Web & Sync sprint planning.
- docs/ideas/ contains conversation and architecture source records.
- graphify-out/ contains generated Graphify output.

This project is part of the Effort Studio AI development workspace.

Central Obsidian vault:

```text
C:\Users\user\Documents\00 AI agent\AI-Knowledge
```

If the central vault is outside the current sandbox, use this local fallback bridge:

```text
docs\AI_WORKSPACE_CONTEXT.md
```

## AI Assistant Operating Rules

Before making changes:

1. Read this AGENTS.md.
2. Read CLAUDE.md only if it adds relevant project-specific guidance.
3. Read docs/architecture/v2.0/Vol_0_0_Master_Documentation_Index.md.
4. Read docs/architecture/v2.0/Vol_0_1_MVP_Phased_Delivery_Roadmap.md before treating architecture docs as build instructions.
5. Read app/README.md and app/package.json before changing app code.
6. Query graphify-out/graph.json if it exists.
7. Inspect the relevant source or documentation files directly before editing.
8. Preserve the split between project docs and Obsidian knowledge.
9. Prefer small, reviewable changes.
10. Do not introduce new production dependencies without approval.
11. Do not print or commit secrets.
12. Update docs when behavior, commands, architecture, schemas, or operating rules change.

## Graphify Rules

Use Graphify for navigation and relationship discovery when graphify-out/graph.json exists.

```powershell
.\scripts\graphify.ps1 query "question" --graph "graphify-out\graph.json"
.\scripts\graphify.ps1 explain "concept-or-file" --graph "graphify-out\graph.json"
.\scripts\graphify.ps1 path "A" "B" --graph "graphify-out\graph.json"
```

Refresh the configured project graph from the central workspace:

```powershell
& "C:\Users\user\Documents\00 AI agent\setup\build_multi_project_graphs.ps1" -Only AiFA
```

Linux/macOS or Claude sandbox wrapper:

```bash
./scripts/graphify.sh --version
```

The `.ps1` wrapper forwards to the central Windows Graphify setup. The `.sh` wrapper installs and runs the PyPI package `graphifyy` on demand.

Semantic extraction of Markdown architecture docs may require an LLM API key such as GEMINI_API_KEY in the shell environment.

Configured Graphify scope:

- app/src
- app/backend
- app/pka
- packages/core/src
- packages/core/pka
- docs/architecture/v2.0
- docs/sprint-plan
- docs/ideas

## Obsidian Rules

Use Obsidian for architecture rationale, ADRs, cross-project standards, roadmap context, meeting notes, and research.

Do not use Obsidian as a replacement for AiFA project docs or source files. The canonical project docs remain under docs/.

## Commands

Run from app/ unless a task says otherwise:

```powershell
npm run start
npm run android
npm run ios
npm run web
npm run lint
npm run typecheck
```

Run only the checks relevant to the change.

## Done Criteria

A task is complete when:

- requested changes are implemented,
- relevant checks were run or blockers are explained,
- docs are updated if needed,
- Graphify is refreshed after meaningful structural changes when possible,
- the final response explains what changed and how it was verified.
