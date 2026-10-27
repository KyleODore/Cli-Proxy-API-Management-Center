# Verification — prox integration

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
