import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

// Test with minimal intents first
console.log('🔍 Testing Discord bot connection with your token...');

const client = new Client({
  intents: [GatewayIntentBits.Guilds] // Minimal intents to test connection
});

client.once('ready', () => {
  console.log(`✅ SUCCESS! Bot connected as ${client.user.tag}`);
  console.log(`📊 Connected to ${client.guilds.cache.size} servers`);
  
  // List available channels
  client.guilds.cache.forEach(guild => {
    console.log(`🏰 Guild: ${guild.name}`);
    guild.channels.cache.forEach(channel => {
      if (channel.isTextBased()) {
        console.log(`  📝 Channel: #${channel.name} (ID: ${channel.id})`);
      }
    });
  });
  
  process.exit(0);
});

client.on('error', (error) => {
  console.error('❌ Discord Error:', error.message);
  process.exit(1);
});

const token = process.env.DISCORD_BOT_TOKEN;
console.log(`🔑 Using token: ${token ? token.substring(0, 20) + '...' : 'NO TOKEN'}`);

client.login(token)
  .then(() => console.log('🔗 Login attempt successful'))
  .catch(error => {
    console.error('❌ Login failed:', error.message);
    console.log('');
    console.log('🔧 Possible fixes:');
    console.log('1. Check bot permissions in Discord Developer Portal');
    console.log('2. Make sure bot is added to your server');
    console.log('3. Verify MESSAGE CONTENT INTENT is enabled if needed');
    process.exit(1);
  });