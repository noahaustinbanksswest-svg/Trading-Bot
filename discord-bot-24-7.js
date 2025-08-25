import { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

class PersistentDiscordBot {
  constructor() {
    console.log('🚀 Starting 24/7 Discord Trading Bot...');
    
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds] // Works with your current bot permissions
    });
    
    this.dashboardMessageId = null;
    this.dashboardChannelId = null;
    this.updateInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    
    this.setupEventHandlers();
    this.startBot();
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      console.log(`✅ Bot online as ${this.client.user.tag}`);
      console.log('🔍 Finding existing dashboard embed...');
      await this.findExistingEmbed();
      this.startLiveUpdates();
      this.reconnectAttempts = 0; // Reset on successful connection
    });

    this.client.on('error', (error) => {
      console.error('❌ Discord error:', error.message);
      this.handleReconnection();
    });

    this.client.on('disconnect', () => {
      console.log('🔌 Discord disconnected');
      this.handleReconnection();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;
      
      try {
        await interaction.deferReply({ ephemeral: true });
        
        if (interaction.customId === 'refresh_portfolio') {
          await this.updateDashboard();
          await interaction.editReply('✅ Portfolio refreshed!');
        }
      } catch (error) {
        console.error('❌ Button interaction error:', error);
      }
    });
  }

  async findExistingEmbed() {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) return;

      const channel = guild.channels.cache.find(c => 
        c.name.toLowerCase() === 'new-dashboard' && c.isTextBased()
      );
      
      if (!channel) {
        console.log('❌ No #new-dashboard channel found');
        return;
      }

      // Find existing bot messages
      const messages = await channel.messages.fetch({ limit: 50 });
      const existingEmbed = messages.find(msg => 
        msg.author.id === this.client.user.id && 
        msg.embeds.length > 0 && 
        msg.embeds[0].title?.includes('Portfolio Dashboard')
      );

      if (existingEmbed) {
        this.dashboardMessageId = existingEmbed.id;
        this.dashboardChannelId = channel.id;
        console.log(`✅ Found existing embed: ${this.dashboardMessageId}`);
        await this.updateDashboard();
      } else {
        console.log('📊 Creating new dashboard embed...');
        await this.createNewEmbed(channel);
      }
    } catch (error) {
      console.error('❌ Error finding embed:', error.message);
    }
  }

  async createNewEmbed(channel) {
    try {
      const embed = await this.createEmbed();
      const buttons = this.createButtons();
      
      const message = await channel.send({
        embeds: [embed],
        components: buttons
      });
      
      this.dashboardMessageId = message.id;
      this.dashboardChannelId = channel.id;
      console.log(`✅ New embed created: ${message.id}`);
    } catch (error) {
      console.error('❌ Error creating embed:', error.message);
    }
  }

  async updateDashboard() {
    if (!this.dashboardMessageId || !this.dashboardChannelId) return;
    
    try {
      const channel = await this.client.channels.fetch(this.dashboardChannelId);
      const message = await channel.messages.fetch(this.dashboardMessageId);
      
      const embed = await this.createEmbed();
      const buttons = this.createButtons();
      
      await message.edit({
        embeds: [embed],
        components: buttons
      });
      
      console.log('✅ Dashboard updated');
    } catch (error) {
      console.error('❌ Update error:', error.message);
      // If message is gone, find/create new one
      await this.findExistingEmbed();
    }
  }

  async createEmbed() {
    try {
      // Fetch live data from your API
      const portfolioRes = await fetch('http://localhost:5000/api/portfolio/user-1');
      const portfolio = await portfolioRes.json();
      
      const statusRes = await fetch('http://localhost:5000/api/independent-trading/status/user-1');
      const status = await statusRes.json();
      
      const isActive = status.running || false;
      const totalValue = parseFloat(portfolio.totalValue);
      
      const embed = new EmbedBuilder()
        .setTitle('💰 Live Trading Portfolio')
        .setColor(isActive ? 0x00FF00 : 0xFF0000)
        .setTimestamp()
        .setFooter({ text: 'Live Updates • 24/7 Trading Bot' });

      // Portfolio summary
      embed.addFields([
        { name: '📊 Total Value', value: `**$${totalValue.toFixed(2)}**`, inline: true },
        { name: '📈 Status', value: isActive ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },
        { name: '⚡ Connection', value: '🟢 LIVE', inline: true }
      ]);

      // Crypto holdings
      if (portfolio.holdings?.length > 0) {
        let holdings = '';
        portfolio.holdings.forEach(h => {
          const symbol = h.symbol.replace('usd', '').toUpperCase();
          const amount = parseFloat(h.amount);
          const value = parseFloat(h.valueUSD);
          const price = parseFloat(h.currentPrice);
          
          if (amount > 0) {
            holdings += `🪙 **${symbol}**: ${amount.toFixed(6)}\n`;
            holdings += `💰 $${value.toFixed(2)} @ $${price.toFixed(2)}\n\n`;
          }
        });
        
        embed.addFields([
          { name: '💎 Holdings', value: holdings || 'No holdings', inline: false }
        ]);
      }

      // Trading trigger info
      if (status.triggerInfo) {
        const baseline = status.triggerInfo.baseline || 0;
        const trigger = status.triggerInfo.trigger || 0;
        const needed = Math.max(0, trigger - totalValue);
        
        const triggerText = `🎯 **Next Trigger**: $${trigger.toFixed(2)}\n` +
                           `📊 **Baseline**: $${baseline.toFixed(2)}\n` +
                           `⏳ **Need**: $${needed.toFixed(2)} more`;
        
        embed.addFields([
          { name: '🔥 Trading Trigger', value: triggerText, inline: false }
        ]);
      }

      return embed;
      
    } catch (error) {
      console.error('❌ Embed creation error:', error);
      return new EmbedBuilder()
        .setTitle('💰 Trading Portfolio')
        .setDescription('⚠️ Connection Error - Retrying...')
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

  startLiveUpdates() {
    // Clear any existing interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    console.log('🔄 Starting live updates every 30 seconds...');
    this.updateInterval = setInterval(async () => {
      await this.updateDashboard();
    }, 30000); // Update every 30 seconds
  }

  async handleReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max reconnection attempts reached. Stopping...');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectAttempts * 5000, 30000); // Max 30s delay
    
    console.log(`🔄 Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.startBot();
    }, delay);
  }

  async startBot() {
    try {
      const token = process.env.DISCORD_BOT_TOKEN;
      if (!token) {
        console.log('❌ No Discord token found');
        return;
      }
      
      console.log('🔗 Connecting to Discord...');
      await this.client.login(token);
      
    } catch (error) {
      console.error('❌ Login failed:', error.message);
      this.handleReconnection();
    }
  }

  // Graceful shutdown
  shutdown() {
    console.log('🛑 Shutting down bot...');
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.client.destroy();
  }
}

// Create and start the bot
const bot = new PersistentDiscordBot();

// Handle process termination gracefully
process.on('SIGINT', () => bot.shutdown());
process.on('SIGTERM', () => bot.shutdown());

// Keep process alive
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});

console.log('🚀 24/7 Discord Trading Bot Started');
console.log('📊 Monitoring your live portfolio...');
console.log('🔄 Auto-updates every 30 seconds');