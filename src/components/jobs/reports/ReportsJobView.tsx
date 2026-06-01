import React, { useState, useEffect } from "react";
import { 
  Activity, RefreshCw, AlertTriangle, CheckCircle, FileText, 
  XOctagon, Download, ChevronRight, Terminal, Info, 
  HelpCircle, Eye, Settings, FileSpreadsheet, Ban
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StagedPdf } from "../../../types/pdf";
import { JobWorkspaceLayout } from "../../layout/JobWorkspaceLayout";
import axios from "axios";

interface ReportsJobViewProps {
  stagedPdfs: StagedPdf[];
  pipelineStats: {
    originalDownloads: number;
    cleanCopies: number;
    datasetRows: number;
  };
  fetchPipelineStats: () => Promise<any>;
}

export function ReportsJobView({
  stagedPdfs,
  pipelineStats,
  fetchPipelineStats
}: ReportsJobViewProps) {
  const [activeGroupTab, setActiveGroupTab] = useState<string>("needs_review");
  const [selectedItemHash, setSelectedItemHash] = useState<string | null>(null);
  const [reportFilesMeta, setReportFilesMeta] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(false);

  const fetchExtendedReports = async () => {
    setIsLoading(true);
    try {
      const data = await fetchPipelineStats();
      if (data && data.reports) {
        setReportFilesMeta(data.reports);
      }
    } catch (err) {
      console.warn("Could not load extended report rows", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchExtendedReports();
  }, []);

  const handleDownloadFileDirect = (filename: string, content: any) => {
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Groups definitions matching Task 12 precisely
  const indexed = stagedPdfs.filter((p: any) => p.status === "indexed" || p.levelspace?.index_status === "indexed" || p.status === "complete");
  const needsReview = stagedPdfs.filter((p: any) => p.status === "needs_review" || p.levelspace?.index_status === "needs_review");
  const blocked = stagedPdfs.filter((p: any) => p.status === "blocked" || p.status === "needs_review" || p.reason?.toLowerCase().includes("blocked") || p.levelspace?.index_reason?.toLowerCase().includes("blocked"));
  const rejected = stagedPdfs.filter((p: any) => p.status === "rejected");
  const failedTechnical = stagedPdfs.filter((p: any) => p.status === "failed" || p.extractionStatus === "failed" || p.extractionStatus === "extract_failed");
  
  // OCR needed can contain empty text layers or specific status trigger
  const ocrNeeded = stagedPdfs.filter((p: any) => p.ocrStatus === "ocr_needed" || p.ocrStatus === "needed" || p.status === "ocr_needed" || p.reason?.toLowerCase().includes("ocr_needed") || (p.rawText === "" && p.extractionStatus === "success") || p.extractionStatus === "needs_ocr");
  
  // missing lesson aliases: matches lessons where text couldn't determine the specific alias in dictionary or containing دروس but not matched
  const missingLessonAliases = stagedPdfs.filter((p: any) => p.reason === "lesson_alias_missing" || (p.originalName?.toLowerCase().includes("دروس") && !p.levelspace?.lesson_id));

  // Determine current active list items
  let activeList: StagedPdf[] = [];
  switch (activeGroupTab) {
    case "indexed": activeList = indexed; break;
    case "needs_review": activeList = needsReview; break;
    case "blocked": activeList = blocked; break;
    case "rejected": activeList = rejected; break;
    case "failed_technical": activeList = failedTechnical; break;
    case "ocr_needed": activeList = ocrNeeded; break;
    case "missing_lesson_aliases": activeList = missingLessonAliases; break;
    default: activeList = needsReview;
  }

  // Auto-inspect first elements of each group
  useEffect(() => {
    if (activeList.length > 0) {
      setSelectedItemHash(activeList[0].url);
    } else {
      setSelectedItemHash(null);
    }
  }, [activeGroupTab, activeList.length]);

  const selectedPdfItem = stagedPdfs.find(p => p.url === selectedItemHash);

  // Suggested Actions matching the mapped engine rules
  const getActionPlan = (pdfItem: StagedPdf) => {
    const p = pdfItem as any;
    let title = "Immediate Next Resolution Steps";
    let desc = "No immediate actions required. This document is staging cleanly.";
    let urgent = false;

    const filename = p.originalName || "document";
    const status = p.status;
    const reason = p.reason || p.levelspace?.index_reason || "";

    if (status === "indexed" || p.levelspace?.index_status === "indexed" || status === "complete") {
      title = "Successful Alignment Verified";
      desc = "The document is beautifully synchronized with the Levelspace schema taxonomy nodes. No further action needed.";
    } else if (reason === "no_matching_lesson" || status === "needs_review") {
      title = "Map to Lesson Plan Required";
      desc = "Select 'Map to Lesson' directly from the main tab to pick a custom target curriculum thread or create a missing lesson mapping to resolve this indexing segment.";
      urgent = true;
    } else if (reason === "multiple_candidate_lessons") {
      title = "Curriculum Disambiguation Needed";
      desc = "The automation engine found multiple close candidate courses. Open mapping modal and click 'Approve Candidate' or select the correct variant.";
      urgent = true;
    } else if (p.ocrStatus === "ocr_needed" || p.ocrStatus === "needed" || reason?.toLowerCase().includes("ocr_needed") || p.status === "ocr_needed") {
      title = "Trigger OCR Text Processing";
      desc = "No readable text layers are present inside this PDF vector. Select this item in the workspace and click 'Process OCR Safe Mode' to activate scanned page analysis.";
      urgent = true;
    } else if (reason === "lesson_alias_missing" || filename.toLowerCase().includes("دروس")) {
      title = "Add Search Code Alias to Dictionary";
      desc = "Arabic word patterns require a custom search alias. Navigate to Settings and append the specific title code format as an alias to the dictionary layout.";
      urgent = true;
    } else if (status === "failed" || p.extractionStatus === "failed" || p.extractionStatus === "extract_failed") {
      title = "Execute Source Verification & Retry";
      desc = "This file encountered a retrieval fault. Verify that the server URL index isn't blocked by robots or firewalls, and trigger a pipeline retry sequence.";
      urgent = true;
    } else if (status === "rejected") {
      title = "Restore Rejected Document";
      desc = "This document was rejected due to curriculum policy constraints or metadata limits. You may review its file code or click 'Restore Target' to revert rejection.";
    }

    return { title, desc, urgent };
  };

  const actionPlan = selectedPdfItem ? getActionPlan(selectedPdfItem) : null;

  const sidebarContent = (
    <div className="p-4 flex flex-col h-full bg-white border-r border-neutral-200">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Terminal className="w-5 h-5 text-[#141414]" />
          <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Diagnostics</h2>
        </div>
        <p className="text-[10px] text-neutral-500 leading-snug">
          Real-time alignment audit log reporting and workflow error resolution hub.
        </p>
      </div>

      <div className="space-y-4">
        <h4 className="text-[10px] uppercase font-mono tracking-wider text-neutral-400 font-bold">Diagnostics Core Groups</h4>
        <nav className="flex flex-col space-y-1">
          {[
            { id: "needs_review", label: "Needs Review", count: needsReview.length, color: "bg-amber-100 text-amber-800" },
            { id: "blocked", label: "Blocked Items", count: blocked.length, color: "bg-red-100 text-red-800 font-extrabold" },
            { id: "indexed", label: "Indexed Mapped", count: indexed.length, color: "bg-emerald-100 text-emerald-800" },
            { id: "rejected", label: "Rejected Status", count: rejected.length, color: "bg-neutral-100 text-neutral-800" },
            { id: "failed_technical", label: "Failed Technical", count: failedTechnical.length, color: "bg-rose-100 text-rose-800" },
            { id: "ocr_needed", label: "OCR Needed", count: ocrNeeded.length, color: "bg-indigo-100 text-indigo-800" },
            { id: "missing_lesson_aliases", label: "Missing Aliases", count: missingLessonAliases.length, color: "bg-sky-100 text-sky-800" }
          ].map(grp => (
            <button
              id={`group-tab-btn-${grp.id}`}
              key={grp.id}
              onClick={() => setActiveGroupTab(grp.id)}
              className={`flex items-center justify-between px-3 py-2 text-xs font-mono transition-all rounded-none border text-left ${
                activeGroupTab === grp.id
                  ? "bg-[#141414] text-white border-[#141414] font-medium"
                  : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border-transparent"
              }`}
            >
              <span>{grp.label}</span>
              <span className={`px-1.5 py-0.5 text-[9px] font-sans rounded font-bold ${grp.color}`}>
                {grp.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto pt-6 border-t border-neutral-200">
        <Button 
          id="reports-refresh-all-btn"
          disabled={isLoading}
          onClick={fetchExtendedReports} 
          variant="outline" 
          className="w-full rounded-none border-[#141414] text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)] bg-white text-black hover:bg-neutral-50"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} /> 
          {isLoading ? "Syncing..." : "Sync & Refresh Files"}
        </Button>
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex flex-col h-full bg-neutral-50">
      {/* Top statistics summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-6 bg-white border-b border-neutral-200">
        <div className="border border-neutral-300 p-4 flex flex-col text-center bg-white shadow-sm">
          <span className="text-[9px] text-neutral-500 uppercase font-bold tracking-wider mb-1 font-mono">Stage Records</span>
          <span className="font-extrabold text-2xl text-neutral-900">{stagedPdfs.length}</span>
        </div>
        <div className="border border-emerald-300 p-4 flex flex-col text-center bg-emerald-50/50 shadow-sm">
          <span className="text-[9px] text-emerald-600 uppercase font-bold tracking-wider mb-1 font-mono">Clean Marked Copies</span>
          <span className="font-extrabold text-2xl text-emerald-800">{pipelineStats?.cleanCopies || 0}</span>
        </div>
        <div className="border border-violet-300 p-4 flex flex-col text-center bg-violet-50/50 shadow-sm">
          <span className="text-[9px] text-violet-600 uppercase font-bold tracking-wider mb-1 font-mono">JSONL Datasets</span>
          <span className="font-extrabold text-2xl text-violet-800">{pipelineStats?.datasetRows || 0}</span>
        </div>
        <div className="border border-red-300 p-4 flex flex-col text-center bg-red-50 shadow-sm">
          <span className="text-[9px] text-red-600 uppercase font-bold tracking-wider mb-1 font-mono">Audit Issues Flagged</span>
          <span className="font-extrabold text-2xl text-red-900">
            {needsReview.length + blocked.length + failedTechnical.length + ocrNeeded.length}
          </span>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Interactive Items Table List */}
        <div className="w-full lg:w-1/2 p-6 overflow-y-auto border-r border-neutral-200 min-h-[300px]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs font-bold text-neutral-800 uppercase flex items-center gap-2">
              <Activity className="w-4 h-4 text-neutral-700 animate-pulse" />
              Active Target Group: {activeGroupTab.replace("_", " ")} ({activeList.length})
            </h3>
          </div>

          {activeList.length === 0 ? (
            <div className="border border-dashed border-neutral-300 bg-white p-12 text-center flex flex-col items-center justify-center">
              <CheckCircle className="w-10 h-10 text-emerald-500 mb-2" />
              <p className="font-mono text-xs font-bold text-neutral-800 uppercase">Clear Slate Status</p>
              <p className="text-[11px] text-neutral-500 mt-1 max-w-xs leading-relaxed">
                Excellent! There are no records flagged under the {activeGroupTab.replace("_", " ")} diagnostic group.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-neutral-300 divide-y divide-neutral-200">
              {activeList.map((item, idx) => {
                const isCurrent = item.url === selectedItemHash;
                return (
                  <div
                    id={`reports-pdf-row-${item.url.split("/").pop()}`}
                    key={item.hash || item.url || `reports-row-${idx}`}
                    onClick={() => setSelectedItemHash(item.url)}
                    className={`p-3.5 transition-all cursor-pointer text-left ${
                      isCurrent 
                        ? "bg-neutral-100 border-l-4 border-neutral-900 pl-2.5" 
                        : "hover:bg-neutral-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="font-sans font-semibold text-[11px] text-neutral-900 truncate max-w-[280px]">
                        {item.originalName || "Unnamed Extracted PDF"}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-400 mt-0.5 shrink-0" />
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[9px] font-mono bg-neutral-100 text-neutral-700 px-1 py-0.5 uppercase border border-neutral-200">
                        Classify: {item.gradeId ? `${item.gradeId.toUpperCase()} / ${item.subjectId?.toUpperCase()}` : "Pending"}
                      </span>
                      {((item as any).ocrStatus === "ocr_needed" || (item as any).ocrStatus === "needed") && (
                        <span className="text-[9px] font-mono bg-indigo-50 text-indigo-700 px-1 py-0.5 border border-indigo-200 font-bold">
                          OCR
                        </span>
                      )}
                      {(item as any).status === "failed" && (
                        <span className="text-[9px] font-mono bg-rose-50 text-rose-700 px-1 py-0.5 border border-rose-200">
                          RETRIEVAL FAULT
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detailed Side Inspector Panels */}
        <div className="w-full lg:w-1/2 p-6 overflow-y-auto bg-white flex flex-col">
          {selectedPdfItem ? (
            <div className="space-y-6 text-left">
              <div className="border border-neutral-200 p-4 bg-neutral-50">
                <span className="text-[9px] text-neutral-400 uppercase font-mono tracking-wider block">Inspecting Asset ID</span>
                <span className="font-mono text-xs text-neutral-700 font-bold block select-all break-all">{selectedPdfItem.hash || "manual_" + selectedPdfItem.url.substring(selectedPdfItem.url.length - 8)}</span>
                <span className="text-[11px] text-neutral-600 block mt-1 select-all break-all">{selectedPdfItem.url}</span>
              </div>

              {/* Action resolution Plan: Prominent styled callout matching TASK 12 */}
              {actionPlan && (
                <div className={`p-4 border ${actionPlan.urgent ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50/50"}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    {actionPlan.urgent ? (
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                    ) : (
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                    )}
                    <h4 className="font-mono text-xs font-black uppercase tracking-wider text-neutral-900">
                      {actionPlan.title}
                    </h4>
                  </div>
                  <p className="text-[11px] text-neutral-800 leading-relaxed font-sans font-medium">
                    {actionPlan.desc}
                  </p>
                </div>
              )}

              {/* Diagnostics metadata breakdown */}
              <div className="space-y-4">
                <h4 className="font-mono text-[11px] uppercase tracking-wider font-extrabold text-neutral-500 border-b pb-1">Telemetry Diagnostics Summary</h4>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-neutral-200 p-3 bg-white">
                    <span className="text-[9px] text-neutral-400 uppercase font-mono block">Intake Pipeline Status</span>
                    <span className="font-sans font-bold text-xs text-neutral-900 uppercase">
                      {selectedPdfItem.status || "pending"}
                    </span>
                  </div>
                  <div className="border border-neutral-200 p-3 bg-white">
                    <span className="text-[9px] text-neutral-400 uppercase font-mono block">Active Step Pointer</span>
                    <span className="font-sans font-bold text-xs text-neutral-900 uppercase">
                      {(selectedPdfItem as any).status === "indexed" || (selectedPdfItem as any).status === "complete" ? "Indexing Complete" : "Taxonomy Selection"}
                    </span>
                  </div>
                </div>

                <div className="border border-neutral-200 p-3 bg-white">
                  <span className="text-[9px] text-neutral-400 uppercase font-mono block">Metadata Hints Mapped</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <span className="text-[10px] font-mono bg-neutral-100 px-2 py-0.5 text-neutral-700 border border-neutral-200">
                      Grade Hint: {selectedPdfItem.gradeId || "None"}
                    </span>
                    <span className="text-[10px] font-mono bg-neutral-100 px-2 py-0.5 text-neutral-700 border border-neutral-200">
                      Subject Hint: {selectedPdfItem.subjectId || "None"}
                    </span>
                    <span className="text-[10px] font-mono bg-neutral-100 px-2 py-0.5 text-neutral-700 border border-neutral-200">
                      Type Hint: {selectedPdfItem.documentTypeId || "None"}
                    </span>
                  </div>
                </div>

                <div className="border border-neutral-200 p-3 bg-white">
                  <span className="text-[9px] text-neutral-400 uppercase font-mono block">Classification Mapped Metrics</span>
                  <p className="text-[11px] text-neutral-700 mt-1 font-medium">
                    {selectedPdfItem.cleanTitle ? `Stamped Pattern Name: [${selectedPdfItem.cleanTitle}]` : "Dynamic string classification matching has not been certified."}
                  </p>
                </div>

                <div className="border border-neutral-200 p-3 bg-white">
                  <span className="text-[9px] text-neutral-400 uppercase font-mono block">Levelspace Index Mapping Outcome</span>
                  {selectedPdfItem.levelspace ? (
                    <div className="space-y-1.5 mt-1.5 text-xs">
                      <div><strong className="font-mono text-[10px] text-neutral-500 uppercase">Levelspace Path:</strong> <span className="font-medium text-neutral-800">{selectedPdfItem.levelspace.curriculum_path || "Unmapped"}</span></div>
                      <div><strong className="font-mono text-[10px] text-neutral-500 uppercase">Lesson ID:</strong> <span className="font-mono bg-neutral-100 px-1 border select-all">{selectedPdfItem.levelspace.lesson_id || "None"}</span></div>
                      <div><strong className="font-mono text-[10px] text-neutral-500 uppercase">Alignment Code Confidence:</strong> <span className="font-bold text-neutral-800">{selectedPdfItem.levelspace.curriculum_confidence ?? "Not Evaluated"}%</span></div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-neutral-500 italic mt-1">Levelspace indexing was blocked before lesson mapping parameters could be assigned.</p>
                  )}
                </div>

                {selectedPdfItem.reason && (
                  <div className="border border-red-200 p-3 bg-red-50/50">
                    <span className="text-[9px] text-red-600 uppercase font-mono font-bold block">Technical & Audit Log Error</span>
                    <p className="text-xs text-red-800 font-mono mt-1 font-semibold leading-relaxed whitespace-pre-wrap break-all">
                      {selectedPdfItem.reason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-neutral-400">
              <Eye className="w-8 h-8 mb-2 text-neutral-300" />
              <p className="text-[11px] font-mono uppercase font-bold tracking-wider">Select and inspect elements</p>
              <p className="text-[11px] mt-1 max-w-xs leading-relaxed">
                Select any staged document from the target listings to review metadata hints, classification, and targeted plan resolution actions.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Systems Report Files Export Section in Bottom Grid */}
      <div className="border-t border-neutral-200 p-6 bg-white shrink-0">
        <h4 className="font-mono text-xs font-extrabold text-neutral-800 uppercase flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-neutral-600" />
          Task 12 Systems Diagnostics Outputs Certification Files
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {[
            { filename: "intake-report.json", key: "intake", desc: "Workstation Imports" },
            { filename: "extraction-report.json", key: "extraction", desc: "OCR/Text Outputs" },
            { filename: "classification-report.json", key: "classification", desc: "Categorized Targets" },
            { filename: "indexing-report.json", key: "indexing", desc: "Curriculum Links" },
            { filename: "blocked-items.json", key: "blocked", desc: "Active Blocked" },
            { filename: "output-report.json", key: "output", desc: "Successfully Mapped" },
            { filename: "batch-summary.json", key: "summary", desc: "Overall Metrics" }
          ].map(file => {
            const rowCount = reportFilesMeta[file.key] 
              ? (Array.isArray(reportFilesMeta[file.key]) ? reportFilesMeta[file.key].length : (reportFilesMeta[file.key].rows ? reportFilesMeta[file.key].rows.length : 0)) 
              : 0;

            return (
              <div 
                id={`report-card-${file.key}`}
                key={file.key} 
                className="border border-neutral-200 p-3 bg-neutral-50/50 hover:bg-neutral-50 flex flex-col justify-between transition-all"
              >
                <div>
                  <span className="block font-mono font-bold text-[10px] text-neutral-900 truncate">
                    {file.filename}
                  </span>
                  <span className="block text-[9px] text-neutral-400 mt-0.5 leading-tight">
                    {file.desc}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-neutral-100 shrink-0">
                  <span className="font-mono text-[9px] font-bold text-neutral-600 bg-white border border-neutral-200 px-1 rounded">
                    {rowCount} record(s)
                  </span>
                  <button
                    id={`btn-download-file-${file.key}`}
                    onClick={() => handleDownloadFileDirect(file.filename, reportFilesMeta[file.key] || [])}
                    className="text-neutral-500 hover:text-[#141414] transition-all p-1"
                    title="Download JSON Report"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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

export default ReportsJobView;
