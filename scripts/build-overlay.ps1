[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot "native\SpotifyRosettaOverlay"
$outputRoot = Join-Path $projectRoot "native\bin"
$outputFile = Join-Path $outputRoot "SpotifyRosettaOverlay.exe"
$frameworkRoot = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319"
$wpfRoot = Join-Path $frameworkRoot "WPF"
$compiler = Join-Path $frameworkRoot "csc.exe"

if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
  throw "The .NET Framework x64 C# compiler was not found: $compiler"
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
Get-Process -Name SpotifyRosettaOverlay -ErrorAction SilentlyContinue |
  Stop-Process -Force

$references = @(
  (Join-Path $wpfRoot "PresentationFramework.dll"),
  (Join-Path $wpfRoot "PresentationCore.dll"),
  (Join-Path $wpfRoot "WindowsBase.dll"),
  (Join-Path $frameworkRoot "System.Xaml.dll"),
  (Join-Path $frameworkRoot "System.Web.Extensions.dll")
)
$arguments = @(
  "/nologo",
  "/target:winexe",
  "/platform:x64",
  "/optimize+",
  "/out:$outputFile"
)
foreach ($reference in $references) {
  $arguments += "/reference:$reference"
}
$arguments += (Join-Path $sourceRoot "Program.cs")

& $compiler @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Failed to compile the desktop lyrics helper."
}

Write-Host "Built $outputFile"
