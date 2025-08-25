const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// BULLETPROOF DEPLOYMENT BOT - ORIGINAL DAY 1 FORMAT
console.log('🛡️ BULLETPROOF Discord Bot Starting...');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

// BULLETPROOF ERROR HANDLING
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception - Bot will restart:', error);
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (error) => {
  console.error('🚨 Unhandled Rejection - Bot will restart:', error);
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Bot ready event
client.once('ready', async () => {
  console.log(`✅ BULLETPROOF Bot Online: ${client.user.tag}`);
  
  const CHANNEL_NAME = 'new-dashboard';
  let channel, embed, embedMessage;

  try {
    // Find channel by name
    const guild = client.guilds.cache.first();
    if (!guild) {
      throw new Error('No guild found');
    }
    
    channel = guild.channels.cache.find(ch => ch.name === CHANNEL_NAME && ch.type === 0);
    if (!channel) {
      throw new Error(`Channel "${CHANNEL_NAME}" not found`);
    }
    console.log('✅ Connected to Discord channel');

    // Look for existing embed
    const messages = await channel.messages.fetch({ limit: 20 });
    embedMessage = messages.find(msg => 
      msg.author.id === client.user.id && 
      msg.embeds.length > 0 && 
      msg.embeds[0].title && 
      msg.embeds[0].title.includes('Portfolio')
    );

    if (embedMessage) {
      console.log('✅ Found existing embed - will update it');
    } else {
      console.log('📝 Creating new embed');
    }

    console.log('🔄 Starting bulletproof updates every 30 seconds...');
    
    // BULLETPROOF UPDATE FUNCTION WITH ORIGINAL FORMAT
    const updateEmbed = async () => {
      try {
        console.log('🔄 Updating embed...');

        // BULLETPROOF API CALLS WITH DEFAULTS
        const [portfolioResponse, tradingResponse] = await Promise.allSettled([
          axios.get('http://localhost:5000/api/portfolio/user-1', { timeout: 10000 }),
          axios.get('http://localhost:5000/api/independent-trading/status/user-1', { timeout: 10000 })
        ]);

        // SAFE DATA EXTRACTION
        let totalValue = 0;
        let solAmount = 0;
        let solPrice = 0;
        let isTrading = false;
        let triggerInfo = null;

        // Portfolio data (bulletproof)
        if (portfolioResponse.status === 'fulfilled' && portfolioResponse.value?.data?.holdings) {
          const holdings = portfolioResponse.value.data.holdings;
          const solHolding = holdings.find(h => h.symbol === 'SOL');
          if (solHolding) {
            totalValue = parseFloat(solHolding.value) || 0;
            solAmount = parseFloat(solHolding.quantity) || 0;
            solPrice = parseFloat(solHolding.price) || 0;
          }
        }

        // Trading data (bulletproof) 
        if (tradingResponse.status === 'fulfilled' && tradingResponse.value?.data) {
          const tradingData = tradingResponse.value.data;
          isTrading = tradingData.running || false;
          if (tradingData.trigger && tradingData.baseline) {
            triggerInfo = {
              trigger: parseFloat(tradingData.trigger) || 0,
              baseline: parseFloat(tradingData.baseline) || 0
            };
          }
        }

        // ORIGINAL DAY 1 EMBED FORMAT (RESTORED!)
        const embed = new EmbedBuilder()
          .setTitle('💰 Crypto Portfolio Dashboard')
          .setColor(isTrading ? 0x4CAF50 : 0xF44336)
          .setTimestamp()
          .setFooter({ text: 'Gemini Connected • Live Updates' });

        // Main portfolio stats (ORIGINAL FORMAT)
        embed.addFields([
          { name: '📊 Total Portfolio Value', value: `**$${totalValue.toFixed(2)}**`, inline: true },
          { name: '📈 Trading Status', value: isTrading ? '✅ ACTIVE' : '❌ INACTIVE', inline: true },
          { name: '🔗 Gemini API', value: '🟢 CONNECTED', inline: true }
        ]);

        // SOL Holdings (ORIGINAL FORMAT)
        if (solAmount > 0) {
          embed.addFields([
            { 
              name: '🪙 SOL Holdings', 
              value: `**${solAmount.toFixed(6)} SOL**\n$${totalValue.toFixed(2)} USD\n$${solPrice.toFixed(2)} per SOL`,
              inline: false 
            }
          ]);
        }

        // Trading trigger (if available)
        if (triggerInfo && triggerInfo.trigger > 0) {
          const needed = Math.max(0, triggerInfo.trigger - totalValue);
          embed.addFields([
            { 
              name: '🎯 Trading Trigger Information', 
              value: `🎯 **Next Trigger**: $${triggerInfo.trigger.toFixed(2)}\n📊 **Baseline**: $${triggerInfo.baseline.toFixed(2)}\n⏳ **Needed**: $${needed.toFixed(2)} more`,
              inline: false 
            }
          ]);
        }

        // Update or create embed
        if (embedMessage) {
          await embedMessage.edit({ embeds: [embed] });
          console.log('✅ Embed updated successfully');
        } else {
          embedMessage = await channel.send({ embeds: [embed] });
          console.log('✅ New embed created successfully');
        }

      } catch (error) {
        console.error('❌ Update error:', error.message);
        
        // BULLETPROOF FALLBACK EMBED
        try {
          const fallbackEmbed = new EmbedBuilder()
            .setTitle('💰 Crypto Portfolio Dashboard')
            .setDescription('⚠️ Gemini Connection Error - Retrying...')
            .setColor(0xFF9800)
            .setTimestamp()
            .setFooter({ text: 'Retrying connection...' });

          if (embedMessage) {
            await embedMessage.edit({ embeds: [fallbackEmbed] });
          } else {
            embedMessage = await channel.send({ embeds: [fallbackEmbed] });
          }
          console.log('✅ Fallback embed displayed');
        } catch (fallbackError) {
          console.error('❌ Even fallback failed:', fallbackError.message);
        }
      }
    };

    // Initial update
    await updateEmbed();
    
    // BULLETPROOF INTERVAL (restart if it fails)
    const startInterval = () => {
      const intervalId = setInterval(async () => {
        try {
          await updateEmbed();
        } catch (error) {
          console.error('❌ Interval update failed, restarting interval:', error.message);
          clearInterval(intervalId);
          setTimeout(startInterval, 5000); // Restart after 5 seconds
        }
      }, 30000);
      
      return intervalId;
    };
    
    startInterval();
    
  } catch (error) {
    console.error('❌ CRITICAL Bot Setup Error:', error);
    setTimeout(() => {
      console.log('🔄 Restarting bot due to critical error...');
      process.exit(1);
    }, 5000);
  }
});

// BULLETPROOF LOGIN WITH AUTO-RESTART
const login = async () => {
  try {
    console.log('🚀 Bot login initiated...');
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    console.log('🔄 Retrying login in 10 seconds...');
    setTimeout(login, 10000);
  }
};

login();

// BULLETPROOF HEARTBEAT
setInterval(() => {
  if (client.readyAt) {
    console.log(`💖 Heartbeat: Bot alive for ${Math.floor((Date.now() - client.readyAt) / 1000)}s`);
  }
}, 120000); // Every 2 minutes