#!/usr/bin/env bash
echo "Installing dependencies..."
npm install
npm install adm-zip
echo "Starting panel in background..."
nohup node panel.js > /dev/null 2>&1 &
echo "Setup complete. Panel running in background."
