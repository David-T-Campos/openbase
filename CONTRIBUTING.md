# Contributing to OpenBase

Thank you for contributing to OpenBase.

This project is a Node.js/pnpm monorepo with:

- `apps/api` for the Fastify API
- `apps/dashboard` for the Next.js dashboard
- `apps/sdk` for the JavaScript/TypeScript client
- `packages/core` and `packages/telegram` for shared infrastructure

## Prerequisites

Before working locally, install:

- Node.js 20+
- pnpm
- Redis, or access to a Redis-compatible service such as Upstash

Then install dependencies from the repo root:

```bash
pnpm install
```

## Local Development

### Mock mode

For most local development, run the API in mock Telegram mode.

Set the following in `apps/api/.env`:

```env
NODE_ENV=development
MOCK_TELEGRAM=true
SKIP_WARMUP=true
```

This gives you:

- in-memory Telegram storage via `MockStorageProvider`
- project creation without the Telegram OTP/session flow
- immediate `active` status for new projects

Start the workspace:

```bash
pnpm dev
```

## Quality Checks

Run the full test suite:

```bash
pnpm test
```

Run TypeScript checks across the workspace:

```bash
pnpm typecheck
```

Build every package and app:

```bash
pnpm build
```

## Branch Naming

Use short, descriptive branch names with one of these prefixes:

- `feature/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`
- `refactor/<short-description>`
- `chore/<short-description>`

Examples:

- `feature/mock-telegram-provider`
- `fix/query-engine-defaults`
- `docs/self-hosting-guide`

## Pull Request Guidelines

Please keep pull requests focused and reviewable.

- Make one logical change per PR.
- Include tests when behavior changes.
- Update documentation when the developer workflow, API, or SDK changes.
- Keep commit history clean enough to review.
- Do not mix unrelated refactors into feature or bug-fix PRs.

When opening a PR, include:

- what changed
- why it changed
- how you tested it
- any follow-up work or known limitations

## Code Style Notes

- Follow the existing TypeScript and project structure conventions.
- Prefer small, explicit changes over broad rewrites.
- Keep public API and SDK behavior consistent unless a breaking change is intentional.
- Avoid introducing new dependencies without a strong reason.
- If you add config, docs, or developer tooling, keep it accurate to the current repo layout.

## Questions

If you are unsure whether a change fits the project, open an issue first and describe the problem and proposed approach.
