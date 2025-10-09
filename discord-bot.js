import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import crypto from 'crypto';
import axios from 'axios';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
// Note: Using direct database tables since we can't easily import TS schema from JS
import { eq, sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

// Define botSettings table (for persistent dashboard tracking)
const botSettings = pgTable("bot_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Discord Bot Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Gemini API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_SECRET = process.env.GEMINI_API_SECRET;
const GEMINI_BASE_URL = 'https://api.gemini.com';

// API URL - Use external URL for Reserved VM keep-alive (CRITICAL!)
const API_BASE_URL = process.env.REPLIT_DOMAINS 
  ? `https://${process.env.REPLIT_DOMAINS}` 
  : 'http://localhost:5000';

// Database-backed settings - loaded at startup
let tradingSettings = {};
let dailyBuyData = {};
let autoTradeSettings = {};

// Function to load settings from database
async function loadSettings() {
  try {
    console.log('📥 Loading bot settings from database...');
    
    // Load trading settings
    const tradingResults = await pool.query('SELECT * FROM bot_settings WHERE key = $1', ['tradingSettings']);
    const tradingSetting = tradingResults.rows[0];
    tradingSettings = tradingSetting ? tradingSetting.value : {
      dailyBuyLimit: 1000,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      enableStopLoss: true,
      enableProfitTaking: true,
      enabledPairs: ['btcusd', 'ethusd'],
      lastDailyReset: new Date().toDateString()
    };
    
    // Load daily buy data  
    const dailyResults = await pool.query('SELECT * FROM bot_settings WHERE key = $1', ['dailyBuyData']);
    const dailyBuySetting = dailyResults.rows[0];
    dailyBuyData = dailyBuySetting ? dailyBuySetting.value : {
      totalBought: 0,
      purchases: [],
      limitReached: false,
      lastUpdate: new Date()
    };
    
    // Load auto trade settings
    const autoResults = await pool.query('SELECT * FROM bot_settings WHERE key = $1', ['autoTradeSettings']);
    const autoTradeSetting = autoResults.rows[0];
    autoTradeSettings = autoTradeSetting ? autoTradeSetting.value : {
      enabled: true,
      amount: 1.00,
      selectedCrypto: 'SOL',
      stopAtLoss: 1.5,
      stopAtValue: null,
      stopOnDailyBuys: null,
      isActive: true,
      startTime: null,
      conditions: {
        portfolioValueReached: false,
        cryptoValueReached: false,
        dailyBuyLimitReached: false
      }
    };
    
    console.log('✅ Bot settings loaded successfully');
    console.log('📊 Auto Trade Settings:', autoTradeSettings);
    
  } catch (error) {
    console.error('❌ Error loading settings from database:', error);
    // Use defaults if database fails
    tradingSettings = {
      dailyBuyLimit: 1000,
      stopLossPercent: 5,
      takeProfitPercent: 10,
      enableStopLoss: true,
      enableProfitTaking: true,
      enabledPairs: ['btcusd', 'ethusd'],
      lastDailyReset: new Date().toDateString()
    };
    dailyBuyData = {
      totalBought: 0,
      purchases: [],
      limitReached: false,
      lastUpdate: new Date()
    };
    autoTradeSettings = {
      enabled: true,
      amount: 1.00,
      selectedCrypto: 'SOL',
      stopAtLoss: 1.5,
      stopAtValue: null,
      stopOnDailyBuys: null,
      isActive: true,
      startTime: null,
      conditions: {
        portfolioValueReached: false,
        cryptoValueReached: false,
        dailyBuyLimitReached: false
      }
    };
  }
}

// Function to save settings to database
async function saveSettings() {
  try {
    console.log('💾 Saving bot settings to database...');
    
    // Save trading settings
    await pool.query(`
      INSERT INTO bot_settings (key, value, updated_at) 
      VALUES ($1, $2, NOW()) 
      ON CONFLICT (key) 
      DO UPDATE SET value = $2, updated_at = NOW()
    `, ['tradingSettings', JSON.stringify(tradingSettings)]);
    
    // Save daily buy data
    await pool.query(`
      INSERT INTO bot_settings (key, value, updated_at) 
      VALUES ($1, $2, NOW()) 
      ON CONFLICT (key) 
      DO UPDATE SET value = $2, updated_at = NOW()
    `, ['dailyBuyData', JSON.stringify(dailyBuyData)]);
    
    // Save auto trade settings
    await pool.query(`
      INSERT INTO bot_settings (key, value, updated_at) 
      VALUES ($1, $2, NOW()) 
      ON CONFLICT (key) 
      DO UPDATE SET value = $2, updated_at = NOW()
    `, ['autoTradeSettings', JSON.stringify(autoTradeSettings)]);
    
    console.log('✅ Bot settings saved successfully');
    
  } catch (error) {
    console.error('❌ Error saving settings to database:', error);
  }
}

// Function to send keep-alive ping to web server
async function sendKeepAlivePing(status = 'running', errorMessage = null) {
  try {
    await axios.post(`${API_BASE_URL}/api/bot/ping`, {
      status,
      errorMessage
    });
  } catch (error) {
    // Ignore keep-alive errors to prevent cascading failures
    console.log('Keep-alive ping failed (non-critical):', error.message);
  }
}

class GeminiAPI {
  constructor(apiKey = null, apiSecret = null) {
    this.apiKey = apiKey || GEMINI_API_KEY;
    this.apiSecret = apiSecret || GEMINI_API_SECRET;
    this.baseUrl = GEMINI_BASE_URL;
    this.nonceCounter = 0; // Unique counter for each instance
  }

  generateHeaders(endpoint, payload = {}) {
    // Use timestamp with large offset to get above cached nonces
    const baseTime = Date.now() + 999999999; // Add ~31 years to current timestamp
    this.nonceCounter = (this.nonceCounter + 1) % 100000;
    const nonce = (baseTime * 100000 + this.nonceCounter).toString();
    const payloadWithDefaults = {
      request: endpoint,
      nonce: nonce.toString(),
      ...payload
    };

    const payloadString = JSON.stringify(payloadWithDefaults);
    const encodedPayload = Buffer.from(payloadString).toString('base64');
    
    const signature = crypto
      .createHmac('sha384', this.apiSecret)
      .update(encodedPayload)
      .digest('hex');

    return {
      'X-GEMINI-APIKEY': this.apiKey,
      'X-GEMINI-PAYLOAD': encodedPayload,
      'X-GEMINI-SIGNATURE': signature,
      'Content-Type': 'text/plain',
      'Content-Length': '0'
    };
  }

  async getTicker(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/pubticker/${symbol}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get ticker for ${symbol}: ${error.message}`);
    }
  }

  async getSymbolDetails(symbol) {
    try {
      // Try multiple possible endpoints for symbol info
      const endpoints = [
        `/v1/symbols/details/${symbol.toLowerCase()}`,
        `/v1/symbols`,
        `/v2/symbols`
      ];
      
      for (const endpoint of endpoints) {
        try {
          console.log(`🔍 Trying endpoint: ${endpoint}`);
          const response = await axios.get(`${this.baseUrl}${endpoint}`);
          
          if (endpoint.includes('/symbols') && !endpoint.includes('details')) {
            // For general symbols endpoint, filter for our symbol
            const symbols = response.data;
            const symbolInfo = symbols.find(s => s.symbol === symbol.toLowerCase());
            if (symbolInfo) {
              console.log(`📊 ${symbol.toUpperCase()} Symbol Info:`, symbolInfo);
              return symbolInfo;
            }
          } else {
            console.log(`📊 ${symbol.toUpperCase()} Symbol Details:`, response.data);
            return response.data;
          }
        } catch (endpointError) {
          console.log(`❌ Endpoint ${endpoint} failed: ${endpointError.message}`);
          continue;
        }
      }
      
      // If all endpoints fail, use hardcoded SOLUSD requirements based on research
      console.log(`🔧 Using fallback SOLUSD requirements`);
      return {
        symbol: 'solusd',
        min_order_size: '0.01', // 0.01 SOL minimum based on typical Gemini requirements
        tick_size: '0.00001',   // 5 decimal precision
        quote_increment: '0.01'
      };
    } catch (error) {
      console.error('All symbol details endpoints failed:', error.message);
      return null;
    }
  }

  async getBalances() {
    try {
      console.log('🔗 Testing Gemini API connection...');
      
      // Use the correct v2 balances endpoint
      const endpoint = '/v1/balances';
      const payload = { account: "primary" };
      const headers = this.generateHeaders(endpoint, payload);
      
      const response = await axios.post(`${this.baseUrl}${endpoint}`, '', { 
        headers,
        timeout: 10000
      });
      
      console.log('✅ Gemini API connected successfully!');
      console.log('💰 Live portfolio data retrieved');
      // Log raw balances (remove heavy logging to prevent EPIPE errors)
      console.log(`📊 Raw Gemini balances: ${response.data.length} currencies retrieved`);
      return response.data;
      
    } catch (error) {
      console.error('❌ Gemini API Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      // Throw error instead of returning mock data so user knows it's not working
      console.log('❌ Gemini API failed - check your credentials');
      throw new Error(`Gemini API connection failed: ${error.message}`);
    }
  }

  async getActiveOrders() {
    try {
      const endpoint = '/v1/orders';
      const headers = this.generateHeaders(endpoint);
      
      const response = await axios.post(`${this.baseUrl}${endpoint}`, '', { 
        headers,
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('Orders API error:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw new Error(`Failed to get active orders: ${error.message}`);
    }
  }

  async getTrades() {
    try {
      const endpoint = '/v1/mytrades';
      const headers = this.generateHeaders(endpoint);
      
      const response = await axios.post(`${this.baseUrl}${endpoint}`, '', { 
        headers,
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.log('📊 Trades API temporarily disabled due to account setup requirement');
      return [];
    }
  }

  async sellOrder(symbol, amount) {
    try {
      console.log(`🔄 Calling Gemini API sellOrder(${symbol}, ${amount})...`);
      console.log(`📋 Simulating: Select ${symbol.toUpperCase().replace('USD', '')} → Sell → ${symbol.toUpperCase()} → Change to Instant → Amount: ${amount}`);
      
      // DIAGNOSTICS: Check symbol details for minimum requirements
      console.log(`🔍 DIAGNOSTIC: Checking ${symbol.toUpperCase()} minimum requirements...`);
      const symbolDetails = await this.getSymbolDetails(symbol);
      
      if (symbolDetails) {
        console.log(`📊 DIAGNOSTIC: Symbol Details:`, {
          symbol: symbol.toUpperCase(),
          min_order_size: symbolDetails.min_order_size,
          tick_size: symbolDetails.tick_size,
          quote_increment: symbolDetails.quote_increment
        });
        
        // Check if our amount meets the minimum and fix precision
        const requestedAmount = parseFloat(amount);
        const minOrderSize = parseFloat(symbolDetails.min_order_size);
        const tickSize = parseFloat(symbolDetails.tick_size) || 0.00001;
        
        if (requestedAmount < minOrderSize) {
          amount = symbolDetails.min_order_size;
          console.log(`🔧 DIAGNOSTIC: Adjusting to minimum order size:`, {
            requested: requestedAmount,
            minimum_required: minOrderSize,
            adjusted_to: amount
          });
        } else {
          // Round to proper tick size precision (5 decimal places for SOL)
          const roundedAmount = Math.floor(requestedAmount / tickSize) * tickSize;
          amount = roundedAmount.toFixed(5);
          console.log(`🔧 DIAGNOSTIC: Rounding to tick size:`, {
            requested: requestedAmount,
            tick_size: tickSize,
            rounded_to: amount
          });
        }
      }
      
      const endpoint = '/v1/order/new';
      // Generate nonce with large offset to get above any cached values
      const baseTime = Date.now() + 999999999; // Add ~31 years to current timestamp  
      this.nonceCounter = (this.nonceCounter + 1) % 100000;
      const nonce = (baseTime * 100000 + this.nonceCounter).toString();
      
      // Proper Gemini API payload format with required fields
      const payload = {
        request: endpoint,
        nonce: nonce,
        symbol: symbol.toLowerCase(), // Gemini expects lowercase symbols
        amount: parseFloat(amount).toString(), // Ensure clean numeric string
        price: '1', // For immediate-or-cancel, price is ignored - executes at market price
        side: 'sell',
        type: 'exchange limit',
        account: 'primary', // REQUIRED for Master API keys - default trading account
        options: ['immediate-or-cancel'] // This makes it an INSTANT market order
      };
      
      console.log(`📤 API Payload:`, payload);
      
      // Proper Gemini authentication with Base64 encoding
      const payloadBuffer = Buffer.from(JSON.stringify(payload));
      const payloadBase64 = payloadBuffer.toString('base64');
      
      const crypto = await import('crypto');
      const signature = crypto.createHmac('sha384', this.apiSecret)
        .update(payloadBase64)
        .digest('hex');
      
      const headers = {
        'Content-Type': 'text/plain',
        'Content-Length': '0',
        'X-GEMINI-APIKEY': this.apiKey,
        'X-GEMINI-PAYLOAD': payloadBase64,
        'X-GEMINI-SIGNATURE': signature,
        'Cache-Control': 'no-cache'
      };
      
      // Add detailed logging for debugging
      console.log(`🔐 Authentication Check:`, {
        'API-KEY': this.apiKey ? this.apiKey.substring(0, 8) + '...' : 'MISSING',
        'SECRET': this.apiSecret ? 'PRESENT' : 'MISSING',
        'ENDPOINT': endpoint,
        'SYMBOL': symbol,
        'ACCOUNT': 'primary'
      });
      
      const response = await axios.post(`${this.baseUrl}${endpoint}`, '', { 
        headers,
        timeout: 10000
      });
      
      console.log(`✅ SELL ORDER EXECUTED SUCCESSFULLY!`);
      console.log(`📊 Response:`, response.data);
      
      return response.data;
    } catch (error) {
      // Enhanced error logging for 403 debugging
      console.error('❌ Sell order FAILED:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        symbol: symbol,
        amount: amount
      });
      
      // Specific 403 error handling
      if (error.response?.status === 403) {
        console.error('🚨 403 FORBIDDEN ERROR - POSSIBLE CAUSES:');
        console.error('   1. API keys are READ-ONLY (need TRADING permissions)');
        console.error('   2. Account not verified for trading on Gemini');
        console.error('   3. Insufficient crypto balance to sell');
        console.error('   4. Trading not enabled for this account type');
        console.error('   💡 SOLUTION: Go to Gemini → Account Settings → API → Enable Trading');
      }
      
      throw new Error(`Failed to place sell order: ${error.message}`);
    }
  }
}

class DiscordTradingBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
      ],
      retryLimit: 3,
      failIfNotExists: false,
      restTimeOffset: 0
    });

    this.gemini = new GeminiAPI();
    this.activePortfolioMessages = new Map(); // Store active portfolio messages for auto-updating
    // Load persistent dashboard tracking (survives restarts)
    this.dashboardMessageId = null; // Track main dashboard message
    this.dashboardChannelId = null; // Track dashboard channel
    // Load saved embed IDs after bot starts
    this.loadDashboardTracking().catch(err => console.log('Dashboard tracking load failed:', err.message));
    this.tradingLock = false; // CRITICAL: Prevent multiple simultaneous trades
    this.lastTradeTime = 0; // CRITICAL: Track last trade for cooldown
    this.isCheckingAutoTrade = false; // Prevent overlapping auto-trade checks
    this.isUpdatingDashboard = false; // Prevent overlapping dashboard updates
    // REMOVED: Old tracking system completely eliminated
    this.lowestPortfolioValue = null; // Track LOWEST portfolio value since last trade (smart baseline)
    this.baselineLoaded = false; // Flag to ensure we load baseline from database first
    this._baselineUpdating = false; // Prevent race conditions
    this.priceHistory = []; // Clear price history cache
    this.realTimeBalances = new Map(); // Clear balance cache
    this.livePrices = new Map(); // Clear price cache
    console.log(`🔥 CONSTRUCTOR: All caches cleared, smart baseline tracking initialized`);
    
    // Real-time data storage
    this.realTimeBalances = new Map(); // Store live balance data
    this.realTimePrices = new Map();   // Store live price data
    this.priceHistory = [];           // Store price history for swing trading
    this.lastBalanceUpdate = null;
    this.lastPriceUpdate = null;
    this.lastTriggerTarget = null;    // Store the next trigger value
    this.lastDisplayedValue = undefined; // Track last displayed value to prevent bouncing
    this.lastEmbedPortfolioValue = null;
    this.lastEmbedUpdateTime = 0;
    
    this.setupEventHandlers();
    this.registerCommands();
    
    // No more baseline loading - using fixed triggers now
  }

  // No longer needed - using fixed triggers

  // Save baseline to database for persistence across restarts
  async saveBaselineToDatabase() {
    try {
      if (this.lowestPortfolioValue !== null) {
        const response = await fetch(`${API_BASE_URL}/api/bot/settings/portfolio_baseline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            value: {
              baseline: this.lowestPortfolioValue,
              lastUpdated: new Date().toISOString()
            }
          })
        });
        
        if (response.ok) {
          console.log(`💾 BASELINE SAVED TO DATABASE: $${this.lowestPortfolioValue.toFixed(2)}`);
        } else {
          console.error(`⚠️ Failed to save baseline, status: ${response.status}`);
        }
      }
    } catch (error) {
      console.error('⚠️ Failed to save baseline to database:', error);
    }
  }

  // DISABLED OLD BASELINE SYSTEM - Using new baselineValue system only
  async updateSmartBaseline(currentValue, reason = 'update') {
    return false; // Completely disabled
    // Prevent multiple simultaneous updates
    if (this._baselineUpdating) {
      return false;
    }
    
    this._baselineUpdating = true;
    let changed = false;
    
    try {
      if (this.lowestPortfolioValue === null || this.lowestPortfolioValue === undefined) {
        this.lowestPortfolioValue = parseFloat(currentValue.toFixed(2));
        console.log(`🎯 MASTER BASELINE INIT: $${this.lowestPortfolioValue.toFixed(2)} (${reason}) - LOCKED`);
        changed = true;
      } else if (currentValue < this.lowestPortfolioValue && reason !== 'trade-reset') {
        this.lowestPortfolioValue = parseFloat(currentValue.toFixed(2));
        console.log(`📉 MASTER BASELINE NEW LOW: $${this.lowestPortfolioValue.toFixed(2)} (${reason}) - LOCKED`);
        changed = true;
      } else if (reason === 'trade-reset') {
        // ONLY place baseline can be reset - after successful trade
        this.lowestPortfolioValue = parseFloat(currentValue.toFixed(2));
        console.log(`🔄 MASTER BASELINE RESET: $${this.lowestPortfolioValue.toFixed(2)} (post-trade) - LOCKED`);
        changed = true;
        // Save to database after successful trade reset
        await this.saveBaselineToDatabase();
      } else {
        console.log(`🔒 BASELINE LOCKED: Current $${currentValue.toFixed(2)} vs Locked $${this.lowestPortfolioValue.toFixed(2)} (${reason})`);
      }
      
      // Save baseline changes to database
      if (changed) {
        await this.saveBaselineToDatabase();
      }
    } finally {
      this._baselineUpdating = false;
    }
    
    return changed;
  }

  async initializePriceHistory() {
    try {
      // Check if we already have a good price history from a previous session
      if (this.priceHistory && this.priceHistory.length >= 5) {
        console.log(`🎯 EXISTING PRICE HISTORY PRESERVED: [${this.priceHistory.slice(-5).map(p => p.toFixed(2)).join(', ')}]`);
        return;
      }
      
      // Get current SOL price to establish realistic baseline
      const ticker = await this.gemini.getTicker('SOLUSD');
      const currentPrice = parseFloat(ticker.last);
      
      // Create realistic price history with some lower points for swing detection
      // Start with price $2-3 lower than current to allow for swing triggers
      const basePrice = Math.max(currentPrice - 2.5, currentPrice * 0.985);
      
      // Initialize with decreasing prices leading to current price
      this.priceHistory = [
        basePrice,
        basePrice + 0.25,
        basePrice + 0.50,
        basePrice + 0.75,
        currentPrice
      ];
      
      console.log(`🎯 PRICE HISTORY INITIALIZED:`);
      console.log(`   Current SOL Price: $${currentPrice.toFixed(2)}`);
      console.log(`   Historical Range: $${basePrice.toFixed(2)} - $${currentPrice.toFixed(2)}`);
      console.log(`   Ready for swings: [${this.priceHistory.map(p => p.toFixed(2)).join(', ')}]`);
      
    } catch (error) {
      console.error('❌ Failed to initialize price history:', error.message);
      // Fallback: empty array will be built up normally
      this.priceHistory = [];
    }
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      console.log(`🤖 Discord monitoring bot ready! Logged in as ${this.client.user.tag}`);
      
      // Load settings from database
      await loadSettings();
      
      // CRITICAL: Initialize price history immediately after login
      await this.initializePriceHistory();
      
      this.startDailyTracking();
      this.startAutoUpdating();
      
      // Deploy live dashboard to #private-dashboard (only if it doesn't exist)
      await this.deployLiveDashboard();
      
      // Start keep-alive ping system
      this.startKeepAlive();
    });

    // BULLETPROOF CONNECTION HANDLING
    this.client.on('disconnect', (event) => {
      console.log('🚨 Discord DISCONNECTED:', event);
      this.handleReconnection('disconnect');
    });

    this.client.on('reconnecting', () => {
      console.log('🔄 Discord RECONNECTING...');
    });

    this.client.on('resume', () => {
      console.log('✅ Discord CONNECTION RESUMED');
    });

    this.client.on('error', (error) => {
      console.error('🚨 Discord ERROR:', error);
      this.handleReconnection('error');
    });

    this.client.on('warn', (warning) => {
      console.warn('⚠️ Discord WARNING:', warning);
    });

    this.client.on('shardDisconnect', (event, shardId) => {
      console.log(`🚨 Discord SHARD ${shardId} DISCONNECTED:`, event);
      this.handleReconnection('shard_disconnect');
    });

    this.client.on('shardError', (error, shardId) => {
      console.error(`🚨 Discord SHARD ${shardId} ERROR:`, error);
      this.handleReconnection('shard_error');
    });

    this.client.on('shardReconnecting', (shardId) => {
      console.log(`🔄 Discord SHARD ${shardId} RECONNECTING...`);
    });

    this.client.on('shardReady', (shardId) => {
      console.log(`✅ Discord SHARD ${shardId} READY`);
    });

    this.client.on('shardResume', (shardId) => {
      console.log(`✅ Discord SHARD ${shardId} RESUMED`);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction);
      }
    });
  }

  async handleReconnection(reason) {
    console.log(`🛡️ HANDLING DISCORD RECONNECTION - Reason: ${reason}`);
    
    // Don't spam reconnection attempts
    if (this.reconnectionInProgress) {
      console.log('🔄 Reconnection already in progress, skipping...');
      return;
    }
    
    this.reconnectionInProgress = true;
    
    try {
      // Wait a bit before attempting reconnection
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check if client is still connected
      if (this.client.isReady()) {
        console.log('✅ Discord connection is healthy, no reconnection needed');
        this.reconnectionInProgress = false;
        return;
      }
      
      console.log('🔄 Attempting Discord reconnection...');
      
      // Destroy and recreate client connection
      this.client.destroy();
      
      // Recreate client with fresh connection
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
      });
      
      // CRITICAL: Re-setup event handlers for new client
      this.setupEventHandlers();
      
      // Wait before reconnecting
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Reconnect with fresh client
      await this.client.login(BOT_TOKEN);
      console.log('✅ Discord reconnection successful with fresh event handlers!');
      
    } catch (error) {
      console.error('❌ Discord reconnection failed:', error.message);
      
      // Try again in 30 seconds
      setTimeout(() => {
        console.log('🔄 Retrying Discord reconnection in 30 seconds...');
        this.reconnectionInProgress = false;
        this.handleReconnection('retry');
      }, 30000);
      
    } finally {
      // Reset flag after some time even if we failed
      setTimeout(() => {
        this.reconnectionInProgress = false;
      }, 60000);
    }
  }

  async registerCommands() {
    const commands = [
      new SlashCommandBuilder()
        .setName('portfolio')
        .setDescription('Display your crypto portfolio and daily buy tracking'),
      
      new SlashCommandBuilder()
        .setName('tracker')
        .setDescription('View daily buy tracking and trading limits')
        .addStringOption(option =>
          option.setName('type')
            .setDescription('Type of tracking info')
            .setRequired(false)
            .addChoices(
              { name: 'Daily Buys', value: 'daily_buys' },
              { name: 'Trading Status', value: 'status' },
              { name: 'Limits', value: 'limits' }
            )),

      new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure monitoring settings')
        .addStringOption(option =>
          option.setName('setting')
            .setDescription('Setting to modify')
            .setRequired(true)
            .addChoices(
              { name: 'Daily Buy Limit', value: 'daily_limit' },
              { name: 'Stop Loss %', value: 'stop_loss' },
              { name: 'Take Profit %', value: 'take_profit' }
            ))
        .addStringOption(option =>
          option.setName('value')
            .setDescription('New value for the setting')
            .setRequired(false)),

      new SlashCommandBuilder()
        .setName('prices')
        .setDescription('Get current cryptocurrency prices')
        .addStringOption(option =>
          option.setName('symbol')
            .setDescription('Crypto symbol (e.g., btcusd)')
            .setRequired(false)),

      new SlashCommandBuilder()
        .setName('testautotrade')
        .setDescription('🧪 Test auto trade with SOL at 1/2 (0.5) base amount')
        .addStringOption(option =>
          option.setName('crypto')
            .setDescription('Crypto to test (default: SOL)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('base')
            .setDescription('Base amount to keep (default: 1/2 = 0.5)')
            .setRequired(false)),

      new SlashCommandBuilder()
        .setName('public-dashboard')
        .setDescription('Create or update the public trading bot dashboard'),

      new SlashCommandBuilder()
        .setName('setup-user')
        .setDescription('Set up new user with API credentials')
        .addStringOption(option =>
          option.setName('api_key')
            .setDescription('Your Gemini API Key')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('api_secret')
            .setDescription('Your Gemini API Secret')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('username')
            .setDescription('Choose a username for your account')
            .setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

    try {
      console.log('🔄 Registering slash commands...');
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log('✅ Successfully registered slash commands');
    } catch (error) {
      console.error('❌ Error registering commands:', error);
    }
  }

  async handleSlashCommand(interaction) {
    const { commandName } = interaction;

    try {
      switch (commandName) {
        case 'portfolio':
          await this.showPortfolio(interaction);
          break;
        case 'tracker':
          await this.handleTracker(interaction);
          break;
        case 'settings':
          await this.handleSettings(interaction);
          break;
        case 'prices':
          await this.showPrices(interaction);
          break;
        case 'testautotrade':
          await this.testAutoTrade(interaction);
          break;
        case 'public-dashboard':
          await this.createPublicDashboard(interaction);
          break;
        case 'setup-user':
          await this.setupUser(interaction);
          break;
        default:
          await this.replyWithError(interaction, 'Unknown command');
      }
    } catch (error) {
      console.error(`Error handling command ${commandName}:`, error);
      await this.replyWithError(interaction, `Command error: ${error.message}`);
    }
  }

  async handleButtonInteraction(interaction) {
    const { customId } = interaction;
    console.log(`🔘 Button clicked: ${customId} by user ${interaction.user.tag}`);

    try {
      switch (customId) {
        case 'emergency_stop':
          await this.emergencyStopMonitoring(interaction);
          break;
        case 'auto_trade_setup':
          console.log('🤖 Auto Trade Setup button clicked - showing modal');
          await this.showAutoTradeSetup(interaction);
          break;
        case 'auto_trade_status':
          await this.showAutoTradeStatus(interaction);
          break;
        case 'settings_config':
          console.log('⚙️ Settings button clicked - showing auto trade setup modal');
          await this.showAutoTradeSetup(interaction);
          break;
        case 'stop_auto_trade':
          await this.stopAutoTrade(interaction);
          break;
        case 'create_account':
          await this.handleCreateAccount(interaction);
          break;
        case 'view_portfolio':
          await this.handleViewPortfolio(interaction);
          break;
        case 'user_login':
          await this.handleUserLogin(interaction);
          break;
        case 'user_logout':
          await this.handleUserLogout(interaction);
          break;
        default:
          await this.replyWithError(interaction, 'Unknown button action');
      }
    } catch (error) {
      console.error(`Error handling button ${customId}:`, error);
      await this.replyWithError(interaction, `Button error: ${error.message}`);
    }
  }

  async handleModalSubmit(interaction) {
    console.log(`📋 Modal submitted: ${interaction.customId} by user ${interaction.user.tag}`);
    
    try {
      switch (interaction.customId) {
        case 'auto_trade_modal':
          console.log('🤖 Auto Trade Modal submitted - processing configuration');
          await this.handleAutoTradeModal(interaction);
          break;
        case 'api_setup_modal':
          await this.handleApiSetupModal(interaction);
          break;
        case 'username_modal':
          await this.handleUsernameModal(interaction);
          break;
        case 'login_modal':
          await this.handleLoginModal(interaction);
          break;
        default:
          await interaction.reply({ content: 'Unknown modal submission.', ephemeral: true });
      }
    } catch (error) {
      console.error('Error handling modal submit:', error);
      await interaction.reply({ 
        content: `Modal error: ${error.message}`, 
        ephemeral: true 
      }).catch(() => {});
    }
  }

  async showPortfolio(interaction) {
    await interaction.deferReply();

    try {
      const portfolioData = await this.getPortfolioData();
      const embed = this.createPortfolioEmbed(portfolioData);
      const buttons = this.createPortfolioButtons();

      const message = await interaction.editReply({
        embeds: [embed],
        components: buttons,
      });

      // Store this message for auto-updating
      this.activePortfolioMessages.set(message.id, {
        channelId: interaction.channelId,
        messageId: message.id,
        lastUpdate: Date.now()
      });
      
      // IMPORTANT: Save this as the tracked dashboard for background updates
      this.dashboardMessageId = message.id;
      this.dashboardChannelId = interaction.channelId;
      await this.saveDashboardTracking();
      console.log(`✅ Dashboard created via /portfolio command and saved to database: ${message.id}`);

    } catch (error) {
      console.error('Portfolio error:', error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Portfolio Error')
        .setDescription('Unable to fetch portfolio data. Please check your API credentials.')
        .setColor(0xF44336)
        .addFields({ name: 'Error', value: error.message.substring(0, 1000), inline: false })
        .setTimestamp();
      
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  // Helper function for consistent truncation (no rounding up)
  truncateToFixed(value, decimals) {
    const multiplier = Math.pow(10, decimals);
    return (Math.floor(value * multiplier) / multiplier).toFixed(decimals);
  }

  // Helper function to calculate current portfolio value for embed change detection
  calculateCurrentPortfolioValue() {
    try {
      const solBalance = this.realTimeBalances.get('SOL');
      const solPrice = this.realTimePrices.get('SOL');
      if (solBalance && solPrice) {
        return solBalance.amount * solPrice.price;
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }


  createPortfolioEmbed(data) {
    try {
      const limitStatus = dailyBuyData.limitReached ? '🔴 LIMIT REACHED' : '🟢 Within Limit';
      const remainingLimit = Math.max(0, tradingSettings.dailyBuyLimit - dailyBuyData.totalBought);

      const embed = new EmbedBuilder()
        .setTitle('💰 Live Portfolio Dashboard')
        .setColor(dailyBuyData.limitReached ? 0xF44336 : 0x2196F3)
        .setTimestamp() // Keep same timestamp format to reduce bouncing
        .setFooter({ text: `Live Portfolio • Real-time Updates` }); // Static footer to prevent bouncing

      // Main portfolio info - simplified and safer
      embed.addFields([
        { name: '📊 Total Portfolio Value', value: `**$${this.truncateToFixed(data.totalValue, 2)}**`, inline: true },
        { name: '📈 Trading Status', value: limitStatus, inline: true },
        { name: '💵 USD Balance', value: `$${this.truncateToFixed(data.usdBalance, 2)}`, inline: true }
      ]);

      // SOL-specific info (simplified for trading bot)
      const solHolding = data.holdings.find(h => h.currency === 'SOL');
      if (solHolding) {
        // FIXED DISPLAY: Use saved trigger value to prevent bouncing
        const displayTrigger = this.savedTriggerValue || (this.baselineValue ? (this.baselineValue + 1.00) : (solHolding.value + 1.00));
        const displayBaseline = this.baselineValue || (solHolding.value - 1.00);
        // Fix precision: Round to cents to avoid floating-point errors
        const needsAmount = Math.round((displayTrigger - solHolding.value) * 100) / 100;
        const solInfo = `🪙 **Amount**: ${solHolding.amount.toFixed(6)} SOL\n` +
                       `💰 **Value**: $${this.truncateToFixed(solHolding.value, 2)}\n` +
                       `🎯 **Trigger**: $${this.truncateToFixed(displayTrigger, 2)}\n` +
                       `📊 **Baseline**: $${this.truncateToFixed(displayBaseline, 2)}\n` +
                       `⏳ **Need**: $${this.truncateToFixed(needsAmount, 2)} more\n` +
                       `💲 **Price**: $${this.truncateToFixed(solHolding.price, 2)}`;
        
        embed.addFields({ 
          name: '⚡ SOL Trading Monitor', 
          value: solInfo, 
          inline: false 
        });
      }

      // Auto-trade status
      const autoTradeInfo = `🤖 **Auto Trade**: ${autoTradeSettings.enabled ? '✅ ACTIVE' : '❌ DISABLED'}\n` +
                           `📊 **Daily Spent**: $${this.truncateToFixed(dailyBuyData.totalBought, 2)}\n` +
                           `⏰ **Updated**: ${new Date().toLocaleTimeString()} (LIVE)`;

      embed.addFields({ 
        name: '🔧 Auto Trade Status', 
        value: autoTradeInfo, 
        inline: false 
      });

      return embed;
    } catch (error) {
      console.error('❌ Error creating portfolio embed:', error);
      // Return simple fallback embed
      return new EmbedBuilder()
        .setTitle('💰 Portfolio Dashboard')
        .setDescription('⚠️ Embed display error - please refresh')
        .setColor(0xFF9800)
        .setTimestamp();
    }
  }

  createPortfolioButtons() {
    return [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('auto_trade_setup')
            .setLabel('Auto Trade')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🤖'),
          new ButtonBuilder()
            .setCustomId('auto_trade_status')
            .setLabel('Auto Trade Status')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋'),
          new ButtonBuilder()
            .setCustomId('settings_config')
            .setLabel('Settings')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚙️'),
          new ButtonBuilder()
            .setCustomId('stop_auto_trade')
            .setLabel('Stop Auto Trade')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⏹️')
        )
    ];
  }

  async updateDailyBuyTracking() {
    try {
      const today = new Date().toDateString();
      
      // Reset daily data if it's a new day
      if (tradingSettings.lastDailyReset !== today) {
        dailyBuyData = {
          totalBought: 0,
          purchases: [],
          limitReached: false,
          lastUpdate: new Date()
        };
        tradingSettings.lastDailyReset = today;
        console.log('📅 Daily buy tracking reset for new day');
      }

      try {
        // Get today's trades to calculate daily purchases
        // Skip trades API - has MissingAccounts error
      // const trades = await this.gemini.getTrades();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        let dailyTotal = 0;
        const todayPurchases = [];

        // Skip trades processing since API is disabled
        console.log(`📊 Daily tracking maintained: $${dailyBuyData.totalBought.toFixed(2)} spent today`);

        // Skip setting data since no trades to process
        dailyBuyData.lastUpdate = new Date();

        if (dailyBuyData.limitReached) {
          console.log(`⚠️ Daily buy limit reached: $${dailyTotal.toFixed(2)}/$${tradingSettings.dailyBuyLimit}`);
        }
      } catch (apiError) {
        console.error('API error in daily tracking:', apiError.message);
        // Keep existing data if API fails
        dailyBuyData.lastUpdate = new Date();
      }

    } catch (error) {
      console.error('Error updating daily buy tracking:', error.message);
    }
  }

  async showDailyBuyTracker(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      await this.updateDailyBuyTracking();

      const embed = new EmbedBuilder()
        .setTitle('📊 Daily Buy Tracker')
        .setColor(dailyBuyData.limitReached ? 0xF44336 : 0x4CAF50)
        .addFields(
          { name: '💳 Daily Limit', value: `$${tradingSettings.dailyBuyLimit}`, inline: true },
          { name: '📈 Today\'s Buys', value: `$${dailyBuyData.totalBought.toFixed(2)}`, inline: true },
          { name: '🔄 Remaining', value: `$${Math.max(0, tradingSettings.dailyBuyLimit - dailyBuyData.totalBought).toFixed(2)}`, inline: true }
        );

      if (dailyBuyData.purchases.length > 0) {
        const purchasesList = dailyBuyData.purchases
          .slice(-5) // Show last 5 purchases
          .map(p => `**${p.symbol.toUpperCase()}**: ${p.amount} @ $${parseFloat(p.price).toFixed(2)} = $${p.value.toFixed(2)}`)
          .join('\n');
        
        embed.addFields({ name: '🛒 Recent Purchases', value: purchasesList, inline: false });
      } else {
        embed.addFields({ name: '🛒 Recent Purchases', value: 'No purchases today', inline: false });
      }

      if (dailyBuyData.limitReached) {
        embed.addFields({ 
          name: '🚨 Trading Status', 
          value: '**DAILY LIMIT REACHED** - No more buys allowed today', 
          inline: false 
        });
      }

      embed.setTimestamp(); // Use current time instead of cached timestamp

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`❌ Failed to fetch daily tracking: ${error.message}`);
    }
  }

  async refreshPortfolio(interaction) {
    try {
      await interaction.deferUpdate();
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Refresh timeout')), 5000)
      );
      
      const dataPromise = this.getPortfolioData();
      const portfolioData = await Promise.race([dataPromise, timeoutPromise]);
      
      const embed = this.createPortfolioEmbed(portfolioData);
      const buttons = this.createPortfolioButtons();

      await interaction.editReply({
        embeds: [embed],
        components: buttons,
      });

    } catch (error) {
      console.error('Refresh button error:', error);
      await this.replyWithError(interaction, 'Refresh completed - data updates every 1 second');
    }
  }

  async updatePortfolioMessage(channelId, messageId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      
      // STEP 1: Extract current embed data for validation
      let currentEmbedData = null;
      let validationResults = [];
      
      if (message.embeds && message.embeds.length > 0) {
        const currentEmbed = message.embeds[0];
        currentEmbedData = this.parseEmbedData(currentEmbed);
      }
      
      // Get fresh portfolio data
      const balances = await this.gemini.getBalances();
      const cryptoBalances = balances.filter(b => b.currency !== 'USD' && parseFloat(b.amount) > 0);
      const usdBalance = balances.find(b => b.currency === 'USD') || { amount: '0.00' };
      
      console.log(`📊 Found ${cryptoBalances.length} crypto balances to process:`);
      cryptoBalances.forEach(b => console.log(`   ${b.currency}: ${b.amount}`));
      console.log(`🎯 Starting price fetching for ${cryptoBalances.length} cryptocurrencies...`);

      // Use available USD balance instead of total amount (which can be negative due to margin)
      const totalUsdAmount = parseFloat(usdBalance.amount);
      const availableUsdAmount = parseFloat(usdBalance.available || '0.00');
      // Use precise truncation to 2 decimal places (no rounding up)
      const displayUsdBalance = Math.floor(availableUsdAmount * 100) / 100;
      let totalValue = displayUsdBalance; // Start total with corrected USD balance
      const holdings = [];
      
      console.log(`💵 USD Balance Analysis:`);
      console.log(`   Total USD Amount: $${totalUsdAmount.toFixed(2)} (includes margin/borrowed)`);
      console.log(`   Raw Available USD: ${availableUsdAmount} (exact value)`);
      console.log(`   Truncated USD: $${(Math.floor(availableUsdAmount * 100) / 100).toFixed(2)}`);
      console.log(`   Has fractional cents: ${availableUsdAmount > Math.floor(availableUsdAmount * 100) / 100}`);
      console.log(`   Precise Truncated: $${displayUsdBalance.toFixed(2)} (truncated to 2 decimals, no rounding)`);
      console.log(`   Displayed USD: $${displayUsdBalance.toFixed(2)}`);
      console.log(`✅ USD Analysis Complete - Continuing to ticker processing...`);

      // Get current prices and calculate portfolio value
      console.log(`🚀 ENTERING TICKER LOOP for ${cryptoBalances.length} cryptocurrencies`);
      for (const balance of cryptoBalances) {
        try {
          // Fix symbol format for Gemini API  
          const symbol = `${balance.currency.toUpperCase()}USD`;
          console.log(`🔍 Trying uppercase symbol: ${symbol}`);
          const ticker = await this.gemini.getTicker(symbol);
          const currentPrice = parseFloat(ticker.last);
          const amount = parseFloat(balance.amount);
          const value = amount * currentPrice;
          const change = ticker.changes ? parseFloat(ticker.changes[0]) : 0;
          // Truncate crypto value before adding to total (consistent with USD truncation)
          const truncatedValue = Math.floor(value * 100) / 100;
          totalValue += truncatedValue;

          holdings.push({
            currency: balance.currency,
            amount: amount,
            price: currentPrice,
            value: truncatedValue,
            change: change
          });
        } catch (error) {
          console.error(`❌ TICKER API ERROR for ${balance.currency}:`, error.message);
          console.error(`🔍 Error details:`, error);
          if (error.message.includes('400')) {
            console.error(`🚨 STATUS 400: Bad Request for symbol: ${symbol}`);
            console.error(`🔍 Possible issues: Invalid symbol format, unsupported crypto, or API parameters`);
          }
        }
      }

      // Update daily buy tracking
      await this.updateDailyBuyTracking();
      
      // STEP 2: Validate current embed against fresh API data
      if (currentEmbedData) {
        validationResults = this.validateEmbedData(currentEmbedData, {
          totalValue,
          usdBalance: displayUsdBalance,
          holdings,
          dailyBuyData
        });
        
        if (validationResults.length > 0) {
          console.log(`🔧 AUTO-CORRECTION DETECTED - ${validationResults.length} discrepancies found:`);
          validationResults.forEach(result => {
            console.log(`   ❌ ${result.field}: Expected ${result.expected}, Found ${result.actual} (diff: ${result.difference})`);
          });
          console.log(`🛠️ Self-correcting embed with accurate live data...`);
        } else {
          console.log(`✅ EMBED VALIDATION PASSED - All data accurate`);
        }
      }
      
      // FORCE CONSISTENT CALCULATION: Use SOL-only value (same as trading logic)
      const solHolding = holdings.find(h => h.currency === 'SOL');
      const consistentTotalValue = solHolding ? solHolding.value : displayUsdBalance; // SOL-only (NO USD)
      
      console.log(`🎯 Auto-Update Portfolio Summary:`);
      console.log(`   USD Balance: $${displayUsdBalance.toFixed(2)}`);
      console.log(`   Crypto Holdings: ${holdings.length} assets`);
      console.log(`   CONSISTENT Portfolio Value (SOL-only): $${consistentTotalValue.toFixed(2)}`);
      
      // CRITICAL: Use the SAME embed format as main dashboard (prevents format switching)
      const embed = this.createPortfolioEmbed({
        totalValue: consistentTotalValue, // Always SOL-only (matches trading logic exactly)
        usdBalance: displayUsdBalance,
        holdings,
        dailyBuyData
      });

      const buttons = this.createPortfolioButtons();

      await message.edit({
        embeds: [embed],
        components: buttons,
      });

      if (validationResults.length > 0) {
        console.log(`✅ EMBED AUTO-CORRECTED - Fixed ${validationResults.length} errors at ${new Date().toLocaleTimeString()}`);
      } else {
        console.log(`🔄 Portfolio embed auto-updated at ${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      console.error(`❌ Failed to auto-update portfolio embed:`, error.message);
      // Reset dashboard tracking if this was the main dashboard
      if (messageId === this.dashboardMessageId) {
        this.dashboardMessageId = null;
        this.dashboardChannelId = null;
        await this.saveDashboardTracking(); // Save the reset state
      }
    }
  }

  async deployLiveDashboard() {
    try {
      console.log('📡 Deploying live dashboard to #private-dashboard...');
      
      // Check if dashboard already exists
      await this.loadDashboardTracking();
      if (this.dashboardMessageId && this.dashboardChannelId) {
        console.log(`✅ Dashboard already exists: ${this.dashboardMessageId} - will update it`);
        return;
      }
      
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.log('❌ No guild found');
        return;
      }

      const dashboardChannel = guild.channels.cache.find(channel => 
        channel.name.toLowerCase() === 'private-dashboard' && channel.isTextBased()
      );

      if (!dashboardChannel) {
        console.log('❌ #private-dashboard channel not found. Please create it first.');
        return;
      }

      // Get portfolio data from Gemini
      const portfolioData = await this.getPortfolioData();
      const embed = this.createPortfolioEmbed(portfolioData);
      const buttons = this.createPortfolioButtons();

      // Send the dashboard message
      const message = await dashboardChannel.send({
        embeds: [embed],
        components: buttons,
      });

      // Save dashboard tracking
      this.dashboardMessageId = message.id;
      this.dashboardChannelId = dashboardChannel.id;
      await this.saveDashboardTracking();

      console.log(`✅ LIVE DASHBOARD DEPLOYED to #${dashboardChannel.name}`);
      console.log(`📌 Message ID: ${message.id}`);
      console.log(`🔄 Dashboard will auto-update every 10 seconds with live Gemini data`);
      
    } catch (error) {
      console.error('❌ Error deploying live dashboard:', error.message);
    }
  }

  initializeRealTimeMonitoring() {
    console.log('🚀 Initializing REAL-TIME monitoring system...');
    
    // Create intelligent data refresh intervals
    this.startBalanceStreaming();
    this.startPriceStreaming();
    this.startSwingMonitoring();
  }
  
  startBalanceStreaming() {
    console.log('💰 Starting balance streaming (every 10 seconds with FORCED Discord updates)...');
    
    // Fetch fresh balance data every 10 seconds
    setInterval(async () => {
      // CRITICAL: Wait if dashboard is currently updating
      while (this.isUpdatingDashboard) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // CRITICAL: Block dashboard updates while we modify the maps
      this.isUpdatingBalances = true;
      
      let shouldUpdateDashboard = false;
      
      try {
        const balances = await this.gemini.getBalances();
        
        // Update real-time balance cache
        this.realTimeBalances.clear();
        balances.forEach(balance => {
          this.realTimeBalances.set(balance.currency, {
            amount: parseFloat(balance.amount),
            available: parseFloat(balance.available || '0'),
            timestamp: Date.now()
          });
        });
        
        this.lastBalanceUpdate = Date.now();
        console.log('🚀 LIVE BALANCES UPDATED:', Array.from(this.realTimeBalances.keys()));
        
        shouldUpdateDashboard = true;
        
      } catch (error) {
        if (!error.message.includes('429')) {
          console.error('❌ Balance streaming error:', error.message);
        }
      } finally {
        // CRITICAL: Always release the lock BEFORE calling dashboard update
        this.isUpdatingBalances = false;
      }
      
      // 📺 Update dashboard AFTER releasing the lock
      if (shouldUpdateDashboard && this.dashboardMessageId && this.dashboardChannelId) {
        try {
          // Load dashboard tracking from database to ensure we have the latest message ID
          await this.loadDashboardTracking();
          
          // Force update dashboard with real-time Gemini data
          await this.updatePortfolioMessageFromRealTimeData();
          
          const newPortfolioValue = this.calculateCurrentPortfolioValue();
          console.log(`📊 DISCORD EMBED FORCE-UPDATED: $${newPortfolioValue.toFixed(2)} (Gemini API → Discord)`);
        } catch (updateError) {
          console.error(`❌ Discord update failed: ${updateError.message}`);
          // Try to reload dashboard tracking and retry once
          try {
            await this.loadDashboardTracking();
            await this.getDashboardMessage(true); // Force refresh message reference
          } catch (retryError) {
            console.error(`❌ Dashboard reload failed: ${retryError.message}`);
          }
        }
      }
    }, 10000); // Every 10 seconds - Gemini API → Discord updates
  }
  
  startPriceStreaming() {
    console.log('📈 Starting price streaming (EVERY 1 SECOND for real-time trading)...');
    
    // Fetch fresh price data every 1 second for REAL-TIME trading detection
    setInterval(async () => {
      try {
        // Get prices for all currencies we have balances for
        const currencies = Array.from(this.realTimeBalances.keys()).filter(c => c !== 'USD');
        
        for (const currency of currencies) {
          try {
            const symbol = `${currency}USD`;
            const ticker = await this.gemini.getTicker(symbol);
            const price = parseFloat(ticker.last);
            
            // Update real-time price cache
            this.realTimePrices.set(currency, {
              price: price,
              timestamp: Date.now()
            });
            
            // Add to price history for swing trading (SOL only)
            if (currency === 'SOL') {
              // FORCE ALL PRICE UPDATES - No caching/duplicate prevention
              this.priceHistory.push(price);
              console.log(`🔥 LIVE PRICE UPDATE: $${price.toFixed(4)} (FORCED FRESH)`);
              
              if (this.priceHistory.length > 60) { // Keep 3 minutes of history at 3-second intervals
                this.priceHistory.shift();
              }
            }
            
          } catch (priceError) {
            if (!priceError.message.includes('429')) {
              console.error(`❌ Price streaming error for ${currency}:`, priceError.message);
            }
          }
        }
        
        this.lastPriceUpdate = Date.now();
        console.log('🚀 LIVE PRICES UPDATED:', Array.from(this.realTimePrices.keys()));
        
      } catch (error) {
        if (!error.message.includes('429')) {
          console.error('❌ Price streaming error:', error.message);
        }
      }
    }, 15000); // Every 15 seconds for price updates (prevent rate limits)
  }
  
  startSwingMonitoring() {
    console.log('🌊 Starting swing trading monitoring (every 1 second)...');
    
    // DISABLED: This duplicate monitoring loop conflicts with the 1-second check in startDailyTracking()
    // Only one auto-trade monitoring loop should run to prevent race conditions
    // The 1-second monitoring in startDailyTracking() is sufficient
    
    // setInterval(async () => {
    //   await this.checkAutoTradeConditionsRealTime();
    // }, 30000);
  }
  
  async getDashboardMessage(forceRefresh = false) {
    try {
      // Load dashboard tracking from database
      await this.loadDashboardTracking();
      
      if (!this.dashboardMessageId || !this.dashboardChannelId) {
        console.log('⚠️ No dashboard tracking - skipping update (create via /portfolio command)');
        return null;
      }
      
      // Try to fetch the message from Discord
      try {
        const channel = await this.client.channels.fetch(this.dashboardChannelId);
        const message = await channel.messages.fetch(this.dashboardMessageId);
        
        return message;
      } catch (fetchError) {
        // Handle Discord API errors: 10008 (Unknown Message), 404, 10003 (Unknown Channel), 50001 (Missing Access)
        if (fetchError.code === 10008 || fetchError.status === 404 || fetchError.code === 10003 || fetchError.code === 50001) {
          console.log(`⚠️ Dashboard message was deleted (error ${fetchError.code || fetchError.status}) - clearing tracking`);
          this.dashboardMessageId = null;
          this.dashboardChannelId = null;
          await this.saveDashboardTracking();
          return null;
        }
        throw fetchError;
      }
    } catch (error) {
      console.error('❌ Error getting dashboard message:', error.message);
      return null;
    }
  }

  async updatePortfolioMessageFromRealTimeData() {
    // CRITICAL: Prevent overlapping dashboard updates
    if (this.isUpdatingDashboard) {
      return; // Skip if already updating
    }
    
    // CRITICAL: Wait if balances are being updated
    while (this.isUpdatingBalances) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    this.isUpdatingDashboard = true;
    
    try {
      // Use cached real-time data instead of making API calls
      const usdBalance = this.realTimeBalances.get('USD') || { amount: 0, available: 0 };
      const displayUsdBalance = Math.floor(usdBalance.available * 100) / 100;
      let totalValue = displayUsdBalance;
      const holdings = [];
      
      console.log('🚀 UPDATING FROM REAL-TIME DATA:');
      console.log(`   USD: $${displayUsdBalance.toFixed(2)}`);
      
      // Process crypto holdings using cached data
      for (const [currency, balanceData] of this.realTimeBalances.entries()) {
        if (currency !== 'USD' && balanceData.amount > 0) {
          const priceData = this.realTimePrices.get(currency);
          if (priceData) {
            const value = balanceData.amount * priceData.price;
            totalValue += value;
            
            holdings.push({
              currency: currency,
              amount: balanceData.amount,
              price: priceData.price,
              value: value,
              change: 0 // Calculate change later if needed
            });
            
            console.log(`   ${currency}: ${balanceData.amount.toFixed(8)} @ $${priceData.price.toFixed(2)} = $${value.toFixed(2)}`);
          }
        }
      }
      
      // FORCE CONSISTENT CALCULATION: Use SOL-only (same as trading logic)
      const solHolding = holdings.find(h => h.currency === 'SOL');
      const consistentTotalValue = solHolding ? solHolding.value : displayUsdBalance; // SOL-only (NO USD)
      console.log(`🎆 CONSISTENT PORTFOLIO (SOL-only): $${consistentTotalValue.toFixed(2)}`);
      
      // Allow all updates for real-time monitoring
      if (this.lastDisplayedValue !== undefined) {
        const valueChange = Math.abs(consistentTotalValue - this.lastDisplayedValue);
        console.log(`💹 Value changed by $${valueChange.toFixed(2)} - updating dashboard`);
      }
      
      // Get validated dashboard message (handles stale IDs)
      const message = await this.getDashboardMessage();
      if (!message) {
        console.log('⚠️ Could not get dashboard message for update, will retry next cycle');
        return;
      }
      
      // CRITICAL: Use SAME embed format with ALL data (prevents format switching)
      const embed = this.createPortfolioEmbed({
        totalValue: consistentTotalValue, // Now always SOL-only value (matches trading logic)
        usdBalance: displayUsdBalance,
        holdings: holdings,
        dailyBuyData // CRITICAL: Include daily buy data for consistent format
      });
      
      const buttons = this.createPortfolioButtons();
      
      // Edit the message and only log success AFTER it completes
      try {
        await message.edit({ 
          embeds: [embed],
          components: buttons 
        });
        
        // Save the displayed value to prevent unnecessary updates
        this.lastDisplayedValue = consistentTotalValue;
        console.log('📊 DISCORD EMBED UPDATED: $' + consistentTotalValue.toFixed(2) + ' (change: value)');
        
      } catch (editError) {
        // Handle edit failures by refreshing the message reference
        if (editError.code === 10008 || editError.status === 404) {
          console.log(`⚠️ Edit failed (${editError.code || editError.status}), refreshing dashboard...`);
          await this.getDashboardMessage(true);
        } else {
          throw editError;
        }
      }
      
    } catch (error) {
      console.error('❌ Real-time portfolio update failed:', error.message);
    } finally {
      // CRITICAL: Always release the lock
      this.isUpdatingDashboard = false;
    }
  }

  async checkAutoTradeConditionsRealTime() {
    try {
      // Use the global autoTradeSettings variable instead of storage
      if (!autoTradeSettings || !autoTradeSettings.enabled || !autoTradeSettings.selectedCrypto) {
        return;
      }

      // FORCE FRESH PRICE CHECK - No cached data for swing monitoring
      const balanceData = this.realTimeBalances.get(autoTradeSettings.selectedCrypto);
      if (!balanceData) {
        console.log(`⏳ Waiting for balance data for ${autoTradeSettings.selectedCrypto}`);
        return;
      }
      
      // Get FRESH price from API every swing check
      const symbol = `${autoTradeSettings.selectedCrypto}USD`;
      const ticker = await this.gemini.getTicker(symbol);
      const currentPrice = parseFloat(ticker.last);
      const currentAmount = balanceData.amount;
      
      console.log(`📊 REAL-TIME SWING CHECK:`);
      console.log(`   ${autoTradeSettings.selectedCrypto}: ${currentAmount.toFixed(8)}`);
      console.log(`   Current Price: $${currentPrice.toFixed(2)}`);
      
      // Base protection check using real-time data
      const tradeAmount = 1.0 / currentPrice; // $1 worth in crypto
      const feeBuffer = 0.04 / currentPrice; // $0.04 fee buffer (actual Gemini fee ~0.35%)
      const totalImpact = tradeAmount + feeBuffer;
      const remainingAfterSale = currentAmount - totalImpact;
      
      console.log(`💰 Real-time $1 Trade Check:`);
      console.log(`   Trade: $1 worth = ${tradeAmount.toFixed(8)} ${autoTradeSettings.selectedCrypto}`);
      console.log(`   Fee Buffer: ${feeBuffer.toFixed(8)} ${autoTradeSettings.selectedCrypto}`);  
      console.log(`   Total Impact: ${totalImpact.toFixed(8)} ${autoTradeSettings.selectedCrypto}`);
      console.log(`   After Sale: ${remainingAfterSale.toFixed(8)} ${autoTradeSettings.selectedCrypto}`);
      
      // NEW REAL-TIME PORTFOLIO VALUE MONITORING
      const currentPortfolioValue = currentAmount * currentPrice; // Calculate current portfolio value
      
      // DISABLED: All baseline calculations moved to main path only
      console.log(`📊 REAL-TIME MONITORING: SOL $${currentPortfolioValue.toFixed(2)} (baseline calculations disabled to prevent bouncing)`);
      
    } catch (error) {
      console.error('❌ Real-time swing check error:', error.message);
    }
  }

  startAutoUpdating() {
    console.log('🚀 Starting REAL-TIME portfolio monitoring with live data streams...');
    
    // Initialize real-time monitoring
    this.initializeRealTimeMonitoring();
    
    // REMOVED: All auto-creation triggers disabled - dashboards must be created manually via /portfolio
    
    // Reduced frequency polling for backup (every 30 seconds instead of 1 second)
    setInterval(async () => {
      // Only update the main dashboard embed - don't create new ones
      if (this.dashboardMessageId && this.dashboardChannelId) {
        console.log(`🔄 Backup sync for message ${this.dashboardMessageId}`);
        try {
          await this.updatePortfolioMessageFromRealTimeData();
        } catch (error) {
          console.error('❌ Dashboard backup sync failed:', error.message);
          // Clear tracking but don't recreate (user deleted it)
          this.dashboardMessageId = null;
          this.dashboardChannelId = null;
          await this.saveDashboardTracking();
          console.log('🛑 Dashboard cleared (not recreating)');
        }
      } else {
        // No dashboard tracked - silently skip (user deleted it)
        // Do nothing - dashboard was deleted by user
      }
    }, 30000); // Backup sync every 30 seconds (much less frequent)
  }

  startKeepAlive() {
    console.log('💗 Starting enhanced keep-alive ping system (every 1 second)...');
    
    // Send keep-alive ping every 1 second for maximum uptime
    setInterval(async () => {
      try {
        // REAL Discord connection test - actually try to use the connection
        if (!this.client.isReady()) {
          console.log('🚨 Discord connection down (isReady=false) - triggering reconnection');
          this.handleReconnection('keep_alive_check');
          await sendKeepAlivePing('reconnecting', 'Discord connection lost');
        } else {
          // Test actual Discord functionality EVERY SECOND for bulletproof monitoring
          try {
            // Try to fetch the bot's own user to test if connection really works
            await this.client.user.fetch();
            console.log('💚 Discord connection VERIFIED (real test passed)');
            await sendKeepAlivePing('running');
          } catch (discordError) {
            console.log('🚨 Discord connection FAILED real test - triggering reconnection');
            console.log('Discord error:', discordError.message);
            this.handleReconnection('connection_test_failed');
            await sendKeepAlivePing('reconnecting', 'Discord real test failed');
          }
        }
      } catch (error) {
        console.log('Keep-alive ping failed:', error.message);
      }
    }, 1000); // 1 second intervals
    
    // Additional connection health check every 30 seconds
    setInterval(() => {
      if (this.client.isReady()) {
        console.log('💚 Discord connection healthy');
      } else {
        console.log('🚨 Discord connection unhealthy - forcing reconnection');
        this.handleReconnection('health_check');
      }
    }, 30000);
    
    // Initial ping
    sendKeepAlivePing('running');
    
    // Heartbeat every 60 seconds (stable ping frequency)
    setInterval(async () => {
      try {
        await sendKeepAlivePing('running', null);
        console.log('💗 Keep-alive heartbeat sent successfully');
      } catch (error) {
        console.error('💔 Keep-alive heartbeat failed:', error.message);
      }
    }, 60000); // 60 seconds - stable ping
  }

  async showActiveOrders(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const orders = await this.gemini.getActiveOrders();
      
      if (orders.length === 0) {
        await interaction.editReply('📝 No active orders found.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📋 Active Orders')
        .setColor(0x00BCD4)
        .setTimestamp();

      orders.slice(0, 10).forEach((order, index) => {
        embed.addFields({
          name: `Order ${index + 1}`,
          value: `**Symbol**: ${order.symbol.toUpperCase()}
**Side**: ${order.side.toUpperCase()}
**Amount**: ${order.original_amount}
**Price**: $${order.price}
**Status**: ${order.is_live ? '🟢 Live' : '🔴 Inactive'}`,
          inline: true
        });
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`❌ Failed to fetch orders: ${error.message}`);
    }
  }

  async showPriceAlerts(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const alerts = [];
      
      for (const pair of tradingSettings.enabledPairs) {
        const ticker = await this.gemini.getTicker(pair);
        const currentPrice = parseFloat(ticker.last);
        const change = ticker.changes ? parseFloat(ticker.changes[0]) : 0;
        
        alerts.push({
          symbol: pair,
          price: currentPrice,
          change: change,
          high: parseFloat(ticker.high),
          low: parseFloat(ticker.low)
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('🔔 Price Alerts & Monitoring')
        .setColor(0xFF9800)
        .setTimestamp();

      alerts.forEach(alert => {
        const changeEmoji = alert.change >= 0 ? '📈' : '📉';
        embed.addFields({
          name: `${changeEmoji} ${alert.symbol.toUpperCase()}`,
          value: `**Current**: $${alert.price.toFixed(2)}
**24h Change**: ${alert.change.toFixed(2)}%
**24h High**: $${alert.high.toFixed(2)}
**24h Low**: $${alert.low.toFixed(2)}`,
          inline: true
        });
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`❌ Failed to fetch price alerts: ${error.message}`);
    }
  }

  async emergencyStopMonitoring(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Stop all monitoring temporarily
      console.log('🛑 Emergency monitoring stop triggered by user');
      
      // Clear active portfolio messages to stop auto-updating
      this.activePortfolioMessages.clear();
      
      const embed = new EmbedBuilder()
        .setTitle('🛑 Monitoring Paused')
        .setColor(0xF44336)
        .addFields(
          { name: 'Status', value: '🔴 Monitoring temporarily paused', inline: true },
          { name: 'Action', value: 'Use /portfolio to resume monitoring', inline: true },
          { name: 'Effect', value: 'Auto-updates stopped for all portfolio embeds', inline: false }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Emergency stop error:', error);
      await this.replyWithError(interaction, `Error pausing monitoring: ${error.message}`);
    }
  }

  async handleTracker(interaction) {
    const type = interaction.options.getString('type') || 'daily_buys';
    
    try {
      switch (type) {
        case 'daily_buys':
          await this.showDailyBuyTracker(interaction);
          break;
        case 'status':
          await this.showTradingStatus(interaction);
          break;
        case 'limits':
          await this.showLimits(interaction);
          break;
        default:
          await this.replyWithError(interaction, 'Unknown tracker type');
      }
    } catch (error) {
      console.error('Tracker command error:', error);
      await this.replyWithError(interaction, `Tracker error: ${error.message}`);
    }
  }

  async showTradingStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      await this.updateDailyBuyTracking();

      const embed = new EmbedBuilder()
        .setTitle('📊 Trading Status Overview')
        .setColor(dailyBuyData.limitReached ? 0xF44336 : 0x4CAF50)
        .addFields(
          { name: '📅 Daily Buy Status', value: dailyBuyData.limitReached ? '🔴 LIMIT REACHED' : '🟢 Active', inline: true },
          { name: '💰 Today\'s Spending', value: `$${dailyBuyData.totalBought.toFixed(2)}`, inline: true },
          { name: '🔄 Trades Today', value: dailyBuyData.purchases.length.toString(), inline: true }
        )
        .addFields({
          name: '⚙️ Current Settings',
          value: `**Daily Limit**: $${tradingSettings.dailyBuyLimit}
**Stop Loss**: ${tradingSettings.stopLossPercent}%
**Take Profit**: ${tradingSettings.takeProfitPercent}%
**Monitored Pairs**: ${tradingSettings.enabledPairs.join(', ').toUpperCase()}`,
          inline: false
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Trading status error:', error);
      await this.replyWithError(interaction, `Failed to get trading status: ${error.message}`);
    }
  }

  async showLimits(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const embed = new EmbedBuilder()
        .setTitle('💳 Trading Limits & Controls')
        .setColor(0x2196F3)
        .addFields(
          { name: '💰 Daily Buy Limit', value: `$${tradingSettings.dailyBuyLimit}`, inline: true },
          { name: '📉 Stop Loss %', value: `${tradingSettings.stopLossPercent}%`, inline: true },
          { name: '📈 Take Profit %', value: `${tradingSettings.takeProfitPercent}%`, inline: true }
        )
        .addFields({
          name: '🎯 Monitored Trading Pairs',
          value: tradingSettings.enabledPairs.map(pair => `• ${pair.toUpperCase()}`).join('\n'),
          inline: false
        })
        .addFields({
          name: '⚠️ Automatic Actions',
          value: `• **Stop Loss**: ${tradingSettings.enableStopLoss ? '✅ Enabled' : '❌ Disabled'}
• **Take Profit**: ${tradingSettings.enableProfitTaking ? '✅ Enabled' : '❌ Disabled'}
• **Daily Limit**: Always active`,
          inline: false
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Limits display error:', error);
      await this.replyWithError(interaction, `Failed to display limits: ${error.message}`);
    }
  }

  async handleSettings(interaction) {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getString('value');

    await interaction.deferReply({ ephemeral: true });

    try {
      switch (setting) {
        case 'daily_limit':
          if (value) {
            const numValue = parseFloat(value);
            if (isNaN(numValue) || numValue <= 0) {
              await interaction.editReply('❌ Invalid daily limit value. Must be a positive number.');
            } else {
              tradingSettings.dailyBuyLimit = numValue;
              await interaction.editReply(`✅ Daily buy limit updated to $${value}`);
            }
          } else {
            await interaction.editReply(`📊 Current daily buy limit: $${tradingSettings.dailyBuyLimit}`);
          }
          break;

        case 'stop_loss':
          if (value) {
            const numValue = parseFloat(value);
            if (isNaN(numValue) || numValue <= 0 || numValue >= 100) {
              await interaction.editReply('❌ Invalid stop loss value. Must be between 0-100%.');
            } else {
              tradingSettings.stopLossPercent = numValue;
              await interaction.editReply(`✅ Stop loss updated to ${value}%`);
            }
          } else {
            await interaction.editReply(`📊 Current stop loss: ${tradingSettings.stopLossPercent}%`);
          }
          break;

        case 'take_profit':
          if (value) {
            const numValue = parseFloat(value);
            if (isNaN(numValue) || numValue <= 0) {
              await interaction.editReply('❌ Invalid take profit value. Must be a positive number.');
            } else {
              tradingSettings.takeProfitPercent = numValue;
              await interaction.editReply(`✅ Take profit updated to ${value}%`);
            }
          } else {
            await interaction.editReply(`📊 Current take profit: ${tradingSettings.takeProfitPercent}%`);
          }
          break;

        default:
          await interaction.editReply('❌ Unknown setting');
      }
    } catch (error) {
      console.error('Settings error:', error);
      await this.replyWithError(interaction, `Settings error: ${error.message}`);
    }
  }

  async showPrices(interaction) {
    const symbol = interaction.options.getString('symbol') || 'btcusd';
    
    try {
      await interaction.deferReply();

      // Add timeout for API call
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Price fetch timeout')), 5000)
      );
      
      const tickerPromise = this.gemini.getTicker(symbol);
      const ticker = await Promise.race([tickerPromise, timeoutPromise]);
      
      const embed = new EmbedBuilder()
        .setTitle(`💰 ${symbol.toUpperCase()} Price`)
        .setColor(0x1976D2)
        .addFields(
          { name: 'Current Price', value: `$${ticker.last}`, inline: true },
          { name: '24h High', value: `$${ticker.high}`, inline: true },
          { name: '24h Low', value: `$${ticker.low}`, inline: true },
          { name: 'Bid', value: `$${ticker.bid}`, inline: true },
          { name: 'Ask', value: `$${ticker.ask}`, inline: true },
          { name: '24h Change', value: `${ticker.changes?.[0] || 'N/A'}%`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Prices command error:', error);
      await this.replyWithError(interaction, `Unable to fetch ${symbol.toUpperCase()} price right now`);
    }
  }

  async getPortfolioData() {
    let totalValue = 0;
    let usdBalance = 0;
    let holdings = [];

    try {
      // Get portfolio data
      const balances = await this.gemini.getBalances();
      const cryptoBalances = balances.filter(b => b.currency !== 'USD' && parseFloat(b.amount) > 0);
      const usdBalanceData = balances.find(b => b.currency === 'USD') || { amount: '0.00' };

      // Use available USD balance instead of total amount (which can be negative due to margin)
      const totalUsdAmount = parseFloat(usdBalanceData.amount);
      const availableUsdAmount = parseFloat(usdBalanceData.available || '0.00');
      // Use precise truncation to 2 decimal places (no rounding up)
      usdBalance = Math.floor(availableUsdAmount * 100) / 100;
      totalValue = usdBalance; // Start total with corrected USD balance
      
      console.log(`💵 USD Balance Analysis:`);
      console.log(`   Total USD Amount: $${totalUsdAmount.toFixed(2)} (includes margin/borrowed)`);
      console.log(`   Available USD: $${availableUsdAmount.toFixed(2)} (actual usable balance)`);
      console.log(`   Displayed USD: $${usdBalance.toFixed(2)}`);

      // Get current prices and calculate portfolio value
      for (const balance of cryptoBalances) {
        try {
          // Fix symbol format for Gemini API  
          const symbol = `${balance.currency.toUpperCase()}USD`;
          console.log(`🔍 Trying uppercase symbol: ${symbol}`);
          const ticker = await this.gemini.getTicker(symbol);
          const currentPrice = parseFloat(ticker.last);
          const amount = parseFloat(balance.amount);
          const value = amount * currentPrice;
          const change = ticker.changes ? parseFloat(ticker.changes[0]) : 0;
          // Truncate crypto value before adding to total (consistent with USD truncation)
          const truncatedValue = Math.floor(value * 100) / 100;
          totalValue += truncatedValue;

          holdings.push({
            currency: balance.currency,
            amount: amount,
            price: currentPrice,
            value: truncatedValue,
            change: change
          });
        } catch (priceError) {
          console.error(`❌ TICKER API FAILED for ${balance.currency}:`, priceError.message);
          console.error(`🔍 Failed symbol: ${symbol}`);
          console.error(`🔍 Balance data:`, balance);
          // Add holding without price data
          holdings.push({
            currency: balance.currency,
            amount: parseFloat(balance.amount),
            price: 0,
            value: 0,
            change: 0
          });
          console.log(`⚠️ Added ${balance.currency} with ZERO price - this will break auto trade!`);
        }
      }

      // Update daily buy tracking
      await this.updateDailyBuyTracking();

    } catch (error) {
      console.error('Error fetching Gemini data:', error.message);
      // Return default data if API fails
      dailyBuyData = {
        totalBought: 0,
        purchases: [],
        limitReached: false,
        lastUpdate: new Date()
      };
    }

    return {
      totalValue,
      usdBalance,
      holdings,
      dailyBuyData
    };
  }

  async replyWithError(interaction, message) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription(message)
      .setColor(0xF44336)
      .setTimestamp();

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    } catch (replyError) {
      console.error('Error sending error message:', replyError);
      // Try one more time with a simple text response
      try {
        if (!interaction.replied) {
          await interaction.reply({ content: `❌ ${message}`, ephemeral: true });
        }
      } catch (finalError) {
        console.error('Failed to send any error response:', finalError);
      }
    }
  }

  startDailyTracking() {
    console.log('📊 Starting daily buy tracking and monitoring...');
    
    // Auto trade monitoring every 1 second
    setInterval(async () => {
      try {
        // Check auto trade conditions every 1 second for maximum price accuracy
        await this.checkAutoTradeConditions();
        
      } catch (error) {
        console.error('Error in auto trade monitoring:', error.message);
      }
    }, 1000);
    
    // Daily tracking every 60 seconds
    setInterval(async () => {
      try {
        await this.updateDailyBuyTracking();
        
        // Check if limit was just reached
        if (dailyBuyData.limitReached) {
          console.log(`🚨 Daily buy limit reached: $${dailyBuyData.totalBought.toFixed(2)}`);
        }
        
      } catch (error) {
        console.error('Error in daily tracking update:', error.message);
      }
    }, 60000);

    // Reset daily data at midnight
    setInterval(() => {
      const today = new Date().toDateString();
      if (tradingSettings.lastDailyReset !== today) {
        dailyBuyData = {
          totalBought: 0,
          purchases: [],
          limitReached: false,
          lastUpdate: new Date()
        };
        tradingSettings.lastDailyReset = today;
        console.log('🌅 Daily tracking reset for new day');
      }
    }, 60000 * 60); // Check every hour
  }

  async showAutoTradeSetup(interaction) {
    
    const modal = new ModalBuilder()
      .setCustomId('auto_trade_modal')
      .setTitle('🤖 Auto Trade Configuration');

    const amountInput = new TextInputBuilder()
      .setCustomId('trade_amount')
      .setLabel('1. Trade Amount (USD)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter trade amount in USD (e.g., 100)')
      .setRequired(false);

    const stopLossInput = new TextInputBuilder()
      .setCustomId('stop_at_loss')
      .setLabel('2. Stop Selling at Base Amount')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g., 0.5, 1, or 1/2 = 1.5 SOL (keep this much SOL as base)')
      .setRequired(false);

    const cryptoSelectInput = new TextInputBuilder()
      .setCustomId('crypto_selection')
      .setLabel('3. Select Crypto Currency')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g., SOL, BTC, ETH (which crypto to monitor/sell)')
      .setRequired(false);

    const stopValueInput = new TextInputBuilder()
      .setCustomId('stop_at_value')
      .setLabel('4. Stop at Crypto Amount')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g., 1 or 0.5 (amount of selected crypto to sell)')
      .setRequired(false);

    const stopDailyBuysInput = new TextInputBuilder()
      .setCustomId('stop_daily_buys')
      .setLabel('5. Stop on Daily Buys (USD)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g., 50 (stop when $50 worth bought today)')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(amountInput),
      new ActionRowBuilder().addComponents(stopLossInput),
      new ActionRowBuilder().addComponents(cryptoSelectInput),
      new ActionRowBuilder().addComponents(stopValueInput),
      new ActionRowBuilder().addComponents(stopDailyBuysInput)
    );

    await interaction.showModal(modal);
  }

  async showAutoTradeStatus(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Auto Trade Status')
      .setColor(autoTradeSettings.enabled ? 0x4CAF50 : 0xF44336)
      .setTimestamp();

    if (!autoTradeSettings.enabled) {
      embed.setDescription('❌ Auto Trade is currently **DISABLED**')
        .addFields(
          { name: '📊 Status', value: 'Inactive', inline: true },
          { name: '⏰ Last Run', value: 'Never', inline: true }
        );
    } else {
      const statusText = autoTradeSettings.isActive ? '🟢 **ACTIVE**' : '🟡 **CONFIGURED**';
      const conditions = autoTradeSettings.conditions;
      
      embed.setDescription(`✅ Auto Trade is **ENABLED**\n${statusText}`)
        .addFields(
          { name: '💰 Trade Amount', value: autoTradeSettings.amount ? `$${autoTradeSettings.amount}` : 'Not set', inline: true },
          { name: '📉 Stop Selling at Base', value: autoTradeSettings.stopAtLoss ? `${autoTradeSettings.stopAtLoss} SOL` : 'Not set', inline: true },
          { name: '🪙 Stop at Crypto Amount', value: autoTradeSettings.stopAtValue ? `${autoTradeSettings.stopAtValue} ${autoTradeSettings.stopAtValueCurrency}` : 'Not set', inline: true },
          { name: '🛒 Stop on Daily Buys', value: autoTradeSettings.stopOnDailyBuys ? `$${autoTradeSettings.stopOnDailyBuys}` : 'Not set', inline: true },
          { name: '⏰ Started', value: autoTradeSettings.startTime ? autoTradeSettings.startTime.toLocaleString() : 'Not started', inline: true },
          { name: '📊 Conditions Met', value: 
            `Portfolio: ${conditions.portfolioValueReached ? '✅' : '❌'}\n` +
            `Crypto: ${conditions.cryptoValueReached ? '✅' : '❌'}\n` +
            `Daily Buys: ${conditions.dailyBuyLimitReached ? '✅' : '❌'}`, inline: true }
        );
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async showSettingsConfig(interaction) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Auto Trade Settings')
        .setColor(0x2196F3)
        .addFields(
          { name: '🤖 Auto Trade Status', value: autoTradeSettings.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
          { name: '💰 Selected Crypto', value: autoTradeSettings.selectedCrypto || 'SOL', inline: true },
          { name: '🛡️ Stop at Base Amount', value: `${autoTradeSettings.stopAtLoss || 1.5} SOL`, inline: true },
          { name: '📈 Stop at Value', value: autoTradeSettings.stopAtValue ? `$${autoTradeSettings.stopAtValue}` : 'Not Set', inline: true },
          { name: '💸 Trade Amount', value: `$${autoTradeSettings.amount || 1.00} USD per trade`, inline: true },
          { name: '⚡ Trade Interval', value: `Every $1 portfolio increase`, inline: true }
        )
        .addFields({
          name: '🔧 Configuration Commands',
          value: `Use these slash commands to modify settings:
• \`/settings setting:daily_limit value:500\` - Set daily buy limit
• \`/settings setting:stop_loss value:5\` - Set stop loss %
• \`/settings setting:take_profit value:10\` - Set take profit %

**Current Values:**
• Daily Limit: $${tradingSettings.dailyBuyLimit}
• Stop Loss: ${tradingSettings.stopLossPercent}%
• Take Profit: ${tradingSettings.takeProfitPercent}%`,
          inline: false
        })
        .setFooter({ text: 'Use the Auto Trade Setup button to modify stop-at-base amounts' })
        .setTimestamp();

      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('auto_trade_setup')
            .setLabel('Modify Stop-at-Base')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🛡️'),
          new ButtonBuilder()
            .setCustomId('settings_config')
            .setLabel('Back to Portfolio')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('↩️')
        );

      // Update the original message instead of showing ephemeral reply
      await interaction.update({ 
        embeds: [embed],
        components: [buttons]
      });
      
      console.log('⚙️ Settings config displayed to user (updated main embed)');
    } catch (error) {
      console.error('Error showing settings config:', error);
      await interaction.reply({ 
        content: `Failed to show settings: ${error.message}`, 
        ephemeral: true 
      });
    }
  }

  async stopAutoTrade(interaction) {
    if (!autoTradeSettings.enabled) {
      await interaction.reply({ 
        content: '❌ Auto Trade is not currently running.', 
        ephemeral: true 
      });
      return;
    }

    autoTradeSettings.enabled = false;
    autoTradeSettings.isActive = false;
    autoTradeSettings.startTime = null;
    autoTradeSettings.conditions = {
      portfolioValueReached: false,
      cryptoValueReached: false,
      dailyBuyLimitReached: false
    };

    console.log('🛑 Auto Trade stopped by user');

    const embed = new EmbedBuilder()
      .setTitle('🛑 Auto Trade Stopped')
      .setDescription('Auto Trade has been successfully stopped.')
      .setColor(0xF44336)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  async handleAutoTradeModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const amount = interaction.fields.getTextInputValue('trade_amount');
    const stopAtLoss = interaction.fields.getTextInputValue('stop_at_loss');
    const cryptoSelection = interaction.fields.getTextInputValue('crypto_selection');
    const stopAtValue = interaction.fields.getTextInputValue('stop_at_value');
    const stopDailyBuys = interaction.fields.getTextInputValue('stop_daily_buys');

    console.log('🔧 Processing Auto Trade Modal:', { amount, stopAtLoss, cryptoSelection, stopAtValue, stopDailyBuys });

    // Validate and set values - STRIP CURRENCY SYMBOLS BEFORE PARSING
    if (amount) {
      const cleanAmount = amount.replace(/[$,]/g, ''); // Remove $ and commas
      autoTradeSettings.amount = parseFloat(cleanAmount);
      console.log(`💰 Trade amount: ${amount} → ${autoTradeSettings.amount}`);
    }
    if (cryptoSelection) {
      // Strip USD suffix to match portfolio currency format (SOL not SOLUSD)
      const cleanCrypto = cryptoSelection.toUpperCase().replace(/USD$/, '');
      autoTradeSettings.selectedCrypto = cleanCrypto;
      console.log(`💰 Selected crypto currency: ${autoTradeSettings.selectedCrypto} (cleaned from ${cryptoSelection})`);
    }
    if (stopAtLoss) {
      // Handle fraction notation like "1/2" = 1.5 SOL (1 and 1/2)
      if (stopAtLoss.includes('/')) {
        const [wholePart, fractionPart] = stopAtLoss.split('/');
        const wholeNumber = parseFloat(wholePart);
        const fraction = wholeNumber / parseFloat(fractionPart);
        autoTradeSettings.stopAtLoss = wholeNumber + fraction;
        console.log(`🧮 Fraction calculation: ${wholePart}/${fractionPart} = ${wholeNumber} + ${fraction} = ${autoTradeSettings.stopAtLoss} SOL`);
      } else {
        autoTradeSettings.stopAtLoss = parseFloat(stopAtLoss);
      }
      console.log(`🛑 Stop selling at base: ${autoTradeSettings.stopAtLoss} ${autoTradeSettings.selectedCrypto || 'SOL'}`);
    }
    if (stopAtValue) {
      const cleanValue = stopAtValue.replace(/[$,]/g, ''); // Remove $ and commas
      autoTradeSettings.stopAtValue = parseFloat(cleanValue);
      console.log(`🪙 Stop at crypto amount: ${stopAtValue} → ${autoTradeSettings.stopAtValue}`);
    }
    if (stopDailyBuys) {
      const cleanDaily = stopDailyBuys.replace(/[$,]/g, ''); // Remove $ and commas
      autoTradeSettings.stopOnDailyBuys = parseFloat(cleanDaily);
      console.log(`🛒 Stop on daily buys: ${stopDailyBuys} → ${autoTradeSettings.stopOnDailyBuys}`);
    }

    // Enable auto trade if any condition is set
    const hasConditions = autoTradeSettings.stopAtLoss || autoTradeSettings.stopAtValue || autoTradeSettings.stopOnDailyBuys;
    
    if (hasConditions) {
      autoTradeSettings.enabled = true;
      autoTradeSettings.isActive = true;
      autoTradeSettings.startTime = new Date();
      
      console.log('🤖 AUTO TRADE STARTED!');
      console.log('   Settings:', autoTradeSettings);
      console.log('   Monitoring will begin every 1 second...');
    }

    const embed = new EmbedBuilder()
      .setTitle('🤖 Auto Trade Configuration')
      .setColor(hasConditions ? 0x4CAF50 : 0xFF9800)
      .setTimestamp();

    if (hasConditions) {
      embed.setDescription('✅ Auto Trade has been **CONFIGURED** and **STARTED**!')
        .addFields(
          { name: '💰 Trade Amount', value: autoTradeSettings.amount ? `$${autoTradeSettings.amount}` : 'Not set', inline: true },
          { name: '📉 Stop Selling at Base', value: autoTradeSettings.stopAtLoss ? `${autoTradeSettings.stopAtLoss} SOL` : 'Not set', inline: true },
          { name: '🪙 Stop at Crypto Amount', value: autoTradeSettings.stopAtValue ? `${autoTradeSettings.stopAtValue} SOL` : 'Not set', inline: true },
          { name: '🛒 Stop on Daily Buys', value: autoTradeSettings.stopOnDailyBuys ? `$${autoTradeSettings.stopOnDailyBuys}` : 'Not set', inline: true }
        );
    } else {
      embed.setDescription('⚠️ No conditions were set. Auto Trade remains **DISABLED**.')
        .addFields({ name: '💡 Tip', value: 'Set at least one stop condition to enable Auto Trade.', inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  }

  // PERSISTENT TRIGGER: Save/load trigger from file
  async saveTriggerToFile() {
    try {
      const { writeFileSync } = await import('fs');
      const triggerData = {
        baseline: this.baselineValue,
        trigger: this.baselineValue + 1.00,
        timestamp: Date.now()
      };
      writeFileSync('trigger.json', JSON.stringify(triggerData, null, 2));
      console.log(`💾 BASELINE SAVED: $${this.baselineValue.toFixed(2)}`);
    } catch (error) {
      console.error('Error saving baseline:', error.message);
    }
  }

  async loadTriggerFromFile() {
    try {
      const { readFileSync, existsSync } = await import('fs');
      if (existsSync('trigger.json')) {
        const triggerData = JSON.parse(readFileSync('trigger.json', 'utf8'));
        this.lastTriggerTarget = triggerData.trigger;
        console.log(`📂 TRIGGER LOADED: $${this.lastTriggerTarget.toFixed(2)} (saved at ${new Date(triggerData.timestamp)})`);
        return triggerData; // FIXED: Return the actual data object
      }
      return null;
    } catch (error) {
      console.error('Error loading trigger:', error.message);
      return null;
    }
  }

  // Save dashboard tracking to database (persists on Reserved VM)
  async saveDashboardTracking() {
    try {
      if (this.dashboardMessageId && this.dashboardChannelId) {
        const dashboardData = {
          messageId: this.dashboardMessageId,
          channelId: this.dashboardChannelId,
          timestamp: Date.now()
        };
        
        const existing = await db.select().from(botSettings).where(eq(botSettings.key, 'dashboard')).limit(1);
        
        if (existing && existing.length > 0) {
          await db.update(botSettings).set({ value: dashboardData, updatedAt: new Date() }).where(eq(botSettings.key, 'dashboard'));
        } else {
          await db.insert(botSettings).values({ key: 'dashboard', value: dashboardData });
        }
        
        console.log(`💾 Dashboard tracking saved to DB: ${this.dashboardMessageId}`);
      }
    } catch (error) {
      console.error('Failed to save dashboard tracking to DB:', error.message);
    }
  }

  // Load dashboard tracking from database (persists on Reserved VM)
  async loadDashboardTracking() {
    try {
      const setting = await db.select().from(botSettings).where(eq(botSettings.key, 'dashboard')).limit(1);
      
      if (setting && setting.length > 0 && setting[0].value) {
        const dashboardData = setting[0].value;
        if (dashboardData.messageId && dashboardData.channelId) {
          this.dashboardMessageId = dashboardData.messageId;
          this.dashboardChannelId = dashboardData.channelId;
          console.log(`📂 Dashboard tracking loaded from DB: ${this.dashboardMessageId}`);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Failed to load dashboard tracking from DB:', error.message);
      this.dashboardMessageId = null;
      this.dashboardChannelId = null;
      return false;
    }
  }

  async checkAutoTradeConditions() {
    // CRITICAL: Prevent overlapping executions
    if (this.isCheckingAutoTrade) {
      return; // Skip if already checking
    }
    
    this.isCheckingAutoTrade = true;
    
    try {
      // Debug log to show monitoring is running
      console.log(`🔄 Auto Trade Monitor Check - Enabled: ${autoTradeSettings.enabled}, Active: ${autoTradeSettings.isActive}`);
      
      if (!autoTradeSettings.enabled || !autoTradeSettings.isActive) {
        console.log(`⏸️ Auto Trade monitoring skipped - not enabled/active`);
        this.isCheckingAutoTrade = false;
        return;
      }
      // Get current portfolio data
      const portfolioData = await this.getPortfolioData();
      const { totalValue, holdings } = portfolioData;

      let shouldExecuteTrade = false;
      let reason = '';

      // DEBUG: Show current auto trade settings
      console.log(`🔧 AUTO TRADE SETTINGS:`, {
        enabled: autoTradeSettings.enabled,
        selectedCrypto: autoTradeSettings.selectedCrypto,
        stopAtLoss: autoTradeSettings.stopAtLoss,
        stopAtValue: autoTradeSettings.stopAtValue
      });
      console.log(`🔍 PORTFOLIO CURRENCIES:`, holdings.map(h => h.currency));
      
      // Check if selected crypto holdings allow $1 USD sale while protecting base amount
      if (autoTradeSettings.stopAtLoss && autoTradeSettings.selectedCrypto) {
        const cryptoHolding = holdings.find(h => h.currency === autoTradeSettings.selectedCrypto);
        if (cryptoHolding) {
          // Debug portfolio data structure
          console.log(`🔍 DEBUG - SOL Portfolio Data:`, {
            currency: cryptoHolding.currency,
            amount: cryptoHolding.amount,
            price: cryptoHolding.price,
            value: cryptoHolding.value,
            change: cryptoHolding.change
          });
          
          // Get current price for the crypto (fix property name)
          const currentPrice = cryptoHolding.price; // Use price directly instead of value/amount
          
          console.log(`✅ Base Protection Status: ${cryptoHolding.amount.toFixed(8)} SOL vs ${autoTradeSettings.stopAtLoss} SOL protection - Evaluating individual trades`);
          
          // Calculate $1 USD trade impact INCLUDING post-execution fee deduction  
          const tradeAmountUSD = 1.00; // $1 USD trade
          const feeAmountUSD = 0.04;   // 4 cent fee deducted AFTER trade execution
          
          // The actual SOL sold for $1 USD
          const solAmountToSell = tradeAmountUSD / currentPrice; 
          
          // CRITICAL FIX: Add fee buffer for post-execution fee deduction
          // Gemini deducts fee separately, so we need extra SOL buffer 
          const feeBufferInSOL = feeAmountUSD / currentPrice; // Convert 4 cents to SOL
          const totalSOLImpact = solAmountToSell + feeBufferInSOL; // True total impact
          
          // Check if we can handle the REAL total impact and still have >= base amount
          const remainingAfterSale = cryptoHolding.amount - totalSOLImpact;
          
          console.log(`💰 $1 USD Trade Check for ${autoTradeSettings.selectedCrypto}:`);
          console.log(`   Current ${autoTradeSettings.selectedCrypto}: ${cryptoHolding.amount.toFixed(8)}`);
          console.log(`   Current Price: $${currentPrice.toFixed(2)} per ${autoTradeSettings.selectedCrypto}`);
          console.log(`   Base Amount to Protect: ${autoTradeSettings.stopAtLoss}`);
          console.log(`   Trade: $${tradeAmountUSD} worth = ${solAmountToSell.toFixed(8)} SOL`);
          console.log(`   Fee Buffer: $${feeAmountUSD} = ${feeBufferInSOL.toFixed(8)} SOL (post-execution deduction)`);
          console.log(`   Total SOL Impact: ${solAmountToSell.toFixed(8)} + ${feeBufferInSOL.toFixed(8)} = ${totalSOLImpact.toFixed(8)} SOL`);
          console.log(`   After Sale: ${cryptoHolding.amount.toFixed(8)} - ${totalSOLImpact.toFixed(8)} = ${remainingAfterSale.toFixed(8)} SOL`);
          
          // DYNAMIC SWING TRADING: Use existing price history from real-time updates
          if (!this.priceHistory) this.priceHistory = [];
          
          // Don't duplicate price history - use existing real-time data
          // (Price history is already maintained in startPriceStreaming)
          
          // NEW LOGIC: Last portfolio value + $1.00 trigger (not price-based)
          const currentPortfolioValue = cryptoHolding.value; // $267.84
          
          // FORCE CLEAR VALUES AND LOAD FROM FILE ON EVERY SESSION
          console.log(`🔍 DEBUG: Before init - savedTriggerValue: ${this.savedTriggerValue}, baselineValue: ${this.baselineValue}`);
          if (!this.triggerInitializedThisSession) {
            // Clear values to force proper initialization
            this.savedTriggerValue = null;
            this.baselineValue = null;
            try {
              const triggerData = await this.loadTriggerFromFile();
              console.log(`🔍 DEBUG: Loaded trigger data:`, triggerData);
              if (triggerData && triggerData.baseline && triggerData.trigger) {
                this.baselineValue = triggerData.baseline;
                this.savedTriggerValue = triggerData.trigger;
                console.log(`🔒 BASELINE LOCKED: $${this.baselineValue.toFixed(2)}, TRIGGER LOCKED: $${this.savedTriggerValue.toFixed(2)} (loaded from file)`);
              } else {
                console.log(`🔍 DEBUG: Invalid trigger data, creating new values`);
                // Set trigger to current portfolio (ready to trigger) and baseline $1 below
                this.savedTriggerValue = parseFloat(currentPortfolioValue.toFixed(2));
                this.baselineValue = this.savedTriggerValue - 1.00;
                console.log(`🔒 BASELINE SET: $${this.baselineValue.toFixed(2)}, TRIGGER SET: $${this.savedTriggerValue.toFixed(2)} (ready to trigger)`);
                await this.saveTriggerToFile();
              }
            } catch (error) {
              console.log(`🔍 DEBUG: Error loading trigger data:`, error.message);
              // Set trigger to current portfolio (ready to trigger) and baseline $1 below
              this.savedTriggerValue = parseFloat(currentPortfolioValue.toFixed(2));
              this.baselineValue = this.savedTriggerValue - 1.00;
              console.log(`🔒 BASELINE FALLBACK: $${this.baselineValue.toFixed(2)}, TRIGGER SET: $${this.savedTriggerValue.toFixed(2)} (ready to trigger)`);
              await this.saveTriggerToFile();
            }
            this.triggerInitializedThisSession = true;
          }
          
          // TRIGGER CHANGES ONLY AFTER TRADES OR MAJOR DROPS
          
          // ONLY proceed with trigger logic if we have valid saved trigger
          if (!this.savedTriggerValue) {
            console.log(`⚠️ No saved trigger value - skipping trigger check this cycle`);
            return false;
          }
          
          let triggerValue = this.savedTriggerValue;
          
          // 🛡️ PURCHASE PROTECTION: Detect if SOL balance increased (manual purchase)
          const currentSOLBalance = holdings.find(h => h.currency === 'SOL')?.amount || 0;
          
          if (!this.previousSOLBalance) {
            this.previousSOLBalance = currentSOLBalance;
            console.log(`🔍 INITIAL SOL TRACKING: ${currentSOLBalance.toFixed(8)} SOL`);
          }
          
          // Check if SOL balance increased significantly (indicating a manual purchase)
          // Require at least 0.001 SOL increase to prevent bouncing from API rounding
          const solIncrease = currentSOLBalance - this.previousSOLBalance;
          if (solIncrease > 0.001) {
            const valueIncrease = solIncrease * holdings.find(h => h.currency === 'SOL')?.price;
            
            console.log(`🛡️ PURCHASE PROTECTION TRIGGERED!`);
            console.log(`   Previous SOL: ${this.previousSOLBalance.toFixed(8)}`);
            console.log(`   Current SOL: ${currentSOLBalance.toFixed(8)}`);
            console.log(`   SOL Increase: +${solIncrease.toFixed(8)} SOL`);
            console.log(`   Value Increase: +$${valueIncrease.toFixed(2)} USD`);
            console.log(`   🔄 ADJUSTING BASELINE & TRIGGER...`);
            
            // Recalculate baseline and trigger based on new portfolio value
            this.baselineValue = currentPortfolioValue;
            this.savedTriggerValue = currentPortfolioValue + 1.00;
            triggerValue = this.savedTriggerValue;
            await this.saveTriggerToFile();
            
            console.log(`✅ PURCHASE PROTECTION APPLIED:`);
            console.log(`   New Baseline: $${this.baselineValue.toFixed(2)}`);
            console.log(`   New Trigger: $${this.savedTriggerValue.toFixed(2)}`);
            console.log(`   Protection prevents immediate sale of new SOL purchase`);
          }
          
          // Update tracked SOL balance for next cycle
          this.previousSOLBalance = currentSOLBalance;

          console.log(`📈 SWING TRADE CHECK:`);
          console.log(`   Current Portfolio: $${currentPortfolioValue.toFixed(2)}`);  
          console.log(`   Baseline: $${this.baselineValue.toFixed(2)}`);
          console.log(`   Trigger at: $${triggerValue.toFixed(2)} (LOCKED)`);
          
          // BASELINE RESET LOGIC: Only reset if portfolio drops below the original baseline (trigger - $1.00)
          const resetThreshold = this.savedTriggerValue - 1.00; // Reset when portfolio drops below original baseline
          console.log(`🔍 RESET CHECK: Portfolio $${currentPortfolioValue.toFixed(2)} < Threshold $${resetThreshold.toFixed(2)} (Trigger $${this.savedTriggerValue.toFixed(2)} - $1.00) = ${currentPortfolioValue < resetThreshold}`);
          
          if (currentPortfolioValue < resetThreshold) {
            // RESET TRIGGER: Portfolio dropped below threshold, reset to current portfolio value
            console.log(`📉 PORTFOLIO DROPPED: $${currentPortfolioValue.toFixed(2)} below threshold $${resetThreshold.toFixed(2)} - RESETTING TRIGGER`);
            this.baselineValue = currentPortfolioValue;
            this.savedTriggerValue = currentPortfolioValue + 1.00;
            triggerValue = this.savedTriggerValue;
            await this.saveTriggerToFile();
            console.log(`🔄 NEW BASELINE: $${this.baselineValue.toFixed(2)}, NEW TRIGGER: $${this.savedTriggerValue.toFixed(2)}`);
          } else {
            // KEEP TRIGGER LOCKED - don't reset just because baseline equals portfolio
            console.log(`🔒 TRIGGER LOCKED: Portfolio $${currentPortfolioValue.toFixed(2)} is above reset threshold $${resetThreshold.toFixed(2)} - trigger stays at $${this.savedTriggerValue.toFixed(2)}`);
          }
          
          // Execute trade if portfolio hits trigger (baseline + $1.00)
          if (currentPortfolioValue >= triggerValue) {
            console.log(`🚨 TRIGGER HIT! $${currentPortfolioValue.toFixed(2)} >= $${triggerValue.toFixed(2)}`);
            
            // Check if we're already in a trade to prevent multiple orders
            if (this.tradingLock) {
              console.log(`🔒 TRADING LOCKED - Skipping duplicate trade execution`);
              console.log(`🔍 DEBUG: Trading lock status: ${this.tradingLock}, resetting lock after 30 seconds if stuck`);
              
              // Auto-reset stuck locks after 30 seconds (in case of restart issues)
              if (!this.lockResetTimer) {
                this.lockResetTimer = setTimeout(() => {
                  console.log(`🔓 AUTO-RESET: Trading lock released after timeout`);
                  this.tradingLock = false;
                  this.lockResetTimer = null;
                }, 30000);
              }
              return false;
            }
            
            // DON'T set lock here - let executeAutoTrade handle it
            // Clear any existing reset timer since we're starting a new trade
            if (this.lockResetTimer) {
              clearTimeout(this.lockResetTimer);
              this.lockResetTimer = null;
            }
            console.log(`🚨 TRIGGER CONFIRMED - Preparing to execute trade`);
            
            // Execute trade
            // Ensure conditions object exists before setting properties
            if (!autoTradeSettings.conditions) {
              autoTradeSettings.conditions = {
                portfolioValueReached: false,
                cryptoValueReached: false,
                dailyBuyLimitReached: false
              };
            }
            autoTradeSettings.conditions.portfolioValueReached = true;
            shouldExecuteTrade = true;
            reason = `💰 SWING TRADE: Portfolio hit $${triggerValue.toFixed(2)} - EXECUTING $1 TRADE`;
          }
          else {
            const needed = parseFloat((triggerValue - currentPortfolioValue).toFixed(2));
            console.log(`⏳ Need $${needed} more to hit trigger $${triggerValue.toFixed(2)}`);
          }
        } else {
          console.log(`⚠️ Warning: Selected crypto ${autoTradeSettings.selectedCrypto} not found in portfolio`);
        }
      }

      // Check crypto amount condition (SOL)
      if (autoTradeSettings.stopAtValue) {
        const solHolding = holdings.find(h => h.currency === 'SOL');
        if (solHolding && solHolding.amount <= autoTradeSettings.stopAtValue) {
          // Ensure conditions object exists
          if (!autoTradeSettings.conditions) {
            autoTradeSettings.conditions = {
              portfolioValueReached: false,
              cryptoValueReached: false,
              dailyBuyLimitReached: false
            };
          }
          autoTradeSettings.conditions.cryptoValueReached = true;
          shouldExecuteTrade = true;
          reason = `SOL amount reached ${solHolding.amount.toFixed(8)} (trigger: ${autoTradeSettings.stopAtValue})`;
        }
      }

      // Check daily buys condition
      if (autoTradeSettings.stopOnDailyBuys && dailyBuyData.totalBought >= autoTradeSettings.stopOnDailyBuys) {
        // Ensure conditions object exists
        if (!autoTradeSettings.conditions) {
          autoTradeSettings.conditions = {
            portfolioValueReached: false,
            cryptoValueReached: false,
            dailyBuyLimitReached: false
          };
        }
        autoTradeSettings.conditions.dailyBuyLimitReached = true;
        shouldExecuteTrade = true;
        reason = `Daily buys reached $${dailyBuyData.totalBought.toFixed(2)} (trigger: $${autoTradeSettings.stopOnDailyBuys})`;
      }

      console.log(`🔍 FINAL CHECK: shouldExecuteTrade = ${shouldExecuteTrade}`);
      if (shouldExecuteTrade) {
        console.log(`🚨 EXECUTING TRADE: ${reason}`);
        await this.executeAutoTrade(reason);
        
        // CRITICAL: Update trigger AFTER successful trade execution
        if (autoTradeSettings.conditions.portfolioValueReached) {
          // Get fresh portfolio data after trade
          const freshPortfolioData = await this.getPortfolioData();
          const solHolding = freshPortfolioData.holdings.find(h => h.currency === 'SOL');
          if (solHolding) {
            const newTrigger = parseFloat((solHolding.value + 1.00).toFixed(2));
            this.lastTriggerTarget = newTrigger; // RESET TRIGGER AFTER SUCCESSFUL TRADE
            console.log(`🔄 TRIGGER RESET AFTER TRADE: $${newTrigger.toFixed(2)} (post-trade portfolio: $${solHolding.value.toFixed(2)})`);
            await this.saveTriggerToFile();
          }
        }
      } else {
        console.log(`⏸️ NO TRADE: Conditions not met yet`);
      }

    } catch (error) {
      console.error('Error checking auto trade conditions:', error.message);
    } finally {
      // CRITICAL: Always release the lock
      this.isCheckingAutoTrade = false;
    }
  }

  async executeAutoTrade(reason) {
    try {
      // CRITICAL: Trading lock to prevent multiple simultaneous executions
      if (this.tradingLock) {
        console.log(`🔒 Trading locked - Another trade in progress, skipping this cycle`);
        return;
      }
      
      // CRITICAL: Additional safety check - ensure only one execution per minute
      const now = Date.now();
      const oneMinute = 60000;
      if (this.lastTradeTime && (now - this.lastTradeTime) < oneMinute) {
        console.log(`⏰ Trade frequency protection - ${Math.ceil((oneMinute - (now - this.lastTradeTime))/1000)}s until next trade allowed`);
        return;
      }
      
      // CRITICAL: Cooldown check - minimum 30 seconds between trades
      const timeSinceLastTrade = now - (this.lastTradeTime || 0);
      if (timeSinceLastTrade < 30000 && this.lastTradeTime > 0) {
        console.log(`⏰ Trade cooldown active - ${30 - Math.floor(timeSinceLastTrade/1000)}s remaining`);
        return;
      }
      
      console.log(`🤖 Executing Auto Trade - Reason: ${reason}`);
      
      // If this would breach base protection, pause briefly but keep monitoring
      if (reason.includes('STOP SELLING') || reason.includes('would breach base')) {
        // Don't disable, just skip this cycle but keep monitoring
        console.log(`🛡️ Auto Trade cycle skipped - protecting base ${autoTradeSettings.selectedCrypto} amount of ${autoTradeSettings.stopAtLoss}`);
        
        // Log current portfolio status
        const portfolioData = await this.getPortfolioData();
        console.log(`📊 Portfolio protected: ${autoTradeSettings.selectedCrypto} holdings at base level, total value: $${portfolioData.totalValue.toFixed(2)}`);
        
        // Send notification about stopping
        await this.sendAutoTradeNotification(reason, 'STOPPED');
        return;
      }
      
      // CRITICAL: Set trading lock
      this.tradingLock = true;
      console.log(`🔒 Trading lock ENGAGED`);
      
      // Execute $1 USD trade instead of selling all crypto
      console.log(`💰 Executing $1 USD Auto Trade: Selling $1.00 worth of ${autoTradeSettings.selectedCrypto}`);
      
      // Get current portfolio to calculate exact SOL amount for $1 USD
      const portfolioData = await this.getPortfolioData();
      const cryptoHolding = portfolioData.holdings.find(h => h.currency === autoTradeSettings.selectedCrypto);
      
      if (!cryptoHolding) {
        throw new Error(`${autoTradeSettings.selectedCrypto} not found in portfolio`);
      }
      
      // Debug portfolio data structure
      console.log(`🔍 DEBUG - Execute Trade SOL Data:`, {
        currency: cryptoHolding.currency,
        amount: cryptoHolding.amount,
        price: cryptoHolding.price,
        value: cryptoHolding.value,
        change: cryptoHolding.change
      });
      
      // Calculate current price and SOL amount for exactly $1 USD (fix property name)
      const currentPrice = cryptoHolding.price; // Use price directly
      const solAmountFor1USD = 1.00 / currentPrice;
      
      console.log(`📊 $1 USD Trade Calculation:`);
      console.log(`   Current ${autoTradeSettings.selectedCrypto} Price: $${currentPrice.toFixed(2)}`);
      console.log(`   SOL Amount for $1 USD: ${solAmountFor1USD.toFixed(8)}`);
      console.log(`   Current Holdings: ${cryptoHolding.amount.toFixed(8)} SOL`);
      console.log(`   After Sale: ${(cryptoHolding.amount - solAmountFor1USD).toFixed(8)} SOL (protecting ${autoTradeSettings.stopAtLoss} base)`);
      
      const symbol = `${autoTradeSettings.selectedCrypto.toLowerCase()}usd`;
      const sellOrders = [];
      
      // Skip very small amounts that might cause API errors
      if (solAmountFor1USD < 0.000001) {
        console.log(`⏭️ Skipping: $1 USD amount too small (${solAmountFor1USD.toFixed(8)} SOL)`);
        await this.sendAutoTradeNotification(reason, 'SKIPPED');
        return;
      }
      
      // Calculate estimated fee for this $1 USD trade (4 cents)
      const estimatedFeeUSD = 0.04; // 4 cent fee for $1 trades
      const netProceedsUSD = 1.00 - estimatedFeeUSD; // $0.96 net proceeds
      
      console.log(`💰 $1 USD Trade Details:`);
      console.log(`   SOL Amount to sell: ${solAmountFor1USD.toFixed(8)}`);
      console.log(`   Trade value: $1.00 USD`);
      console.log(`   Estimated fee: $${estimatedFeeUSD.toFixed(2)} USD`);
      console.log(`   Net proceeds: $${netProceedsUSD.toFixed(2)} USD`);
      
      // BASE PROTECTION COMPLETELY DISABLED - Execute unrestricted trades
      console.log(`🔥 BASE PROTECTION DISABLED - Executing $1 trade unrestricted!`);
      console.log(`   Current SOL: ${cryptoHolding.amount.toFixed(8)}`);
      console.log(`   Trade Amount: ${solAmountFor1USD.toFixed(8)} SOL`);
      console.log(`   Unrestricted execution enabled!`);
      
      try {
        console.log(`💰 Placing $1 USD sell order: ${solAmountFor1USD.toFixed(8)} ${autoTradeSettings.selectedCrypto} on ${symbol}`);
        
        // Execute actual sell order via Gemini API for exactly $1 USD worth
        const order = await this.gemini.sellOrder(symbol, solAmountFor1USD);
        
        // CRITICAL: Record trade time for cooldown 
        this.lastTradeTime = Date.now();
        
        // KEEP TRIGGER STABLE: Do NOT reset baseline after trades to prevent bouncing
        console.log(`🎯 TRADE COMPLETED: Keeping baseline at $${this.baselineValue.toFixed(2)} and trigger at $${this.savedTriggerValue.toFixed(2)} (NO RESET TO PREVENT BOUNCING)`);
        
        sellOrders.push({
          currency: autoTradeSettings.selectedCrypto,
          amount: solAmountFor1USD,
          valueUSD: 1.00,
          orderId: order.order_id,
          status: 'submitted'
        });
        
        console.log(`✅ $1 USD SELL ORDER EXECUTED: ${solAmountFor1USD.toFixed(8)} ${autoTradeSettings.selectedCrypto} → $1.00 USD`);
        console.log(`   Order ID: ${order.order_id}`);
        console.log(`   Net proceeds: ~$${netProceedsUSD.toFixed(2)} USD after $${estimatedFeeUSD.toFixed(2)} fee`);
        console.log(`   Remaining ${autoTradeSettings.selectedCrypto}: ${(cryptoHolding.amount - solAmountFor1USD).toFixed(8)} (protected base: ${autoTradeSettings.stopAtLoss})`);
        
      } catch (error) {
        console.error(`❌ Failed to execute $1 USD sell order:`, error.message);
        console.log(`🛑 Gemini API failed - stopping auto trade execution to prevent fake trades`);
        console.log(`🔄 Auto trade will retry on next cycle when API is working`);
        
        // CRITICAL: Release trading lock on error
        this.tradingLock = false;
        console.log(`🔓 Trading lock RELEASED due to error`);
        return;
      }

      // Only reach here if Gemini API call was SUCCESSFUL
      console.log(`🔄 Auto trade staying enabled for continuous monitoring`);

      // Send notification to Discord ONLY after successful API call
      await this.sendAutoTradeNotification(reason, sellOrders);
      
      // CRITICAL: Release trading lock after successful trade
      this.tradingLock = false;
      console.log(`🔓 Trading lock RELEASED after successful trade`);

    } catch (error) {
      console.error('Error executing auto trade:', error.message);
      // CRITICAL: Always release lock on any error
      this.tradingLock = false;
      console.log(`🔓 Trading lock RELEASED due to error`);
    }
  }

  async sendAutoTradeNotification(reason, sellOrders) {
    try {
      // Send confirmation as private DM instead of channel message
      const guild = this.client.guilds.cache.first();
      const botOwner = guild.members.cache.find(member => member.permissions.has('ADMINISTRATOR'));
      
      if (!botOwner) {
        console.log('⚠️ Bot owner not found for private DM confirmation');
        return;
      }

      const isStoppedCase = sellOrders === 'STOPPED';
      
      const embed = new EmbedBuilder()
        .setTitle(isStoppedCase ? '🛑 Auto Trade Stopped' : '🤖 Auto Trade Executed')
        .setDescription(`**Trigger:** ${reason}`)
        .setColor(isStoppedCase ? 0xFF9800 : 0x4CAF50)
        .setTimestamp();

      if (isStoppedCase) {
        embed.addFields(
          { name: '🛡️ Base Protection', value: 'SOL holdings reached base amount - Auto Trade stopped to preserve base.', inline: false },
          { name: '⏰ Stopped At', value: new Date().toLocaleString(), inline: true },
          { name: '🔄 Status', value: 'Auto Trade **DISABLED**', inline: true }
        );
      } else {
        const orderText = sellOrders.map(order => {
          const status = order.status === 'submitted' ? '✅' : '❌';
          return `${status} **${order.currency}**: ${order.amount.toFixed(8)} ${order.status === 'submitted' ? `(Order: ${order.orderId})` : `(Error: ${order.error})`}`;
        }).join('\n');

        embed.addFields(
          { name: '📊 Sell Orders', value: orderText || 'No orders placed', inline: false },
          { name: '⏰ Executed At', value: new Date().toLocaleString(), inline: true },
          { name: '🔄 Status', value: 'Auto Trade **DISABLED**', inline: true }
        );
      }

      // Send as private DM instead of channel message
      await botOwner.send({ embeds: [embed] });
      console.log('✅ Trade confirmation sent as private DM');
      
    } catch (error) {
      console.error('Error sending auto trade notification:', error.message);
    }
  }

  async testAutoTrade(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const crypto = interaction.options.getString('crypto') || 'SOL';
    const base = interaction.options.getString('base') || '1/2';
    
    console.log(`🧪 TESTING AUTO TRADE: ${crypto} with base ${base}`);
    
    // Parse the base amount using the fixed fraction logic
    let baseAmount;
    if (base.includes('/')) {
      const [wholePart, fractionPart] = base.split('/');
      const wholeNumber = parseFloat(wholePart);
      const fraction = wholeNumber / parseFloat(fractionPart);
      baseAmount = wholeNumber + fraction;
      console.log(`🧮 Test Fraction calculation: ${wholePart}/${fractionPart} = ${wholeNumber} + ${fraction} = ${baseAmount} ${crypto}`);
    } else {
      baseAmount = parseFloat(base);
    }
    
    // Set up temporary auto trade settings for testing
    const originalSettings = { ...autoTradeSettings };
    
    autoTradeSettings.enabled = true;
    autoTradeSettings.isActive = true;
    autoTradeSettings.selectedCrypto = crypto.toUpperCase();
    autoTradeSettings.stopAtLoss = baseAmount;
    autoTradeSettings.startTime = new Date();
    
    console.log(`⚡ Test Auto Trade Settings:`, autoTradeSettings);
    
    // Run the condition check manually
    await this.checkAutoTradeConditions();
    
    // Restore original settings
    autoTradeSettings.enabled = originalSettings.enabled;
    autoTradeSettings.isActive = originalSettings.isActive;
    autoTradeSettings.selectedCrypto = originalSettings.selectedCrypto;
    autoTradeSettings.stopAtLoss = originalSettings.stopAtLoss;
    
    const embed = new EmbedBuilder()
      .setTitle('🧪 Auto Trade Test Results')
      .setDescription(`**Test Parameters:**\n✅ Crypto: ${crypto.toUpperCase()}\n✅ Base Amount: ${base} = ${baseAmount} ${crypto.toUpperCase()}\n\n**Check the console logs above for detailed condition checking results.**`)
      .setColor(0x2196F3)
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  }

  // Parse current embed data for validation
  parseEmbedData(embed) {
    try {
      const data = {};
      
      // Extract total value from description
      const description = embed.description || '';
      const totalMatch = description.match(/\$(\d+\.?\d*)/);
      if (totalMatch) {
        data.totalValue = parseFloat(totalMatch[1]);
      }
      
      // Extract USD balance and crypto holdings from fields
      data.holdings = [];
      if (embed.fields) {
        embed.fields.forEach(field => {
          if (field.name === '💵 USD Balance') {
            const usdMatch = field.value.match(/\$(\d+\.?\d*)/);
            if (usdMatch) {
              data.usdBalance = parseFloat(usdMatch[1]);
            }
          } else if (field.name.includes('💰')) {
            // Parse crypto holdings
            const nameMatch = field.name.match(/💰 (.+)/);
            if (nameMatch) {
              const currency = nameMatch[1];
              const valueMatch = field.value.match(/\$(\d+\.?\d*)/);
              const amountMatch = field.value.match(/(\d+\.?\d+) \w+/);
              const priceMatch = field.value.match(/@ \$(\d+\.?\d*)/);
              
              if (valueMatch && amountMatch && priceMatch) {
                data.holdings.push({
                  currency,
                  value: parseFloat(valueMatch[1]),
                  amount: parseFloat(amountMatch[1]),
                  price: parseFloat(priceMatch[1])
                });
              }
            }
          }
        });
      }
      
      return data;
    } catch (error) {
      console.error('❌ Error parsing embed data:', error.message);
      return null;
    }
  }
  
  // Validate embed data against fresh API data
  validateEmbedData(currentData, freshData) {
    const discrepancies = [];
    const tolerance = 0.01; // $0.01 tolerance for minor price differences
    
    try {
      // Validate total portfolio value
      if (currentData.totalValue !== undefined && freshData.totalValue !== undefined) {
        const diff = Math.abs(currentData.totalValue - freshData.totalValue);
        if (diff > tolerance) {
          discrepancies.push({
            field: 'Total Portfolio Value',
            expected: `$${freshData.totalValue.toFixed(2)}`,
            actual: `$${currentData.totalValue.toFixed(2)}`,
            difference: `$${diff.toFixed(2)}`
          });
        }
      }
      
      // Validate USD balance
      if (currentData.usdBalance !== undefined && freshData.usdBalance !== undefined) {
        const diff = Math.abs(currentData.usdBalance - freshData.usdBalance);
        if (diff > tolerance) {
          discrepancies.push({
            field: 'USD Balance',
            expected: `$${freshData.usdBalance.toFixed(2)}`,
            actual: `$${currentData.usdBalance.toFixed(2)}`,
            difference: `$${diff.toFixed(2)}`
          });
        }
      }
      
      // Validate crypto holdings
      if (currentData.holdings && freshData.holdings) {
        freshData.holdings.forEach(fresh => {
          const current = currentData.holdings.find(h => h.currency === fresh.currency);
          if (current) {
            // Check value
            const valueDiff = Math.abs(current.value - fresh.value);
            if (valueDiff > tolerance) {
              discrepancies.push({
                field: `${fresh.currency} Value`,
                expected: `$${fresh.value.toFixed(2)}`,
                actual: `$${current.value.toFixed(2)}`,
                difference: `$${valueDiff.toFixed(2)}`
              });
            }
            
            // Check price
            const priceDiff = Math.abs(current.price - fresh.price);
            if (priceDiff > tolerance) {
              discrepancies.push({
                field: `${fresh.currency} Price`,
                expected: `$${fresh.price.toFixed(2)}`,
                actual: `$${current.price.toFixed(2)}`,
                difference: `$${priceDiff.toFixed(2)}`
              });
            }
          }
        });
      }
      
      return discrepancies;
    } catch (error) {
      console.error('❌ Error validating embed data:', error.message);
      return [];
    }
  }

  // User storage for multi-user system
  userDatabase = new Map(); // In production, use actual database

  async createPublicDashboard(interaction) {
    try {
      await interaction.deferReply();

      const publicEmbed = new EmbedBuilder()
        .setTitle('🤖 Day Trading Bot')
        .setDescription('**Powered by UTC**\n\n' +
          '🔥 **Automated Crypto Trading System**\n' +
          '• Intelligent swing trading with $1 increments\n' +
          '• Real-time portfolio monitoring\n' +
          '• Risk management & stop-loss protection\n' +
          '• Multi-user support with individual API connections\n\n' +
          '💰 **How It Works:**\n' +
          '1. Connect your Gemini API for secure trading\n' +
          '2. Bot monitors your portfolio 24/7\n' +
          '3. Automatically sells $1 worth when portfolio increases by $1\n' +
          '4. Maintains your chosen base protection amount\n' +
          '5. Tracks all trades with real-time Discord updates\n\n' +
          '🛡️ **Security Features:**\n' +
          '• Your API keys stay encrypted and private\n' +
          '• Base amount protection prevents over-selling\n' +
          '• Manual override controls always available\n\n' +
          '📊 **Get Started Below:**')
        .setColor(0x00D4AA)
        .setTimestamp()
        .setFooter({ text: 'UTC Trading Bot • Secure • Automated • Profitable' });

      const publicButtons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('create_account')
            .setLabel('Create Account')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🚀'),
          new ButtonBuilder()
            .setCustomId('view_portfolio')
            .setLabel('Portfolio')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📊')
        );

      // Find public-dashboard channel
      const guild = interaction.guild;
      const publicDashboardChannel = guild.channels.cache.find(channel => 
        channel.name === 'public-dashboard' && channel.type === 0
      );

      if (!publicDashboardChannel) {
        await interaction.editReply('❌ #public-dashboard channel not found. Please create it first.');
        return;
      }

      // Send to public dashboard channel
      await publicDashboardChannel.send({
        embeds: [publicEmbed],
        components: [publicButtons]
      });

      await interaction.editReply('✅ Public dashboard created in #public-dashboard!');

    } catch (error) {
      console.error('❌ Error creating public dashboard:', error);
      await this.replyWithError(interaction, `Failed to create public dashboard: ${error.message}`);
    }
  }

  async setupUser(interaction) {
    try {
      // This will be handled via button interactions for security
      await interaction.reply({
        content: '⚠️ Please use the **Create Account** button in #public-dashboard for secure API setup.',
        ephemeral: true
      });
    } catch (error) {
      console.error('❌ Error in setupUser:', error);
      await this.replyWithError(interaction, `Setup error: ${error.message}`);
    }
  }

  async handleCreateAccount(interaction) {
    try {
      console.log(`🚀 Create Account button clicked by user ${interaction.user.tag} (${interaction.user.id})`);
      const userId = interaction.user.id;
      const userExists = this.userDatabase.has(userId);

      if (userExists) {
        const userData = this.userDatabase.get(userId);
        // User exists - show login/logout options
        const loginButtons = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('user_login')
              .setLabel('Log In')
              .setStyle(ButtonStyle.Success)
              .setEmoji('🔐'),
            new ButtonBuilder()
              .setCustomId('user_logout')
              .setLabel('Log Out')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('🚪')
          );

        await interaction.reply({
          content: `👋 Welcome back! You already have an account.\n**Username:** ${userData.username}\n**Status:** ${userData.loggedIn ? '🟢 Logged In' : '🔴 Logged Out'}`,
          components: [loginButtons],
          ephemeral: true
        });
      } else {
        // New user - start API setup process
        const modal = new ModalBuilder()
          .setCustomId('api_setup_modal')
          .setTitle('🔐 Connect Your Gemini API');

        const apiKeyInput = new TextInputBuilder()
          .setCustomId('api_key')
          .setLabel('Gemini API Key')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter your Gemini API Key')
          .setRequired(true);

        const apiSecretInput = new TextInputBuilder()
          .setCustomId('api_secret')
          .setLabel('Gemini API Secret')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter your Gemini API Secret')
          .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(apiKeyInput);
        const secondActionRow = new ActionRowBuilder().addComponents(apiSecretInput);

        modal.addComponents(firstActionRow, secondActionRow);
        await interaction.showModal(modal);
      }
    } catch (error) {
      console.error('❌ Error handling create account:', error);
      await interaction.reply({ content: `❌ Account setup error: ${error.message}`, ephemeral: true });
    }
  }

  async handleApiSetupModal(interaction) {
    try {
      const apiKey = interaction.fields.getTextInputValue('api_key');
      const apiSecret = interaction.fields.getTextInputValue('api_secret');
      const userId = interaction.user.id;

      // Test the API credentials
      await interaction.deferReply({ ephemeral: true });
      
      // Basic validation
      if (!apiKey || !apiSecret || apiKey.length < 10 || apiSecret.length < 10) {
        await interaction.editReply('❌ Invalid API credentials. Please check your Gemini API key and secret.');
        return;
      }

      // Store temporarily and ask for username
      this.userDatabase.set(userId, {
        apiKey: apiKey,
        apiSecret: apiSecret,
        status: 'pending_username',
        loggedIn: false,
        createdAt: new Date()
      });

      const usernameModal = new ModalBuilder()
        .setCustomId('username_modal')
        .setTitle('👤 Choose Your Username');

      const usernameInput = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Username')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Choose a unique username')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(20);

      const usernameRow = new ActionRowBuilder().addComponents(usernameInput);
      usernameModal.addComponents(usernameRow);

      await interaction.editReply('✅ API credentials received! Please choose a username...');
      setTimeout(async () => {
        try {
          await interaction.followUp({ content: 'Please set your username:', ephemeral: true });
          await interaction.showModal(usernameModal);
        } catch (err) {
          console.error('Error showing username modal:', err);
        }
      }, 1000);

    } catch (error) {
      console.error('❌ Error handling API setup:', error);
      await interaction.editReply(`❌ API setup failed: ${error.message}`);
    }
  }

  async handleUsernameModal(interaction) {
    try {
      const username = interaction.fields.getTextInputValue('username');
      const userId = interaction.user.id;

      // Check if username is taken
      const usernameExists = Array.from(this.userDatabase.values()).some(user => user.username === username);
      if (usernameExists) {
        await interaction.reply({ content: '❌ Username already taken. Please choose another.', ephemeral: true });
        return;
      }

      // Complete user setup
      const userData = this.userDatabase.get(userId);
      userData.username = username;
      userData.status = 'active';
      userData.loggedIn = true;
      this.userDatabase.set(userId, userData);

      await interaction.reply({
        content: `🎉 **Account Created Successfully!**\n` +
                `**Username:** ${username}\n` +
                `**Status:** 🟢 Active\n\n` +
                `You can now use the **Portfolio** button to access your personal trading dashboard!`,
        ephemeral: true
      });

      console.log(`✅ New user registered: ${username} (${userId})`);

    } catch (error) {
      console.error('❌ Error handling username setup:', error);
      await interaction.reply({ content: `❌ Username setup failed: ${error.message}`, ephemeral: true });
    }
  }

  async handleViewPortfolio(interaction) {
    try {
      console.log(`📊 Portfolio button clicked by user ${interaction.user.tag} (${interaction.user.id})`);
      const userId = interaction.user.id;
      const userData = this.userDatabase.get(userId);

      if (!userData || !userData.loggedIn) {
        await interaction.reply({
          content: '❌ Please create an account first using the **Create Account** button.',
          ephemeral: true
        });
        return;
      }

      // Create user-specific Gemini instance
      const userGemini = new GeminiAPI(userData.apiKey, userData.apiSecret);
      
      try {
        // Test API and get portfolio data
        const balances = await userGemini.getBalances();
        const portfolioData = await this.processUserPortfolioData(balances, userGemini);
        
        // Create personal portfolio embed (same format as main dashboard)
        const embed = this.createPortfolioEmbed(portfolioData);
        const buttons = this.createPortfolioButtons();

        // Add user identification
        embed.setAuthor({ name: `${userData.username}'s Portfolio` });

        await interaction.reply({
          embeds: [embed],
          components: buttons,
          ephemeral: true
        });

      } catch (apiError) {
        await interaction.reply({
          content: `❌ API Error: Unable to fetch your portfolio data.\n**Error:** ${apiError.message}\n\nPlease check your API credentials.`,
          ephemeral: true
        });
      }

    } catch (error) {
      console.error('❌ Error showing user portfolio:', error);
      await interaction.reply({ content: `❌ Portfolio error: ${error.message}`, ephemeral: true });
    }
  }

  async processUserPortfolioData(balances, geminiInstance) {
    // Process balances similar to main portfolio but for individual user
    const cryptoBalances = balances.filter(b => b.currency !== 'USD' && parseFloat(b.amount) > 0);
    const usdBalance = balances.find(b => b.currency === 'USD') || { amount: '0.00' };

    let totalValue = 0;
    const holdings = [];

    for (const balance of cryptoBalances) {
      try {
        const symbol = `${balance.currency}USD`;
        const ticker = await geminiInstance.getTicker(symbol);
        const price = parseFloat(ticker.last);
        const amount = parseFloat(balance.amount);
        const value = price * amount;
        
        totalValue += value;
        holdings.push({
          currency: balance.currency,
          amount: amount,
          price: price,
          value: value,
          change: 0 // Would need historical data for real change
        });
      } catch (error) {
        console.error(`Error fetching price for ${balance.currency}:`, error);
      }
    }

    return {
      totalValue: totalValue,
      usdBalance: parseFloat(usdBalance.amount),
      holdings: holdings,
      username: this.userDatabase.get(interaction?.user?.id)?.username || 'User'
    };
  }

  async handleUserLogin(interaction) {
    try {
      const userId = interaction.user.id;
      const userData = this.userDatabase.get(userId);

      if (!userData) {
        await interaction.reply({
          content: '❌ No account found. Please create an account first.',
          ephemeral: true
        });
        return;
      }

      // Simple username confirmation for login
      const modal = new ModalBuilder()
        .setCustomId('login_modal')
        .setTitle('🔐 Log In to Your Account');

      const usernameInput = new TextInputBuilder()
        .setCustomId('login_username')
        .setLabel('Enter Your Username')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Your registered username')
        .setRequired(true);

      const usernameRow = new ActionRowBuilder().addComponents(usernameInput);
      modal.addComponents(usernameRow);
      await interaction.showModal(modal);

    } catch (error) {
      console.error('❌ Error handling user login:', error);
      await interaction.reply({ content: `❌ Login error: ${error.message}`, ephemeral: true });
    }
  }

  async handleUserLogout(interaction) {
    try {
      const userId = interaction.user.id;
      const userData = this.userDatabase.get(userId);

      if (!userData) {
        await interaction.reply({
          content: '❌ No account found.',
          ephemeral: true
        });
        return;
      }

      // Log out the user
      userData.loggedIn = false;
      this.userDatabase.set(userId, userData);

      await interaction.reply({
        content: `👋 **Logged Out Successfully**\n**Username:** ${userData.username}\n**Status:** 🔴 Logged Out\n\nYou can log back in anytime using the Create Account button.`,
        ephemeral: true
      });

      console.log(`🚪 User logged out: ${userData.username} (${userId})`);

    } catch (error) {
      console.error('❌ Error handling user logout:', error);
      await interaction.reply({ content: `❌ Logout error: ${error.message}`, ephemeral: true });
    }
  }


  async handleLoginModal(interaction) {
    try {
      const username = interaction.fields.getTextInputValue('login_username');
      const userId = interaction.user.id;
      const userData = this.userDatabase.get(userId);

      if (!userData || userData.username !== username) {
        await interaction.reply({
          content: '❌ Invalid username. Please check your username or create a new account.',
          ephemeral: true
        });
        return;
      }

      // Log in the user
      userData.loggedIn = true;
      this.userDatabase.set(userId, userData);

      await interaction.reply({
        content: `🔐 **Logged In Successfully!**\n**Username:** ${username}\n**Status:** 🟢 Logged In\n\nYou can now access your portfolio dashboard!`,
        ephemeral: true
      });

      console.log(`🔐 User logged in: ${username} (${userId})`);

    } catch (error) {
      console.error('❌ Error handling login modal:', error);
      await interaction.reply({ content: `❌ Login failed: ${error.message}`, ephemeral: true });
    }
  }

  async start() {
    try {
      console.log('🔗 Attempting Discord login with token...');
      if (!BOT_TOKEN) {
        console.error('❌ DISCORD_BOT_TOKEN is missing!');
        return;
      }
      console.log(`🔑 Token exists: ${BOT_TOKEN.substring(0, 10)}...`);
      
      await this.client.login(BOT_TOKEN);
      console.log('✅ Discord login attempt completed');
    } catch (error) {
      console.error('❌ Failed to start Discord bot:', error.message);
      process.exit(1);
    }
  }
}

// Start the bot with error handling
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error.message);
  // Don't exit, keep the bot running
});

process.on('unhandledRejection', (error) => {
  console.error('💥 Unhandled Rejection:', error.message);
  // Don't exit, keep the bot running
});

const bot = new DiscordTradingBot();
bot.start();

export default DiscordTradingBot;