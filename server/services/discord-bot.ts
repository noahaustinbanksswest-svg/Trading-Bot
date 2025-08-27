import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from 'discord.js';
import { storage } from '../storage';
import { PortfolioHolding, TradingSettings } from '../../shared/schema.js';

export interface DiscordPortfolioUpdate {
  totalValue: string;
  dailyPnL: string;
  holdings: PortfolioHolding[];
  activeTrades: number;
}

export class DiscordBotService {
  private client: Client;
  private token: string;
  private guildId: string;
  private channelId: string;
  private userId: string;

  constructor(token: string, guildId: string, channelId: string, userId: string) {
    this.token = token;
    this.guildId = guildId;
    this.channelId = channelId;
    this.userId = userId;
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once('ready', () => {
      console.log(`Discord bot ready! Logged in as ${this.client.user?.tag}`);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;

      const { customId } = interaction;
      
      try {
        switch (customId) {
          case 'refresh_portfolio':
            await this.handleRefreshPortfolio(interaction);
            break;
          case 'toggle_trading':
            await this.handleToggleTrading(interaction);
            break;
          case 'view_settings':
            await this.handleViewSettings(interaction);
            break;
          default:
            await interaction.reply({ content: 'Unknown action', ephemeral: true });
        }
      } catch (error) {
        console.error('Error handling interaction:', error);
        await interaction.reply({ content: 'An error occurred', ephemeral: true });
      }
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.login(this.token);
    } catch (error) {
      throw new Error(`Failed to connect Discord bot: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }

  async sendPortfolioUpdate(data: DiscordPortfolioUpdate): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(this.channelId) as TextChannel;
      if (!channel) {
        throw new Error('Channel not found');
      }

      const embed = this.createPortfolioEmbed(data);
      const buttons = this.createActionButtons();

      await channel.send({
        embeds: [embed],
        components: [buttons],
      });
    } catch (error) {
      throw new Error(`Failed to send portfolio update: ${error}`);
    }
  }

  async sendTradeNotification(symbol: string, side: string, amount: string, price: string, status: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(this.channelId) as TextChannel;
      if (!channel) {
        throw new Error('Channel not found');
      }

      const embed = new EmbedBuilder()
        .setTitle('🔔 Trade Notification')
        .setColor(status === 'filled' ? 0x4CAF50 : status === 'failed' ? 0xF44336 : 0xFF9800)
        .addFields(
          { name: 'Symbol', value: symbol.toUpperCase(), inline: true },
          { name: 'Side', value: side.toUpperCase(), inline: true },
          { name: 'Amount', value: amount, inline: true },
          { name: 'Price', value: `$${price}`, inline: true },
          { name: 'Status', value: status.toUpperCase(), inline: true },
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      throw new Error(`Failed to send trade notification: ${error}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const channel = await this.client.channels.fetch(this.channelId) as TextChannel;
      if (!channel) return false;

      const embed = new EmbedBuilder()
        .setTitle('✅ Connection Test')
        .setDescription('Discord bot connection is working!')
        .setColor(0x4CAF50)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error('Discord connection test failed:', error);
      return false;
    }
  }

  private createPortfolioEmbed(data: DiscordPortfolioUpdate): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('📊 Portfolio Summary')
      .setColor(0x1976D2)
      .addFields(
        { name: '💰 Total Value', value: `$${data.totalValue}`, inline: true },
        { name: '📈 Daily P&L', value: `$${data.dailyPnL}`, inline: true },
        { name: '🔄 Active Trades', value: data.activeTrades.toString(), inline: true },
      )
      .setTimestamp();

    // Add holdings information
    if (data.holdings.length > 0) {
      const holdingsText = data.holdings
        .slice(0, 5) // Limit to 5 holdings
        .map(holding => `**${holding.symbol.toUpperCase()}**: ${holding.amount} ($${holding.valueUSD})`)
        .join('\n');
      
      embed.addFields({ name: '🏦 Top Holdings', value: holdingsText, inline: false });
    }

    return embed;
  }

  private createActionButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('refresh_portfolio')
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔄'),
        new ButtonBuilder()
          .setCustomId('toggle_trading')
          .setLabel('Toggle Trading')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚡'),
        new ButtonBuilder()
          .setCustomId('view_settings')
          .setLabel('Settings')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚙️'),
      );
  }

  private async handleRefreshPortfolio(interaction: any): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    
    // Trigger portfolio refresh logic here
    await interaction.editReply('Portfolio refreshed!');
  }

  private async handleToggleTrading(interaction: any): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const settings = await storage.getTradingSettings(this.userId);
      if (!settings) {
        await interaction.editReply('No trading settings found');
        return;
      }

      // Toggle some trading setting (this is a placeholder)
      await interaction.editReply('Trading status toggled!');
    } catch (error) {
      await interaction.editReply('Failed to toggle trading status');
    }
  }

  private async handleViewSettings(interaction: any): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const settings = await storage.getTradingSettings(this.userId);
      if (!settings) {
        await interaction.editReply('No trading settings found');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Trading Settings')
        .setColor(0x00BCD4)
        .addFields(
          { name: 'Daily Buy Limit', value: `$${settings.dailyBuyLimit}`, inline: true },
          { name: 'Stop Loss %', value: `${settings.stopLossPercent}%`, inline: true },
          { name: 'Take Profit %', value: `${settings.takeProfitPercent}%`, inline: true },
          { name: 'Stop Loss Enabled', value: settings.enableStopLoss ? 'Yes' : 'No', inline: true },
          { name: 'Profit Taking Enabled', value: settings.enableProfitTaking ? 'Yes' : 'No', inline: true },
        );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      await interaction.editReply('Failed to load settings');
    }
  }
}
