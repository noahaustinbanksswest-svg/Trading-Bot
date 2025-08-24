import { GeminiService, GeminiOrderRequest } from './gemini';
import { storage } from '../storage';
import fs from 'fs';
import path from 'path';

/**
 * Independent Trading Engine - Runs server-side without Discord bot dependency
 * Uses EXACT same trigger logic as Discord bot for consistency
 */
export class IndependentTradingEngine {
  private userId: string;
  private geminiService: GeminiService;
  private isRunning: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;
  
  // EXACT SAME TRIGGER LOGIC AS DISCORD BOT
  private baselineValue: number | null = null;
  private savedTriggerValue: number | null = null;
  private triggerInitializedThisSession: boolean = false;
  private lastTradeTime: number = 0;
  private tradingLock: boolean = false;
  
  // Trading settings (loaded from autoTradeSettings)
  private selectedCrypto: string = 'SOL';
  private stopAtLoss: number = 1.5; // Base protection amount
  private enabled: boolean = true; // ENABLED - Gemini credentials working
  
  // PURCHASE DETECTION - Monitor SOL amount to detect buys and update triggers
  private lastKnownSOLAmount: number = 0;
  private purchaseDetectionEnabled: boolean = true;

  constructor(userId: string, geminiService: GeminiService) {
    this.userId = userId;
    this.geminiService = geminiService;
    console.log('🤖 Independent Trading Engine initialized');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Independent trading engine is already running');
    }

    if (!this.enabled) {
      throw new Error('Independent trading engine is DISABLED until Gemini API credentials are fixed');
    }

    console.log('🚀 Starting Independent Trading Engine (server-side, Discord-independent)');
    this.isRunning = true;

    // Load trading settings
    await this.loadTradingSettings();

    // Start continuous monitoring using EXACT Discord bot logic
    this.startSwingTradingMonitoring();
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping Independent Trading Engine');
    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }

  private async loadTradingSettings(): Promise<void> {
    try {
      const settings = await storage.getTradingSettings(this.userId);
      if (settings) {
        // Map from database settings to trading engine settings
        this.selectedCrypto = 'SOL'; // Fixed to SOL for swing trading
        this.stopAtLoss = parseFloat(settings.stopLossPercent || '1.5');
        console.log(`⚙️ Trading settings loaded: ${this.selectedCrypto}, base protection: ${this.stopAtLoss}`);
      }
    } catch (error) {
      console.error('Error loading trading settings:', error instanceof Error ? error.message : error);
      // Use defaults
      this.selectedCrypto = 'SOL';
      this.stopAtLoss = 1.5;
    }
  }

  private startSwingTradingMonitoring(): void {
    console.log('📊 Starting swing trading monitoring (server-side)...');
    
    // Monitor every 1 second for immediate response
    this.monitoringInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        await this.checkSwingTradingConditions();
      } catch (error) {
        console.error('Error in swing trading check:', error.message);
      }
    }, 1000); // 1 second
  }

  /**
   * ONLY REAL TRADING ENGINE - Discord is visual only
   * Implements the same baseline + $1 trigger system with proper sale limiting
   */
  private async checkSwingTradingConditions(): Promise<boolean> {
    try {
      if (!this.enabled) {
        return false;
      }

      // Check trading lock (prevent multiple simultaneous trades - CRITICAL FOR SINGLE SALE LIMIT)
      if (this.tradingLock) {
        console.log('🔒 Trading locked - skipping swing check (preventing multiple sales)');
        return false;
      }

      // Additional safety: Check if recent trade happened (30 second cooldown)
      const timeSinceLastTrade = Date.now() - this.lastTradeTime;
      if (timeSinceLastTrade < 30000) {
        console.log(`⏳ Trade cooldown active: ${Math.ceil((30000 - timeSinceLastTrade) / 1000)}s remaining`);
        return false;
      }

      // Get current portfolio data
      const portfolioData = await this.getPortfolioData();
      const cryptoHolding = portfolioData.holdings.find((h: any) => h.currency === this.selectedCrypto);
      
      if (!cryptoHolding) {
        console.log(`⏳ Waiting for ${this.selectedCrypto} holding data`);
        return false;
      }

      const currentPortfolioValue = cryptoHolding.value;
      const currentSOLAmount = cryptoHolding.amount;
      
      // PURCHASE DETECTION - Check if SOL amount increased (indicating buy order)
      if (this.purchaseDetectionEnabled && this.lastKnownSOLAmount > 0) {
        const solAmountIncrease = currentSOLAmount - this.lastKnownSOLAmount;
        
        if (solAmountIncrease > 0.001) { // Significant increase (more than 0.001 SOL)
          console.log(`💰 PURCHASE DETECTED: SOL amount increased by ${solAmountIncrease.toFixed(8)} SOL`);
          console.log(`   Previous: ${this.lastKnownSOLAmount.toFixed(8)} SOL`);
          console.log(`   Current: ${currentSOLAmount.toFixed(8)} SOL`);
          console.log(`   Portfolio value after purchase: $${currentPortfolioValue.toFixed(2)}`);
          
          // Reset baseline/trigger to current value after purchase
          this.baselineValue = currentPortfolioValue;
          this.savedTriggerValue = currentPortfolioValue + 1.00;
          await this.saveTriggerToFile();
          
          console.log(`🔄 TRIGGERS UPDATED AFTER PURCHASE:`);
          console.log(`   New Baseline: $${this.baselineValue.toFixed(2)}`);
          console.log(`   New Trigger: $${this.savedTriggerValue.toFixed(2)}`);
          console.log(`   Ready for next $1 gain from new balance`);
        }
      }
      
      // Update tracked SOL amount for next cycle
      this.lastKnownSOLAmount = currentSOLAmount;
      
      // INITIALIZE TRIGGER SYSTEM (exact same logic as Discord bot)
      console.log(`🔍 DEBUG: Before init - savedTriggerValue: ${this.savedTriggerValue}, baselineValue: ${this.baselineValue}`);
      
      if (!this.triggerInitializedThisSession) {
        this.savedTriggerValue = null;
        this.baselineValue = null;
        
        try {
          const triggerData = await this.loadTriggerFromFile();
          console.log(`🔍 DEBUG: Loaded trigger data:`, triggerData);
          
          if (triggerData && typeof triggerData.baseline === 'number' && typeof triggerData.trigger === 'number') {
            this.baselineValue = triggerData.baseline;
            this.savedTriggerValue = triggerData.trigger;
            console.log(`🔒 BASELINE LOCKED: $${this.baselineValue.toFixed(2)}, TRIGGER LOCKED: $${this.savedTriggerValue.toFixed(2)} (loaded from file)`);
          } else {
            console.log(`🔍 DEBUG: Invalid trigger data, creating new values`);
            this.savedTriggerValue = parseFloat(currentPortfolioValue.toFixed(2));
            this.baselineValue = this.savedTriggerValue - 1.00;
            console.log(`🔒 BASELINE SET: $${this.baselineValue.toFixed(2)}, TRIGGER SET: $${this.savedTriggerValue.toFixed(2)} (ready to trigger)`);
            await this.saveTriggerToFile();
          }
        } catch (error) {
          console.log(`🔍 DEBUG: Error loading trigger data:`, error instanceof Error ? error.message : error);
          this.savedTriggerValue = parseFloat(currentPortfolioValue.toFixed(2));
          this.baselineValue = this.savedTriggerValue - 1.00;
          console.log(`🔒 BASELINE FALLBACK: $${this.baselineValue.toFixed(2)}, TRIGGER SET: $${this.savedTriggerValue.toFixed(2)} (ready to trigger)`);
          await this.saveTriggerToFile();
        }
        
        this.triggerInitializedThisSession = true;
      }

      // Skip if no trigger value
      if (!this.savedTriggerValue) {
        console.log(`⚠️ No saved trigger value - skipping trigger check this cycle`);
        return false;
      }

      let triggerValue = this.savedTriggerValue;

      console.log(`📈 SWING TRADE CHECK:`);
      console.log(`   Current Portfolio: $${currentPortfolioValue.toFixed(2)}`);
      console.log(`   Baseline: $${this.baselineValue?.toFixed(2) || 'N/A'}`);
      console.log(`   Trigger at: $${triggerValue.toFixed(2)} (LOCKED)`);

      // RESET LOGIC - 1 CENT DROP from baseline (exact same as Discord bot)
      const resetThreshold = (this.baselineValue || 0) - 0.01;
      console.log(`🔍 RESET CHECK: Portfolio $${currentPortfolioValue.toFixed(2)} < Threshold $${resetThreshold.toFixed(2)} (Baseline $${this.baselineValue?.toFixed(2) || 'N/A'} - $0.01) = ${currentPortfolioValue < resetThreshold}`);

      if (currentPortfolioValue < resetThreshold) {
        console.log(`📉 PORTFOLIO DROPPED: $${currentPortfolioValue.toFixed(2)} below 1-cent threshold $${resetThreshold.toFixed(2)} - RESETTING TRIGGER`);
        this.baselineValue = currentPortfolioValue;
        this.savedTriggerValue = currentPortfolioValue + 1.00;
        triggerValue = this.savedTriggerValue;
        await this.saveTriggerToFile();
        console.log(`🔄 NEW BASELINE: $${this.baselineValue?.toFixed(2) || 'N/A'}, NEW TRIGGER: $${this.savedTriggerValue?.toFixed(2) || 'N/A'}`);
      } else {
        console.log(`🔒 TRIGGER LOCKED: Portfolio $${currentPortfolioValue.toFixed(2)} is above 1-cent threshold $${resetThreshold.toFixed(2)} - trigger stays at $${this.savedTriggerValue?.toFixed(2) || 'N/A'}`);
      }

      // Check if portfolio has reached trigger value
      const needsAmount = triggerValue - currentPortfolioValue;
      console.log(`⏳ Need $${needsAmount.toFixed(2)} more to hit trigger $${triggerValue.toFixed(2)}`);

      // TRADE EXECUTION LOGIC
      let shouldExecuteTrade = false;

      if (currentPortfolioValue >= triggerValue) {
        console.log(`🎯 TRIGGER HIT: Portfolio $${currentPortfolioValue.toFixed(2)} >= Trigger $${triggerValue.toFixed(2)}`);
        shouldExecuteTrade = true;
      } else {
        console.log(`⏸️ TRIGGER NOT HIT: Portfolio $${currentPortfolioValue.toFixed(2)} < Trigger $${triggerValue.toFixed(2)}`);
      }

      console.log(`🔍 FINAL CHECK: shouldExecuteTrade = ${shouldExecuteTrade}`);

      if (shouldExecuteTrade) {
        console.log(`🚀 EXECUTING $1 USD TRADE: Portfolio hit trigger at $${triggerValue.toFixed(2)}`);
        await this.executeAutoTrade(`Portfolio reached $${triggerValue.toFixed(2)} trigger`);
        return true;
      } else {
        console.log(`⏸️ NO TRADE: Conditions not met yet`);
        return false;
      }

    } catch (error) {
      console.error('Error in swing trading conditions check:', error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Execute $1 USD trade with BULLETPROOF single-trade protection
   */
  private async executeAutoTrade(reason: string): Promise<void> {
    const globalLockFile = path.join(process.cwd(), 'trading-lock.json');
    
    try {
      // 🛡️ PROTECTION LAYER 1: Trading lock check (in-memory)
      if (this.tradingLock) {
        console.log(`🛑 PROTECTION LAYER 1 BLOCKED: Trading already locked in memory`);
        return;
      }

      // 🛡️ PROTECTION LAYER 2: File-based global trading lock
      if (fs.existsSync(globalLockFile)) {
        const lockData = JSON.parse(fs.readFileSync(globalLockFile, 'utf8'));
        const lockAge = Date.now() - lockData.timestamp;
        if (lockAge < 120000) { // 2 minute max lock duration
          console.log(`🛑 PROTECTION LAYER 2 BLOCKED: Global trading lock active (${Math.round(lockAge/1000)}s old)`);
          return;
        } else {
          console.log(`🧹 Cleaning up stale global lock (${Math.round(lockAge/1000)}s old)`);
          fs.unlinkSync(globalLockFile);
        }
      }

      // 🛡️ PROTECTION LAYER 3: Double-check engine state
      if (!this.isRunning || !this.enabled) {
        console.log(`🛑 PROTECTION LAYER 3 BLOCKED: Engine not running (${this.isRunning}) or disabled (${!this.enabled})`);
        return;
      }

      // 🔒 ENGAGE ALL LOCKS ATOMICALLY
      this.tradingLock = true;
      fs.writeFileSync(globalLockFile, JSON.stringify({ 
        timestamp: Date.now(), 
        userId: this.userId,
        reason: 'Single trade protection'
      }));
      console.log(`🔒 ALL PROTECTION LAYERS ENGAGED - Single trade protection active`);

      console.log(`💰 Executing $1 USD Auto Trade: Selling $1.00 worth of ${this.selectedCrypto}`);

      // Get current portfolio data
      const portfolioData = await this.getPortfolioData();
      const cryptoHolding = portfolioData.holdings.find((h: any) => h.currency === this.selectedCrypto);

      if (!cryptoHolding) {
        throw new Error(`${this.selectedCrypto} not found in portfolio`);
      }

      // Calculate exact SOL amount for $1 USD
      const currentPrice = cryptoHolding.price;
      const cryptoAmountFor1USD = 1.00 / currentPrice;

      console.log(`📊 $1 USD Trade Calculation:`);
      console.log(`   Current ${this.selectedCrypto} Price: $${currentPrice.toFixed(2)}`);
      console.log(`   ${this.selectedCrypto} Amount for $1 USD: ${cryptoAmountFor1USD.toFixed(8)}`);
      console.log(`   Current Holdings: ${cryptoHolding.amount.toFixed(8)} ${this.selectedCrypto}`);

      // Skip very small amounts
      if (cryptoAmountFor1USD < 0.000001) {
        console.log(`⏭️ Skipping: $1 USD amount too small (${cryptoAmountFor1USD.toFixed(8)} ${this.selectedCrypto})`);
        // 🔓 RELEASE ALL LOCKS when skipping
        this.tradingLock = false;
        if (fs.existsSync(globalLockFile)) {
          fs.unlinkSync(globalLockFile);
        }
        console.log(`🔓 ALL LOCKS RELEASED (skipped small amount)`);
        return;
      }

      // Execute sell order
      const symbol = `${this.selectedCrypto.toLowerCase()}usd`;
      
      try {
        console.log(`💰 Placing $1 USD sell order: ${cryptoAmountFor1USD.toFixed(8)} ${this.selectedCrypto} on ${symbol}`);
        
        const order = await this.geminiService.placeOrder({
          symbol: symbol,
          amount: cryptoAmountFor1USD.toString(),
          side: 'sell',
          type: 'exchange market'
        });

        // Record trade time for cooldown
        this.lastTradeTime = Date.now();

        // KEEP TRIGGER STABLE (same as Discord bot)
        console.log(`🎯 TRADE COMPLETED: Keeping baseline at $${this.baselineValue?.toFixed(2) || 'N/A'} and trigger at $${this.savedTriggerValue?.toFixed(2) || 'N/A'} (NO RESET TO PREVENT BOUNCING)`);

        console.log(`✅ $1 USD SELL ORDER EXECUTED: ${cryptoAmountFor1USD.toFixed(8)} ${this.selectedCrypto} → $1.00 USD`);
        console.log(`   Order ID: ${order.order_id}`);
        console.log(`   Server-side execution successful!`);

      } catch (error) {
        console.error(`❌ Failed to execute $1 USD sell order:`, error instanceof Error ? error.message : error);
        // 🔓 RELEASE ALL LOCKS on error
        this.tradingLock = false;
        if (fs.existsSync(globalLockFile)) {
          fs.unlinkSync(globalLockFile);
        }
        console.log(`🔓 ALL LOCKS RELEASED due to trade error`);
        return;
      }

      // 🔓 RELEASE ALL LOCKS after successful trade
      this.tradingLock = false;
      if (fs.existsSync(globalLockFile)) {
        fs.unlinkSync(globalLockFile);
      }
      console.log(`🔓 ALL LOCKS RELEASED after successful trade`);

    } catch (error) {
      console.error('Error executing auto trade:', error instanceof Error ? error.message : error);
      // 🔓 EMERGENCY RELEASE ALL LOCKS
      this.tradingLock = false;
      try {
        if (fs.existsSync(globalLockFile)) {
          fs.unlinkSync(globalLockFile);
        }
      } catch (unlinkError) {
        console.error('Failed to release global lock:', unlinkError);
      }
      console.log(`🔓 EMERGENCY LOCK RELEASE due to error`);
    }
  }

  /**
   * Load trigger data from file (same as Discord bot)
   */
  private async loadTriggerFromFile(): Promise<any> {
    try {
      const triggerPath = path.join(process.cwd(), 'trigger.json');
      if (fs.existsSync(triggerPath)) {
        const data = fs.readFileSync(triggerPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading trigger from file:', error instanceof Error ? error.message : error);
    }
    return null;
  }

  /**
   * Save trigger data to file (same as Discord bot)
   */
  private async saveTriggerToFile(): Promise<void> {
    try {
      const triggerData = {
        baseline: this.baselineValue,
        trigger: (this.baselineValue || 0) + 1.00,
        timestamp: Date.now()
      };
      const triggerPath = path.join(process.cwd(), 'trigger.json');
      fs.writeFileSync(triggerPath, JSON.stringify(triggerData, null, 2));
      console.log(`💾 BASELINE SAVED: $${this.baselineValue?.toFixed(2) || 'N/A'}`);
    } catch (error) {
      console.error('Error saving baseline:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Get portfolio data (simplified version)
   */
  private async getPortfolioData(): Promise<any> {
    try {
      // Get balance data from Gemini
      const balances = await this.geminiService.getBalances();
      const holdings = [];

      for (const balance of balances) {
        if (balance.currency !== 'USD' && parseFloat(balance.amount) > 0) {
          // Get current price
          const symbol = `${balance.currency}USD`;
          try {
            const ticker = await this.geminiService.getTicker(symbol);
            const price = parseFloat(ticker.last);
            const value = parseFloat(balance.amount) * price;

            holdings.push({
              currency: balance.currency,
              amount: parseFloat(balance.amount),
              price: price,
              value: value,
              change: 0
            });
          } catch (error) {
            // Skip if can't get price
          }
        }
      }

      return { holdings };
    } catch (error) {
      console.error('Error getting portfolio data:', error instanceof Error ? error.message : error);
      return { holdings: [] };
    }
  }

  // Status methods
  isEngineRunning(): boolean {
    return this.isRunning;
  }

  getCurrentTriggerInfo(): any {
    return {
      baseline: this.baselineValue,
      trigger: this.savedTriggerValue,
      initialized: this.triggerInitializedThisSession,
      locked: this.tradingLock,
      lastTrade: this.lastTradeTime
    };
  }
}