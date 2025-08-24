import { GeminiService, GeminiOrderRequest } from './gemini';
import { DiscordBotService } from './discord-bot';
import { storage } from '../storage';
import { TradeOrder, TradingSettings, PortfolioHolding } from '@shared/schema';
import cron from 'node-cron';

export interface TradingEngineConfig {
  userId: string;
  geminiService: GeminiService;
  discordService?: DiscordBotService;
}

export class TradingEngine {
  private userId: string;
  private geminiService: GeminiService;
  private discordService?: DiscordBotService;
  private isRunning: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;
  
  // Discord-style swing trading variables
  private baselineValue: number = 0;
  private savedTriggerValue: number = 0;
  private lastKnownSOLAmount: number = 0;
  private triggerInitialized: boolean = false;

  constructor(config: TradingEngineConfig) {
    this.userId = config.userId;
    this.geminiService = config.geminiService;
    this.discordService = config.discordService;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Trading engine is already running');
    }

    console.log(`Starting trading engine for user ${this.userId}`);
    this.isRunning = true;

    // Start monitoring portfolio and trades
    await this.startMonitoring();

    // Schedule periodic tasks
    this.schedulePeriodicTasks();
  }

  async stop(): Promise<void> {
    console.log(`Stopping trading engine for user ${this.userId}`);
    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }

  async placeOrder(orderRequest: GeminiOrderRequest): Promise<TradeOrder> {
    try {
      // Validate order against settings
      await this.validateOrder(orderRequest);

      // Place order with Gemini
      const geminiOrder = await this.geminiService.placeOrder(orderRequest);

      // Store order in database
      const tradeOrder = await storage.createTradeOrder({
        userId: this.userId,
        geminiOrderId: geminiOrder.order_id,
        symbol: orderRequest.symbol,
        side: orderRequest.side,
        orderType: orderRequest.type,
        amount: orderRequest.amount,
        price: orderRequest.price || '0',
        status: 'pending',
      });

      // Send Discord notification
      if (this.discordService) {
        await this.discordService.sendTradeNotification(
          orderRequest.symbol,
          orderRequest.side,
          orderRequest.amount,
          orderRequest.price || 'Market',
          'pending'
        );
      }

      return tradeOrder;
    } catch (error) {
      throw new Error(`Failed to place order: ${error}`);
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      const order = await storage.getTradeOrders(this.userId).then(orders => 
        orders.find(o => o.id === orderId)
      );

      if (!order || !order.geminiOrderId) {
        throw new Error('Order not found');
      }

      // Cancel with Gemini
      await this.geminiService.cancelOrder(order.geminiOrderId);

      // Update order status
      await storage.updateTradeOrder(orderId, { status: 'cancelled' });

      // Send Discord notification
      if (this.discordService) {
        await this.discordService.sendTradeNotification(
          order.symbol,
          order.side,
          order.amount,
          order.price || 'Market',
          'cancelled'
        );
      }
    } catch (error) {
      throw new Error(`Failed to cancel order: ${error}`);
    }
  }

  private async validateOrder(orderRequest: GeminiOrderRequest): Promise<void> {
    const settings = await storage.getTradingSettings(this.userId);
    if (!settings) {
      throw new Error('No trading settings found');
    }

    // Check if symbol is enabled
    const enabledPairs = settings.enabledPairs as string[] || [];
    if (!enabledPairs.includes(orderRequest.symbol.toLowerCase())) {
      throw new Error(`Trading pair ${orderRequest.symbol} is not enabled`);
    }

    // Check daily buy limit for buy orders
    if (orderRequest.side === 'buy') {
      const todayOrders = await this.getTodayBuyOrdersValue();
      const orderValue = parseFloat(orderRequest.amount) * (parseFloat(orderRequest.price || '0'));
      
      if (todayOrders + orderValue > parseFloat(settings.dailyBuyLimit || '0')) {
        throw new Error('Daily buy limit exceeded');
      }
    }

    // Validate balance
    const balances = await this.geminiService.getBalances();
    const requiredCurrency = orderRequest.side === 'buy' ? 'USD' : orderRequest.symbol.replace('usd', '').toUpperCase();
    const balance = balances.find(b => b.currency === requiredCurrency);
    
    if (!balance || parseFloat(balance.available) < parseFloat(orderRequest.amount)) {
      throw new Error('Insufficient balance');
    }
  }

  private async getTodayBuyOrdersValue(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const orders = await storage.getTradeOrders(this.userId);
    const todayBuys = orders.filter(order => 
      order.side === 'buy' && 
      order.createdAt && 
      new Date(order.createdAt) >= today &&
      (order.status === 'filled' || order.status === 'pending')
    );

    return todayBuys.reduce((total, order) => {
      const value = parseFloat(order.executedAmount || order.amount) * parseFloat(order.executedPrice || order.price || '0');
      return total + value;
    }, 0);
  }

  private async startMonitoring(): Promise<void> {
    // Monitor orders and portfolio every 30 seconds
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.monitorOrders();
        await this.updatePortfolio();
        await this.checkStopLossAndTakeProfit();
      } catch (error) {
        console.error('Error in monitoring cycle:', error);
      }
    }, 30000);
  }

  private async monitorOrders(): Promise<void> {
    const pendingOrders = await storage.getTradeOrders(this.userId, 'pending');

    for (const order of pendingOrders) {
      try {
        if (!order.geminiOrderId) continue;

        const geminiOrder = await this.geminiService.getOrderStatus(order.geminiOrderId);
        
        let newStatus = 'pending';
        if (!geminiOrder.is_live && !geminiOrder.is_cancelled) {
          newStatus = 'filled';
        } else if (geminiOrder.is_cancelled) {
          newStatus = 'cancelled';
        }

        if (newStatus !== 'pending') {
          await storage.updateTradeOrder(order.id, {
            status: newStatus,
            executedAmount: geminiOrder.executed_amount,
            executedPrice: geminiOrder.avg_execution_price,
          });

          // Create trading history entry if filled
          if (newStatus === 'filled') {
            await storage.createTradingHistory({
              userId: this.userId,
              orderId: order.id,
              symbol: order.symbol,
              side: order.side,
              amount: geminiOrder.executed_amount,
              price: geminiOrder.avg_execution_price,
            });
          }

          // Send Discord notification
          if (this.discordService) {
            await this.discordService.sendTradeNotification(
              order.symbol,
              order.side,
              geminiOrder.executed_amount || order.amount,
              geminiOrder.avg_execution_price || order.price || 'Market',
              newStatus
            );
          }
        }
      } catch (error) {
        console.error(`Error monitoring order ${order.id}:`, error);
      }
    }
  }

  private async updatePortfolio(): Promise<void> {
    try {
      const balances = await this.geminiService.getBalances();
      const cryptoBalances = balances.filter(b => b.currency !== 'USD' && parseFloat(b.amount) > 0);

      for (const balance of cryptoBalances) {
        const symbol = `${balance.currency.toLowerCase()}usd`;
        
        try {
          const ticker = await this.geminiService.getTicker(symbol);
          const currentPrice = parseFloat(ticker.last);
          const amount = parseFloat(balance.amount);
          const valueUSD = amount * currentPrice;

          // Update or create portfolio holding
          const existingHolding = await storage.getPortfolioHoldings(this.userId)
            .then(holdings => holdings.find(h => h.symbol === symbol));

          if (existingHolding) {
            await storage.updatePortfolioHolding(this.userId, symbol, {
              amount: amount.toString(),
              currentPrice: currentPrice.toString(),
              valueUSD: valueUSD.toString(),
            });
          } else {
            await storage.createPortfolioHolding({
              userId: this.userId,
              symbol,
              amount: amount.toString(),
              currentPrice: currentPrice.toString(),
              valueUSD: valueUSD.toString(),
            });
          }
        } catch (error) {
          console.error(`Error updating ${balance.currency} holding:`, error);
        }
      }
    } catch (error) {
      console.error('Error updating portfolio:', error);
    }
  }

  private async checkStopLossAndTakeProfit(): Promise<void> {
    const settings = await storage.getTradingSettings(this.userId);
    if (!settings) return;

    // PRIORITY: Check swing trading first (Discord logic)
    await this.checkSwingTradingConditions();

    const holdings = await storage.getPortfolioHoldings(this.userId);

    for (const holding of holdings) {
      try {
        const currentPrice = parseFloat(holding.currentPrice || '0');
        const avgPrice = parseFloat(holding.avgPrice || '0');
        
        if (avgPrice === 0) continue;

        const pnlPercent = ((currentPrice - avgPrice) / avgPrice) * 100;

        // Check stop loss
        if (settings.enableStopLoss && pnlPercent <= -parseFloat(settings.stopLossPercent || '0')) {
          await this.executeProfitTakingOrStopLoss(holding, 'stop_loss');
        }

        // Check take profit
        if (settings.enableProfitTaking && pnlPercent >= parseFloat(settings.takeProfitPercent || '0')) {
          await this.executeProfitTakingOrStopLoss(holding, 'take_profit');
        }
      } catch (error) {
        console.error(`Error checking stop loss/take profit for ${holding.symbol}:`, error);
      }
    }
  }

  private async executeProfitTakingOrStopLoss(holding: PortfolioHolding, type: 'stop_loss' | 'take_profit'): Promise<void> {
    try {
      const orderRequest: GeminiOrderRequest = {
        symbol: holding.symbol,
        amount: holding.amount,
        side: 'sell',
        type: 'exchange market',
      };

      await this.placeOrder(orderRequest);

      console.log(`Executed ${type} for ${holding.symbol}: ${holding.amount}`);
    } catch (error) {
      console.error(`Failed to execute ${type} for ${holding.symbol}:`, error);
    }
  }

  private schedulePeriodicTasks(): void {
    // Send portfolio updates to Discord every hour
    cron.schedule('0 * * * *', async () => {
      if (!this.discordService) return;

      try {
        const holdings = await storage.getPortfolioHoldings(this.userId);
        const totalValue = holdings.reduce((sum, h) => sum + parseFloat(h.valueUSD || '0'), 0);
        const activeTrades = await storage.getTradeOrders(this.userId, 'pending').then(orders => orders.length);
        
        // Calculate daily P&L (simplified)
        const dailyPnL = '0'; // TODO: Implement proper daily P&L calculation

        await this.discordService.sendPortfolioUpdate({
          totalValue: totalValue.toFixed(2),
          dailyPnL,
          holdings,
          activeTrades,
        });
      } catch (error) {
        console.error('Error sending scheduled portfolio update:', error);
      }
    });

    // Daily reset tasks at midnight
    cron.schedule('0 0 * * *', async () => {
      console.log('Performing daily reset tasks...');
      // Add any daily reset logic here
    });
  }

  // DISCORD'S EXACT SWING TRADING LOGIC
  private async checkSwingTradingConditions(): Promise<void> {
    try {
      const settings = await storage.getTradingSettings(this.userId);
      if (!settings) return;

      const balances = await this.geminiService.getBalances();
      const solBalance = balances.find(b => b.currency === 'SOL');
      
      if (!solBalance || parseFloat(solBalance.amount) === 0) {
        console.log('⚠️ No SOL balance found');
        return;
      }

      const currentSOLAmount = parseFloat(solBalance.amount);
      const ticker = await this.geminiService.getTicker('solusd');
      const currentPrice = parseFloat(ticker.last);
      const currentPortfolioValue = currentSOLAmount * currentPrice;

      console.log(`📊 SOL MONITORING: ${currentSOLAmount.toFixed(8)} SOL @ $${currentPrice.toFixed(2)} = $${currentPortfolioValue.toFixed(2)}`);

      // CRITICAL: Detect buy orders to prevent false triggers
      if (this.lastKnownSOLAmount > 0 && currentSOLAmount > this.lastKnownSOLAmount) {
        const solIncrease = currentSOLAmount - this.lastKnownSOLAmount;
        console.log(`🛒 BUY ORDER DETECTED: SOL increased by ${solIncrease.toFixed(8)} (${this.lastKnownSOLAmount.toFixed(8)} → ${currentSOLAmount.toFixed(8)})`);
        
        // Update baseline to current portfolio value to prevent false sell
        this.baselineValue = currentPortfolioValue;
        this.savedTriggerValue = currentPortfolioValue + 1.00;
        await this.saveTriggerToFile();
        console.log(`🔄 BASELINE UPDATED DUE TO PURCHASE: New baseline $${this.baselineValue.toFixed(2)}, Next trigger $${this.savedTriggerValue.toFixed(2)}`);
        
        this.lastKnownSOLAmount = currentSOLAmount;
        return;
      }

      // Store current SOL amount for buy detection
      this.lastKnownSOLAmount = currentSOLAmount;

      // Initialize trigger if not done
      if (!this.triggerInitialized) {
        await this.loadTriggerFromFile();
        if (this.baselineValue === 0) {
          this.baselineValue = currentPortfolioValue;
          this.savedTriggerValue = currentPortfolioValue + 1.00;
          await this.saveTriggerToFile();
          console.log(`🎯 TRIGGER INITIALIZED: Baseline $${this.baselineValue.toFixed(2)}, Trigger $${this.savedTriggerValue.toFixed(2)}`);
        }
        this.triggerInitialized = true;
      }

      console.log(`📈 SWING TRADE CHECK: Portfolio $${currentPortfolioValue.toFixed(2)}, Baseline $${this.baselineValue.toFixed(2)}, Trigger $${this.savedTriggerValue.toFixed(2)}`);

      // Check if portfolio dropped below reset threshold
      const resetThreshold = this.savedTriggerValue - 1.00;
      if (currentPortfolioValue < resetThreshold) {
        console.log(`📉 PORTFOLIO DROPPED: $${currentPortfolioValue.toFixed(2)} below threshold $${resetThreshold.toFixed(2)} - RESETTING TRIGGER`);
        this.baselineValue = currentPortfolioValue;
        this.savedTriggerValue = currentPortfolioValue + 1.00;
        await this.saveTriggerToFile();
        console.log(`🔄 NEW BASELINE: $${this.baselineValue.toFixed(2)}, NEW TRIGGER: $${this.savedTriggerValue.toFixed(2)}`);
        return;
      }

      // Check if trigger hit
      if (currentPortfolioValue >= this.savedTriggerValue) {
        console.log(`🚨 TRIGGER HIT: Portfolio $${currentPortfolioValue.toFixed(2)} >= Trigger $${this.savedTriggerValue.toFixed(2)}`);
        
        // Execute $1 USD sell
        await this.executeSwingTrade(currentSOLAmount, currentPrice);
        
        // Update baseline and trigger after successful trade
        this.baselineValue = currentPortfolioValue - 1.00; // Account for the $1 we just sold
        this.savedTriggerValue = this.baselineValue + 1.00;
        await this.saveTriggerToFile();
        console.log(`🔄 POST-TRADE: New baseline $${this.baselineValue.toFixed(2)}, Next trigger $${this.savedTriggerValue.toFixed(2)}`);
      } else {
        const needed = this.savedTriggerValue - currentPortfolioValue;
        console.log(`⏳ Need $${needed.toFixed(2)} more to hit trigger $${this.savedTriggerValue.toFixed(2)}`);
      }

    } catch (error) {
      console.error('Error in swing trading check:', error);
    }
  }

  private async executeSwingTrade(currentSOLAmount: number, currentPrice: number): Promise<void> {
    try {
      const usdToSell = 1.00;
      const solToSell = usdToSell / currentPrice;
      
      console.log(`💰 EXECUTING SWING TRADE: Selling $${usdToSell} worth (${solToSell.toFixed(8)} SOL)`);

      const orderRequest: GeminiOrderRequest = {
        symbol: 'solusd',
        amount: solToSell.toFixed(8),
        side: 'sell',
        type: 'exchange market',
      };

      await this.placeOrder(orderRequest);
      console.log(`✅ Swing trade executed successfully`);

    } catch (error) {
      console.error('Error executing swing trade:', error);
      throw error;
    }
  }

  private async loadTriggerFromFile(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile('trigger.json', 'utf8');
      const trigger = JSON.parse(data);
      this.baselineValue = trigger.baseline || 0;
      this.savedTriggerValue = trigger.trigger || 0;
      console.log(`📁 Loaded trigger: baseline $${this.baselineValue.toFixed(2)}, trigger $${this.savedTriggerValue.toFixed(2)}`);
    } catch (error) {
      console.log(`📁 No trigger file found, will initialize new one`);
      this.baselineValue = 0;
      this.savedTriggerValue = 0;
    }
  }

  private async saveTriggerToFile(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const trigger = {
        baseline: this.baselineValue,
        trigger: this.savedTriggerValue,
        timestamp: Date.now()
      };
      await fs.writeFile('trigger.json', JSON.stringify(trigger, null, 2));
      console.log(`💾 Saved trigger: baseline $${this.baselineValue.toFixed(2)}, trigger $${this.savedTriggerValue.toFixed(2)}`);
    } catch (error) {
      console.error('Error saving trigger file:', error);
    }
  }
}
