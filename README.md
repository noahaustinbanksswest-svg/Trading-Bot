# Gemini Discord Trading Bot

A Discord bot that integrates with the Gemini cryptocurrency exchange API to provide real-time portfolio tracking, automated trading, and live price monitoring through Discord embeds and interactive buttons.

## Features

- 📊 **Live Portfolio Tracking** - Real-time cryptocurrency holdings and USD balance display
- 🤖 **Automated Trading** - Stop-loss and take-profit automation with configurable settings
- 📈 **Interactive Embeds** - Discord embeds with buttons for trading controls
- 💰 **Price Monitoring** - Live cryptocurrency price updates and alerts
- ⚡ **Quick Trading** - One-click buy/sell buttons for rapid trading
- 🛑 **Emergency Stop** - Instant trading halt and order cancellation

## Setup Instructions

### 1. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable all required intents
6. Invite bot to your server with appropriate permissions

### 2. Gemini API Setup

1. Create account at [Gemini Exchange](https://www.gemini.com/)
2. Generate API keys in your account settings
3. For testing, use [Gemini Sandbox](https://exchange.sandbox.gemini.com/)

### 3. Environment Configuration

1. Copy `.env.example` to `.env`
2. Fill in your Discord and Gemini credentials
3. Set NODE_ENV to 'development' for sandbox testing

### 4. Installation and Run

```bash
npm install
npm start
```

## Discord Commands

- `/portfolio` - Display complete portfolio with interactive buttons
- `/settings` - Configure trading parameters (daily limits, stop-loss, take-profit)
- `/trade` - Execute manual trades
- `/prices` - Get live cryptocurrency prices

## Interactive Buttons

- 🔄 **Refresh** - Update portfolio display
- ⚡ **Toggle Trading** - Enable/disable automated trading
- 📋 **Active Orders** - View current open orders
- ⬆️ **Quick Buy BTC** - Instant Bitcoin purchase
- 🛑 **Emergency Stop** - Stop all trading and cancel orders

## Trading Settings

- **Daily Buy Limit** - Maximum USD amount for daily purchases
- **Stop Loss %** - Automatic sell trigger when losses reach percentage
- **Take Profit %** - Automatic sell trigger when profits reach percentage
- **Enabled Pairs** - Cryptocurrency pairs available for trading

## Security Notes

- Never share your API keys
- Use sandbox mode for testing
- Set appropriate trading limits
- Monitor bot activity regularly

## Support

For issues or questions, check the logs and verify your API credentials are correct.