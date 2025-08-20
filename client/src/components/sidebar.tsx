import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { 
  BarChart3, 
  Wallet, 
  Activity, 
  Bot, 
  Settings, 
  User,
  Gem
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'portfolio', label: 'Portfolio', icon: Wallet },
    { id: 'trading', label: 'Trading', icon: Activity },
    { id: 'discord', label: 'Discord Bot', icon: Bot },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-surface border-r border-gray-700 fixed h-full overflow-y-auto" data-testid="sidebar">
      <div className="p-6">
        <div className="flex items-center space-x-3 mb-8">
          <Gem className="text-primary text-2xl" />
          <h1 className="text-xl font-bold text-white">Gemini Bot</h1>
        </div>
        
        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "flex items-center space-x-3 p-3 rounded-lg w-full text-left transition-colors",
                  activeTab === item.id
                    ? "bg-primary text-white"
                    : "hover:bg-surfaceLight text-gray-300"
                )}
                data-testid={`nav-${item.id}`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
      
      <div className="absolute bottom-0 w-full p-6 border-t border-gray-700">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-medium text-white">CryptoTrader</p>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="text-success border-success">
                Connected
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
