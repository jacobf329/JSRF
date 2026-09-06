# Opens the game.
#
# The game is one self-contained HTML file, so "launching" means handing it to a
# browser. Chrome and Edge get it in app mode -- its own window, no tabs, no
# address bar -- which is the difference between something that feels like a game
# and something that feels like a web page. Anything else falls back to the
# default browser.
param(
	[Parameter(Mandatory = $true)][string]$ProjectDir,
	# Skip the update check for this launch.
	[switch]$NoUpdate,
	# Open in the default browser even if Chrome or Edge is present.
	[switch]$Tab
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path $ProjectDir).Path
$game = Join-Path $project 'game\JetSetRadioFuture.html'


function Find-Browser {
	$candidates = @(
		(Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
		(Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
		(Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
		(Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
		(Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
		(Join-Path $env:ProgramFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
		(Join-Path ${env:ProgramFiles(x86)} 'BraveSoftware\Brave-Browser\Application\brave.exe')
	)
	foreach ($path in $candidates) {
		if ($path -and (Test-Path -LiteralPath $path)) { return $path }
	}
	return $null
}


# --- update ---

if (-not $NoUpdate -and -not (Test-Path -LiteralPath (Join-Path $project 'no_update_check.txt'))) {
	Write-Host "   Checking for updates..."
	try {
		& (Join-Path $PSScriptRoot 'update.ps1') -ProjectDir $project -Apply -TimeoutSec 8
	}
	catch { }   # never let the update check stand between somebody and their game
}

# --- launch ---

if (-not (Test-Path -LiteralPath $game)) {
	Write-Host ""
	Write-Host "   The game file is missing:" -ForegroundColor Red
	Write-Host "   $game"
	Write-Host ""
	Write-Host "   Run Setup.bat in this folder to fetch it."
	Write-Host ""
	Write-Host "   Press any key to close."
	[void][Console]::ReadKey($true)
	exit 1
}

# file:/// wants forward slashes, and spaces in the path have to survive being
# passed through a command line.
$url = 'file:///' + ($game -replace '\\', '/')
$browser = if ($Tab) { $null } else { Find-Browser }

if ($browser) {
	# A dedicated profile guarantees a real app window even when the browser is
	# already running with the user's own session, and keeps the game's storage
	# out of their everyday profile.
	$profileDir = Join-Path $project 'browser-profile'
	Write-Host "   Starting Jet Set Radio Future..."
	Start-Process -FilePath $browser -ArgumentList @(
		"--app=$url",
		"--user-data-dir=`"$profileDir`"",
		'--window-size=1600,900',
		'--no-first-run',
		'--no-default-browser-check'
	)
}
else {
	Write-Host "   Starting Jet Set Radio Future in your default browser..."
	Start-Process -FilePath $game
}

exit 0
