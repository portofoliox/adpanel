#!/bin/bash

echo "[✔] Instalare ADPanel..."

INSTALL_DIR=./adpanel

# Dacă folderul există, îl ștergem
if [ -d "$INSTALL_DIR" ]; then
    echo "[!] Folderul $INSTALL_DIR există deja. Îl ștergem..."
    rm -rf "$INSTALL_DIR"
fi

# Creăm folderul și intrăm în el
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR" || { echo "[✘] Nu pot intra în $INSTALL_DIR"; exit 1; }

# Clone repo
git clone https://github.com/portofoliox/adpanel.git . || {
    echo "[✘] Eroare la clonarea repository-ului."
    exit 1
}

cd panel || { echo "[✘] Folderul 'panel' nu există."; exit 1; }

# Instalare dependințe
npm install || { echo "[✘] Eroare la npm install."; exit 1; }

# Instalare explicită bcrypt
npm install bcrypt || { echo "[✘] Eroare la instalarea bcrypt."; exit 1; }

echo ""
echo "╔════════════════════════════════════╗"
echo "║  Creează contul de administrator  ║"
echo "╚════════════════════════════════════╝"
read -p "👤 Username: " username
read -sp "🔑 Parolă: " password
echo

# Creare user admin (presupunem că createUser.js primește username și parola ca argumente)
node createUser.js "$username" "$password" || {
    echo "[✘] Eroare la crearea contului admin."
    exit 1
}

echo "[✔] Pornim panelul la http://localhost:2025 în background..."

nohup node index.js > panel.log 2>&1 &

echo "[✔] Panelul rulează acum în background."
echo "     Poți vedea logurile cu: tail -f $INSTALL_DIR/panel/panel.log"
