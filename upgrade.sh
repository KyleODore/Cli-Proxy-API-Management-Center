#!/usr/bin/env bash
# prox WebUI installer. Backend binaries, credentials and auth directories are untouched.
set -Eeuo pipefail
umask 077
DEFAULT_REPOSITORY='mikedoesgithub/Cli-Proxy-API-Management-Center'
fail() { printf 'prox: %s\n' "$*" >&2; exit 1; }
asset_file=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --asset-file) [ "$#" -ge 2 ] || fail '--asset-file needs a path'; asset_file=$2; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
for dependency in awk mktemp cp mv chmod dirname; do command -v "$dependency" >/dev/null || fail "Required command missing: $dependency"; done
service=${PROX_SERVICE:-cliproxyapi}
service_active=false
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "$service" 2>/dev/null; then service_active=true; fi
install_dir=${PROX_INSTALL_DIR:-}
if [ -z "$install_dir" ] && $service_active; then
  install_dir=$(systemctl --user show "$service" --property=WorkingDirectory --value 2>/dev/null || true)
  [ -d "$install_dir" ] || install_dir=''
fi
if [ -z "$install_dir" ]; then
  if [ -d "$HOME/cliproxyapi" ]; then install_dir="$HOME/cliproxyapi"
  elif [ -d "$HOME/.cli-proxy-api" ]; then install_dir="$HOME/.cli-proxy-api"
  else fail 'Install not found. Set PROX_INSTALL_DIR to the CLIProxyAPI directory.'; fi
fi
[ -d "$install_dir" ] || fail "Install directory does not exist: $install_dir"
install_dir=$(cd "$install_dir" && pwd -P)
config=${PROX_CONFIG:-"$install_dir/config.yaml"}
if [ ! -f "$config" ] && [ -z "${PROX_CONFIG:-}" ] && [ -f "$install_dir/config.yml" ]; then config="$install_dir/config.yml"; fi
[ -f "$config" ] || fail 'Config not found. Set PROX_CONFIG to the config file used by the service.'
[ ! -L "$config" ] || fail 'Config is a symlink. Set PROX_CONFIG to its resolved file.'

# Respect exported backend path overrides. A service may have its own environment;
# refuse hidden overrides rather than installing into an unused directory.
if $service_active; then
  service_env=$(systemctl --user show "$service" --property=Environment --value 2>/dev/null || true)
  for variable in MANAGEMENT_STATIC_PATH WRITABLE_PATH; do
    if [[ "$service_env" == *"$variable="* ]] && [ -z "${!variable:-}" ]; then
      fail "The service sets $variable. Export the same value when running this installer."
    fi
  done
fi
static_override=${MANAGEMENT_STATIC_PATH:-}
if [ -n "$static_override" ]; then
  case "${static_override##*/}" in
    [Mm][Aa][Nn][Aa][Gg][Ee][Mm][Ee][Nn][Tt].[Hh][Tt][Mm][Ll]) target=$static_override ;;
    *) target="$static_override/management.html" ;;
  esac
elif [ -n "${WRITABLE_PATH:-}" ]; then target="$WRITABLE_PATH/static/management.html"
else target="$(dirname "$config")/static/management.html"; fi
case "$target" in /*) ;; *) target="$install_dir/$target" ;; esac
[ ! -L "$target" ] || fail 'management.html is a symlink. Use its resolved MANAGEMENT_STATIC_PATH.'
static_dir=$(dirname "$target")
mkdir -p "$static_dir"
[ -w "$static_dir" ] || fail "Cannot write: $static_dir"
config_dir=$(dirname "$config")
[ -w "$config_dir" ] || fail "Cannot write config directory: $config_dir"
lock_dir="$static_dir/.prox-upgrade.lock"
mkdir "$lock_dir" 2>/dev/null || fail "An upgrade lock exists: $lock_dir. Check for another installer before removing it."
html_tmp=''; config_tmp=''; rollback=false; had_html=false
cleanup() {
  result=$?
  trap - EXIT
  if $rollback; then
    printf 'prox: upgrade failed; restoring previous WebUI and config.\n' >&2
    if $had_html; then cp -p "$target.bak" "$target"; else rm -f "$target"; fi
    cp -p "$config.prox.bak" "$config"
    if $service_active; then systemctl --user restart "$service" >/dev/null 2>&1 || true; fi
  fi
  [ -z "$html_tmp" ] || rm -f "$html_tmp"
  [ -z "$config_tmp" ] || rm -f "$config_tmp"
  rmdir "$lock_dir" 2>/dev/null || true
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
html_tmp=$(mktemp "$static_dir/.management.prox.XXXXXX")
config_tmp=$(mktemp "$config_dir/.config.prox.XXXXXX")
if [ -z "$asset_file" ] && [ -f "${BASH_SOURCE[0]:-}" ]; then
  script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
  if [ -f "$script_dir/management.html" ]; then asset_file="$script_dir/management.html"; fi
fi
if [ -n "$asset_file" ]; then
  [ -f "$asset_file" ] || fail "Asset not found: $asset_file"
  cp "$asset_file" "$html_tmp"
else
  command -v curl >/dev/null || fail 'curl is required for downloading the WebUI.'
  repository=${PROX_REPOSITORY:-$DEFAULT_REPOSITORY}
  url=${PROX_ASSET_URL:-}
  if [ -z "$url" ]; then
    [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'Set PROX_REPOSITORY=owner/repo or PROX_ASSET_URL to the published management.html URL.'
    url="https://github.com/$repository/releases/latest/download/management.html"
  fi
  [[ "$url" == https://* ]] || fail 'PROX_ASSET_URL must use HTTPS.'
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 180 --retry 2 "$url" -o "$html_tmp"
fi
# Reject error pages, truncated responses and assets from a different project.
[ "$(wc -c < "$html_tmp" | tr -d ' ')" -gt 10000 ] || fail 'Downloaded asset is too small.'
LC_ALL=C awk 'BEGIN { IGNORECASE=1 } /prox Quota Management/ { title=1 } /<script/ { script=1 } /<\/html>/ { closed=1 } END { exit !(title && script && closed) }' "$html_tmp" || fail 'Asset validation failed; current installation was not changed.'
if [ -n "${PROX_SHA256:-}" ]; then
  if command -v sha256sum >/dev/null; then digest=$(sha256sum "$html_tmp"); digest=${digest%% *}
  elif command -v shasum >/dev/null; then digest=$(shasum -a 256 "$html_tmp"); digest=${digest%% *}
  else fail 'SHA-256 verification requested but sha256sum/shasum is missing.'; fi
  [ "$digest" = "$PROX_SHA256" ] || fail 'SHA-256 mismatch; current installation was not changed.'
fi
# Change exactly one boolean. All credentials, keys, comments and other YAML lines
# remain byte-for-byte. Unsupported YAML layouts fail before touching live files.
awk '
  /^(management|remote-management):/ { total++ }
  /^(management|remote-management):[[:space:]]*(#.*)?$/ { sections++ }
  END { exit sections != 1 || total != 1 }
' "$config" || fail 'Expected one block-style management: (or remote-management:) section in config. No files changed.'
awk '
  function finish() { if (inside && !found) print "  disable-auto-update-panel: true"; inside=0 }
  /^(management|remote-management):[[:space:]]*(#.*)?$/ { finish(); inside=1; print; next }
  /^[^[:space:]#]/ { finish() }
  inside && /^  disable-auto-update-panel:/ {
    if (found++) exit 20;
    if ($0 !~ /^  disable-auto-update-panel:[[:space:]]*(true|false)[[:space:]]*(#.*)?$/) exit 21;
    sub(/:[[:space:]]*(true|false)/, ": true"); print; next
  }
  { print }
  END { finish() }
' "$config" > "$config_tmp" || fail 'Unsupported/duplicate auto-update setting. No files changed.'
# Preserve config permissions (including a private 0600 management key file).
cp -p "$config" "$config.prox.bak"
cp -p "$config" "$config_tmp.permissions"
cat "$config_tmp" > "$config_tmp.permissions"
mv "$config_tmp.permissions" "$config_tmp"
if [ -f "$target" ]; then cp -p "$target" "$target.bak"; had_html=true; fi
chmod 644 "$html_tmp"
rollback=true
mv -f "$config_tmp" "$config"
config_tmp=''
mv -f "$html_tmp" "$target"
html_tmp=''
if $service_active; then
  systemctl --user restart "$service"
  systemctl --user is-active --quiet "$service" || fail 'Service did not become active after restart.'
fi
rollback=false
printf 'prox: installed %s\n' "$target"
printf 'prox: automatic upstream panel replacement is disabled; config backup: %s.prox.bak\n' "$config"
if $service_active; then printf 'prox: restarted user service %s.\n' "$service"
else printf 'prox: no active systemd user service; reload management.html in your browser.\n'; fi
ip=''
if command -v tailscale >/dev/null 2>&1; then ip=$(tailscale ip -4 2>/dev/null | awk 'NR==1 {print; exit}'); fi
if [ -z "$ip" ]; then ip='<tailscale-ip>'; fi
printf 'prox: default local URL: http://127.0.0.1:8317/management.html\n'
printf 'prox: Tailscale URL (when backend TLS is configured): https://%s:8317/management.html\n' "$ip"
printf 'prox: custom ports, TLS termination and remote-access policy still follow your existing backend configuration.\n'
