[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [switch]$SkipBuild,
  [switch]$NoRestart,
  [switch]$UseNpmMirror
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ExtensionName = "spotify-rosetta.js"
$SpotifyPath = Join-Path $env:APPDATA "Spotify\Spotify.exe"
$SpicetifyExe = Join-Path $env:LOCALAPPDATA "spicetify\spicetify.exe"
$SpicetifyWingetLink = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\spicetify.exe"
$SpicetifyWingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
$SpicetifyConfigRoot = Join-Path $env:APPDATA "spicetify"
$SpicetifyExtensions = Join-Path $SpicetifyConfigRoot "Extensions"
$DistFile = Join-Path $ProjectRoot "dist\$ExtensionName"
$OverlaySource = Join-Path $ProjectRoot "native\bin\SpotifyRosettaOverlay.exe"
$OverlayInstallRoot = Join-Path $env:LOCALAPPDATA "SpotifyRosetta"
$OverlayInstallFile = Join-Path $OverlayInstallRoot "SpotifyRosettaOverlay.exe"
$OverlayProtocolRoot = "HKCU:\Software\Classes\spotify-rosetta-overlay"
$OverlayRunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$OverlayRunValue = "SpotifyRosettaOverlay"

function Assert-NotAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "请不要以管理员身份运行 Spicetify。关闭管理员终端后重试。"
  }
}

function Resolve-Spicetify {
  if (Test-Path -LiteralPath $SpicetifyExe -PathType Leaf) {
    return $SpicetifyExe
  }
  if (Test-Path -LiteralPath $SpicetifyWingetLink -PathType Leaf) {
    return $SpicetifyWingetLink
  }
  if (Test-Path -LiteralPath $SpicetifyWingetPackages -PathType Container) {
    $wingetExecutable = Get-ChildItem -LiteralPath $SpicetifyWingetPackages `
      -Filter "spicetify.exe" -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($wingetExecutable) {
      return $wingetExecutable.FullName
    }
  }
  $command = Get-Command spicetify -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($command) {
    return $command.Source
  }
  return $null
}

function Install-SpicetifyRelease {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "尝试通过 winget 安装 Spicetify..." -ForegroundColor Cyan
    $wingetOutput = & winget install --id Spicetify.Spicetify --exact `
      --accept-package-agreements --accept-source-agreements `
      --disable-interactivity --silent 2>&1
    $wingetOutput | ForEach-Object { Write-Host $_ }
    $resolved = Resolve-Spicetify
    if ($resolved) {
      return $resolved
    }
  }

  Write-Host "从 Spicetify 官方 GitHub Release 下载..." -ForegroundColor Cyan
  $release = Invoke-RestMethod `
    -Headers @{ "User-Agent" = "Spotify-Rosetta-Installer" } `
    -Uri "https://api.github.com/repos/spicetify/cli/releases/latest"
  $version = [string]$release.tag_name
  $version = $version.TrimStart("v")
  if (-not $version) {
    throw "无法确定 Spicetify 最新版本。"
  }

  $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
    "arm64"
  } elseif ($env:PROCESSOR_ARCHITECTURE -eq "AMD64") {
    "x64"
  } else {
    "x32"
  }
  $downloadUrl = "https://github.com/spicetify/cli/releases/download/v$version/spicetify-$version-windows-$architecture.zip"
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("spotify-rosetta-" + [Guid]::NewGuid().ToString("N"))
  $archivePath = Join-Path $tempRoot "spicetify.zip"
  $installRoot = Split-Path -Parent $SpicetifyExe

  try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $installRoot -Force
  } finally {
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  $resolved = Resolve-Spicetify
  if (-not $resolved) {
    throw "Spicetify 安装后仍未找到 spicetify.exe。"
  }
  return $resolved
}

function Invoke-Spicetify {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Spicetify 命令失败，退出码：$LASTEXITCODE"
  }
}

Assert-NotAdministrator

if (-not (Test-Path -LiteralPath $SpotifyPath -PathType Leaf)) {
  throw "没有在 $SpotifyPath 找到标准桌面版 Spotify。请先从 spotify.com 安装，不能使用 Microsoft Store 版。"
}

$spotifyProcess = Get-Process -Name Spotify -ErrorAction SilentlyContinue
if ($spotifyProcess) {
  throw "请先完全退出 Spotify，然后重新运行安装脚本。"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "未找到 Node.js。请安装 Node.js 18 或更高版本。"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "未找到 npm。"
}

if (-not $SkipBuild) {
  $npmArguments = @("install", "--fetch-timeout=30000", "--fetch-retries=1")
  if ($UseNpmMirror) {
    $npmArguments += @("--registry=https://registry.npmmirror.com")
  }
  if ($PSCmdlet.ShouldProcess($ProjectRoot, "安装 npm 依赖")) {
    Push-Location $ProjectRoot
    try {
      & npm @npmArguments
      if ($LASTEXITCODE -ne 0) {
        throw "npm install 失败。"
      }
      & npm run typecheck
      if ($LASTEXITCODE -ne 0) {
        throw "TypeScript 类型检查失败。"
      }
      & npm test
      if ($LASTEXITCODE -ne 0) {
        throw "自动化测试失败。"
      }
      & npm run build
      if ($LASTEXITCODE -ne 0) {
        throw "扩展构建失败。"
      }
    } finally {
      Pop-Location
    }
  }
}

if (-not (Test-Path -LiteralPath $DistFile -PathType Leaf)) {
  throw "构建产物不存在：$DistFile"
}
if (-not (Test-Path -LiteralPath $OverlaySource -PathType Leaf)) {
  throw "原生桌面歌词组件不存在：$OverlaySource"
}

$spicetify = Resolve-Spicetify
if (-not $spicetify) {
  if (-not $PSCmdlet.ShouldProcess("Spicetify", "安装 Spicetify CLI")) {
    return
  }
  $spicetify = Install-SpicetifyRelease
}

$configFileCandidates = @(
  (Join-Path $env:APPDATA "spicetify\config-xpui.ini"),
  (Join-Path $env:LOCALAPPDATA "spicetify\config-xpui.ini")
)
$hasSpicetifyConfig = $configFileCandidates |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1

if (-not $hasSpicetifyConfig) {
  if ($PSCmdlet.ShouldProcess($SpotifyPath, "备份 Spotify 并首次应用 Spicetify")) {
    Write-Host "首次初始化 Spicetify，并备份 Spotify 文件..." -ForegroundColor Cyan
    Invoke-Spicetify $spicetify "backup" "apply" "enable-devtools"
  }
  $hasSpicetifyConfig = $configFileCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
}

if ($hasSpicetifyConfig) {
  $SpicetifyConfigRoot = Split-Path -Parent $hasSpicetifyConfig
  $SpicetifyExtensions = Join-Path $SpicetifyConfigRoot "Extensions"
}

if ($PSCmdlet.ShouldProcess($SpicetifyExtensions, "复制 Spotify Rosetta 扩展")) {
  New-Item -ItemType Directory -Path $SpicetifyExtensions -Force | Out-Null
  Copy-Item -LiteralPath $DistFile -Destination (Join-Path $SpicetifyExtensions $ExtensionName) -Force
}

if ($PSCmdlet.ShouldProcess($OverlayInstallRoot, "安装原生桌面歌词组件并注册后台启动")) {
  New-Item -ItemType Directory -Path $OverlayInstallRoot -Force | Out-Null
  Get-Process -Name SpotifyRosettaOverlay -ErrorAction SilentlyContinue |
    Stop-Process -Force
  Copy-Item -LiteralPath $OverlaySource -Destination $OverlayInstallFile -Force

  if (Test-Path -LiteralPath $OverlayProtocolRoot) {
    Remove-Item -LiteralPath $OverlayProtocolRoot -Recurse -Force
  }

  New-Item -Path $OverlayRunKey -Force | Out-Null
  New-ItemProperty -Path $OverlayRunKey -Name $OverlayRunValue `
    -Value "`"$OverlayInstallFile`" --background" `
    -PropertyType String -Force | Out-Null

  Start-Process -FilePath $OverlayInstallFile -ArgumentList "--background" `
    -WindowStyle Hidden
}

if ($PSCmdlet.ShouldProcess("Spicetify 配置", "启用 Spotify Rosetta")) {
  Invoke-Spicetify $spicetify "config" "extensions" $ExtensionName
  Invoke-Spicetify $spicetify "apply"
}

Write-Host ""
Write-Host "Spotify Rosetta 安装完成。" -ForegroundColor Green
Write-Host "扩展文件：$(Join-Path $SpicetifyExtensions $ExtensionName)"
Write-Host "桌面歌词组件：$OverlayInstallFile"
Write-Host "右键播放栏 Rosetta 按钮可打开设置和手动选源。"

if (-not $NoRestart) {
  if ($PSCmdlet.ShouldProcess("Spotify", "启动客户端")) {
    Start-Process -FilePath $SpotifyPath
  }
}

