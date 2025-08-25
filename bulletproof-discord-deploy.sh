#!/bin/bash

echo "🛡️ BULLETPROOF Discord Bot Deployment Starting..."

# Kill any existing Discord bots
pkill -f discord-bot 2>/dev/null || true
pkill -f first-original-bot 2>/dev/null || true
pkill -f bulletproof 2>/dev/null || true
sleep 2

# Bulletproof infinite restart loop
while true; do
    echo "🚀 [$(date '+%H:%M:%S')] Starting Discord bot..."
    
    DISCORD_TOKEN="$DISCORD_TOKEN" node first-original-bot.js >> bulletproof-discord.log 2>&1
    
    EXIT_CODE=$?
    echo "❌ [$(date '+%H:%M:%S')] Bot stopped (exit code: $EXIT_CODE) - restarting in 3 seconds..."
    
    sleep 3
done