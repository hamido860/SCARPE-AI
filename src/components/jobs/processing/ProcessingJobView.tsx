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
  siteMapNodes?: any[];
  onUpdateSiteMapNode?: (id: string, updates: any) => void;

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
  siteMapNodes = [],
  onUpdateSiteMapNode,
  startBatchJob,
  createBatchJob,
  pauseBatchJob,
  stopBatchJob
}: ProcessingJobViewProps) {

  const stagedPdfAssets = siteMapNodes.filter((n: any) => 
    n.page_role === "pdf_asset" && 
    n.action === "stage_asset" && 
    n.status === "completed" && 
    !n.rejection_reason
  ).map((n: any) => ({
    ...n,
    verification_status: n.verification_status || "pending",
    download_status: n.download_status || "pending",
    extraction_status: n.extraction_status || "pending",
    ocr_status: n.ocr_status || "not_needed",
    cleaning_status: n.cleaning_status || "pending",
    lesson_match_status: n.lesson_match_status || "pending",
    chunking_status: n.chunking_status || "pending",
    quality_score: n.quality_score || null,
    processing_errors: n.processing_errors || []
  }));

  const [selectedUrls, setSelectedUrls] = React.useState<string[]>([]);

  const sidebarContent = (
    <div className="p-4 flex flex-col h-full space-y-6">
      <div>
        <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">PDF Processing Pipeline</h2>
        <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
          Process staged PDF assets through Verification, Download, Extraction, OCR, Cleaning, Lesson Matching, and Chunking.
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
      <div className="p-6 bg-white border-b border-neutral-200 shrink-0 grid grid-cols-4 gap-4">
        <div className="border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-[9px] uppercase font-bold text-neutral-500 mb-1">Total Staged</div>
          <div className="font-mono text-2xl font-bold text-neutral-800">{stagedPdfAssets.length}</div>
        </div>
        <div className="border border-blue-200 bg-blue-50 p-3">
          <div className="text-[9px] uppercase font-bold text-blue-600 mb-1">Verified</div>
          <div className="font-mono text-xl font-bold text-blue-800">{stagedPdfAssets.filter((a:any) => a.verification_status === "valid_pdf").length}</div>
        </div>
        <div className="border border-indigo-200 bg-indigo-50 p-3">
          <div className="text-[9px] uppercase font-bold text-indigo-600 mb-1">Downloaded</div>
          <div className="font-mono text-xl font-bold text-indigo-800">{stagedPdfAssets.filter((a:any) => a.download_status === "downloaded").length}</div>
        </div>
        <div className="border border-fuchsia-200 bg-fuchsia-50 p-3">
          <div className="text-[9px] uppercase font-bold text-fuchsia-600 mb-1">Text Extracted</div>
          <div className="font-mono text-xl font-bold text-fuchsia-800">{stagedPdfAssets.filter((a:any) => a.extraction_status === "extracted").length}</div>
        </div>
        <div className="border border-amber-200 bg-amber-50 p-3">
          <div className="text-[9px] uppercase font-bold text-amber-600 mb-1">OCR Needed</div>
          <div className="font-mono text-xl font-bold text-amber-800">{stagedPdfAssets.filter((a:any) => a.ocr_status === "needed").length}</div>
        </div>
        <div className="border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-[9px] uppercase font-bold text-emerald-600 mb-1">Matched to Lessons</div>
          <div className="font-mono text-xl font-bold text-emerald-800">{stagedPdfAssets.filter((a:any) => a.lesson_match_status === "matched").length}</div>
        </div>
        <div className="border border-teal-200 bg-teal-50 p-3">
          <div className="text-[9px] uppercase font-bold text-teal-600 mb-1">Ready for RAG</div>
          <div className="font-mono text-xl font-bold text-teal-800">{stagedPdfAssets.filter((a:any) => a.chunking_status === "rag_ready").length}</div>
        </div>
        <div className="border border-red-200 bg-red-50 p-3">
          <div className="text-[9px] uppercase font-bold text-red-600 mb-1">Failed / Needs Review</div>
          <div className="font-mono text-xl font-bold text-red-800">{stagedPdfAssets.filter((a:any) => a.processing_errors && a.processing_errors.length > 0).length}</div>
        </div>
      </div>

      <div className="flex gap-2 p-4 bg-white border-b border-neutral-200 shrink-0">
        <Button 
          variant="outline" size="sm" 
          className="text-[10px] uppercase font-mono"
          onClick={() => setSelectedUrls(stagedPdfAssets.map((a:any) => a.canonical_url))}
        >
          Select All
        </Button>
        <Button 
          variant="outline" size="sm" 
          className="text-[10px] uppercase font-mono text-red-600"
          onClick={() => setSelectedUrls([])}
        >
          Clear
        </Button>
        <Button 
          variant="outline" size="sm" 
          className="text-[10px] uppercase font-mono bg-blue-50 text-blue-700"
          disabled={selectedUrls.length === 0}
        >
          Process Selected
        </Button>
        <Button 
          variant="outline" size="sm" 
          className="text-[10px] uppercase font-mono bg-blue-600 text-white hover:bg-blue-700"
        >
          Process All Valid
        </Button>
        <Button 
          variant="outline" size="sm" 
          className="text-[10px] uppercase font-mono bg-amber-50 text-amber-700"
        >
          Retry Failed
        </Button>
        <Button 
          variant="outline" size="sm" 
          className="text-[10px] uppercase font-mono bg-emerald-50 text-emerald-700"
          disabled={selectedUrls.length === 0}
          onClick={() => {
            const data = stagedPdfAssets.filter((a: any) => selectedUrls.includes(a.canonical_url));
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const urlObj = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = urlObj;
            a.download = "processed_assets.json";
            a.click();
          }}
        >
          Export Processed JSON
        </Button>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto p-4 bg-neutral-50">
        {stagedPdfAssets.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400">
             <p className="text-xs uppercase font-mono tracking-wider font-bold">No Staged PDFs</p>
             <p className="text-[10px] mt-1 max-w-xs text-neutral-500">
               Stage PDFs from the Intake tab first.
             </p>
          </div>
        ) : (
          <div className="border border-neutral-200 bg-white">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-[9px] font-mono uppercase text-neutral-500">
                  <th className="p-2 w-10 text-center">
                    <input 
                      type="checkbox" 
                      className="rounded-none cursor-pointer"
                      checked={stagedPdfAssets.length > 0 && selectedUrls.length === stagedPdfAssets.length}
                      onChange={() => {
                        if (selectedUrls.length === stagedPdfAssets.length) setSelectedUrls([]);
                        else setSelectedUrls(stagedPdfAssets.map((n:any)=>n.canonical_url));
                      }}
                    />
                  </th>
                  <th className="p-2 w-64">Topic & Meta</th>
                  <th className="p-2 w-24">Grade/Subj</th>
                  <th className="p-2 w-24">Doc Type</th>
                  <th className="p-2 w-24">Verification</th>
                  <th className="p-2 w-24">Download</th>
                  <th className="p-2 w-24">Extraction</th>
                  <th className="p-2 w-24">OCR</th>
                  <th className="p-2 w-24">Lesson Match</th>
                  <th className="p-2 w-20">Quality</th>
                  <th className="p-2 w-48 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-[10px]">
                {stagedPdfAssets.map((node: any, idx: number) => {
                  const isChecked = selectedUrls.includes(node.canonical_url);
                  const canExportToSupabase = 
                    node.verification_status === "valid_pdf" && 
                    node.extraction_status === "extracted" && 
                    node.cleaning_status === "cleaned" && 
                    node.lesson_match_status === "matched";

                  return (
                    <tr key={node.id || idx} className={`hover:bg-neutral-50/50 ${isChecked ? 'bg-blue-50/30' : ''}`}>
                      <td className="p-2 text-center align-top pt-3">
                        <input 
                          type="checkbox" 
                          className="rounded-none cursor-pointer"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) setSelectedUrls(prev => prev.filter(u => u !== node.canonical_url));
                            else setSelectedUrls(prev => [...prev, node.canonical_url]);
                          }}
                        />
                      </td>
                      <td className="p-2 align-top text-neutral-800 font-mono truncate max-w-[200px]" title={node.extracted_topic || ""}>
                        <div className="font-bold">{node.extracted_topic || "—"}</div>
                        <div className="text-[9px] text-neutral-400 mt-0.5 truncate">{node.canonical_url}</div>
                      </td>
                      <td className="p-2 align-top text-neutral-600 font-mono">
                        <div className="uppercase tracking-tight text-[8px] border border-neutral-200 bg-neutral-50 inline-block px-1 mb-0.5">{node.extracted_grade || "—"}</div>
                        <br/>
                        <div className="uppercase tracking-tight text-[8px] border border-neutral-200 bg-neutral-50 inline-block px-1">{node.extracted_subject || "—"}</div>
                      </td>
                      <td className="p-2 align-top text-neutral-600 font-mono">
                        <div className="uppercase tracking-tight text-[8px] border border-blue-200 text-blue-700 bg-blue-50 inline-block px-1">{node.extracted_document_type || "—"}</div>
                      </td>
                      <td className="p-2 align-top font-mono">
                         <span className={`uppercase px-1 py-0.5 border text-[8px] font-bold ${node.verification_status === 'valid_pdf' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-neutral-200 text-neutral-500 bg-neutral-50'}`}>
                           {node.verification_status}
                         </span>
                      </td>
                      <td className="p-2 align-top font-mono">
                         <span className={`uppercase px-1 py-0.5 border text-[8px] font-bold ${node.download_status === 'downloaded' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-neutral-200 text-neutral-500 bg-neutral-50'}`}>
                           {node.download_status}
                         </span>
                      </td>
                      <td className="p-2 align-top font-mono">
                         <span className={`uppercase px-1 py-0.5 border text-[8px] font-bold ${node.extraction_status === 'extracted' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-neutral-200 text-neutral-500 bg-neutral-50'}`}>
                           {node.extraction_status}
                         </span>
                      </td>
                      <td className="p-2 align-top font-mono">
                         <span className={`uppercase px-1 py-0.5 border text-[8px] font-bold ${node.ocr_status === 'completed' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : node.ocr_status === 'needed' ? 'border-amber-200 text-amber-700 bg-amber-50' : 'border-neutral-200 text-neutral-500 bg-neutral-50'}`}>
                           {node.ocr_status}
                         </span>
                      </td>
                      <td className="p-2 align-top font-mono">
                         <span className={`uppercase px-1 py-0.5 border text-[8px] font-bold ${node.lesson_match_status === 'matched' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-neutral-200 text-neutral-500 bg-neutral-50'}`}>
                           {node.lesson_match_status}
                         </span>
                      </td>
                      <td className="p-2 align-top font-mono text-center">
                         {node.quality_score !== null && node.quality_score !== undefined ? (
                           <span className={node.quality_score >= 80 ? 'text-emerald-600 font-bold' : node.quality_score >= 50 ? 'text-amber-600 font-bold' : 'text-red-600 font-bold'}>
                             {node.quality_score}
                           </span>
                         ) : "—"}
                      </td>
                      <td className="p-2 align-top text-right space-x-1 space-y-1">
                        <Button variant="outline" size="sm" className="h-6 text-[8px] px-2 rounded-none uppercase font-mono">Verify</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[8px] px-2 rounded-none uppercase font-mono">Download</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[8px] px-2 rounded-none uppercase font-mono">Extract</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[8px] px-2 rounded-none uppercase font-mono">OCR</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[8px] px-2 rounded-none uppercase font-mono">Clean</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[8px] px-2 rounded-none uppercase font-mono text-emerald-700 border-emerald-200 hover:bg-emerald-50">Match Lesson</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[8px] px-2 rounded-none uppercase font-mono text-indigo-700 border-indigo-200 hover:bg-indigo-50" disabled={!canExportToSupabase}>Gen RAG Chunks</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[8px] px-2 rounded-none uppercase font-mono text-neutral-600 hover:text-neutral-900 border-neutral-300">Preview</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
