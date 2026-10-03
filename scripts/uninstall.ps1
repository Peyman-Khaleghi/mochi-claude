# Removes Mochi completely. Normally run through uninstall.cmd.
#   1. Mochi itself takes its hooks out of Claude Code's settings (with a backup), stops
#      starting with Windows, and deletes its relay (see main.ts → uninstall).
#   2. This script deletes the program, its Start menu entry and its data.
# The source folder you installed from is left as it is.

param(
    [string]$Destination = (Join-Path $env:LOCALAPPDATA "Programs\Mochi Claude")
)

$ErrorActionPreference = "Stop"
$exe = Join-Path $Destination "mochi-claude.exe"

Get-Process -Name "mochi-claude" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

if (Test-Path $exe) {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Start-Process $exe -ArgumentList "--uninstall" -Wait
}

Remove-Item (Join-Path ([Environment]::GetFolderPath("Programs")) "Mochi Claude.lnk") -ErrorAction SilentlyContinue
Remove-Item $Destination -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:APPDATA "mochi-claude") -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Mochi is removed."
