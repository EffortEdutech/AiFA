# AiFA

AiFA is the AI Financial Assistant project.

Core promise: One Input. AI Does the Rest.

## Start Here

1. Read AGENTS.md.
2. Read docs/architecture/v2.0/Vol_0_0_Master_Documentation_Index.md.
3. Read docs/architecture/v2.0/Vol_0_1_MVP_Phased_Delivery_Roadmap.md before using architecture docs as build instructions.
4. Read app/README.md and app/package.json before changing app code.
5. If graphify-out/graph.json exists, query Graphify before inspecting files manually.

## Key Folders

- app/ - Expo React Native MVP app.
- docs/architecture/v2.0/ - canonical architecture documentation set.
- docs/sprint-plan/ - Phase 1 MVP sprint plan.
- docs/ideas/ - conversation and architecture source records.
- scripts/ - Graphify wrappers.
- graphify-out/ - generated Graphify output.

## Graphify

Build or refresh the configured graph from the central workspace:

```powershell
& "C:\Users\user\Documents\00 AI agent\setup\build_multi_project_graphs.ps1" -Only AiFA
```

Semantic extraction of Markdown docs may require an LLM API key in your shell, for example GEMINI_API_KEY.
