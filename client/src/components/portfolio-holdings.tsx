import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Bitcoin, Zap, Coins } from 'lucide-react';

interface PortfolioHoldingsProps {
  userId: string;
  compact?: boolean;
}

export default function PortfolioHoldings({ userId, compact = false }: PortfolioHoldingsProps) {
  const { data: portfolio, isLoading, error } = useQuery({
    queryKey: ['/api/portfolio', userId],
    refetchInterval: 30000,
  });

  const getCryptoIcon = (symbol: string) => {
    const lowerSymbol = symbol.toLowerCase();
    if (lowerSymbol.includes('btc')) return Bitcoin;
    if (lowerSymbol.includes('eth')) return Zap;
    return Coins;
  };

  const getCryptoColor = (symbol: string) => {
    const lowerSymbol = symbol.toLowerCase();
    if (lowerSymbol.includes('btc')) return 'bg-orange-500';
    if (lowerSymbol.includes('eth')) return 'bg-blue-500';
    if (lowerSymbol.includes('ltc')) return 'bg-green-500';
    return 'bg-purple-500';
  };

  const formatCurrency = (symbol: string) => {
    return symbol.replace('usd', '').toUpperCase();
  };

  const formatAmount = (amount: string) => {
    const num = parseFloat(amount);
    return num.toFixed(8);
  };

  if (error) {
    return (
      <Card className="bg-surface border-gray-700" data-testid="portfolio-error">
        <CardContent className="p-6">
          <p className="text-red-400">Failed to load portfolio data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface border-gray-700" data-testid="portfolio-holdings">
      <CardHeader className="border-b border-gray-700">
        <CardTitle className="text-xl font-semibold text-white">Portfolio Holdings</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-surfaceLight rounded-lg">
                <div className="flex items-center space-x-4">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
                <div className="text-right space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : !(portfolio as any)?.holdings?.length ? (
          <div className="text-center py-8" data-testid="portfolio-empty">
            <Coins className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-400">No holdings found</p>
            <p className="text-sm text-gray-500 mt-2">
              Connect your Gemini account to view your portfolio
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {(portfolio as any).holdings.slice(0, compact ? 3 : undefined).map((holding: any) => {
              const Icon = getCryptoIcon(holding.symbol);
              const colorClass = getCryptoColor(holding.symbol);
              const currency = formatCurrency(holding.symbol);
              
              return (
                <div 
                  key={holding.symbol} 
                  className="flex items-center justify-between p-4 bg-surfaceLight rounded-lg hover:bg-gray-700 transition-colors"
                  data-testid={`holding-${holding.symbol}`}
                >
                  <div className="flex items-center space-x-4">
                    <div className={`w-10 h-10 ${colorClass} rounded-full flex items-center justify-center`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{currency}</p>
                      <p className="text-gray-400 text-sm">{holding.symbol.toUpperCase()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-white" data-testid={`amount-${holding.symbol}`}>
                      {formatAmount(holding.amount)}
                    </p>
                    <p className="text-gray-400 text-sm" data-testid={`value-${holding.symbol}`}>
                      ${parseFloat(holding.valueUSD || '0').toFixed(2)}
                    </p>
                  </div>
                </div>
              );
            })}
            
            {compact && (portfolio as any).holdings.length > 3 && (
              <div className="text-center pt-4 border-t border-gray-700">
                <p className="text-gray-400 text-sm">
                  +{(portfolio as any).holdings.length - 3} more holdings
                </p>
              </div>
            )}
          </div>
        )}
        
        {(portfolio as any)?.totalValue && (
          <div className="mt-6 pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Total Portfolio Value</span>
              <span className="text-xl font-bold text-white" data-testid="total-portfolio-value">
                ${(portfolio as any).totalValue}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
