#!/usr/bin/env bash
# Double-clickable updater for macOS.
cd "$(dirname "$0")"
./update.sh --full "$@"
echo
echo "Press Return to close."
read -r _
