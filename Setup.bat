@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Jet Set Radio Future Setup

echo.
echo   ============================================
echo     Jet Set Radio Future - first-time setup
echo   ============================================
echo.
echo   This does three things:
echo     1. Makes sure the game file is here
echo     2. Puts the game and its updater on your Desktop
echo     3. Notes which version you have, so the launcher can
echo        update you automatically from then on
echo.
echo   Nothing gets installed. There is no engine to download and
echo   no runtime to add - the game is a single file your browser
echo   opens, and everything it needs is inside it.
echo.

if not exist "%~dp0tools\update.ps1" goto :incomplete
if not exist "%~dp0tools\create_shortcut.ps1" goto :incomplete

if exist "%~dp0game\JetSetRadioFuture.html" goto :have_game

echo   [1/3] The game file is not here yet. Fetching it...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1" -ProjectDir "%~dp0." -Force -Full
if not exist "%~dp0game\JetSetRadioFuture.html" goto :nogame
goto :game_ready

:have_game
echo   [1/3] Game file found.

:game_ready
echo.
echo   [2/3] Creating the Desktop shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\create_shortcut.ps1" -ProjectDir "%~dp0."
if errorlevel 1 goto :noshortcut

echo.
echo   [3/3] Noting the current version...
REM Best effort -- an offline setup just stays quiet about updates until the
REM next launch that can reach GitHub.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1" -ProjectDir "%~dp0." -RecordOnly >nul 2>&1
echo         Done.

echo.
echo   All set. There is now a "Jet Set Radio Future" icon on your
echo   Desktop, and an "Update Jet Set Radio Future" icon next to it.
echo.
echo   Every time you launch, it checks for a new version first and
echo   updates itself if there is one. If you would rather it did not,
echo   put an empty file called no_update_check.txt in this folder.
echo.
echo   Up to 4 players: pick the number on the title screen. Player 1
echo   uses the keyboard, players 2-4 use gamepads (or player 2 can
echo   share the keyboard on the arrow keys and number pad).
echo.
set "PLAY="
set /p "PLAY=  Play now? [Y/N] "
if /i "!PLAY!"=="Y" start "" "%~dp0Play Jet Set Radio Future.bat"
exit /b 0

:nogame
echo.
echo   Setup stopped: the game file could not be downloaded.
echo.
echo   Check your internet connection and run Setup again, or download
echo   the whole folder fresh from:
echo     https://github.com/jacobf329/JSRF
echo.
echo   Press any key to close.
pause >nul
exit /b 1

:noshortcut
echo.
echo   The game is here, but the Desktop shortcut could not be created.
echo   You can still play by double-clicking
echo   "Play Jet Set Radio Future.bat" in this folder.
echo.
echo   Press any key to close.
pause >nul
exit /b 1

:incomplete
echo   This copy is incomplete - the tools folder is missing.
echo.
echo   Download the whole folder again from:
echo     https://github.com/jacobf329/JSRF
echo.
echo   Press any key to close.
pause >nul
exit /b 1
