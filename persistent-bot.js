import { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

console.log('🔥 PERSISTENT DISCORD BOT - BULLETPROOF VERSION');

class PersistentBot {
  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    });
    
    this.dashboardMessageId = null;
    this.dashboardChannelId = null;
    this.updateInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 999;
    
    this.setupEventHandlers();
    this.login();
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      console.log(`✅ PERSISTENT Bot Online: ${this.client.user.tag}`);
      console.log('🔍 Finding Discord embed...');
      await this.findAndUpdateEmbed();
      this.startContinuousUpdates();
      this.reconnectAttempts = 0; // Reset on successful connection
    });

    // Handle disconnections
    this.client.on('disconnect', () => {
      console.log('⚠️ Discord disconnected - reconnecting...');
      this.reconnect();
    });

    this.client.on('error', (error) => {
      console.error('❌ Discord error:', error.message);
      this.reconnect();
    });

    // Handle button interactions
    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isButton() && interaction.customId === 'refresh_portfolio') {
        try {
          await interaction.deferReply({ ephemeral: true });
          await this.updateDiscordEmbed();
          await interaction.editReply('✅ Portfolio refreshed!');
        } catch (error) {
          console.error('❌ Button error:', error);
        }
      }
    });
  }

  async findAndUpdateEmbed() {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.log('❌ No guild found');
        return false;
      }

      const channel = guild.channels.cache.find(c => 
        c.name === 'new-dashboard' && c.isTextBased()
      );
      
      if (!channel) {
        console.log('❌ No #new-dashboard channel found');
        return false;
      }

      console.log('🔍 Looking for existing bot message...');
      const messages = await channel.messages.fetch({ limit: 50 });
      const existingMessage = messages.find(msg => 
        msg.author.id === this.client.user.id && 
        msg.embeds.length > 0 &&
        msg.embeds[0].title && 
        msg.embeds[0].title.includes('Portfolio Dashboard')
      );

      if (existingMessage) {
        this.dashboardMessageId = existingMessage.id;
        this.dashboardChannelId = channel.id;
        console.log(`✅ Found existing message: ${this.dashboardMessageId}`);
        
        // Update it immediately
        await this.updateDiscordEmbed();
        return true;
      } else {
        console.log('📊 Creating new Discord message...');
        await this.createNewDiscordMessage(channel);
        return true;
      }
    } catch (error) {
      console.error('❌ Error finding embed:', error);
      return false;
    }
  }

  async createNewDiscordMessage(channel) {
    try {
      const embed = await this.createLiveEmbed();
      const buttons = this.createButtons();
      
      const message = await channel.send({
        embeds: [embed],
        components: buttons
      });
      
      this.dashboardMessageId = message.id;
      this.dashboardChannelId = channel.id;
      console.log(`✅ New Discord message created: ${message.id}`);
      
      // Update immediately after creating
      setTimeout(() => this.updateDiscordEmbed(), 2000);
    } catch (error) {
      console.error('❌ Error creating message:', error);
    }
  }

  async updateDiscordEmbed() {
    if (!this.dashboardMessageId || !this.dashboardChannelId) {
      console.log('⚠️ No message to update - finding embed...');
      await this.findAndUpdateEmbed();
      return;
    }
    
    try {
      const channel = await this.client.channels.fetch(this.dashboardChannelId);
      const message = await channel.messages.fetch(this.dashboardMessageId);
      
      const embed = await this.createLiveEmbed();
      const buttons = this.createButtons();
      
      await message.edit({
        embeds: [embed],
        components: buttons
      });
      
      console.log(`✅ [${new Date().toLocaleTimeString()}] Discord embed updated successfully`);
    } catch (error) {
      console.error('❌ Update failed:', error.message);
      // Try to find the embed again
      this.dashboardMessageId = null;
      this.dashboardChannelId = null;
      setTimeout(() => this.findAndUpdateEmbed(), 3000);
    }
  }

  async createLiveEmbed() {
    try {
      // Fetch live data from your API
      const [portfolioRes, statusRes] = await Promise.all([
        fetch('http://localhost:5000/api/portfolio/user-1'),
        fetch('http://localhost:5000/api/independent-trading/status/user-1')
      ]);
      
      const portfolioData = await portfolioRes.json();
      const statusData = await statusRes.json();
      
      const isTrading = statusData.running || false;
      const totalValue = parseFloat(portfolioData.totalValue) || 0;
      
      // Create the embed with live data
      const embed = new EmbedBuilder()
        .setTitle('💰 Live Portfolio Dashboard (API Connected)')
        .setColor(isTrading ? 0x4CAF50 : 0xF44336)
        .setTimestamp()
        .setFooter({ text: `Live Portfolio • Real-time Updates • ${new Date().toLocaleTimeString()}` });

      // Main portfolio stats
      embed.addFields([
        { name: '📊 Total Portfolio Value', value: `**$${totalValue.toFixed(2)}**`, inline: true },
        { name: '📈 Trading Status', value: isTrading ? '✅ ACTIVE' : '❌ INACTIVE', inline: true },
        { name: '⚡ Live Connection', value: '🟢 Connected', inline: true }
      ]);

      // Crypto holdings
      if (portfolioData.holdings && portfolioData.holdings.length > 0) {
        let holdingsText = '';
        portfolioData.holdings.forEach(holding => {
          const symbol = holding.symbol.replace('usd', '').toUpperCase();
          const amount = parseFloat(holding.amount);
          const value = parseFloat(holding.valueUSD);
          const price = parseFloat(holding.currentPrice);
          
          if (amount > 0) {
            holdingsText += `🪙 **${symbol}**: ${amount.toFixed(6)} ($${value.toFixed(2)} USD @ $${price.toFixed(2)})\n`;
          }
        });
        
        embed.addFields({ 
          name: '💎 Your Crypto Holdings', 
          value: holdingsText || 'No holdings found', 
          inline: false 
        });
      }

      // Trading trigger section - SEPARATE as requested
      if (statusData.triggerInfo) {
        const baseline = statusData.triggerInfo.baseline || 0;
        const trigger = statusData.triggerInfo.trigger || 0;
        const needed = Math.max(0, trigger - totalValue);
        
        const solHolding = portfolioData.holdings?.find(h => h.symbol === 'solusd');
        const solPrice = solHolding ? parseFloat(solHolding.currentPrice) : 0;
        
        const triggerText = `🎯 **Next Trigger**: $${trigger.toFixed(2)}\n` +
                           `📊 **Baseline**: $${baseline.toFixed(2)}\n` +
                           `💰 **Current**: $${totalValue.toFixed(2)}\n` +
                           `⏳ **Need**: $${needed.toFixed(2)} more\n` +
                           `🔥 **SOL Price**: $${solPrice.toFixed(2)}`;
        
        embed.addFields({ 
          name: '⚡ SOL Trading Trigger', 
          value: triggerText, 
          inline: false 
        });
      }

      return embed;
      
    } catch (error) {
      console.error('❌ Error creating embed:', error);
      return new EmbedBuilder()
        .setTitle('💰 Portfolio Dashboard')
        .setDescription(`⚠️ Connection Error - Retrying...`)
        .setColor(0xFF9800)
        .setTimestamp();
    }
  }

  createButtons() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('refresh_portfolio')
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔄')
      )
    ];
  }

  startContinuousUpdates() {
    // Clear any existing interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    console.log('🔄 Starting continuous Discord updates every 30 seconds...');
    this.updateInterval = setInterval(async () => {
      if (this.client.isReady()) {
        await this.updateDiscordEmbed();
      } else {
        console.log('⚠️ Client not ready - skipping update');
      }
    }, 30000); // Every 30 seconds
  }

  async login() {
    try {
      const token = 'MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4';
      console.log('🔗 Connecting to Discord...');
      await this.client.login(token);
      console.log('✅ Login successful');
    } catch (error) {
      console.error('❌ Login failed:', error.message);
      this.reconnect();
    }
  }

  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectAttempts * 5000, 30000); // Max 30 second delay
    
    console.log(`🔄 Reconnecting in ${delay/1000} seconds... (Attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.client.isReady()) {
        console.log('✅ Client already ready');
        return;
      }
      
      this.client.destroy();
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
      });
      this.setupEventHandlers();
      this.login();
    }, delay);
  }

  shutdown() {
    console.log('🛑 Shutting down persistent bot...');
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.client.destroy();
  }
}

// Create the bot
const bot = new PersistentBot();

// Handle termination
process.on('SIGINT', () => {
  bot.shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.shutdown();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
});

console.log('🛡️ PERSISTENT Discord Bot Starting...');
console.log('🔄 Will update Discord every 30 seconds');
console.log('🚀 Bulletproof reconnection enabled');