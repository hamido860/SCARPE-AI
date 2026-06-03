import React, { useState, useEffect } from "react";
import {
  Merge,
  FolderArchive,
  FileJson,
  Loader2,
  Play,
  Cloud,
  CloudRain,
  CheckCircle,
  RefreshCw,
  Key,
  LogOut,
  Wand2,
  CloudSnow,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StagedPdf } from "../../../types/pdf";
import { JobWorkspaceLayout } from "../../layout/JobWorkspaceLayout";
import { CustomExportModal } from "./CustomExportModal";
import { User } from "firebase/auth";
import axios from "axios";
import { toast } from "sonner";

interface OutputJobViewProps {
  selectedPdfUrls: string[];
  stagedPdfs: StagedPdf[];
  pipelineStats: {
    originalDownloads: number;
    cleanCopies: number;
    datasetRows: number;
  };
  isCombining: boolean;
  isDownloadingZip: boolean;
  customMergeName: string;
  setCustomMergeName: (name: string) => void;

  handleBuildCleanCopiesForSelected: () => Promise<void>;
  handleZipDownloadSelected: () => Promise<void>;
  handleMergeSelected: (urls?: string[], filename?: string) => Promise<void>;
  handleExportDatasetJsonl: () => void;

  // Google Drive integration props
  gdriveUser: User | null;
  onGdriveSignIn: () => Promise<void>;
  onGdriveSignOut: () => Promise<void>;
  isSyncingAll: boolean;
  handleSyncAllToDrive: () => Promise<void>;
  gdriveAutoSync: boolean;
  setGdriveAutoSync: (val: boolean) => void;
  isSyncingSingle: Record<string, boolean>;
  handleSyncSingleToDrive: (
    category: string,
    filename: string,
    filepath: string,
  ) => Promise<void>;
  handleGeminiSyncToDrive?: (
    category: string,
    filename: string,
    filepath: string,
  ) => Promise<any>;
  updateManyPdfs: (updates: {url: string; updates: Partial<StagedPdf>}[]) => void;
}

export function OutputJobView({
  selectedPdfUrls,
  stagedPdfs,
  pipelineStats,
  isCombining,
  isDownloadingZip,
  customMergeName,
  setCustomMergeName,
  handleBuildCleanCopiesForSelected,
  handleZipDownloadSelected,
  handleMergeSelected,
  handleExportDatasetJsonl,

  // Google Drive integration
  gdriveUser,
  onGdriveSignIn,
  onGdriveSignOut,
  isSyncingAll,
  handleSyncAllToDrive,
  gdriveAutoSync,
  setGdriveAutoSync,
  isSyncingSingle,
  handleSyncSingleToDrive,
  handleGeminiSyncToDrive,
  updateManyPdfs,
}: OutputJobViewProps) {
  const [syncStatus, setSyncStatus] = useState<
    Record<string, "idle" | "syncing" | "success" | "error">
  >({});
  const [syncDetails, setSyncDetails] = useState<
    Record<string, { fileId?: string; folder?: string }>
  >({});
  const [geminiSyncStatus, setGeminiSyncStatus] = useState<
    Record<string, "idle" | "syncing" | "success" | "error">
  >({});
  
  const [selectedForDrive, setSelectedForDrive] = useState<Set<string>>(new Set());
  const [isAiRenaming, setIsAiRenaming] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleAiRenameDriveReady = async () => {
    // If user selected specific PDFs, only process those. Otherwise, process all ready PDFs.
    const pdfsToProcess = selectedForDrive.size > 0 
      ? readyPdfs.filter(p => selectedForDrive.has(p.hash || ""))
      : readyPdfs;

    if (pdfsToProcess.length === 0) return;

    setIsAiRenaming(true);
    const toastId = toast.loading("AI is renaming and validating PDFs...");
    try {
      const payload = pdfsToProcess.map(p => ({
        id: p.url, // URL as unique ID for API
        url: p.url,
        originalName: p.originalName,
        currentGrade: p.gradeId,
        currentSubject: p.subjectId,
        currentTopic: p.topicId,
        currentDocType: p.documentTypeId,
        source: new URL(p.url).hostname
      }));

      const res = await axios.post("/api/pipeline/ai-rename-pdfs", { pdfs: payload });
      if (res.data && Array.isArray(res.data)) {
        let validCount = 0;
        let rejectedCount = 0;
        const updates = res.data.map((result: any) => {
          if (!result.isValid) {
            rejectedCount++;
            return {
              url: result.id,
              updates: { status: "failed" as const, notes: "Validation failed by AI Rename" }
            };
          }
          
          validCount++;
          let cleanTitle = `${result.grade || "Unknown"} > ${result.subject || "Unknown"} > ${result.docType || "PDF"} > ${result.topic || "Document"}`;
          let renamePattern = `${result.grade || "Unknown"}_${result.subject || "Unknown"}_${result.docType || "PDF"}_${result.topic || "Document"}.pdf`.replace(/[^a-zA-Z0-9_\-.]/g, "_");

          return {
            url: result.id,
            updates: {
              gradeId: result.grade || "Unknown",
              subjectId: result.subject || "Unknown",
              topicId: result.topic || "Document",
              documentTypeId: result.docType || "PDF",
              cleanTitle,
              renamePattern
            }
          };
        });

        updateManyPdfs(updates);
        toast.success(`AI Rename complete: ${validCount} renamed, ${rejectedCount} rejected.`, { id: toastId });
      }
    } catch (err: any) {
      console.error("Failed to AI rename PDFs", err);
      toast.error("Failed to run AI rename.", { id: toastId });
    } finally {
      setIsAiRenaming(false);
    }
  };

  const handleToggleDriveSelect = (hash: string) => {
    const newSet = new Set(selectedForDrive);
    if (newSet.has(hash)) {
      newSet.delete(hash);
    } else {
      newSet.add(hash);
    }
    setSelectedForDrive(newSet);
  };

  const handleSelectAllReady = () => {
    if (selectedForDrive.size === readyPdfs.length && readyPdfs.length > 0) {
      setSelectedForDrive(new Set());
    } else {
      setSelectedForDrive(new Set(readyPdfs.map(p => p.hash || "")));
    }
  };

  const handleUploadSelected = async () => {
    const pdfsToUpload = readyPdfs.filter(p => selectedForDrive.has(p.hash || "") && !syncStatus[`pdf-${p.hash}`]);
    for (const pdf of pdfsToUpload) {
      const shortHash = pdf.hash?.substring(0, 8) || "nohash";
      const cleanFilename = pdf.renamePattern || `${pdf.gradeId || "unknown"}__${pdf.subjectId || "unknown"}__${pdf.topicId || "unknown"}__${shortHash}.pdf`;
      const localPath = `clean-pdfs/${cleanFilename}`;
      const idOfItem = `pdf-${pdf.hash}`;
      await triggerSingleSync(idOfItem, "clean-pdfs", cleanFilename, localPath);
    }
  };

  const handleUploadAllReady = async () => {
    const pdfsToUpload = readyPdfs.filter(p => syncStatus[`pdf-${p.hash}`] !== "success" && p.driveUploadStatus !== "uploaded");
    for (const pdf of pdfsToUpload) {
      const shortHash = pdf.hash?.substring(0, 8) || "nohash";
      const cleanFilename = pdf.renamePattern || `${pdf.gradeId || "unknown"}__${pdf.subjectId || "unknown"}__${pdf.topicId || "unknown"}__${shortHash}.pdf`;
      const localPath = `clean-pdfs/${cleanFilename}`;
      const idOfItem = `pdf-${pdf.hash}`;
      await triggerSingleSync(idOfItem, "clean-pdfs", cleanFilename, localPath);
    }
  };

  const handleRetryFailed = async () => {
    const pdfsToUpload = failedUploads;
    for (const pdf of pdfsToUpload) {
      const shortHash = pdf.hash?.substring(0, 8) || "nohash";
      const cleanFilename = pdf.renamePattern || `${pdf.gradeId || "unknown"}__${pdf.subjectId || "unknown"}__${pdf.topicId || "unknown"}__${shortHash}.pdf`;
      const localPath = `clean-pdfs/${cleanFilename}`;
      const idOfItem = `pdf-${pdf.hash}`;
      await triggerSingleSync(idOfItem, "clean-pdfs", cleanFilename, localPath);
    }
  };

  const readyPdfs = stagedPdfs.filter(
    (p) =>
      ["classified", "approved", "complete"].includes(p.status) &&
      p.status !== "failed"
  );
  
  const needsReviewPdfs = stagedPdfs.filter(
    (p) => ["needs_review", "pending", "pending_staged", "classifying", "staged"].includes(p.status)
  );
  
  const uploadedPdfs = stagedPdfs.filter(
    (p) => p.driveUploadStatus === "uploaded" || syncStatus[`pdf-${p.hash}`] === "success" || geminiSyncStatus[`pdf-${p.hash}`] === "success"
  );
  
  const failedUploads = stagedPdfs.filter(
    (p) => p.driveUploadStatus === "failed" || syncStatus[`pdf-${p.hash}`] === "error" || geminiSyncStatus[`pdf-${p.hash}`] === "error"
  );

  useEffect(() => {
    const fetchSyncStatus = async () => {
      try {
        const res = await axios.get("/api/gdrive/sync-status");
        if (res.data && Object.keys(res.data).length > 0) {
          const loadedStatus: Record<string, "success"> = {};
          const loadedGeminiStatus: Record<string, "success"> = {};
          const loadedDetails: Record<string, { fileId?: string; folder?: string }> = {};
          
          Object.keys(res.data).forEach(filename => {
            // we assume filename maps back to id properly for generic things
            // for pdfs it could be tricky to reverse map, but let's try
            
            // For standard JSON datasets and reports
            if (filename === "index.jsonl") loadedStatus["dataset-index"] = "success";
            if (filename === "extraction-report.json") loadedStatus["report-extract"] = "success";
          });
          
          Object.entries(res.data).forEach(([filename, val]: [string, any]) => {
            const isGemini = val.folder && val.folder.includes("Gemini Automated Curriculums");
            stagedPdfs.forEach(pdf => {
              const shortHash = pdf.hash?.substring(0, 8) || "nohash";
              const cleanFilename = pdf.renamePattern || `${pdf.gradeId || "unknown"}__${pdf.subjectId || "unknown"}__${pdf.topicId || "unknown"}__${shortHash}.pdf`;
              if (cleanFilename === filename) {
                if (isGemini) {
                  loadedGeminiStatus[`pdf-${pdf.hash}`] = "success";
                } else {
                  loadedStatus[`pdf-${pdf.hash}`] = "success";
                }
                loadedDetails[`pdf-${pdf.hash}`] = { fileId: val.fileId, folder: val.folder };
              }
            });
          });
          
          setSyncStatus(prev => ({...prev, ...loadedStatus}));
          setGeminiSyncStatus(prev => ({...prev, ...loadedGeminiStatus}));
          setSyncDetails(prev => ({...prev, ...loadedDetails}));
        }
      } catch (err) {
        console.warn("Failed to load drive sync status", err);
      }
    };
    if (gdriveUser) {
      fetchSyncStatus();
    }
  }, [gdriveUser, stagedPdfs]);

  const triggerSingleSync = async (
    idOfItem: string,
    category: string,
    filename: string,
    filepath: string,
  ) => {
    try {
      setSyncStatus((prev) => ({ ...prev, [idOfItem]: "syncing" }));
      await handleSyncSingleToDrive(category, filename, filepath);
      setSyncStatus((prev) => ({ ...prev, [idOfItem]: "success" }));
      
      try {
        const res = await axios.get("/api/gdrive/sync-status");
        if (res.data) {
           const val = res.data[filename];
           if (val) {
             setSyncDetails(prev => ({...prev, [idOfItem]: { fileId: val.fileId, folder: val.folder }}));
           }
        }
      } catch (err) {}
    } catch (err) {
      console.error(err);
      setSyncStatus((prev) => ({ ...prev, [idOfItem]: "error" }));
    }
  };

  const triggerGeminiSync = async (
    idOfItem: string,
    category: string,
    filename: string,
    filepath: string,
  ) => {
    if (!handleGeminiSyncToDrive) return;
    try {
      setGeminiSyncStatus((prev) => ({ ...prev, [idOfItem]: "syncing" }));
      await handleGeminiSyncToDrive(category, filename, filepath);
      setGeminiSyncStatus((prev) => ({ ...prev, [idOfItem]: "success" }));
    } catch (err) {
      console.error(err);
      setGeminiSyncStatus((prev) => ({ ...prev, [idOfItem]: "error" }));
    }
  };

  const sidebarContent = (
    <div className="p-4 flex flex-col h-full space-y-6">
      <div>
        <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">
          Outputs Job
        </h2>
        <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
          Generate clean printed PDFs and dataset mappings from completed files.
        </p>
      </div>

      {/* Google Drive Integration Widget */}
      <div className="border border-neutral-300 p-3 bg-neutral-50 space-y-3 font-mono">
        <h3 className="text-[10.5px] font-bold text-neutral-800 uppercase flex items-center gap-1.5 pb-2 border-b border-neutral-200">
          <Cloud className="w-3.5 h-3.5 text-blue-600 fill-blue-155/10" />
          Google Drive Gateway
        </h3>

        {!gdriveUser ? (
          <div className="space-y-2">
            <p className="text-[9px] text-neutral-500 font-sans leading-relaxed">
              Connect Google Drive to save reviewed Levelspace PDFs.
            </p>
            <Button
              id="gdrive-sign-in-btn"
              onClick={onGdriveSignIn}
              className="w-full bg-white hover:bg-neutral-50 text-neutral-800 border-2 border-neutral-900 rounded-none text-[10px] font-mono uppercase h-9 flex items-center justify-center gap-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
            >
              <svg
                className="w-3.5 h-3.5 shrink-0"
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                ></path>
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                ></path>
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                ></path>
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                ></path>
                <path fill="none" d="M0 0h48v48H0z"></path>
              </svg>
              <span>Connect Drive</span>
            </Button>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
              <span className="text-[9px] font-bold text-emerald-800 uppercase">
                Status: Connected
              </span>
            </div>

            <div className="flex items-center gap-2 border bg-white p-2 border-neutral-200">
              {gdriveUser.photoURL ? (
                <img
                  src={gdriveUser.photoURL}
                  alt="Profile"
                  className="w-7 h-7 rounded-none border border-neutral-300"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-7 h-7 bg-neutral-100 flex items-center justify-center font-bold text-xs border border-neutral-300 uppercase">
                  {gdriveUser.displayName?.[0] || gdriveUser.email?.[0] || "U"}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[9.5px] font-bold text-neutral-850 truncate">
                  {gdriveUser.displayName || "Drive Session"}
                </div>
                <div className="text-[8px] text-neutral-500 truncate font-mono">
                  {gdriveUser.email}
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-[9.5px] font-mono cursor-pointer select-none leading-none pt-1">
              <input
                type="checkbox"
                checked={gdriveAutoSync}
                onChange={(e) => setGdriveAutoSync(e.target.checked)}
                className="w-3.5 h-3.5 rounded-none border-neutral-300 text-neutral-900 focus:ring-0"
              />
              <span className="uppercase text-neutral-700 font-bold">
                Auto-upload after approval
              </span>
            </label>

            <p className="text-[9.5px] text-neutral-500 font-sans leading-relaxed pt-2">
              Only reviewed PDFs marked Ready for Drive will be uploaded. You are about to upload {readyPdfs.length - uploadedPdfs.length} reviewed PDFs to Google Drive.
            </p>

            <div className="space-y-2 pt-2 border-t border-neutral-200">
              <Button
                id="outputs-sync-all-gdrive"
                onClick={handleSyncAllToDrive}
                disabled={isSyncingAll}
                className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-neutral-300 text-white rounded-none text-[9.5px] font-mono uppercase h-8 flex items-center justify-center gap-1.5"
              >
                {isSyncingAll ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Uploading to Drive...</span>
                  </>
                ) : (
                  <span>Upload reviewed PDFs to Drive</span>
                )}
              </Button>

              <button
                id="gdrive-disconnect"
                onClick={onGdriveSignOut}
                className="w-full h-6 text-center text-red-600 hover:text-red-700 hover:bg-red-50 text-[9px] uppercase tracking-wider font-mono border border-transparent hover:border-red-200 transition-all font-bold"
              >
                [Disconnect Drive Session]
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="border border-emerald-200 bg-emerald-50/30 p-3">
          <h3 className="text-[10px] font-bold text-emerald-800 uppercase mb-1">
            Clean Build Scope
          </h3>
          <p className="text-[9px] text-emerald-600 mb-3 font-sans">
            Applies stamps, normalizes names, and compiles standard PDFs to
            server build cache.
          </p>
          <Button
            id="outputs-build-selected"
            onClick={handleBuildCleanCopiesForSelected}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-none text-[10px] font-mono uppercase h-8"
          >
            Build Selected (
            {selectedPdfUrls.length ||
              stagedPdfs.filter((p) => p.status === "classified").length}
            )
          </Button>
        </div>

        <div className="border border-purple-200 bg-purple-50/30 p-3">
          <h3 className="text-[10px] font-bold text-purple-800 uppercase mb-1">
            Export ZIP
          </h3>
          <p className="text-[9px] text-purple-600 mb-3 font-sans">
            Zips the built output PDFs along with corresponding dataset JSONL.
          </p>
          <Button
            id="outputs-zip-download"
            variant="outline"
            onClick={handleZipDownloadSelected}
            className="w-full bg-transparent hover:bg-purple-50 text-purple-700 border border-purple-500 rounded-none text-[10px] font-mono uppercase h-8"
          >
            Download Archive
          </Button>
        </div>

        <div className="border border-neutral-200 p-3 bg-neutral-50">
          <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block mb-1">
            Custom Combined Name
          </label>
          <Input
            id="outputs-combined-name"
            value={customMergeName}
            onChange={(e) => setCustomMergeName(e.target.value)}
            className="rounded-none border-neutral-300 text-[10px] h-8 mb-2 bg-white font-mono"
          />
          <Button
            id="outputs-merge-btn"
            onClick={() => handleMergeSelected()}
            className="w-full bg-neutral-800 hover:bg-neutral-900 text-white rounded-none text-[10px] font-mono uppercase h-8"
          >
            Combine Selected PDFs
          </Button>
        </div>

        <div className="space-y-1.5 pt-1">
          <Button
            id="outputs-export-jsonl"
            variant="outline"
            onClick={handleExportDatasetJsonl}
            className="w-full rounded-none border-neutral-900 text-neutral-800 hover:bg-neutral-50 text-[10px] font-mono h-8 uppercase flex items-center justify-center"
          >
            <FileJson className="w-3.5 h-3.5 mr-1.5 text-neutral-600" /> Standard JSONL Export
          </Button>
          
          <Button
            id="outputs-custom-export-btn"
            onClick={() => setIsExportModalOpen(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-none border-2 border-neutral-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] text-[10px] h-9 font-mono font-black uppercase flex items-center justify-center gap-1.5 transition-all active:translate-x-0.5 active:translate-y-0.5"
          >
            <Settings2 className="w-3.5 h-3.5 text-white animate-pulse" /> Custom Schema Export...
          </Button>
        </div>
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex flex-col h-full bg-neutral-50 overflow-y-auto">
      {/* Simple summary center zone */}
      <div className="bg-white p-6 border-b border-neutral-200 text-left">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-50 border border-purple-200">
            <Merge className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h3 className="text-sm font-mono font-bold uppercase text-neutral-900">
              Outputs & Data Assets
            </h3>
            <p className="text-[11px] text-neutral-500 leading-normal font-sans max-w-2xl">
              Watermark, seal, and exports correctly classified educational
              documents alongside the structured matching JSONL metadata
              dataset. Connect your Google Drive session to enable real-time
              directory synchronization.
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="p-6 grid grid-cols-3 md:grid-cols-6 gap-3">
        <div className="border border-neutral-300 bg-white p-3 flex flex-col justify-between shadow-xs">
          <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">Found PDFs</div>
          <div className="text-sm font-black font-mono text-neutral-700 mt-1">{pipelineStats?.originalDownloads || 0}</div>
        </div>
        <div className="border border-neutral-300 bg-white p-3 flex flex-col justify-between shadow-xs">
          <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">Staged PDFs</div>
          <div className="text-sm font-black font-mono text-blue-700 mt-1">{stagedPdfs.length}</div>
        </div>
        <div className="border border-neutral-300 bg-white p-3 flex flex-col justify-between shadow-xs">
          <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">Needs Review</div>
          <div className="text-sm font-black font-mono text-amber-600 mt-1">{needsReviewPdfs.length}</div>
        </div>
        <div className="border border-neutral-300 bg-white p-3 flex flex-col justify-between shadow-xs border-l-2 border-l-emerald-500">
          <div className="text-[8px] uppercase font-mono font-bold text-emerald-600">Ready for Drive</div>
          <div className="text-sm font-black font-mono text-emerald-700 mt-1">{readyPdfs.length}</div>
        </div>
        <div className="border border-neutral-300 bg-white p-3 flex flex-col justify-between shadow-xs">
          <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">Uploaded</div>
          <div className="text-sm font-black font-mono text-indigo-600 mt-1">{uploadedPdfs.length}</div>
        </div>
        <div className="border border-neutral-300 bg-white p-3 flex flex-col justify-between shadow-xs">
          <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">Failed</div>
          <div className="text-sm font-black font-mono text-red-600 mt-1">{failedUploads.length}</div>
        </div>
      </div>

      {/* Interactive Files Catalog */}
      <div className="px-6 pb-6 space-y-4">
        <div className="border border-neutral-300 bg-white text-left shadow-xs">
          <div className="bg-neutral-900 text-white p-3 font-mono text-[10.5px] uppercase font-bold flex items-center justify-between">
            <span>Ready for Drive Queue</span>
            <span className="text-[9px] text-neutral-300 font-normal">
              Showing approved PDFs ready for Drive sync
            </span>
          </div>
          
          <div className="bg-neutral-50 border-b border-neutral-200 p-2 flex items-center gap-2">
             <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] font-mono border-neutral-300 bg-white"
                onClick={handleUploadSelected}
                disabled={selectedForDrive.size === 0}
             >
                <CloudSnow className="w-3 h-3 mr-1" />
                Upload Selected ({selectedForDrive.size})
             </Button>
             <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] font-mono border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                onClick={handleUploadAllReady}
             >
                <Cloud className="w-3 h-3 mr-1" />
                Upload All Ready ({readyPdfs.length - uploadedPdfs.length})
             </Button>
             <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] font-mono bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200 ml-auto flex items-center gap-1"
                onClick={handleAiRenameDriveReady}
                disabled={isAiRenaming || readyPdfs.length === 0}
             >
                {isAiRenaming ? <Loader2 className="w-3 h-3 animate-spin mx-auto lg:mx-0" /> : <Wand2 className="w-3 h-3" />}
                <span className="hidden lg:inline">{isAiRenaming ? "Renaming..." : "AI Normalize & Validate"}</span>
             </Button>
             {failedUploads.length > 0 && (
               <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] font-mono border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                  onClick={handleRetryFailed}
               >
                  Retry Failed ({failedUploads.length})
               </Button>
             )}
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto w-full">
            <table className="w-full text-left font-sans text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-neutral-100 border-b border-neutral-300 font-mono text-[9.5px] text-neutral-600 uppercase">
                <tr>
                  <th className="p-3 w-8">
                    <input type="checkbox" className="w-3.5 h-3.5" checked={readyPdfs.length > 0 && selectedForDrive.size === readyPdfs.length} onChange={handleSelectAllReady}/>
                  </th>
                  <th className="p-3">Review Title</th>
                  <th className="p-3">File Name</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Drive Upload Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {readyPdfs.map((pdf, idx) => {
                    const shortHash = pdf.hash?.substring(0, 8) || "nohash";
                    const cleanFilename =
                      pdf.renamePattern ||
                      `${pdf.gradeId || "unknown"}__${pdf.subjectId || "unknown"}__${pdf.topicId || "unknown"}__${shortHash}.pdf`;
                    const localPath = `clean-pdfs/${cleanFilename}`;
                    const idOfItem = `pdf-${pdf.hash}`;
                    
                    const isSynced = syncStatus[idOfItem] === "success" || pdf.driveUploadStatus === "uploaded";
                    const isError = syncStatus[idOfItem] === "error" || pdf.driveUploadStatus === "failed";

                    return (
                      <tr
                        key={pdf.hash || `output-pdf-${idx}`}
                        className="hover:bg-neutral-50/50"
                      >
                        <td className="p-3 w-8">
                          <input type="checkbox" className="w-3.5 h-3.5" checked={selectedForDrive.has(pdf.hash || "")} onChange={() => handleToggleDriveSelect(pdf.hash || "")}/>
                        </td>
                        <td
                          className="p-3 max-w-xs truncate font-mono text-[10.5px] text-neutral-800"
                          title={pdf.cleanTitle || "No Title"}
                        >
                          {pdf.cleanTitle || "Ready Document"}
                        </td>
                         <td
                          className="p-3 max-w-xs truncate font-mono text-[10.5px] text-neutral-500"
                          title={cleanFilename}
                        >
                          {cleanFilename}
                        </td>
                        <td className="p-3">
                          <span className="inline-block px-1.5 py-0.5 text-[8.5px] font-mono uppercase bg-neutral-100 text-neutral-600 border border-neutral-200">
                            {pdf.url ? new URL(pdf.url).hostname.replace("www.", "") : "Unknown source"}
                          </span>
                        </td>
                        <td className="p-3">
                           {isSynced ? (
                              <span className="inline-block px-2 py-0.5 text-[9px] font-mono uppercase bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                                Synced
                              </span>
                           ) : isError ? (
                             <span className="inline-block px-2 py-0.5 text-[9px] font-mono uppercase bg-red-50 text-red-700 border border-red-200 font-bold">
                                Failed
                              </span>
                           ) : (
                              <span className="inline-block px-2 py-0.5 text-[9px] font-mono uppercase bg-emerald-50 text-emerald-700 border border-emerald-250 font-bold">
                                Ready
                              </span>
                           )}
                        </td>
                        <td className="p-3 text-right">
                           <div className="flex items-center justify-end gap-2">
                             <a
                               href={`/api/pipeline/download-clean/${pdf.hash}?inline=true`}
                               target="_blank"
                               rel="noopener noreferrer"
                               title="Open PDF in new tab"
                               className="inline-flex items-center justify-center h-7 rounded-none px-2 text-[9px] font-mono border border-neutral-300 text-neutral-600 hover:bg-neutral-50 bg-white"
                             >
                               👁️
                             </a>
                            {gdriveUser ? (
                              <div className="flex gap-2">
                                <Button
                                  onClick={() =>
                                    triggerSingleSync(
                                      idOfItem,
                                      "clean-pdfs",
                                      cleanFilename,
                                      localPath,
                                    )
                                  }
                                  disabled={syncStatus[idOfItem] === "syncing" || isSynced}
                                  variant="outline"
                                  className={`h-7 rounded-none px-2 text-[9px] font-mono border ${isSynced ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'} cursor-pointer`}
                                >
                                  {syncStatus[idOfItem] === "syncing" ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : isSynced ? (
                                    "✓ Uploaded"
                                  ) : (
                                    isError ? "Retry Upload" : "Upload to Drive"
                                  )}
                                </Button>
                                {isSynced && syncDetails[idOfItem]?.fileId && (
                                   <a 
                                     href={`https://drive.google.com/file/d/${syncDetails[idOfItem].fileId}/view`} 
                                     target="_blank" 
                                     rel="noopener noreferrer"
                                     className="inline-flex items-center justify-center h-7 px-2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[9px] font-mono hover:bg-indigo-100"
                                     title="Open in Google Drive"
                                   >
                                     <Cloud className="w-3 h-3 mr-1" /> Open
                                   </a>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-neutral-400 font-mono">
                                [Link Drive]
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                {readyPdfs.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-neutral-400 font-mono"
                    >
                      No reviewed PDFs marked Ready for Drive.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isCombining && (
        <div className="fixed inset-0 bg-neutral-900/80 z-50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
          <Loader2 className="w-12 h-12 animate-spin mb-4 text-emerald-400" />
          <h3 className="font-mono text-xl font-bold mb-2">
            Building Clean Copies
          </h3>
          <p className="text-sm opacity-70">
            Watermarking PDFs and saving metadata dataset...
          </p>
        </div>
      )}

      {isDownloadingZip && (
        <div className="fixed inset-0 bg-neutral-900/80 z-50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
          <Loader2 className="w-12 h-12 animate-spin mb-4 text-purple-400" />
          <h3 className="font-mono text-xl font-bold mb-2">
            Compressing Archive
          </h3>
          <p className="text-sm opacity-70">
            Gathering artifacts into a zip file for download...
          </p>
        </div>
      )}
    </div>
  );

  return (
    <>
      <JobWorkspaceLayout sidebar={sidebarContent} main={mainContent} />
      <CustomExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        stagedPdfs={stagedPdfs}
      />
    </>
  );
}
export default OutputJobView;
