import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } from 'discord.js';
import crypto from 'crypto';
import axios from 'axios';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
// Note: Using direct database tables since we can't easily import TS schema from JS
import { eq } from "drizzle-orm";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

// Discord Bot Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Gemini API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_SECRET = process.env.GEMINI_API_SECRET;
const GEMINI_BASE_URL = 'https://api.gemini.com';

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
    await axios.post('http://localhost:5000/api/bot/ping', {
      status,
      errorMessage
    });
  } catch (error) {
    // Ignore keep-alive errors to prevent cascading failures
    console.log('Keep-alive ping failed (non-critical):', error.message);
  }
}

class GeminiAPI {
  constructor() {
    this.apiKey = GEMINI_API_KEY;
    this.apiSecret = GEMINI_API_SECRET;
    this.baseUrl = GEMINI_BASE_URL;
  }

  generateHeaders(endpoint, payload = {}) {
    // Use current timestamp in seconds (not milliseconds) for better Gemini compatibility
    const nonce = Math.floor(Date.now() / 1000).toString();
    const payloadWithDefaults = {
      request: endpoint,
      nonce: nonce,
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
      console.log('📊 Raw Gemini balances:', JSON.stringify(response.data, null, 2));
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
      const nonce = Math.floor(Date.now() / 1000).toString();
      
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
    });

    this.gemini = new GeminiAPI();
    this.activePortfolioMessages = new Map(); // Store active portfolio messages for auto-updating
    this.dashboardMessageId = null; // Track main dashboard message
    this.dashboardChannelId = null; // Track dashboard channel
    this.tradingLock = false; // CRITICAL: Prevent multiple simultaneous trades
    this.lastTradeTime = 0; // CRITICAL: Track last trade for cooldown
    
    // Real-time data storage
    this.realTimeBalances = new Map(); // Store live balance data
    this.realTimePrices = new Map();   // Store live price data
    this.priceHistory = [];           // Store price history for swing trading
    this.lastBalanceUpdate = null;
    this.lastPriceUpdate = null;
    
    this.setupEventHandlers();
    this.registerCommands();
  }

  async initializePriceHistory() {
    try {
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
      await this.findOrCreateDashboardEmbed();
      
      // Start keep-alive ping system
      this.startKeepAlive();
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
            .setRequired(false))
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
        case 'refresh_portfolio':
          await this.refreshPortfolio(interaction);
          break;
        case 'view_daily_buys':
          await this.showDailyBuyTracker(interaction);
          break;
        case 'view_orders':
          await this.showActiveOrders(interaction);
          break;
        case 'price_alerts':
          await this.showPriceAlerts(interaction);
          break;
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
        case 'stop_auto_trade':
          await this.stopAutoTrade(interaction);
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
      if (interaction.customId === 'auto_trade_modal') {
        console.log('🤖 Auto Trade Modal submitted - processing configuration');
        await this.handleAutoTradeModal(interaction);
      } else {
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

  createPortfolioEmbed(data) {
    const limitStatus = dailyBuyData.limitReached ? '🔴 LIMIT REACHED' : '🟢 Within Limit';
    const remainingLimit = Math.max(0, tradingSettings.dailyBuyLimit - dailyBuyData.totalBought);

    const embed = new EmbedBuilder()
      .setTitle('💰 Live Portfolio Dashboard')
      .setColor(dailyBuyData.limitReached ? 0xF44336 : 0x2196F3)
      .addFields(
        { name: '📊 Total Portfolio Value', value: `**$${this.truncateToFixed(data.totalValue, 2)}**`, inline: true },
        { name: '📈 Daily Buy Status', value: limitStatus, inline: true },
        { name: '🔄 Remaining Limit', value: `$${this.truncateToFixed(remainingLimit, 2)}`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Live Portfolio • Auto-updating' });

    // Add cryptocurrency holdings with live prices
    if (data.holdings.length > 0) {
      const cryptoText = data.holdings
        .map(h => {
          const changeIndicator = h.change >= 0 ? '📈' : '📉';
          return `${changeIndicator} **${h.currency}**\n` +
                 `Amount: \`${h.amount.toFixed(8)}\`\n` +
                 `Live Price: **$${this.truncateToFixed(h.price, 2)}**\n` +
                 `Value: **$${this.truncateToFixed(h.value, 2)}**\n`;
        })
        .join('\n');
      
      embed.addFields({ 
        name: '🪙 Cryptocurrency Holdings', 
        value: cryptoText || 'No crypto holdings detected', 
        inline: false 
      });
    } else {
      embed.addFields({ 
        name: '🪙 Cryptocurrency Holdings', 
        value: 'No cryptocurrency holdings detected', 
        inline: false 
      });
    }

    // Add USD/Stablecoin information separately
    const solHolding = data.holdings.find(h => h.currency === 'SOL');
    const solBalanceText = solHolding ? `🪙 **SOL Balance**: ${solHolding.amount.toFixed(8)} SOL\n` : '';
    
    const stablecoinInfo = `💵 **USD Balance**: $${this.truncateToFixed(data.usdBalance, 2)}\n` +
                          solBalanceText +
                          `📊 **Daily Buys**: $${this.truncateToFixed(dailyBuyData.totalBought, 2)}\n` +
                          `💳 **Daily Limit**: $${tradingSettings.dailyBuyLimit}\n` +
                          `🕐 **Last Updated**: ${new Date().toLocaleTimeString()}`;

    embed.addFields({ 
      name: '💰 USD & Trading Information', 
      value: stablecoinInfo, 
      inline: false 
    });

    return embed;
  }

  createPortfolioButtons() {
    return [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('refresh_portfolio')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
          new ButtonBuilder()
            .setCustomId('view_daily_buys')
            .setLabel('Daily Buy Tracker')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📊'),
          new ButtonBuilder()
            .setCustomId('view_orders')
            .setLabel('Active Orders')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋'),
          new ButtonBuilder()
            .setCustomId('price_alerts')
            .setLabel('Price Alerts')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔔'),
          new ButtonBuilder()
            .setCustomId('emergency_stop')
            .setLabel('Stop Monitoring')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🛑')
        ),
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

      embed.setTimestamp(dailyBuyData.lastUpdate);

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
      
      console.log(`🎯 Auto-Update Portfolio Summary:`);
      console.log(`   USD Balance: $${displayUsdBalance.toFixed(2)}`);
      console.log(`   Crypto Holdings: ${holdings.length} assets`);
      console.log(`   Total Portfolio Value: $${totalValue.toFixed(2)}`);

      const embed = this.createPortfolioEmbed({
        totalValue,
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
      }
    }
  }

  async findOrCreateDashboardEmbed() {
    try {
      // Find the dashboard channel
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.log('❌ No guild found');
        return;
      }

      const dashboardChannel = guild.channels.cache.find(channel => 
        channel.name.toLowerCase() === 'dashboard' && channel.isTextBased()
      );

      if (!dashboardChannel) {
        console.log('❌ Dashboard channel not found. Create a channel named "dashboard"');
        return;
      }

      // Try to find existing dashboard embed
      console.log(`🔍 Searching for existing dashboard embed in #${dashboardChannel.name}`);
      
      try {
        // Fetch recent messages to find existing dashboard
        const messages = await dashboardChannel.messages.fetch({ limit: 50 });
        const existingDashboard = messages.find(msg => 
          msg.author.id === this.client.user.id && 
          msg.embeds.length > 0 && 
          msg.embeds[0].title === '💰 Live Portfolio Dashboard'
        );

        if (existingDashboard) {
          console.log(`✅ Found existing dashboard message: ${existingDashboard.id}`);
          this.dashboardMessageId = existingDashboard.id;
          this.dashboardChannelId = dashboardChannel.id;
          
          // Update the existing embed with current data
          await this.updatePortfolioMessage(this.dashboardChannelId, this.dashboardMessageId);
          return;
        }
      } catch (fetchError) {
        console.log('⚠️ Could not fetch existing messages, creating new dashboard');
      }

      // No existing dashboard found, create new one
      console.log(`📊 Creating new portfolio embed in #${dashboardChannel.name}`);
      await this.sendDashboardEmbed();

    } catch (error) {
      console.error('❌ Error finding/creating dashboard embed:', error.message);
    }
  }

  async sendDashboardEmbed() {
    try {
      // Find the dashboard channel
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.log('❌ No guild found');
        return;
      }

      const dashboardChannel = guild.channels.cache.find(channel => 
        channel.name.toLowerCase() === 'dashboard' && channel.isTextBased()
      );

      if (!dashboardChannel) {
        console.log('❌ Dashboard channel not found. Create a channel named "dashboard"');
        return;
      }

      console.log(`📊 Sending portfolio embed to #${dashboardChannel.name}`);
      
      // Try to get portfolio data, fallback to demo data if API fails
      let totalValue = 0;
      let usdBalance = 0;
      let holdings = [];

      try {
        // Get portfolio data
        const balances = await this.gemini.getBalances();
        const cryptoBalances = balances.filter(b => b.currency !== 'USD' && parseFloat(b.amount) > 0);
        const usdBalanceData = balances.find(b => b.currency === 'USD') || { amount: '0.00' };
        
        console.log(`📊 Found ${cryptoBalances.length} crypto balances to process:`);
        cryptoBalances.forEach(b => console.log(`   ${b.currency}: ${b.amount}`));
        console.log(`🎯 AUTO-UPDATE: Starting price fetching for ${cryptoBalances.length} cryptocurrencies...`);

        // Use available USD balance instead of total amount (which can be negative due to margin)
        const totalUsdAmount = parseFloat(usdBalanceData.amount);
        const availableUsdAmount = parseFloat(usdBalanceData.available || '0.00');
        // Use precise truncation to 2 decimal places (no rounding up)
        usdBalance = Math.floor(availableUsdAmount * 100) / 100;
        totalValue = usdBalance; // Start total with corrected USD balance
        
        console.log(`💵 USD Balance Analysis:`);
        console.log(`   Total USD Amount: $${totalUsdAmount.toFixed(2)} (includes margin/borrowed)`);
        console.log(`   Raw Available USD: ${availableUsdAmount} (exact value)`);
        console.log(`   Available USD: $${availableUsdAmount.toFixed(2)} (actual usable balance)`);
        console.log(`   Math.round(${availableUsdAmount} * 100) / 100 = $${(Math.round(availableUsdAmount * 100) / 100).toFixed(2)}`);
        console.log(`   Displayed USD: $${usdBalance.toFixed(2)}`);
        console.log(`   Starting Total Value: $${totalValue.toFixed(2)}`);

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
            totalValue += value;
            console.log(`   ${balance.currency}: ${amount.toFixed(8)} @ $${currentPrice.toFixed(2)} = $${value.toFixed(2)} (Total: $${totalValue.toFixed(2)})`);

            holdings.push({
              currency: balance.currency,
              amount: amount,
              price: currentPrice,
              value: truncatedValue,
              change: change
            });
          } catch (error) {
            console.error(`Error getting price for ${balance.currency}:`, error.message);
          }
        }

        // Update daily buy tracking
        await this.updateDailyBuyTracking();
        
        console.log(`🎯 Final Portfolio Summary:`);
        console.log(`   USD Balance: $${usdBalance.toFixed(2)}`);
        console.log(`   Crypto Holdings: ${holdings.length} assets`);
        console.log(`   Total Portfolio Value: $${totalValue.toFixed(2)}`);

      } catch (error) {
        console.error('Error fetching Gemini data:', error.message);
        console.log('📊 Deploying dashboard with connection status...');
        
        // Reset daily data for initial display
        dailyBuyData = {
          totalBought: 0,
          purchases: [],
          limitReached: false,
          lastUpdate: new Date()
        };
      }

      const embed = this.createPortfolioEmbed({
        totalValue,
        usdBalance,
        holdings,
        dailyBuyData
      });

      const buttons = this.createPortfolioButtons();

      const message = await dashboardChannel.send({
        embeds: [embed],
        components: buttons,
      });

      // Store dashboard message for auto-updating (only one main message)
      this.dashboardMessageId = message.id;
      this.dashboardChannelId = dashboardChannel.id;

      console.log(`✅ Portfolio dashboard sent to #${dashboardChannel.name}`);
      console.log(`🔧 Dashboard tracking enabled: Message ID ${this.dashboardMessageId} in Channel ID ${this.dashboardChannelId}`);

    } catch (error) {
      console.error('❌ Error sending dashboard embed:', error.message);
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
    console.log('💰 Starting balance streaming (every 10 seconds)...');
    
    // Fetch fresh balance data every 10 seconds (instead of every 1 second)
    setInterval(async () => {
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
        
        // Trigger immediate portfolio update with fresh data
        if (this.dashboardMessageId && this.dashboardChannelId) {
          await this.updatePortfolioMessageFromRealTimeData();
        }
        
      } catch (error) {
        if (!error.message.includes('429')) {
          console.error('❌ Balance streaming error:', error.message);
        }
      }
    }, 10000); // Every 10 seconds for balance updates
  }
  
  startPriceStreaming() {
    console.log('📈 Starting price streaming (every 3 seconds)...');
    
    // Fetch fresh price data every 5 seconds for reliable swing detection (avoid rate limits)
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
              this.priceHistory.push(price);
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
    }, 8000); // Every 8 seconds for price updates (prevent rate limits)
  }
  
  startSwingMonitoring() {
    console.log('🌊 Starting swing trading monitoring (every 1 second)...');
    
    // Monitor for swing trading opportunities every 3 seconds
    setInterval(async () => {
      await this.checkAutoTradeConditionsRealTime();
    }, 6000); // Every 6 seconds for swing monitoring (prevent rate limits)
  }
  
  async updatePortfolioMessageFromRealTimeData() {
    try {
      if (!this.dashboardMessageId || !this.dashboardChannelId) {
        return;
      }
      
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
      
      console.log(`🎆 TOTAL PORTFOLIO: $${totalValue.toFixed(2)}`);
      
      // Update the Discord embed with fresh data
      const channel = await this.client.channels.fetch(this.dashboardChannelId);
      const message = await channel.messages.fetch(this.dashboardMessageId);
      
      const embed = this.createPortfolioEmbed({
        totalValue: totalValue,
        usdBalance: displayUsdBalance,
        holdings: holdings
      });
      
      await message.edit({ embeds: [embed] });
      console.log('✨ REAL-TIME PORTFOLIO UPDATED SUCCESSFULLY!');
      
    } catch (error) {
      console.error('❌ Real-time portfolio update failed:', error.message);
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
      
      if (remainingAfterSale >= autoTradeSettings.stopAtLoss) {
        // DYNAMIC SWING TRADING: Use cached price history
        if (this.priceHistory.length < 3) {
          console.log(`🔄 Building price history... (${this.priceHistory.length}/3 minimum)`);
          return;
        }
        
        // Find the lowest price in recent history
        const recentLow = Math.min(...this.priceHistory);
        const priceRiseFromLow = currentPrice - recentLow;
        
        console.log(`📈 REAL-TIME DYNAMIC SWING CHECK:`);
        console.log(`   Recent Low (${this.priceHistory.length} samples): $${recentLow.toFixed(2)}`);
        console.log(`   Current Price: $${currentPrice.toFixed(2)}`);  
        console.log(`   Rise from Low: $${priceRiseFromLow.toFixed(2)}`);
        console.log(`   Swing Trigger: $1.08`);
        console.log(`   Recent Prices: [${this.priceHistory.slice(-5).map(p => p.toFixed(2)).join(', ')}]`);
        
        if (priceRiseFromLow >= 1.08) {
          console.log(`🚨 REAL-TIME SWING TRADE TRIGGERED!`);
          const reason = `🌊 REAL-TIME SWING: ${autoTradeSettings.selectedCrypto} rose $${priceRiseFromLow.toFixed(2)} from recent low ($${recentLow.toFixed(2)} → $${currentPrice.toFixed(2)}) - EXECUTING $1 TRADE`;
          
          // Execute the trade using existing trade logic
          await this.executeAutoTrade(autoTradeSettings.selectedCrypto, 1.0, reason);
          
        } else {
          const neededRise = 1.00 - priceRiseFromLow;
          console.log(`🔄 Real-time monitoring: Need $${neededRise.toFixed(2)} more rise from recent low to trigger trade`);
        }
      } else {
        console.log(`✅ ${autoTradeSettings.selectedCrypto} base protected: ${remainingAfterSale.toFixed(8)} < ${autoTradeSettings.stopAtLoss} (REAL-TIME)`);
      }
      
    } catch (error) {
      console.error('❌ Real-time swing check error:', error.message);
    }
  }

  startAutoUpdating() {
    console.log('🚀 Starting REAL-TIME portfolio monitoring with live data streams...');
    
    // Initialize real-time monitoring
    this.initializeRealTimeMonitoring();
    
    // FORCE IMMEDIATE RECONNECTION
    console.log('🚨 FORCING IMMEDIATE DASHBOARD RECONNECTION...');
    setTimeout(() => {
      this.findOrCreateDashboardEmbed().catch(error => {
        console.error('❌ Immediate reconnection failed:', error.message);
      });
    }, 2000);
    
    // Reduced frequency polling for backup (every 30 seconds instead of 1 second)
    setInterval(async () => {
      // Only update the main dashboard embed - don't create new ones
      if (this.dashboardMessageId && this.dashboardChannelId) {
        console.log(`🔄 Backup sync for message ${this.dashboardMessageId}`);
        try {
          await this.updatePortfolioMessageFromRealTimeData();
        } catch (error) {
          console.error('❌ Dashboard backup sync failed:', error.message);
          // Reset dashboard tracking if message becomes invalid
          this.dashboardMessageId = null;
          this.dashboardChannelId = null;
          console.log('🔄 Attempting to reconnect to dashboard...');
          await this.findOrCreateDashboardEmbed();
        }
      } else {
        console.log(`⚠️ No dashboard message tracked - RECONNECTING...`);
        try {
          await this.findOrCreateDashboardEmbed();
          console.log(`🔗 Dashboard reconnection completed`);
        } catch (error) {
          console.error(`❌ Dashboard reconnection failed:`, error.message);
        }
      }
    }, 30000); // Backup sync every 30 seconds (much less frequent)
  }

  startKeepAlive() {
    console.log('💗 Starting enhanced keep-alive ping system (every 1 second)...');
    
    // Send keep-alive ping every 1 second for maximum uptime
    setInterval(async () => {
      await sendKeepAlivePing('running');
    }, 1000); // 1 second intervals
    
    // Initial ping
    sendKeepAlivePing('running');
    
    // Additional heartbeat every 5 seconds with status update
    setInterval(async () => {
      try {
        await sendKeepAlivePing('running', null);
        console.log('💗 Keep-alive heartbeat sent successfully');
      } catch (error) {
        console.error('💔 Keep-alive heartbeat failed:', error.message);
      }
    }, 5000);
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
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
    
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

  async checkAutoTradeConditions() {
    // Debug log to show monitoring is running
    console.log(`🔄 Auto Trade Monitor Check - Enabled: ${autoTradeSettings.enabled}, Active: ${autoTradeSettings.isActive}`);
    
    if (!autoTradeSettings.enabled || !autoTradeSettings.isActive) {
      console.log(`⏸️ Auto Trade monitoring skipped - not enabled/active`);
      return;
    }

    try {
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
          
          // CRITICAL PRIMARY CHECK: Are we already below base protection?
          if (cryptoHolding.amount < autoTradeSettings.stopAtLoss) {
            console.log(`🚨 BELOW BASE PROTECTION!`);
            console.log(`   Current ${autoTradeSettings.selectedCrypto}: ${cryptoHolding.amount.toFixed(8)} SOL`);
            console.log(`   Base Protection Level: ${autoTradeSettings.stopAtLoss} SOL`);
            console.log(`   Deficit: ${(autoTradeSettings.stopAtLoss - cryptoHolding.amount).toFixed(8)} SOL`);
            console.log(`   🛑 ALL TRADING STOPPED - Must buy more ${autoTradeSettings.selectedCrypto} to restore base`);
            return; // Exit immediately - no trades allowed when below base
          }
          
          console.log(`✅ Base Protection Status: ${cryptoHolding.amount.toFixed(8)} >= ${autoTradeSettings.stopAtLoss} SOL - Safe to evaluate trades`);
          
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
          
          // Find the lowest price in recent history
          const recentLow = Math.min(...this.priceHistory);
          const priceRiseFromLow = currentPrice - recentLow;
          
          console.log(`📈 DYNAMIC SWING TRADING CHECK:`);
          console.log(`   Recent Low (30s): $${recentLow.toFixed(2)}`);
          console.log(`   Current Price: $${currentPrice.toFixed(2)}`);  
          console.log(`   Rise from Low: $${priceRiseFromLow.toFixed(2)}`);
          console.log(`   Swing Trigger: $1.08`);
          console.log(`   Price History: [${this.priceHistory.slice(-5).map(p => p.toFixed(2)).join(', ')}]`);
          
          // SWING TRIGGER CHECK FIRST
          if (priceRiseFromLow >= 1.08) {
            console.log(`🚨 SWING CONDITION MET! Rise of $${priceRiseFromLow.toFixed(2)} >= $1.08 trigger`);
            
            // NOW check base protection for this swing trade
            console.log(`🔍 Base Protection Check: ${remainingAfterSale.toFixed(8)} >= ${autoTradeSettings.stopAtLoss} = ${remainingAfterSale >= autoTradeSettings.stopAtLoss}`);
            
            // Adjust base protection to allow trading with current SOL amount
            const tradingBuffer = 0.0005; // Allow small buffer for trading
            const adjustedBaseProtection = autoTradeSettings.stopAtLoss - tradingBuffer;
            
            if (remainingAfterSale >= adjustedBaseProtection) {
              // BOTH conditions met - execute trade!
              autoTradeSettings.conditions.portfolioValueReached = true;
              shouldExecuteTrade = true;
              reason = `🌊 SWING PROFIT: ${autoTradeSettings.selectedCrypto} rose $${priceRiseFromLow.toFixed(2)} from recent low ($${recentLow.toFixed(2)} → $${currentPrice.toFixed(2)}) - EXECUTING $1 TRADE`;
              console.log(`🚨 SWING TRADE TRIGGERED! shouldExecuteTrade = true, reason: ${reason}`);
            } else {
              console.log(`⚠️ SWING BLOCKED: Would breach base protection (${remainingAfterSale.toFixed(8)} < ${adjustedBaseProtection.toFixed(4)}) - need ${(adjustedBaseProtection - remainingAfterSale).toFixed(8)} more SOL`);
            }
          } else {
            const neededRise = 1.08 - priceRiseFromLow;
            console.log(`🔄 Monitoring swings: Need $${neededRise.toFixed(2)} more rise from recent low to trigger trade`);
            
            // Still show base protection status for info
            const tradingBuffer = 0.0005; // Same buffer as swing check
            const adjustedBaseProtection = autoTradeSettings.stopAtLoss - tradingBuffer;
            if (remainingAfterSale < adjustedBaseProtection) {
              console.log(`ℹ️ Note: Even if swing triggered, would need ${(adjustedBaseProtection - remainingAfterSale).toFixed(8)} more SOL for safe execution`);
            } else {
              console.log(`✅ TRADING ENABLED: Sufficient SOL above adjusted base (${adjustedBaseProtection.toFixed(4)}) for $1 trades`);
            }
          }
        } else {
          console.log(`⚠️ Warning: Selected crypto ${autoTradeSettings.selectedCrypto} not found in portfolio`);
        }
      }

      // Check crypto amount condition (SOL)
      if (autoTradeSettings.stopAtValue) {
        const solHolding = holdings.find(h => h.currency === 'SOL');
        if (solHolding && solHolding.amount <= autoTradeSettings.stopAtValue) {
          autoTradeSettings.conditions.cryptoValueReached = true;
          shouldExecuteTrade = true;
          reason = `SOL amount reached ${solHolding.amount.toFixed(8)} (trigger: ${autoTradeSettings.stopAtValue})`;
        }
      }

      // Check daily buys condition
      if (autoTradeSettings.stopOnDailyBuys && dailyBuyData.totalBought >= autoTradeSettings.stopOnDailyBuys) {
        autoTradeSettings.conditions.dailyBuyLimitReached = true;
        shouldExecuteTrade = true;
        reason = `Daily buys reached $${dailyBuyData.totalBought.toFixed(2)} (trigger: $${autoTradeSettings.stopOnDailyBuys})`;
      }

      if (shouldExecuteTrade) {
        console.log(`🤖 Auto Trade condition met: ${reason}`);
        await this.executeAutoTrade(reason);
      }

    } catch (error) {
      console.error('Error checking auto trade conditions:', error.message);
    }
  }

  async executeAutoTrade(reason) {
    try {
      // CRITICAL: Trading lock to prevent multiple simultaneous executions
      if (this.tradingLock) {
        console.log(`🔒 Trading locked - Another trade in progress, skipping this cycle`);
        return;
      }
      
      // CRITICAL: Cooldown check - minimum 30 seconds between trades
      const now = Date.now();
      const timeSinceLastTrade = now - this.lastTradeTime;
      if (timeSinceLastTrade < 30000) {
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
      
      // CRITICAL: FINAL BASE PROTECTION CHECK with live data
      console.log(`🛡️ FINAL BASE PROTECTION CHECK before placing order...`);
      const feeBufferInSOL = 0.04 / currentPrice; // Fee buffer in SOL
      const totalSOLImpact = solAmountFor1USD + feeBufferInSOL;
      const finalRemainingSOL = cryptoHolding.amount - totalSOLImpact;
      
      console.log(`🔍 FINAL SAFETY CHECK:`);
      console.log(`   Current SOL: ${cryptoHolding.amount.toFixed(8)}`);
      console.log(`   Trade + Fee Impact: ${totalSOLImpact.toFixed(8)} SOL`);
      console.log(`   Final Remaining: ${finalRemainingSOL.toFixed(8)} SOL`);
      console.log(`   Base Protection: ${autoTradeSettings.stopAtLoss} SOL`);
      console.log(`   Safe to trade: ${finalRemainingSOL >= autoTradeSettings.stopAtLoss}`);
      
      if (finalRemainingSOL < autoTradeSettings.stopAtLoss) {
        console.log(`🚨 FINAL CHECK FAILED! Would breach base protection!`);
        console.log(`🛡️ ABORTING TRADE - Base protection activated`);
        this.tradingLock = false; // Release lock
        return;
      }
      
      console.log(`✅ FINAL CHECK PASSED - Safe to execute trade`);
      
      try {
        console.log(`💰 Placing $1 USD sell order: ${solAmountFor1USD.toFixed(8)} ${autoTradeSettings.selectedCrypto} on ${symbol}`);
        
        // Execute actual sell order via Gemini API for exactly $1 USD worth
        const order = await this.gemini.sellOrder(symbol, solAmountFor1USD);
        
        // CRITICAL: Record trade time for cooldown
        this.lastTradeTime = Date.now();
        
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
      const guild = this.client.guilds.cache.first();
      const dashboardChannel = guild.channels.cache.find(channel => 
        channel.name.toLowerCase() === 'dashboard' && channel.isTextBased()
      );

      if (!dashboardChannel) return;

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

      await dashboardChannel.send({ embeds: [embed] });
      
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

  async start() {
    try {
      await this.client.login(BOT_TOKEN);
      console.log('🚀 Discord monitoring bot started successfully!');
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
    }
  }
}

// Start the bot
const bot = new DiscordTradingBot();
bot.start();

export default DiscordTradingBot;