#!/usr/bin/env node
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

console.log('🚀 24/7 DISCORD TRADING BOT - RESERVED VM');
console.log('🛡️ Bulletproof with auto-reconnect and crash recovery');

class Bulletproof24_7Bot {
  constructor() {
    this.token = 'MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4';
    this.client = null;
    this.dashboardMessageId = null;
    this.dashboardChannelId = null;
    this.updateInterval = null;
    this.reconnectAttempts = 0;
    this.isShuttingDown = false;
    
    this.startBot();
  }

  async startBot() {
    if (this.isShuttingDown) return;
    
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    
    this.client.once('ready', async () => {
      console.log(`✅ Bot online: ${this.client.user.tag}`);
      this.reconnectAttempts = 0;
      await this.setupDashboard();
      this.startLiveUpdates();
    });

    this.client.on('error', (error) => {
      console.error('❌ Discord error:', error.message);
      this.handleReconnection();
    });

    this.client.on('disconnect', () => {
      console.log('🔌 Discord disconnected');
      this.handleReconnection();
    });

    try {
      await this.client.login(this.token);
    } catch (error) {
      console.error('❌ Login failed:', error.message);
      this.handleReconnection();
    }
  }

  async setupDashboard() {
    try {
      const guild = this.client.guilds.cache.first();
      const channel = guild.channels.cache.find(c => c.name === 'new-dashboard' && c.isTextBased());
      
      if (!channel) {
        console.log('❌ No #new-dashboard channel found');
        return;
      }

      this.dashboardChannelId = channel.id;
      
      // Find existing embed
      const messages = await channel.messages.fetch({ limit: 50 });
      const existingEmbed = messages.find(msg => 
        msg.author.id === this.client.user.id && 
        msg.embeds.length > 0 && 
        msg.embeds[0].title?.includes('Portfolio')
      );
      
      if (existingEmbed) {
        this.dashboardMessageId = existingEmbed.id;
        console.log(`✅ Using existing embed: ${this.dashboardMessageId}`);
      } else {
        console.log('📊 Creating new dashboard embed...');
        const embed = await this.createEmbed();
        const message = await channel.send({ embeds: [embed] });
        this.dashboardMessageId = message.id;
        console.log(`✅ New embed created: ${message.id}`);
      }
      
      // Initial update
      await this.updateDashboard();
      
    } catch (error) {
      console.error('❌ Dashboard setup error:', error.message);
    }
  }

  async createEmbed() {
    try {
      const portfolioRes = await fetch('http://localhost:5000/api/portfolio/user-1');
      const portfolio = await portfolioRes.json();
      
      const statusRes = await fetch('http://localhost:5000/api/independent-trading/status/user-1');
      const status = await statusRes.json();
      
      const isActive = status.running || false;
      const totalValue = parseFloat(portfolio.totalValue);
      
      const embed = new EmbedBuilder()
        .setTitle('💰 24/7 Trading Portfolio')
        .setColor(isActive ? 0x00FF00 : 0xFF0000)
        .setTimestamp()
        .setFooter({ text: 'Reserved VM • Live Updates • No Downtime' });

      embed.addFields([
        { name: '📊 Portfolio', value: `**$${totalValue.toFixed(2)}**`, inline: true },
        { name: '📈 Trading', value: isActive ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },
        { name: '💎 Connection', value: '🟢 24/7', inline: true }
      ]);

      // SOL holdings
      const solHolding = portfolio.holdings?.find(h => h.symbol === 'solusd');
      if (solHolding) {
        const amount = parseFloat(solHolding.amount);
        const value = parseFloat(solHolding.valueUSD);
        const price = parseFloat(solHolding.currentPrice);
        
        embed.addFields([
          { 
            name: '🪙 SOL Holdings', 
            value: `**${amount.toFixed(6)} SOL**\n$${value.toFixed(2)} @ $${price.toFixed(2)}/SOL`,
            inline: false 
          }
        ]);
      }

      // Trading trigger
      if (status.triggerInfo) {
        const baseline = status.triggerInfo.baseline || 0;
        const trigger = status.triggerInfo.trigger || 0;
        const needed = Math.max(0, trigger - totalValue);
        
        embed.addFields([
          { 
            name: '🎯 Next Trade Trigger', 
            value: `🎯 **Trigger**: $${trigger.toFixed(2)}\n📊 **Baseline**: $${baseline.toFixed(2)}\n⏳ **Need**: $${needed.toFixed(2)} more`,
            inline: false 
          }
        ]);
      }

      return embed;
      
    } catch (error) {
      console.error('❌ Embed error:', error);
      return new EmbedBuilder()
        .setTitle('💰 Trading Portfolio')
        .setDescription('⚠️ API Connection Error - Retrying...')
        .setColor(0xFF9800)
        .setTimestamp();
    }
  }

  async updateDashboard() {
    if (!this.dashboardMessageId || !this.dashboardChannelId) return;
    
    try {
      const channel = await this.client.channels.fetch(this.dashboardChannelId);
      const message = await channel.messages.fetch(this.dashboardMessageId);
      const embed = await this.createEmbed();
      
      await message.edit({ embeds: [embed] });
      console.log(`✅ Dashboard updated - ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error('❌ Update error:', error.message);
    }
  }

  startLiveUpdates() {
    if (this.updateInterval) clearInterval(this.updateInterval);
    
    console.log('🔄 Starting live updates every 30 seconds...');
    this.updateInterval = setInterval(async () => {
      if (!this.isShuttingDown) {
        await this.updateDashboard();
      }
    }, 30000);
  }

  handleReconnection() {
    if (this.isShuttingDown) return;
    
    this.reconnectAttempts++;
    if (this.reconnectAttempts > 10) {
      console.log('❌ Max reconnection attempts reached. Restarting bot...');
      this.reconnectAttempts = 0;
      setTimeout(() => this.startBot(), 5000);
      return;
    }
    
    const delay = Math.min(this.reconnectAttempts * 3000, 30000);
    console.log(`🔄 Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/10)`);
    
    setTimeout(() => {
      this.startBot();
    }, delay);
  }

  shutdown() {
    console.log('🛑 Shutting down 24/7 bot...');
    this.isShuttingDown = true;
    if (this.updateInterval) clearInterval(this.updateInterval);
    if (this.client) this.client.destroy();
  }
}

// Create the bulletproof bot
const bot = new Bulletproof24_7Bot();

// Handle process termination
process.on('SIGINT', () => bot.shutdown());
process.on('SIGTERM', () => bot.shutdown());

// Crash recovery
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error.message);
  console.log('🔄 Restarting bot in 5 seconds...');
  setTimeout(() => {
    const newBot = new Bulletproof24_7Bot();
  }, 5000);
});

process.on('unhandledRejection', (error) => {
  console.error('💥 Unhandled rejection:', error);
  console.log('🔄 Continuing operation...');
});

console.log('🚀 24/7 Discord Trading Bot Started');
console.log('💎 Reserved VM Active');
console.log('🔄 Auto-updates every 30 seconds');
console.log('🛡️ Bulletproof crash recovery enabled');