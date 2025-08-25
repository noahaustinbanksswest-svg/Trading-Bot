const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

console.log('🛡️ FIXED Discord Bot Starting...');

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

// Bot ready event
client.once('ready', async () => {
  console.log(`✅ FIXED Bot Online: ${client.user.tag}`);
  
  const CHANNEL_ID = '1409416108149190657';
  let channel, embed, embedMessage;

  try {
    // Get the channel
    channel = await client.channels.fetch(CHANNEL_ID);
    console.log('✅ Connected to Discord channel');

    // Look for existing embed
    const messages = await channel.messages.fetch({ limit: 20 });
    embedMessage = messages.find(msg => 
      msg.author.id === client.user.id && 
      msg.embeds.length > 0 &&
      msg.embeds[0].title === '💰 Live Trading Portfolio'
    );

    if (embedMessage) {
      console.log(`✅ Connected to existing embed: ${embedMessage.id}`);
    } else {
      console.log('📝 Creating new embed...');
      embed = new EmbedBuilder()
        .setTitle('💰 Live Trading Portfolio')
        .setColor(0x00ff00)
        .setDescription('🔄 Initializing...')
        .setTimestamp();
      
      embedMessage = await channel.send({ embeds: [embed] });
      console.log(`✅ Created new embed: ${embedMessage.id}`);
    }

    // Start bulletproof updates
    console.log('🔄 Starting bulletproof updates every 30 seconds...');
    setInterval(async () => {
      try {
        await updateEmbed();
      } catch (error) {
        console.error('❌ Update failed:', error.message);
      }
    }, 30000);

    // Initial update
    await updateEmbed();

  } catch (error) {
    console.error('❌ Setup error:', error);
  }

  // Update function
  async function updateEmbed() {
    try {
      const timestamp = new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });

      // Fetch portfolio data
      const portfolioResponse = await fetch('http://localhost:5000/api/portfolio/user-1');
      const portfolio = await portfolioResponse.json();
      
      if (!portfolio.holdings || !Array.isArray(portfolio.holdings)) {
        throw new Error('Invalid portfolio data');
      }

      // Calculate total value and prepare holdings
      let totalValue = 0;
      const holdings = portfolio.holdings
        .sort((a, b) => b.value - a.value)
        .map(h => {
          totalValue += h.value;
          return `**${h.currency}**: $${h.value.toFixed(2)} (${h.amount.toFixed(6)})`;
        });

      // Get trading status
      const tradingResponse = await fetch('http://localhost:5000/api/independent-trading/status/user-1');
      const tradingData = await tradingResponse.json();

      // Build embed
      embed = new EmbedBuilder()
        .setTitle('💰 Live Trading Portfolio')
        .setColor(0x00ff00)
        .setDescription(`💎 Your Crypto Holdings (${holdings.length})\n${holdings.join('\n')}\n\n💰 **Total Value**: $${totalValue.toFixed(2)}`);

      // Add trading engine status if available
      if (tradingData.running && tradingData.trigger && tradingData.baseline) {
        const trigger = tradingData.trigger;
        const baseline = tradingData.baseline;
        const needed = trigger - totalValue;
        const gainFromBaseline = totalValue - baseline;
        const progressPercent = Math.round((gainFromBaseline / 1.04) * 100);

        let triggerStatus;
        if (totalValue >= trigger) {
          triggerStatus = `🎯 **READY TO TRADE!** Portfolio hit trigger!`;
        } else {
          triggerStatus = `⏳ Need $${needed.toFixed(2)} more to trigger`;
        }
        
        embed.addFields([
          { 
            name: '🎯 Swing Trading Engine (Live)', 
            value: `📊 **Current Portfolio**: $${totalValue.toFixed(2)}\n` +
                  `📍 **Last Reset Point**: $${baseline.toFixed(2)}\n` +
                  `🎯 **Trade Trigger**: $${trigger.toFixed(2)} (${baseline.toFixed(2)} + $1.04)\n` +
                  `💰 **Portfolio Gain**: +$${gainFromBaseline.toFixed(2)} (${progressPercent}% to trigger)\n` +
                  `${triggerStatus}`,
            inline: false 
          }
        ]);
      }

      // Add timestamp
      embed.addFields([
        { name: '🕐 Last Updated', value: timestamp, inline: true }
      ]);

      embed.setTimestamp();

      // Update the embed
      await embedMessage.edit({ embeds: [embed] });
      console.log(`✅ [${timestamp}] Bulletproof update successful`);

    } catch (error) {
      console.error('❌ Update error:', error.message);
    }
  }
});

// Error handling
client.on('error', error => {
  console.error('❌ Discord error:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('❌ Login failed:', error.message);
  process.exit(1);
});