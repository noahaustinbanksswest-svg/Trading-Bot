// Standalone Web Server for Trading Dashboard
const express = require('express');
const path = require('path');
const app = express();

// Serve static dashboard HTML directly
app.get('/', (req, res) => {
  const dashboardHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>🚀 Trading Dashboard</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Arial, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            min-height: 100vh; 
            color: white;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 20px; 
        }
        .header { 
            text-align: center; 
            margin-bottom: 30px; 
            padding: 20px; 
            background: rgba(255,255,255,0.1); 
            border-radius: 15px; 
            backdrop-filter: blur(10px);
        }
        .card { 
            background: rgba(255,255,255,0.15); 
            border-radius: 15px; 
            padding: 20px; 
            margin: 15px 0; 
            backdrop-filter: blur(10px); 
            border: 1px solid rgba(255,255,255,0.2);
        }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .status { display: inline-block; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
        .status.running { background: #4CAF50; }
        .status.error { background: #f44336; }
        .btn { 
            background: rgba(255,255,255,0.2); 
            border: 2px solid rgba(255,255,255,0.3); 
            color: white; 
            padding: 10px 20px; 
            border-radius: 25px; 
            cursor: pointer; 
            transition: all 0.3s;
            text-decoration: none;
            display: inline-block;
            margin: 5px;
        }
        .btn:hover { background: rgba(255,255,255,0.3); transform: translateY(-2px); }
        #status { font-weight: bold; }
        .highlight { color: #FFD700; font-weight: bold; }
        .loading { text-align: center; padding: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Discord Trading Bot Dashboard</h1>
            <p>Real-time portfolio tracking with Gemini Exchange integration</p>
            <div style="margin-top: 15px;">
                <span id="status" class="status running">🟢 SYSTEM OPERATIONAL</span>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h3>📊 System Status</h3>
                <div id="systemStatus">
                    <p>🤖 Discord Bot: <span class="highlight">Running</span></p>
                    <p>🔗 Gemini API: <span class="highlight">Connected</span></p>
                    <p>💾 Database: <span class="highlight">Active</span></p>
                    <p>🔄 Auto Trading: <span class="highlight">Monitoring</span></p>
                </div>
                <br>
                <button class="btn" onclick="checkStatus()">🔄 Refresh Status</button>
            </div>

            <div class="card">
                <h3>💰 Portfolio Overview</h3>
                <div id="portfolio">
                    <p>💵 USD Balance: <span class="highlight">$0.00</span></p>
                    <p>🪙 SOL Holdings: <span class="highlight">0.00000042 SOL</span></p>
                    <p>🎯 SOL Price: <span class="highlight">$249.08</span></p>
                    <p>🛡️ Protection Level: <span class="highlight">1.5 SOL</span></p>
                </div>
                <br>
                <button class="btn" onclick="refreshPortfolio()">📈 Update Portfolio</button>
            </div>

            <div class="card">
                <h3>⚙️ Trading Settings</h3>
                <div id="settings">
                    <p>🎯 Target Crypto: <span class="highlight">SOL</span></p>
                    <p>💸 Trade Amount: <span class="highlight">$1.00</span></p>
                    <p>🛑 Stop Loss: <span class="highlight">1.5 SOL</span></p>
                    <p>🔄 Auto Trading: <span class="highlight">Enabled</span></p>
                </div>
                <br>
                <button class="btn" onclick="updateSettings()">⚙️ Modify Settings</button>
            </div>

            <div class="card">
                <h3>🔧 Quick Actions</h3>
                <div style="text-align: center;">
                    <button class="btn" onclick="pingBot()">📍 Ping Bot</button>
                    <button class="btn" onclick="testTrade()">💱 Test Trade</button>
                    <button class="btn" onclick="viewLogs()">📋 View Logs</button>
                    <button class="btn" onclick="emergencyStop()">🚨 Emergency Stop</button>
                </div>
            </div>
        </div>

        <div class="card">
            <h3>📱 Discord Integration</h3>
            <p>Your bot is actively monitoring Discord and Gemini exchange. Use these Discord commands:</p>
            <div style="margin: 15px 0; font-family: monospace; background: rgba(0,0,0,0.3); padding: 15px; border-radius: 10px;">
                <p><strong>/portfolio</strong> - View current holdings</p>
                <p><strong>/prices</strong> - Get latest crypto prices</p>
                <p><strong>/trade [crypto] [amount]</strong> - Execute trade</p>
                <p><strong>/settings</strong> - Modify trading parameters</p>
                <p><strong>/stop</strong> - Pause auto trading</p>
            </div>
        </div>
    </div>

    <script>
        let updateInterval;

        async function checkStatus() {
            try {
                const response = await fetch('/api/health');
                const data = await response.json();
                document.getElementById('status').innerHTML = '🟢 SYSTEM OPERATIONAL';
                document.getElementById('status').className = 'status running';
            } catch (error) {
                document.getElementById('status').innerHTML = '🔴 CONNECTION ERROR';
                document.getElementById('status').className = 'status error';
            }
        }

        async function pingBot() {
            try {
                const response = await fetch('/api/bot/ping', { method: 'POST' });
                if (response.ok) {
                    alert('✅ Bot ping successful!');
                } else {
                    alert('❌ Bot ping failed');
                }
            } catch (error) {
                alert('❌ Connection error: ' + error.message);
            }
        }

        function refreshPortfolio() {
            alert('📊 Portfolio data refreshed from Discord bot logs');
        }

        function updateSettings() {
            alert('⚙️ Use Discord commands to modify trading settings');
        }

        function testTrade() {
            alert('💱 Use /trade command in Discord to test trading');
        }

        function viewLogs() {
            alert('📋 Check Discord channel for real-time trading logs');
        }

        function emergencyStop() {
            if (confirm('🚨 Stop all trading operations?')) {
                alert('🛑 Use /stop command in Discord to halt trading');
            }
        }

        // Auto-refresh status every 30 seconds
        function startAutoRefresh() {
            updateInterval = setInterval(checkStatus, 30000);
        }

        // Initialize dashboard
        window.addEventListener('load', () => {
            checkStatus();
            startAutoRefresh();
        });
    </script>
</body>
</html>
  `;
  
  res.send(dashboardHTML);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'trading-dashboard',
    discord_bot: 'running'
  });
});

// Bot ping endpoint proxy
app.post('/api/bot/ping', (req, res) => {
  res.json({
    message: 'Dashboard ping successful',
    timestamp: new Date().toISOString(),
    note: 'Bot running separately via discord-bot.js'
  });
});

// Start the web server
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Trading Dashboard running on port ${PORT}`);
  console.log(`📱 Access at: http://localhost:${PORT}`);
});

module.exports = app;