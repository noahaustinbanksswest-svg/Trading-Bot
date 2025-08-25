import { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';

console.log('🚀 FIRST ORIGINAL Discord Bot - TRUE FORMAT');

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
      const embed = await createFirstOriginalEmbed();
      const message = await channel.send({ embeds: [embed] });
      dashboardMessageId = message.id;
      console.log(`✅ New embed created: ${message.id}`);
    }
    
    // Start live updates every 30 seconds - exactly like original
    setInterval(updateDashboard, 30000);
    console.log('🔄 Live updates started every 30 seconds');
  }
});

async function createFirstOriginalEmbed() {
  try {
    const portfolioRes = await fetch('http://localhost:5000/api/portfolio/user-1');
    const portfolio = await portfolioRes.json();
    
    const statusRes = await fetch('http://localhost:5000/api/independent-trading/status/user-1');
    const status = await statusRes.json();
    
    const isActive = status.running || false;
    const totalValue = parseFloat(portfolio.totalValue);
    
    // EXACT FIRST ORIGINAL FORMAT
    const embed = new EmbedBuilder()
      .setTitle('💰 Live Trading Portfolio')
      .setColor(isActive ? 0x00FF00 : 0xFF0000)  // Pure green/red like original
      .setTimestamp()
      .setFooter({ text: '24/7 Trading Bot • Live Updates' });  // Exact original footer

    // Original three fields - EXACT format
    embed.addFields([
      { name: '📊 Total Value', value: `**$${totalValue.toFixed(2)}**`, inline: true },
      { name: '📈 Status', value: isActive ? '🟢 ACTIVE' : '🔴 OFFLINE', inline: true },  // Original status format
      { name: '⚡ Connection', value: '🟢 LIVE', inline: true }  // Original connection field
    ]);

    // ALL Crypto Holdings - show everything you own
    if (portfolio.holdings && portfolio.holdings.length > 0) {
      let allHoldings = '';
      let totalDisplayed = 0;
      
      portfolio.holdings.forEach(holding => {
        const symbol = holding.symbol.replace('usd', '').toUpperCase();
        const amount = parseFloat(holding.amount);
        const value = parseFloat(holding.valueUSD);
        const price = parseFloat(holding.currentPrice);
        
        // Only show holdings with actual amounts (even very small ones)
        if (amount > 0.000001 && totalDisplayed < 8) { // Show meaningful amounts only
          allHoldings += `🪙 **${symbol}**: ${amount.toFixed(6)} ($${value.toFixed(2)} @ $${price.toFixed(2)})\n`;
          totalDisplayed++;
        } else if (amount > 0 && value >= 0.01) { // Show small amounts if they have decent USD value
          allHoldings += `🪙 **${symbol}**: ${amount.toFixed(8)} ($${value.toFixed(2)} @ $${price.toFixed(2)})\n`;
          totalDisplayed++;
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

    // Trading trigger - SEPARATE section as requested
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
  if (!dashboardMessageId || !dashboardChannelId) {
    console.log('⚠️ No message ID or channel - finding embed...');
    await findExistingEmbed();
    return;
  }
  
  try {
    const channel = await client.channels.fetch(dashboardChannelId);
    const message = await channel.messages.fetch(dashboardMessageId);
    const embed = await createFirstOriginalEmbed();
    
    await message.edit({ embeds: [embed] });
    console.log(`✅ [${new Date().toLocaleTimeString()}] All crypto holdings updated successfully`);
  } catch (error) {
    console.error('❌ Update error:', error.message);
    
    // Try to reconnect and find the embed again
    if (error.message.includes('Unknown Message') || error.message.includes('404')) {
      console.log('🔍 Message not found - searching for embed...');
      dashboardMessageId = null;
      dashboardChannelId = null;
      await findExistingEmbed();
    }
  }
}

// Enhanced embed finding function
async function findExistingEmbed() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return false;

    const channel = guild.channels.cache.find(c => c.name === 'new-dashboard' && c.isTextBased());
    if (!channel) return false;

    const messages = await channel.messages.fetch({ limit: 50 });
    const existingEmbed = messages.find(msg => 
      msg.author.id === client.user.id && 
      msg.embeds.length > 0 && 
      msg.embeds[0].title?.includes('Trading Portfolio')
    );
    
    if (existingEmbed) {
      dashboardMessageId = existingEmbed.id;
      dashboardChannelId = channel.id;
      console.log(`✅ Reconnected to embed: ${dashboardMessageId}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Error finding embed:', error.message);
    return false;
  }
}

client.on('error', console.error);

// Use your working token directly
const token = 'MTQwNzgyMDQ5MDM0MDMwNjk2NQ.G4C1ow.D3PCvrA6hUemKrh7hHJ2Bq_VBfbZzb7roTQ0v4';
console.log('🔗 Connecting to Discord...');

client.login(token)
  .then(() => console.log('✅ Login successful'))
  .catch(error => console.error('❌ Login failed:', error));

console.log('💎 FIRST ORIGINAL Discord Bot Format');
console.log('🟢 Pure Green/Red Colors');
console.log('📊 Original Field Names');
console.log('🔴 OFFLINE Status Format');
console.log('🎯 Separate Trigger Section Added');