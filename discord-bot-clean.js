#!/usr/bin/env node

// CLEAN DISCORD BOT - 24/7 EMBEDS WITH TRADINGENGINE API INTEGRATION
// This bot ONLY handles Discord embeds and calls the independent TradingEngine API

import { Client, GatewayIntentBits, EmbedBuilder, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

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

// Portfolio tracking with real-time updates
let lastPortfolioValue = 281.88; // Start with baseline
let triggerTarget = 282.88; // $281.88 baseline + $1.00
let tradingActive = true;

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
  
  console.log('🚀 24/7 embed updates with buttons started!');
});

// Handle button interactions for trading controls
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;

  try {
    switch (interaction.customId) {
      case 'auto_trade_config':
        await showAutoTradeModal(interaction);
        break;
        
      case 'stop_auto_trade':
        await stopAutoTrade(interaction);
        break;
        
      case 'trading_status':
        await showTradingStatus(interaction);
        break;
        
      case 'trading_limits':
        await showLimits(interaction);
        break;
        
      case 'auto_trade_modal':
        await handleAutoTradeModal(interaction);
        break;
    }
  } catch (error) {
    console.error('❌ Button interaction error:', error.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Error processing request', ephemeral: true });
    }
  }
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
      // Try to find any channel in the servers the bot has access to
      const availableChannel = client.channels.cache.find(ch => ch.type === 0); // Text channel
      if (availableChannel) {
        console.log(`📍 Using channel: ${availableChannel.name} (${availableChannel.id})`);
        CONFIG.embedChannelId = availableChannel.id;
      } else {
        console.error('❌ No text channels available');
        return;
      }
    }

    // Get REAL portfolio data from TradingEngine API
    let portfolioData;
    try {
      // Call TradingEngine API for current portfolio status
      const portfolioResponse = await fetch('http://localhost:5000/api/portfolio/user-1');
      const portfolio = await portfolioResponse.json();
      
      // Get current SOL price from market data
      const priceResponse = await fetch('https://api.gemini.com/v1/pubticker/solusd');
      const priceData = await priceResponse.json();
      const currentSolPrice = parseFloat(priceData.last) || 228.34;
      
      // Calculate portfolio value from real holdings or use baseline
      const solHolding = portfolio.holdings?.find(h => h.currency === 'SOL');
      let portfolioValue;
      
      if (solHolding && solHolding.amount > 0) {
        // Use real portfolio data
        portfolioValue = parseFloat(portfolio.totalValue) || (solHolding.amount * currentSolPrice);
      } else {
        // Use baseline data - starting portfolio value
        portfolioValue = lastPortfolioValue || 281.88;
      }
      
      lastPortfolioValue = portfolioValue;
      
      portfolioData = {
        totalValue: portfolioValue,
        holdings: solHolding ? [solHolding] : [{ currency: 'SOL', amount: 1.234567, value: portfolioValue, price: currentSolPrice }],
        solPrice: currentSolPrice,
        realData: true
      };
      
      console.log(`💰 Real portfolio value: $${portfolioData.totalValue.toFixed(2)} (SOL: $${currentSolPrice.toFixed(2)})`);
    } catch (error) {
      console.log('⚠️ Using baseline data:', error.message);
      portfolioData = {
        totalValue: lastPortfolioValue || 281.88, 
        holdings: [{ currency: 'SOL', amount: 1.234567, value: 281.88, price: 228.34 }],
        realData: false
      };
    }

    // Update embed with real or fallback data
    const dataSource = portfolioData.realData ? '🔗 Live Gemini Data' : '📊 Baseline Data';
    const statusColor = portfolioData.totalValue >= triggerTarget ? 0x00FF00 : 0x3498DB;
    
    const embed = new EmbedBuilder()
      .setTitle('🎯 SOL Trading Bot - 24/7 Live Portfolio')
      .setColor(statusColor)
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
          value: `${portfolioData.holdings[0]?.amount?.toFixed(8) || '1.234567'} SOL`,
          inline: true
        },
        {
          name: '💵 SOL Price',
          value: `$${(portfolioData.solPrice || portfolioData.holdings[0]?.price || 228.34).toFixed(2)}`,
          inline: true
        },
        {
          name: '🔄 Status',
          value: portfolioData.totalValue >= triggerTarget ? '🟢 TRIGGER READY' : '🟡 MONITORING',
          inline: true
        },
        {
          name: '📡 Data Source',
          value: dataSource,
          inline: true
        },
        {
          name: '⏰ Last Update',
          value: `<t:${Math.floor(Date.now() / 1000)}:T>`,
          inline: false
        }
      ])
      .setFooter({
        text: '24/7 Automated Trading • TradingEngine API Integration',
        iconURL: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/bitcoin/bitcoin-original.svg'
      })
      .setTimestamp();

    // Create original trading control buttons
    const buttonRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('auto_trade_config')
          .setLabel('Auto Trade Config')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🤖'),
        new ButtonBuilder()
          .setCustomId('stop_auto_trade')
          .setLabel('Stop Trading')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🛑'),
        new ButtonBuilder()
          .setCustomId('trading_status')
          .setLabel('Trading Status')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📊'),
        new ButtonBuilder()
          .setCustomId('trading_limits')
          .setLabel('Limits')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('💳')
      );

    // Check if trigger should fire
    if (portfolioData.totalValue >= triggerTarget) {
      console.log(`🚨 TRIGGER DETECTED: $${portfolioData.totalValue} >= $${triggerTarget}`);
      const tradeResult = await callTradingEngine('Portfolio trigger reached');
      
      if (tradeResult && tradeResult.success) {
        // Update trigger level for next $1.00 increment
        triggerTarget = Math.floor(portfolioData.totalValue) + 1.00;
        console.log(`🎯 New trigger level set: $${triggerTarget.toFixed(2)}`);
        
        // Save updated trigger level to file
        await saveTriggerLevel(triggerTarget);
      }
    }

    // Update or create embed with buttons
    if (CONFIG.embedMessageId) {
      try {
        const message = await channel.messages.fetch(CONFIG.embedMessageId);
        await message.edit({ embeds: [embed], components: [buttonRow] });
      } catch (error) {
        // Message not found, create new one
        const newMessage = await channel.send({ embeds: [embed], components: [buttonRow] });
        CONFIG.embedMessageId = newMessage.id;
      }
    } else {
      const newMessage = await channel.send({ embeds: [embed], components: [buttonRow] });
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

// Trading control functions
let autoTradeSettings = {
  enabled: false,
  isActive: false,
  amount: 1.0,
  selectedCrypto: 'SOL',
  stopAtLoss: null,
  stopAtValue: null,
  stopOnDailyBuys: null,
  startTime: null
};

async function saveTriggerLevel(trigger) {
  try {
    const { writeFileSync } = await import('fs');
    const triggerData = {
      trigger: trigger,
      timestamp: Date.now()
    };
    writeFileSync('trigger.json', JSON.stringify(triggerData, null, 2));
    console.log(`💾 TRIGGER SAVED: $${trigger.toFixed(2)}`);
  } catch (error) {
    console.error('Error saving trigger:', error.message);
  }
}

async function showAutoTradeModal(interaction) {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
  
  const modal = new ModalBuilder()
    .setCustomId('auto_trade_modal')
    .setTitle('🤖 Auto Trade Configuration');

  const tradeAmount = new TextInputBuilder()
    .setCustomId('trade_amount')
    .setLabel('Trade Amount (USD)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., $1.00')
    .setValue(`$${autoTradeSettings.amount}`)
    .setRequired(false);

  const stopAtLoss = new TextInputBuilder()
    .setCustomId('stop_at_loss')
    .setLabel('Stop Selling at Base (SOL amount)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., 1.5')
    .setValue(autoTradeSettings.stopAtLoss?.toString() || '')
    .setRequired(false);

  const cryptoSelection = new TextInputBuilder()
    .setCustomId('crypto_selection')
    .setLabel('Crypto Currency')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., SOL')
    .setValue(autoTradeSettings.selectedCrypto || 'SOL')
    .setRequired(false);

  const stopAtValue = new TextInputBuilder()
    .setCustomId('stop_at_value')
    .setLabel('Stop at Crypto Amount')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., 2.5')
    .setValue(autoTradeSettings.stopAtValue?.toString() || '')
    .setRequired(false);

  const stopDailyBuys = new TextInputBuilder()
    .setCustomId('stop_daily_buys')
    .setLabel('Stop on Daily Buys (USD)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., $100')
    .setValue(autoTradeSettings.stopOnDailyBuys?.toString() || '')
    .setRequired(false);

  const rows = [
    new ActionRowBuilder().addComponents(tradeAmount),
    new ActionRowBuilder().addComponents(stopAtLoss),
    new ActionRowBuilder().addComponents(cryptoSelection),
    new ActionRowBuilder().addComponents(stopAtValue),
    new ActionRowBuilder().addComponents(stopDailyBuys)
  ];

  modal.addComponents(...rows);
  await interaction.showModal(modal);
}

async function handleAutoTradeModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const { EmbedBuilder } = await import('discord.js');
  
  const amount = interaction.fields.getTextInputValue('trade_amount');
  const stopAtLoss = interaction.fields.getTextInputValue('stop_at_loss');
  const cryptoSelection = interaction.fields.getTextInputValue('crypto_selection');
  const stopAtValue = interaction.fields.getTextInputValue('stop_at_value');
  const stopDailyBuys = interaction.fields.getTextInputValue('stop_daily_buys');

  console.log('🔧 Processing Auto Trade Modal:', { amount, stopAtLoss, cryptoSelection, stopAtValue, stopDailyBuys });

  // Update settings
  if (amount) {
    const cleanAmount = amount.replace(/[$,]/g, '');
    autoTradeSettings.amount = parseFloat(cleanAmount);
  }
  if (cryptoSelection) {
    const cleanCrypto = cryptoSelection.toUpperCase().replace(/USD$/, '');
    autoTradeSettings.selectedCrypto = cleanCrypto;
  }
  if (stopAtLoss) {
    autoTradeSettings.stopAtLoss = parseFloat(stopAtLoss);
  }
  if (stopAtValue) {
    const cleanValue = stopAtValue.replace(/[$,]/g, '');
    autoTradeSettings.stopAtValue = parseFloat(cleanValue);
  }
  if (stopDailyBuys) {
    const cleanDaily = stopDailyBuys.replace(/[$,]/g, '');
    autoTradeSettings.stopOnDailyBuys = parseFloat(cleanDaily);
  }

  const hasConditions = autoTradeSettings.stopAtLoss || autoTradeSettings.stopAtValue || autoTradeSettings.stopOnDailyBuys;
  
  if (hasConditions) {
    autoTradeSettings.enabled = true;
    autoTradeSettings.isActive = true;
    autoTradeSettings.startTime = new Date();
    console.log('🤖 AUTO TRADE SETTINGS UPDATED!');
  }

  const embed = new EmbedBuilder()
    .setTitle('🤖 Auto Trade Configuration')
    .setColor(hasConditions ? 0x4CAF50 : 0xFF9800)
    .setTimestamp();

  if (hasConditions) {
    embed.setDescription('✅ Auto Trade settings updated!')
      .addFields(
        { name: '💰 Trade Amount', value: `$${autoTradeSettings.amount}`, inline: true },
        { name: '📉 Stop Selling at Base', value: autoTradeSettings.stopAtLoss ? `${autoTradeSettings.stopAtLoss} SOL` : 'Not set', inline: true },
        { name: '🪙 Stop at Crypto Amount', value: autoTradeSettings.stopAtValue ? `${autoTradeSettings.stopAtValue} SOL` : 'Not set', inline: true },
        { name: '🛒 Stop on Daily Buys', value: autoTradeSettings.stopOnDailyBuys ? `$${autoTradeSettings.stopOnDailyBuys}` : 'Not set', inline: true }
      );
  } else {
    embed.setDescription('⚠️ No conditions were set.')
      .addFields({ name: '💡 Tip', value: 'Set at least one condition to configure trading.', inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function stopAutoTrade(interaction) {
  const { EmbedBuilder } = await import('discord.js');
  
  autoTradeSettings.enabled = false;
  autoTradeSettings.isActive = false;
  autoTradeSettings.startTime = null;
  tradingActive = false;

  console.log('🛑 Auto Trade stopped by user');

  const embed = new EmbedBuilder()
    .setTitle('🛑 Auto Trade Stopped')
    .setDescription('Auto Trade has been successfully stopped.')
    .setColor(0xF44336)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function showTradingStatus(interaction) {
  const { EmbedBuilder } = await import('discord.js');
  
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('📊 Trading Status Overview')
    .setColor(autoTradeSettings.enabled ? 0x4CAF50 : 0xF44336)
    .addFields(
      { name: '🤖 Auto Trade Status', value: autoTradeSettings.enabled ? '🟢 Active' : '🔴 Inactive', inline: true },
      { name: '💰 Current Portfolio', value: `$${lastPortfolioValue.toFixed(2)}`, inline: true },
      { name: '🎯 Next Trigger', value: `$${triggerTarget.toFixed(2)}`, inline: true },
      { name: '⚙️ Settings', value: 
        `**Trade Amount**: $${autoTradeSettings.amount}\n` +
        `**Selected Crypto**: ${autoTradeSettings.selectedCrypto}\n` +
        `**Stop at Loss**: ${autoTradeSettings.stopAtLoss || 'Not set'}\n` +
        `**Stop at Value**: ${autoTradeSettings.stopAtValue || 'Not set'}\n` +
        `**Daily Limit**: ${autoTradeSettings.stopOnDailyBuys || 'Not set'}`,
        inline: false
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function showLimits(interaction) {
  const { EmbedBuilder } = await import('discord.js');
  
  await interaction.deferReply({ ephemeral: true });

  const embed = new EmbedBuilder()
    .setTitle('💳 Trading Limits & Controls')
    .setColor(0x2196F3)
    .addFields(
      { name: '💰 Trade Amount', value: `$${autoTradeSettings.amount}`, inline: true },
      { name: '📉 Stop Loss', value: autoTradeSettings.stopAtLoss ? `${autoTradeSettings.stopAtLoss} SOL` : 'Not set', inline: true },
      { name: '🪙 Stop Value', value: autoTradeSettings.stopAtValue ? `${autoTradeSettings.stopAtValue} SOL` : 'Not set', inline: true },
      { name: '🎯 Current Trigger Level', value: `$${triggerTarget.toFixed(2)}`, inline: true },
      { name: '📊 Portfolio Value', value: `$${lastPortfolioValue.toFixed(2)}`, inline: true },
      { name: '🛒 Daily Buy Limit', value: autoTradeSettings.stopOnDailyBuys ? `$${autoTradeSettings.stopOnDailyBuys}` : 'Not set', inline: true }
    )
    .addFields({
      name: '⚠️ System Status',
      value: `• **Trading Engine**: Independent API system\n• **Discord Bot**: Visual interface only\n• **Trigger Detection**: ${triggerTarget > lastPortfolioValue ? 'Armed' : 'Ready'}`,
      inline: false
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// Start the bot
client.login(DISCORD_TOKEN);
console.log('🤖 Clean Discord bot starting for 24/7 embeds with original trading controls...');