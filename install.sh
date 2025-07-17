#!/bin/bash

echo "[✔] Instalare ADPanel..."

INSTALL_DIR=./adpanel

if [ -d "$INSTALL_DIR" ]; then
    echo "[!] Folderul $INSTALL_DIR există deja. Îl ștergem..."
    rm -rf "$INSTALL_DIR"
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR" || { echo "[✘] Nu pot intra în $INSTALL_DIR"; exit 1; }

git clone https://github.com/portofoliox/adpanel.git . || {
    echo "[✘] Eroare la clonarea repository-ului."
    exit 1
}

cd panel || { echo "[✘] Folderul 'panel' nu există."; exit 1; }

npm install || { echo "[✘] Eroare la npm install."; exit 1; }
npm install bcrypt || { echo "[✘] Eroare la instalarea bcrypt."; exit 1; }

echo ""
echo "╔════════════════════════════════════╗"
echo "║  Creează contul de administrator  ║"
echo "╚════════════════════════════════════╝"
read -p "👤 Username: " username
read -sp "🔑 Parolă: " password
echo

node createUser.js "$username" "$password" || {
    echo "[✘] Eroare la crearea contului admin."
    exit 1
}

echo "[✔] Instalarea s-a terminat. Poți porni panelul cu ./start.sh"
