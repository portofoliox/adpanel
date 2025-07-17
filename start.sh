#!/bin/bash

INSTALL_DIR=./adpanel/panel

if [ ! -d "$INSTALL_DIR" ]; then
    echo "[✘] Folderul panel nu există. Rulează mai întâi install.sh"
    exit 1
fi

cd "$INSTALL_DIR" || exit 1

nohup node index.js > panel.log 2>&1 &

echo "[✔] Panelul rulează în background."
echo "     Log: $INSTALL_DIR/panel.log"
