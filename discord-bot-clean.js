import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// 🎯 CLEAN DISCORD BOT - 24/7 EMBED UPDATES ONLY
// All trading logic moved to independent TradingEngine API system
class TradingBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // 🔧 Bot Configuration
    this.channelId = '1301369147896688670';
    this.guildId = '1301369147091746817';
    this.messageId = null;
    
    // 🎯 Trading State Management
    this.baselineValue = 281.88; // Locked baseline
    this.lastTriggerTarget = 282.88; // Current trigger level
    this.tradingLock = false;
    this.lastPortfolioValue = 0;
    this.priceHistory = [];
    this.consecutiveUpdates = 0;
    
    // 📊 Update Timing
    this.updateInterval = 1000; // 1 second updates for 24/7 monitoring
    this.lastUpdateTime = Date.now();
    
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.once('ready', () => {
      console.log('🤖 Discord Trading Bot Connected and Ready!');
      console.log(`📱 Bot: ${this.client.user.tag}`);
      console.log(`🏠 Guild: ${this.guildId}`);
      console.log(`📢 Channel: ${this.channelId}`);
      console.log(`💰 Baseline: $${this.baselineValue.toFixed(2)}`);
      console.log(`🎯 Trigger: $${this.lastTriggerTarget.toFixed(2)}`);
      
      // Load saved trigger data
      this.loadTriggerFromFile();
      
      // Start 24/7 embed updates
      this.startPortfolioUpdates();
      
      // Register slash commands
      this.registerSlashCommands();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(interaction);
    });

    this.client.on('error', (error) => {
      console.error('Discord client error:', error);
    });

    process.on('SIGINT', () => {
      console.log('🛑 Shutting down Discord bot...');
      this.client.destroy();
      process.exit(0);
    });
  }

  // 🎯 24/7 PORTFOLIO EMBED UPDATES
  async startPortfolioUpdates() {
    console.log('🚀 Starting 24/7 portfolio embed updates...');
    
    setInterval(async () => {
      try {
        await this.updatePortfolioEmbed();
        this.consecutiveUpdates++;
        
        // Log status every 60 updates (1 minute)
        if (this.consecutiveUpdates % 60 === 0) {
          console.log(`✅ 24/7 Updates: ${this.consecutiveUpdates} embeds sent (${Math.floor(this.consecutiveUpdates/60)} minutes)`);
        }
      } catch (error) {
        console.error('❌ Error updating portfolio embed:', error.message);
      }
    }, this.updateInterval);
  }

  async updatePortfolioEmbed() {
    try {
      const portfolioData = await this.getPortfolioData();
      
      if (!portfolioData || !portfolioData.holdings) {
        console.log('⏳ Waiting for portfolio data...');
        return;
      }

      // 🎯 TRIGGER DETECTION - Check if we should call TradingEngine
      await this.checkTriggerConditions(portfolioData);
      
      const embed = this.createPortfolioEmbed(portfolioData);
      const channel = await this.client.channels.fetch(this.channelId);
      
      if (!channel) {
        console.error('❌ Channel not found:', this.channelId);
        return;
      }

      // Update or create embed message
      if (this.messageId) {
        try {
          const message = await channel.messages.fetch(this.messageId);
          await message.edit({ embeds: [embed] });
        } catch (error) {
          console.log('📝 Creating new embed message...');
          const message = await channel.send({ embeds: [embed] });
          this.messageId = message.id;
        }
      } else {
        const message = await channel.send({ embeds: [embed] });
        this.messageId = message.id;
        console.log('✅ Portfolio embed message created');
      }
      
      this.lastUpdateTime = Date.now();
      
    } catch (error) {
      console.error('❌ Error in updatePortfolioEmbed:', error.message);
    }
  }

  // 🎯 TRIGGER DETECTION - Calls TradingEngine API when conditions met
  async checkTriggerConditions(portfolioData) {
    try {
      const autoTradeSettings = await this.getAutoTradeSettings();
      
      if (!autoTradeSettings.enabled) {
        return;
      }
      
      const solHolding = portfolioData.holdings.find(h => h.currency === 'SOL');
      if (!solHolding) {
        return;
      }
      
      const currentValue = parseFloat(solHolding.value.toFixed(2));
      
      // 🎯 SWING TRADE TRIGGER LOGIC
      if (currentValue >= this.lastTriggerTarget) {
        const reason = `Portfolio hit $${currentValue.toFixed(2)} (trigger: $${this.lastTriggerTarget.toFixed(2)})`;
        console.log(`🚨 TRIGGER DETECTED: ${reason}`);
        
        // 📡 Call independent TradingEngine API
        try {
          const response = await fetch('http://localhost:5000/api/trading/execute-swing-trade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              userId: 'test-user', 
              reason, 
              amount: 1.00 
            })
          });
          
          const result = await response.json();
          console.log(`📡 TradingEngine API called:`, result);
          
          if (result.success) {
            // Update trigger for next $1 increment
            this.lastTriggerTarget = parseFloat((currentValue + 1.00).toFixed(2));
            this.saveTriggerToFile();
            console.log(`🔄 NEXT TRIGGER: $${this.lastTriggerTarget.toFixed(2)}`);
          }
          
        } catch (apiError) {
          console.log(`❌ TradingEngine API error:`, apiError.message);
        }
      } else {
        const needed = parseFloat((this.lastTriggerTarget - currentValue).toFixed(2));
        console.log(`⏳ Need $${needed} more to hit $${this.lastTriggerTarget.toFixed(2)} trigger`);
      }
      
    } catch (error) {
      console.error('❌ Error checking triggers:', error.message);
    }
  }

  // 📊 PORTFOLIO EMBED CREATION
  createPortfolioEmbed(portfolioData) {
    const solHolding = portfolioData.holdings.find(h => h.currency === 'SOL') || {
      currency: 'SOL',
      amount: 0,
      value: 0,
      price: 0,
      change: 0
    };

    const currentValue = parseFloat(solHolding.value.toFixed(2));
    const neededForTrigger = parseFloat((this.lastTriggerTarget - currentValue).toFixed(2));
    const progressFromBaseline = parseFloat((currentValue - this.baselineValue).toFixed(2));
    
    // 🎨 Dynamic Color Based on Performance
    let embedColor = 0x808080; // Gray default
    if (currentValue > this.baselineValue) embedColor = 0x4CAF50; // Green - profit
    if (currentValue < this.baselineValue) embedColor = 0xF44336; // Red - loss
    if (neededForTrigger <= 0.10) embedColor = 0xFFD700; // Gold - trigger imminent
    
    const embed = new EmbedBuilder()
      .setTitle('💰 SOL Portfolio Monitor')
      .setColor(embedColor)
      .addFields(
        { 
          name: '💎 Current Portfolio Value', 
          value: `**$${currentValue.toFixed(2)} USD**`, 
          inline: true 
        },
        { 
          name: '📊 SOL Amount', 
          value: `${solHolding.amount.toFixed(6)} SOL`, 
          inline: true 
        },
        { 
          name: '💲 SOL Price', 
          value: `$${solHolding.price.toFixed(2)}`, 
          inline: true 
        },
        { 
          name: '🎯 Next Trigger Level', 
          value: `$${this.lastTriggerTarget.toFixed(2)}`, 
          inline: true 
        },
        { 
          name: '⏳ Needed for Trigger', 
          value: neededForTrigger > 0 ? `$${neededForTrigger.toFixed(2)}` : '✅ TRIGGER READY!', 
          inline: true 
        },
        { 
          name: '📈 From Baseline', 
          value: `${progressFromBaseline >= 0 ? '+' : ''}$${progressFromBaseline.toFixed(2)}`, 
          inline: true 
        }
      )
      .setFooter({ 
        text: `🔄 Live Updates • Baseline: $${this.baselineValue.toFixed(2)} • Updates: ${this.consecutiveUpdates}` 
      })
      .setTimestamp();

    // 🚨 Add trigger warning if close
    if (neededForTrigger <= 0.10 && neededForTrigger > 0) {
      embed.addFields({ 
        name: '⚠️ TRIGGER ALERT', 
        value: `Less than $0.10 needed for automatic $1 swing trade!`, 
        inline: false 
      });
    }

    return embed;
  }

  // 🔧 DATA FETCHING
  async getPortfolioData() {
    try {
      const response = await fetch('http://localhost:5000/api/portfolio/user-1');
      if (!response.ok) {
        throw new Error(`Portfolio API error: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('❌ Portfolio fetch error:', error.message);
      return null;
    }
  }

  async getAutoTradeSettings() {
    try {
      const response = await fetch('http://localhost:5000/api/trading-settings/user-1');
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.log('⚙️ Using default trading settings');
    }
    
    // Default enabled settings
    return {
      enabled: true,
      selectedCrypto: 'SOL',
      conditions: {
        portfolioValueReached: false
      }
    };
  }

  // 💾 TRIGGER FILE MANAGEMENT
  saveTriggerToFile() {
    try {
      const triggerData = {
        trigger: this.lastTriggerTarget,
        baseline: this.baselineValue,
        timestamp: new Date().toISOString()
      };
      writeFileSync('trigger.json', JSON.stringify(triggerData, null, 2));
      console.log(`💾 TRIGGER SAVED: $${this.lastTriggerTarget.toFixed(2)}`);
    } catch (error) {
      console.error('❌ Error saving trigger:', error.message);
    }
  }

  loadTriggerFromFile() {
    try {
      if (existsSync('trigger.json')) {
        const triggerData = JSON.parse(readFileSync('trigger.json', 'utf8'));
        this.lastTriggerTarget = triggerData.trigger;
        this.baselineValue = triggerData.baseline || 281.88;
        console.log(`📂 TRIGGER LOADED: $${this.lastTriggerTarget.toFixed(2)} (saved ${new Date(triggerData.timestamp).toLocaleString()})`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Error loading trigger:', error.message);
      return false;
    }
  }

  // 🎮 SLASH COMMANDS
  async registerSlashCommands() {
    const commands = [
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show current trading bot status'),
      
      new SlashCommandBuilder()
        .setName('baseline')
        .setDescription('Set the baseline portfolio value')
        .addNumberOption(option =>
          option.setName('value')
            .setDescription('Baseline value in USD')
            .setRequired(true)
        ),
        
      new SlashCommandBuilder()
        .setName('trigger')
        .setDescription('Set the next trigger level')
        .addNumberOption(option =>
          option.setName('value')
            .setDescription('Trigger value in USD')
            .setRequired(true)
        )
    ];

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);

    try {
      await rest.put(
        Routes.applicationGuildCommands(this.client.user.id, this.guildId),
        { body: commands }
      );
      console.log('✅ Slash commands registered successfully');
    } catch (error) {
      console.error('❌ Error registering slash commands:', error);
    }
  }

  async handleSlashCommand(interaction) {
    try {
      const { commandName } = interaction;

      if (commandName === 'status') {
        const portfolioData = await this.getPortfolioData();
        const solHolding = portfolioData?.holdings?.find(h => h.currency === 'SOL') || { value: 0 };
        
        const embed = new EmbedBuilder()
          .setTitle('🤖 Trading Bot Status')
          .setColor(0x00FF00)
          .addFields(
            { name: '📊 Current Portfolio', value: `$${solHolding.value.toFixed(2)}`, inline: true },
            { name: '🎯 Next Trigger', value: `$${this.lastTriggerTarget.toFixed(2)}`, inline: true },
            { name: '📈 Baseline', value: `$${this.baselineValue.toFixed(2)}`, inline: true },
            { name: '🔄 Updates Sent', value: `${this.consecutiveUpdates}`, inline: true },
            { name: '⏰ Last Update', value: `<t:${Math.floor(this.lastUpdateTime/1000)}:R>`, inline: true },
            { name: '🚀 Status', value: '✅ Running 24/7', inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
      
      else if (commandName === 'baseline') {
        const value = interaction.options.getNumber('value');
        this.baselineValue = parseFloat(value.toFixed(2));
        this.saveTriggerToFile();
        
        await interaction.reply({
          content: `✅ Baseline set to $${this.baselineValue.toFixed(2)}`,
          ephemeral: true
        });
      }
      
      else if (commandName === 'trigger') {
        const value = interaction.options.getNumber('value');
        this.lastTriggerTarget = parseFloat(value.toFixed(2));
        this.saveTriggerToFile();
        
        await interaction.reply({
          content: `✅ Next trigger set to $${this.lastTriggerTarget.toFixed(2)}`,
          ephemeral: true
        });
      }
      
    } catch (error) {
      console.error('❌ Slash command error:', error);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Command failed', ephemeral: true });
      }
    }
  }

  // 🚀 START BOT
  async start() {
    try {
      await this.client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
      console.error('❌ Failed to start Discord bot:', error);
    }
  }
}

// 🎯 INITIALIZE AND START BOT
const bot = new TradingBot();
bot.start().catch(console.error);

export default bot;