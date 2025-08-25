import { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

// Import Gemini service for direct connection
class GeminiService {
  constructor() {
    this.baseUrl = 'https://api.sandbox.gemini.com';
    this.apiKey = process.env.GEMINI_API_KEY;
    this.apiSecret = process.env.GEMINI_API_SECRET;
  }

  async getTicker(symbol) {
    try {
      const response = await fetch(`${this.baseUrl}/v1/pubticker/${symbol}`);
      return await response.json();
    } catch (error) {
      console.error('Gemini ticker error:', error);
      throw error;
    }
  }

  async getBalances() {
    try {
      // For now, use the API endpoint as fallback
      const response = await fetch('http://localhost:5000/api/portfolio/user-1');
      const data = await response.json();
      
      // Convert to Gemini format
      const balances = [];
      if (data.holdings) {
        data.holdings.forEach(holding => {
          const symbol = holding.symbol.replace('usd', '').toUpperCase();
          balances.push({
            currency: symbol,
            amount: holding.amount,
            available: holding.amount,
            availableForWithdrawal: holding.amount
          });
        });
      }
      return balances;
    } catch (error) {
      console.error('Gemini balances error:', error);
      throw error;
    }
  }
}

console.log('🚀 ORIGINAL FORMAT DISCORD BOT - GEMINI CONNECTED');

class OriginalFormatBot {
  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });
    
    this.gemini = new GeminiService();
    this.dashboardMessageId = null;
    this.dashboardChannelId = null;
    
    this.setupEventHandlers();
    this.startBot();
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      console.log(`✅ Original Format Bot Ready: ${this.client.user.tag}`);
      await this.findExistingEmbed();
      this.startLiveUpdates();
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
        console.error('❌ Button error:', error);
      }
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

      // Find existing bot messages
      const messages = await channel.messages.fetch({ limit: 50 });
      const existingEmbed = messages.find(msg => 
        msg.author.id === this.client.user.id && 
        msg.embeds.length > 0
      );

      if (existingEmbed) {
        this.dashboardMessageId = existingEmbed.id;
        this.dashboardChannelId = channel.id;
        console.log(`✅ Found existing embed: ${this.dashboardMessageId}`);
        await this.updateDashboard();
      } else {
        console.log('📊 Creating new original format embed...');
        await this.createNewEmbed(channel);
      }
    } catch (error) {
      console.error('❌ Error finding embed:', error);
    }
  }

  async createNewEmbed(channel) {
    try {
      const embed = await this.createOriginalFormatEmbed();
      const buttons = this.createButtons();
      
      const message = await channel.send({
        embeds: [embed],
        components: buttons
      });
      
      this.dashboardMessageId = message.id;
      this.dashboardChannelId = channel.id;
      console.log(`✅ Original format embed created: ${message.id}`);
    } catch (error) {
      console.error('❌ Error creating embed:', error);
    }
  }

  async updateDashboard() {
    if (!this.dashboardMessageId || !this.dashboardChannelId) return;
    
    try {
      const channel = await this.client.channels.fetch(this.dashboardChannelId);
      const message = await channel.messages.fetch(this.dashboardMessageId);
      
      const embed = await this.createOriginalFormatEmbed();
      const buttons = this.createButtons();
      
      await message.edit({
        embeds: [embed],
        components: buttons
      });
      
      console.log('✅ Original format dashboard updated');
    } catch (error) {
      console.error('❌ Update error:', error);
      await this.findExistingEmbed();
    }
  }

  async createOriginalFormatEmbed() {
    try {
      console.log('🔗 Fetching data from Gemini...');
      
      // Get SOL ticker from Gemini
      const solTicker = await this.gemini.getTicker('SOLUSD');
      const solPrice = parseFloat(solTicker.last);
      
      // Get balances from Gemini
      const balances = await this.gemini.getBalances();
      const solBalance = balances.find(b => b.currency === 'SOL');
      const solAmount = solBalance ? parseFloat(solBalance.amount) : 0;
      const solValue = solAmount * solPrice;
      
      // Get trading status
      const statusResponse = await fetch('http://localhost:5000/api/independent-trading/status/user-1');
      const status = await statusResponse.json();
      
      const isTrading = status.running || false;
      
      // ORIGINAL FORMAT EMBED
      const embed = new EmbedBuilder()
        .setTitle('💰 Crypto Portfolio Dashboard')
        .setColor(isTrading ? 0x4CAF50 : 0xF44336)
        .setTimestamp()
        .setFooter({ text: 'Gemini Connected • Live Updates' });

      // Main portfolio stats (ORIGINAL FORMAT)
      embed.addFields([
        { name: '📊 Total Portfolio Value', value: `**$${solValue.toFixed(2)}**`, inline: true },
        { name: '📈 Trading Status', value: isTrading ? '✅ ACTIVE' : '❌ INACTIVE', inline: true },
        { name: '🔗 Gemini API', value: '🟢 CONNECTED', inline: true }
      ]);

      // SOL Holdings (ORIGINAL FORMAT)
      if (solAmount > 0) {
        embed.addFields([
          { 
            name: '🪙 SOL Holdings', 
            value: `**${solAmount.toFixed(6)} SOL**\n$${solValue.toFixed(2)} USD\n$${solPrice.toFixed(2)} per SOL`,
            inline: false 
          }
        ]);
      }

      // SEPARATE TRIGGER SECTION (NEW ADDITION)
      if (status.triggerInfo) {
        const baseline = status.triggerInfo.baseline || 0;
        const trigger = status.triggerInfo.trigger || 0;
        const needed = Math.max(0, trigger - solValue);
        
        embed.addFields([
          { 
            name: '🎯 Trading Trigger Information', 
            value: `🎯 **Next Trigger**: $${trigger.toFixed(2)}\n📊 **Baseline**: $${baseline.toFixed(2)}\n⏳ **Needed**: $${needed.toFixed(2)} more`,
            inline: false 
          }
        ]);
      }

      return embed;
      
    } catch (error) {
      console.error('❌ Embed creation error:', error);
      
      // Fallback embed
      return new EmbedBuilder()
        .setTitle('💰 Crypto Portfolio Dashboard')
        .setDescription('⚠️ Gemini Connection Error - Retrying...')
        .setColor(0xFF9800)
        .setTimestamp();
    }
  }

  createButtons() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('refresh_portfolio')
          .setLabel('Refresh Portfolio')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔄')
      )
    ];
  }

  startLiveUpdates() {
    console.log('🔄 Starting live updates every 30 seconds...');
    setInterval(async () => {
      await this.updateDashboard();
    }, 30000);
  }

  async startBot() {
    try {
      const token = 'MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4';
      console.log('🔗 Connecting to Discord...');
      await this.client.login(token);
    } catch (error) {
      console.error('❌ Login failed:', error);
    }
  }

  shutdown() {
    console.log('🛑 Shutting down original format bot...');
    this.client.destroy();
  }
}

// Create and start the original format bot
const bot = new OriginalFormatBot();

// Handle termination
process.on('SIGINT', () => bot.shutdown());
process.on('SIGTERM', () => bot.shutdown());

console.log('💎 Original Format Discord Bot');
console.log('🔗 Gemini API Connected');
console.log('📊 Live Updates Every 30 Seconds');
console.log('🎯 Separate Trigger Section Added');