#!/bin/bash

read -p "Vrei să te conectezi prin SSH la GitHub? (y/n): " use_ssh

if [[ "$use_ssh" == "y" ]]; then
    # Test conexiune SSH
    ssh -T git@github.com

    # Setează URL-ul remote către SSH
    git remote set-url origin git@github.com:antonndev/ADPanel.git
fi

# Adaugă toate fișierele
git add .

# Commit cu mesaj
git commit -m "Initial commit"

# Push către remote origin pe branch-ul main și setează upstream
git push --set-upstream origin main
