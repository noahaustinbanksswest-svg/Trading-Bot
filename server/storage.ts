import { 
  users, 
  tradingSettings, 
  portfolioHoldings, 
  tradeOrders, 
  tradingHistory,
  type User, 
  type InsertUser,
  type TradingSettings,
  type InsertTradingSettings,
  type PortfolioHolding,
  type InsertPortfolioHolding,
  type TradeOrder,
  type InsertTradeOrder,
  type TradingHistory,
  type InsertTradingHistory
} from "../shared/schema.js";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;

  // Trading settings methods
  getTradingSettings(userId: string): Promise<TradingSettings | undefined>;
  createTradingSettings(settings: InsertTradingSettings): Promise<TradingSettings>;
  updateTradingSettings(userId: string, updates: Partial<TradingSettings>): Promise<TradingSettings | undefined>;

  // Portfolio methods
  getPortfolioHoldings(userId: string): Promise<PortfolioHolding[]>;
  updatePortfolioHolding(userId: string, symbol: string, updates: Partial<PortfolioHolding>): Promise<PortfolioHolding | undefined>;
  createPortfolioHolding(holding: InsertPortfolioHolding): Promise<PortfolioHolding>;

  // Trading methods
  createTradeOrder(order: InsertTradeOrder): Promise<TradeOrder>;
  updateTradeOrder(id: string, updates: Partial<TradeOrder>): Promise<TradeOrder | undefined>;
  getTradeOrders(userId: string, status?: string): Promise<TradeOrder[]>;
  createTradingHistory(history: InsertTradingHistory): Promise<TradingHistory>;
  getTradingHistory(userId: string, limit?: number): Promise<TradingHistory[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async getTradingSettings(userId: string): Promise<TradingSettings | undefined> {
    const [settings] = await db
      .select()
      .from(tradingSettings)
      .where(eq(tradingSettings.userId, userId));
    return settings || undefined;
  }

  async createTradingSettings(settings: InsertTradingSettings): Promise<TradingSettings> {
    const [created] = await db
      .insert(tradingSettings)
      .values(settings)
      .returning();
    return created;
  }

  async updateTradingSettings(userId: string, updates: Partial<TradingSettings>): Promise<TradingSettings | undefined> {
    const [updated] = await db
      .update(tradingSettings)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(tradingSettings.userId, userId))
      .returning();
    return updated || undefined;
  }

  async getPortfolioHoldings(userId: string): Promise<PortfolioHolding[]> {
    return await db
      .select()
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, userId));
  }

  async updatePortfolioHolding(userId: string, symbol: string, updates: Partial<PortfolioHolding>): Promise<PortfolioHolding | undefined> {
    const [updated] = await db
      .update(portfolioHoldings)
      .set({ ...updates, lastUpdated: new Date() })
      .where(and(
        eq(portfolioHoldings.userId, userId),
        eq(portfolioHoldings.symbol, symbol)
      ))
      .returning();
    return updated || undefined;
  }

  async createPortfolioHolding(holding: InsertPortfolioHolding): Promise<PortfolioHolding> {
    const [created] = await db
      .insert(portfolioHoldings)
      .values(holding)
      .returning();
    return created;
  }

  async createTradeOrder(order: InsertTradeOrder): Promise<TradeOrder> {
    const [created] = await db
      .insert(tradeOrders)
      .values(order)
      .returning();
    return created;
  }

  async updateTradeOrder(id: string, updates: Partial<TradeOrder>): Promise<TradeOrder | undefined> {
    const [updated] = await db
      .update(tradeOrders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(tradeOrders.id, id))
      .returning();
    return updated || undefined;
  }

  async getTradeOrders(userId: string, status?: string): Promise<TradeOrder[]> {
    const conditions = [eq(tradeOrders.userId, userId)];
    if (status) {
      conditions.push(eq(tradeOrders.status, status));
    }
    
    return await db
      .select()
      .from(tradeOrders)
      .where(and(...conditions))
      .orderBy(desc(tradeOrders.createdAt));
  }

  async createTradingHistory(history: InsertTradingHistory): Promise<TradingHistory> {
    const [created] = await db
      .insert(tradingHistory)
      .values(history)
      .returning();
    return created;
  }

  async getTradingHistory(userId: string, limit: number = 50): Promise<TradingHistory[]> {
    return await db
      .select()
      .from(tradingHistory)
      .where(eq(tradingHistory.userId, userId))
      .orderBy(desc(tradingHistory.executedAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
