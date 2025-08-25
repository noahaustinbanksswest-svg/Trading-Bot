import { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

console.log('🚀 Starting Working Discord Bot...');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let dashboardMessageId = null;
let dashboardChannelId = null;

client.once('ready', async () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log('🔍 Finding #new-dashboard channel...');
  
  const guild = client.guilds.cache.first();
  const channel = guild.channels.cache.find(c => c.name === 'new-dashboard' && c.isTextBased());
  
  if (channel) {
    console.log(`✅ Found #new-dashboard channel`);
    dashboardChannelId = channel.id;
    
    // Find existing embed
    const messages = await channel.messages.fetch({ limit: 50 });
    const existingEmbed = messages.find(msg => 
      msg.author.id === client.user.id && 
      msg.embeds.length > 0 && 
      msg.embeds[0].title?.includes('Portfolio')
    );
    
    if (existingEmbed) {
      dashboardMessageId = existingEmbed.id;
      console.log(`✅ Found existing embed: ${dashboardMessageId}`);
    } else {
      console.log('📊 Creating new dashboard embed...');
      const embed = await createEmbed();
      const message = await channel.send({ embeds: [embed] });
      dashboardMessageId = message.id;
      console.log(`✅ New embed created: ${message.id}`);
    }
    
    // Start live updates
    setInterval(updateDashboard, 30000);
    console.log('🔄 Live updates started every 30 seconds');
  }
});

async function createEmbed() {
  try {
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
      .setFooter({ text: '24/7 Trading Bot • Live Updates' });

    embed.addFields([
      { name: '📊 Total Value', value: `**$${totalValue.toFixed(2)}**`, inline: true },
      { name: '📈 Status', value: isActive ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },
      { name: '⚡ Connection', value: '🟢 LIVE', inline: true }
    ]);

    // Show SOL holding
    const solHolding = portfolio.holdings?.find(h => h.symbol === 'solusd');
    if (solHolding) {
      const amount = parseFloat(solHolding.amount);
      const value = parseFloat(solHolding.valueUSD);
      const price = parseFloat(solHolding.currentPrice);
      
      embed.addFields([
        { 
          name: '🪙 SOL Holdings', 
          value: `**${amount.toFixed(6)} SOL**\n$${value.toFixed(2)} USD @ $${price.toFixed(2)}`,
          inline: false 
        }
      ]);
    }

    // Trading trigger info
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
    console.error('❌ Error creating embed:', error);
    return new EmbedBuilder()
      .setTitle('💰 Trading Portfolio')
      .setDescription('⚠️ Connection Error')
      .setColor(0xFF9800);
  }
}

async function updateDashboard() {
  if (!dashboardMessageId || !dashboardChannelId) return;
  
  try {
    const channel = await client.channels.fetch(dashboardChannelId);
    const message = await channel.messages.fetch(dashboardMessageId);
    const embed = await createEmbed();
    
    await message.edit({ embeds: [embed] });
    console.log('✅ Dashboard updated');
  } catch (error) {
    console.error('❌ Update error:', error);
  }
}

client.on('error', console.error);

// Use your working token directly
const token = 'MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4';
console.log('🔗 Connecting to Discord...');

client.login(token)
  .then(() => console.log('✅ Login successful'))
  .catch(error => console.error('❌ Login failed:', error));