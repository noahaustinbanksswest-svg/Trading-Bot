#!/bin/bash
# Ultimate Bot Monitor - Ensures 100% uptime

echo "🛡️ ULTIMATE BOT MONITOR STARTING..."
echo "💪 Will ensure Discord bot NEVER goes offline"

BOT_FILE="bulletproof-discord-bot.js"
TOKEN="MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4"

# Function to start bot
start_bot() {
    echo "🚀 [$(date)] Starting bulletproof Discord bot..."
    DISCORD_BOT_TOKEN="$TOKEN" nohup node "$BOT_FILE" >/dev/null 2>&1 &
    BOT_PID=$!
    echo "✅ Bot started with PID: $BOT_PID"
}

# Function to check if any Discord bot is running
check_bot() {
    if pgrep -f bulletproof-discord-bot.js >/dev/null; then
        return 0  # Bot is running
    else
        return 1  # Bot is not running
    fi
}

# Kill any existing bots first
pkill -f bulletproof-discord-bot.js 2>/dev/null
sleep 2

echo "🔄 Starting monitored bulletproof bot..."
start_bot

# Monitor loop - checks every 60 seconds
while true; do
    sleep 60
    
    if check_bot; then
        echo "✅ [$(date)] Bulletproof bot is running healthy"
    else
        echo "⚠️ [$(date)] Bot not found - restarting immediately..."
        start_bot
    fi
done