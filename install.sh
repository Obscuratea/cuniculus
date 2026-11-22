#!/bin/sh
# Adds Cuniculus to the app launcher for this user. No sudo, nothing system-wide.
set -e
here="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
mkdir -p "$apps" "$icons"
cp "$here/cuniculus.svg" "$icons/cuniculus.svg"
cat > "$apps/cuniculus.desktop" <<EOD
[Desktop Entry]
Type=Application
Name=Cuniculus
Comment=Music visualizer for system audio
Exec="$here/run.sh"
Icon=cuniculus
Categories=AudioVideo;Audio;
StartupWMClass=cuniculus
EOD
echo "Installed launcher entry: $apps/cuniculus.desktop"
