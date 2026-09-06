# Puts Jet Set Radio Future and its updater on the current user's Desktop.
#
# The updater gets its own icon because a notice you have to go hunting through
# a folder to act on is a notice most people ignore.
# Called by "Create Desktop Shortcut.bat"; not usually run directly.
param([Parameter(Mandatory = $true)][string]$ProjectDir)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path $ProjectDir).Path
$launcher = Join-Path $project 'Play Jet Set Radio Future.bat'

if (-not (Test-Path -LiteralPath $launcher)) {
	Write-Host "Could not find '$launcher'." -ForegroundColor Red
	Write-Host "Run this from inside the Jet Set Radio Future folder."
	exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$icon = Join-Path $project 'icon.ico'
$shell = New-Object -ComObject WScript.Shell

function New-Link($name, $targetPath, $description) {
	if (-not (Test-Path -LiteralPath $targetPath)) { return }
	$path = Join-Path $desktop $name
	$link = $shell.CreateShortcut($path)
	$link.TargetPath = $targetPath
	$link.WorkingDirectory = $project
	$link.Description = $description
	# Batch launchers open a console first; minimised keeps it out of the way
	# while the browser window comes up.
	$link.WindowStyle = 7
	if (Test-Path -LiteralPath $icon) { $link.IconLocation = $icon }
	$link.Save()
	Write-Host "   Created: $path" -ForegroundColor Green
}

New-Link 'Jet Set Radio Future.lnk' $launcher 'Jet Set Radio Future - cel-shaded skating, up to 4 players'
New-Link 'Update Jet Set Radio Future.lnk' (Join-Path $project 'Update Jet Set Radio Future.bat') `
	'Download the latest version of Jet Set Radio Future'
