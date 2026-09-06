#!/usr/bin/env bash
# One-step installer for macOS and Linux. Downloads the game, puts it on your
# Desktop and launches it. Nothing is installed system-wide; everything lives in
# one folder you can delete.
#
#   curl -fsSL https://raw.githubusercontent.com/jacobf329/JSRF/claude/jet-set-radio-future-hd1kfg/tools/install.sh | bash
#
set -uo pipefail

OWNER="jacobf329"
REPO="JSRF"
BRANCH="claude/jet-set-radio-future-hd1kfg"
INSTALL_DIR="${JSRF_DIR:-$HOME/Games/JetSetRadioFuture}"
LAUNCH=1
[ "${1:-}" = "--no-launch" ] && LAUNCH=0

echo
echo "  Jet Set Radio Future - installer"
echo "  --------------------------------"
echo
echo "  Installing to: $INSTALL_DIR"
echo

command -v curl >/dev/null 2>&1 || { echo "  curl is required."; exit 1; }

TEMP="$(mktemp -d 2>/dev/null || mktemp -d -t jsrf)"
trap 'rm -rf "$TEMP"' EXIT

echo "  Downloading..."
if ! curl -fsSL --max-time 300 -H 'User-Agent: JSRF-Installer' \
	"https://codeload.github.com/$OWNER/$REPO/zip/refs/heads/$BRANCH" -o "$TEMP/game.zip"; then
	echo "  Download failed. Check your internet connection."
	exit 1
fi

echo "  Unpacking..."
if command -v unzip >/dev/null 2>&1; then
	unzip -qo "$TEMP/game.zip" -d "$TEMP" || { echo "  Could not unpack the download."; exit 1; }
else
	(cd "$TEMP" && tar -xf game.zip) || { echo "  Could not unpack the download."; exit 1; }
fi

SRC="$(find "$TEMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
if [ -z "$SRC" ] || [ ! -s "$SRC/game/JetSetRadioFuture.html" ]; then
	echo "  The download did not contain a usable game file."
	exit 1
fi

mkdir -p "$INSTALL_DIR"
cp -Rf "$SRC/." "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR"/*.sh "$INSTALL_DIR"/*.command 2>/dev/null || true

echo "  Creating Desktop shortcuts..."
"$INSTALL_DIR/create_desktop_shortcut.sh" || true

# So the launcher's update check has something to compare against.
"$INSTALL_DIR/update.sh" --quiet >/dev/null 2>&1 || true

cat <<DONE

  Done.
  There is a Jet Set Radio Future launcher on your Desktop, and an
  updater next to it. Launching checks for a new version first and
  updates itself if there is one.

DONE

[ "$LAUNCH" -eq 1 ] && exec "$INSTALL_DIR/play.sh"
