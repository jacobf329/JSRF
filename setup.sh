#!/usr/bin/env bash
# First-time setup on macOS or Linux. Fetches the game file if it is missing,
# puts it on the Desktop, and notes the version so later launches can update
# themselves.
set -uo pipefail
cd "$(dirname "$0")"

cat <<'INTRO'

  ============================================
    Jet Set Radio Future - first-time setup
  ============================================

  Nothing gets installed. There is no engine to download and no
  runtime to add - the game is a single file your browser opens,
  and everything it needs is inside it.

INTRO

chmod +x ./*.sh ./*.command 2>/dev/null || true

if [ ! -f game/JetSetRadioFuture.html ]; then
	echo "  [1/3] The game file is not here yet. Fetching it..."
	./update.sh --force --full
	if [ ! -f game/JetSetRadioFuture.html ]; then
		cat <<'MESSAGE'

  Setup stopped: the game file could not be downloaded.

  Check your internet connection and run ./setup.sh again, or
  download the whole folder fresh from:
    https://github.com/jacobf329/JSRF

MESSAGE
		exit 1
	fi
else
	echo "  [1/3] Game file found."
fi

echo
echo "  [2/3] Creating the Desktop shortcuts..."
./create_desktop_shortcut.sh || exit 1

echo
echo "  [3/3] Noting the current version..."
./update.sh --quiet >/dev/null 2>&1 || true
echo "        Done."

cat <<'DONE'

  All set. There is now a Jet Set Radio Future launcher on your
  Desktop, and an updater next to it.

  Every time you launch, it checks for a new version first and
  updates itself if there is one. If you would rather it did not,
  create an empty file called no_update_check.txt in this folder.

  Up to 4 players: pick the number on the title screen. Player 1
  uses the keyboard, players 2-4 use gamepads (or player 2 can
  share the keyboard on the arrow keys and number pad).

DONE

printf '  Play now? [y/N] '
read -r answer
case "$answer" in
[Yy]*) exec ./play.sh ;;
esac
