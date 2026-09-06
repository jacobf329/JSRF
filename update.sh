#!/usr/bin/env bash
# Updates an installed copy of Jet Set Radio Future to the latest published one.
#
# Run it through "Update Jet Set Radio Future.command" (or with --full) when you
# want the launcher scripts replaced too: bash re-reads a script from a byte
# offset as it runs, so a launcher that rewrites itself mid-run goes on to
# execute whatever now sits at that offset. A plain update therefore leaves the
# root .sh/.command files alone.
set -uo pipefail
cd "$(dirname "$0")"
PROJECT="$(pwd)"

OWNER="jacobf329"
REPO="JSRF"
DEFAULT_BRANCH="claude/jet-set-radio-future-hd1kfg"

QUIET=0
FORCE=0
FULL=0
for arg in "$@"; do
	case "$arg" in
	--quiet) QUIET=1 ;;
	--force) FORCE=1 ;;
	--full) FULL=1 ;;
	esac
done

say() { [ "$QUIET" -eq 1 ] || echo "$@"; }

if ! command -v curl >/dev/null 2>&1; then
	say "  curl is not installed, so this copy cannot check for updates."
	exit 0
fi

BRANCH="$DEFAULT_BRANCH"
[ -f branch.txt ] && BRANCH="$(head -n1 branch.txt | tr -d '\r\n ')"

first_sha() { grep -o '"sha"[[:space:]]*:[[:space:]]*"[0-9a-f]\{40\}"' | head -1 | grep -o '[0-9a-f]\{40\}'; }

fetch_head() {
	local body
	body="$(curl -fsSL --max-time "${1:-20}" \
		-H 'Accept: application/vnd.github+json' -H 'User-Agent: JSRF-Updater' \
		"https://api.github.com/repos/$OWNER/$REPO/commits/$BRANCH" 2>/dev/null)" || return 1
	printf '%s' "$body" | first_sha
}

REMOTE="$(fetch_head 20 || true)"
if [ -z "${REMOTE:-}" ]; then
	# The development branch may have been merged and deleted; follow the
	# repository's own default rather than giving up on updates forever.
	BRANCH="$(curl -fsSL --max-time 20 -H 'User-Agent: JSRF-Updater' \
		"https://api.github.com/repos/$OWNER/$REPO" 2>/dev/null |
		grep -o '"default_branch"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 |
		sed 's/.*"\([^"]*\)"$/\1/')"
	[ -n "${BRANCH:-}" ] && REMOTE="$(fetch_head 20 || true)"
fi

if [ -z "${REMOTE:-}" ]; then
	say "  Could not reach GitHub. Playing the copy you have."
	exit 0
fi

LOCAL=""
[ -f version.json ] && LOCAL="$(first_sha < version.json || true)"

write_version() {
	printf '{\n  "sha": "%s",\n  "branch": "%s",\n  "updated": "%s"\n}\n' \
		"$REMOTE" "$BRANCH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PROJECT/version.json"
}

if [ -z "$LOCAL" ] && [ "$FORCE" -eq 0 ] && [ ! -f "$PROJECT/game/JetSetRadioFuture.html" ]; then
	FORCE=1   # nothing installed yet: fetch it
fi

if [ -z "$LOCAL" ] && [ "$FORCE" -eq 0 ]; then
	write_version   # adopt this version without a download
	exit 0
fi

if [ "$LOCAL" = "$REMOTE" ] && [ "$FORCE" -eq 0 ]; then
	say "  Already up to date."
	exit 0
fi

say "  Updating..."

TEMP="$(mktemp -d 2>/dev/null || mktemp -d -t jsrf)"
trap 'rm -rf "$TEMP"' EXIT

if ! curl -fsSL --max-time 300 -H 'User-Agent: JSRF-Updater' \
	"https://codeload.github.com/$OWNER/$REPO/zip/$REMOTE" -o "$TEMP/game.zip"; then
	say "  Download failed. Playing the copy you have."
	exit 0
fi

if command -v unzip >/dev/null 2>&1; then
	unzip -qo "$TEMP/game.zip" -d "$TEMP" || { say "  Could not unpack the download."; exit 0; }
else
	(cd "$TEMP" && tar -xf game.zip) || { say "  Could not unpack the download."; exit 0; }
fi

SRC="$(find "$TEMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
if [ -z "$SRC" ] || [ ! -s "$SRC/game/JetSetRadioFuture.html" ]; then
	say "  The download did not contain a usable game file. Playing the copy you have."
	exit 0
fi

# Files the repository does not own, and so must survive an update.
KEEP="version.json no_update_check.txt branch.txt launch_log.txt browser-profile"

(cd "$SRC" && find . -type f -print0) | while IFS= read -r -d '' rel; do
	rel="${rel#./}"
	name="$(basename "$rel")"
	case " $KEEP " in *" $name "*) continue ;; esac
	case "$rel" in .git/*|node_modules/*) continue ;; esac
	if [ "$FULL" -eq 0 ] && [ "$rel" = "$name" ]; then
		# A root-level launcher; see the note at the top of this file.
		case "$name" in *.sh|*.command|*.bat) continue ;; esac
	fi
	mkdir -p "$PROJECT/$(dirname "$rel")"
	cp -f "$SRC/$rel" "$PROJECT/$rel"
done

chmod +x "$PROJECT"/*.sh "$PROJECT"/*.command 2>/dev/null || true
write_version
say "  Updated."
exit 0
