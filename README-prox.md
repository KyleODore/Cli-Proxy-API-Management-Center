# prox Quota Management — integrated CLIProxyAPI WebUI

This is a fork of the real CLIProxyAPI Management Center, with a pooled Quota page and a shared obsidian dark theme. Dashboard, Providers, Auth Files, OAuth, Logs, Config and the existing credential quota actions remain available. Hash routing, the authenticated API client, remember-password behavior and connection-generation guards are retained.

## Use the packaged panel

The ready-to-serve artifact is **`dist/management.html`**. It contains the application JavaScript, CSS, provider icons and logo. No frontend server, CDN or companion asset directory is required in production. Serve it through CLIProxyAPI's existing `/management.html` route.

A release bundle contains `management.html`, `upgrade.sh` and `SHA256SUMS`. From that extracted directory, upgrade an existing install with one command:

```bash
bash upgrade.sh --asset-file management.html
```

The installer chooses an active systemd user service's working directory, then `~/cliproxyapi`, then `~/.cli-proxy-api`. It accepts these overrides:

```bash
PROX_INSTALL_DIR=/path/to/cliproxyapi PROX_CONFIG=/path/to/config.yaml bash upgrade.sh --asset-file management.html
```

It backs up the current asset as `management.html.bak`, validates the replacement, stages both files on their respective filesystems, and installs atomically. Config is backed up as `config.yaml.prox.bak`. Only `management.disable-auto-update-panel` is set to `true` so the upstream updater cannot replace prox on startup or during its periodic checks. The installer also recognizes the older `remote-management` section for existing installations; this does not add legacy API support to the frontend. Other config lines and the credential directory are preserved. An unsupported/ambiguous YAML layout stops the upgrade before changing live files. Config symlinks require an explicit resolved `PROX_CONFIG`.

`MANAGEMENT_STATIC_PATH` (directory or `management.html` file) and `WRITABLE_PATH` are honored. If a running systemd service sets these variables, export the same values to the installer. Set `PROX_CONFIG` when the service's `--config` argument points outside its working directory. Do not assume a service-specific environment is inherited by an interactive shell.

An active `systemctl --user` service named `cliproxyapi` is restarted and checked; set `PROX_SERVICE` for another name. A failed restart rolls the HTML and config back. macOS and environments without an active systemd user service install the files without invoking systemctl restart. Reload the panel; restart a manually managed backend if its configuration watcher is disabled. The script does not change backend binaries, auth tokens, access keys, network binding, TLS or remote-access policy.

The confirmation prints both the default local URL and `https://<tailscale-ip>:8317/management.html`. The latter requires the backend to already have TLS configured; Tailscale addressing alone does not enable HTTPS on port 8317.

## Remote one-command upgrades

Published source: [mikedoesgithub/Cli-Proxy-API-Management-Center](https://github.com/mikedoesgithub/Cli-Proxy-API-Management-Center). Backend fork: [mikedoesgithub/CLIProxyAPI](https://github.com/mikedoesgithub/CLIProxyAPI).

Upgrade an existing CLIProxyAPI installation:

```bash
curl -fsSL https://raw.githubusercontent.com/mikedoesgithub/Cli-Proxy-API-Management-Center/main/upgrade.sh | bash
```

The installer downloads `management.html` from this fork's latest release. To pin an asset, set `PROX_ASSET_URL` to its HTTPS URL. Optional `PROX_SHA256` enforces an expected SHA-256 before installation. `PROX_REPOSITORY` overrides the release repository.

The `v*` GitHub Actions release workflow builds and publishes `management.html`, `upgrade.sh`, and `SHA256SUMS`. The release copy of the installer embeds `GITHUB_REPOSITORY`, allowing downstream forks to publish independently.

Both repositories preserve upstream history and branches. Local `origin` points at your fork and `upstream` points at router-for-me. Fetch upstream changes explicitly and merge them on a working branch; do not reset your fork's main branch to upstream. The frontend's full verification command is `bun run verify`.

## Develop and preview without a live hub

Use the repository's pinned Bun version (1.4.3) and Node 24 for CI parity:

```bash
bun install --frozen-lockfile
bun run dev
bun run verify
bun run build
```

The Vite configuration uses `vite-plugin-singlefile`, disables CSS and JS splitting, and inlines bundled assets. `scripts/package.mjs` generates `dist/management.html`, the installer and its checksum after Vite finishes. `dist/index.html` is retained for normal Vite preview. Do not edit either generated HTML file.

Run a self-contained, read-only local demonstration:

```bash
bun run demo
```

Open `http://127.0.0.1:8318/management.html`, enter management key **`prox-demo`**, log in, and select **Quota Management**. Set `PROX_DEMO_PORT=8328` if 8318 is occupied. The local fixture hub serves the built panel, supplies synthetic Claude/Codex quota and seeds illustrative history. A visible `LOCAL DEMO · SYNTHETIC DATA` badge distinguishes it. It never forwards provider requests, and rejects config/auth mutations. This fixture service is separate from the production asset; it does not bypass or change production authentication. The previously supplied standalone dashboard remains a separate deliverable.

## API compatibility

The integration targets the inspected current upstream v8 contract. The actual credential listing is **`GET /v8/management/credentials`** with the existing bearer-authenticated `apiClient`; provider quota refresh uses the existing `/v8/management/requests/api-call` adapters. The initial specification's `/v0/management/auth-files` is not the current v8 route. No legacy data fallback was added. Optional passive Claude/Codex `quota.signals` are normalized at the API boundary when a compatible credential scanner supplies them.

Source provenance:

- Management Center: `router-for-me/Cli-Proxy-API-Management-Center`, base `64b4f5aed19b8f791eb21eb9e785ea379ea05b44`.
- Backend contract inspected: `router-for-me/CLIProxyAPI`, `1f917e77c4562623aa49e9804d999524151a2f96`.
- The current backend's configuration section is `management`, as confirmed in its `config.example.yaml` and updater. The backend fork changes panel-update defaults to this prox frontend; explicit existing config values still take precedence.

## Projection model and units

The pure functions are in `src/features/quota/pool/model.ts`; normalization is in `normalize.ts`. UI composition and rendering are in `PooledOverview.tsx` and `ProjectionChart.tsx`. Existing per-credential cards stay in `components/QuotaCard.tsx`.

An ordinary account contributes 100 normalized capacity points. Codex plans explicitly identified as Pro Max contribute 250, so two ordinary accounts plus one Pro Max account produce the reference's 450-point pool. This weighting is a product convention, not a verified token-equivalence multiplier. Effective account availability is the minimum remaining budget across its account-level windows. Disabled credentials contribute nothing; a credential-wide cooldown blocks availability until its expiry. Model-scoped cooldowns do not exhaust an entire account. Missing measurements remain unknown and suppress depletion forecasts.

The event-driven simulation drains available accounts in earliest-reset order. It spends the same normalized points across each account's applicable windows. Between events, the slope is exactly `-burnPointsPerHour`; when the pool reaches zero, the crossing timestamp is calculated analytically, and the line stays at zero until recovery. At a reset, only the actual restored effective capacity is added. Simultaneous resets are processed atomically. This yields partial boosts and exact vertical step-ups, without time-grid artifacts or artificial curve smoothing.

There is an unavoidable forecasting assumption: **the next five-hour rolling reset does not determine the start of every future session**. Only the next reported short-window reset is scheduled. Calendar windows recur at their reported duration; at a calendar renewal, shorter sessions whose known deadline has passed are assumed available. This macro scenario avoids falsely issuing 67 new full grants every fortnight. Five-hour and seven-day percentages also represent different real-world token budgets, so their normalized-point approximation is explicitly disclosed in the UI. It is a scenario projection, not a reconstruction of the backend router or a guaranteed future quota schedule. Other providers use a conservative all-model envelope; use Accounts for independent model details.

`Remaining` plots points; `Burn rate` plots points/hour; `Drain rate` plots pool-normalized percent/hour. The default viewport spans three historical days and eleven future days. Today and week navigation use local calendar dates, including DST. Depletion KPIs always evaluate at least 14 days forward. Remaining charts use exactly three Y guides: zero, half the pool capacity and full capacity. Annotation labels suppress collisions without moving reset timestamps or omitting reset geometry; hover/keyboard inspection still exposes events.

History is sampled on successful observations every 30 seconds while the Quota page is open. It is scoped to server and management principal using a SHA-256-derived storage key. Recent six-hour data keeps 30-second resolution; older data is compacted to five-minute buckets and retained for 17 days. No management key, credential filename or raw credential payload is stored in history. Membership signatures are SHA-256 hashes; compact tuple encoding stores each distinct signature only once. The existing remember-password preference still controls management-key persistence. Storage failure falls back to in-memory history with a visible notice.

Burn uses the selected 1h/3h/6h history. Endpoint loss divided by elapsed hours is used for contiguous reset-free data. Reset-crossing segments, changed account membership and gaps longer than ten minutes are excluded from the fallback segment estimate. An unmeasured pool displays `Collecting history`, rather than treating a missing rate as a verified zero. Changing Future usage affects projections, not measured historical burn.

## Roll back

Restore the `.bak` HTML and `.prox.bak` config, then restart the same service if applicable. Both backups represent the installation immediately preceding the most recent upgrade. Restoring the old config may re-enable the upstream panel updater.

## Verification

See `VERIFICATION.md` for commands, test totals, browser coverage and limitations. No production CLIProxyAPI instance was modified and no real provider credential was used during development.

## Automatic upstream sync

[Sync upstream](https://github.com/mikedoesgithub/Cli-Proxy-API-Management-Center/actions/workflows/sync-upstream.yml) checks upstream `main` every 15 minutes, offset from the hour. GitHub schedules can be delayed. It also supports Actions → Sync upstream → Run workflow, or:

```bash
gh workflow run sync-upstream.yml -R mikedoesgithub/Cli-Proxy-API-Management-Center -f merge=true
```

For an immediate check without merging, use `-f merge=false`. Dispatch starts the check as soon as GitHub allocates a runner; it does not wait for GitHub's cached PR mergeability calculation. Without an upstream webhook, upstream pushes cannot trigger this fork instantly.

The workflow fetches both tips and performs a real `git merge --no-ff --no-commit`. Zero conflicts means it commits and pushes the merge to this fork's `main`, retaining both histories and custom changes. Conflicts abort the trial merge, list affected files in the run summary and fail the run without changing the remote branch. Check-only runs abort even a clean trial. Concurrent runs are serialized; an ordinary non-force push rejects a concurrent human update instead of overwriting it. No tags, releases, installed binaries or local configs are updated by this workflow.

A clean Git merge does not guarantee compatible behavior. After a published merge, the same workflow runs the full frontend verification (tests, lint, TypeScript and build). This is explicit because pushes made with `GITHUB_TOKEN` do not trigger normal push workflows. Validation failure marks the run red and leaves the merge in place for repair; it does not rewrite main or automatically roll back later human commits.

The built-in `GITHUB_TOKEN` has Contents write only in the sync job; verification has read-only access and does not retain checkout credentials. Branch protection or GitHub's restrictions on changing workflow files may reject a push. If needed, configure repository secret `UPSTREAM_SYNC_TOKEN` with a fine-grained token restricted to this repository, Contents write and Workflows write. The token is optional; no personal credential is embedded in this source. Protected branches still require an appropriate permitted actor. Failed pushes remain failures and are never reported as successful merges.

The production script is `.github/scripts/sync-upstream.sh`. Its six isolated local-Git fixtures cover no updates, check-only cleanup, a clean divergent merge preserving fork changes, conflicts, stale-checkout races and rejected pushes. Run `python3 .github/scripts/test-sync-upstream.py` to reproduce them. Both workflows run these fixtures before checking upstream.
