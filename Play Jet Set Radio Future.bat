@echo off
REM Deliberately tiny and stable: cmd re-reads a batch file from a byte offset
REM between commands, so an update that rewrote this file mid-run would send it
REM off to execute whatever now sits at that offset. Nothing here changes, and
REM the auto-update leaves the root launchers alone for exactly that reason --
REM the "Update Jet Set Radio Future" icon replaces them from a staged copy.
setlocal
cd /d "%~dp0"
title Jet Set Radio Future

echo.
echo   Jet Set Radio Future
echo   --------------------
echo.

if not exist "%~dp0tools\launch.ps1" goto :broken
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch.ps1" -ProjectDir "%~dp0." %*
exit /b %errorlevel%

:broken
echo   This copy is incomplete - tools\launch.ps1 is missing.
echo.
echo   Download the game again and run Setup.bat.
echo.
echo   Press any key to close.
pause >nul
exit /b 1
