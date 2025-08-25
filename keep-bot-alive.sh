#!/bin/bash

# BULLETPROOF BOT DEPLOYMENT SCRIPT
echo "🛡️ Starting bulletproof Discord bot deployment..."

# Kill any existing bots
pkill -f discord-bot || true
pkill -f bulletproof-deployment-bot || true
sleep 2

# Start the bulletproof bot with auto-restart
while true; do
    echo "🚀 Starting bulletproof bot..."
    DISCORD_TOKEN="$DISCORD_TOKEN" node bulletproof-deployment-bot.cjs >> bot-bulletproof.log 2>&1
    
    echo "❌ Bot stopped - restarting in 5 seconds..."
    sleep 5
done
