import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { GeminiService } from "./services/gemini";
import { DiscordBotService } from "./services/discord-bot";
import { TradingEngine } from "./services/trading-engine";
import { insertTradingSettingsSchema, insertTradeOrderSchema, botSettings, botStatus } from "@shared/schema";
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

  // Get portfolio holdings from REAL Gemini API
  app.get("/api/portfolio/:userId", async (req, res) => {
    try {
      // Use environment Gemini API credentials (same as working system)
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const geminiApiSecret = process.env.GEMINI_API_SECRET;
      
      if (!geminiApiKey || !geminiApiSecret) {
        return res.json({
          holdings: [],
          totalValue: "0.00",
          error: "Gemini API credentials not available"
        });
      }

      // Initialize Gemini service with environment credentials (same as working system)
      const { GeminiService } = await import('./services/gemini.js');
      const geminiService = new GeminiService(
        geminiApiKey, 
        geminiApiSecret, 
        false // Use production mode for real balances
      );

      // Get REAL balances from Gemini API
      const balances = await geminiService.getBalances();
      
      // Convert to portfolio holdings format
      const holdings = balances
        .filter(balance => parseFloat(balance.available) > 0)
        .map(balance => ({
          currency: balance.currency.toUpperCase(),
          amount: balance.available,
          valueUSD: balance.currency.toLowerCase() === 'usd' ? balance.available : '0'
        }));

      // Get current prices for non-USD holdings
      for (const holding of holdings) {
        if (holding.currency !== 'USD') {
          try {
            const ticker = await geminiService.getTicker(`${holding.currency.toLowerCase()}usd`);
            const price = parseFloat(ticker.last);
            const amount = parseFloat(holding.amount);
            holding.valueUSD = (amount * price).toFixed(2);
          } catch (error) {
            console.warn(`Could not get price for ${holding.currency}:`, (error as Error).message);
            holding.valueUSD = '0';
          }
        }
      }

      const totalValue = holdings.reduce((sum, holding) => sum + parseFloat(holding.valueUSD || '0'), 0);
      
      res.json({
        holdings,
        totalValue: totalValue.toFixed(2),
      });
    } catch (error) {
      console.error('Portfolio API error:', (error as Error).message);
      res.status(500).json({ 
        error: "Failed to get portfolio from Gemini API",
        details: (error as Error).message 
      });
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

  // 🚀 NEW: Independent TradingEngine endpoint for Discord bot triggers
  app.post("/api/trading/execute-swing-trade", async (req, res) => {
    try {
      const { userId, reason, amount } = req.body;
      console.log(`📡 TradingEngine API called by Discord:`, { userId, reason, amount });
      
      // For now, simulate trade execution - will connect to actual TradingEngine later
      const result = {
        success: true, 
        message: `TradingEngine received Discord trigger: ${reason}`,
        amount: amount || 1.00,
        timestamp: new Date().toISOString()
      };
      
      console.log(`🎯 TradingEngine executing $${amount} swing trade: ${reason}`);
      res.json(result);
    } catch (error) {
      console.error('TradingEngine API error:', error);
      res.status(500).json({ error: "TradingEngine execution failed" });
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
      
      // Enhanced logging for bot pings
      const pingTime = new Date().toLocaleTimeString();
      console.log(`🤖 Bot ping at ${pingTime} - Status: ${status || 'running'}`);
      
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

  return httpServer;
}
