@echo off
setlocal
cd /d "%~dp0"
echo.
echo   Putting Jet Set Radio Future on your Desktop...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\create_shortcut.ps1" -ProjectDir "%~dp0."
echo.
echo   Press any key to close.
pause >nul
