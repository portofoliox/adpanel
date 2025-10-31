#!/bin/bash

read -p "Vrei să te conectezi prin SSH la GitHub? (y/n): " use_ssh

if [[ "$use_ssh" == "y" ]]; then
    ssh -T git@github.com

    git remote set-url origin git@github.com:antonndev/ADPanel.git
fi

git add .

# Commit cu mesaj
git commit -m "ADPanel Update"
git pull --no-rebase

git push --set-upstream origin main
