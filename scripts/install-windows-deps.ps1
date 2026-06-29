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
    try {
        $nodeVer = & node --version 2>$null
        if ($nodeVer -match "v20\." -or $nodeVer -match "v22\.") {
            Write-OK "Node.js already installed: $nodeVer"
        } else {
            throw "wrong version"
        }
    } catch {
        Write-Step "Installing Node.js 20 LTS..."
        $nodeMsi = "$env:TEMP\node-v20.19.0-x64.msi"
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi" -OutFile $nodeMsi
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn" -Wait
        $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
        Write-OK "Node.js 20 installed"
    }
}

# Git
if (-not $SkipGit) {
    Write-Step "Checking Git..."
    try {
        $gitVer = & git --version 2>$null
        Write-OK "Git already installed: $gitVer"
    } catch {
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
        }
    }
    if (-not $hasVS) {
        Write-Step "Installing Visual Studio Build Tools 2022 with C++ workload (~2GB, ~10 mins)..."
        $vsBuildTools = "$env:TEMP\vs_buildtools.exe"
        Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_buildtools.exe" -OutFile $vsBuildTools
        Start-Process $vsBuildTools -ArgumentList "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" -Wait
        Write-OK "Visual Studio Build Tools installed"
    }
}

# Python (required by node-gyp)
Write-Step "Checking Python..."
try {
    $pyVer = & python --version 2>$null
    Write-OK "Python already installed: $pyVer"
} catch {
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
