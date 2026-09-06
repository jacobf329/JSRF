# Keeps an installed copy of the game current with the published one.
#
# The game ships as a single self-contained HTML file, so an update is one small
# API call and -- only when there is news -- one zip download. Run through
# "Update Jet Set Radio Future.bat" rather than directly when you want the
# launcher scripts replaced too; that stages a copy in the temp folder first, so
# the update is free to replace every file in the install.
param(
	[Parameter(Mandatory = $true)][string]$ProjectDir,
	# Report whether an update exists, install nothing. Used by the launcher.
	[switch]$CheckOnly,
	# Download and install if there is news.
	[switch]$Apply,
	# Install even when this copy is already current.
	[switch]$Force,
	# Write down what is current without downloading. Setup uses this so a fresh
	# copy knows its own version and later checks have something to compare to.
	[switch]$RecordOnly,
	# Also replace the root launcher scripts. Only safe from a staged copy --
	# see the comment on $Protected below.
	[switch]$Full,
	# Seconds to wait on GitHub. Short for the launcher's check, which must not
	# stand between somebody and their game.
	[int]$TimeoutSec = 20
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 still negotiates TLS 1.0 on some builds, which GitHub
# refuses; set it once for every request this script makes.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# Same reason as Expand-Zip below: on Windows PowerShell 5.1 the progress bar is
# redrawn synchronously and can dominate the runtime of a web request entirely.
$ProgressPreference = 'SilentlyContinue'

$Owner = 'jacobf329'
$Repo = 'JSRF'
$DefaultBranch = 'claude/jet-set-radio-future-hd1kfg'

# Files the repository does not own, and so must survive an update.
$Keep = @('version.json', 'no_update_check.txt', 'branch.txt', 'launch_log.txt', 'browser-profile')

# cmd and bash both re-read a script from a byte offset between commands, so a
# launcher that rewrites itself mid-run goes on to execute whatever now sits at
# that offset. A normal update therefore leaves the root launchers alone; the
# staged updater passes -Full to replace them safely.
$Protected = @('*.bat', '*.command', '*.sh')

$Api = "https://api.github.com/repos/$Owner/$Repo"
$Headers = @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'JSRF-Updater' }


function Get-Branch($project) {
	$pinned = Join-Path $project 'branch.txt'
	if (Test-Path -LiteralPath $pinned) {
		$name = (Get-Content -LiteralPath $pinned -Raw).Trim()
		if ($name) { return $name }
	}
	return $DefaultBranch
}


function Get-RemoteHead($branch) {
	try {
		$commit = Invoke-RestMethod -Uri "$Api/commits/$branch" -Headers $Headers -TimeoutSec $TimeoutSec
	}
	catch {
		# The development branch may have been merged and deleted; follow the
		# repository's own default rather than giving up on updates forever.
		$repo = Invoke-RestMethod -Uri $Api -Headers $Headers -TimeoutSec $TimeoutSec
		$branch = $repo.default_branch
		$commit = Invoke-RestMethod -Uri "$Api/commits/$branch" -Headers $Headers -TimeoutSec $TimeoutSec
	}
	return [pscustomobject]@{
		sha     = $commit.sha
		subject = ($commit.commit.message -split "`n")[0]
		date    = $commit.commit.author.date
		branch  = $branch
	}
}


function Get-LocalVersion($project) {
	$path = Join-Path $project 'version.json'
	if (-not (Test-Path -LiteralPath $path)) { return $null }
	try { $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { return $null }
	# A half-written or hand-edited file should read as "no version known",
	# not blow up on a Substring later.
	if (-not $record.sha -or $record.sha.Length -lt 7) { return $null }
	return $record
}


function Save-LocalVersion($project, $head) {
	[pscustomobject]@{
		sha       = $head.sha
		subject   = $head.subject
		committed = $head.date
		branch    = $head.branch
		updated   = (Get-Date).ToString('s')
	} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $project 'version.json') -Encoding UTF8
}


## Commit subjects between what is installed and what is arriving, so an update
## says what it brought rather than just "done".
function Get-Changes($from, $to) {
	if (-not $from) { return @() }
	try {
		$compare = Invoke-RestMethod -Uri "$Api/compare/$from...$to" -Headers $Headers -TimeoutSec 20
		return @($compare.commits | ForEach-Object { ($_.commit.message -split "`n")[0] })
	}
	catch { return @() }
}


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

function Install-Head($project, $head, $full) {
	$temp = Join-Path ([IO.Path]::GetTempPath()) ("jsrf_" + [Guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $temp -Force | Out-Null
	try {
		$zip = Join-Path $temp 'game.zip'
		# -UseBasicParsing: 5.1 otherwise leans on the Internet Explorer engine,
		# which is not present on every machine.
		Invoke-WebRequest -Uri "https://codeload.github.com/$Owner/$Repo/zip/$($head.sha)" `
			-Headers @{ 'User-Agent' = 'JSRF-Updater' } -OutFile $zip -TimeoutSec 180 -UseBasicParsing
		Expand-Zip $zip $temp

		$source = Get-ChildItem -LiteralPath $temp -Directory | Select-Object -First 1
		if (-not $source) { throw 'the download did not contain a game folder' }

		# Refuse to install a download that is missing the thing being installed:
		# a truncated fetch must not replace a working copy with a broken one.
		$gameFile = Join-Path (Join-Path $source.FullName 'game') 'JetSetRadioFuture.html'
		if (-not (Test-Path -LiteralPath $gameFile) -or (Get-Item -LiteralPath $gameFile).Length -lt 100KB) {
			throw 'the download did not contain a usable game file'
		}

		$root = $source.FullName.TrimEnd('\', '/')
		foreach ($item in Get-ChildItem -LiteralPath $root -Recurse -File) {
			# Compare on '/' so the same code works wherever it is tested.
			$relative = $item.FullName.Substring($root.Length + 1) -replace '[\\/]', '/'
			$parts = $relative -split '/'
			$name = $parts[-1]

			if ($Keep -contains $name) { continue }
			if ($relative -like '.git/*' -or $relative -like 'node_modules/*') { continue }
			if (-not $full -and $parts.Count -eq 1) {
				$skip = $false
				foreach ($pattern in $Protected) { if ($name -like $pattern) { $skip = $true } }
				if ($skip) { continue }
			}

			$destination = $project
			foreach ($part in $parts) { $destination = Join-Path $destination $part }
			$parent = Split-Path $destination -Parent
			if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
			Copy-Item -LiteralPath $item.FullName -Destination $destination -Force
		}

		Save-LocalVersion $project $head
	}
	finally {
		Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
	}
}


$project = (Resolve-Path $ProjectDir).Path
$local = Get-LocalVersion $project
$branch = Get-Branch $project

# --- Record only: note what is current, download nothing ---

if ($RecordOnly) {
	try { Save-LocalVersion $project (Get-RemoteHead $branch) } catch { }
	exit 0
}

# --- Check only: one line if there is news, silence otherwise ---

if ($CheckOnly) {
	try { $head = Get-RemoteHead $branch } catch { exit 0 }   # offline is not an error here
	if (-not $local -or $local.sha -eq $head.sha) { exit 0 }
	Write-Host ""
	Write-Host "   There is a newer version: $($head.subject)" -ForegroundColor Yellow
	Write-Host "   Use the 'Update Jet Set Radio Future' icon to get it." -ForegroundColor Yellow
	Write-Host ""
	exit 3
}

# --- Apply: the launcher's quiet auto-update ---

if ($Apply -and -not $Force) {
	try { $head = Get-RemoteHead $branch } catch { exit 0 }   # offline: play what is here
	if ($local -and $local.sha -eq $head.sha) { exit 0 }
	if (-not $local) {
		# Nothing to compare against: adopt this version without a download.
		Save-LocalVersion $project $head
		exit 0
	}
	Write-Host "   Updating: $($head.subject)"
	try {
		Install-Head $project $head $Full
		Write-Host "   Updated." -ForegroundColor Green
	}
	catch {
		Write-Host "   Update failed ($($_.Exception.Message)). Playing the copy you have." -ForegroundColor DarkYellow
	}
	exit 0
}

# --- Interactive update, from the Update icon ---

Write-Host ""
Write-Host "   Jet Set Radio Future - update" -ForegroundColor Cyan
Write-Host "   -----------------------------"
Write-Host ""

try { $head = Get-RemoteHead $branch }
catch {
	Write-Host "   Could not reach GitHub. Check your internet connection and try again." -ForegroundColor Red
	Write-Host ""
	exit 1
}

if ($local -and $local.sha -eq $head.sha -and -not $Force) {
	Write-Host "   Already up to date." -ForegroundColor Green
	Write-Host "   ($($local.subject))"
	Write-Host ""
	exit 0
}

$previousSha = $null
if ($local) { $previousSha = $local.sha }
$changes = Get-Changes $previousSha $head.sha
if ($changes.Count -gt 0) {
	Write-Host "   What's new:"
	foreach ($line in ($changes | Select-Object -Last 12)) { Write-Host "     - $line" }
	Write-Host ""
}

Write-Host "   Downloading..."
try {
	Install-Head $project $head $true
}
catch {
	Write-Host "   Update failed: $($_.Exception.Message)" -ForegroundColor Red
	Write-Host "   Your existing copy is untouched, so you can still play." -ForegroundColor DarkYellow
	Write-Host ""
	exit 1
}

Write-Host "   Updated to: $($head.subject)" -ForegroundColor Green
Write-Host ""
exit 0
