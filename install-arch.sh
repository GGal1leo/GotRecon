#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  GotRecon? — Arch Linux Installer
#  Installs dependencies, builds the Electron app, and sets up a desktop entry.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

APP_NAME="gotrecon"
DISPLAY_NAME="GotRecon?"
INSTALL_DIR="/opt/${APP_NAME}"
ICON_DIR="/usr/share/icons/hicolor/scalable/apps"
DESKTOP_DIR="/usr/share/applications"
BIN_LINK="/usr/local/bin/${APP_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { echo -e "${CYAN}[*]${NC} $*"; }
ok() { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err() {
  echo -e "${RED}[✗]${NC} $*"
  exit 1
}

# ── Root check ────────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)."
fi

# ── Detect display server ────────────────────────────────────────────────────

detect_display_server() {
  if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]] || [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    echo "wayland"
  else
    echo "x11"
  fi
}

# ── Install system dependencies ──────────────────────────────────────────────

info "Updating package database..."
pacman -Sy --noconfirm &>/dev/null

DEPS=(nodejs npm electron libxss nss at-spi2-core)
MISSING=()

for pkg in "${DEPS[@]}"; do
  if ! pacman -Qi "$pkg" &>/dev/null; then
    MISSING+=("$pkg")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  info "Installing missing packages: ${MISSING[*]}"
  pacman -S --noconfirm --needed "${MISSING[@]}"
  ok "System dependencies installed."
else
  ok "All system dependencies already installed."
fi

# ── Install app files ────────────────────────────────────────────────────────

info "Installing ${DISPLAY_NAME} to ${INSTALL_DIR}..."

# Clean previous install if present
if [[ -d "${INSTALL_DIR}" ]]; then
  warn "Removing previous installation at ${INSTALL_DIR}..."
  rm -rf "${INSTALL_DIR}"
fi

mkdir -p "${INSTALL_DIR}"

# Copy project files
cp -r \
  "${SCRIPT_DIR}/main.js" \
  "${SCRIPT_DIR}/preload.js" \
  "${SCRIPT_DIR}/package.json" \
  "${SCRIPT_DIR}/renderer" \
  "${SCRIPT_DIR}/modules" \
  "${INSTALL_DIR}/"

# Copy icon if present
if [[ -d "${SCRIPT_DIR}/assets" ]]; then
  cp -r "${SCRIPT_DIR}/assets" "${INSTALL_DIR}/"
fi

ok "App files copied."

# ── Install npm dependencies ─────────────────────────────────────────────────

info "Installing npm dependencies..."
cd "${INSTALL_DIR}"
npm install --production --no-optional 2>/dev/null
ok "npm dependencies installed."

# ── Install icon ──────────────────────────────────────────────────────────────

info "Installing icon..."
mkdir -p "${ICON_DIR}"

if [[ -f "${INSTALL_DIR}/assets/gotrecon.svg" ]]; then
  cp "${INSTALL_DIR}/assets/gotrecon.svg" "${ICON_DIR}/${APP_NAME}.svg"
  ok "Icon installed."
else
  warn "Icon not found at assets/gotrecon.svg — skipping."
fi

# ── Create launcher script ────────────────────────────────────────────────────

info "Creating launcher script..."

DISPLAY_SERVER=$(detect_display_server)

cat >"${BIN_LINK}" <<LAUNCHER
#!/usr/bin/env bash
# GotRecon? launcher — auto-detects Wayland/X11

DISPLAY_SERVER="\${XDG_SESSION_TYPE:-x11}"

if [[ "\$DISPLAY_SERVER" == "wayland" ]] || [[ -n "\${WAYLAND_DISPLAY:-}" ]]; then
    exec electron ${INSTALL_DIR} \\
        --enable-features=UseOzonePlatform \\
        --ozone-platform=wayland \\
        --enable-wayland-ime \\
        "\$@"
else
    exec electron ${INSTALL_DIR} \\
        --ozone-platform=x11 \\
        "\$@"
fi
LAUNCHER

chmod +x "${BIN_LINK}"
ok "Launcher created at ${BIN_LINK}."

# ── Create .desktop entry ────────────────────────────────────────────────────

info "Creating desktop entry..."
mkdir -p "${DESKTOP_DIR}"

cat >"${DESKTOP_DIR}/${APP_NAME}.desktop" <<DESKTOP
[Desktop Entry]
Name=${DISPLAY_NAME}
Comment=Target Recon Dashboard — DNS, crt.sh, subdomains, typosquat detection
Exec=${BIN_LINK} %u
Icon=${APP_NAME}
Type=Application
Terminal=false
Categories=Network;Security;Utility;
Keywords=recon;dns;subdomain;certificate;typosquat;security;
StartupWMClass=${APP_NAME}
DESKTOP

chmod 644 "${DESKTOP_DIR}/${APP_NAME}.desktop"

# Validate desktop file if desktop-file-validate is available
if command -v desktop-file-validate &>/dev/null; then
  if desktop-file-validate "${DESKTOP_DIR}/${APP_NAME}.desktop" 2>/dev/null; then
    ok "Desktop entry validated."
  else
    warn "Desktop entry has minor validation warnings (non-critical)."
  fi
fi

# Update desktop database
if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "${DESKTOP_DIR}" 2>/dev/null || true
fi

# Update icon cache
if command -v gtk-update-icon-cache &>/dev/null; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi

ok "Desktop entry installed."

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ${DISPLAY_NAME} installed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}Run from terminal:${NC}  gotrecon"
echo -e "  ${CYAN}Install location:${NC}   ${INSTALL_DIR}"
echo -e "  ${CYAN}Desktop entry:${NC}      ${DESKTOP_DIR}/${APP_NAME}.desktop"
echo -e "  ${CYAN}Display server:${NC}     ${DISPLAY_SERVER} (auto-detected at launch)"
echo ""
echo -e "  ${YELLOW}To uninstall:${NC}       sudo bash ${INSTALL_DIR}/uninstall.sh"
echo ""

# ── Generate uninstall script ─────────────────────────────────────────────────

cat >"${INSTALL_DIR}/uninstall.sh" <<'UNINSTALL'
#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}[✗]${NC} Run as root (use sudo)."
    exit 1
fi

echo -e "${CYAN}[*]${NC} Uninstalling GotRecon?..."

rm -f  /usr/local/bin/gotrecon
rm -f  /usr/share/applications/gotrecon.desktop
rm -f  /usr/share/icons/hicolor/scalable/apps/gotrecon.svg
rm -rf /opt/gotrecon

if command -v update-desktop-database &>/dev/null; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi
if command -v gtk-update-icon-cache &>/dev/null; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi

echo -e "${GREEN}[✓]${NC} GotRecon? has been uninstalled."
UNINSTALL

chmod +x "${INSTALL_DIR}/uninstall.sh"
