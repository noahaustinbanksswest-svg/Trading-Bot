import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { TrendingUp, TrendingDown } from 'lucide-react';

const orderSchema = z.object({
  symbol: z.string().min(1, 'Trading pair is required'),
  orderType: z.enum(['exchange market', 'exchange limit', 'exchange stop']),
  side: z.enum(['buy', 'sell']),
  amount: z.string().min(1, 'Amount is required'),
  price: z.string().optional(),
});

type OrderForm = z.infer<typeof orderSchema>;

interface TradingControlsProps {
  userId: string;
  compact?: boolean;
}

export default function TradingControls({ userId, compact = false }: TradingControlsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const form = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      symbol: '',
      orderType: 'exchange market',
      side: 'buy',
      amount: '',
      price: '',
    },
  });

  const { data: symbols } = useQuery({
    queryKey: ['/api/symbols', userId],
    enabled: !!userId,
  });

  const { data: ticker } = useQuery({
    queryKey: ['/api/ticker', userId, form.watch('symbol')],
    enabled: !!form.watch('symbol'),
    refetchInterval: 5000,
  });

  const orderMutation = useMutation({
    mutationFn: async (data: OrderForm) => {
      return apiRequest('POST', '/api/orders', {
        ...data,
        userId,
      });
    },
    onSuccess: () => {
      toast({
        title: 'Order Placed',
        description: 'Your trade order has been submitted successfully.',
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['/api/orders', userId] });
      queryClient.invalidateQueries({ queryKey: ['/api/portfolio', userId] });
    },
    onError: (error: any) => {
      toast({
        title: 'Order Failed',
        description: error.message || 'Failed to place order',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = async (data: OrderForm) => {
    setIsSubmitting(true);
    try {
      await orderMutation.mutateAsync(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedSymbol = form.watch('symbol');
  const orderType = form.watch('orderType');
  const side = form.watch('side');

  // Auto-populate price for market orders
  if (orderType === 'exchange market' && ticker) {
    form.setValue('price', side === 'buy' ? (ticker as any).ask : (ticker as any).bid);
  }

  return (
    <Card className="bg-surface border-gray-700" data-testid="trading-controls">
      <CardHeader className="border-b border-gray-700">
        <CardTitle className="text-xl font-semibold text-white">Quick Trade</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="symbol"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Trading Pair</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger 
                        className="bg-surfaceLight border-gray-600 text-white"
                        data-testid="select-trading-pair"
                      >
                        <SelectValue placeholder="Select trading pair" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-surfaceLight border-gray-600">
                      {(symbols as string[])?.map((symbol: string) => (
                        <SelectItem 
                          key={symbol} 
                          value={symbol}
                          className="text-white hover:bg-gray-700"
                        >
                          {symbol.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="orderType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Order Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger 
                          className="bg-surfaceLight border-gray-600 text-white"
                          data-testid="select-order-type"
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-surfaceLight border-gray-600">
                        <SelectItem value="exchange market" className="text-white hover:bg-gray-700">
                          Market
                        </SelectItem>
                        <SelectItem value="exchange limit" className="text-white hover:bg-gray-700">
                          Limit
                        </SelectItem>
                        <SelectItem value="exchange stop" className="text-white hover:bg-gray-700">
                          Stop Loss
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="side"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Side</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger 
                          className="bg-surfaceLight border-gray-600 text-white"
                          data-testid="select-side"
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-surfaceLight border-gray-600">
                        <SelectItem value="buy" className="text-white hover:bg-gray-700">
                          <div className="flex items-center space-x-2">
                            <TrendingUp className="w-4 h-4 text-green-500" />
                            <span>Buy</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="sell" className="text-white hover:bg-gray-700">
                          <div className="flex items-center space-x-2">
                            <TrendingDown className="w-4 h-4 text-red-500" />
                            <span>Sell</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Amount</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.00000001"
                      placeholder="0.00"
                      className="bg-surfaceLight border-gray-600 text-white placeholder-gray-400"
                      data-testid="input-amount"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {orderType === 'exchange limit' && (
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-white">Price (USD)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="bg-surfaceLight border-gray-600 text-white placeholder-gray-400"
                        data-testid="input-price"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {ticker && selectedSymbol ? (
              <div className="bg-surfaceLight p-4 rounded-lg" data-testid="ticker-info">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">Last Price: </span>
                    <span className="text-white font-medium">${(ticker as any)?.last || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">24h Change: </span>
                    <span className="text-white font-medium">{(ticker as any)?.changes?.[0] || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Bid: </span>
                    <span className="text-white font-medium">${(ticker as any)?.bid || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Ask: </span>
                    <span className="text-white font-medium">${(ticker as any)?.ask || 'N/A'}</span>
                  </div>
                </div>
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={isSubmitting || orderMutation.isPending}
              className="w-full bg-primary hover:bg-blue-700 text-white font-semibold"
              data-testid="button-place-order"
            >
              {isSubmitting || orderMutation.isPending ? 'Placing Order...' : 'Place Order'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
