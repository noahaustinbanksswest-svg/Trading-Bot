#!/bin/bash

echo "🚀 Starting 24/7 Discord Trading Bot..."
echo "💎 Reserved VM Active"

# Export the token
export DISCORD_BOT_TOKEN="MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4"

# Kill any existing Discord processes
pkill -f discord 2>/dev/null

# Start the bot with restart capability
while true; do
    echo "🔄 Starting Discord bot..."
    node working-discord-bot.js
    echo "⚠️ Bot stopped - restarting in 5 seconds..."
    sleep 5
done