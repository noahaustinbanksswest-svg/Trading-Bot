import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Shield, Target, TrendingUp, Settings } from 'lucide-react';

const tradingSettingsSchema = z.object({
  dailyBuyLimit: z.string().min(1, 'Daily buy limit is required'),
  stopLossPercent: z.string().min(1, 'Stop loss percentage is required'),
  takeProfitPercent: z.string().min(1, 'Take profit percentage is required'),
  enableStopLoss: z.boolean(),
  enableProfitTaking: z.boolean(),
  profitStrategy: z.string(),
  enabledPairs: z.array(z.string()),
});

type TradingSettingsForm = z.infer<typeof tradingSettingsSchema>;

interface TradingSettingsProps {
  userId: string;
  compact?: boolean;
}

const availablePairs = [
  { id: 'btcusd', label: 'BTC/USD' },
  { id: 'ethusd', label: 'ETH/USD' },
  { id: 'ltcusd', label: 'LTC/USD' },
  { id: 'linkusd', label: 'LINK/USD' },
  { id: 'adausd', label: 'ADA/USD' },
  { id: 'dotusd', label: 'DOT/USD' },
];

export default function TradingSettings({ userId, compact = false }: TradingSettingsProps) {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['/api/trading-settings', userId],
  });

  const form = useForm<TradingSettingsForm>({
    resolver: zodResolver(tradingSettingsSchema),
    defaultValues: {
      dailyBuyLimit: '1000',
      stopLossPercent: '5',
      takeProfitPercent: '10',
      enableStopLoss: true,
      enableProfitTaking: true,
      profitStrategy: 'Fixed Percentage',
      enabledPairs: ['btcusd', 'ethusd'],
    },
  });

  // Update form when settings load
  if (settings && !form.formState.isDirty) {
    form.reset({
      dailyBuyLimit: (settings as any).dailyBuyLimit || '1000',
      stopLossPercent: (settings as any).stopLossPercent || '5',
      takeProfitPercent: (settings as any).takeProfitPercent || '10',
      enableStopLoss: (settings as any).enableStopLoss ?? true,
      enableProfitTaking: (settings as any).enableProfitTaking ?? true,
      profitStrategy: (settings as any).profitStrategy || 'Fixed Percentage',
      enabledPairs: (settings as any).enabledPairs || ['btcusd', 'ethusd'],
    });
  }

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: TradingSettingsForm) => {
      return apiRequest('PATCH', `/api/trading-settings/${userId}`, {
        ...data,
        userId,
      });
    },
    onSuccess: () => {
      toast({
        title: 'Settings Updated',
        description: 'Trading settings have been saved successfully.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/trading-settings', userId] });
    },
    onError: (error: any) => {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update trading settings',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = async (data: TradingSettingsForm) => {
    await updateSettingsMutation.mutateAsync(data);
  };

  if (isLoading) {
    return (
      <Card className="bg-surface border-gray-700" data-testid="trading-settings-loading">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-700 rounded w-1/3"></div>
            <div className="h-10 bg-gray-700 rounded"></div>
            <div className="h-10 bg-gray-700 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface border-gray-700" data-testid="trading-settings">
      <CardHeader className="border-b border-gray-700">
        <CardTitle className="text-xl font-semibold text-white flex items-center space-x-2">
          <Settings className="w-5 h-5" />
          <span>Automated Trading Settings</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Risk Management */}
              <div className="space-y-4">
                <h4 className="font-semibold text-lg text-white flex items-center space-x-2">
                  <Shield className="w-5 h-5 text-primary" />
                  <span>Risk Management</span>
                </h4>

                <FormField
                  control={form.control}
                  name="dailyBuyLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Daily Buy Limit (USD)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          className="bg-surfaceLight border-gray-600 text-white placeholder-gray-400"
                          data-testid="input-daily-buy-limit"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="stopLossPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Stop Loss (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          className="bg-surfaceLight border-gray-600 text-white placeholder-gray-400"
                          data-testid="input-stop-loss"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enableStopLoss"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          data-testid="checkbox-enable-stop-loss"
                        />
                      </FormControl>
                      <FormLabel className="text-white">Enable Stop Loss</FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              {/* Profit Taking */}
              <div className="space-y-4">
                <h4 className="font-semibold text-lg text-white flex items-center space-x-2">
                  <Target className="w-5 h-5 text-success" />
                  <span>Profit Taking</span>
                </h4>

                <FormField
                  control={form.control}
                  name="takeProfitPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Take Profit (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.1"
                          className="bg-surfaceLight border-gray-600 text-white placeholder-gray-400"
                          data-testid="input-take-profit"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="profitStrategy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Profit Taking Strategy</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger 
                            className="bg-surfaceLight border-gray-600 text-white"
                            data-testid="select-profit-strategy"
                          >
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-surfaceLight border-gray-600">
                          <SelectItem value="Fixed Percentage" className="text-white hover:bg-gray-700">
                            Fixed Percentage
                          </SelectItem>
                          <SelectItem value="Trailing Stop" className="text-white hover:bg-gray-700">
                            Trailing Stop
                          </SelectItem>
                          <SelectItem value="Daily Target" className="text-white hover:bg-gray-700">
                            Daily Target
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enableProfitTaking"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          data-testid="checkbox-enable-profit-taking"
                        />
                      </FormControl>
                      <FormLabel className="text-white">Enable Profit Taking</FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              {/* Trading Pairs */}
              <div className="space-y-4">
                <h4 className="font-semibold text-lg text-white flex items-center space-x-2">
                  <TrendingUp className="w-5 h-5 text-secondary" />
                  <span>Trading Pairs</span>
                </h4>

                <FormField
                  control={form.control}
                  name="enabledPairs"
                  render={({ field }) => (
                    <FormItem>
                      <div className="space-y-2">
                        {availablePairs.map((pair) => (
                          <div key={pair.id} className="flex items-center space-x-3">
                            <Checkbox
                              checked={field.value.includes(pair.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  field.onChange([...field.value, pair.id]);
                                } else {
                                  field.onChange(field.value.filter((p) => p !== pair.id));
                                }
                              }}
                              className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                              data-testid={`checkbox-pair-${pair.id}`}
                            />
                            <label className="text-white text-sm">{pair.label}</label>
                          </div>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={updateSettingsMutation.isPending}
                  className="w-full bg-primary hover:bg-blue-700 text-white font-semibold"
                  data-testid="button-save-settings"
                >
                  {updateSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
