@echo off
REM Writes a text file describing this install, for when something is wrong and
REM a description over the phone is not getting anywhere.
setlocal
cd /d "%~dp0"
set "OUT=%~dp0diagnostics.txt"

echo Jet Set Radio Future - diagnostics> "%OUT%"
echo Generated: %DATE% %TIME%>> "%OUT%"
echo.>> "%OUT%"
echo Folder: %~dp0>> "%OUT%"
echo.>> "%OUT%"

echo == Installed version ==>> "%OUT%"
if exist "%~dp0version.json" (type "%~dp0version.json">> "%OUT%") else (echo no version.json>> "%OUT%")
echo.>> "%OUT%"

echo == Game file ==>> "%OUT%"
if exist "%~dp0game\JetSetRadioFuture.html" (
  for %%F in ("%~dp0game\JetSetRadioFuture.html") do echo %%~zF bytes, modified %%~tF>> "%OUT%"
) else (
  echo MISSING - run Setup.bat>> "%OUT%"
)
echo.>> "%OUT%"

echo == Folder contents ==>> "%OUT%"
dir /b "%~dp0">> "%OUT%"
echo.>> "%OUT%"
echo == tools ==>> "%OUT%"
dir /b "%~dp0tools" 2>nul>> "%OUT%"
echo.>> "%OUT%"

echo == Browsers found ==>> "%OUT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$b=@($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA); $r=@('Google\Chrome\Application\chrome.exe','Microsoft\Edge\Application\msedge.exe','BraveSoftware\Brave-Browser\Application\brave.exe'); $f=$false; foreach($x in $r){foreach($y in $b){if($y -and (Test-Path \"$y\$x\")){Write-Output \"$y\$x\"; $f=$true}}}; if(-not $f){Write-Output 'none found - the default browser will be used'}" >> "%OUT%" 2>&1
echo.>> "%OUT%"

echo == Can this PC reach GitHub? ==>> "%OUT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $r=Invoke-RestMethod -Uri 'https://api.github.com/repos/jacobf329/JSRF' -Headers @{'User-Agent'='JSRF-Diagnose'} -TimeoutSec 15; Write-Output ('yes - default branch ' + $r.default_branch)}catch{Write-Output ('no - ' + $_.Exception.Message)}" >> "%OUT%" 2>&1
echo.>> "%OUT%"

echo == PowerShell ==>> "%OUT%"
powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()" >> "%OUT%" 2>&1

echo.
echo   Saved: %OUT%
echo   Send that file over and it should say what is wrong.
echo.
echo   Press any key to close.
pause >nul
start "" notepad "%OUT%"
