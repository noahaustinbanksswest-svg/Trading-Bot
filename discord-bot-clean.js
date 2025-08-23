#!/usr/bin/env node

// CLEAN DISCORD BOT - 24/7 EMBEDS WITH TRADINGENGINE API INTEGRATION
// This bot ONLY handles Discord embeds and calls the independent TradingEngine API

import { Client, GatewayIntentBits, EmbedBuilder, ActivityType } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// Bot configuration
const CONFIG = {
  embedChannelId: '1293662883025752156',
  embedMessageId: null,
  updateInterval: 1000, // 1 second for 24/7 updates
  tradingEngineUrl: 'http://localhost:5000/api/trading/execute-swing-trade'
};

// Portfolio tracking
let lastPortfolioValue = 0;
let triggerTarget = 282.88; // $281.88 baseline + $1.00

console.log('🤖 Starting CLEAN Discord Bot for 24/7 embeds...');

client.once('ready', async () => {
  console.log(`✅ Discord bot logged in as ${client.user.tag}`);
  console.log(`🎯 Target trigger: $${triggerTarget.toFixed(2)}`);
  
  // Set bot status
  client.user.setPresence({
    activities: [{ name: '24/7 Portfolio Monitoring', type: ActivityType.Watching }],
    status: 'online'
  });
  
  // Start 24/7 embed updates
  startEmbedUpdates();
  
  console.log('🚀 24/7 embed updates started!');
});

async function startEmbedUpdates() {
  setInterval(async () => {
    try {
      await updatePortfolioEmbed();
    } catch (error) {
      console.error('❌ Error updating embed:', error.message);
    }
  }, CONFIG.updateInterval);
}

async function updatePortfolioEmbed() {
  try {
    const channel = client.channels.cache.get(CONFIG.embedChannelId);
    if (!channel) {
      console.error('❌ Channel not found');
      return;
    }

    // Get portfolio data (mock data for now since Gemini service not initialized)
    const portfolioData = {
      totalValue: 281.88, // Mock current value
      holdings: [
        {
          currency: 'SOL',
          amount: 1.234567,
          value: 281.88,
          price: 228.34
        }
      ]
    };

    const embed = new EmbedBuilder()
      .setTitle('🎯 SOL Trading Bot - 24/7 Live Portfolio')
      .setColor(portfolioData.totalValue >= triggerTarget ? 0x00FF00 : 0x3498DB)
      .addFields([
        {
          name: '💰 Current Portfolio Value',
          value: `$${portfolioData.totalValue.toFixed(2)}`,
          inline: true
        },
        {
          name: '🎯 Next Trigger Level',
          value: `$${triggerTarget.toFixed(2)}`,
          inline: true
        },
        {
          name: '📊 SOL Holdings',
          value: `${portfolioData.holdings[0]?.amount.toFixed(8) || '0'} SOL`,
          inline: true
        },
        {
          name: '💵 SOL Price',
          value: `$${portfolioData.holdings[0]?.price.toFixed(2) || '0'}`,
          inline: true
        },
        {
          name: '🔄 Status',
          value: portfolioData.totalValue >= triggerTarget ? '🟢 TRIGGER READY' : '🟡 MONITORING',
          inline: true
        },
        {
          name: '⏰ Last Update',
          value: `<t:${Math.floor(Date.now() / 1000)}:T>`,
          inline: true
        }
      ])
      .setFooter({
        text: '24/7 Automated Trading • TradingEngine API Integration',
        iconURL: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/bitcoin/bitcoin-original.svg'
      })
      .setTimestamp();

    // Check if trigger should fire
    if (portfolioData.totalValue >= triggerTarget) {
      console.log(`🚨 TRIGGER DETECTED: $${portfolioData.totalValue} >= $${triggerTarget}`);
      await callTradingEngine('Portfolio trigger reached');
      triggerTarget = portfolioData.totalValue + 1.00; // Update trigger for next $1
    }

    // Update or create embed
    if (CONFIG.embedMessageId) {
      try {
        const message = await channel.messages.fetch(CONFIG.embedMessageId);
        await message.edit({ embeds: [embed] });
      } catch (error) {
        // Message not found, create new one
        const newMessage = await channel.send({ embeds: [embed] });
        CONFIG.embedMessageId = newMessage.id;
      }
    } else {
      const newMessage = await channel.send({ embeds: [embed] });
      CONFIG.embedMessageId = newMessage.id;
    }

  } catch (error) {
    console.error('❌ Error in updatePortfolioEmbed:', error.message);
  }
}

async function callTradingEngine(reason) {
  try {
    console.log('📡 Calling TradingEngine API...');
    const response = await fetch(CONFIG.tradingEngineUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'discord-bot',
        reason: reason,
        amount: 1.00
      })
    });
    
    const result = await response.json();
    console.log('✅ TradingEngine response:', result);
    return result;
  } catch (error) {
    console.error('❌ TradingEngine API error:', error.message);
    return null;
  }
}

// Error handling
client.on('error', error => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
});

// Start the bot
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN environment variable is required');
  process.exit(1);
}

client.login(DISCORD_TOKEN);
console.log('🤖 Clean Discord bot starting for 24/7 embeds...');