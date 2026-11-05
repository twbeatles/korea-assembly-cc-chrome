# Repository instructions

## CodeGraph

When `.codegraph/` exists, use CodeGraph MCP or `codegraph explore` before ordinary code search or file reads. Use direct reads only for missing details, documents, and configuration. Do not create an index automatically.

## Git workflow

Unless explicitly instructed otherwise, work on `main` without creating a branch or worktree, and push completed changes to `main`.

## Skill preferences

- Do not use any `claude-mem:*` skill unless explicitly requested.
- Do not use any `speckit-*` skill or Spec Kit workflow unless explicitly requested. Continue ordinary implementation directly when no such request is made.
