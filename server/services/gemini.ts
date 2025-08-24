import crypto from 'crypto';
import axios, { AxiosResponse } from 'axios';

export interface GeminiTicker {
  symbol: string;
  open: string;
  high: string;
  low: string;
  close: string;
  changes: string[];
  bid: string;
  ask: string;
  last: string;
  volume: {
    [key: string]: string;
  };
}

export interface GeminiBalance {
  currency: string;
  amount: string;
  available: string;
  availableForWithdrawal: string;
  type: string;
}

export interface GeminiOrder {
  order_id: string;
  id: string;
  symbol: string;
  exchange: string;
  avg_execution_price: string;
  side: string;
  type: string;
  timestamp: string;
  timestampms: number;
  is_live: boolean;
  is_cancelled: boolean;
  is_hidden: boolean;
  was_forced: boolean;
  executed_amount: string;
  remaining_amount: string;
  options: string[];
  price: string;
  original_amount: string;
}

export interface GeminiOrderRequest {
  symbol: string;
  amount: string;
  price?: string;
  side: 'buy' | 'sell';
  type: 'exchange limit' | 'exchange market' | 'exchange stop' | 'exchange stop limit';
  options?: string[];
}

export class GeminiService {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor(apiKey: string, apiSecret: string, sandbox: boolean = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = sandbox 
      ? 'https://api.sandbox.gemini.com' 
      : 'https://api.gemini.com';
  }

  private generateHeaders(endpoint: string, payload: any = {}): { [key: string]: string } {
    const nonce = Date.now() * 1000;
    const payloadWithDefaults = {
      request: endpoint,
      nonce: nonce.toString(),
      ...payload
    };

    const encodedPayload = Buffer.from(JSON.stringify(payloadWithDefaults)).toString('base64');
    const signature = crypto
      .createHmac('sha384', this.apiSecret)
      .update(encodedPayload)
      .digest('hex');

    return {
      'X-GEMINI-APIKEY': this.apiKey,
      'X-GEMINI-PAYLOAD': encodedPayload,
      'X-GEMINI-SIGNATURE': signature,
      'Content-Type': 'text/plain'
    };
  }

  async getTicker(symbol: string): Promise<GeminiTicker> {
    try {
      const response: AxiosResponse<GeminiTicker> = await axios.get(
        `${this.baseUrl}/v1/pubticker/${symbol}`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get ticker for ${symbol}: ${error}`);
    }
  }

  async getBalances(): Promise<GeminiBalance[]> {
    try {
      const endpoint = '/v1/balances';
      const headers = this.generateHeaders(endpoint);
      
      const response: AxiosResponse<GeminiBalance[]> = await axios.post(
        `${this.baseUrl}${endpoint}`,
        {},
        { headers }
      );
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get balances: ${error}`);
    }
  }

  async placeOrder(orderRequest: GeminiOrderRequest): Promise<GeminiOrder> {
    try {
      const endpoint = '/v1/order/new';
      const headers = this.generateHeaders(endpoint, orderRequest);
      
      console.log(`📊 Placing Gemini order: ${orderRequest.side} ${orderRequest.amount} ${orderRequest.symbol}`);
      
      const response: AxiosResponse<GeminiOrder> = await axios.post(
        `${this.baseUrl}${endpoint}`,
        {},
        { headers }
      );
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to place order: ${error}`);
    }
  }

  async cancelOrder(orderId: string): Promise<GeminiOrder> {
    try {
      const endpoint = '/v1/order/cancel';
      const payload = { order_id: orderId };
      const headers = this.generateHeaders(endpoint, payload);
      
      const response: AxiosResponse<GeminiOrder> = await axios.post(
        `${this.baseUrl}${endpoint}`,
        {},
        { headers }
      );
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to cancel order ${orderId}: ${error}`);
    }
  }

  async getOrderStatus(orderId: string): Promise<GeminiOrder> {
    try {
      const endpoint = '/v1/order/status';
      const payload = { order_id: orderId };
      const headers = this.generateHeaders(endpoint, payload);
      
      const response: AxiosResponse<GeminiOrder> = await axios.post(
        `${this.baseUrl}${endpoint}`,
        {},
        { headers }
      );
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get order status for ${orderId}: ${error}`);
    }
  }

  async getActiveOrders(): Promise<GeminiOrder[]> {
    try {
      const endpoint = '/v1/orders';
      const headers = this.generateHeaders(endpoint);
      
      const response: AxiosResponse<GeminiOrder[]> = await axios.post(
        `${this.baseUrl}${endpoint}`,
        {},
        { headers }
      );
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get active orders: ${error}`);
    }
  }

  async getSymbols(): Promise<string[]> {
    try {
      const response: AxiosResponse<string[]> = await axios.get(
        `${this.baseUrl}/v1/symbols`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get symbols: ${error}`);
    }
  }

  async heartbeat(): Promise<{ result: string }> {
    try {
      const endpoint = '/v1/heartbeat';
      const headers = this.generateHeaders(endpoint);
      
      const response: AxiosResponse<{ result: string }> = await axios.post(
        `${this.baseUrl}${endpoint}`,
        {},
        { headers }
      );
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to send heartbeat: ${error}`);
    }
  }
}
