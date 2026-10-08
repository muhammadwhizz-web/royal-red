#!/usr/bin/env bash
# ==========================================================================
# ROYAL RED one-command installer (Phase A)
# ==========================================================================
#
# Install:
#   curl -fsSL https://raw.githubusercontent.com/muhammadwhizz-web/royal-red/main/install.sh | bash
#   (or, from a checkout or downloaded copy of the repository:)
#   bash install.sh
#
# Upgrade (safe to run again at any time):
#   bash install.sh
#
# Uninstall:
#   bash install.sh --uninstall
#
# Offline or bundled installs (no git clone needed):
#   ROYAL_RED_SOURCE=/path/to/royal-red bash install.sh
#   ROYAL_RED_SOURCE=/path/to/royal-red.tar.gz bash install.sh
#
# The repository URL can be overridden:
#   ROYAL_RED_REPO=https://github.com/your-user/royal-red bash install.sh
#
# Supported this round: Debian/Ubuntu family and Fedora/RHEL family on
# x86_64 or aarch64, plus Windows 11 through WSL2 (Ubuntu).
# macOS is not supported in this release; the installer exits with a clear
# message rather than attempting a broken install.
#
# Everything the installer prints also lands in ~/.royal-red/install.log.
# ==========================================================================

set -u

RR_REPO="${ROYAL_RED_REPO:-https://github.com/muhammadwhizz-web/royal-red.git}"
RR_SOURCE="${ROYAL_RED_SOURCE:-}"
RR_HOME="$HOME/.royal-red"
APP_DIR="$RR_HOME/app"
DATA_DIR="$RR_HOME/data"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor"

# ---- tiny logging helpers (no emojis, no dashes beyond plain hyphens) ----

RR_LOG="$RR_HOME/install.log"
mkdir -p "$RR_HOME" 2>/dev/null || {
  printf 'install.sh: cannot create %s (check permissions on your home directory)\n' "$RR_HOME" >&2
  exit 1
}

step() { printf '\n== %s\n' "$*"; }
ok() { printf '   ok: %s\n' "$*"; }
warn() { printf '   WARNING: %s\n' "$*"; }
fail() {
  printf '\n   FAILED: %s\n' "$*" >&2
  printf '   The full log is at %s\n' "$RR_LOG" >&2
  exit 1
}

# everything from here on is also written to the install log
exec > >(tee -a "$RR_LOG") 2>&1

printf 'ROYAL RED installer\n'

# ---- 1. operating system -------------------------------------------------

step "checking the operating system"

OS_FAMILY=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_LIKE="${ID_LIKE:-}"
  OS_PRETTY="${PRETTY_NAME:-$OS_ID}"
else
  OS_ID="unknown"
  OS_LIKE=""
  OS_PRETTY="unknown"
fi

case "$OS_ID" in
  debian | ubuntu | linuxmint | pop | raspbian | elementary | neon | zorin) OS_FAMILY="debian" ;;
  fedora | rhel | centos | rocky | almalinux | rocky-linux) OS_FAMILY="fedora" ;;
  *)
    case "$OS_LIKE" in
      *debian*) OS_FAMILY="debian" ;;
      *fedora* | *rhel*) OS_FAMILY="fedora" ;;
    esac
    ;;
esac

if [ -z "$OS_FAMILY" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    fail "macOS is not supported in this release. Royal Red supports Debian/Ubuntu, Fedora/RHEL, and Windows 11 through WSL2. See docs/INSTALL.md."
  fi
  fail "unsupported operating system: $OS_PRETTY. Royal Red supports Debian/Ubuntu and Fedora/RHEL families. See docs/INSTALL.md."
fi

is_wsl="no"
if grep -qi microsoft /proc/sys/fs/binfmt_misc/WSLInterop 2>/dev/null || uname -r | grep -qi microsoft 2>/dev/null; then
  is_wsl="yes"
fi
ok "detected $OS_PRETTY (debian/fedora family: $OS_FAMILY, WSL: $is_wsl)"

# ---- 2. architecture -----------------------------------------------------

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64 | aarch64 | arm64) ok "detected architecture $ARCH" ;;
  *)
    fail "unsupported architecture: $ARCH. Royal Red supports x86_64 and aarch64."
    ;;
esac

# ---- 3. curl -------------------------------------------------------------

step "checking curl"
if command -v curl >/dev/null 2>&1; then
  ok "curl found"
else
  case "$OS_FAMILY" in
    debian)
      printf '   curl is missing. Install it with this command, then run the installer again:\n'
      printf '      sudo apt install curl\n'
      ;;
    fedora)
      printf '   curl is missing. Install it with this command, then run the installer again:\n'
      printf '      sudo dnf install curl\n'
      ;;
  esac
  exit 1
fi

# ---- helpers for privileged package installation --------------------------

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    warn "sudo is not available; steps that need it will print the exact command for you to run"
  fi
fi

pkg_install() { # pkg_install PACKAGES... : returns 1 if it could not install
  local pkgs="$*"
  case "$OS_FAMILY" in
    debian)
      if [ -n "$SUDO" ]; then
        $SUDO apt-get update -y && $SUDO apt-get install -y $pkgs
      else
        printf '   run this yourself, then run the installer again:\n      sudo apt install %s\n' "$pkgs"
        return 1
      fi
      ;;
    fedora)
      if [ -n "$SUDO" ]; then
        $SUDO dnf install -y $pkgs
      else
        printf '   run this yourself, then run the installer again:\n      sudo dnf install %s\n' "$pkgs"
        return 1
      fi
      ;;
  esac
}

# ---- 4. git ---------------------------------------------------------------

step "checking git"
if command -v git >/dev/null 2>&1; then
  ok "git found"
else
  printf '   installing git (this needs your password for sudo)\n'
  pkg_install git || fail "could not install git automatically"
  ok "git installed"
fi

# ---- 5. bun ----------------------------------------------------------------

step "checking bun (the runtime Royal Red runs on)"
if command -v bun >/dev/null 2>&1; then
  ok "bun $(bun --version) found"
else
  printf '   bun not found; installing it into your home directory (~/.bun)\n'
  curl -fsSL https://bun.sh/install | bash || fail "the bun installer failed. Install bun manually: curl -fsSL https://bun.sh/install | bash"
  export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 || fail "bun was installed but is not on the PATH. Open a new terminal and run the installer again."
  ok "bun $(bun --version) installed"
fi

# ---- 6. WSL browser bridge -------------------------------------------------

if [ "$is_wsl" = "yes" ]; then
  step "WSL detected: installing the wslu browser bridge if missing"
  if command -v wslview >/dev/null 2>&1; then
    ok "wslview found"
  else
    pkg_install wslu && ok "wslu installed (royal-red can now open your Windows browser)" ||
      warn "wslu could not be installed automatically. royal-red will print the URL instead of opening the browser."
  fi
fi

# ---- 7. the application ----------------------------------------------------

step "placing Royal Red in $APP_DIR"

if [ -n "$RR_SOURCE" ]; then
  # bundled or local source install
  if [ -f "$RR_SOURCE" ]; then
    printf '   extracting %s\n' "$RR_SOURCE"
    mkdir -p "$APP_DIR.tmp"
    tar -xzf "$RR_SOURCE" -C "$APP_DIR.tmp" || fail "could not extract $RR_SOURCE"
    # archives either wrap everything in one folder or hold files at the root
    if [ -f "$APP_DIR.tmp/package.json" ]; then
      inner="$APP_DIR.tmp"
    else
      inner=$(find "$APP_DIR.tmp" -mindepth 2 -maxdepth 2 -name package.json | head -n 1 | xargs -r dirname)
      [ -n "$inner" ] || { rm -rf "$APP_DIR.tmp"; fail "the archive does not look like Royal Red (no package.json found)"; }
    fi
    rm -rf "$APP_DIR"
    mkdir -p "$APP_DIR"
    cp -a "$inner"/. "$APP_DIR"/ || fail "could not copy the extracted source"
    rm -rf "$APP_DIR.tmp"
  elif [ -d "$RR_SOURCE" ]; then
    printf '   copying from %s\n' "$RR_SOURCE"
    rm -rf "$APP_DIR"
    mkdir -p "$APP_DIR"
    (cd "$RR_SOURCE" && tar -cf - --exclude=node_modules --exclude=.next --exclude='*.log' --exclude=db --exclude=royalred-workspace --exclude=royalred-box .) | (cd "$APP_DIR" && tar -xf -) ||
      fail "could not copy the source from $RR_SOURCE"
  else
    fail "ROYAL_RED_SOURCE=$RR_SOURCE is neither a file nor a directory"
  fi
  ok "source placed"
elif [ -d "$APP_DIR/.git" ]; then
  printf '   existing install found; upgrading (git pull)\n'
  git -C "$APP_DIR" pull --ff-only || warn "git pull failed; keeping the current version (run royal-red update to retry)"
  ok "repository updated"
else
  if [ -d "$APP_DIR" ]; then
    warn "$APP_DIR exists without git history; replacing it with a fresh clone"
    rm -rf "$APP_DIR"
  fi
  git clone --depth 1 "$RR_REPO" "$APP_DIR" || fail "could not clone $RR_REPO. Check your internet connection, or set ROYAL_RED_REPO to a reachable URL."
  ok "repository cloned"
fi

# ---- 8. dependencies --------------------------------------------------------

step "installing dependencies (this can take a minute)"
(cd "$APP_DIR" && bun install) || fail "bun install failed inside $APP_DIR. Check the messages above."
ok "dependencies installed"

# ---- 9. data directory ------------------------------------------------------

step "preparing the data directory"
mkdir -p "$DATA_DIR/workspace" "$DATA_DIR/box" "$RR_HOME/logs" "$RR_HOME/run" ||
  fail "could not create $DATA_DIR"
# the app reads these paths from the environment, so the data always lives
# outside the application directory and survives upgrades
cat >"$APP_DIR/.env" <<EOF
DATABASE_URL="file:$DATA_DIR/royal-red.db"
EOF
ok "data directory ready at $DATA_DIR"

# ---- 10. database ------------------------------------------------------------

step "setting up the SQLite database"
(cd "$APP_DIR" && DATABASE_URL="file:$DATA_DIR/royal-red.db" bun run db:push) ||
  fail "the database setup failed. Check the messages above."
ok "database ready"

# ---- 11. the royal-red command ----------------------------------------------

step "installing the royal-red command"
mkdir -p "$BIN_DIR" || fail "could not create $BIN_DIR"
cp "$APP_DIR/bin/royal-red" "$BIN_DIR/royal-red" || fail "could not copy the launcher"
chmod +x "$BIN_DIR/royal-red" || fail "could not make the launcher executable"
ok "command installed at $BIN_DIR/royal-red"

# add ~/.local/bin to PATH for future shells if it is missing
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    for rc in "$HOME/.profile" "$HOME/.bashrc"; do
      if [ -f "$rc" ]; then
        grep -q '\.local/bin' "$rc" 2>/dev/null || printf '\n# added by the Royal Red installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
      fi
    done
    warn "$BIN_DIR is not on this shell's PATH yet. Open a new terminal, or run: export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

# ---- 12. desktop entry and icons ---------------------------------------------

step "installing the desktop entry and the crown icon"
mkdir -p "$DESKTOP_DIR" ||
  fail "could not create $DESKTOP_DIR"
sed "s|^Exec=.*|Exec=$BIN_DIR/royal-red|" "$APP_DIR/packaging/royal-red.desktop" >"$DESKTOP_DIR/royal-red.desktop" ||
  fail "could not write the desktop entry"
for size in 256x256 128x128 48x48 32x32 16x16; do
  src_num="${size%%x*}"
  mkdir -p "$ICONS_DIR/$size/apps"
  cp "$APP_DIR/packaging/icons/royal-red-$src_num.png" "$ICONS_DIR/$size/apps/royal-red.png" ||
    warn "could not install the $size icon"
done
mkdir -p "$ICONS_DIR/scalable/apps"
cp "$APP_DIR/packaging/icons/royal-red.svg" "$ICONS_DIR/scalable/apps/royal-red.svg" ||
  warn "could not install the scalable icon"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f "$ICONS_DIR" 2>/dev/null
ok "desktop entry and icons installed"

# ---- 13. version stamp --------------------------------------------------------

step "writing the version stamp"
RR_VERSION="$(git -C "$APP_DIR" describe --tags 2>/dev/null || git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo "source-bundle")"
printf '%s\n' "$RR_VERSION" >"$RR_HOME/version"
ok "version: $(cat "$RR_HOME/version")"

# ---- 14. default configuration ------------------------------------------------

if [ ! -f "$RR_HOME/config.toml" ]; then
  cat >"$RR_HOME/config.toml" <<'EOF'
# Royal Red configuration
# port: the first port tried; the launcher walks up to 3010 if it is busy
port = "3000"
# mode: auto (a production build if present, otherwise dev), prod, or dev
mode = "auto"
EOF
  ok "default configuration written"
fi

# ---- done ---------------------------------------------------------------------

printf '\n'
printf 'Royal Red installed.\n'
printf 'Run: royal-red\n'
printf 'Or open the Applications menu and click Royal Red.\n'
printf '\n'
printf 'Uninstall any time: bash %s --uninstall\n' "$0"
printf 'Full install log: %s\n' "$RR_LOG"

exit 0
