@echo off
rem Builds Mochi from this source and installs it for you. No administrator rights.
rem Needs Node.js. Uses pnpm if you have it, otherwise fetches it through npx.
rem Run it again after pulling a newer version: it replaces the installed copy.

cd /d "%~dp0"

set "PNPM=pnpm"
where pnpm >nul 2>nul || set "PNPM=npx --yes pnpm@10"

echo [1/3] Installing what the build needs...
call %PNPM% install || goto failed

echo [2/3] Building the program...
call %PNPM% run package || goto failed

echo [3/3] Installing it...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1 || goto failed

echo.
echo Mochi is installed and running: look at the top of your screen.
echo It is in the Start menu as "Mochi Claude" and starts with Windows.
pause
exit /b 0

:failed
echo.
echo Installing stopped. The messages above say why.
pause
exit /b 1
