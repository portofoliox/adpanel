#!/bin/bash

echo "[✔] Instalare Panel Discord Bots..."

# Verificare comenzi
for cmd in git node npm; do
    if ! command -v $cmd &> /dev/null; then
        echo "[...] Instalare $cmd..."
        pkg install -y $cmd
    fi
done

# Creare folder și descărcare panel
mkdir -p discord-panel && cd discord-panel
git clone https://github.com/portofoliox/adpanel.git . || exit 1

# Instalare dependențe
cd panel
npm install

# Creare cont
read -p "Alege un nume de utilizator pentru admin: " username
read -sp "Alege o parolă: " password
echo

node createUser.js "$username" "$password"

# Pornire
echo "[✔] Pornim panelul pe portul 2025..."
node index.js
