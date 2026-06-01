import React from "react";
import { 
  Play, Pause, Square, Settings, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dictionary } from "../../../types/dictionary";
import { BatchJob, BatchJobItem } from "../../../types/jobs";
import { StagedPdf } from "../../../types/pdf";
import { JobWorkspaceLayout } from "../../layout/JobWorkspaceLayout";

interface ProcessingJobViewProps {
  dictionary: Dictionary;
  scopeGradeId: string;
  setScopeGradeId: (id: string) => void;
  scopeSubjectId: string;
  setScopeSubjectId: (id: string) => void;
  scopeStatus: string;
  setScopeStatus: (status: string) => void;

  ocrBatchMode: "Disabled" | "Safe" | "Balanced" | "Fast";
  handleApplyOcrModePreset: (preset: "safe" | "balanced" | "fast") => Promise<void>;

  isBatchJobRunning: boolean;
  activeBatchJob: BatchJob | null;
  batchJobItems: BatchJobItem[];
  stagedPdfs: StagedPdf[];

  startBatchJob: () => Promise<void>;
  createBatchJob: () => void;
  pauseBatchJob: () => Promise<void>;
  stopBatchJob: () => Promise<void>;
}

export function ProcessingJobView({
  dictionary,
  scopeGradeId,
  setScopeGradeId,
  scopeSubjectId,
  setScopeSubjectId,
  scopeStatus,
  setScopeStatus,
  ocrBatchMode,
  handleApplyOcrModePreset,
  isBatchJobRunning,
  activeBatchJob,
  batchJobItems,
  stagedPdfs,
  startBatchJob,
  createBatchJob,
  pauseBatchJob,
  stopBatchJob
}: ProcessingJobViewProps) {

  const sidebarContent = (
    <div className="p-4 flex flex-col h-full space-y-6">
      <div>
        <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Processing Job</h2>
        <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
          Run batched AI pipelines on staged files. Extracts texts, assigns classifications, and isolates problematic documents.
        </p>
      </div>
      
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Grade Scope</label>
          <select 
            id="processing-grade-scope"
            value={scopeGradeId} 
            onChange={e => setScopeGradeId(e.target.value)} 
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0"
          >
            <option value="all">ANY GRADE [ALL]</option>
            {dictionary?.grades?.map((g, idx) => (
              <option key={g.id || `grade-${idx}`} value={g.id}>{g.nameFr} ({g.nameAr})</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Subject Scope</label>
          <select 
            id="processing-subject-scope"
            value={scopeSubjectId} 
            onChange={e => setScopeSubjectId(e.target.value)} 
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0"
          >
            <option value="all">ANY SUBJECT [ALL]</option>
            {dictionary?.subjects?.map((s, idx) => (
              <option key={s.id || `subject-${idx}`} value={s.id}>{s.nameFr}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">File Status Scope</label>
          <select 
            id="processing-status-scope"
            value={scopeStatus} 
            onChange={e => setScopeStatus(e.target.value)} 
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0"
          >
            <option value="all">ALL STAGED</option>
            <option value="pending">PENDING ONLY</option>
            <option value="needs_review">NEEDS REVIEW (RETRY)</option>
            <option value="ocr_needed">NEEDS OCR ONLY</option>
            <option value="failed">FAILED ONLY</option>
          </select>
        </div>
        
        <div className="border border-neutral-200 bg-neutral-50 p-3 mt-4">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block mb-2 flex items-center gap-1.5">
            <Settings className="w-3 h-3"/> OCR Policy
          </label>
          <select 
            id="processing-ocr-mode"
            value={ocrBatchMode} 
            onChange={e => handleApplyOcrModePreset(e.target.value.toLowerCase() as any).catch(console.error)} 
            className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414]"
          >
            <option value="Disabled">Disabled (Fastest)</option>
            <option value="Safe">Safe Mode (Slow, API safe)</option>
            <option value="Balanced">Balanced</option>
            <option value="Fast">Fast (Parallel, High Quota)</option>
          </select>
        </div>
      </div>

      <div className="mt-auto pt-6 border-t border-neutral-200 space-y-3">
        {!isBatchJobRunning ? (
           <Button 
             id="processing-run-job-btn"
             onClick={activeBatchJob ? startBatchJob : createBatchJob} 
             className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(37,99,235,0.5)]"
           >
             <Play className="w-4 h-4 mr-2" /> {activeBatchJob ? "Resume Job" : "Run Batch Job"}
           </Button>
        ) : (
          <div className="flex gap-2">
            <Button 
              id="processing-pause-job-btn"
              onClick={pauseBatchJob} 
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
            >
              <Pause className="w-4 h-4 mr-1" /> Pause
            </Button>
            <Button 
              id="processing-stop-job-btn"
              onClick={stopBatchJob} 
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
            >
              <Square className="w-4 h-4 mr-1" /> Stop
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex flex-col h-full bg-neutral-100/30">
      {/* Top Summaries */}
      <div className="p-6 bg-white border-b border-neutral-200 shrink-0 grid grid-cols-5 gap-4">
        <div className="border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-[9px] uppercase font-bold text-neutral-500 mb-1">Queued</div>
          <div id="processing-stat-queued" className="font-mono text-2xl font-bold text-neutral-800">
            {activeBatchJob ? activeBatchJob.pending : stagedPdfs.length}
          </div>
        </div>
        <div className="border border-blue-200 bg-blue-50 p-3">
          <div className="text-[9px] uppercase font-bold text-blue-600 mb-1">Running</div>
          <div id="processing-stat-running" className="font-mono text-2xl font-bold text-blue-800">
            {activeBatchJob ? activeBatchJob.running : 0}
          </div>
        </div>
        <div className="border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-[9px] uppercase font-bold text-emerald-600 mb-1">Completed</div>
          <div id="processing-stat-completed" className="font-mono text-2xl font-bold text-emerald-800">
            {activeBatchJob ? activeBatchJob.completed : stagedPdfs.filter(p => p.status === "classified").length}
          </div>
        </div>
        <div className="border border-amber-200 bg-amber-50 p-3">
          <div className="text-[9px] uppercase font-bold text-amber-600 mb-1">Blocked (Review)</div>
          <div id="processing-stat-blocked" className="font-mono text-2xl font-bold text-amber-800">
            {activeBatchJob ? activeBatchJob.blocked : stagedPdfs.filter(p => p.status === "needs_review").length}
          </div>
        </div>
        <div className="border border-red-200 bg-red-50 p-3">
          <div className="text-[9px] uppercase font-bold text-red-600 mb-1">Failed</div>
          <div id="processing-stat-failed" className="font-mono text-2xl font-bold text-red-800">
            {activeBatchJob ? activeBatchJob.failed : stagedPdfs.filter(p => p.status === "failed").length}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6 bg-neutral-50">
        {!activeBatchJob ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400">
             <Play className="w-12 h-12 mb-3 opacity-20" />
             <p className="text-xs uppercase font-mono tracking-wider font-bold">No Active Batch Job</p>
             <p className="text-[10px] mt-1 max-w-xs text-neutral-500">
               Configure parameters in the sidebar and click Run Batch Job to start processing staged PDFs.
             </p>
          </div>
        ) : (
          <div className="border border-neutral-200 bg-white">
            <div className="divide-y divide-neutral-100">
               {batchJobItems.slice(0, 50).map((item, idx) => (
                  <div key={item.id || item.url || idx} className="p-3 flex items-center gap-4 text-sm font-mono">
                    <div className="text-[10px] text-neutral-400 w-6">#{idx+1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-neutral-800 truncate">{item.filename}</div>
                      <div className="text-[9px] text-neutral-500 mt-1 flex gap-2">
                        <span>Step: <span className="font-bold text-neutral-700 uppercase">{item.currentStep}</span></span>
                        <span>Status: <span className={`font-bold uppercase ${
                          item.status === 'clean_copy_done' ? 'text-emerald-600' : 
                          item.status === 'blocked' ? 'text-amber-600' : 
                          item.status === 'failed' ? 'text-red-600' : 
                          item.status === 'running' ? 'text-blue-600' : 'text-neutral-500'
                        }`}>{item.status}</span></span>
                      </div>
                    </div>
                    {item.confidenceScore !== undefined && (
                       <div className="shrink-0 text-[10px] font-bold">
                         <span className={item.confidenceScore > 80 ? 'text-emerald-600' : item.confidenceScore > 50 ? 'text-amber-600' : 'text-red-600'}>
                            {item.confidenceScore}% CONF
                         </span>
                       </div>
                    )}
                  </div>
               ))}
            </div>
            {batchJobItems.length > 50 && (
               <div className="p-3 text-center text-[10px] font-mono text-neutral-500 border-t border-neutral-100">
                  + {batchJobItems.length - 50} more items in queue
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <JobWorkspaceLayout 
      sidebar={sidebarContent} 
      main={mainContent} 
    />
  );
}
export default ProcessingJobView;
