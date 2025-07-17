#!/bin/bash

echo "[✔] Instalare Panel Discord Bots..."

# Verificare dependențe
for cmd in git node npm; do
    if ! command -v $cmd &> /dev/null; then
        echo "[✘] Comanda $cmd nu este instalată. Instaleaz-o și reîncearcă."
        exit 1
    fi
done

# Creare director
mkdir -p ~/adpanel
cd ~/adpanel

# Clone repo
git clone https://github.com/portofoliox/adpanel.git . || { echo "[✘] Clonare eșuată."; exit 1; }

# Instalare dependențe
cd panel || exit 1
npm install

# Creare cont admin
echo ""
echo "╔════════════════════════════════════╗"
echo "║  Creează contul de administrator  ║"
echo "╚════════════════════════════════════╝"
read -p "👤 Username: " username
read -sp "🔑 Parolă: " password
echo

node createUser.js "$username" "$password"

# Start server
echo "[✔] Pornim panelul la http://localhost:2025..."
node index.js
