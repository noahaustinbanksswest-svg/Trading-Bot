#!/bin/bash

echo "🛡️ Activating Workspace Guardian..."
echo "🎯 This will keep your green button ON automatically"

# Kill current processes
pkill -f "npm run dev" 2>/dev/null
pkill -f "tsx server" 2>/dev/null

# Wait a moment
sleep 3

# Start with guardian protection
echo "🚀 Starting enhanced protection..."
nohup node start-with-supervisor.js > guardian.log 2>&1 &

echo "✅ Guardian activated! Check guardian.log for status"
echo "💡 Your green button will now auto-restart if it goes off"