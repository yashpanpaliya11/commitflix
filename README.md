# ◀ CommitFlix

**Press play on any commit.**

A zero-runtime-dependency npm CLI that turns local Git history into a playable timeline. Select a committed snapshot, run it in a disposable detached worktree, and compare versions without switching your original branch.

## Install

Requires **Node.js 22+** and **Git 2.31+**. After npm publication, install the package and try its built-in demo:

```sh
npx commitflix demo
```

To run directly from a source checkout:

```sh
node bin/commitflix.js demo
```

The demo creates four versions of a storefront in a temporary Git repository. It needs no dependencies. Select two commits, assign A and B, then click **Play both**. Ctrl+C in the terminal stops previews and removes demo worktrees.

To use your own project:

```sh
node bin/commitflix.js --repo /absolute/path/to/your/project
```

Or install the CLI locally from this folder:

```sh
npm install -g .
commitflix --repo /absolute/path/to/your/project
```

See the [separate demo project](https://github.com/yashpanpaliya11/commitflix-demo) for a repository that installs CommitFlix and hosts an interactive walkthrough of its sample commits.

## Features

- Local browser dashboard, dark interface, responsive layout, keyboard shortcuts.
- Paginated Git timeline; search messages and browse any local branch/tag.
- Preview commits, branches, tags, and the last commit before a date.
- Up to four concurrent disposable previews with individual ports and logs.
- A/B live comparison, desktop/mobile preview widths, and new-tab links.
- Code patches, file statistics, and standalone downloadable HTML reports.
- npm, pnpm, Yarn and Bun command selection from packageManager/lockfiles.
- Lockfile-aware installs; lifecycle scripts disabled by default.
- Next.js dev, Vite and Astro port arguments; generic scripts get PORT/HOST.
- Explicit environment-file copying, custom start scripts, nested app directory.
- Regression hunt using a package script and first-parent binary search.
- JSON output for CLI inspection and automation.
- Built-in four-commit demo with a deliberately broken final checkout button.
- Loopback-only dashboard, session-token protected API, Host/Origin checks.
- No telemetry, accounts, hosted backend, or runtime npm dependencies.

## Commands

```sh
commitflix
commitflix demo
commitflix play HEAD~3
commitflix compare v1.0.0 HEAD
commitflix --at 2026-01-15
commitflix log --search checkout --limit 50 --json
commitflix log --ref main
commitflix diff HEAD~3 HEAD
commitflix diff HEAD~3 HEAD --out comparison.html
commitflix doctor
commitflix hunt --good v1.0.0 --bad HEAD --check test
commitflix --help
```

`--at` accepts a date/time understood by JavaScript Date. A bare ISO date uses midnight UTC; the dashboard date picker uses the end of the chosen local day. Only HEAD history is searched for dates. Comparisons contain committed changes, not uncommitted source edits. Export refuses to overwrite an existing file.

### Project options

```sh
commitflix --repo ../my-app --app apps/web --script dev
commitflix --env-file /absolute/path/to/preview.env
commitflix --allow-install-scripts
commitflix --skip-install --no-open --port 4141
```

`--app` must resolve inside the historical checkout and contain a package.json. This supports standalone nested apps; a workspace-root installation and workspace filtering are not automatically orchestrated. If a monorepo app requires root workspace dependencies, use an appropriate root package script and leave `--app` at the root.

Package managers must already be installed. CommitFlix detects the manager, but does not install it or switch its version. It prints a historical Node engine requirement when present; it does not install an old Node runtime. Old lockfiles, removed registry packages, native modules, framework changes and unsupported tool versions may prevent historical apps from running. Errors appear in the console.

Dependency lifecycle scripts are disabled unless you pass `--allow-install-scripts`; some native or generated dependencies need this option. `--skip-install` is intended for dependency-free projects or custom scripts that do their own setup. Historical versions do not share the original node_modules. Installs may access package registries and use the package manager's normal global cache.

Next.js `next dev`, Vite and Astro scripts receive host/port flags when recognized. Generic scripts must honor `PORT` and ideally `HOST=127.0.0.1`. Hard-coded ports and multi-service stacks need project-specific configuration. Readiness accepts HTTP responses below 500 at `/`; this checks reachability, not functional correctness. An app returning 401/404 can still be inspected. Apps with frame-blocking headers must be opened through the new-tab link.

### Environment and isolation

Only run **trusted repositories and trusted historical commits**. Historical package scripts, config files, package-manager hooks and application code execute with your user's permissions. A Git worktree isolates checkout files; it is **not a security sandbox or container**. Git metadata is shared. The tool itself does not switch branches, stash, reset or modify your original working files, but executed code can access the host.

The process inherits your shell environment. Ignored `.env` files are not copied automatically. `--env-file` copies one explicitly chosen file as `.env.local` with owner-only permissions into each preview. Use development-only credentials. Generic apps must load that file themselves. Databases, queues, cloud resources and external APIs are **not** provisioned, snapshotted or isolated; configure per-preview resources in your app using `COMMITFLIX_ID`, `COMMITFLIX_SHA`, `COMMITFLIX_PORT` and `PORT`.

Preview directories are disposable: stopping a preview force-removes its worktree, including edits made there. Do not use previews as a place to keep new work. Logs can contain output from your app; no automatic secret redaction is promised.

### Regression hunting

```sh
commitflix hunt --good HEAD~10 --bad HEAD --check test --timeout 90
```

Runs your package's test/check script in fresh worktrees. Both endpoints are checked first. Exit 0 means pass; nonzero means fail; exit 125 or a signal stops as inconclusive. Missing scripts and failed installs stop rather than classifying the commit. It follows the bad commit's **first-parent** chain and assumes a single pass-to-fail transition. Flaky tests and regressions that are later fixed violate that assumption. External state is not isolated. `--env-file` applies to previews only, not hunt. Avoid scripts that launch persistent services.

### Cleanup

Stopping a preview or gracefully stopping the dashboard stops its process group and removes worktrees. SIGKILL, machine shutdown, or interrupting a hunt can leave temporary worktrees. Inspect `git worktree list`, then remove only the abandoned `commitflix-*` checkout you recognize with `git worktree remove --force /exact/checkout/path`. Never point that command at your source checkout. If a folder was already manually removed, `git worktree prune` clears stale metadata.

## Develop and package

```sh
npm test
npm run check
npm pack --dry-run
npm pack
```

There is no build step. Runtime uses Node built-ins. macOS was exercised during development; Windows command shims and process-tree cleanup are implemented but require Windows CI validation. Linux also needs validation before a stable release.

The first npm release is pending account login verification. Until then, use the source checkout commands above. Check the changelog for version changes.

## Next expansion

Potential follow-ups, **not implemented** in 0.1: container-backed runtime environments; database snapshots; automated screenshots and visual diffs; video/GIF history exports; remote PR previews; workspace orchestration; automatic historical Node switching; shareable hosted sessions. The current package focuses on a complete local preview/compare/hunt workflow.

## License

MIT. See LICENSE.
