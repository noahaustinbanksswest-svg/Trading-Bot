import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Eye, EyeOff, Bot, TestTube, CheckCircle, XCircle } from 'lucide-react';

const discordConfigSchema = z.object({
  discordBotToken: z.string().optional(),
  discordGuildId: z.string().optional(),
  discordChannelId: z.string().optional(),
  updateFrequency: z.number().min(30).max(3600),
  enableNotifications: z.boolean(),
  enablePnLUpdates: z.boolean(),
});

type DiscordConfigForm = z.infer<typeof discordConfigSchema>;

interface DiscordConfigProps {
  userId: string;
  compact?: boolean;
}

export default function DiscordConfig({ userId, compact = false }: DiscordConfigProps) {
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery({
    queryKey: ['/api/user', userId],
  });

  const form = useForm<DiscordConfigForm>({
    resolver: zodResolver(discordConfigSchema),
    defaultValues: {
      discordBotToken: '',
      discordGuildId: '',
      discordChannelId: '',
      updateFrequency: 30,
      enableNotifications: true,
      enablePnLUpdates: true,
    },
  });

  // Update form when user data loads
  if (user && !form.formState.isDirty) {
    form.reset({
      discordBotToken: (user as any).discordBotToken || '',
      discordGuildId: (user as any).discordGuildId || '',
      discordChannelId: (user as any).discordChannelId || '',
      updateFrequency: 30,
      enableNotifications: true,
      enablePnLUpdates: true,
    });
  }

  const updateCredentialsMutation = useMutation({
    mutationFn: async (data: DiscordConfigForm) => {
      return apiRequest('PATCH', `/api/user/${userId}/credentials`, data);
    },
    onSuccess: () => {
      toast({
        title: 'Settings Updated',
        description: 'Discord configuration has been saved successfully.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/user', userId] });
    },
    onError: (error: any) => {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update Discord configuration',
        variant: 'destructive',
      });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/discord/test/${userId}`);
    },
    onSuccess: () => {
      setConnectionStatus('connected');
      toast({
        title: 'Connection Successful',
        description: 'Discord bot connection is working!',
      });
    },
    onError: (error: any) => {
      setConnectionStatus('disconnected');
      toast({
        title: 'Connection Failed',
        description: error.message || 'Failed to connect to Discord',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = async (data: DiscordConfigForm) => {
    await updateCredentialsMutation.mutateAsync(data);
  };

  const testConnection = async () => {
    await testConnectionMutation.mutateAsync();
  };

  const getConnectionBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return (
          <Badge variant="outline" className="text-success border-success">
            <CheckCircle className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        );
      case 'disconnected':
        return (
          <Badge variant="outline" className="text-destructive border-destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Disconnected
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-gray-400 border-gray-400">
            Unknown
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-surface border-gray-700" data-testid="discord-config-loading">
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
    <Card className="bg-surface border-gray-700" data-testid="discord-config">
      <CardHeader className="border-b border-gray-700">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-semibold text-white flex items-center space-x-2">
            <Bot className="w-5 h-5" />
            <span>Discord Bot Configuration</span>
          </CardTitle>
          {getConnectionBadge()}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="discordBotToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Bot Token</FormLabel>
                      <div className="flex">
                        <FormControl>
                          <Input
                            type={showToken ? 'text' : 'password'}
                            placeholder="Enter Discord bot token"
                            className="flex-1 bg-surfaceLight border-gray-600 text-white placeholder-gray-400 rounded-r-none"
                            data-testid="input-bot-token"
                            {...field}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className="bg-gray-600 hover:bg-gray-500 border-gray-600 border-l-0 rounded-l-none"
                          onClick={() => setShowToken(!showToken)}
                          data-testid="button-toggle-token"
                        >
                          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="discordGuildId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Guild ID</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="1234567890123456789"
                          className="bg-surfaceLight border-gray-600 text-white placeholder-gray-400"
                          data-testid="input-guild-id"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="discordChannelId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Channel ID</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="9876543210987654321"
                          className="bg-surfaceLight border-gray-600 text-white placeholder-gray-400"
                          data-testid="input-channel-id"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="updateFrequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-white">Update Frequency</FormLabel>
                      <Select 
                        value={field.value?.toString()} 
                        onValueChange={(value) => field.onChange(parseInt(value))}
                      >
                        <FormControl>
                          <SelectTrigger 
                            className="bg-surfaceLight border-gray-600 text-white"
                            data-testid="select-update-frequency"
                          >
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-surfaceLight border-gray-600">
                          <SelectItem value="30" className="text-white hover:bg-gray-700">
                            Every 30 seconds
                          </SelectItem>
                          <SelectItem value="60" className="text-white hover:bg-gray-700">
                            Every minute
                          </SelectItem>
                          <SelectItem value="300" className="text-white hover:bg-gray-700">
                            Every 5 minutes
                          </SelectItem>
                          <SelectItem value="3600" className="text-white hover:bg-gray-700">
                            Manual only
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="enableNotifications"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                            data-testid="checkbox-notifications"
                          />
                        </FormControl>
                        <FormLabel className="text-white">Enable Trade Notifications</FormLabel>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="enablePnLUpdates"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                            data-testid="checkbox-pnl-updates"
                          />
                        </FormControl>
                        <FormLabel className="text-white">Enable P&L Updates</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>

                <Button
                  type="button"
                  onClick={testConnection}
                  disabled={testConnectionMutation.isPending}
                  className="w-full bg-secondary hover:bg-cyan-600 text-white"
                  data-testid="button-test-connection"
                >
                  <TestTube className="w-4 h-4 mr-2" />
                  {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
                </Button>
              </div>
            </div>

            <div className="flex space-x-4">
              <Button
                type="submit"
                disabled={updateCredentialsMutation.isPending}
                className="bg-primary hover:bg-blue-700 text-white"
                data-testid="button-save-discord-config"
              >
                {updateCredentialsMutation.isPending ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
