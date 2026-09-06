#!/usr/bin/env bash
# Launches Jet Set Radio Future on macOS or Linux, updating it first.
#
# The game is a single self-contained HTML file, so launching means handing it
# to a browser. Chrome-family browsers get it in app mode -- its own window, no
# tabs, no address bar -- which is the difference between something that feels
# like a game and something that feels like a web page.
set -uo pipefail
cd "$(dirname "$0")"
PROJECT="$(pwd)"
GAME="$PROJECT/game/JetSetRadioFuture.html"

echo
echo "  Jet Set Radio Future"
echo "  --------------------"
echo

if [ ! -f no_update_check.txt ] && [ -x ./update.sh ]; then
	# --quiet only speaks up when there is news; never let it stand between
	# somebody and their game.
	./update.sh --quiet || true
fi

if [ ! -f "$GAME" ]; then
	cat <<MESSAGE
  The game file is missing:
    $GAME

  Run ./setup.sh in this folder to fetch it.

MESSAGE
	exit 1
fi

URL="file://$GAME"
PROFILE="$PROJECT/browser-profile"

# A dedicated profile guarantees a real app window even when the browser is
# already running with your own session, and keeps the game's storage out of it.
APP_ARGS=(--app="$URL" --user-data-dir="$PROFILE" --window-size=1600,900
	--no-first-run --no-default-browser-check)

launch_linux() {
	local browser
	for browser in google-chrome google-chrome-stable chromium chromium-browser \
		microsoft-edge brave-browser vivaldi-stable; do
		if command -v "$browser" >/dev/null 2>&1; then
			echo "  Starting Jet Set Radio Future..."
			nohup "$browser" "${APP_ARGS[@]}" >/dev/null 2>&1 &
			return 0
		fi
	done
	if command -v xdg-open >/dev/null 2>&1; then
		echo "  Starting Jet Set Radio Future in your default browser..."
		nohup xdg-open "$URL" >/dev/null 2>&1 &
		return 0
	fi
	return 1
}

launch_macos() {
	local app
	for app in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium" "Vivaldi"; do
		if [ -d "/Applications/$app.app" ]; then
			echo "  Starting Jet Set Radio Future..."
			open -na "$app" --args "${APP_ARGS[@]}"
			return 0
		fi
	done
	echo "  Starting Jet Set Radio Future in your default browser..."
	open "$GAME"
}

case "$(uname -s)" in
Darwin) launch_macos ;;
*)
	if ! launch_linux; then
		cat <<'MESSAGE'
  Could not find a browser to open the game with.

  Open game/JetSetRadioFuture.html by hand in any modern browser --
  everything the game needs is inside that one file.

MESSAGE
		exit 1
	fi
	;;
esac
