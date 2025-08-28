#!/usr/bin/env node

// Redeploy Discord bot with updated code
import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

async function redeployBot() {
  console.log('🔄 Redeploying Discord bot with updated code...');
  
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.on('ready', async () => {
    console.log(`✅ Bot ready as ${client.user.tag}`);
    
    // Find the public dashboard channel
    const guild = client.guilds.cache.get(GUILD_ID);
    const channel = guild.channels.cache.find(ch => ch.name === 'public-dashboard');
    
    if (channel) {
      // Update the dashboard message with current buttons
      const dashboardEmbed = new EmbedBuilder()
        .setTitle('🚀 Day Trading Bot Dashboard')
        .setDescription('**Multi-User Cryptocurrency Trading Platform**\n\nWelcome to the Day Trading Bot! Each user gets their own secure trading environment with individual Gemini API connections.')
        .addFields(
          { name: '🎯 Features', value: '• Individual Gemini API key storage\n• Isolated trading environments per user\n• Real-time portfolio monitoring\n• Automated swing trading for SOL\n• Secure user account management', inline: false },
          { name: '🔐 Security', value: 'Your API credentials are stored securely and only accessible by you. Each user has a completely separate trading instance.', inline: false },
          { name: '📊 Getting Started', value: '1. Click **Create Account** to set up your trading profile\n2. Enter your Gemini API credentials securely\n3. Access your **Portfolio** dashboard to start trading', inline: false }
        )
        .setColor(0x00D4AA)
        .setFooter({ text: 'Day Trading Bot • Secure Multi-User Platform' })
        .setTimestamp();

      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('create_account')
            .setLabel('Create Account')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🚀'),
          new ButtonBuilder()
            .setCustomId('view_portfolio')
            .setLabel('Portfolio')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📊')
        );

      // Get existing messages and update the dashboard
      const messages = await channel.messages.fetch({ limit: 10 });
      const botMessages = messages.filter(msg => msg.author.id === client.user.id);
      
      if (botMessages.size > 0) {
        const latestMessage = botMessages.first();
        await latestMessage.edit({
          embeds: [dashboardEmbed],
          components: [actionRow]
        });
        console.log('✅ Dashboard updated with fixed buttons');
      } else {
        await channel.send({
          embeds: [dashboardEmbed],
          components: [actionRow]
        });
        console.log('✅ New dashboard message created');
      }
    }
    
    console.log('🎯 Bot redeployment complete - buttons should now work properly');
    process.exit(0);
  });

  await client.login(BOT_TOKEN);
}

redeployBot().catch(console.error);