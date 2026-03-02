# Contributing to Animus

Thank you for your interest in contributing. The best place to start is the [Animus Discord](https://discord.gg/QCqKUJgGD6). Come say hello, ask questions, share what you're working on, and connect with others who are building alongside the project.

## A note on the project

Animus is a work in progress. It is moving quickly, and some parts of the documentation may be ahead of or behind the code. If something seems off, ask in Discord before spending time on it.

This project has a specific vision for what it wants to be. We welcome contributions and genuinely want people to get involved, but we also want to be upfront: pull requests that don't align with the project's direction may be declined, even if the code is good. This isn't a reflection on the quality of your work. It means the change doesn't fit where we're headed.

The best way to avoid surprises is to **talk to us first**. Open an issue or start a conversation in Discord before investing significant effort. We're happy to help you find the right approach or point you toward areas where contributions would be most impactful.

## Getting started

1. Fork the repository and clone your fork
2. Install dependencies: `npm install`
3. Copy the environment template: `cp .env.example .env`
4. Start the dev servers: `npm run dev`

See the [getting started guide](docs/guides/getting-started.md) for full setup details.

## Submitting changes

1. Make your changes on your fork
2. Run the checks before opening a PR:
   ```bash
   npm run typecheck    # TypeScript
   npm run lint         # ESLint
   npm run test:run     # Tests
   ```
3. Commit with a clear, concise message describing what changed and why
4. Open a pull request against `main`

## Code conventions

- **TypeScript strict mode** across all packages
- **Zod** for all external input validation
- **Backend logging** uses the structured logger (`createLogger` from `packages/backend/src/lib/logger.ts`), never raw `console.log`
- **Tests** are written with Vitest. New features should include test coverage.
- **Comments** only where the logic is not self-evident. No boilerplate docstrings.

See [CLAUDE.md](CLAUDE.md) for detailed project conventions, architecture patterns, and file locations.

## Architecture documentation

Before working on a feature or subsystem, read the relevant architecture docs in [`docs/`](docs/). The documentation describes the design decisions, patterns, and constraints that inform how the system is built. This is especially important for:

- The heartbeat pipeline and mind system
- Store/service patterns in the backend
- The memory system and context builder
- Channel and plugin architectures

## Reporting issues

Open an issue on GitHub with:
- A clear description of the problem or suggestion
- Steps to reproduce (for bugs)
- Your environment (OS, Node.js version)

Or bring it up in [Discord](https://discord.gg/QCqKUJgGD6).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
