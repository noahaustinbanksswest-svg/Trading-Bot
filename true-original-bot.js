import { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

console.log('🔥 TRUE ORIGINAL FORMAT DISCORD BOT');

class TrueOriginalBot {
  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });
    
    this.dashboardMessageId = null;
    this.dashboardChannelId = null;
    this.liveUpdateInterval = null;
    
    this.setupEventHandlers();
    this.startBot();
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      console.log(`✅ TRUE ORIGINAL Bot Ready: ${this.client.user.tag}`);
      await this.findExistingEmbed();
      this.startLiveUpdates();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;
      
      try {
        await interaction.deferReply({ ephemeral: true });
        
        if (interaction.customId === 'refresh_portfolio') {
          await this.updateExistingEmbed();
          await interaction.editReply('✅ Portfolio refreshed!');
        }
      } catch (error) {
        console.error('❌ Button error:', error);
      }
    });

    // Handle errors and reconnection
    this.client.on('error', error => {
      console.error('❌ Discord client error:', error);
    });

    this.client.on('disconnect', () => {
      console.log('⚠️ Discord disconnected - will reconnect');
    });
  }

  async findExistingEmbed() {
    try {
      const guild = this.client.guilds.cache.first();
      const channel = guild.channels.cache.find(c => 
        c.name === 'new-dashboard' && c.isTextBased()
      );
      
      if (!channel) {
        console.log('❌ No #new-dashboard channel found');
        return;
      }

      console.log('🔍 Looking for existing embed...');
      const messages = await channel.messages.fetch({ limit: 50 });
      const existingEmbed = messages.find(msg => 
        msg.author.id === this.client.user.id && 
        msg.embeds.length > 0 &&
        msg.embeds[0].title && 
        msg.embeds[0].title.includes('Portfolio Dashboard')
      );

      if (existingEmbed) {
        this.dashboardMessageId = existingEmbed.id;
        this.dashboardChannelId = channel.id;
        console.log(`✅ Found existing embed: ${this.dashboardMessageId}`);
        await this.updateExistingEmbed();
      } else {
        console.log('📊 Creating new TRUE ORIGINAL embed...');
        await this.createNewEmbed(channel);
      }
    } catch (error) {
      console.error('❌ Error finding embed:', error);
    }
  }

  async createNewEmbed(channel) {
    try {
      const embed = await this.createTrueOriginalEmbed();
      const buttons = this.createButtons();
      
      const message = await channel.send({
        embeds: [embed],
        components: buttons
      });
      
      this.dashboardMessageId = message.id;
      this.dashboardChannelId = channel.id;
      console.log(`✅ TRUE ORIGINAL embed created: ${message.id}`);
    } catch (error) {
      console.error('❌ Error creating embed:', error);
    }
  }

  async updateExistingEmbed() {
    if (!this.dashboardMessageId || !this.dashboardChannelId) return;
    
    try {
      const channel = await this.client.channels.fetch(this.dashboardChannelId);
      const message = await channel.messages.fetch(this.dashboardMessageId);
      
      const embed = await this.createTrueOriginalEmbed();
      const buttons = this.createButtons();
      
      await message.edit({
        embeds: [embed],
        components: buttons
      });
      
      console.log('✅ TRUE ORIGINAL dashboard updated');
    } catch (error) {
      console.error('❌ Update error:', error);
      await this.findExistingEmbed();
    }
  }

  async createTrueOriginalEmbed() {
    try {
      console.log('🔗 Fetching live portfolio data from API...');
      
      // Fetch live portfolio data from local API
      const portfolioResponse = await fetch('http://localhost:5000/api/portfolio/user-1');
      const portfolioData = await portfolioResponse.json();
      
      // Fetch trading status
      const statusResponse = await fetch('http://localhost:5000/api/independent-trading/status/user-1');
      const statusData = await statusResponse.json();
      
      const isTrading = statusData.running || false;
      
      // TRUE ORIGINAL FORMAT - EXACT COPY
      const embed = new EmbedBuilder()
        .setTitle('💰 Live Portfolio Dashboard (API Connected)')
        .setColor(isTrading ? 0x4CAF50 : 0xF44336)
        .setTimestamp()
        .setFooter({ text: `Live Portfolio • Real-time Updates` });

      // Main portfolio info from live API - ORIGINAL FORMAT
      embed.addFields([
        { name: '📊 Total Portfolio Value', value: `**$${portfolioData.totalValue}**`, inline: true },
        { name: '📈 Trading Status', value: isTrading ? '✅ ACTIVE' : '❌ INACTIVE', inline: true },
        { name: '⚡ Live Connection', value: '🟢 Connected', inline: true }
      ]);

      // Show all crypto holdings - ORIGINAL FORMAT
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

      // SEPARATE TRIGGER SECTION - NEW ADDITION AS REQUESTED
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
      // Return fallback embed with error info - ORIGINAL FORMAT
      return new EmbedBuilder()
        .setTitle('💰 Portfolio Dashboard')
        .setDescription(`⚠️ API Connection Error: ${error.message}`)
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
    if (this.liveUpdateInterval) {
      clearInterval(this.liveUpdateInterval);
    }

    console.log('🔄 Starting live updates every 10 seconds...');
    this.liveUpdateInterval = setInterval(async () => {
      try {
        if (this.dashboardMessageId && this.dashboardChannelId) {
          await this.updateExistingEmbed();
        }
      } catch (error) {
        console.error('❌ Live update error:', error.message);
      }
    }, 10000); // Every 10 seconds like original
  }

  async startBot() {
    try {
      const token = 'MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4';
      console.log('🔗 Connecting to Discord...');
      await this.client.login(token);
    } catch (error) {
      console.error('❌ Login failed:', error);
      // Retry connection after 5 seconds
      setTimeout(() => {
        console.log('🔄 Retrying connection...');
        this.startBot();
      }, 5000);
    }
  }

  shutdown() {
    console.log('🛑 Shutting down TRUE ORIGINAL bot...');
    if (this.liveUpdateInterval) {
      clearInterval(this.liveUpdateInterval);
    }
    this.client.destroy();
  }
}

// Create and start the TRUE ORIGINAL bot
const bot = new TrueOriginalBot();

// Bulletproof termination handling
process.on('SIGINT', () => bot.shutdown());
process.on('SIGTERM', () => bot.shutdown());
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  // Don't exit, just log the error
});

console.log('💎 TRUE ORIGINAL Discord Bot Format');
console.log('🔗 Gemini Data Connected via API');
console.log('📊 Live Updates Every 10 Seconds');
console.log('🎯 Separate Trigger Section Added');
console.log('🛡️ Bulletproof Persistence Enabled');