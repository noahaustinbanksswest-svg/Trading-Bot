#!/bin/bash

echo "🛡️ BULLETPROOF DISCORD BOT KEEP-ALIVE SYSTEM"
echo "💎 TRUE ORIGINAL FORMAT WITH PERSISTENCE"

# Export environment variables
export DISCORD_BOT_TOKEN="MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4"

# Kill any existing Discord processes
pkill -f discord 2>/dev/null
pkill -f original 2>/dev/null

echo "🔄 Starting TRUE ORIGINAL Discord Bot with bulletproof persistence..."

# Infinite restart loop - bot will NEVER stay offline
while true; do
    echo "🚀 [$(date)] Starting Discord bot..."
    
    # Run the bot
    node true-original-bot.js
    
    echo "⚠️ [$(date)] Bot stopped - RESTARTING in 3 seconds..."
    sleep 3
    
    echo "🔄 [$(date)] Auto-restart triggered - bot will never stay offline..."
done