# CLAUDE.md

See AGENTS.md first.

## Claude Code Specific Instructions

Use Claude Code primarily for planning, architecture review, refactor strategy, risk analysis, code review, and documentation review.

Before broad edits:

1. Read AGENTS.md.
2. Query or inspect graphify-out/graph.json if available.
3. Read docs/architecture/v2.0/Vol_0_0_Master_Documentation_Index.md.
4. Read docs/architecture/v2.0/Vol_0_1_MVP_Phased_Delivery_Roadmap.md before treating architecture docs as build instructions.
5. Explain the plan before structural changes.
6. Do not edit the same files Codex is actively editing.

## Graphify Refresh (Any OS)

Windows:

```powershell
& "C:\Users\user\Documents\00 AI agent\setup\build_multi_project_graphs.ps1" -Only AiFA
```

Linux/macOS or Claude sandbox:

```bash
./scripts/graphify.sh --version
```

If the sandbox cannot run the Windows PowerShell wrapper, use scripts/graphify.sh or run the underlying `graphify` command directly after installing the PyPI package `graphifyy`.
