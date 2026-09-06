@echo off
REM Gets the latest version, launchers included.
REM
REM This runs itself from a copy in the temp folder. An updater that replaces
REM the files it is running from is an updater that crashes halfway: cmd
REM re-reads a batch file from a byte offset between commands, so rewriting this
REM file mid-run makes it execute whatever now happens to sit at that offset.
REM Working from a copy is what makes the whole install replaceable, launcher
REM included. (PowerShell parses a script fully before running it, so the update
REM script only needs the same treatment to survive its own folder being
REM swapped out.)
setlocal
if /i "%~1"=="__STAGED__" goto :run

if not exist "%~dp0tools\update.ps1" goto :broken
copy /y "%~f0" "%TEMP%\jsrf_update.bat" >nul || goto :nostage
copy /y "%~dp0tools\update.ps1" "%TEMP%\jsrf_update.ps1" >nul || goto :nostage

REM --force reinstalls even when this copy is already current.
set "PASS="
if /i "%~1"=="--force" set "PASS=-Force"

REM No CALL: control transfers to the copy and never comes back here, so
REM nothing further is read from this file.
"%TEMP%\jsrf_update.bat" __STAGED__ "%~dp0." %PASS%
exit /b 0

:run
title Jet Set Radio Future - Update
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\jsrf_update.ps1" -ProjectDir %2 -Full %3
echo.
echo   Press any key to close.
pause >nul
exit /b 0

:nostage
echo.
echo   Could not stage the updater in your temp folder.
echo   Press any key to close.
pause >nul
exit /b 1

:broken
echo.
echo   tools\update.ps1 is missing, so this copy cannot update itself.
echo   Download the game fresh and run Setup.bat.
echo.
echo   Press any key to close.
pause >nul
exit /b 1
