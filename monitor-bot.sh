#!/bin/bash

echo "🛡️ DISCORD BOT MONITOR - 24/7 PERSISTENCE SYSTEM"
echo "💎 Ensures bot never goes offline"

# Export token
export DISCORD_BOT_TOKEN="MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4"

# Function to start bot
start_bot() {
    echo "🚀 [$(date)] Starting Discord bot..."
    node persistent-bot.js &
    BOT_PID=$!
    echo "📊 Bot started with PID: $BOT_PID"
}

# Function to check if bot is running
check_bot() {
    if ! kill -0 $BOT_PID 2>/dev/null; then
        echo "⚠️ [$(date)] Bot process died - restarting..."
        start_bot
        return 1
    fi
    return 0
}

# Kill any existing bots
pkill -f persistent-bot 2>/dev/null
pkill -f discord 2>/dev/null

echo "🔄 Starting monitored bot..."
start_bot

# Monitor loop - checks every 30 seconds
while true; do
    sleep 30
    
    if check_bot; then
        echo "✅ [$(date)] Bot is running (PID: $BOT_PID)"
    fi
done