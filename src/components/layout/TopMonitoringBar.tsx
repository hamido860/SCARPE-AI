import React, { useState } from "react";
import { Layers, Trash2, Copy, Check, Pause, Play, Activity, Settings, Key } from "lucide-react";
import { JobView } from "../../types/jobs";

interface TopMonitoringBarProps {
  activeJobView: JobView;
  onJobViewChange: (view: JobView) => void;
  onResetWorkspace: () => void;
  onRefreshStats?: () => void;
  crawledPdfsCount: number;
  stagedPdfsCount: number;
  selectedPdfUrlsCount: number;
  classifiedCount: number;
  needsReviewCount: number;
  failedCount: number;
  cleanCopiesCount: number;
  localRoot: string;
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  isBusy?: boolean;
  onOpenSecretModal?: () => void;
}

export function TopMonitoringBar({
  activeJobView,
  onJobViewChange,
  onResetWorkspace,
  crawledPdfsCount,
  stagedPdfsCount,
  selectedPdfUrlsCount,
  classifiedCount,
  failedCount,
  localRoot,
  isPaused = false,
  onPause,
  onResume,
  isBusy = false,
  onOpenSecretModal
}: TopMonitoringBarProps) {
  const [copied, setCopied] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  
  const handleJobViewChange = (view: JobView) => {
    onJobViewChange(view);
  };

  const handleResetClick = () => {
    if (!showConfirm) {
      setShowConfirm(true);
      setTimeout(() => setShowConfirm(false), 3000); // Auto hide after 3 seconds
    } else {
      setShowConfirm(false);
      onResetWorkspace();
    }
  };

  const copyPath = () => {
    navigator.clipboard.writeText(localRoot || "/workspace");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const views: JobView[] = ["intake", "processing", "indexing", "review", "output", "settings"];

  return (
    <div id="top-monitoring-bar" className="h-16 w-full bg-white border-b border-neutral-300 flex items-center justify-between px-6 shrink-0 sticky top-0 z-50 select-none shadow-sm">
      <div className="flex items-center gap-8 h-full">
        {/* Branding */}
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-1.5 flex items-center justify-center">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <h1 className="font-mono font-black text-[13px] tracking-tighter uppercase text-neutral-900">SCARPE-AI</h1>
        </div>
        
        {/* Workflow Tabs */}
        <nav className="flex items-center gap-1 h-full">
          {views.map((view) => {
            const isActive = activeJobView === view;
            return (
              <button
                key={view}
                onClick={() => handleJobViewChange(view)}
                className={`relative h-10 px-4 flex items-center justify-center text-[11px] font-mono font-bold uppercase transition-all whitespace-nowrap group ${
                  isActive
                    ? "text-neutral-900 bg-neutral-100"
                    : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50"
                }`}
              >
                  <div className="flex items-center gap-1.5">
                    {view === "settings" && <Settings className="w-3.5 h-3.5" />}
                    {view === "processing" && <Activity className="w-3.5 h-3.5" />}
                    <span>
                      {view === "intake" ? "Collect PDFs" :
                       view === "processing" ? "Clean & OCR" :
                       view === "indexing" ? "Build RAG" :
                       view === "review" ? "Validate" :
                       view === "output" ? "Export" :
                       view === "reports" ? "Audit" :
                       view === "settings" ? "Settings" : view}
                    </span>
                  </div>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-6 h-full">
        {/* Engine Controls */}
        <div className="flex items-center gap-2">
          {isPaused ? (
            <button onClick={onResume} className="flex items-center gap-1.5 h-8 px-3 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-mono font-bold uppercase transition-colors">
              <Play className="w-3 h-3 fill-current" />
              <span>Resume</span>
            </button>
          ) : (
            <button onClick={onPause} className="flex items-center gap-1.5 h-8 px-3 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 text-[10px] font-mono font-bold uppercase transition-colors">
              <Pause className="w-3 h-3 fill-current" />
              <span>Pause</span>
            </button>
          )}
        </div>

        {/* Secret AI Studio Keys Trigger */}
        <button
          onClick={onOpenSecretModal}
          className="flex items-center gap-1.5 h-8 px-3 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-mono font-bold uppercase transition-colors shadow-sm cursor-pointer"
          title="Secret AI Studio API Keys Modal"
        >
          <Key className="w-3.5 h-3.5" />
          <span>AI Studio Secrets</span>
        </button>

        {/* Local Path */}
        <div 
          className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 px-3 h-8 hover:bg-neutral-100 transition-colors cursor-copy max-w-[150px]"
          onClick={copyPath}
          title={localRoot || "/workspace"}
        >
          <span className="text-[10px] font-mono font-bold text-neutral-600 truncate">
            {localRoot || "/workspace"}
          </span>
          {copied ? <Check className="w-3 h-3 text-emerald-600 shrink-0" /> : <Copy className="w-3 h-3 text-neutral-400 shrink-0" />}
        </div>

        {/* Reset Action */}
        <button
          onClick={handleResetClick}
          className={`flex items-center gap-1.5 h-8 px-3 transition-all font-mono font-bold text-[10px] uppercase shadow-sm ${
            showConfirm 
              ? "bg-red-600 text-white border-red-600 animate-pulse" 
              : "bg-white text-red-600 border-red-200 hover:bg-red-50"
          }`}
        >
          <Trash2 className="w-3 h-3" />
          <span>{showConfirm ? "Click to Confirm" : "Reset"}</span>
        </button>
      </div>
    </div>
  );
}

export default TopMonitoringBar;
