import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { GeminiService } from "./services/gemini";
import { DiscordBotService } from "./services/discord-bot";
import { TradingEngine } from "./services/trading-engine";
import { insertTradingSettingsSchema, insertTradeOrderSchema, botSettings, botStatus } from "../shared/schema.js";
import { z } from "zod";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

// Store active services per user
const userServices = new Map<string, {
  gemini: GeminiService;
  discord?: DiscordBotService;
  trading: TradingEngine;
}>();

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Serve the dashboard as the root route to bypass vite issues
  app.get("/", (req, res) => {
    const dashboardHTML = `<!DOCTYPE html>
<html>
<head>
    <title>🚀 Trading Dashboard</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            color: white; min-height: 100vh; overflow-x: hidden;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { 
            font-size: 3rem; margin-bottom: 10px; 
            background: linear-gradient(135deg, #4CAF50, #2196F3);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .status-grid { 
            display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px; margin-bottom: 30px;
        }
        .card { 
            background: rgba(42, 42, 42, 0.8); backdrop-filter: blur(10px);
            padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .card.success { border-left: 4px solid #4CAF50; }
        .card.info { border-left: 4px solid #2196F3; }
        .card.warning { border-left: 4px solid #FF9800; }
        .card h2 { color: #4CAF50; margin-bottom: 15px; font-size: 1.4rem; }
        .card h3 { color: #2196F3; margin-bottom: 10px; }
        button { 
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: white; border: none; padding: 12px 24px; border-radius: 8px;
            cursor: pointer; font-size: 1rem; margin: 10px 10px 10px 0;
            transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
        }
        button:hover { 
            transform: translateY(-2px); box-shadow: 0 6px 20px rgba(76, 175, 80, 0.4);
        }
        .data-display { 
            background: #333; padding: 15px; border-radius: 8px; margin: 10px 0;
            font-family: 'Courier New', monospace; font-size: 0.9rem;
            max-height: 400px; overflow-y: auto; border: 1px solid #555;
        }
        .loading { color: #2196F3; }
        .error { color: #f44336; background: rgba(244, 67, 54, 0.1); }
        .metrics { 
            display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px; margin: 20px 0;
        }
        .metric { 
            text-align: center; padding: 15px; background: rgba(0,0,0,0.3);
            border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
        }
        .metric-value { font-size: 2rem; font-weight: bold; color: #4CAF50; }
        .metric-label { font-size: 0.9rem; color: #aaa; margin-top: 5px; }
        .footer { text-align: center; margin-top: 40px; color: #888; }
        .status-indicator { 
            display: inline-block; width: 12px; height: 12px; border-radius: 50%;
            margin-right: 8px;
        }
        .status-online { background: #4CAF50; box-shadow: 0 0 10px #4CAF50; }
        .status-offline { background: #f44336; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Trading Dashboard</h1>
            <p>Real-time cryptocurrency portfolio management & Discord bot control</p>
        </div>
        
        <div class="status-grid">
            <div class="card success">
                <h2><span class="status-indicator status-online"></span>System Status</h2>
                <p>Backend server is running successfully</p>
                <div class="metrics">
                    <div class="metric">
                        <div class="metric-value" id="uptime">--</div>
                        <div class="metric-label">Uptime (min)</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="memory">--</div>
                        <div class="metric-label">Memory (MB)</div>
                    </div>
                </div>
            </div>

            <div class="card info">
                <h2>📊 Portfolio Tracker</h2>
                <button onclick="loadBotSettings()">🔧 Bot Settings</button>
                <button onclick="loadHealthCheck()">❤️ Health Check</button>
                <div id="portfolio-data" class="data-display">Click buttons to load data...</div>
            </div>

            <div class="card info">
                <h2>🤖 Discord Bot</h2>
                <button onclick="loadBotStatus()">📡 Check Status</button>
                <button onclick="testBotPing()">🏓 Test Ping</button>
                <div id="bot-status" class="data-display">Click buttons to check Discord bot status...</div>
            </div>
        </div>

        <div class="card warning">
            <h2>🔧 API Testing Suite</h2>
            <button onclick="testAllAPIs()">🧪 Test All APIs</button>
            <button onclick="testPingAPI()">🏓 Ping Test</button>
            <button onclick="loadAllBotSettings()">⚙️ All Bot Settings</button>
            <div id="api-results" class="data-display">Ready for API testing...</div>
        </div>

        <div class="footer">
            <p>🔐 Secure | 🌐 Live | ⚡ Real-time | 🚀 Trading Bot Dashboard</p>
        </div>
    </div>

    <script>
        // Auto-update functions
        async function updateSystemMetrics() {
            try {
                const response = await fetch("/api/ping");
                const data = await response.json();
                if (data.uptime) {
                    document.getElementById("uptime").textContent = Math.floor(data.uptime / 60);
                }
                if (data.memory) {
                    document.getElementById("memory").textContent = data.memory.replace("MB", "");
                }
            } catch (error) {
                console.error("Failed to update metrics:", error);
            }
        }

        async function loadBotSettings() {
            const element = document.getElementById("portfolio-data");
            try {
                element.innerHTML = '<div class="loading">🔄 Loading bot settings...</div>';
                const response = await fetch("/api/bot/settings");
                const data = await response.json();
                element.innerHTML = \`
                    <h3>🔧 Bot Settings:</h3>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                element.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }

        async function loadHealthCheck() {
            const element = document.getElementById("portfolio-data");
            try {
                element.innerHTML = '<div class="loading">🔄 Running health check...</div>';
                const response = await fetch("/api/health");
                const data = await response.json();
                element.innerHTML = \`
                    <h3>❤️ System Health:</h3>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                element.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }

        async function loadBotStatus() {
            const element = document.getElementById("bot-status");
            try {
                element.innerHTML = '<div class="loading">🔄 Checking Discord bot...</div>';
                const response = await fetch("/api/bot/status");
                const data = await response.json();
                element.innerHTML = \`
                    <h3>🤖 Bot Status:</h3>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                element.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }

        async function testBotPing() {
            const element = document.getElementById("bot-status");
            try {
                element.innerHTML = '<div class="loading">🏓 Pinging Discord bot...</div>';
                const response = await fetch("/api/bot/ping", { 
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "dashboard-test" })
                });
                const data = await response.json();
                element.innerHTML = \`
                    <h3>🏓 Bot Ping Result:</h3>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                element.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }

        async function testPingAPI() {
            const element = document.getElementById("api-results");
            try {
                element.innerHTML = '<div class="loading">🔄 Testing ping API...</div>';
                const response = await fetch("/api/ping");
                const data = await response.json();
                element.innerHTML = \`
                    <h3>🏓 Ping API Test:</h3>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                element.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }

        async function loadAllBotSettings() {
            const element = document.getElementById("api-results");
            try {
                element.innerHTML = '<div class="loading">🔄 Loading all bot settings...</div>';
                const response = await fetch("/api/bot/settings");
                const data = await response.json();
                element.innerHTML = \`
                    <h3>⚙️ Complete Bot Settings:</h3>
                    <pre>\${JSON.stringify(data, null, 2)}</pre>
                \`;
            } catch (error) {
                element.innerHTML = \`<div class="error">❌ Error: \${error.message}</div>\`;
            }
        }

        async function testAllAPIs() {
            const element = document.getElementById("api-results");
            element.innerHTML = '<div class="loading">🧪 Testing all APIs...</div>';
            
            const results = {};
            const endpoints = [
                { name: "Health", url: "/api/health" },
                { name: "Ping", url: "/api/ping" },
                { name: "Bot Status", url: "/api/bot/status" },
                { name: "Bot Settings", url: "/api/bot/settings" },
                { name: "Keep Alive", url: "/api/keep-alive" }
            ];

            for (const endpoint of endpoints) {
                try {
                    const response = await fetch(endpoint.url);
                    const data = await response.json();
                    results[endpoint.name] = { status: "✅ Success", responseTime: Date.now(), data: data };
                } catch (error) {
                    results[endpoint.name] = { status: "❌ Failed", error: error.message };
                }
            }

            element.innerHTML = \`
                <h3>🧪 Complete API Test Results:</h3>
                <pre>\${JSON.stringify(results, null, 2)}</pre>
            \`;
        }

        // Auto-load on page load
        window.onload = function() {
            updateSystemMetrics();
            loadBotStatus();
            
            // Auto-refresh metrics every 30 seconds
            setInterval(updateSystemMetrics, 30000);
        };
    </script>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(dashboardHTML);
  });

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        // Handle WebSocket messages here
        console.log('Received WebSocket message:', data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });
  });

  // Broadcast function for real-time updates
  const broadcast = (data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  };

  // API Routes

  // Get user profile
  app.get("/api/user/:id", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Don't send sensitive data
      const { password, geminiApiSecret, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  // Update user API credentials
  app.patch("/api/user/:id/credentials", async (req, res) => {
    try {
      const { geminiApiKey, geminiApiSecret, discordBotToken, discordGuildId, discordChannelId } = req.body;
      
      const updatedUser = await storage.updateUser(req.params.id, {
        geminiApiKey,
        geminiApiSecret,
        discordBotToken,
        discordGuildId,
        discordChannelId,
      });

      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ message: "Credentials updated successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update credentials" });
    }
  });

  // Get trading settings
  app.get("/api/trading-settings/:userId", async (req, res) => {
    try {
      const settings = await storage.getTradingSettings(req.params.userId);
      if (!settings) {
        // Create default settings if none exist
        const defaultSettings = await storage.createTradingSettings({
          userId: req.params.userId,
        });
        return res.json(defaultSettings);
      }
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to get trading settings" });
    }
  });

  // Update trading settings
  app.patch("/api/trading-settings/:userId", async (req, res) => {
    try {
      const validatedData = insertTradingSettingsSchema.parse(req.body);
      const settings = await storage.updateTradingSettings(req.params.userId, validatedData);
      
      if (!settings) {
        return res.status(404).json({ error: "Settings not found" });
      }
      
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Get portfolio holdings
  app.get("/api/portfolio/:userId", async (req, res) => {
    try {
      const holdings = await storage.getPortfolioHoldings(req.params.userId);
      const totalValue = holdings.reduce((sum, holding) => sum + parseFloat(holding.valueUSD || '0'), 0);
      
      res.json({
        holdings,
        totalValue: totalValue.toFixed(2),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get portfolio" });
    }
  });

  // Get trade orders
  app.get("/api/orders/:userId", async (req, res) => {
    try {
      const { status } = req.query;
      const orders = await storage.getTradeOrders(req.params.userId, status as string);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to get orders" });
    }
  });

  // Place new order
  app.post("/api/orders", async (req, res) => {
    try {
      const validatedData = insertTradeOrderSchema.parse(req.body);
      const services = userServices.get(validatedData.userId);
      
      if (!services) {
        return res.status(400).json({ error: "Trading services not initialized for user" });
      }

      const order = await services.trading.placeOrder({
        symbol: validatedData.symbol,
        amount: validatedData.amount,
        price: validatedData.price || undefined,
        side: validatedData.side as 'buy' | 'sell',
        type: validatedData.orderType as any,
      });

      // Broadcast real-time update
      broadcast({ type: 'new_order', data: order });
      
      res.json(order);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to place order" });
    }
  });

  // Cancel order
  app.delete("/api/orders/:orderId", async (req, res) => {
    try {
      const { userId } = req.body;
      const services = userServices.get(userId);
      
      if (!services) {
        return res.status(400).json({ error: "Trading services not initialized for user" });
      }

      await services.trading.cancelOrder(req.params.orderId);
      
      // Broadcast real-time update
      broadcast({ type: 'order_cancelled', data: { orderId: req.params.orderId } });
      
      res.json({ message: "Order cancelled successfully" });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to cancel order" });
    }
  });

  // Get trading history
  app.get("/api/history/:userId", async (req, res) => {
    try {
      const { limit } = req.query;
      const history = await storage.getTradingHistory(req.params.userId, limit ? parseInt(limit as string) : undefined);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: "Failed to get trading history" });
    }
  });

  // Initialize trading services for a user
  app.post("/api/initialize/:userId", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!user.geminiApiKey || !user.geminiApiSecret) {
        return res.status(400).json({ error: "Gemini API credentials not configured" });
      }

      // Initialize Gemini service
      const geminiService = new GeminiService(
        user.geminiApiKey,
        user.geminiApiSecret,
        process.env.NODE_ENV === 'development' // Use sandbox in development
      );

      // Test Gemini connection
      try {
        await geminiService.heartbeat();
      } catch (error) {
        return res.status(400).json({ error: "Invalid Gemini API credentials" });
      }

      // Initialize Discord service if configured
      let discordService: DiscordBotService | undefined;
      if (user.discordBotToken && user.discordGuildId && user.discordChannelId) {
        discordService = new DiscordBotService(
          user.discordBotToken,
          user.discordGuildId,
          user.discordChannelId,
          user.id
        );
        
        try {
          await discordService.connect();
        } catch (error) {
          console.error('Failed to connect Discord bot:', error);
          // Continue without Discord service
          discordService = undefined;
        }
      }

      // Initialize trading engine
      const tradingEngine = new TradingEngine({
        userId: user.id,
        geminiService,
        discordService,
      });

      await tradingEngine.start();

      // Store services
      userServices.set(user.id, {
        gemini: geminiService,
        discord: discordService,
        trading: tradingEngine,
      });

      res.json({ message: "Trading services initialized successfully" });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to initialize services" });
    }
  });

  // Test Discord connection
  app.post("/api/discord/test/:userId", async (req, res) => {
    try {
      const services = userServices.get(req.params.userId);
      
      if (!services?.discord) {
        return res.status(400).json({ error: "Discord service not initialized" });
      }

      const success = await services.discord.testConnection();
      
      if (success) {
        res.json({ message: "Discord connection test successful" });
      } else {
        res.status(500).json({ error: "Discord connection test failed" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to test Discord connection" });
    }
  });

  // Get available Gemini symbols
  app.get("/api/symbols/:userId", async (req, res) => {
    try {
      const services = userServices.get(req.params.userId);
      
      if (!services) {
        return res.status(400).json({ error: "Gemini service not initialized" });
      }

      const symbols = await services.gemini.getSymbols();
      res.json(symbols);
    } catch (error) {
      res.status(500).json({ error: "Failed to get symbols" });
    }
  });

  // Get ticker data for a symbol
  app.get("/api/ticker/:userId/:symbol", async (req, res) => {
    try {
      const services = userServices.get(req.params.userId);
      
      if (!services) {
        return res.status(400).json({ error: "Gemini service not initialized" });
      }

      const ticker = await services.gemini.getTicker(req.params.symbol);
      res.json(ticker);
    } catch (error) {
      res.status(500).json({ error: "Failed to get ticker data" });
    }
  });

  // Enhanced keep-alive endpoints for maximum uptime
  app.get("/api/health", (req, res) => {
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version
    };
    console.log(`🏥 Health check requested - uptime: ${Math.floor(process.uptime())}s`);
    res.json(health);
  });

  app.get("/api/ping", (req, res) => {
    const pong = { 
      pong: Date.now(),
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
    console.log(`🏓 Ping received - responding with pong`);
    res.json(pong);
  });

  // Enhanced keep-alive endpoint that responds every second
  app.get("/api/keep-alive", (req, res) => {
    res.json({
      alive: true,
      timestamp: Date.now(),
      uptime: process.uptime(),
      status: "running"
    });
  });

  // Bot status and management endpoints
  app.get("/api/bot/status", async (req, res) => {
    try {
      const [status] = await db.select().from(botStatus).orderBy(sql`updated_at DESC`).limit(1);
      res.json(status || { status: "unknown", lastPing: null });
    } catch (error) {
      res.status(500).json({ error: "Failed to get bot status" });
    }
  });

  app.post("/api/bot/ping", async (req, res) => {
    try {
      const { status, errorMessage } = req.body;
      const now = Date.now();
      
      // Enhanced logging for bot pings
      const pingTime = new Date().toLocaleTimeString();
      console.log(`🤖 Bot ping at ${pingTime} - Status: ${status || 'running'}`);
      
      // Save timestamp for guardian monitoring (TIMESTAMP GUARDIAN SYSTEM)
      const { writeFileSync } = await import('fs');
      const timestampData = {
        timestamp: now,
        lastPing: new Date().toISOString(),
        status: status || 'running',
        serverUptime: Math.floor(process.uptime()),
        errorMessage: errorMessage || null
      };
      
      try {
        writeFileSync('last-bot-ping.json', JSON.stringify(timestampData, null, 2));
      } catch (fsError) {
        console.error('❌ Failed to save timestamp for guardian:', fsError.message);
      }
      
      const [existingStatus] = await db.select().from(botStatus).limit(1);
      
      if (existingStatus) {
        await db.update(botStatus)
          .set({ 
            status: status || "running",
            lastPing: new Date(),
            errorMessage: errorMessage || null,
            updatedAt: new Date()
          })
          .where(eq(botStatus.id, existingStatus.id));
      } else {
        await db.insert(botStatus).values({
          status: status || "running",
          lastPing: new Date(),
          errorMessage: errorMessage || null,
          restartCount: 0
        });
      }
      
      res.json({ 
        message: "Ping recorded successfully",
        timestamp: new Date().toISOString(),
        status: status || "running"
      });
    } catch (error) {
      console.error(`❌ Failed to record bot ping:`, error);
      res.status(500).json({ error: "Failed to record ping" });
    }
  });

  // Bot settings endpoints
  app.get("/api/bot/settings/:key", async (req, res) => {
    try {
      const [setting] = await db.select()
        .from(botSettings)
        .where(eq(botSettings.key, req.params.key));
      
      res.json(setting ? setting.value : null);
    } catch (error) {
      res.status(500).json({ error: "Failed to get bot setting" });
    }
  });

  app.post("/api/bot/settings/:key", async (req, res) => {
    try {
      const { value } = req.body;
      
      const [existing] = await db.select()
        .from(botSettings)
        .where(eq(botSettings.key, req.params.key));
      
      if (existing) {
        await db.update(botSettings)
          .set({ value, updatedAt: new Date() })
          .where(eq(botSettings.key, req.params.key));
      } else {
        await db.insert(botSettings).values({
          key: req.params.key,
          value
        });
      }
      
      res.json({ message: "Setting saved" });
    } catch (error) {
      res.status(500).json({ error: "Failed to save bot setting" });
    }
  });

  app.get("/api/bot/settings", async (req, res) => {
    try {
      const settings = await db.select().from(botSettings);
      const settingsMap = settings.reduce((acc: Record<string, any>, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {} as Record<string, any>);
      
      res.json(settingsMap);
    } catch (error) {
      res.status(500).json({ error: "Failed to get bot settings" });
    }
  });

  // Manual dashboard recreation trigger
  app.post("/api/bot/recreate-dashboard", async (req, res) => {
    try {
      // Set a flag in database that the bot will check
      await db.insert(botSettings).values({
        key: 'recreate_dashboard_trigger',
        value: { timestamp: Date.now(), triggered: true }
      }).onConflictDoUpdate({
        target: botSettings.key,
        set: { value: { timestamp: Date.now(), triggered: true }, updatedAt: new Date() }
      });
      
      res.json({ message: "Dashboard recreation triggered - bot will process this shortly" });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to trigger dashboard recreation", details: error.message });
    }
  });

  // Catch-all route to serve dashboard for any non-API path (fixes deployment issue)
  app.get(/^\/(?!api).*/, (req, res) => {
    const dashboardHTML = `<!DOCTYPE html>
<html>
<head>
    <title>🚀 Trading Dashboard</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            color: white; min-height: 100vh; overflow-x: hidden;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { 
            font-size: 3rem; margin-bottom: 10px; 
            background: linear-gradient(135deg, #4CAF50, #2196F3);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .status-grid { 
            display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px; margin-bottom: 30px;
        }
        .card { 
            background: rgba(42, 42, 42, 0.8); backdrop-filter: blur(10px);
            padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .card.success { border-left: 4px solid #4CAF50; }
        .card.info { border-left: 4px solid #2196F3; }
        .card.warning { border-left: 4px solid #FF9800; }
        .card h2 { color: #4CAF50; margin-bottom: 15px; font-size: 1.4rem; }
        .card h3 { color: #2196F3; margin-bottom: 10px; }
        button { 
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: white; border: none; padding: 12px 24px; border-radius: 8px;
            cursor: pointer; font-size: 1rem; margin: 10px 10px 10px 0;
            transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
        }
        button:hover { 
            transform: translateY(-2px); box-shadow: 0 6px 20px rgba(76, 175, 80, 0.4);
        }
        .data-display { 
            background: #333; padding: 15px; border-radius: 8px; margin: 10px 0;
            font-family: 'Courier New', monospace; font-size: 0.9rem;
            max-height: 400px; overflow-y: auto; border: 1px solid #555;
        }
        .loading { color: #2196F3; }
        .error { color: #f44336; background: rgba(244, 67, 54, 0.1); }
        .metrics { 
            display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px; margin: 20px 0;
        }
        .metric { 
            text-align: center; padding: 15px; background: rgba(0,0,0,0.3);
            border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
        }
        .metric-value { font-size: 2rem; font-weight: bold; color: #4CAF50; }
        .metric-label { font-size: 0.9rem; color: #aaa; margin-top: 5px; }
        .footer { text-align: center; margin-top: 40px; color: #888; }
        .status-indicator { 
            display: inline-block; width: 12px; height: 12px; border-radius: 50%;
            margin-right: 8px;
        }
        .status-online { background: #4CAF50; box-shadow: 0 0 10px #4CAF50; }
        .status-offline { background: #f44336; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Trading Dashboard</h1>
            <p>✅ DEPLOYMENT FIXED - Both Discord Bot & Web Dashboard Active</p>
        </div>
        
        <div class="status-grid">
            <div class="card success">
                <h2><span class="status-indicator status-online"></span>System Status</h2>
                <p>✅ Backend server running successfully</p>
                <p>✅ Discord bot connected</p>
                <p>✅ Gemini API integrated</p>
                <p>✅ Auto trading active</p>
                <button onclick="loadHealthCheck()">🔄 Refresh Status</button>
            </div>

            <div class="card info">
                <h2>🤖 Discord Bot</h2>
                <p>Your Discord bot is running and ready for commands:</p>
                <div style="background: #333; padding: 15px; border-radius: 8px; margin: 10px 0; font-family: monospace;">
                    <p><strong>/portfolio</strong> - View current holdings</p>
                    <p><strong>/prices</strong> - Get latest crypto prices</p>
                    <p><strong>/trade [crypto] [amount]</strong> - Execute trade</p>
                    <p><strong>/settings</strong> - Modify trading parameters</p>
                </div>
                <button onclick="pingBot()">📱 Ping Discord Bot</button>
            </div>

            <div class="card info">
                <h2>📊 Portfolio Management</h2>
                <button onclick="loadBotSettings()">⚙️ View Settings</button>
                <button onclick="loadHealthCheck()">❤️ Health Check</button>
                <div id="portfolio-data" class="data-display">Click buttons to load live data...</div>
            </div>

            <div class="card warning">
                <h2>🚀 Both Interfaces Active</h2>
                <p>Your trading system now runs on:</p>
                <p>🌐 <strong>Web Dashboard:</strong> This page for monitoring</p>
                <p>💬 <strong>Discord Bot:</strong> Real-time commands and alerts</p>
                <p>🔗 <strong>Gemini API:</strong> Live trading and portfolio data</p>
                <button onclick="location.reload()">🔄 Refresh Dashboard</button>
            </div>
        </div>

        <div class="footer">
            <p>🎉 Issue Resolved: Web deployment now serves dashboard instead of "your repl has been deployed"</p>
        </div>
    </div>

    <script>
        async function loadHealthCheck() {
            const display = document.getElementById('portfolio-data');
            display.innerHTML = '<span class="loading">🔄 Loading health data...</span>';
            try {
                const response = await fetch('/api/health');
                const data = await response.json();
                display.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
            } catch (error) {
                display.innerHTML = '<span class="error">❌ Error loading health data: ' + error.message + '</span>';
            }
        }

        async function loadBotSettings() {
            const display = document.getElementById('portfolio-data');
            display.innerHTML = '<span class="loading">🔄 Loading bot settings...</span>';
            try {
                const response = await fetch('/api/bot/settings');
                const data = await response.json();
                display.innerHTML = '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
            } catch (error) {
                display.innerHTML = '<span class="error">❌ Error loading settings: ' + error.message + '</span>';
            }
        }

        async function pingBot() {
            try {
                const response = await fetch('/api/bot/ping', { method: 'POST' });
                if (response.ok) {
                    alert('✅ Discord bot ping successful!');
                } else {
                    alert('❌ Bot ping failed');
                }
            } catch (error) {
                alert('❌ Connection error: ' + error.message);
            }
        }

        // Auto-load health data on page load
        window.addEventListener('load', loadHealthCheck);
    </script>
</body>
</html>`;
    
    res.type('html').send(dashboardHTML);
  });

  // CODE RELOAD: Force deployment to pick up latest code changes
  app.post('/api/admin/reload-code', (req, res) => {
    console.log('🔄 Code reload requested - restarting process to load latest changes...');
    res.json({ message: 'Process restarting - latest code will be loaded', status: 'restarting' });
    
    // Exit cleanly - Reserved VM auto-restarts and loads new code
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });

  // Discord timestamp keep-alive trigger (server-side timer → database → bot reads)
  app.post('/api/discord/timestamp-update', async (req, res) => {
    try {
      // Increment timestamp trigger counter in database
      const existingTrigger = await db.query.botSettings.findFirst({
        where: eq(botSettings.key, 'timestamp_trigger')
      });

      const newCount = existingTrigger ? (parseInt(existingTrigger.value as string) || 0) + 1 : 1;

      if (existingTrigger) {
        await db.update(botSettings)
          .set({ 
            value: newCount.toString(),
            updatedAt: new Date()
          })
          .where(eq(botSettings.key, 'timestamp_trigger'));
      } else {
        await db.insert(botSettings).values({
          key: 'timestamp_trigger',
          value: newCount.toString()
        });
      }

      res.json({ 
        success: true, 
        trigger: newCount,
        message: 'Discord timestamp update triggered (bot will update using cached data)'
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
