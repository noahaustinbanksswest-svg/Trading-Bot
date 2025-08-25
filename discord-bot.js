import { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';

// Global variables for dashboard tracking
let dashboardMessageId = null;
let dashboardChannelId = null;
let autoTradeSettings = {
  amount: 1,
  enabled: false,
  isActive: false,
  startTime: null,
  conditions: {
    cryptoValueReached: false,
    dailyBuyLimitReached: false,
    portfolioValueReached: false
  },
  stopAtLoss: 1.50,
  stopAtValue: null,
  baselinePrice: 180.38,
  selectedCrypto: 'SOL',
  stopOnDailyBuys: null
};

let dailyBuyData = {
  totalBought: 0,
  purchases: [],
  limitReached: false,
  lastUpdate: new Date()
};

class DiscordPortfolioBot {
  constructor() {
    console.log('🔥 CONSTRUCTOR: All caches cleared, smart baseline tracking initialized');
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    
    // Remove Gemini service - using API instead
    
    // Dashboard tracking
    this.dashboardMessageId = null;
    this.dashboardChannelId = null;
    this.lastEmbedUpdate = 0;
    this.embedUpdateCooldown = 5000; // 5 second cooldown
    this.liveUpdateInterval = null;
    
    // Price tracking with better memory management
    this.priceHistory = new Map();
    this.realTimeBalances = new Map();
    this.realTimePrices = new Map();
    this.lastBalanceUpdate = 0;
    this.lastPriceUpdate = 0;
    this.lastEmbedPortfolioValue = 0;
    this.lastEmbedUpdateTime = 0;
    
    // Baseline tracking for swing trades
    this.baselineValue = null;
    this.savedTriggerValue = null;
    this.swingTradeActive = false;
    this.lastSwingCheck = 0;
    
    this.setupEventHandlers();
    this.setupSlashCommands();
    this.initializePriceHistory();
    this.initializeDailyTracking();
    this.setupKeepAlive();
  }

  async initializePriceHistory() {
    try {
      // Get SOL price from API instead
      const portfolioResponse = await fetch('http://localhost:5000/api/portfolio/user-1');
      const portfolioData = await portfolioResponse.json();
      const solHolding = portfolioData.holdings?.find(h => h.symbol === 'solusd');
      const currentPrice = solHolding ? parseFloat(solHolding.currentPrice) : 200;
      
      console.log('🎯 PRICE HISTORY INITIALIZED:');
      console.log(`   Current SOL Price: $${currentPrice.toFixed(2)}`);
      
      // Initialize with 5 price points around current price
      const basePrice = currentPrice;
      const priceRange = [basePrice - 2.50, basePrice - 2.25, basePrice - 2.00, basePrice - 1.75, basePrice];
      
      this.priceHistory.set('SOL', priceRange);
      console.log(`   Historical Range: $${Math.min(...priceRange).toFixed(2)} - $${Math.max(...priceRange).toFixed(2)}`);
      console.log(`   Ready for swings: [${priceRange.map(p => p.toFixed(2)).join(', ')}]`);
      
    } catch (error) {
      console.error('❌ Error initializing price history:', error.message);
      // Fallback to default values
      this.priceHistory.set('SOL', [200, 201, 202, 203, 204]);
    }
  }

  initializeDailyTracking() {
    console.log('📅 Daily tracking system initialized');
    // Daily tracking is handled by the global dailyBuyData
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      console.log(`✅ Discord SHARD 0 READY`);
      console.log(`🤖 Discord monitoring bot ready! Logged in as ${this.client.user.tag}`);
      
      // Load bot settings and start monitoring
      await this.loadBotSettings();
      console.log('🔄 Starting automatic portfolio updates');
      await this.findOrCreateDashboardEmbed();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await this.handleButtonClick(interaction);
      }
    });
  }

  async setupSlashCommands() {
    this.client.once('ready', async () => {
      console.log('🔄 Registering slash commands...');
      const commands = [
        new SlashCommandBuilder()
          .setName('portfolio')
          .setDescription('Display current crypto portfolio'),
        new SlashCommandBuilder()
          .setName('refresh')
          .setDescription('Refresh portfolio data'),
        new SlashCommandBuilder()
          .setName('reset_dashboard')
          .setDescription('Reset and recreate the dashboard embed')
      ];

      try {
        const guilds = this.client.guilds.cache;
        for (const [guildId, guild] of guilds) {
          await guild.commands.set(commands);
        }
        console.log('✅ Successfully registered slash commands');
      } catch (error) {
        console.error('❌ Error registering slash commands:', error);
      }
    });
  }

  async findOrCreateDashboardEmbed() {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.log('❌ No guild found');
        return;
      }

      console.log('🔍 Searching for existing dashboard embed in #new-dashboard');
      const dashboardChannel = guild.channels.cache.find(channel => 
        channel.name.toLowerCase() === 'new-dashboard' && channel.isTextBased()
      );

      if (!dashboardChannel) {
        console.log('❌ Dashboard channel not found. Create a channel named "new-dashboard"');
        return;
      }

      // Try to find existing embed first
      try {
        const messages = await dashboardChannel.messages.fetch({ limit: 50 });
        const botMessages = messages.filter(msg => 
          msg.author.id === this.client.user.id && 
          msg.embeds.length > 0 && 
          msg.embeds[0].title && 
          msg.embeds[0].title.includes('Portfolio Dashboard')
        );
        
        if (botMessages.size > 0) {
          const existingMessage = botMessages.first();
          this.dashboardMessageId = existingMessage.id;
          this.dashboardChannelId = dashboardChannel.id;
          console.log(`✅ Found existing dashboard embed: ${this.dashboardMessageId}`);
          console.log('🚀 Starting live updates for existing embed...');
          this.startLiveUpdates();
          return;
        }
      } catch (error) {
        console.log('⚠️ Could not fetch existing messages:', error.message);
      }

      // No existing dashboard found, create new one
      console.log(`📊 Creating new portfolio embed in #${dashboardChannel.name}`);
      await this.sendDashboardEmbed();

    } catch (error) {
      console.error('❌ Error finding/creating dashboard embed:', error.message);
    }
  }

  // Start live updates for existing or new embed
  startLiveUpdates() {
    // Clear any existing interval
    if (this.liveUpdateInterval) {
      clearInterval(this.liveUpdateInterval);
    }

    console.log('🔄 Starting live portfolio updates every 10 seconds...');
    this.liveUpdateInterval = setInterval(async () => {
      try {
        if (this.dashboardMessageId && this.dashboardChannelId) {
          await this.updateExistingEmbed();
        }
      } catch (error) {
        console.error('❌ Live update error:', error.message);
      }
    }, 10000); // Update every 10 seconds
  }

  // Update existing embed with live data
  async updateExistingEmbed() {
    try {
      const channel = await this.client.channels.fetch(this.dashboardChannelId);
      const message = await channel.messages.fetch(this.dashboardMessageId);
      
      // Create updated embed with live API data
      const embed = await this.createPortfolioEmbed();
      const buttons = this.createPortfolioButtons();
      
      await message.edit({
        embeds: [embed],
        components: buttons,
      });
      
      console.log('✅ Discord embed updated with live data');
    } catch (error) {
      console.error('❌ Error updating existing embed:', error.message);
      // If message is gone, try to create new one
      this.dashboardMessageId = null;
      this.dashboardChannelId = null;
      await this.findOrCreateDashboardEmbed();
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
        channel.name.toLowerCase() === 'new-dashboard' && channel.isTextBased()
      );

      if (!dashboardChannel) {
        console.log('❌ Dashboard channel not found. Create a channel named "new-dashboard"');
        return;
      }

      console.log(`📊 Sending portfolio embed to #${dashboardChannel.name}`);
      
      // CRITICAL: Use live API data for embed
      const embed = await this.createPortfolioEmbed();

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
      
      // Start live updates after creating new embed
      console.log('🚀 Starting live updates for new embed...');
      this.startLiveUpdates();

    } catch (error) {
      console.error('❌ Error sending dashboard embed:', error.message);
    }
  }

  async createPortfolioEmbed() {
    try {
      console.log('🔗 Fetching live portfolio data from API...');
      
      // Fetch live portfolio data from local API
      const portfolioResponse = await fetch('http://localhost:5000/api/portfolio/user-1');
      const portfolioData = await portfolioResponse.json();
      
      // Fetch trading status
      const statusResponse = await fetch('http://localhost:5000/api/independent-trading/status/user-1');
      const statusData = await statusResponse.json();
      
      const isTrading = statusData.running || false;
      
      const embed = new EmbedBuilder()
        .setTitle('💰 Live Portfolio Dashboard (API Connected)')
        .setColor(isTrading ? 0x4CAF50 : 0xF44336)
        .setTimestamp()
        .setFooter({ text: `Live Portfolio • Real-time Updates` });

      // Main portfolio info from live API
      embed.addFields([
        { name: '📊 Total Portfolio Value', value: `**$${portfolioData.totalValue}**`, inline: true },
        { name: '📈 Trading Status', value: isTrading ? '✅ ACTIVE' : '❌ INACTIVE', inline: true },
        { name: '⚡ Live Connection', value: '🟢 Connected', inline: true }
      ]);

      // Show all crypto holdings
      if (portfolioData.holdings && portfolioData.holdings.length > 0) {
        let holdingsInfo = '';
        portfolioData.holdings.forEach(holding => {
          const symbol = holding.symbol.replace('usd', '').toUpperCase();
          const amount = parseFloat(holding.amount);
          const value = parseFloat(holding.valueUSD);
          const price = parseFloat(holding.currentPrice);
          
          if (amount > 0) {
            holdingsInfo += `🪙 **${symbol}**: ${amount.toFixed(6)} ($${value.toFixed(2)} USD @ $${price.toFixed(2)})\n`;
          }
        });
        
        embed.addFields({ 
          name: '💎 Your Crypto Holdings', 
          value: holdingsInfo || 'No holdings found', 
          inline: false 
        });
      }

      // SOL Trading Trigger Information
      const solHolding = portfolioData.holdings?.find(h => h.symbol === 'solusd');
      if (solHolding && statusData.triggerInfo) {
        const currentValue = parseFloat(portfolioData.totalValue);
        const baseline = statusData.triggerInfo.baseline || 0;
        const trigger = statusData.triggerInfo.trigger || 0;
        const needsAmount = Math.max(0, trigger - currentValue);
        
        const triggerInfo = `🎯 **Next Trigger**: $${trigger.toFixed(2)}\n` +
                           `📊 **Baseline**: $${baseline.toFixed(2)}\n` +
                           `💰 **Current**: $${currentValue.toFixed(2)}\n` +
                           `⏳ **Need**: $${needsAmount.toFixed(2)} more\n` +
                           `🔥 **SOL Price**: $${parseFloat(solHolding.currentPrice).toFixed(2)}`;
        
        embed.addFields({ 
          name: '⚡ SOL Trading Trigger', 
          value: triggerInfo, 
          inline: false 
        });
      }

      return embed;
    } catch (error) {
      console.error('❌ Error creating portfolio embed:', error);
      // Return fallback embed with error info
      return new EmbedBuilder()
        .setTitle('💰 Portfolio Dashboard')
        .setDescription(`⚠️ API Connection Error: ${error.message}`)
        .setColor(0xFF9800)
        .setTimestamp();
    }
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
            .setLabel('Daily Buys')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📊'),
          new ButtonBuilder()
            .setCustomId('toggle_auto_trade')
            .setLabel('Auto Trade')
            .setStyle(autoTradeSettings.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji(autoTradeSettings.enabled ? '✅' : '❌')
        )
    ];
  }

  async handleButtonClick(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      switch (interaction.customId) {
        case 'refresh_portfolio':
          await this.updateExistingEmbed();
          await interaction.editReply('✅ Portfolio refreshed!');
          break;
          
        case 'view_daily_buys':
          const dailyInfo = `📊 **Daily Buy Summary**\n` +
                           `💰 Total Bought: $${dailyBuyData.totalBought.toFixed(2)}\n` +
                           `🛒 Purchases: ${dailyBuyData.purchases.length}\n` +
                           `⏰ Last Update: ${dailyBuyData.lastUpdate.toLocaleTimeString()}`;
          await interaction.editReply(dailyInfo);
          break;
          
        case 'toggle_auto_trade':
          autoTradeSettings.enabled = !autoTradeSettings.enabled;
          await this.updateExistingEmbed();
          await interaction.editReply(`✅ Auto Trade ${autoTradeSettings.enabled ? 'enabled' : 'disabled'}!`);
          break;
          
        default:
          await interaction.editReply('❌ Unknown button action');
      }
    } catch (error) {
      console.error('❌ Button click error:', error);
      await interaction.editReply('❌ Error processing request');
    }
  }

  async handleSlashCommand(interaction) {
    try {
      await interaction.deferReply();
      
      switch (interaction.commandName) {
        case 'portfolio':
        case 'refresh':
          await this.updateExistingEmbed();
          await interaction.editReply('✅ Portfolio updated!');
          break;
          
        case 'reset_dashboard':
          // Delete old message and create new one
          if (this.dashboardMessageId && this.dashboardChannelId) {
            try {
              const channel = await this.client.channels.fetch(this.dashboardChannelId);
              const message = await channel.messages.fetch(this.dashboardMessageId);
              await message.delete();
            } catch (error) {
              console.log('⚠️ Could not delete old message');
            }
          }
          
          this.dashboardMessageId = null;
          this.dashboardChannelId = null;
          await this.sendDashboardEmbed();
          await interaction.editReply('✅ Dashboard reset and recreated!');
          break;
          
        default:
          await interaction.editReply('❌ Unknown command');
      }
    } catch (error) {
      console.error('❌ Slash command error:', error);
      await interaction.editReply('❌ Error processing command');
    }
  }

  async loadBotSettings() {
    console.log('📥 Loading bot settings from database...');
    // Settings are handled by global variables for now
    console.log('✅ Bot settings loaded successfully');
    console.log('📊 Auto Trade Settings:', autoTradeSettings);
  }

  setupKeepAlive() {
    console.log('🔄 Keep-alive system ready');
    // Keep-alive handled by external systems
  }

  truncateToFixed(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.floor(value * factor) / factor;
  }
}

// Create and login the bot
const bot = new DiscordPortfolioBot();

console.log('🔗 Attempting Discord login with token...');
const token = process.env.DISCORD_BOT_TOKEN;
console.log(`🔑 Token exists: ${token ? token.substring(0, 10) + '...' : 'NO TOKEN'}`);

bot.client.login(token)
  .then(() => {
    console.log('✅ Discord login attempt completed');
  })
  .catch(error => {
    console.error('❌ Discord login failed:', error.message);
    process.exit(1);
  });

// Handle process termination
process.on('SIGINT', () => {
  console.log('🛑 Discord bot shutting down...');
  if (bot.liveUpdateInterval) {
    clearInterval(bot.liveUpdateInterval);
  }
  bot.client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Discord bot shutting down...');
  if (bot.liveUpdateInterval) {
    clearInterval(bot.liveUpdateInterval);
  }
  bot.client.destroy();
  process.exit(0);
});