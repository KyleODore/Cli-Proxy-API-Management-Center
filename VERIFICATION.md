# Verification — prox integration

## Management Center track — Task 4 (Windows, 2026-10-28)

Runtime observed on Windows x64: Node **24.21.0** and Bun **1.4.3**, invoked with `npx --yes bun@1.4.3`. No dependency or lockfile changes were made.

### Commands and observed results

- Focused verification used `npx --yes bun@1.4.3 test tests/quotaSignals.test.ts tests/routingApi.test.ts tests/routingStatusView.test.ts tests/visualConfigRoutingStrategy.test.ts tests/cacheUsageQueue.test.ts tests/cacheCollector.test.ts tests/cacheHistory.test.ts tests/cacheModel.test.ts tests/cachePage.test.ts`: **40 passed, 0 failed**, 136 assertions across nine files.
- Full `npx --yes bun@1.4.3 run verify` stopped at the test phase with **1,739 passed and five failed** (1,744 tests across 179 files; 19,611 assertions). The five known unrelated baseline failures were:
  - `logs controller lifecycle wiring > invalidates synchronously on connection identity/config changes and unmount` — a source-contract `toContain` assertion did not match.
  - `provider probe proxy forwarding > base and sponsor forms pass their editable proxy to probe hooks` — a source-contract `toContain` assertion did not match.
  - `prox upgrade transactional installer > uses exact MANAGEMENT_STATIC_PATH file overrides` — `ENOENT` reading the expected override HTML.
  - `prox upgrade transactional installer > uses MANAGEMENT_STATIC_PATH directory overrides` — `ENOENT` reading the expected override HTML.
  - `prox upgrade transactional installer > uses WRITABLE_PATH as the backend does` — `ENOENT` reading the expected override HTML.
- Because `verify` chains commands with `&&`, that failing command did not run lint or build. Running them separately with the pinned runtime succeeded: `npx --yes bun@1.4.3 --bun run lint` exited zero without warnings/errors, and `npx --yes bun@1.4.3 --bun run build` completed TypeScript, Vite and packaging. The build printed two `The system cannot find the path specified.` messages before Vite output; their origin was not diagnosed, but the command exited zero and generated the package.
- `git diff --check` passed after the documentation updates.
- Source searches found the endpoint literal `/observability/usage/queue` only in `src/services/api/usageQueue.ts`. The brief's `usageQueueApi.pop` search returned no matches because the implementation exports and imports named `popUsageQueue`; its only production consumer is `src/features/cache/useCacheCollector.ts`. The collector polls every five seconds with `count=100`, shares one in-flight request, and aborts/suppresses stale work on stop or connection revision change. Focused collector and adapter tests passed.
- Browser-local cache history retains 17 days, keeps 30-second buckets for six hours, and compacts older data to five-minute buckets. Its storage key is derived with SHA-256 from the connection and principal; focused history tests confirmed pruning, compaction, scoped persistence and sanitized round trips.
- The production build produced a 3,379,982-byte `dist/management.html` with two inline script tags, no external script assets and no external stylesheet links. Its SHA-256 was `a4ac5cef401a1cc8165c997e5c10d9ca970fc473f88150a445cdfec8f17a1870`, exactly matching `dist/SHA256SUMS`. `dist/` is ignored and was not committed.

### Explicitly unverified in this pass

No browser or demo was run, no screenshots were captured, and no live CLIProxyAPI backend, real provider integration, real credential or live destructive queue consumption was exercised. Those behaviors remain unverified in this pass; static markup and source-contract tests do not establish browser interactions or live backend compatibility. The five baseline failures mean the complete verification command was not green even though the focused suites, standalone lint, build and artifact checks passed.

## Earlier Linux verification

Verified on Linux, 2026-10-27. The final production artifact is built from this source; no live CLIProxyAPI service or real credential was modified.

## Automated checks

- Baseline upstream: `bun test` — **1,662 passed, zero failures** before changes.
- Final `bun run verify` — **1,702 tests passed across 170 files**, zero failures; ESLint completed without warnings/errors; TypeScript and the Vite production build succeeded.
- Forty added tests cover event-driven projection, normalization, historical burn, history persistence and upgrade behavior. The existing search-focus source contract was adjusted to tolerate indentation after moving search into Accounts.
- Mathematical checks include exact zero crossings, simultaneous resets, partial effective gains, weekly recurrence, suppression of invented repeated five-hour resets, cooldown expiry, disabled/unknown accounts, Pro Max weighting, varied scenario bounds, reset-aware rates, offline gaps and bounded history retention.
- Persistence checks include codec round trips, malformed data, hashed membership identities, and a seventeen-day/eight-provider storage-size case below two million characters. The browser demonstration retained 1,513 samples per provider in approximately 110 KB using tuple encoding.
- Installer fixtures cover valid backup/install, active-user-service restart, restart-failure rollback, invalid/failed downloads, exact-file/directory static overrides, WRITABLE_PATH, preservation of inline config comments, ambiguous/duplicate YAML rejection, SHA-256 validation and absence of an active systemd service.
- A separate smoke test installed the **actual compiled management.html** into a temporary fake install. HTML matched byte-for-byte; backups matched; a private `0600` config kept its mode.
- Artifact checks confirmed no external script/stylesheet entry dependencies and a matching SHA-256 checksum. `git diff --check` passed.

Runtime used here: Bun **1.3.14**, Node **22.23.2**. The repository/CI pins Bun 1.4.3 and Node 24; those exact runtime versions were not installed in this environment. No dependency or lockfile changes were needed.

## Browser verification

The production-bundled panel was served by `scripts/demo.ts` on loopback, using authenticated synthetic management/provider responses. Production authentication was exercised normally with the explicitly local fixture key. The final browser pass recorded **zero page JavaScript errors**.

Checked:

- Default two-provider pool view, Claude-only and Codex-only provider filters.
- Preserved four overview cards, On the horizon and Capacity outlook widgets.
- Solid recorded trace with three days of fixture history; dashed macro projection and exact capacity Y limits: Claude 0/300/600, Codex 0/225/450.
- Pro Max 2.5× badge, actual-gain reset pills, Now line/anchor, and a visible Codex empty marker before its full reset.
- Remaining/Drain rate/Burn rate, 1h/3h/6h, Future usage selection, date navigation and Today.
- Keyboard arrow inspection and a projected tooltip.
- Accounts toggle, nine individual refresh actions, a successful local refresh, credential search/clear with focus restoration, and email visibility toggles.
- A 390-pixel mobile viewport had document scroll width **390 pixels**, with the wide chart scroll contained inside its card.
- Dashboard, Auth Files, OAuth Login, Logs and Config all had the intended `rgb(9, 10, 15)` background. Config source-editor gutters used `rgb(13, 17, 23)`.

Preview PNGs are supplied separately in the outputs directory. They show **synthetic demonstration data**, not a live account fleet.

## Limits of verification

Real provider OAuth traffic, a real systemd service restart, native macOS execution, a production Tailscale/TLS endpoint were not tested. The installer was tested with controlled service/download fixtures and a real compiled HTML asset. The script's no-systemd path uses portable Bash/macOS utilities, but it has not been run on a native Mac.

The projection's calendar/session assumptions and normalized-point limitations are explained in the UI and README-prox.md. A screenshot cannot establish actual future session starts or backend routing decisions. The source includes a release workflow that packages all required assets automatically. Fork/release publication is documented in README-prox.md.

## Published fork verification

Both full forks were created under `mikedoesgithub`; GitHub reports admin/push access. Local repositories are no longer shallow, retain all upstream branches/tags, use `origin` for the owned fork and `upstream` for router-for-me, and track `origin/main`. The backend fork changes only management-panel defaults, contribution policies and fork documentation. Its updater/config tests and server build passed.

The public WebUI release is `v1.0.0-prox.1`: https://github.com/mikedoesgithub/Cli-Proxy-API-Management-Center/releases/tag/v1.0.0-prox.1 . GitHub's asset digest matches local SHA-256 `77ff7c4af1c80f93383314adb658fbcb96335812d9e341ab7dfb41ee1b81c22b`. The raw main installer was downloaded and run in a temporary installation, fetching the published asset over HTTPS. Asset checksum, HTML/config backups, config mode 0600, updater-disable setting and preservation of an auth fixture were verified. No real service or installed config was touched.

The checked first release was uploaded with GitHub CLI. CI/release workflows are enabled; GitHub-hosted execution was not verified for this first release.

## Upstream-sync workflow verification

Both forks now contain a scheduled/manual upstream-sync workflow. Six local-Git fixture tests passed in each repository, Bash syntax passed and actionlint 1.7.7 accepted both workflow definitions. The frontend `bun run verify` again passed all 1,702 tests, lint and production build; the backend server build passed. Initial GitHub-hosted sync runs completed successfully and confirmed both forks already include upstream main. The post-merge validation jobs were skipped because no upstream change needed merging. Clean merge and conflict behavior were exercised against isolated local remotes; no synthetic test commits were pushed to production main.
