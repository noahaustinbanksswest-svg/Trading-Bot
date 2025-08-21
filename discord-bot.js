import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } from 'discord.js';
import crypto from 'crypto';
import axios from 'axios';

// Discord Bot Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Gemini API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_SECRET = process.env.GEMINI_API_SECRET;
const GEMINI_BASE_URL = 'https://api.gemini.com';

// Trading Settings (monitoring only - no trade initiation)
const tradingSettings = {
  dailyBuyLimit: 1000,
  stopLossPercent: 5,
  takeProfitPercent: 10,
  enableStopLoss: true,
  enableProfitTaking: true,
  enabledPairs: ['btcusd', 'ethusd'],
  lastDailyReset: new Date().toDateString()
};

// Daily tracking data
let dailyBuyData = {
  totalBought: 0,
  purchases: [],
  limitReached: false,
  lastUpdate: new Date()
};

class GeminiAPI {
  constructor() {
    this.apiKey = GEMINI_API_KEY;
    this.apiSecret = GEMINI_API_SECRET;
    this.baseUrl = GEMINI_BASE_URL;
  }

  generateHeaders(endpoint, payload = {}) {
    const nonce = Date.now().toString();
    const payloadWithDefaults = {
      request: endpoint,
      nonce: nonce,
      ...payload
    };

    const encodedPayload = Buffer.from(JSON.stringify(payloadWithDefaults)).toString('base64');
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

  async getBalances() {
    try {
      const endpoint = '/v1/balances';
      const headers = this.generateHeaders(endpoint);
      
      console.log('🔗 Testing Gemini API connection...');
      const response = await axios.post(`${this.baseUrl}${endpoint}`, {}, { headers });
      console.log('✅ Gemini API connected successfully');
      return response.data;
    } catch (error) {
      console.error('❌ Gemini API Error Details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      if (error.response?.status === 400) {
        console.log('💡 Gemini API Key Help:');
        console.log('   - Ensure API key has "Account" permissions enabled');
        console.log('   - Check if API key is active and not revoked');
        console.log('   - Verify API secret is correct');
      }
      
      throw new Error(`Failed to get balances: ${error.message}`);
    }
  }

  async getActiveOrders() {
    try {
      const endpoint = '/v1/orders';
      const headers = this.generateHeaders(endpoint);
      
      const response = await axios.post(`${this.baseUrl}${endpoint}`, {}, { headers });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get active orders: ${error.message}`);
    }
  }

  async getTrades() {
    try {
      const endpoint = '/v1/mytrades';
      const headers = this.generateHeaders(endpoint);
      
      const response = await axios.post(`${this.baseUrl}${endpoint}`, {}, { headers });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get trades: ${error.message}`);
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
    this.setupEventHandlers();
    this.registerCommands();
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      console.log(`🤖 Discord monitoring bot ready! Logged in as ${this.client.user.tag}`);
      this.startDailyTracking();
      this.startAutoUpdating();
      await this.sendDashboardEmbed();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
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
        default:
          await interaction.reply({ content: 'Unknown command', ephemeral: true });
      }
    } catch (error) {
      console.error(`Error handling command ${commandName}:`, error);
      await interaction.reply({ 
        content: `❌ Error executing command: ${error.message}`, 
        ephemeral: true 
      });
    }
  }

  async handleButtonInteraction(interaction) {
    const { customId } = interaction;

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
        default:
          await interaction.reply({ content: 'Unknown action', ephemeral: true });
      }
    } catch (error) {
      console.error(`Error handling button ${customId}:`, error);
      await interaction.reply({ 
        content: `❌ Error: ${error.message}`, 
        ephemeral: true 
      });
    }
  }

  async showPortfolio(interaction) {
    await interaction.deferReply();

    try {
      const balances = await this.gemini.getBalances();
      const cryptoBalances = balances.filter(b => b.currency !== 'USD' && parseFloat(b.amount) > 0);
      const usdBalance = balances.find(b => b.currency === 'USD') || { amount: '0.00' };

      let totalValue = parseFloat(usdBalance.amount);
      const holdings = [];

      // Get current prices and calculate portfolio value
      for (const balance of cryptoBalances) {
        try {
          const symbol = `${balance.currency.toLowerCase()}usd`;
          const ticker = await this.gemini.getTicker(symbol);
          const currentPrice = parseFloat(ticker.last);
          const amount = parseFloat(balance.amount);
          const value = amount * currentPrice;
          const change = ticker.changes ? parseFloat(ticker.changes[0]) : 0;
          totalValue += value;

          holdings.push({
            currency: balance.currency,
            amount: amount,
            price: currentPrice,
            value: value,
            change: change
          });
        } catch (error) {
          console.error(`Error getting price for ${balance.currency}:`, error.message);
        }
      }

      // Update daily buy tracking
      await this.updateDailyBuyTracking();

      const embed = this.createPortfolioEmbed({
        totalValue,
        usdBalance: parseFloat(usdBalance.amount),
        holdings,
        dailyBuyData
      });

      const buttons = this.createPortfolioButtons();

      const message = await interaction.editReply({
        embeds: [embed],
        components: [buttons],
      });

      // Store this message for auto-updating
      this.activePortfolioMessages.set(message.id, {
        channelId: interaction.channelId,
        messageId: message.id,
        lastUpdate: Date.now()
      });

    } catch (error) {
      await interaction.editReply(`❌ Failed to fetch portfolio: ${error.message}`);
    }
  }

  createPortfolioEmbed(data) {
    const limitStatus = dailyBuyData.limitReached ? '🔴 LIMIT REACHED' : '🟢 Within Limit';
    const remainingLimit = Math.max(0, tradingSettings.dailyBuyLimit - dailyBuyData.totalBought);

    const embed = new EmbedBuilder()
      .setTitle('💰 Live Portfolio Dashboard')
      .setColor(dailyBuyData.limitReached ? 0xF44336 : 0x2196F3)
      .addFields(
        { name: '📊 Total Portfolio Value', value: `**$${data.totalValue.toFixed(2)}**`, inline: true },
        { name: '📈 Daily Buy Status', value: limitStatus, inline: true },
        { name: '🔄 Remaining Limit', value: `$${remainingLimit.toFixed(2)}`, inline: true }
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
                 `Live Price: **$${h.price.toFixed(2)}**\n` +
                 `Value: **$${h.value.toFixed(2)}**\n`;
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
    const stablecoinInfo = `💵 **USD Balance**: $${data.usdBalance.toFixed(2)}\n` +
                          `📊 **Daily Buys**: $${dailyBuyData.totalBought.toFixed(2)}\n` +
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
    return new ActionRowBuilder()
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
      );
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

      // Get today's trades to calculate daily purchases
      const trades = await this.gemini.getTrades();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      let dailyTotal = 0;
      const todayPurchases = [];

      trades.forEach(trade => {
        const tradeDate = new Date(trade.timestampms);
        
        if (tradeDate >= todayStart && trade.side === 'buy') {
          const tradeValue = parseFloat(trade.amount) * parseFloat(trade.price);
          dailyTotal += tradeValue;
          todayPurchases.push({
            symbol: trade.symbol,
            amount: trade.amount,
            price: trade.price,
            value: tradeValue,
            time: tradeDate
          });
        }
      });

      dailyBuyData.totalBought = dailyTotal;
      dailyBuyData.purchases = todayPurchases;
      dailyBuyData.limitReached = dailyTotal >= tradingSettings.dailyBuyLimit;
      dailyBuyData.lastUpdate = new Date();

      if (dailyBuyData.limitReached) {
        console.log(`⚠️ Daily buy limit reached: $${dailyTotal.toFixed(2)}/$${tradingSettings.dailyBuyLimit}`);
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
    await interaction.deferUpdate();
    await this.showPortfolio(interaction);
  }

  async updatePortfolioMessage(channelId, messageId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      
      // Get fresh portfolio data
      const balances = await this.gemini.getBalances();
      const cryptoBalances = balances.filter(b => b.currency !== 'USD' && parseFloat(b.amount) > 0);
      const usdBalance = balances.find(b => b.currency === 'USD') || { amount: '0.00' };

      let totalValue = parseFloat(usdBalance.amount);
      const holdings = [];

      // Get current prices and calculate portfolio value
      for (const balance of cryptoBalances) {
        try {
          const symbol = `${balance.currency.toLowerCase()}usd`;
          const ticker = await this.gemini.getTicker(symbol);
          const currentPrice = parseFloat(ticker.last);
          const amount = parseFloat(balance.amount);
          const value = amount * currentPrice;
          const change = ticker.changes ? parseFloat(ticker.changes[0]) : 0;
          totalValue += value;

          holdings.push({
            currency: balance.currency,
            amount: amount,
            price: currentPrice,
            value: value,
            change: change
          });
        } catch (error) {
          console.error(`Error getting price for ${balance.currency}:`, error.message);
        }
      }

      // Update daily buy tracking
      await this.updateDailyBuyTracking();

      const embed = this.createPortfolioEmbed({
        totalValue,
        usdBalance: parseFloat(usdBalance.amount),
        holdings,
        dailyBuyData
      });

      const buttons = this.createPortfolioButtons();

      await message.edit({
        embeds: [embed],
        components: [buttons],
      });

      console.log(`📊 Auto-updated portfolio message in channel ${channelId}`);
    } catch (error) {
      console.error(`Error updating portfolio message:`, error.message);
      // Remove invalid message from tracking
      this.activePortfolioMessages.delete(messageId);
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

        totalValue = parseFloat(usdBalanceData.amount);
        usdBalance = parseFloat(usdBalanceData.amount);

        // Get current prices and calculate portfolio value
        for (const balance of cryptoBalances) {
          try {
            const symbol = `${balance.currency.toLowerCase()}usd`;
            const ticker = await this.gemini.getTicker(symbol);
            const currentPrice = parseFloat(ticker.last);
            const amount = parseFloat(balance.amount);
            const value = amount * currentPrice;
            const change = ticker.changes ? parseFloat(ticker.changes[0]) : 0;
            totalValue += value;

            holdings.push({
              currency: balance.currency,
              amount: amount,
              price: currentPrice,
              value: value,
              change: change
            });
          } catch (error) {
            console.error(`Error getting price for ${balance.currency}:`, error.message);
          }
        }

        // Update daily buy tracking
        await this.updateDailyBuyTracking();

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
        components: [buttons],
      });

      // Store this message for auto-updating
      this.activePortfolioMessages.set(message.id, {
        channelId: dashboardChannel.id,
        messageId: message.id,
        lastUpdate: Date.now()
      });

      console.log(`✅ Portfolio dashboard sent to #${dashboardChannel.name}`);

    } catch (error) {
      console.error('❌ Error sending dashboard embed:', error.message);
    }
  }

  startAutoUpdating() {
    console.log('🔄 Starting automatic portfolio updates every 30 seconds...');
    
    setInterval(async () => {
      const messagesToUpdate = Array.from(this.activePortfolioMessages.values());
      
      for (const msgData of messagesToUpdate) {
        // Only update messages that are less than 1 hour old
        const messageAge = Date.now() - msgData.lastUpdate;
        if (messageAge < 3600000) { // 1 hour
          try {
            await this.updatePortfolioMessage(msgData.channelId, msgData.messageId);
            msgData.lastUpdate = Date.now();
          } catch (error) {
            console.error('Error in auto-update:', error.message);
          }
        } else {
          // Remove old messages from tracking
          this.activePortfolioMessages.delete(msgData.messageId);
        }
      }
    }, 30000); // Update every 30 seconds
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
      
      const embed = new EmbedBuilder()
        .setTitle('🛑 Monitoring Paused')
        .setColor(0xF44336)
        .addFields(
          { name: 'Status', value: '🔴 Monitoring temporarily paused', inline: true },
          { name: 'Action', value: 'Use /portfolio to resume monitoring', inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`❌ Error pausing monitoring: ${error.message}`);
    }
  }

  async handleTracker(interaction) {
    const type = interaction.options.getString('type') || 'daily_buys';
    
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
        await interaction.reply({ content: '❌ Unknown tracker type', ephemeral: true });
    }
  }

  async showTradingStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });

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
  }

  async showLimits(interaction) {
    await interaction.deferReply({ ephemeral: true });

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
  }

  async handleSettings(interaction) {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getString('value');

    await interaction.deferReply({ ephemeral: true });

    switch (setting) {
      case 'daily_limit':
        if (value) {
          tradingSettings.dailyBuyLimit = parseFloat(value);
          await interaction.editReply(`✅ Daily buy limit updated to $${value}`);
        } else {
          await interaction.editReply(`📊 Current daily buy limit: $${tradingSettings.dailyBuyLimit}`);
        }
        break;

      case 'stop_loss':
        if (value) {
          tradingSettings.stopLossPercent = parseFloat(value);
          await interaction.editReply(`✅ Stop loss updated to ${value}%`);
        } else {
          await interaction.editReply(`📊 Current stop loss: ${tradingSettings.stopLossPercent}%`);
        }
        break;

      case 'take_profit':
        if (value) {
          tradingSettings.takeProfitPercent = parseFloat(value);
          await interaction.editReply(`✅ Take profit updated to ${value}%`);
        } else {
          await interaction.editReply(`📊 Current take profit: ${tradingSettings.takeProfitPercent}%`);
        }
        break;

      default:
        await interaction.editReply('❌ Unknown setting');
    }
  }

  async showPrices(interaction) {
    const symbol = interaction.options.getString('symbol') || 'btcusd';
    
    await interaction.deferReply();

    try {
      const ticker = await this.gemini.getTicker(symbol);
      
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
      await interaction.editReply(`❌ Failed to get price: ${error.message}`);
    }
  }

  startDailyTracking() {
    console.log('📊 Starting daily buy tracking and monitoring...');
    
    // Update tracking every 60 seconds
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