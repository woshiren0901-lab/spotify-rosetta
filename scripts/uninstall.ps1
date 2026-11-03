[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [switch]$RestoreSpotify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExtensionName = "spotify-rosetta.js"
$SpicetifyExe = Join-Path $env:LOCALAPPDATA "spicetify\spicetify.exe"
$SpicetifyWingetLink = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\spicetify.exe"
$SpicetifyWingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
$configRoots = @(
  (Join-Path $env:APPDATA "spicetify"),
  (Join-Path $env:LOCALAPPDATA "spicetify")
)

$spicetify = if (Test-Path -LiteralPath $SpicetifyExe -PathType Leaf) {
  $SpicetifyExe
} elseif (Test-Path -LiteralPath $SpicetifyWingetLink -PathType Leaf) {
  $SpicetifyWingetLink
} elseif (Test-Path -LiteralPath $SpicetifyWingetPackages -PathType Container) {
  $wingetExecutable = Get-ChildItem -LiteralPath $SpicetifyWingetPackages `
    -Filter "spicetify.exe" -File -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($wingetExecutable) { $wingetExecutable.FullName } else { $null }
} else {
  $command = Get-Command spicetify -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($command) { $command.Source } else { $null }
}

if (Get-Process -Name Spotify -ErrorAction SilentlyContinue) {
  throw "请先完全退出 Spotify，然后重新运行卸载脚本。"
}

foreach ($root in $configRoots) {
  $extensionPath = Join-Path $root "Extensions\$ExtensionName"
  if (Test-Path -LiteralPath $extensionPath -PathType Leaf) {
    if ($PSCmdlet.ShouldProcess($extensionPath, "删除 Rosetta 扩展文件")) {
      Remove-Item -LiteralPath $extensionPath -Force
    }
  }
}

if ($spicetify) {
  if ($PSCmdlet.ShouldProcess("Spicetify 配置", "移除 Rosetta 扩展配置")) {
    & $spicetify config extensions "$ExtensionName-"
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "无法自动移除扩展配置，请在 Spicetify 配置中手动移除 $ExtensionName。"
    } else {
      & $spicetify apply
      if ($LASTEXITCODE -ne 0) {
        Write-Warning "spicetify apply 失败；Spotify 更新后请重新执行。"
      }
    }
  }
}

if ($RestoreSpotify -and $spicetify) {
  if ($PSCmdlet.ShouldProcess("Spotify", "从 Spicetify 备份恢复客户端")) {
    & $spicetify restore
    if ($LASTEXITCODE -ne 0) {
      throw "Spicetify restore 失败。"
    }
  }
}

Write-Host "Spotify Rosetta 已移除。" -ForegroundColor Green

