# One-step installer for Windows. Downloads the game, puts it on your Desktop
# and launches it. Nothing is installed system-wide; everything lives in one
# folder you can delete.
#
#   irm https://raw.githubusercontent.com/jacobf329/JSRF/claude/jet-set-radio-future-hd1kfg/tools/install.ps1 | iex
#
param(
	# Where to put it. Defaults to a per-user folder, no admin rights needed.
	[string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'JetSetRadioFuture'),
	[switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# Same reason as Expand-Zip below: on Windows PowerShell 5.1 the progress bar is
# redrawn synchronously and can dominate the runtime of a web request entirely.
$ProgressPreference = 'SilentlyContinue'

$Owner = 'jacobf329'
$Repo = 'JSRF'
$Branch = 'claude/jet-set-radio-future-hd1kfg'

Write-Host ""
Write-Host "  Jet Set Radio Future - installer" -ForegroundColor Cyan
Write-Host "  --------------------------------"
Write-Host ""
Write-Host "  Installing to: $InstallDir"
Write-Host ""

function Expand-Zip($zip, $destination) {
	# Expand-Archive on Windows PowerShell 5.1 redraws a progress bar for every
	# entry, which turns a two-second unpack into a minute-long stall that looks
	# like a hang. The .NET call underneath it does not.
	try {
		Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
		[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $destination)
	}
	catch {
		Expand-Archive -LiteralPath $zip -DestinationPath $destination -Force
	}
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ("jsrf_install_" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null

try {
	Write-Host "  Downloading..."
	$zip = Join-Path $temp 'game.zip'
	$encoded = [Uri]::EscapeDataString($Branch) -replace '%2F', '/'
	Invoke-WebRequest -Uri "https://codeload.github.com/$Owner/$Repo/zip/refs/heads/$encoded" `
		-Headers @{ 'User-Agent' = 'JSRF-Installer' } -OutFile $zip -TimeoutSec 300 -UseBasicParsing

	Write-Host "  Unpacking..."
	Expand-Zip $zip $temp
	$source = Get-ChildItem -LiteralPath $temp -Directory | Select-Object -First 1
	if (-not $source) { throw 'the download did not contain a game folder' }

	$game = Join-Path $source.FullName 'game\JetSetRadioFuture.html'
	if (-not (Test-Path -LiteralPath $game) -or (Get-Item -LiteralPath $game).Length -lt 100KB) {
		throw 'the download did not contain a usable game file'
	}

	Write-Host "  Installing..."
	if (-not (Test-Path -LiteralPath $InstallDir)) {
		New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
	}
	Copy-Item -Path (Join-Path $source.FullName '*') -Destination $InstallDir -Recurse -Force

	Write-Host "  Creating Desktop shortcuts..."
	& (Join-Path $InstallDir 'tools\create_shortcut.ps1') -ProjectDir $InstallDir

	# So the launcher's update check has something to compare against.
	& (Join-Path $InstallDir 'tools\update.ps1') -ProjectDir $InstallDir -RecordOnly | Out-Null

	Write-Host ""
	Write-Host "  Done." -ForegroundColor Green
	Write-Host "  There is a 'Jet Set Radio Future' icon on your Desktop, and an"
	Write-Host "  'Update Jet Set Radio Future' icon next to it. Launching checks"
	Write-Host "  for a new version first and updates itself if there is one."
	Write-Host ""

	if (-not $NoLaunch) {
		Start-Process -FilePath (Join-Path $InstallDir 'Play Jet Set Radio Future.bat') -WorkingDirectory $InstallDir
	}
}
catch {
	Write-Host ""
	Write-Host "  Install failed: $($_.Exception.Message)" -ForegroundColor Red
	Write-Host "  You can instead download the folder by hand from:"
	Write-Host "    https://github.com/$Owner/$Repo/tree/$Branch"
	Write-Host "  then run Setup.bat inside it."
	Write-Host ""
	exit 1
}
finally {
	Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
