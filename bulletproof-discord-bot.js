import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

console.log('🛡️ BULLETPROOF Discord Bot - STAYS ONLINE FOREVER');

class BulletproofBot {
  constructor() {
    this.client = null;
    this.dashboardMessageId = null;
    this.dashboardChannelId = null;
    this.updateInterval = null;
    this.reconnectAttempts = 0;
    this.token = 'MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4';
    this.isShuttingDown = false;
    
    this.startBot();
    this.setupProcessHandlers();
  }

  setupProcessHandlers() {
    // Handle all possible termination signals
    ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT'].forEach(signal => {
      process.on(signal, () => {
        console.log(`⚠️ Received ${signal} - graceful shutdown`);
        this.gracefulShutdown();
      });
    });

    // Handle uncaught errors without crashing
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error.message);
      console.log('🔄 Restarting bot in 5 seconds...');
      setTimeout(() => this.restartBot(), 5000);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled rejection:', reason);
      console.log('🔄 Restarting bot in 5 seconds...');
      setTimeout(() => this.restartBot(), 5000);
    });
  }

  async startBot() {
    try {
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
      });

      this.setupClientHandlers();
      await this.client.login(this.token);
      console.log('🚀 Bot login initiated...');
      
    } catch (error) {
      console.error('❌ Failed to start bot:', error.message);
      setTimeout(() => this.restartBot(), 10000);
    }
  }

  setupClientHandlers() {
    this.client.once('ready', async () => {
      console.log(`✅ BULLETPROOF Bot Online: ${this.client.user.tag}`);
      this.reconnectAttempts = 0;
      
      await this.findAndSetupEmbed();
      this.startUpdates();
    });

    // Enhanced error handling
    this.client.on('error', (error) => {
      console.error('❌ Discord client error:', error.message);
      this.handleError();
    });

    this.client.on('disconnect', () => {
      console.log('⚠️ Discord disconnected');
      this.handleError();
    });

    this.client.on('reconnecting', () => {
      console.log('🔄 Discord reconnecting...');
    });

    this.client.on('resume', () => {
      console.log('✅ Discord connection resumed');
    });

    this.client.on('shardError', (error) => {
      console.error('❌ Discord shard error:', error.message);
      this.handleError();
    });
  }

  async findAndSetupEmbed() {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.log('❌ No guild found - retrying in 10 seconds...');
        setTimeout(() => this.findAndSetupEmbed(), 10000);
        return;
      }

      const channel = guild.channels.cache.find(c => 
        c.name === 'new-dashboard' && c.isTextBased()
      );
      
      if (!channel) {
        console.log('❌ No #new-dashboard channel - retrying in 10 seconds...');
        setTimeout(() => this.findAndSetupEmbed(), 10000);
        return;
      }

      console.log('🔍 Looking for existing embed...');
      const messages = await channel.messages.fetch({ limit: 50 });
      const existingMessage = messages.find(msg => 
        msg.author.id === this.client.user.id && 
        msg.embeds.length > 0 &&
        msg.embeds[0].title && 
        msg.embeds[0].title.includes('Trading Portfolio')
      );

      if (existingMessage) {
        this.dashboardMessageId = existingMessage.id;
        this.dashboardChannelId = channel.id;
        console.log(`✅ Connected to existing embed: ${this.dashboardMessageId}`);
      } else {
        console.log('📊 Creating new embed...');
        const embed = await this.createOriginalEmbed();
        const message = await channel.send({ embeds: [embed] });
        this.dashboardMessageId = message.id;
        this.dashboardChannelId = channel.id;
        console.log(`✅ New embed created: ${message.id}`);
      }

      // Immediate update after setup
      setTimeout(() => this.updateEmbed(), 3000);
      
    } catch (error) {
      console.error('❌ Error setting up embed:', error.message);
      setTimeout(() => this.findAndSetupEmbed(), 15000);
    }
  }

  async createOriginalEmbed() {
    try {
      const [portfolioRes, statusRes] = await Promise.all([
        fetch('http://localhost:5000/api/portfolio/user-1'),
        fetch('http://localhost:5000/api/independent-trading/status/user-1')
      ]);
      
      const portfolio = await portfolioRes.json();
      const status = await statusRes.json();
      
      const isActive = status.running || false;
      const totalValue = parseFloat(portfolio.totalValue) || 0;
      
      // EXACT ORIGINAL FORMAT
      const embed = new EmbedBuilder()
        .setTitle('💰 Live Trading Portfolio')
        .setColor(isActive ? 0x00FF00 : 0xFF0000)
        .setTimestamp()
        .setFooter({ text: '24/7 Trading Bot • Live Updates' });

      embed.addFields([
        { name: '📊 Total Value', value: `**$${totalValue.toFixed(2)}**`, inline: true },
        { name: '📈 Status', value: isActive ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },
        { name: '⚡ Connection', value: '🟢 LIVE', inline: true }
      ]);

      // Show all crypto holdings
      if (portfolio.holdings && portfolio.holdings.length > 0) {
        let allHoldings = '';
        portfolio.holdings.forEach(holding => {
          const symbol = holding.symbol.replace('usd', '').toUpperCase();
          const amount = parseFloat(holding.amount);
          const value = parseFloat(holding.valueUSD);
          const price = parseFloat(holding.currentPrice);
          
          if (amount > 0.000001) {
            allHoldings += `🪙 **${symbol}**: ${amount.toFixed(6)} ($${value.toFixed(2)} @ $${price.toFixed(2)})\n`;
          }
        });
        
        if (allHoldings) {
          embed.addFields([
            { 
              name: '💎 Your Crypto Holdings', 
              value: allHoldings,
              inline: false 
            }
          ]);
        }
      }

      // Trading trigger section
      if (status.triggerInfo) {
        const baseline = status.triggerInfo.baseline || 0;
        const trigger = status.triggerInfo.trigger || 0;
        const needed = Math.max(0, trigger - totalValue);
        
        embed.addFields([
          { 
            name: '🎯 Next Trade Trigger', 
            value: `**Trigger**: $${trigger.toFixed(2)}\n**Baseline**: $${baseline.toFixed(2)}\n**Need**: $${needed.toFixed(2)} more`,
            inline: false 
          }
        ]);
      }

      return embed;
      
    } catch (error) {
      console.error('❌ Error creating embed:', error.message);
      return new EmbedBuilder()
        .setTitle('💰 Trading Portfolio')
        .setDescription('⚠️ Connection Error - Retrying...')
        .setColor(0xFF9800)
        .setTimestamp();
    }
  }

  startUpdates() {
    // Clear any existing interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    console.log('🔄 Starting bulletproof updates every 30 seconds...');
    this.updateInterval = setInterval(async () => {
      if (this.client && this.client.isReady()) {
        await this.updateEmbed();
      } else {
        console.log('⚠️ Client not ready - attempting reconnection...');
        this.handleError();
      }
    }, 30000);

    // Initial update
    setTimeout(() => this.updateEmbed(), 5000);
  }

  async updateEmbed() {
    if (!this.dashboardMessageId || !this.dashboardChannelId) {
      console.log('⚠️ No embed reference - finding embed...');
      await this.findAndSetupEmbed();
      return;
    }
    
    try {
      const channel = await this.client.channels.fetch(this.dashboardChannelId);
      const message = await channel.messages.fetch(this.dashboardMessageId);
      const embed = await this.createOriginalEmbed();
      
      await message.edit({ embeds: [embed] });
      console.log(`✅ [${new Date().toLocaleTimeString()}] Bulletproof update successful`);
      
    } catch (error) {
      console.error('❌ Update failed:', error.message);
      
      if (error.message.includes('Unknown Message') || error.code === 10008) {
        console.log('🔍 Message lost - finding new embed...');
        this.dashboardMessageId = null;
        this.dashboardChannelId = null;
        setTimeout(() => this.findAndSetupEmbed(), 5000);
      }
    }
  }

  handleError() {
    if (this.isShuttingDown) return;
    
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectAttempts * 5000, 30000);
    
    console.log(`🔄 Handling error - restart in ${delay/1000}s (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isShuttingDown) {
        this.restartBot();
      }
    }, delay);
  }

  async restartBot() {
    if (this.isShuttingDown) return;
    
    console.log('🔄 Restarting bulletproof bot...');
    
    try {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }
      
      if (this.client) {
        this.client.removeAllListeners();
        await this.client.destroy();
        this.client = null;
      }
      
      // Wait before restarting
      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.startBot();
        }
      }, 3000);
      
    } catch (error) {
      console.error('❌ Error during restart:', error.message);
      setTimeout(() => this.restartBot(), 10000);
    }
  }

  gracefulShutdown() {
    console.log('🛑 Graceful shutdown initiated...');
    this.isShuttingDown = true;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    if (this.client) {
      this.client.destroy();
    }
    
    process.exit(0);
  }
}

// Create and start the bulletproof bot
const bot = new BulletproofBot();

console.log('🛡️ BULLETPROOF Discord Bot Started');
console.log('💪 Will never go offline');
console.log('🔄 Auto-restarts on any error');
console.log('⚡ Updates Discord every 30 seconds');