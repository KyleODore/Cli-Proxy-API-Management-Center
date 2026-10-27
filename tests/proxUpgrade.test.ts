import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const script = resolve('upgrade.sh');
function fixture(active = false) {
  const root = mkdtempSync(join(tmpdir(), 'prox-install-'));
  roots.push(root);
  const install = join(root, 'install with spaces'),
    bin = join(root, 'bin');
  mkdirSync(join(install, 'static'), { recursive: true });
  mkdirSync(bin);
  const config = join(install, 'config.yaml');
  const original =
    '# private config\nserver:\n  port: 8317\nmanagement:\n  secret-key: "fixture-value" # retain exactly\n  allow-remote: false\n  panel-github-repository: "https://github.com/router-for-me/example"\ncredentials:\n  auth-dir: /unchanged\n';
  writeFileSync(config, original, { mode: 0o600 });
  writeFileSync(join(install, 'static/management.html'), 'ORIGINAL HTML');
  writeFileSync(join(install, 'auth-token.json'), 'fixture-token');
  const asset = join(root, 'new.html');
  writeFileSync(
    asset,
    `<!doctype html><html><head><title>prox Quota Management</title></head><body><script>${' '.repeat(11000)}</script></body></html>`
  );
  writeFileSync(
    join(bin, 'systemctl'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(join(root, 'service.log'))}\ncase "$*" in\n *is-active*) exit ${active ? 0 : 1};;\n *WorkingDirectory*) printf '%s\\n' ${JSON.stringify(install)};;\n *Environment*) exit 0;;\n *restart*) exit "\${PROX_TEST_RESTART_EXIT:-0}";;\nesac\n`
  );
  chmodSync(join(bin, 'systemctl'), 0o755);
  const run = (extra: Record<string, string> = {}, args = ['--asset-file', asset]) =>
    spawnSync('bash', [script, ...args], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PROX_INSTALL_DIR: install,
        ...extra,
      },
      encoding: 'utf8',
    });
  return { root, install, config, original, asset, bin, run };
}
describe('prox upgrade transactional installer', () => {
  test('installs with backups, preserves secrets/tokens and pins only the updater flag', () => {
    const f = fixture(),
      r = f.run();
    expect(r.status).toBe(0);
    expect(readFileSync(join(f.install, 'static/management.html'), 'utf8')).toContain(
      'prox Quota Management'
    );
    expect(readFileSync(join(f.install, 'static/management.html.bak'), 'utf8')).toBe(
      'ORIGINAL HTML'
    );
    expect(readFileSync(f.config + '.prox.bak', 'utf8')).toBe(f.original);
    expect(readFileSync(f.config, 'utf8').replace('  disable-auto-update-panel: true\n', '')).toBe(
      f.original
    );
    expect(readFileSync(join(f.install, 'auth-token.json'), 'utf8')).toBe('fixture-token');
    expect(r.stdout).toContain('management.html');
  });
  test('restarts an active user service', () => {
    const f = fixture(true);
    expect(f.run().status).toBe(0);
    expect(readFileSync(join(f.root, 'service.log'), 'utf8')).toContain(
      '--user restart cliproxyapi'
    );
  });
  test('rolls config and HTML back if restart fails', () => {
    const f = fixture(true);
    const r = f.run({ PROX_TEST_RESTART_EXIT: '1' });
    expect(r.status).not.toBe(0);
    expect(readFileSync(f.config, 'utf8')).toBe(f.original);
    expect(readFileSync(join(f.install, 'static/management.html'), 'utf8')).toBe('ORIGINAL HTML');
  });
  test('invalid download does not modify live config or HTML', () => {
    const f = fixture();
    writeFileSync(f.asset, '<html>error</html>');
    expect(f.run().status).not.toBe(0);
    expect(readFileSync(f.config, 'utf8')).toBe(f.original);
    expect(readFileSync(join(f.install, 'static/management.html'), 'utf8')).toBe('ORIGINAL HTML');
  });
  test('rejects failed HTTPS downloads without replacing the panel', () => {
    const f = fixture();
    writeFileSync(join(f.bin, 'curl'), '#!/bin/sh\nexit 22\n');
    chmodSync(join(f.bin, 'curl'), 0o755);
    expect(
      f.run({ PROX_ASSET_URL: 'https://fixture.invalid/management.html' }, []).status
    ).not.toBe(0);
    expect(readFileSync(f.config, 'utf8')).toBe(f.original);
  });
  test('uses exact MANAGEMENT_STATIC_PATH file overrides', () => {
    const f = fixture();
    const dir = join(f.root, 'override');
    mkdirSync(dir);
    const file = join(dir, 'management.html');
    expect(f.run({ MANAGEMENT_STATIC_PATH: file }).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain('prox Quota Management');
    expect(readFileSync(join(f.install, 'static/management.html'), 'utf8')).toBe('ORIGINAL HTML');
  });
  test('uses MANAGEMENT_STATIC_PATH directory overrides', () => {
    const f = fixture();
    const dir = join(f.root, 'override');
    expect(f.run({ MANAGEMENT_STATIC_PATH: dir }).status).toBe(0);
    expect(readFileSync(join(dir, 'management.html'), 'utf8')).toContain('prox Quota Management');
  });
  test('uses WRITABLE_PATH as the backend does', () => {
    const f = fixture();
    const dir = join(f.root, 'writable');
    expect(f.run({ WRITABLE_PATH: dir }).status).toBe(0);
    expect(readFileSync(join(dir, 'static/management.html'), 'utf8')).toContain(
      'prox Quota Management'
    );
  });
  test('updates an existing flag and preserves its comment', () => {
    const f = fixture();
    writeFileSync(
      f.config,
      f.original.replace(
        'management:\n',
        'management:\n  disable-auto-update-panel: false # keep me\n'
      )
    );
    expect(f.run().status).toBe(0);
    expect(readFileSync(f.config, 'utf8')).toContain('disable-auto-update-panel: true # keep me');
  });
  test('refuses ambiguous YAML instead of rewriting it', () => {
    const f = fixture();
    writeFileSync(f.config, f.original + 'management: {secret-key: fixture}\n');
    const before = readFileSync(f.config, 'utf8');
    expect(f.run().status).not.toBe(0);
    expect(readFileSync(f.config, 'utf8')).toBe(before);
  });
  test('refuses duplicate update keys', () => {
    const f = fixture();
    writeFileSync(
      f.config,
      f.original.replace(
        'management:\n',
        'management:\n  disable-auto-update-panel: false\n  disable-auto-update-panel: false\n'
      )
    );
    expect(f.run().status).not.toBe(0);
    expect(readFileSync(join(f.install, 'static/management.html'), 'utf8')).toBe('ORIGINAL HTML');
  });
  test('checks optional SHA-256 before changing files', () => {
    const f = fixture();
    expect(f.run({ PROX_SHA256: '0'.repeat(64) }).status).not.toBe(0);
    expect(readFileSync(f.config, 'utf8')).toBe(f.original);
    const hash = createHash('sha256').update(readFileSync(f.asset)).digest('hex');
    expect(f.run({ PROX_SHA256: hash }).status).toBe(0);
  });
  test('works without an active systemd service, as on macOS', () => {
    const f = fixture();
    const r = f.run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('no active systemd user service');
    expect(readFileSync(join(f.root, 'service.log'), 'utf8')).not.toContain('restart');
  });
});
