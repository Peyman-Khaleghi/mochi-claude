# Installs Mochi for the current Windows user, from the program packaged in release\.
# Normally run through install.cmd, which builds and packages it first.
#
# No administrator rights: everything goes under your own user folders.
#   the program           %LOCALAPPDATA%\Programs\Mochi Claude\
#   Start menu            "Mochi Claude"
#   starts with Windows   turned on now; the tray menu turns it off
#
# Installing again (after pulling a newer version) replaces the old copy the same way.

param(
    [string]$Destination = (Join-Path $env:LOCALAPPDATA "Programs\Mochi Claude"),
    # For trying the script out: only copy the program; no Start menu entry, don't start it.
    [switch]$CopyOnly
)

$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "..\release\Mochi Claude-win32-x64"
if (-not (Test-Path (Join-Path $source "mochi-claude.exe"))) {
    throw "No packaged program in $source. Run: pnpm run package"
}

if (-not $CopyOnly) {
    # A running Mochi keeps its files open, so close it first: an installed copy, or one
    # started from source with `pnpm start`. Any card it was showing goes back to VS Code.
    Get-Process -Name "mochi-claude" -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
        Where-Object { $_.CommandLine -like "*mochi-claude*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
}

if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
New-Item -ItemType Directory -Force (Split-Path $Destination) | Out-Null
Copy-Item $source $Destination -Recurse
$exe = Join-Path $Destination "mochi-claude.exe"

if (-not $CopyOnly) {
    $shortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Mochi Claude.lnk"
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    $link.TargetPath = $exe
    $link.WorkingDirectory = $Destination
    $link.Description = "Mochi: which Claude Code window needs you"
    $link.Save()

    # VS Code sets ELECTRON_RUN_AS_NODE for the programs it starts; Mochi must not inherit it.
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Start-Process $exe -ArgumentList "--start-with-windows"
}

Write-Host "Mochi is installed in $Destination"
