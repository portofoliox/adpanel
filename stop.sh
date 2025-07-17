#!/bin/bash

PID=$(ps aux | grep 'node index.js' | grep -v grep | awk '{print $2}')

if [ -z "$PID" ]; then
    echo "[!] Panelul nu este pornit."
    exit 0
fi

kill "$PID" && echo "[✔] Panel oprit (PID $PID)."
