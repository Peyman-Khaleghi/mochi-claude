@echo off
rem Removes Mochi: its hooks in Claude Code's settings (with a backup), starting with
rem Windows, the program and its Start menu entry. This source folder is left as it is.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uninstall.ps1
pause
