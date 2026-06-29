# Neural Inverse - Windows Development Dependencies Setup
# Run this script once as Administrator before running npm install
# Usage: powershell -ExecutionPolicy Bypass -File scripts\install-windows-deps.ps1

param(
    [switch]$SkipNode,
    [switch]$SkipGit,
    [switch]$SkipVSBuildTools
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host "`n[SETUP] $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "[FAIL] $msg" -ForegroundColor Red
}

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Fail "Please run this script as Administrator (right-click PowerShell -> Run as Administrator)"
    exit 1
}

# Node.js 20 LTS
if (-not $SkipNode) {
    Write-Step "Checking Node.js..."
    $nodeExists = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeExists) {
        Write-OK "Node.js already installed: $(node --version)"
    } else {
        Write-Step "Installing Node.js 20 LTS..."
        $nodeMsi = "$env:TEMP\node-v20.19.0-x64.msi"
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi" -OutFile $nodeMsi
        $ProgressPreference = 'Continue'
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn" -Wait
        $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
        Write-OK "Node.js 20 installed"
    }
}

# Git
if (-not $SkipGit) {
    Write-Step "Checking Git..."
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-OK "Git already installed: $(git --version)"
    } else {
        Write-Step "Installing Git..."
        $gitExe = "$env:TEMP\git-setup.exe"
        Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.2/Git-2.47.0.2-64-bit.exe" -OutFile $gitExe
        Start-Process $gitExe -ArgumentList "/VERYSILENT /NORESTART" -Wait
        Write-OK "Git installed"
    }
}

# Visual Studio Build Tools (required for native Node modules)
if (-not $SkipVSBuildTools) {
    Write-Step "Checking Visual Studio Build Tools..."
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $hasVS = $false
    if (Test-Path $vsWhere) {
        $vsInstalls = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json 2>$null | ConvertFrom-Json
        if ($vsInstalls.Count -gt 0) {
            $hasVS = $true
            Write-OK "Visual Studio Build Tools already installed: $($vsInstalls[0].displayName)"
            # Ensure Spectre-mitigated libs are present (required by @vscode/deviceid)
            Write-Step "Ensuring Spectre-mitigated libraries are installed..."
            $vsInstaller = Join-Path (Split-Path $vsWhere) "vs_installer.exe"
            if (Test-Path $vsInstaller) {
                Start-Process $vsInstaller -ArgumentList "modify --installPath `"$($vsInstalls[0].installationPath)`" --quiet --norestart --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre" -Wait
                Write-OK "Spectre libraries ensured"
            }
        }
    }
    if (-not $hasVS) {
        Write-Step "Downloading Visual Studio Build Tools 2022 (~2GB)..."
        Write-Host "  This will take ~10 mins. Please wait..." -ForegroundColor Yellow
        $vsBuildTools = "$env:TEMP\vs_buildtools_$(Get-Random).exe"
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_buildtools.exe" -OutFile $vsBuildTools
        $ProgressPreference = 'Continue'
        Write-OK "Downloaded. Now installing C++ workload..."
        Write-Host "  Still ~5-8 mins remaining..." -ForegroundColor Yellow
        $vsProc = Start-Process $vsBuildTools -ArgumentList "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre" -PassThru
        $dots = 0
        while (-not $vsProc.HasExited) {
            Start-Sleep -Seconds 10
            $dots++
            Write-Host "  Installing... ($($dots * 10)s elapsed)" -ForegroundColor DarkYellow
        }
        Write-OK "Visual Studio Build Tools installed"
    }
}

# Python (required by node-gyp)
Write-Step "Checking Python..."
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-OK "Python already installed: $(python --version)"
} else {
    Write-Step "Installing Python 3.11..."
    $pyExe = "$env:TEMP\python-3.11.9-amd64.exe"
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe" -OutFile $pyExe
    Start-Process $pyExe -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait
    Write-OK "Python 3.11 installed"
}

Write-Host "`n================================================" -ForegroundColor Green
Write-Host " All dependencies installed!" -ForegroundColor Green
Write-Host " Please RESTART your terminal, then run:" -ForegroundColor Green
Write-Host "   npm install" -ForegroundColor Yellow
Write-Host "   npm run watch" -ForegroundColor Yellow
Write-Host "================================================`n" -ForegroundColor Green
