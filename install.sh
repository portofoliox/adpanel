#!/bin/bash

echo "[✔] Instalare ADPanel..."

# Verificare unelte
for cmd in git node npm; do
    if ! command -v $cmd &> /dev/null; then
        echo "[✘] Comanda $cmd nu este instalată."
        exit 1
    fi
done

# Creare folder și mutare acolo
mkdir -p ~/adpanel && cd ~/adpanel

# Clone repo (CORECT)
git clone https://github.com/portofoliox/adpanel.git . || {
    echo "[✘] Eroare la clonarea repository-ului.";
    exit 1;
}

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

# Pornire
echo "[✔] Pornim panelul la http://localhost:2025..."
node index.js
