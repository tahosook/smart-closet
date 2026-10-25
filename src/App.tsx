import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Compass,
  Grid,
  History,
  Shirt,
  CalendarCheck2,
  Cloud,
  CloudOff,
  RefreshCw,
} from 'lucide-react';
import { ClosetProvider, useClosetStore } from './hooks/useClosetStore';
import { TodayView } from './components/TodayView';
import { AiSyncView } from './components/AiSyncView';
import { TravelPlannerView } from './components/TravelPlannerView';
import { MatrixView } from './components/MatrixView';
import { HistoryModal } from './components/HistoryModal';
import { GasSyncModal } from './components/GasSyncModal';
import { initStorage } from './utils/imageStore';

type ActiveTab = 'today' | 'ai' | 'travel' | 'matrix';

const AppShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isGasModalOpen, setIsGasModalOpen] = useState(false);

  const { syncStatus } = useClosetStore();

  useEffect(() => {
    initStorage();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-blue-600 selection:text-white">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 px-3 sm:px-4 py-2 sm:py-3 pt-safe">
        <div className="max-w-2xl lg:max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-sky-400 flex items-center justify-center shadow-md shadow-blue-900/40">
              <Shirt className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-base font-extrabold text-white tracking-tight">Smart Closet</h1>
                <span className="text-[10px] bg-blue-600/30 text-blue-300 font-bold px-1.5 py-0.2 rounded border border-blue-500/40">
                  1秒即決
                </span>
              </div>
              <p className="text-[10px] text-slate-400">奥様ダメ出し完全回避コーデ</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Cloud Sync Status Button (min 44x44px tap target) */}
            <button
              onClick={() => setIsGasModalOpen(true)}
              className="min-w-[44px] min-h-[44px] p-2.5 text-slate-300 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700 transition-colors border border-slate-700/60 relative flex items-center justify-center"
              title="クラウド同期・スプレッドシート設定"
            >
              {syncStatus === 'syncing' ? (
                <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
              ) : syncStatus === 'synced' ? (
                <div className="relative">
                  <Cloud className="w-4 h-4 text-emerald-400" />
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full shadow-sm shadow-emerald-500/80 ring-2 ring-slate-900" />
                </div>
              ) : syncStatus === 'offline_pending' || syncStatus === 'error' ? (
                <div className="relative">
                  <CloudOff className="w-4 h-4 text-amber-400" />
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full shadow-sm shadow-amber-500/80 ring-2 ring-slate-900" />
                </div>
              ) : (
                <Cloud className="w-4 h-4 text-slate-400 hover:text-slate-200" />
              )}
            </button>

            {/* Wear History Button (min 44x44px tap target) */}
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="min-w-[44px] min-h-[44px] p-2.5 text-slate-300 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700 transition-colors border border-slate-700/60 flex items-center justify-center"
              title="着用履歴と冷却テスト"
            >
              <History className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-2xl lg:max-w-6xl mx-auto p-2.5 sm:p-4">
        {activeTab === 'today' && <TodayView />}
        {activeTab === 'ai' && <AiSyncView />}
        {activeTab === 'travel' && <TravelPlannerView />}
        {activeTab === 'matrix' && <MatrixView />}
      </main>

      {/* History Modal */}
      <HistoryModal isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />

      {/* GAS Cloud Sync Modal */}
      <GasSyncModal isOpen={isGasModalOpen} onClose={() => setIsGasModalOpen(false)} />

      {/* Fixed Bottom Navigation (Pixel 9a Thumb Friendly) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800/80 pb-safe">
        <div className="max-w-2xl lg:max-w-6xl mx-auto grid grid-cols-4 px-2 py-1.5">
          {/* Tab 1: Today */}
          <button
            onClick={() => setActiveTab('today')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'today'
                ? 'text-blue-400 font-bold bg-blue-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CalendarCheck2 className="w-5 h-5 mb-0.5" />
            <span className="text-[11px] leading-tight">朝モード</span>
          </button>

          {/* Tab 2: AI Sync */}
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'ai'
                ? 'text-blue-400 font-bold bg-blue-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-5 h-5 mb-0.5" />
            <span className="text-[11px] leading-tight">服追加・AI</span>
          </button>

          {/* Tab 3: Travel */}
          <button
            onClick={() => setActiveTab('travel')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'travel'
                ? 'text-blue-400 font-bold bg-blue-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-5 h-5 mb-0.5" />
            <span className="text-[11px] leading-tight">旅行</span>
          </button>

          {/* Tab 4: Matrix */}
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
              activeTab === 'matrix'
                ? 'text-blue-400 font-bold bg-blue-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid className="w-5 h-5 mb-0.5" />
            <span className="text-[11px] leading-tight">全マトリクス</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ClosetProvider>
      <AppShell />
    </ClosetProvider>
  );
};
