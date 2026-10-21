@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\manage-suite.ps1
echo.
echo After current tasks finish, fully quit DSH from the tray and launch it again.
pause
