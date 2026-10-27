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
