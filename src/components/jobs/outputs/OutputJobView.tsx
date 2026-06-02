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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StagedPdf } from "../../../types/pdf";
import { JobWorkspaceLayout } from "../../layout/JobWorkspaceLayout";
import { User } from "firebase/auth";
import axios from "axios";

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
}: OutputJobViewProps) {
  const [syncStatus, setSyncStatus] = useState<
    Record<string, "idle" | "syncing" | "success" | "error">
  >({});
  const [geminiSyncStatus, setGeminiSyncStatus] = useState<
    Record<string, "idle" | "syncing" | "success" | "error">
  >({});

  useEffect(() => {
    const fetchSyncStatus = async () => {
      try {
        const res = await axios.get("/api/gdrive/sync-status");
        if (res.data && Object.keys(res.data).length > 0) {
          const loadedStatus: Record<string, "success"> = {};
          const loadedGeminiStatus: Record<string, "success"> = {};
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
              const shortHash = pdf.hash.substring(0, 8);
              const cleanFilename = pdf.renamePattern || `${pdf.gradeId || "unknown"}__${pdf.subjectId || "unknown"}__${pdf.topicId || "unknown"}__${shortHash}.pdf`;
              if (cleanFilename === filename) {
                if (isGemini) {
                  loadedGeminiStatus[`pdf-${pdf.hash}`] = "success";
                } else {
                  loadedStatus[`pdf-${pdf.hash}`] = "success";
                }
              }
            });
          });
          
          setSyncStatus(prev => ({...prev, ...loadedStatus}));
          setGeminiSyncStatus(prev => ({...prev, ...loadedGeminiStatus}));
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
              Connect to Google Drive to automatically persist or manually
              backup pipeline outputs and downloaded files.
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
                Auto-Sync Pipeline
              </span>
            </label>

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
                    <span>Syncing ALL Asset folders...</span>
                  </>
                ) : (
                  <span>Force Workspace Backup</span>
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

        <Button
          id="outputs-export-jsonl"
          variant="outline"
          onClick={handleExportDatasetJsonl}
          className="w-full rounded-none border-neutral-900 text-neutral-800 hover:bg-neutral-50 text-[10px] font-mono uppercase h-9"
        >
          <FileJson className="w-3.5 h-3.5 mr-1.5" /> Export Dataset (JSONL)
        </Button>
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
      <div className="p-6 grid grid-cols-3 gap-4">
        <div className="border border-neutral-300 bg-white p-4 flex flex-col justify-between shadow-xs">
          <div className="text-[9px] uppercase font-mono font-bold text-neutral-500">
            Processed Ready PDFs
          </div>
          <div
            id="outputs-stat-classified"
            className="text-xl font-black font-mono text-emerald-700 mt-2"
          >
            {stagedPdfs.filter((p) => p.status === "classified").length}
          </div>
        </div>
        <div className="border border-neutral-300 bg-white p-4 flex flex-col justify-between shadow-xs">
          <div className="text-[9px] uppercase font-mono font-bold text-neutral-500">
            Clean Cached Copies
          </div>
          <div
            id="outputs-stat-copies"
            className="text-xl font-black font-mono text-blue-700 mt-2"
          >
            {pipelineStats?.cleanCopies || 0}
          </div>
        </div>
        <div className="border border-neutral-300 bg-white p-4 flex flex-col justify-between shadow-xs">
          <div className="text-[9px] uppercase font-mono font-bold text-neutral-500">
            Google Drive Linked
          </div>
          <div className="text-xl font-black font-mono mt-2 flex items-center gap-1 text-amber-700">
            {gdriveUser ? "ACTIVE" : "OFFLINE"}
          </div>
        </div>
      </div>

      {/* Interactive Files Catalog */}
      <div className="px-6 pb-6 space-y-4">
        <div className="border border-neutral-300 bg-white text-left shadow-xs">
          <div className="bg-neutral-900 text-white p-3 font-mono text-[10.5px] uppercase font-bold flex items-center justify-between">
            <span>Local Pipeline Assets Inventory</span>
            <span className="text-[9px] text-neutral-300 font-normal">
              Actions execute operations inside safe sandboxes
            </span>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto w-full">
            <table className="w-full text-left font-sans text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-neutral-100 border-b border-neutral-300 font-mono text-[9.5px] text-neutral-600 uppercase">
                <tr>
                  <th className="p-3">Asset Details</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Local Sync Path</th>
                  <th className="p-3 text-right">Actions / Drive Backup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {/* Dataset JSONL Row */}

                <tr className="hover:bg-neutral-50/50">
                  <td className="p-3 font-mono text-[10.5px] font-bold text-neutral-800">
                    classroom_curriculum_dataset.jsonl
                  </td>
                  <td className="p-3">
                    <span className="inline-block px-2 py-0.5 text-[9px] font-mono uppercase bg-purple-50 text-purple-700 border border-purple-200 font-bold">
                      Dataset Map
                    </span>
                  </td>
                  <td className="p-3 font-mono text-[10px] text-neutral-500">
                    /dataset/classroom_curriculum_dataset.jsonl
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {gdriveUser ? (
                        <Button
                          onClick={() =>
                            triggerSingleSync(
                              "dataset-jsonl",
                              "dataset",
                              "classroom_curriculum_dataset.jsonl",
                              "dataset/classroom_curriculum_dataset.jsonl",
                            )
                          }
                          disabled={syncStatus["dataset-jsonl"] === "syncing"}
                          variant="outline"
                          className="h-7 rounded-none px-2 text-[9px] font-mono border-amber-500 text-amber-700 hover:bg-amber-50 cursor-pointer"
                        >
                          {syncStatus["dataset-jsonl"] === "syncing" ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : syncStatus["dataset-jsonl"] === "success" ? (
                            "✓ Synced"
                          ) : (
                            "Sync to Drive"
                          )}
                        </Button>
                      ) : (
                        <span className="text-[10px] text-neutral-400 font-mono">
                          [Link Drive to Backup]
                        </span>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Dictionaries / Extraction Reports */}
                <tr className="hover:bg-neutral-50/50">
                  <td className="p-3 font-mono text-[10.5px] font-bold text-neutral-800">
                    extraction-report.json
                  </td>
                  <td className="p-3">
                    <span className="inline-block px-2 py-0.5 text-[9px] font-mono uppercase bg-blue-50 text-blue-700 border border-blue-250 font-bold">
                      Diagnostic Report
                    </span>
                  </td>
                  <td className="p-3 font-mono text-[10px] text-neutral-500">
                    /reports/extraction-report.json
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {gdriveUser ? (
                        <Button
                          onClick={() =>
                            triggerSingleSync(
                              "report-extract",
                              "reports",
                              "extraction-report.json",
                              "reports/extraction-report.json",
                            )
                          }
                          disabled={syncStatus["report-extract"] === "syncing"}
                          variant="outline"
                          className="h-7 rounded-none px-2 text-[9px] font-mono border-amber-500 text-amber-700 hover:bg-amber-50 cursor-pointer"
                        >
                          {syncStatus["report-extract"] === "syncing" ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : syncStatus["report-extract"] === "success" ? (
                            "✓ Synced"
                          ) : (
                            "Sync to Drive"
                          )}
                        </Button>
                      ) : (
                        <span className="text-[10px] text-neutral-400 font-mono">
                          [Link Drive to Backup]
                        </span>
                      )}
                    </div>
                  </td>
                </tr>

                {/* Display 5 classified staging PDFs as direct sync rows */}
                {stagedPdfs
                  .filter((p) => p.status === "classified")
                  .map((pdf, idx) => {
                    const shortHash = pdf.hash.substring(0, 8);
                    const cleanFilename =
                      pdf.renamePattern ||
                      `${pdf.gradeId || "unknown"}__${pdf.subjectId || "unknown"}__${pdf.topicId || "unknown"}__${shortHash}.pdf`;
                    const localPath = `clean-pdfs/${cleanFilename}`;
                    const idOfItem = `pdf-${pdf.hash}`;

                    return (
                      <tr
                        key={pdf.hash || `output-pdf-${idx}`}
                        className="hover:bg-neutral-50/50"
                      >
                        <td
                          className="p-3 max-w-xs truncate font-mono text-[10.5px] text-neutral-800"
                          title={cleanFilename}
                        >
                          {cleanFilename}
                        </td>
                        <td className="p-3">
                          <span className="inline-block px-2 py-0.5 text-[9px] font-mono uppercase bg-emerald-50 text-emerald-700 border border-emerald-250 font-bold">
                            Stamped Copy
                          </span>
                        </td>
                        <td
                          className="p-3 font-mono text-[10px] text-neutral-500 truncate max-w-xs"
                          title={localPath}
                        >
                          /{localPath}
                        </td>
                        <td className="p-3 text-right">
                           <div className="flex items-center justify-end gap-2">
                             <a
                               href={`/api/pipeline/download-clean/${pdf.hash}?inline=true`}
                               target="_blank"
                               rel="noopener noreferrer"
                               title="Open PDF in new tab"
                               className="inline-flex items-center justify-center h-7 rounded-none px-2 text-[9px] font-mono border border-blue-500 text-blue-700 hover:bg-blue-50 bg-white"
                             >
                               👁️ View
                             </a>
                             <a
                               href={`/api/pipeline/download-clean/${pdf.hash}`}
                               download
                               title="Download PDF"
                               className="inline-flex items-center justify-center h-7 rounded-none px-2 text-[9px] font-mono border border-emerald-500 text-emerald-700 hover:bg-emerald-50 bg-white"
                             >
                               ⬇️ Download
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
                                  disabled={syncStatus[idOfItem] === "syncing"}
                                  variant="outline"
                                  className="h-7 rounded-none px-2 text-[9px] font-mono border-neutral-300 text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                                >
                                  {syncStatus[idOfItem] === "syncing" ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : syncStatus[idOfItem] === "success" ? (
                                    "✓ Backup OK"
                                  ) : (
                                    "Standard Sync"
                                  )}
                                </Button>
                                <Button
                                  onClick={() =>
                                    triggerGeminiSync(
                                      idOfItem,
                                      "clean-pdfs",
                                      cleanFilename,
                                      localPath,
                                    )
                                  }
                                  disabled={geminiSyncStatus[idOfItem] === "syncing"}
                                  className="h-7 rounded-none px-2 text-[9px] font-mono bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                                  title="Analyze with Gemini 2.5 Flash, dynamically auto-rename, and save in nesting folders"
                                >
                                  {geminiSyncStatus[idOfItem] === "syncing" ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : geminiSyncStatus[idOfItem] === "success" ? (
                                    "⚡ Gemini OK"
                                  ) : (
                                    "Gemini 2.5 Organize"
                                  )}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-neutral-400 font-mono">
                                [Link Drive to Backup]
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                {stagedPdfs.filter((p) => p.status === "classified").length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="p-8 text-center text-neutral-400 font-mono"
                    >
                      No classified stamped PDFs built in this session yet.
                      Build stamps inside the list!
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

  return <JobWorkspaceLayout sidebar={sidebarContent} main={mainContent} />;
}
export default OutputJobView;
