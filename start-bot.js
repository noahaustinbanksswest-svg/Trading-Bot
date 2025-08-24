import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if required environment variables are set
const requiredEnvVars = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID', 
  'DISCORD_GUILD_ID',
  'GEMINI_API_KEY',
  'GEMINI_API_SECRET'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.log('🚨 Missing required environment variables:');
  missingVars.forEach(varName => {
    console.log(`   - ${varName}`);
  });
  console.log('\n📝 Please set these environment variables before starting the bot.');
  console.log('💡 You can copy .env.example to .env and fill in your credentials.\n');
  process.exit(1);
}

console.log('🚀 Starting Gemini Discord Trading Bot...');
console.log('🔧 Environment variables configured correctly');

// Start the Discord bot
import('./discord-bot.js');