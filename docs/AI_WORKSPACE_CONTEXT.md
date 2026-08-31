# AI Workspace Context - AiFA

This file is the local fallback bridge for Codex or Claude sessions that cannot access the central Obsidian vault.

## Central Obsidian Vault

```text
C:\Users\user\Documents\00 AI agent\AI-Knowledge
```

Use the live vault when accessible. If not accessible, this file is the local snapshot of relevant AI workspace context.

## Project Identity

AiFA is the AI Financial Assistant project.

Core promise: One Input. AI Does the Rest.

## Canonical Project Docs

Start with:

```text
docs\architecture\v2.0\Vol_0_0_Master_Documentation_Index.md
docs\architecture\v2.0\Vol_0_1_MVP_Phased_Delivery_Roadmap.md
```

The master index says Vol 0_1 must be read before treating any target architecture volume as a build instruction. Series 11 contains Phase 1 implementation foundation decisions.

## Current Implementation Folder

```text
app\
```

The app is an Expo React Native project. Read app/package.json before running commands.

## Graphify Workflow

When graphify-out/graph.json exists, query it before manually inspecting files.

Refresh from Windows with:

```powershell
& "C:\Users\user\Documents\00 AI agent\setup\build_multi_project_graphs.ps1" -Only AiFA
```

Configured graph scope:

- app/src
- app/backend
- app/pka
- docs/architecture/v2.0
- docs/sprint-plan
- docs/ideas

## Operating Rule

Project docs and source files remain the source of truth. Obsidian records rationale, ADRs, roadmap context, standards, research, and cross-project decisions.
