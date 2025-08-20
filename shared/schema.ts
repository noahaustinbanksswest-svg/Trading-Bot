import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  geminiApiKey: text("gemini_api_key"),
  geminiApiSecret: text("gemini_api_secret"),
  discordBotToken: text("discord_bot_token"),
  discordGuildId: text("discord_guild_id"),
  discordChannelId: text("discord_channel_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tradingSettings = pgTable("trading_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dailyBuyLimit: decimal("daily_buy_limit", { precision: 10, scale: 2 }).default("1000.00"),
  stopLossPercent: decimal("stop_loss_percent", { precision: 5, scale: 2 }).default("5.00"),
  takeProfitPercent: decimal("take_profit_percent", { precision: 5, scale: 2 }).default("10.00"),
  enableStopLoss: boolean("enable_stop_loss").default(true),
  enableProfitTaking: boolean("enable_profit_taking").default(true),
  profitStrategy: text("profit_strategy").default("Fixed Percentage"),
  enabledPairs: jsonb("enabled_pairs").default(['btcusd', 'ethusd']),
  updateFrequency: integer("update_frequency").default(30), // seconds
  enableNotifications: boolean("enable_notifications").default(true),
  enablePnLUpdates: boolean("enable_pnl_updates").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const portfolioHoldings = pgTable("portfolio_holdings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  amount: decimal("amount", { precision: 20, scale: 8 }).notNull(),
  avgPrice: decimal("avg_price", { precision: 10, scale: 2 }),
  currentPrice: decimal("current_price", { precision: 10, scale: 2 }),
  valueUSD: decimal("value_usd", { precision: 15, scale: 2 }),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const tradeOrders = pgTable("trade_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  geminiOrderId: text("gemini_order_id"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // buy/sell
  orderType: text("order_type").notNull(), // market/limit/stop
  amount: decimal("amount", { precision: 20, scale: 8 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }),
  status: text("status").default("pending"), // pending/filled/cancelled/failed
  executedAmount: decimal("executed_amount", { precision: 20, scale: 8 }).default("0"),
  executedPrice: decimal("executed_price", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tradingHistory = pgTable("trading_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orderId: varchar("order_id").references(() => tradeOrders.id),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  amount: decimal("amount", { precision: 20, scale: 8 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  fee: decimal("fee", { precision: 10, scale: 2 }).default("0"),
  pnl: decimal("pnl", { precision: 10, scale: 2 }),
  executedAt: timestamp("executed_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  tradingSettings: many(tradingSettings),
  portfolioHoldings: many(portfolioHoldings),
  tradeOrders: many(tradeOrders),
  tradingHistory: many(tradingHistory),
}));

export const tradingSettingsRelations = relations(tradingSettings, ({ one }) => ({
  user: one(users, {
    fields: [tradingSettings.userId],
    references: [users.id],
  }),
}));

export const portfolioHoldingsRelations = relations(portfolioHoldings, ({ one }) => ({
  user: one(users, {
    fields: [portfolioHoldings.userId],
    references: [users.id],
  }),
}));

export const tradeOrdersRelations = relations(tradeOrders, ({ one, many }) => ({
  user: one(users, {
    fields: [tradeOrders.userId],
    references: [users.id],
  }),
  tradingHistory: many(tradingHistory),
}));

export const tradingHistoryRelations = relations(tradingHistory, ({ one }) => ({
  user: one(users, {
    fields: [tradingHistory.userId],
    references: [users.id],
  }),
  order: one(tradeOrders, {
    fields: [tradingHistory.orderId],
    references: [tradeOrders.id],
  }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertTradingSettingsSchema = createInsertSchema(tradingSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertPortfolioHoldingSchema = createInsertSchema(portfolioHoldings).omit({
  id: true,
  lastUpdated: true,
});

export const insertTradeOrderSchema = createInsertSchema(tradeOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTradingHistorySchema = createInsertSchema(tradingHistory).omit({
  id: true,
  executedAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type TradingSettings = typeof tradingSettings.$inferSelect;
export type InsertTradingSettings = z.infer<typeof insertTradingSettingsSchema>;
export type PortfolioHolding = typeof portfolioHoldings.$inferSelect;
export type InsertPortfolioHolding = z.infer<typeof insertPortfolioHoldingSchema>;
export type TradeOrder = typeof tradeOrders.$inferSelect;
export type InsertTradeOrder = z.infer<typeof insertTradeOrderSchema>;
export type TradingHistory = typeof tradingHistory.$inferSelect;
export type InsertTradingHistory = z.infer<typeof insertTradingHistorySchema>;
