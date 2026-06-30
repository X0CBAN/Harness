#Requires -Version 5.1
# Harness dependency installer - Windows (PowerShell 5.1+)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\install-deps.ps1

$ErrorActionPreference = 'Stop'

function ok($msg)   { Write-Host "[ok] $msg" -ForegroundColor Green }
function info($msg) { Write-Host "[--] $msg" -ForegroundColor Cyan }
function warn($msg) { Write-Host "[!!] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Harness dependency installer" -ForegroundColor White
Write-Host "================================================" -ForegroundColor DarkGray

function Refresh-Path {
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH', 'User')
}

function Test-Command($cmd) {
    $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

$useWinget = Test-Command 'winget'
if (-not $useWinget) {
    warn "winget not available - will attempt manual installs where needed."
}

# ---------------------------------------------------------------------------
# Go
# ---------------------------------------------------------------------------
$GO_VERSION = "1.22.4"

if (Test-Command 'go') {
    $goVer = (go version) -replace '^.*go([0-9.]+).*$', '$1'
    info "Go $goVer already installed"
} else {
    info "Installing Go $GO_VERSION..."
    if ($useWinget) {
        winget install --id GoLang.Go --version $GO_VERSION --silent --accept-package-agreements --accept-source-agreements
    } else {
        $msi = "$env:TEMP\go$GO_VERSION.windows-amd64.msi"
        $url = "https://go.dev/dl/go$GO_VERSION.windows-amd64.msi"
        info "Downloading $url..."
        Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
        Start-Process msiexec.exe -Wait -ArgumentList "/i `"$msi`" /quiet /norestart"
        Remove-Item $msi -Force
    }
    Refresh-Path
    if (Test-Command 'go') {
        ok "Go installed"
    } else {
        warn "Go install may require a shell restart. Re-run this script after restarting."
    }
}

# ---------------------------------------------------------------------------
# Node.js
# ---------------------------------------------------------------------------
$NODE_VERSION = "20"

if (Test-Command 'node') {
    $nodeVer = node --version
    info "Node $nodeVer already installed"
} else {
    info "Installing Node.js $NODE_VERSION LTS..."
    if ($useWinget) {
        winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    } else {
        $nodeUrl = "https://nodejs.org/dist/v20.15.0/node-v20.15.0-x64.msi"
        $nodeMsi = "$env:TEMP\node.msi"
        info "Downloading Node.js..."
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        Start-Process msiexec.exe -Wait -ArgumentList "/i `"$nodeMsi`" /quiet /norestart"
        Remove-Item $nodeMsi -Force
    }
    Refresh-Path
    if (Test-Command 'node') {
        ok "Node.js installed"
    } else {
        warn "Node install may require a shell restart."
    }
}

# ---------------------------------------------------------------------------
# Wails CLI
# ---------------------------------------------------------------------------
$WAILS_VERSION = "v2.12.0"

if (Test-Command 'wails') {
    info "Wails already installed"
} else {
    info "Installing Wails CLI $WAILS_VERSION..."
    if (Test-Command 'go') {
        go install "github.com/wailsapp/wails/v2/cmd/wails@$WAILS_VERSION"
        Refresh-Path
        if (Test-Command 'wails') {
            ok "Wails installed"
        } else {
            warn "Wails installed but not found on PATH. Add your Go bin directory to PATH and re-run."
        }
    } else {
        warn "Go not available - install Go first then re-run."
    }
}

# ---------------------------------------------------------------------------
# Nuclei (optional)
# ---------------------------------------------------------------------------
if (Test-Command 'nuclei') {
    info "Nuclei already installed"
} else {
    $ans = Read-Host "Install Nuclei scanner? [y/N]"
    if ($ans -match '^[Yy]') {
        warn "Windows Defender will flag Nuclei as malware - this is a false positive."
        warn "Add an exclusion for nuclei.exe in Windows Security before or after install."
        info "Installing Nuclei..."
        if (Test-Command 'go') {
            go install "github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"
            Refresh-Path
            ok "Nuclei installed"
        } else {
            warn "Go not available - download Nuclei manually from https://github.com/projectdiscovery/nuclei/releases"
        }
    } else {
        info "Skipping Nuclei"
    }
}

# ---------------------------------------------------------------------------
# SQLMap (optional)
# ---------------------------------------------------------------------------
$sqlmapFound = (Test-Command 'sqlmap') -or (Test-Path "$env:USERPROFILE\sqlmap\sqlmap.py")
if ($sqlmapFound) {
    info "SQLMap already present"
} else {
    $ans = Read-Host "Install SQLMap? [y/N]"
    if ($ans -match '^[Yy]') {
        info "Installing SQLMap..."
        if ($useWinget) {
            try {
                winget install --id SQLMap.SQLMap --silent --accept-package-agreements --accept-source-agreements
                ok "SQLMap installed"
            } catch {
                warn "winget install failed - trying pip..."
                if (Test-Command 'pip') {
                    pip install sqlmap
                    ok "SQLMap installed via pip"
                } else {
                    warn "Could not install SQLMap. Download from https://sqlmap.org"
                }
            }
        } elseif (Test-Command 'pip') {
            pip install sqlmap
            ok "SQLMap installed via pip"
        } else {
            warn "Could not install SQLMap. Download from https://sqlmap.org"
        }
    } else {
        info "Skipping SQLMap"
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "All done!" -ForegroundColor Green
Write-Host ""
Write-Host "Build Harness:"
Write-Host "  cd $PSScriptRoot\.."
Write-Host "  wails build"
Write-Host ""
Write-Host "Dev mode (hot reload):"
Write-Host "  wails dev"
Write-Host ""

$gobin = "$env:USERPROFILE\go\bin"
if (Test-Command 'go') {
    $gobin = "$(go env GOPATH)\bin"
}
Write-Host "Note: if 'wails' is not found after install, add Go's bin to PATH:"
Write-Host "  $gobin"
