const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes } = require('discord.js');
const crypto = require('crypto');
const axios = require('axios');

// Discord Bot Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Gemini API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_SECRET = process.env.GEMINI_API_SECRET;
const GEMINI_BASE_URL = process.env.NODE_ENV === 'production' ? 'https://api.gemini.com' : 'https://api.sandbox.gemini.com';

// Trading Settings (stored in memory for now)
const tradingSettings = {
  dailyBuyLimit: 1000,
  stopLossPercent: 5,
  takeProfitPercent: 10,
  enableStopLoss: true,
  enableProfitTaking: true,
  enabledPairs: ['btcusd', 'ethusd'],
  isTrading: false
};

class GeminiAPI {
  constructor() {
    this.apiKey = GEMINI_API_KEY;
    this.apiSecret = GEMINI_API_SECRET;
    this.baseUrl = GEMINI_BASE_URL;
  }

  generateHeaders(endpoint, payload = {}) {
    const nonce = Date.now() * 1000;
    const payloadWithDefaults = {
      request: endpoint,
      nonce: nonce.toString(),
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
      'Content-Type': 'text/plain'
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
      
      const response = await axios.post(`${this.baseUrl}${endpoint}`, {}, { headers });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get balances: ${error.message}`);
    }
  }

  async placeOrder(orderRequest) {
    try {
      const endpoint = '/v1/order/new';
      const headers = this.generateHeaders(endpoint, orderRequest);
      
      const response = await axios.post(`${this.baseUrl}${endpoint}`, {}, { headers });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to place order: ${error.message}`);
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
}

class DiscordTradingBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.gemini = new GeminiAPI();
    this.setupEventHandlers();
    this.registerCommands();
  }

  setupEventHandlers() {
    this.client.once('ready', () => {
      console.log(`🤖 Discord bot ready! Logged in as ${this.client.user.tag}`);
      this.startPriceMonitoring();
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
        .setDescription('Display your crypto portfolio and trading status'),
      
      new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Configure trading settings')
        .addStringOption(option =>
          option.setName('setting')
            .setDescription('Setting to modify')
            .setRequired(true)
            .addChoices(
              { name: 'Daily Buy Limit', value: 'daily_limit' },
              { name: 'Stop Loss %', value: 'stop_loss' },
              { name: 'Take Profit %', value: 'take_profit' },
              { name: 'Toggle Trading', value: 'toggle_trading' }
            ))
        .addStringOption(option =>
          option.setName('value')
            .setDescription('New value for the setting')
            .setRequired(false)),

      new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Execute a trade')
        .addStringOption(option =>
          option.setName('pair')
            .setDescription('Trading pair (e.g., btcusd)')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('side')
            .setDescription('Buy or sell')
            .setRequired(true)
            .addChoices(
              { name: 'Buy', value: 'buy' },
              { name: 'Sell', value: 'sell' }
            ))
        .addNumberOption(option =>
          option.setName('amount')
            .setDescription('Amount to trade')
            .setRequired(true)),

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
        case 'settings':
          await this.handleSettings(interaction);
          break;
        case 'trade':
          await this.handleTrade(interaction);
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
        case 'toggle_trading':
          await this.toggleTrading(interaction);
          break;
        case 'view_orders':
          await this.showActiveOrders(interaction);
          break;
        case 'quick_buy_btc':
          await this.quickTrade(interaction, 'btcusd', 'buy', 0.001);
          break;
        case 'quick_sell_btc':
          await this.quickTrade(interaction, 'btcusd', 'sell', 0.001);
          break;
        case 'emergency_stop':
          await this.emergencyStop(interaction);
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
          totalValue += value;

          holdings.push({
            currency: balance.currency,
            amount: amount,
            price: currentPrice,
            value: value
          });
        } catch (error) {
          console.error(`Error getting price for ${balance.currency}:`, error.message);
        }
      }

      const embed = this.createPortfolioEmbed({
        totalValue,
        usdBalance: parseFloat(usdBalance.amount),
        holdings,
        isTrading: tradingSettings.isTrading
      });

      const buttons = this.createPortfolioButtons();

      await interaction.editReply({
        embeds: [embed],
        components: [buttons],
      });

    } catch (error) {
      await interaction.editReply(`❌ Failed to fetch portfolio: ${error.message}`);
    }
  }

  createPortfolioEmbed(data) {
    const embed = new EmbedBuilder()
      .setTitle('📊 Crypto Portfolio')
      .setColor(tradingSettings.isTrading ? 0x4CAF50 : 0xFF9800)
      .addFields(
        { name: '💰 Total Portfolio Value', value: `$${data.totalValue.toFixed(2)}`, inline: true },
        { name: '💵 USD Balance', value: `$${data.usdBalance.toFixed(2)}`, inline: true },
        { name: '🤖 Trading Status', value: tradingSettings.isTrading ? '🟢 Active' : '🔴 Inactive', inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Gemini Trading Bot' });

    // Add cryptocurrency holdings
    if (data.holdings.length > 0) {
      const holdingsText = data.holdings
        .map(h => `**${h.currency}**: ${h.amount.toFixed(8)} ($${h.value.toFixed(2)})`)
        .join('\n');
      
      embed.addFields({ name: '🏦 Cryptocurrency Holdings', value: holdingsText, inline: false });
    }

    // Add trading settings
    embed.addFields({
      name: '⚙️ Trading Settings',
      value: `**Daily Limit**: $${tradingSettings.dailyBuyLimit}
**Stop Loss**: ${tradingSettings.stopLossPercent}%
**Take Profit**: ${tradingSettings.takeProfitPercent}%
**Enabled Pairs**: ${tradingSettings.enabledPairs.join(', ').toUpperCase()}`,
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
          .setCustomId('toggle_trading')
          .setLabel(tradingSettings.isTrading ? 'Stop Trading' : 'Start Trading')
          .setStyle(tradingSettings.isTrading ? ButtonStyle.Danger : ButtonStyle.Success)
          .setEmoji('⚡'),
        new ButtonBuilder()
          .setCustomId('view_orders')
          .setLabel('Active Orders')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋'),
        new ButtonBuilder()
          .setCustomId('quick_buy_btc')
          .setLabel('Quick Buy BTC')
          .setStyle(ButtonStyle.Success)
          .setEmoji('⬆️'),
        new ButtonBuilder()
          .setCustomId('emergency_stop')
          .setLabel('Emergency Stop')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🛑')
      );
  }

  async refreshPortfolio(interaction) {
    await interaction.deferUpdate();
    await this.showPortfolio(interaction);
  }

  async toggleTrading(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    tradingSettings.isTrading = !tradingSettings.isTrading;
    
    const status = tradingSettings.isTrading ? 'activated' : 'deactivated';
    const emoji = tradingSettings.isTrading ? '🟢' : '🔴';
    
    await interaction.editReply(`${emoji} Trading has been ${status}!`);
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

  async quickTrade(interaction, symbol, side, amount) {
    await interaction.deferReply({ ephemeral: true });

    if (!tradingSettings.isTrading) {
      await interaction.editReply('❌ Trading is currently disabled. Enable it first.');
      return;
    }

    try {
      const order = await this.gemini.placeOrder({
        symbol: symbol,
        amount: amount.toString(),
        side: side,
        type: 'exchange market'
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Trade Executed')
        .setColor(0x4CAF50)
        .addFields(
          { name: 'Symbol', value: symbol.toUpperCase(), inline: true },
          { name: 'Side', value: side.toUpperCase(), inline: true },
          { name: 'Amount', value: amount.toString(), inline: true },
          { name: 'Order ID', value: order.order_id, inline: false }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`❌ Trade failed: ${error.message}`);
    }
  }

  async emergencyStop(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Stop all trading
      tradingSettings.isTrading = false;
      
      // Cancel all active orders
      const orders = await this.gemini.getActiveOrders();
      let cancelledCount = 0;

      for (const order of orders) {
        try {
          await this.gemini.cancelOrder(order.order_id);
          cancelledCount++;
        } catch (error) {
          console.error(`Failed to cancel order ${order.order_id}:`, error.message);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('🛑 Emergency Stop Activated')
        .setColor(0xF44336)
        .addFields(
          { name: 'Trading Status', value: '🔴 Stopped', inline: true },
          { name: 'Orders Cancelled', value: cancelledCount.toString(), inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`❌ Emergency stop failed: ${error.message}`);
    }
  }

  async handleSettings(interaction) {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getString('value');

    await interaction.deferReply({ ephemeral: true });

    switch (setting) {
      case 'daily_limit':
        if (value) {
          tradingSettings.dailyBuyLimit = parseFloat(value);
          await interaction.editReply(`✅ Daily buy limit set to $${value}`);
        } else {
          await interaction.editReply(`📊 Current daily buy limit: $${tradingSettings.dailyBuyLimit}`);
        }
        break;

      case 'stop_loss':
        if (value) {
          tradingSettings.stopLossPercent = parseFloat(value);
          await interaction.editReply(`✅ Stop loss set to ${value}%`);
        } else {
          await interaction.editReply(`📊 Current stop loss: ${tradingSettings.stopLossPercent}%`);
        }
        break;

      case 'take_profit':
        if (value) {
          tradingSettings.takeProfitPercent = parseFloat(value);
          await interaction.editReply(`✅ Take profit set to ${value}%`);
        } else {
          await interaction.editReply(`📊 Current take profit: ${tradingSettings.takeProfitPercent}%`);
        }
        break;

      case 'toggle_trading':
        tradingSettings.isTrading = !tradingSettings.isTrading;
        const status = tradingSettings.isTrading ? 'enabled' : 'disabled';
        await interaction.editReply(`⚡ Trading ${status}!`);
        break;

      default:
        await interaction.editReply('❌ Unknown setting');
    }
  }

  async handleTrade(interaction) {
    const pair = interaction.options.getString('pair');
    const side = interaction.options.getString('side');
    const amount = interaction.options.getNumber('amount');

    await interaction.deferReply();

    if (!tradingSettings.isTrading) {
      await interaction.editReply('❌ Trading is currently disabled.');
      return;
    }

    try {
      const order = await this.gemini.placeOrder({
        symbol: pair,
        amount: amount.toString(),
        side: side,
        type: 'exchange market'
      });

      const embed = new EmbedBuilder()
        .setTitle('📈 Trade Order Placed')
        .setColor(side === 'buy' ? 0x4CAF50 : 0xF44336)
        .addFields(
          { name: 'Pair', value: pair.toUpperCase(), inline: true },
          { name: 'Side', value: side.toUpperCase(), inline: true },
          { name: 'Amount', value: amount.toString(), inline: true },
          { name: 'Order ID', value: order.order_id, inline: false }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`❌ Trade failed: ${error.message}`);
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
          { name: 'Volume', value: `${ticker.volume[ticker.volume.BTC] || 'N/A'}`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply(`❌ Failed to get price: ${error.message}`);
    }
  }

  startPriceMonitoring() {
    console.log('📊 Starting price monitoring...');
    
    // Monitor prices every 30 seconds
    setInterval(async () => {
      if (!tradingSettings.isTrading) return;

      try {
        await this.checkStopLossAndTakeProfit();
      } catch (error) {
        console.error('Error in price monitoring:', error.message);
      }
    }, 30000);
  }

  async checkStopLossAndTakeProfit() {
    try {
      const balances = await this.gemini.getBalances();
      const cryptoBalances = balances.filter(b => b.currency !== 'USD' && parseFloat(b.amount) > 0);

      for (const balance of cryptoBalances) {
        const symbol = `${balance.currency.toLowerCase()}usd`;
        
        if (!tradingSettings.enabledPairs.includes(symbol)) continue;

        try {
          const ticker = await this.gemini.getTicker(symbol);
          const currentPrice = parseFloat(ticker.last);
          
          // Here you would implement your stop-loss and take-profit logic
          // This is a simplified example
          console.log(`Monitoring ${symbol}: $${currentPrice}`);
          
        } catch (error) {
          console.error(`Error monitoring ${symbol}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error in stop-loss/take-profit check:', error.message);
    }
  }

  async start() {
    try {
      await this.client.login(BOT_TOKEN);
      console.log('🚀 Discord trading bot started successfully!');
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
    }
  }
}

// Start the bot
const bot = new DiscordTradingBot();
bot.start();

module.exports = DiscordTradingBot;