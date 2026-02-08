# Contributing References

This rule points to documentation that contains important behavioral guidance for working on Actual Budget. These docs are not symlinked directly because they are reference material rather than standalone directive rules.

## Development Setup

See `packages/docs/docs/contributing/development-setup.md`.

- Always run commands from the project root
- Use `yarn workspace <name> run <command>` for workspace-specific tasks
- Node.js >= 22 and Yarn ^4.9.1 are required

## Troubleshooting

See `packages/docs/docs/contributing/troubleshooting.md`.

- Consult this doc for common build, test, and dependency resolution issues before debugging manually

## Architecture & Project Structure

See `packages/docs/docs/contributing/project-details/architecture.md` and `packages/docs/docs/contributing/project-details/index.md`.

- The web app runs a background server in a web worker; the Electron app uses a Node.js child process over WebSockets
- Core shared logic lives in `loot-core`; platform-specific code uses conditional exports resolved at build time
- Don't directly reference `.api`, `.web`, or `.electron` imports -- use the `loot-core` package exports

## Database

See `packages/docs/docs/contributing/project-details/database.md`.

- SQLite is the local data store, created from `loot-core/default-db.sqlite` and updated via migrations
- View names prefixed with `v_` are recreated on each app start and should not be confused with tables
- Key database logic is in `loot-core/src/server/db`

## Electron

See `packages/docs/docs/contributing/project-details/electron.md` and `packages/docs/docs/contributing/project-details/advice.md`.

- Most contributions do not require Electron-specific changes
- Changes to `global.Actual` must happen inside preload scripts (Electron siloes this object for security)
- Manually test `global.Actual` changes on both Electron and browser builds

## Design Philosophy

The goal of Actual's UI is to be **minimalistic and clutter-free**:

- Expose advanced features progressively as the user interacts (e.g., notes button appears only when notes exist)
- Do not add settings or toggles for minor UI variations (sizes, paddings, margins)
- The settings screen is for core settings only -- avoid a proliferation of niche options
- Feature flags must not be used as configuration toggles for small behavioral differences

## Release Notes

Before creating a pull request, run `yarn generate:release-notes`. This creates a Markdown file in `upcoming-release-notes/` with the following format:

```markdown
---
category: Features
authors: [YourGitHubUsername]
---

Add option to include exchange rate multiplier during import
```

Valid categories: `Features`, `Enhancements`, `Bugfix`, `Maintenance`. Phrase summaries as commands ("Add..." not "Added...").

## Writing Documentation

See `packages/docs/docs/contributing/writing-docs.md`.

- Consult this guide when adding or updating documentation in `packages/docs/`
