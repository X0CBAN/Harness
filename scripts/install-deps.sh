#!/usr/bin/env bash
# Harness dependency installer — Linux and macOS
# Usage: bash scripts/install-deps.sh
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
info() { echo -e "${BOLD}[--]${NC} $*"; }
warn() { echo -e "${YELLOW}[!!]${NC} $*"; }
fail() { echo -e "${RED}[xx]${NC} $*"; exit 1; }

OS="$(uname -s)"
ARCH="$(uname -m)"

# ---------------------------------------------------------------------------
# Go
# ---------------------------------------------------------------------------
GO_VERSION="1.22.4"
need_go() {
    if command -v go &>/dev/null; then
        installed="$(go version | awk '{print $3}' | sed 's/go//')"
        info "Go $installed already installed"
        return 0
    fi
    info "Installing Go $GO_VERSION..."
    case "$OS" in
      Linux)
        case "$ARCH" in
          x86_64) tarball="go${GO_VERSION}.linux-amd64.tar.gz" ;;
          aarch64|arm64) tarball="go${GO_VERSION}.linux-arm64.tar.gz" ;;
          *) fail "Unsupported arch: $ARCH" ;;
        esac
        curl -fsSL "https://go.dev/dl/$tarball" -o /tmp/go.tar.gz
        sudo rm -rf /usr/local/go
        sudo tar -C /usr/local -xzf /tmp/go.tar.gz
        rm /tmp/go.tar.gz
        export PATH="/usr/local/go/bin:$PATH"
        # Add to shell profile
        for f in ~/.bashrc ~/.profile ~/.zshrc; do
            if [ -f "$f" ] && ! grep -q '/usr/local/go/bin' "$f"; then
                echo 'export PATH="/usr/local/go/bin:$PATH"' >> "$f"
            fi
        done
        ;;
      Darwin)
        if command -v brew &>/dev/null; then
            brew install go
        else
            case "$ARCH" in
              x86_64) pkg="go${GO_VERSION}.darwin-amd64.pkg" ;;
              arm64)  pkg="go${GO_VERSION}.darwin-arm64.pkg" ;;
              *) fail "Unsupported arch: $ARCH" ;;
            esac
            curl -fsSL "https://go.dev/dl/$pkg" -o /tmp/go.pkg
            sudo installer -pkg /tmp/go.pkg -target /
            rm /tmp/go.pkg
            export PATH="/usr/local/go/bin:$PATH"
        fi
        ;;
      *) fail "Unsupported OS: $OS" ;;
    esac
    ok "Go installed"
}

# ---------------------------------------------------------------------------
# Node.js
# ---------------------------------------------------------------------------
NODE_VERSION="20"
need_node() {
    if command -v node &>/dev/null; then
        installed="$(node --version)"
        info "Node $installed already installed"
        return 0
    fi
    info "Installing Node.js $NODE_VERSION (via nvm)..."
    if ! command -v nvm &>/dev/null; then
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
    fi
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
    ok "Node.js installed"
}

# ---------------------------------------------------------------------------
# Linux GTK/WebKit (required by Wails)
# ---------------------------------------------------------------------------
need_linux_deps() {
    [ "$OS" != "Linux" ] && return 0
    info "Installing Wails Linux dependencies (gtk3, webkit2gtk)..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq
        sudo apt-get install -y \
            libgtk-3-dev libwebkit2gtk-4.0-dev \
            gcc pkg-config libayatana-appindicator3-dev \
            build-essential
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y \
            gtk3-devel webkit2gtk4.0-devel \
            gcc pkg-config
    elif command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm \
            gtk3 webkit2gtk base-devel pkg-config
    else
        warn "Could not detect package manager. Install gtk3 and webkit2gtk manually."
        return 1
    fi
    ok "Linux deps installed"
}

# ---------------------------------------------------------------------------
# Wails CLI
# ---------------------------------------------------------------------------
WAILS_VERSION="v2.12.0"
need_wails() {
    if command -v wails &>/dev/null; then
        info "Wails $(wails version 2>/dev/null || echo '(installed)') already present"
        return 0
    fi
    info "Installing Wails CLI $WAILS_VERSION..."
    go install "github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}"
    export PATH="$HOME/go/bin:$PATH"
    ok "Wails installed"
}

# ---------------------------------------------------------------------------
# Nuclei (optional)
# ---------------------------------------------------------------------------
need_nuclei() {
    if command -v nuclei &>/dev/null; then
        info "Nuclei $(nuclei -version 2>&1 | head -1) already installed"
        return 0
    fi
    read -rp "Install Nuclei scanner? [y/N] " ans
    case "$ans" in
      [Yy]*) ;;
      *) info "Skipping Nuclei"; return 0 ;;
    esac
    info "Installing Nuclei..."
    go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
    ok "Nuclei installed"
}

# ---------------------------------------------------------------------------
# SQLMap (optional)
# ---------------------------------------------------------------------------
need_sqlmap() {
    if command -v sqlmap &>/dev/null || [ -f "$HOME/.local/bin/sqlmap" ]; then
        info "SQLMap already installed"
        return 0
    fi
    read -rp "Install SQLMap? [y/N] " ans
    case "$ans" in
      [Yy]*) ;;
      *) info "Skipping SQLMap"; return 0 ;;
    esac
    info "Installing SQLMap..."
    if command -v pip3 &>/dev/null; then
        pip3 install --user sqlmap
    elif command -v apt-get &>/dev/null; then
        sudo apt-get install -y sqlmap
    else
        warn "pip3 not found. Install SQLMap manually: pip3 install sqlmap"
    fi
    ok "SQLMap installed"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}Harness dependency installer${NC}"
echo "================================================"

need_go
need_node
need_linux_deps
need_wails
need_nuclei
need_sqlmap

echo ""
echo -e "${GREEN}${BOLD}All done!${NC}"
echo ""
echo "Build Harness:"
echo "  cd $(dirname "$(realpath "$0")")/.."
echo "  wails build"
echo ""
echo "Dev mode (hot reload):"
echo "  wails dev"
echo ""
echo "Note: If 'wails' or 'nuclei' are not found, add Go bin to your PATH:"
echo "  export PATH=\"\$HOME/go/bin:\$PATH\""
