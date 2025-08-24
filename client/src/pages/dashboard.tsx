import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Sidebar from '@/components/sidebar';
import PortfolioHoldings from '@/components/portfolio-holdings';
import TradingControls from '@/components/trading-controls';
import DiscordConfig from '@/components/discord-config';
import TradingSettings from '@/components/trading-settings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useWebSocket } from '@/hooks/use-websocket';
import { RefreshCw, Activity, TrendingUp, Wallet, Bot } from 'lucide-react';

// Mock user ID - in a real app this would come from authentication
const MOCK_USER_ID = 'user-1';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isLive, setIsLive] = useState(false);

  // WebSocket for real-time updates
  const { isConnected, sendMessage } = useWebSocket();

  // Queries
  const { data: portfolio, refetch: refetchPortfolio } = useQuery({
    queryKey: ['/api/portfolio', MOCK_USER_ID],
    refetchInterval: 1000, // Refresh every 1 second for real-time
  });

  const { data: orders, refetch: refetchOrders } = useQuery({
    queryKey: ['/api/orders', MOCK_USER_ID],
  });

  const { data: tradingSettings } = useQuery({
    queryKey: ['/api/trading-settings', MOCK_USER_ID],
  });

  const { data: triggerStatus } = useQuery({
    queryKey: ['/api/independent-trading/status', MOCK_USER_ID],
    refetchInterval: 1000, // Real-time trigger updates
  });

  const activeTrades = (orders as any[])?.filter((order: any) => order.status === 'pending')?.length || 0;

  const refreshData = async () => {
    await Promise.all([
      refetchPortfolio(),
      refetchOrders(),
    ]);
  };

  useEffect(() => {
    setIsLive(isConnected);
  }, [isConnected]);

  if (activeTab === 'portfolio') {
    return (
      <div className="flex min-h-screen bg-dark text-white">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 ml-64 p-6">
          <PortfolioHoldings userId={MOCK_USER_ID} />
        </main>
      </div>
    );
  }

  if (activeTab === 'trading') {
    return (
      <div className="flex min-h-screen bg-dark text-white">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 ml-64 p-6">
          <TradingControls userId={MOCK_USER_ID} />
        </main>
      </div>
    );
  }

  if (activeTab === 'discord') {
    return (
      <div className="flex min-h-screen bg-dark text-white">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 ml-64 p-6">
          <DiscordConfig userId={MOCK_USER_ID} />
        </main>
      </div>
    );
  }

  if (activeTab === 'settings') {
    return (
      <div className="flex min-h-screen bg-dark text-white">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 ml-64 p-6">
          <TradingSettings userId={MOCK_USER_ID} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-dark text-white">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 ml-64 p-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">Trading Dashboard</h2>
            <p className="text-gray-400">Real-time portfolio and bot management</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 bg-surface px-4 py-2 rounded-lg">
              <div className={`w-3 h-3 rounded-full ${isLive ? 'bg-success animate-pulse' : 'bg-gray-500'}`}></div>
              <span className="text-sm">{isLive ? 'Live' : 'Offline'}</span>
            </div>
            <Button 
              onClick={refreshData}
              className="bg-primary hover:bg-blue-700"
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </header>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="bg-surface border-gray-700" data-testid="card-total-balance">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Total Balance</p>
                  <p className="text-2xl font-bold text-white">
                    ${(portfolio as any)?.totalValue || '0.00'}
                  </p>
                </div>
                <Wallet className="w-8 h-8 text-primary" />
              </div>
              <div className="mt-2 flex items-center">
                <Badge variant="outline" className="text-success border-success">
                  Live
                </Badge>
                <span className="text-gray-400 text-sm ml-2">Real-time</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface border-gray-700" data-testid="card-active-trades">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Active Trades</p>
                  <p className="text-2xl font-bold text-white">{activeTrades}</p>
                </div>
                <Activity className="w-8 h-8 text-secondary" />
              </div>
              <div className="mt-2 flex items-center">
                <span className="text-secondary text-sm">3 pending</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface border-gray-700" data-testid="card-daily-pnl">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Daily P&L</p>
                  <p className="text-2xl font-bold text-success">+$324.67</p>
                </div>
                <TrendingUp className="w-8 h-8 text-success" />
              </div>
              <div className="mt-2 flex items-center">
                <Badge variant="outline" className="text-success border-success">
                  +2.6%
                </Badge>
                <span className="text-gray-400 text-sm ml-2">today</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface border-gray-700" data-testid="card-bot-status">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">Bot Status</p>
                  <p className="text-lg font-semibold text-success">Active</p>
                </div>
                <Bot className="w-8 h-8 text-primary" />
              </div>
              <div className="mt-2 flex items-center">
                <span className="text-gray-400 text-sm">Last sync: 2s ago</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Portfolio Overview with Trigger Info */}
        <div className="mb-8">
          <Card className="bg-surface border-gray-700" data-testid="portfolio-overview">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold text-white">Portfolio Overview</h3>
                <Badge variant="outline" className="text-primary border-primary">
                  {(triggerStatus as any)?.running ? 'Trading Active' : 'Trading Inactive'}
                </Badge>
              </div>
              
              {/* Holdings */}
              {(portfolio as any)?.holdings?.map((holding: any) => (
                <div key={holding.id} className="flex items-center justify-between p-4 bg-surfaceLight rounded-lg mb-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-sm">
                        {holding.symbol.replace('usd', '').toUpperCase().slice(0, 3)}
                      </span>
                    </div>
                    <div>
                      <p className="text-white font-medium">
                        {holding.symbol.replace('usd', '').toUpperCase()}
                      </p>
                      <p className="text-gray-400 text-sm">
                        {parseFloat(holding.amount).toFixed(8)} {holding.symbol.replace('usd', '').toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-medium">${holding.valueUSD}</p>
                    <p className="text-gray-400 text-sm">${holding.currentPrice}</p>
                  </div>
                </div>
              ))}

              {/* SOL Trigger Information */}
              {(portfolio as any)?.holdings?.some((h: any) => h.symbol === 'solusd') && (
                <div className="mt-6 p-4 bg-primary/10 border border-primary/20 rounded-lg">
                  <h4 className="text-primary font-semibold mb-3">SOL Trading Trigger</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-gray-400 text-sm">Current SOL</p>
                      <p className="text-white font-medium">
                        {((portfolio as any)?.holdings?.find((h: any) => h.symbol === 'solusd')?.amount || 0)} SOL
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">SOL Value</p>
                      <p className="text-white font-medium">
                        ${((portfolio as any)?.holdings?.find((h: any) => h.symbol === 'solusd')?.valueUSD || '0.00')}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">Baseline</p>
                      <p className="text-white font-medium">
                        ${(triggerStatus as any)?.triggerInfo?.baseline?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">Next Trigger</p>
                      <p className="text-success font-medium">
                        ${(triggerStatus as any)?.triggerInfo?.trigger?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 p-3 bg-success/10 border border-success/20 rounded">
                    <p className="text-success text-sm">
                      🎯 Next $1 sale when portfolio reaches ${(triggerStatus as any)?.triggerInfo?.trigger?.toFixed(2) || '0.00'}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Trading Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <TradingControls userId={MOCK_USER_ID} compact />
          <PortfolioHoldings userId={MOCK_USER_ID} compact />
        </div>

        {/* Discord Bot Configuration */}
        <div className="mb-8">
          <DiscordConfig userId={MOCK_USER_ID} compact />
        </div>

        {/* Trading Settings */}
        <TradingSettings userId={MOCK_USER_ID} compact />
      </main>
    </div>
  );
}
