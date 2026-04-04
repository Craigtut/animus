# @animus-labs/cortex

Production-grade agent infrastructure built on top of `@mariozechner/pi-agent-core`.

It provides:
- `CortexAgent` for the agentic loop and lifecycle
- `ProviderManager` for provider discovery, auth, and model resolution
- Built-in tools for filesystem, shell, search, web fetch, and sub-agents
- Context management, compaction, working tags, and event normalization

## Requirements

- Node.js 24+

## Install

```bash
npm install @animus-labs/cortex
```

If you use `zodToTypebox()`, install `zod` in the consumer as well.

## Development Notes

- Default imports resolve to `dist/`
- A `source` export is available for workflows that run with `--conditions source`

## Main Exports

- `CortexAgent`
- `ProviderManager`
- `ContextManager`
- `EventBridge`
- `BudgetGuard`
- Built-in tool factories from `tools/index`

## Status

This package is developed alongside Animus and is being prepared for standalone use.
