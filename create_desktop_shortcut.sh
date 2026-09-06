#!/usr/bin/env bash
# Puts the Jet Set Radio Future launcher and updater on the Desktop. Run once,
# on your own machine. The updater gets its own icon because a notice you have
# to go hunting through a folder to act on is a notice most people ignore.
set -uo pipefail
PROJECT="$(cd "$(dirname "$0")" && pwd)"

desktop_dir() {
	if command -v xdg-user-dir >/dev/null 2>&1; then
		local dir
		dir="$(xdg-user-dir DESKTOP 2>/dev/null)"
		[ -n "$dir" ] && [ -d "$dir" ] && { echo "$dir"; return; }
	fi
	[ -d "$HOME/Desktop" ] && { echo "$HOME/Desktop"; return; }
	echo ""
}

DESKTOP="$(desktop_dir)"
if [ -z "$DESKTOP" ]; then
	echo "Could not find your Desktop folder. Is one set up?"
	exit 1
fi

case "$(uname -s)" in
Darwin)
	TARGET="$DESKTOP/Jet Set Radio Future.command"
	cat > "$TARGET" <<LAUNCHER
#!/usr/bin/env bash
# Created by create_desktop_shortcut.sh
exec "$PROJECT/play.sh" "\$@"
LAUNCHER
	chmod +x "$TARGET"
	echo "  Created: $TARGET"

	UPDATER="$DESKTOP/Update Jet Set Radio Future.command"
	cat > "$UPDATER" <<UPDATE
#!/usr/bin/env bash
# Created by create_desktop_shortcut.sh
"$PROJECT/update.sh" --full "\$@"
echo
echo "Press Return to close."
read -r _
UPDATE
	chmod +x "$UPDATER"
	echo "  Created: $UPDATER"
	;;
*)
	TARGET="$DESKTOP/jet-set-radio-future.desktop"
	cat > "$TARGET" <<LAUNCHER
[Desktop Entry]
Type=Application
Name=Jet Set Radio Future
Comment=Cel-shaded skating, up to 4 players
Exec="$PROJECT/play.sh"
Icon=$PROJECT/icon.png
Path=$PROJECT
Terminal=false
Categories=Game;
LAUNCHER
	chmod +x "$TARGET"
	# GNOME will not run a launcher it has not been told to trust.
	command -v gio >/dev/null 2>&1 && gio set "$TARGET" metadata::trusted true 2>/dev/null || true
	echo "  Created: $TARGET"

	UPDATER="$DESKTOP/update-jet-set-radio-future.desktop"
	cat > "$UPDATER" <<UPDATE
[Desktop Entry]
Type=Application
Name=Update Jet Set Radio Future
Comment=Download the latest version
Exec="$PROJECT/update.sh" --full
Icon=$PROJECT/icon.png
Path=$PROJECT
Terminal=true
Categories=Game;
UPDATE
	chmod +x "$UPDATER"
	command -v gio >/dev/null 2>&1 && gio set "$UPDATER" metadata::trusted true 2>/dev/null || true
	echo "  Created: $UPDATER"
	;;
esac
