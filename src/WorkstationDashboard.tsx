import React, { useState, useEffect } from "react";
import { 
  Search, Globe, FileText, Download, List, Settings, 
  Trash2, Filter, GraduationCap, CheckCircle, XCircle, 
  Loader2, Sparkles, AlertTriangle, Merge, Share2, 
  ArrowRight, ExternalLink, RefreshCw, Layers, Check, 
  ChevronRight, ChevronDown, CheckSquare, Square, Save, 
  FileJson, Plus, FileDown, FolderArchive, Play, Pause, Cpu, Activity, Key
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { initAuth, googleSignIn, googleSignOut, getCachedToken } from "./services/googleDriveService";
import { User } from "firebase/auth";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import axios from "axios";
import { generateZipViaWorker } from "./workerClient";

// Standard props and interface definitions imported from types
import { DictionaryItem, TopicItem, Dictionary } from "./types/dictionary";
import { LevelspaceMetadata, StagedPdf } from "./types/pdf";
import { JobView, BatchJob, BatchJobItem, BlockedItemDetails } from "./types/jobs";
import { PipelineStats, OcrBatchMode } from "./types/pipeline";

// Layout and routing components imports
import { AppShell } from "./components/layout/AppShell";
import { TopMonitoringBar } from "./components/layout/TopMonitoringBar";
import { JobWorkspaceLayout } from "./components/layout/JobWorkspaceLayout";
import { JobNavigation } from "./components/jobs/JobNavigation";

// Job Views Modular Imports
import { IntakeJobView } from "./components/jobs/intake/IntakeJobView";
import { CollectorJobView } from "./components/jobs/collector/CollectorJobView";
import { ProcessorJobView } from "./components/jobs/processor/ProcessorJobView";
import { ProcessingJobView } from "./components/jobs/processing/ProcessingJobView";
import { IndexingJobView } from "./components/jobs/indexing/IndexingJobView";
import { ReviewJobView } from "./components/jobs/review/ReviewJobView";
import { OutputJobView } from "./components/jobs/outputs/OutputJobView";
import { ReportsJobView } from "./components/jobs/reports/ReportsJobView";
import { SettingsJobView } from "./components/jobs/settings/SettingsJobView";

// API services imports
import { pdfPipelineApi } from "./services/pdfPipelineApi";
import { ocrApi } from "./services/ocrApi";
import { reportsApi } from "./services/reportsApi";
import { dictionaryApi } from "./services/dictionaryApi";

// React Hooks imports
import { useLocalStorageState } from "./hooks/useLocalStorageState";
import { useDictionary } from "./hooks/useDictionary";
import { usePipelineStats } from "./hooks/usePipelineStats";
import { usePdfInventory } from "./hooks/usePdfInventory";
import { createStagedPdfFromUrl } from "./utils/createStagedPdfFromUrl";


export default function WorkstationDashboard() {
  // App states
  const [crawlUrl, setCrawlUrl] = useState("");
  const [maxPages, setMaxPages] = useState(9999);
  const [maxDepth, setMaxDepth] = useState(15);
  const [topicFilter, setTopicFilter] = useState(""); // User custom crawling topic filter
  
  const [isCrawling, setIsCrawling] = useState(false);
  const [isAiCleaning, setIsAiCleaning] = useState(false);
  const [crawledPdfs, setCrawledPdfs] = useState<string[]>([]);
  const [selectedCrawled, setSelectedCrawled] = useState<string[]>([]);
  const [siteMapNodes, setSiteMapNodes] = useState<any[]>([]);

  // Automatically load existing site map nodes on load
  useEffect(() => {
    const loadSiteMap = async () => {
      try {
        const res = await axios.get("/api/site-map");
        if (Array.isArray(res.data)) {
          setSiteMapNodes(res.data);
        } else if (res.data && Array.isArray(res.data.nodes)) {
          setSiteMapNodes(res.data.nodes);
        } else {
          setSiteMapNodes([]);
        }
      } catch (e) {
        console.warn("Failed to load existing site map", e);
        setSiteMapNodes([]);
      }
    };
    loadSiteMap();
  }, []);

  // Workspace-wide dictionary state
  const [dictionary, setDictionary] = useState<Dictionary>({
    grades: [],
    subjects: [],
    topics: [],
    allowedDocumentTypes: []
  });
  const [loadingDictionary, setLoadingDictionary] = useState(false);
  const [savingDictionary, setSavingDictionary] = useState(false);

  // Central PDF Inventory Hook
  const {
    foundUrls,
    stagedPdfs,
    selectedPdfUrls,
    filters,
    activeJobId,
    addFoundUrls,
    stageUrls,
    stageItems,
    updatePdf,
    updateManyPdfs,
    selectUrls,
    clearSelection,
    setFilters,
    clearFilters,
    setActiveJobId,
    resetWorkspace,
    setStagedPdfs
  } = usePdfInventory();

  const setSelectedPdfUrls = selectUrls;

  const [isClassifyingAll, setIsClassifyingAll] = useState(false);
  const [isProcessAllVisibleRunning, setIsProcessAllVisibleRunning] = useState(false);
  const [activeInspectedIndex, setActiveInspectedIndex] = useState<number | null>(null);

  const [showReadyBanner, setShowReadyBanner] = useState(false);
  const [showAdvancedStaging, setShowAdvancedStaging] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  // Batch system states
  const [activeBatchJob, setActiveBatchJob] = useState<BatchJob | null>(null);
  const [batchJobItems, setBatchJobItems] = useState<BatchJobItem[]>([]);
  const [blockedDetails, setBlockedDetails] = useState<Record<string, BlockedItemDetails>>({});
  const [selectedBatchItemId, setSelectedBatchItemId] = useState<string | null>(null);
  const [activeBlockForm, setActiveBlockForm] = useState({
    gradeId: "",
    subjectId: "",
    topicId: "",
    documentTypeId: "",
    cleanTitle: ""
  });
  const [isBatchJobRunning, setIsBatchJobRunning] = useState(false);

  // Batch scope state definitions
  const [scopeGradeId, setScopeGradeId] = useState<string>("all");
  const [scopeSubjectId, setScopeSubjectId] = useState<string>("all");
  const [scopeTopicId, setScopeTopicId] = useState<string>("all");
  const [scopeDocumentTypeId, setScopeDocumentTypeId] = useState<string>("all");
  const [scopeStatus, setScopeStatus] = useState<string>("all");

  // OCR Mode for batch: "Disabled" | "Safe" | "Balanced" | "Fast"
  const [ocrBatchMode, setOcrBatchMode] = useState<"Disabled" | "Safe" | "Balanced" | "Fast">("Balanced");

  // Intake Summary state (loaded from cache)
  const [intakeSummary, setIntakeSummary] = useState<{
    found: number;
    staged: number;
    duplicates: number;
    rejected: number;
  }>(() => {
    try {
      const cached = localStorage.getItem("scarpe_intake_summary");
      return cached ? JSON.parse(cached) : { found: 0, staged: 0, duplicates: 0, rejected: 0 };
    } catch {
      return { found: 0, staged: 0, duplicates: 0, rejected: 0 };
    }
  });

  // Save intakeSummary to localStorage
  useEffect(() => {
    localStorage.setItem("scarpe_intake_summary", JSON.stringify(intakeSummary));
  }, [intakeSummary]);
  const [customMergeName, setCustomMergeName] = useState("Combined_Exercises_Report");
  const [isCombining, setIsCombining] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  // Filters for displaying files in staging
  const filterStatus = filters.status;
  const filterGrade = filters.grade;
  const filterSubject = filters.subject;
  const setFilterStatus = (status: string) => setFilters({ status });
  const setFilterGrade = (grade: string) => setFilters({ grade });
  const setFilterSubject = (subject: string) => setFilters({ subject });

  const [activeJobView, setActiveJobView] = useState<JobView>("intake");
  const [activeTab, setActiveTab] = useState<"crawl" | "discover">("crawl");

  // Secret AI Studio Modal State
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [nvidiaApiKey, setNvidiaApiKey] = useState(() => localStorage.getItem("scarpe_secret_nvidia_key") || "");
  const [mistralApiKey, setMistralApiKey] = useState(() => localStorage.getItem("scarpe_secret_mistral_key") || "");
  const [openRouterApiKey, setOpenRouterApiKey] = useState(() => localStorage.getItem("scarpe_secret_openrouter_key") || "");
  const [openAiApiKey, setOpenAiApiKey] = useState(() => localStorage.getItem("scarpe_secret_openai_key") || "");

  // Google Drive Session & Sync Configuration
  const [gdriveUser, setGdriveUser] = useState<User | null>(null);
  const [gdriveAutoSync, setGdriveAutoSync] = useState(() => {
    const cached = localStorage.getItem("scarpe_gdrive_auto_sync");
    return cached === null ? false : cached === "true";
  });
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isSyncingSingle, setIsSyncingSingle] = useState<Record<string, boolean>>({});

  useEffect(() => {
    localStorage.setItem("scarpe_gdrive_auto_sync", String(gdriveAutoSync));
  }, [gdriveAutoSync]);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGdriveUser(user);
      },
      () => {
        setGdriveUser(null);
      }
    );
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const handleGdriveSignIn = async () => {
    try {
      const result = await googleSignIn();
      if (result) {
        setGdriveUser(result.user);
        toast.success(`Google Drive connected: welcome ${result.user.displayName || result.user.email}`);
      }
    } catch (err: any) {
      toast.error(`Google Drive connection failed: ${err.message}`);
    }
  };

  const handleGdriveSignOut = async () => {
    try {
      await googleSignOut();
      setGdriveUser(null);
      toast.success("Google Drive session disconnected.");
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err.message}`);
    }
  };

  const handleSyncSingleToDrive = async (category: string, filename: string, filepath: string) => {
    const cachedToken = getCachedToken();
    if (!cachedToken) {
      toast.error("Please connect your Google Drive account first.");
      return;
    }
    
    setIsSyncingSingle(prev => ({ ...prev, [filename]: true }));
    try {
      await axios.post("/api/gdrive/sync", {
        accessToken: cachedToken,
        category,
        filename,
        filepath
      });
      toast.success(`Google Drive: Backed up ${filename} successfully!`);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      toast.error(`Google Drive upload failed: ${msg}`);
      throw err;
    } finally {
      setIsSyncingSingle(prev => ({ ...prev, [filename]: false }));
    }
  };

  const handleGeminiSyncToDrive = async (category: string, filename: string, filepath: string) => {
    const cachedToken = getCachedToken();
    if (!cachedToken) {
      toast.error("Please connect your Google Drive account first.");
      return;
    }
    
    setIsSyncingSingle(prev => ({ ...prev, [filename + "-gemini"]: true }));
    try {
      const res = await axios.post("/api/gdrive/gemini-sync", {
        accessToken: cachedToken,
        category,
        filename,
        filepath
      });
      toast.success(`Google Drive (Gemini Organized): Saved inside "${res.data.folderPath}" as file "${res.data.filename}"!`);
      return res.data;
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      toast.error(`Gemini Smart Upload failed: ${msg}`);
      throw err;
    } finally {
      setIsSyncingSingle(prev => ({ ...prev, [filename + "-gemini"]: false }));
    }
  };

  const triggerAutoSyncIfEnabled = async (category: string, filename: string, filepath: string) => {
    // Only auto-sync clean processed PDFs, skip raw unreviewed downloads
    if (category === "downloads") return;
    
    const cachedToken = getCachedToken();
    if (gdriveUser && gdriveAutoSync && cachedToken) {
      try {
        await axios.post("/api/gdrive/sync", {
          accessToken: cachedToken,
          category,
          filename,
          filepath
        });
        toast.info(`Google Drive: Auto-synced ${filename}`);
      } catch (err: any) {
        console.error("[GDrive AutoSync error]", err);
      }
    }
  };

  const handleSyncAllToDrive = async () => {
    const cachedToken = getCachedToken();
    if (!cachedToken) {
      toast.error("Please connect your Google Drive account first.");
      return;
    }

    setIsSyncingAll(true);
    toast.info("Uploading reviewed ready PDFs to Google Drive...");
    try {
      const res = await axios.post("/api/gdrive/sync-all", {
        accessToken: cachedToken,
        categoryFilter: "clean-pdfs"
      });
      toast.success(`Uploaded ${res.data.count} PDFs to: Levelspace Drive Folder`);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      toast.error(`Google Drive Bulk Backup failed: ${msg}`);
    } finally {
      setIsSyncingAll(false);
    }
  };

  const [activeDiscoverTab, setActiveDiscoverTab] = useState<"query" | "paste">("query");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverPastedUrls, setDiscoverPastedUrls] = useState("");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredResults, setDiscoveredResults] = useState<{ url: string; isDirectPdf: boolean; accepted: boolean; reason: string; }[]>([]);
  const [selectedDiscovered, setSelectedDiscovered] = useState<string[]>([]);

  // Dictionary edit tab sub-states
  const [activeDictSubTab, setActiveDictSubTab] = useState<"grades" | "subjects" | "topics" | "docs">("grades");
  const [newGrade, setNewGrade] = useState({ id: "", nameAr: "", nameFr: "", suffix: "", keywords: "" });
  const [newSubject, setNewSubject] = useState({ id: "", nameAr: "", nameFr: "", suffix: "", keywords: "" });
  const [newTopic, setNewTopic] = useState({ id: "", nameAr: "", nameFr: "", suffix: "", subjectId: "", keywords: "" });

  const [pipelineStats, setPipelineStats] = useState({
    originalDownloads: 0,
    cleanCopies: 0,
    datasetRows: 0,
    localRoot: ""
  });

  // --- OCR async queue frontend states ---
  const [ocrQueue, setOcrQueue] = useState<any[]>([]);
  const [ocrConfig, setOcrConfig] = useState<any>({
    concurrency: 1,
    delayBetweenPagesMs: 8000,
    delayBetweenPdfsMs: 30000,
    maxPagesPerPdf: 30,
    maxPdfsPerBatch: 5,
    maxRetries: 3,
    backoffMultiplier: 2,
    dailyPageLimit: 100,
    isPaused: false
  });
  const [ocrQuotaUsedToday, setOcrQuotaUsedToday] = useState<number>(0);
  const [showOcrConfigPanel, setShowOcrConfigPanel] = useState<boolean>(true);

  // Poll OCR async queue status
  useEffect(() => {
    const fetchOcrStatus = async () => {
      try {
        const res = await axios.get("/api/pipeline/ocr/status");
        if (res.data && res.data.success) {
          setOcrQueue(res.data.queue || []);
          setOcrConfig(res.data.config || {});
          setOcrQuotaUsedToday(res.data.quotaUsedToday || 0);
        }
      } catch (err) {
        console.warn("Error polling OCR queue status:", err);
      }
    };

    fetchOcrStatus(); // immediate
    const ocrTimer = setInterval(fetchOcrStatus, 2000);
    return () => clearInterval(ocrTimer);
  }, []);

  const handleResetWorkspace = async () => {
    try {
      // 1. Reset server-side content
      try {
        await axios.post("/api/pipeline/reset-workspace");
      } catch (backendErr: any) {
        console.warn("Backend reset had issues, but continuing frontend clearance:", backendErr);
      }
      
      // 2. Reset central inventory via hook
      resetWorkspace();
      
      // 3. Reset local dashboard states
      setCrawledPdfs([]);
      setSelectedCrawled([]);
      setDiscoveredResults([]);
      setSelectedDiscovered([]);
      setOcrQueue([]);
      setActiveBatchJob(null);
      setBatchJobItems([]);
      setBlockedDetails({});
      setSelectedBatchItemId(null);
      setIsBatchJobRunning(false);
      
      // 4. Reset intake summary cache
      const initialSummary = { found: 0, staged: 0, duplicates: 0, rejected: 0 };
      setIntakeSummary(initialSummary);
      localStorage.setItem("scarpe_intake_summary", JSON.stringify(initialSummary));
      
      // 5. Clear other caches
      localStorage.removeItem("scarpe_staged_pdfs");
      
      // 6. Reset pipeline stats locally to prevent closures re-uploading stale state
      setPipelineStats({
        originalDownloads: 0,
        cleanCopies: 0,
        datasetRows: 0,
        localRoot: pipelineStats.localRoot
      });
      
      toast.success("Workspace has been fully reset. All data cleared.");
      setActiveJobView("intake");
    } catch (err: any) {
      toast.error("Failed to fully reset workspace: " + err.message);
    }
  };

  const handlePauseOcrQueue = async () => {
    try {
      const res = await axios.post("/api/pipeline/ocr/pause");
      if (res.data && res.data.config) {
        setOcrConfig(res.data.config);
        setOcrQueue(res.data.queue || ocrQueue);
        toast.info("OCR queue processing paused.");
      }
    } catch (err: any) {
      toast.error("Failed to pause OCR queue: " + err.message);
    }
  };

  const handleResumeOcrQueue = async () => {
    try {
      const res = await axios.post("/api/pipeline/ocr/resume");
      if (res.data && res.data.config) {
        setOcrConfig(res.data.config);
        setOcrQueue(res.data.queue || ocrQueue);
        toast.success("OCR queue processing resumed.");
      }
    } catch (err: any) {
      toast.error("Failed to resume OCR queue: " + err.message);
    }
  };

  const handleStopOcrQueueBatch = async () => {
    try {
      const res = await axios.post("/api/pipeline/ocr/stop");
      if (res.data) {
        toast.warning("Stopped OCR batch queue.");
      }
    } catch (err: any) {
      toast.error("Failed to stop OCR queue: " + err.message);
    }
  };

  const handleUpdateOcrConfig = async (updatedFields: any) => {
    try {
      const newConfig = { ...ocrConfig, ...updatedFields };
      const res = await axios.post("/api/pipeline/ocr/config", newConfig);
      if (res.data && res.data.config) {
        setOcrConfig(res.data.config);
        toast.success("OCR queue settings updated.");
      }
    } catch (err: any) {
      toast.error("Failed to update OCR settings: " + err.message);
    }
  };

  const handleApplyOcrModePreset = async (preset: "safe" | "balanced" | "fast") => {
    let fields = {};
    if (preset === "safe") {
      fields = {
        concurrency: 1,
        delayBetweenPagesMs: 8000,
        delayBetweenPdfsMs: 30000
      };
    } else if (preset === "balanced") {
      fields = {
        concurrency: 1,
        delayBetweenPagesMs: 4000,
        delayBetweenPdfsMs: 15000
      };
    } else if (preset === "fast") {
      fields = {
        concurrency: 2,
        delayBetweenPagesMs: 2000,
        delayBetweenPdfsMs: 5000
      };
    }
    await handleUpdateOcrConfig(fields);
    toast.success(`Applied OCR ${preset.toUpperCase()} preset mode successfully!`);
  };

  const fetchPipelineStats = async () => {
    try {
      const res = await axios.post("/api/pipeline/reports", { stagedPdfs });
      if (res.data && res.data.stats) {
        setPipelineStats(res.data.stats);
      }
      return res.data;
    } catch (e) {
      console.warn("Could not fetch local reports stats via POST, trying fallback GET:", e);
      try {
        const fallbackRes = await axios.get("/api/pipeline/reports");
        if (fallbackRes.data && fallbackRes.data.stats) {
          setPipelineStats(fallbackRes.data.stats);
        }
        return fallbackRes.data;
      } catch (getErr) {
        console.warn("Reports fallback failed as well:", getErr);
      }
    }
  };

  // Initial loading
  useEffect(() => {
    fetchDictionary();
    fetchPipelineStats();
  }, []);

  const handleDiscoverPdfs = async () => {
    if (activeDiscoverTab === "query" && !discoverQuery.trim()) {
      toast.error("Please enter a curriculum search query.");
      return;
    }
    if (activeDiscoverTab === "paste" && !discoverPastedUrls.trim()) {
      toast.error("Please paste at least one URL.");
      return;
    }

    setIsDiscovering(true);
    setDiscoveredResults([]);
    setSelectedDiscovered([]);
    toast.info("Discovery engine active. Fetching and filtering target PDFs...");

    try {
      const payload: any = { topicFilter };
      if (activeDiscoverTab === "query") {
        payload.query = discoverQuery;
      } else {
        payload.pastedUrls = discoverPastedUrls
          .split("\n")
          .map(line => line.trim())
          .filter(Boolean);
      }

      const res = await axios.post("/api/discover-pdfs", payload);
      const results = res.data.results || [];
      setDiscoveredResults(results);

      // We auto select accepted URLs initially in candidate list (useful for Advanced Mode)
      const acceptedUrls = results.filter((r: any) => r.accepted).map((r: any) => r.url);
      setSelectedDiscovered(acceptedUrls);

      // Now auto-stage verified/accepted direct PDF URLs by default
      const acceptedPdfUrls = results
        .filter((r: any) => r.accepted && (r.isDirectPdf || r.url.toLowerCase().split(/[?#]/)[0].endsWith(".pdf")))
        .map((r: any) => r.url);

      handleAutoStageAndSummarize(acceptedPdfUrls, "Discovery");
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.error || "Discovery session encountered an error.");
    } finally {
      setIsDiscovering(false);
    }
  };

  const stagePdfUrlsAsync = async (urls: string[], options?: { autoSelect?: boolean }) => {
    const uniqueUrls = Array.from(new Set(urls.map(u => u.trim())));
    const existing = new Set(stagedPdfs.map(p => p.url));
    const newUrls = uniqueUrls.filter(url => !existing.has(url));
    const duplicates = uniqueUrls.length - newUrls.length;

    if (newUrls.length > 0) {
      const gdriveToken = getCachedToken();
      let resolvedItems = [];
      const { fetchDriveFileMetadata } = await import("./services/googleDriveService");
      
      for (const url of newUrls) {
        let isDrive = false;
        try {
          isDrive = new URL(url).hostname.includes("drive.google.com");
        } catch {}

        if (isDrive) {
          const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
          if (match && match[1] && gdriveToken) {
            try {
              const fileData = await fetchDriveFileMetadata(gdriveToken, match[1]);
              if (fileData && fileData.name) {
                resolvedItems.push({ 
                  url, 
                  sourceTitle: fileData.name, 
                  sourceName: fileData.name,
                  sourceType: "Google Drive"
                });
                continue;
              }
            } catch (err) {
              console.error("Failed to fetch drive title for", url, err);
            }
          }
          // Fallback if no token or fetch failed
          resolvedItems.push({ url, sourceType: "Google Drive" });
        } else {
          resolvedItems.push({ url });
        }
      }
      
      stageItems(resolvedItems, options?.autoSelect !== false);
    } else if (options?.autoSelect !== false && uniqueUrls.length > 0) {
      setSelectedPdfUrls(prev => Array.from(new Set([...prev, ...uniqueUrls])));
    }

    return {
      found: uniqueUrls.length,
      staged: newUrls.length,
      duplicates
    };
  };

  const handleAutoStageAndSummarize = async (
    allFoundUrls: string[],
    actionName: string
  ) => {
    // 1. Validate URLs: Must start with http:// or https:// and have .pdf or drive.google.com
    const validPdfUrls = allFoundUrls.filter(url => {
      if (!url || typeof url !== "string") return false;
      const lowered = url.trim().toLowerCase();
      if (!lowered.startsWith("http://") && !lowered.startsWith("https://")) return false;
      try {
        const pathPart = lowered.split(/[?#]/)[0];
        return pathPart.endsWith(".pdf") || lowered.includes("drive.google.com");
      } catch {
        return lowered.includes(".pdf") || lowered.includes("drive.google.com");
      }
    });

    const rejectedCount = allFoundUrls.length - validPdfUrls.length;

    // 2. Add found URLs to foundUrls
    addFoundUrls(validPdfUrls);

    // 3. Auto-stage valid PDF URLs
    const report = await stagePdfUrlsAsync(validPdfUrls, { autoSelect: true });
    if (report.staged > 0) {
      setShowReadyBanner(true);
    }

    // Show clear summary toast based on real staged state change
    if (report.staged > 0) {
      toast.success(
        <div className="font-mono text-xs text-left">
          <div className="font-bold border-b border-emerald-200 pb-1 mb-1 font-sans text-emerald-900 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            {actionName} Summary
          </div>
          <div>Found PDFs: <span className="font-bold">{validPdfUrls.length}</span></div>
          <div>Auto-staged: <span className="font-bold text-emerald-700">{report.staged}</span></div>
          <div>Duplicates skipped: <span className="font-bold">{report.duplicates}</span></div>
          <div>Rejected URLs: <span className="font-bold text-red-600">{rejectedCount}</span></div>
        </div>,
        { duration: 6000 }
      );
    } else {
      toast.info(
        <div className="font-mono text-xs text-left">
          <div className="font-bold border-b border-blue-200 pb-1 mb-1 font-sans text-blue-900">{actionName} Summary</div>
          <div>Found PDFs: <span className="font-bold">{validPdfUrls.length}</span></div>
          <div>Auto-staged: <span className="font-bold text-neutral-500">0</span> (All duplicates skipped)</div>
          <div>Duplicates skipped: <span className="font-bold text-amber-700">{report.duplicates}</span></div>
          <div>Rejected URLs: <span className="font-bold text-red-600">{rejectedCount}</span></div>
        </div>,
        { duration: 5000 }
      );
    }

    return {
      found: validPdfUrls.length,
      staged: report.staged,
      duplicates: report.duplicates,
      rejected: rejectedCount
    };
  };

  const handleIncorporateDiscovered = async () => {
    if (selectedDiscovered.length === 0) {
      toast.error("Please select at least one discovered link.");
      return;
    }

    const clickedItems = discoveredResults.filter(r => selectedDiscovered.includes(r.url));
    const directPdfs = clickedItems.filter(r => r.isDirectPdf);
    const webpages = clickedItems.filter(r => !r.isDirectPdf);

    let crawlQueue: string[] = [];

    // Stage direct PDFs
    if (directPdfs.length > 0) {
      const urls = directPdfs.map(p => p.url);
      const report = await stagePdfUrlsAsync(urls, { autoSelect: true });
      toast.success(
        `Found ${report.found} PDFs from selected. Auto-staged ${report.staged}. ${report.duplicates} already existed.`
      );
      if (report.staged > 0) {
        setShowReadyBanner(true);
      }
      setTimeout(() => {
        const el = document.getElementById("pdf-classification-workspace-card");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }

    if (webpages.length > 0) {
      crawlQueue = webpages.map(w => w.url);
      let pagePdfsFound: string[] = [];
      
      setIsCrawling(true);
      for (const webUrl of crawlQueue) {
        try {
          const res = await axios.post("/api/crawl-pdfs", {
            url: webUrl,
            maxPages: 10, // fast shallow crawl for these relevant index pages
            maxDepth: 1,
            topicFilter
          });
          const urls: string[] = res.data.pdfs || [];
          pagePdfsFound = [...pagePdfsFound, ...urls];
        } catch (e: any) {
          console.warn(`[Incorporate Crawler] Failed on link: ${webUrl}`, e.message);
        }
      }
      setIsCrawling(false);
      
      if (pagePdfsFound.length > 0) {
        const uniqueFound = Array.from(new Set(pagePdfsFound));

        setCrawledPdfs(prev => Array.from(new Set([...prev, ...uniqueFound])));
        setSelectedCrawled(prev => Array.from(new Set([...prev, ...uniqueFound])));
        addFoundUrls(uniqueFound);

        const report = await stagePdfUrlsAsync(uniqueFound, { autoSelect: true });

        toast.success(
          `Found ${report.found} PDFs from selected pages. Auto-staged ${report.staged}. ${report.duplicates} already existed.`
        );
        
        if (report.staged > 0) {
          setShowReadyBanner(true);
        }
        
        setTimeout(() => {
          const el = document.getElementById("pdf-classification-workspace-card");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      } else {
        toast.warning("Underlying pages didn't yield any instant PDFs. Try refining your Topic Filters.");
      }
    }
  };

  // Helper to retrieve suggested actions based on block status
  const getSuggestedActions = (reason: string): string[] => {
    switch (reason) {
      case "no_grade_match":
        return ["Select the matching grade from the database dictionary below.", "Review the document's introductory words or headers."];
      case "no_subject_match":
        return ["Select the subject from the database dictionary below.", "Search for course subject markings (e.g., MATH, PC, SVT)."];
      case "no_topic_match":
        return ["Select a specific topic under the document's subject.", "Add the topic keywords to the database dictionary if its new."];
      case "topic_filter_mismatch":
        return ["Modify or clear your Topic Filters settings in the Crawl configuration.", "Manually approve the classification with a chosen topic."];
      case "low_confidence_classification":
        return ["Verify the classification choices selected by the pipeline.", "Click Apply & Approve to proceed."];
      case "document_type_uncertain":
        return ["Set the document type (e.g. Cours, Exercices, Evaluation).", "Look for title indicators like 'Exam', 'Série', or 'Cours'."];
      case "ocr_needed_but_disabled":
        return ["Turn on OCR processing (Balanced, Safe, or Fast mode) in settings.", "Manually transcribe or override metadata."];
      case "ocr_failed":
        return ["Ensure your API keys are valid in Settings.", "Use a different OCR backend engine or retry with fewer pages."];
      case "malformed_url":
        return ["Check the format of the target PDF link.", "Ensure it starts with http/https."];
      case "duplicate_conflict":
        return ["Skip this duplicates PDF.", "Force overwrite if you intend to re-process."];
      default:
        return ["Review current metadata mappings and approve to generate clean stamped copy."];
    }
  };

  // Helper to live-calculate clean Morocco educational filename pattern
  const computeRenamePattern = (gid: string, sid: string, tid: string, dtid: string, title: string) => {
    const g = dictionary.grades.find(x => x.id === gid);
    const s = dictionary.subjects.find(x => x.id === sid);
    const t = dictionary.topics.find(x => x.id === tid);
    const dt = dictionary.allowedDocumentTypes.find(x => x.id === dtid);
    
    const gS = g?.suffix || "UNKNOWN";
    const sS = s?.suffix || "UNKNOWN";
    const tS = t?.suffix || "UNKNOWN";
    const dtS = dt?.suffix || "UNKNOWN";
    
    // Clean to system titles replacing spaces with underscores
    let clean = (title || "unnamed")
      .trim()
      .replace(/[\s\-_]+/g, "_")
      .replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, "");
    if (!clean) clean = "Document";

    return `${gS}_${sS}_${tS}_${dtS}_${clean}.pdf`;
  };

  // Automated Staging Rule: Intake URL synchronizer
  const autoStageUrls = async (urls: string[]) => {
    return await stagePdfUrlsAsync(urls, { autoSelect: true });
  };

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

  // Create Batch Job function
  const createBatchJob = () => {
    console.log("[BATCH DEBUG] Starting Batch Job Creation");
    console.log(`[BATCH DEBUG] Total staged PDFs before filters: ${stagedPdfAssets.length}`);
    console.log(`[BATCH DEBUG] Selected Grade Filter: ${scopeGradeId}`);
    console.log(`[BATCH DEBUG] Selected Subject Filter: ${scopeSubjectId}`);
    console.log(`[BATCH DEBUG] Selected Scope Status: ${scopeStatus}`);
    console.log(`[BATCH DEBUG] Selected OCR Mode: ${ocrBatchMode}`);

    let countAfterGrade = 0;
    let countAfterSubject = 0;
    let countAfterStatus = 0;

    // Determine scope and filter stagedPdfAssets to match scope criteria
    const scopeItems = stagedPdfAssets.filter((pdf: any) => {
      // If ALL is selected, do not filter by grade/subject at all
      if (scopeGradeId !== "all") {
        const pGrade = (pdf.extracted_grade || "").toLowerCase();
        const sGrade = scopeGradeId.toLowerCase();
        if (pGrade !== sGrade) {
          console.log(`[BATCH DEBUG] Excluded ${pdf.canonical_url}: Grade mismatch "${pGrade}" !== "${sGrade}"`);
          return false;
        }
      }
      countAfterGrade++;
      
      if (scopeSubjectId !== "all") {
        const pSubj = (pdf.extracted_subject || "").toLowerCase();
        const sSubj = scopeSubjectId.toLowerCase();
        if (pSubj !== sSubj) {
          console.log(`[BATCH DEBUG] Excluded ${pdf.canonical_url}: Subject mismatch "${pSubj}" !== "${sSubj}"`);
          return false;
        }
      }
      countAfterSubject++;

      if (scopeStatus !== "all") {
        // Normalize status checking for staged assets
        if (scopeStatus === "pending" && pdf.verification_status !== "pending") {
          console.log(`[BATCH DEBUG] Excluded ${pdf.canonical_url}: Status mismatch, needed pending but got ${pdf.verification_status}`);
          return false;
        }
        if (scopeStatus === "needs_review" && (!pdf.processing_errors || pdf.processing_errors.length === 0)) {
          console.log(`[BATCH DEBUG] Excluded ${pdf.canonical_url}: Status mismatch, needs review requires errors`);
          return false;
        }
        if (scopeStatus === "failed" && (!pdf.processing_errors || pdf.processing_errors.length === 0)) {
          console.log(`[BATCH DEBUG] Excluded ${pdf.canonical_url}: Status mismatch, failed requires errors`);
          return false;
        }
        if (scopeStatus === "ocr_needed" && pdf.ocr_status !== "needed") {
          console.log(`[BATCH DEBUG] Excluded ${pdf.canonical_url}: Status mismatch, needed OCR but got ${pdf.ocr_status}`);
          return false;
        }
      }
      countAfterStatus++;
      return true;
    });

    console.log(`[BATCH DEBUG] Total PDFs after Grade filter: ${countAfterGrade}`);
    console.log(`[BATCH DEBUG] Total PDFs after Subject filter: ${countAfterSubject}`);
    console.log(`[BATCH DEBUG] Total PDFs after Status filter: ${countAfterStatus}`);
    console.log(`[BATCH DEBUG] Final matching PDFs: ${scopeItems.length}`);

    if (scopeItems.length === 0) {
      toast.error("No PDFs match these filters.", {
        description: "Try setting Grade, Subject, Topic, Document Type, and Status to All, or go back to Collect PDFs and stage more PDFs.",
        action: {
          label: "Clear Filters",
          onClick: () => {
            setScopeGradeId("all");
            setScopeSubjectId("all");
            setScopeTopicId("all");
            setScopeDocumentTypeId("all");
            setScopeStatus("all");
          }
        }
      });
      return;
    }

    const jobId = "job_" + Math.random().toString(36).substring(2, 9);
    const newJob: BatchJob = {
      id: jobId,
      name: `Batch Job (${scopeItems.length} PDFs)`,
      scope: {
        gradeId: scopeGradeId === "all" ? null : scopeGradeId,
        subjectId: scopeSubjectId === "all" ? null : scopeSubjectId,
        topicId: scopeTopicId === "all" ? null : scopeTopicId,
        documentTypeId: scopeDocumentTypeId === "all" ? null : scopeDocumentTypeId,
        status: scopeStatus === "all" ? null : scopeStatus
      },
      totalItems: scopeItems.length,
      pending: scopeItems.length,
      running: 0,
      completed: 0,
      blocked: 0,
      failed: 0,
      skipped: 0,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processedItems: 0
    };

    const items: BatchJobItem[] = scopeItems.map((pdf: any, idx: number) => ({
      id: pdf.id || (`item_${idx}_` + Math.random().toString(36).substring(2, 9)),
      url: pdf.canonical_url || pdf.url,
      filename: pdf.file_name || pdf.originalName || "document.pdf",
      originalName: pdf.file_name || pdf.originalName || "document.pdf",
      status: "queued" as const,
      currentStep: "download" as const,
      stepProgress: {
        downloaded: false,
        ocrDone: false,
        classified: false,
        cleanBuilt: false
      }
    }));

    setActiveBatchJob(newJob);
    setBatchJobItems(items);
    setBlockedDetails({});
    setSelectedBatchItemId(null);

    // Persist to server
    axios.post("/api/pipeline/batch-job", { ...newJob, items }).catch(e => {
      console.error("Failed to persist batch job:", e);
    });

    toast.success(`Batch Job created with ${scopeItems.length} items. Ready to process.`);
    setIsBatchJobRunning(true);
  };

  const startBatchJob = async () => {
    if (!activeBatchJob) return;
    const updated = { ...activeBatchJob, status: "running" as const, updatedAt: new Date().toISOString() };
    setActiveBatchJob(updated);
    setIsBatchJobRunning(true);
    await axios.post("/api/pipeline/batch-job", { ...updated, items: batchJobItems });
  };

  const pauseBatchJob = async () => {
    if (!activeBatchJob) return;
    const updated = { ...activeBatchJob, status: "paused" as const, updatedAt: new Date().toISOString() };
    setActiveBatchJob(updated);
    setIsBatchJobRunning(false);
    await axios.post("/api/pipeline/batch-job", { ...updated, items: batchJobItems });
    toast.info("Batch job paused.");
  };

  const stopBatchJob = async () => {
    if (!activeBatchJob) return;
    const updated = { ...activeBatchJob, status: "paused" as const, updatedAt: new Date().toISOString() };
    setActiveBatchJob(null);
    setBatchJobItems([]);
    setBlockedDetails({});
    setSelectedBatchItemId(null);
    setIsBatchJobRunning(false);
    toast.info("Batch job stopped.");
  };

  // Helper status updates
  const updateItemStep = (index: number, step: BatchJobItem["currentStep"]) => {
    setBatchJobItems(prev => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index] = { ...copy[index], currentStep: step };
      }
      return copy;
    });
  };

  const blockItem = async (
    index: number,
    item: BatchJobItem,
    reason: string,
    details: BlockedItemDetails,
    hash?: string,
    classData?: any
  ) => {
    const updatedItems = [...batchJobItems];
    updatedItems[index] = {
      ...item,
      status: "blocked" as const,
      processing_status: "blocked",
      review_status: "needs_text_review",
      blockReason: reason,
      hash,
      requiresUserAction: true,
      confidenceScore: details.confidenceScore
    };
    setBatchJobItems(updatedItems);
    setBlockedDetails(prev => ({ ...prev, [item.url]: details }));

    setStagedPdfs(prev => {
      return prev.map(p => {
        if (p.url === item.url) {
          return {
            ...p,
            status: "needs_review",
            hash,
            reason,
            gradeId: classData?.gradeId || null,
            subjectId: classData?.subjectId || null,
            topicId: classData?.topicId || null,
            documentTypeId: classData?.documentTypeId || null,
            cleanTitle: classData?.cleanTitle || null,
            renamePattern: classData?.renamePattern || null,
            confidenceScore: classData?.confidenceScore || 0
          };
        }
        return p;
      });
    });

    setActiveBatchJob(prev => {
      if (!prev) return null;
      const job = {
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        blocked: prev.blocked + 1,
        updatedAt: new Date().toISOString()
      };
      axios.post("/api/pipeline/batch-job", { ...job, items: updatedItems });
      return job;
    });

    axios.post("/api/pipeline/reports/update", {
      reportName: "blocked-items.json",
      entry: {
        url: item.url,
        hash,
        blockReason: reason,
        explanation: details.explanation,
        stagedAt: new Date().toISOString()
      }
    }).catch(e => console.warn(e));

    toast.warning(`Block action required: ${item.filename} is blocked due to ${reason}`);
  };

  const completeItem = async (
    index: number,
    item: BatchJobItem,
    hash: string,
    classData: any,
    cleanData?: any
  ) => {
    const isNeedsReview = classData.status === "needs_review";

    const updatedItems = [...batchJobItems];
    updatedItems[index] = {
      ...item,
      status: isNeedsReview ? "needs_review" : (cleanData ? "clean_copy_done" : "classified"),
      processing_status: "completed",
      review_status: isNeedsReview ? "needs_metadata_review" : "auto_approved",
      currentStep: "done",
      hash,
      confidenceScore: Math.round((classData.confidenceScore || 0) * 100),
      requiresUserAction: isNeedsReview,
      blockReason: isNeedsReview ? classData.reason : undefined
    };
    setBatchJobItems(updatedItems);
    
    // Auto-sync is handled earlier, but doing it again if needed
    if (classData && classData.renamePattern) {
        const rawName = classData.renamePattern.replace(".pdf", "_raw.pdf");
        triggerAutoSyncIfEnabled("downloads", rawName, `downloads/${hash}.original.pdf`);
    }

    if (isNeedsReview) {
      toast.info(`${item.filename} was processed but needs review because ${classData.reason === "low_confidence_classification" ? "classification confidence is low" : "metadata matching was uncertain"}.`);
    }

    setStagedPdfs(prev => {
      return prev.map(p => {
        if (p.url === item.url) {
          return {
            ...p,
            status: isNeedsReview ? "needs_review" : "classified",
            reason: isNeedsReview ? classData.reason : undefined,
            hash,
            gradeId: classData.gradeId,
            subjectId: classData.subjectId,
            topicId: classData.topicId,
            documentTypeId: classData.documentTypeId,
            cleanTitle: classData.cleanTitle,
            renamePattern: classData.renamePattern,
            confidenceScore: classData.confidenceScore,
            cleanCopyStatus: cleanData ? "success" : "pending",
            datasetRowStatus: cleanData ? "success" : "pending",
            cleanFilename: cleanData?.cleanName,
            datasetId: cleanData?.datasetId
          };
        }
        return p;
      });
    });

    setActiveBatchJob(prev => {
      if (!prev) return null;
      const job = {
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        completed: prev.completed + 1,
        updatedAt: new Date().toISOString()
      };
      axios.post("/api/pipeline/batch-job", { ...job, items: updatedItems });
      return job;
    });

    axios.post("/api/pipeline/reports/update", {
      reportName: "classification-report.json",
      entry: {
        hash,
        url: item.url,
        gradeId: classData.gradeId,
        subjectId: classData.subjectId,
        topicId: classData.topicId,
        documentTypeId: classData.documentTypeId,
        confidenceScore: classData.confidenceScore,
        cleanTitle: classData.cleanTitle
      }
    }).catch(e => console.warn(e));

    toast.success(`Success building named copy: ${cleanData.cleanName || item.filename}`);
  };

  const rejectItem = async (index: number, item: BatchJobItem, reason: string) => {
    const updatedItems = [...batchJobItems];
    updatedItems[index] = {
      ...item,
      status: "failed" as const,
      processing_status: "failed",
      review_status: "rejected",
      currentStep: "done" as const,
      blockReason: reason
    };
    setBatchJobItems(updatedItems);

    setStagedPdfs(prev => {
      return prev.map(p => {
        if (p.url === item.url) {
          return { ...p, status: "rejected", reason };
        }
        return p;
      });
    });

    setActiveBatchJob(prev => {
      if (!prev) return null;
      const job = {
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        failed: prev.failed + 1,
        updatedAt: new Date().toISOString()
      };
      axios.post("/api/pipeline/batch-job", { ...job, items: updatedItems });
      return job;
    });

    toast.error(`Rejected Item: ${item.filename} (${reason})`);
  };

  const skipDuplicateItem = async (index: number, item: BatchJobItem, hash: string) => {
    const updatedItems = [...batchJobItems];
    updatedItems[index] = {
      ...item,
      status: "skipped" as const,
      currentStep: "done" as const,
      hash,
      blockReason: "Duplicate item hash skipped"
    };
    setBatchJobItems(updatedItems);

    setStagedPdfs(prev => {
      return prev.map(p => {
        if (p.url === item.url) {
          return {
            ...p,
            status: "exact_duplicate",
            isMatch: true,
            hash,
            raw_file_hash: hash,
            blockReason: "Duplicate item hash skipped"
          };
        }
        return p;
      });
    });

    setActiveBatchJob(prev => {
      if (!prev) return null;
      const job = {
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        skipped: prev.skipped + 1,
        updatedAt: new Date().toISOString()
      };
      axios.post("/api/pipeline/batch-job", { ...job, items: updatedItems });
      return job;
    });

    toast.info(`Duplicate exact hash skipped: ${item.filename}`);
  };

  // Main automated processing coordinator
  const processBatchItem = async (index: number, item: BatchJobItem) => {
    updateItemStep(index, "download");
    let parseRes;
    
    let retries = 3;
    while (retries > 0) {
      try {
        parseRes = await axios.post("/api/pipeline/parse", {
          url: item.url,
          title: item.filename,
          topicFilter: activeBatchJob?.scope.topicId || topicFilter
        });
        break; // Success!
      } catch (e: any) {
        if (e.response?.status === 429 && retries > 1) {
          retries--;
          await new Promise(r => setTimeout(r, 6000)); // Wait 6s and retry
          continue;
        }
        throw new Error(`Parse failed: ${e.message}`);
      }
    }

    if (!parseRes.data.success) {
      if (parseRes.data.status === "rejected" || parseRes.data.status === "blocked") {
        return rejectItem(index, item, parseRes.data.reason || parseRes.data.blockReason || "Malformed URL or unsupported source");
      }
      throw new Error(parseRes.data.error || parseRes.data.reason || "Failed to download/parse PDF");
    }

    const { hash, isDuplicate, needsOcr, textLength, textQualityScore } = parseRes.data;
    const rawText = parseRes.data.textSnippet || "";

    if (isDuplicate) {
      return skipDuplicateItem(index, item, hash);
    }

    // Auto-sync original downloaded PDF to Google Drive in background
    triggerAutoSyncIfEnabled("downloads", `${hash}.original.pdf`, `downloads/${hash}.original.pdf`);

    updateItemStep(index, "ocr");
    let finalText = rawText;
    let finalNeedsOcr = needsOcr;

    if (finalNeedsOcr) {
      if (ocrBatchMode === "Disabled") {
        return blockItem(index, item, "ocr_needed_but_disabled", {
          blockReason: "ocr_needed_but_disabled",
          explanation: "This PDF requires OCR scanning to extract text, but OCR is currently disabled in your batch settings.",
          suggestedActions: ["Enable OCR mode (Safe, Balanced, or Fast mode) in settings and resume batch", "Classify this PDF manually"],
          confidenceScore: 0,
          matchedTerms: [],
          sourcePreview: item.url,
          textPreview: "Extraction score: " + textQualityScore
        }, hash);
      }

      try {
        let maxOcrRetries = 1;
        if (ocrBatchMode === "Balanced") maxOcrRetries = 2; // balanced allows 1 retry
        
        let ocrSuccess = false;
        let ocrResult = null;

        for (let attempt = 0; attempt < maxOcrRetries; attempt++) {
          try {
            const ocrRes = await axios.post("/api/pipeline/ocr", { hash });
            if (ocrRes.data.success) {
              ocrSuccess = true;
              ocrResult = ocrRes.data;
              break;
            }
          } catch (e) {
            console.warn(`OCR retry attempt ${attempt + 1} failed for ${hash}`);
          }
        }

        if (!ocrSuccess && ocrBatchMode !== "Fast") {
          return blockItem(index, item, "ocr_failed", {
            blockReason: "ocr_failed",
            explanation: "Gemini / Mistral OCR service returned a failure or timed out.",
            suggestedActions: ["Verify your Mistral OCR API key in Settings", "Use a different OCR backend engine", "Classify manually"],
            confidenceScore: 0,
            matchedTerms: [],
            sourcePreview: item.url
          }, hash);
        }

        if (ocrResult && ocrResult.ocrTextSnippet) {
          finalText = ocrResult.ocrTextSnippet;
        }
      } catch (err: any) {
        if (ocrBatchMode !== "Fast") {
          return blockItem(index, item, "ocr_failed", {
            blockReason: "ocr_failed",
            explanation: `OCR exception: ${err.message}`,
            suggestedActions: ["Retry OCR", "Classify manually"],
            confidenceScore: 0,
            sourcePreview: item.url
          }, hash);
        }
      }
    }

    const originalStagedItem = stagedPdfs.find(p => p.url === item.url) || stagedPdfAssets.find((p: any) => p.canonical_url === item.url || p.url === item.url) || {} as any;
    
    updateItemStep(index, "chunking");
    try {
      await axios.post("/api/pipeline/chunk", {
        hash,
        url: item.url,
        title: item.filename,
        text: finalText
      });
      // also update the node status locally immediately
      if (originalStagedItem.id) {
         handleUpdateSiteMapNode(originalStagedItem.id, { chunking_status: "rag_ready" });
      }
    } catch (e: any) {
      console.warn("Chunking failed:", e.message);
    }

    updateItemStep(index, "classify");
    let classifyRes;
    try {
      classifyRes = await axios.post("/api/classify", {
        title: item.filename,
        url: item.url,
        text: finalText,
        topicFilter: activeBatchJob?.scope.topicId || topicFilter
      });
    } catch (e: any) {
      throw new Error(`Classification failed: ${e.message}`);
    }

    const classData = classifyRes.data;
    const confidencePercent = Math.round((classData.confidenceScore || 0) * 100);

    let needsReviewFlag = false;
    let reviewReasonStr = "";

    if (!classData.isMatch || classData.status === "needs_review") {
      let reason: string = classData.reason || "Classification mismatch";
      let blockReason = "low_confidence_classification";
      if (reason.includes("Grade")) blockReason = "no_grade_match";
      else if (reason.includes("Subject")) blockReason = "no_subject_match";
      else if (reason.includes("Topic ID")) blockReason = "no_topic_match";
      else if (reason.includes("Document Type")) blockReason = "document_type_uncertain";
      else if (reason.includes("Topic Filters")) blockReason = "topic_filter_mismatch";

      // These are soft reasons - don't block
      needsReviewFlag = true;
      reviewReasonStr = blockReason;
    }

    if (confidencePercent < 50 && !needsReviewFlag) {
      needsReviewFlag = true;
      reviewReasonStr = "no_reliable_match";
    } else if (confidencePercent < 80 && !needsReviewFlag) {
      needsReviewFlag = true;
      reviewReasonStr = "low_confidence_classification";
    }

    // Instead of stopping, continue to generate clean copy and dataset rows
    updateItemStep(index, "done");

    // Add clean copy generation inside the pipeline directly
    let cleanData;
    try {
      const cleanRes = await axios.post("/api/pipeline/clean-copy", {
        hash: hash,
        gradeId: classData.gradeId || originalStagedItem.gradeId || originalStagedItem.extracted_grade || "unknown",
        subjectId: classData.subjectId || originalStagedItem.subjectId || originalStagedItem.extracted_subject || "unknown",
        topicId: classData.topicId || originalStagedItem.topicId || "unknown",
        documentTypeId: classData.documentTypeId || originalStagedItem.documentTypeId || "unknown",
        title: item.filename,
        url: item.url,
        text: finalText
      });
      cleanData = cleanRes.data;
    } catch (e: any) {
      console.warn("Clean copy generation skipped or failed:", e.message);
    }
    
    // Inject review flags into classData so completeItem can handle them
    if (needsReviewFlag) {
      classData.status = "needs_review";
      classData.reason = reviewReasonStr;
      
      console.log(`[Batch Pipeline] Soft-blocked item ${item.filename}:`, {
        confidencePercent,
        reason: reviewReasonStr,
        originalGrade: originalStagedItem.extracted_grade,
        originalSubject: originalStagedItem.extracted_subject,
        detectedGrade: classData.gradeId,
        detectedSubject: classData.subjectId
      });
    } else {
      console.log(`[Batch Pipeline] Successfully classified item ${item.filename}:`, {
        confidencePercent,
        detectedGrade: classData.gradeId,
        detectedSubject: classData.subjectId,
        topicId: classData.topicId,
        documentTypeId: classData.documentTypeId
      });
    }

    return completeItem(index, item, hash, classData, cleanData);
  };

  // Block Resolution Handler
  const handleResolveBlock = async (
    itemIndex: number,
    item: BatchJobItem,
    resolvedMetadata: {
      gradeId: string;
      subjectId: string;
      topicId: string;
      documentTypeId: string;
      cleanTitle: string;
    }
  ) => {
    const { gradeId, subjectId, topicId, documentTypeId, cleanTitle } = resolvedMetadata;
    
    if (!gradeId || !subjectId || !topicId || !documentTypeId || !cleanTitle) {
      toast.error("Please fill in all metadata selections before approving.");
      return;
    }

    toast.info("Applying resolution & saving classified standard raw PDF...");
    const renamePattern = computeRenamePattern(gradeId, subjectId, topicId, documentTypeId, cleanTitle);
    const hash = item.hash || "manual_" + Math.random().toString(36).substring(2, 9);
    const rawName = renamePattern.replace(".pdf", "_raw.pdf");

    try {
      const updatedItems = [...batchJobItems];
      updatedItems[itemIndex] = {
        ...item,
        status: "classified",
        currentStep: "done",
        hash,
        requiresUserAction: false,
        blockReason: null
      };
      setBatchJobItems(updatedItems);

      triggerAutoSyncIfEnabled("downloads", rawName, `downloads/${hash}.original.pdf`);

      setStagedPdfs(prev => {
        return prev.map(p => {
          if (p.url === item.url) {
            return {
              ...p,
              status: "classified",
              hash,
              gradeId,
              subjectId,
              topicId,
              documentTypeId,
              cleanTitle,
              renamePattern,
              confidenceScore: 1.0,
              cleanCopyStatus: "pending",
              datasetRowStatus: "pending",
              cleanFilename: undefined,
              datasetId: undefined
            };
          }
          return p;
        });
      });

      setActiveBatchJob(prev => {
        if (!prev) return null;
        const job = {
          ...prev,
          blocked: Math.max(0, prev.blocked - 1),
          completed: prev.completed + 1,
          updatedAt: new Date().toISOString()
        };
        axios.post("/api/pipeline/batch-job", { ...job, items: updatedItems });
        return job;
      });

      setBlockedDetails(prev => {
        const c = { ...prev };
        delete c[item.url];
        return c;
      });
      setSelectedBatchItemId(null);

      toast.success(`Successfully resolved and approved classification!`);
      setIsBatchJobRunning(true);
    } catch (e: any) {
      toast.error(`Resolution exception: ${e.message}`);
    }
  };

  // Reactive automated batch loop
  useEffect(() => {
    if (!isBatchJobRunning || !activeBatchJob) return;

    let isSubscribed = true;
    
    const runNext = async () => {
      if (batchJobItems.some(item => item.status === "running")) {
        return; // Wait for current item to finish
      }

      const nextIndex = batchJobItems.findIndex(item => item.status === "queued");
      if (nextIndex === -1) {
        const hasBlocked = batchJobItems.some(item => item.status === "blocked");
        const finalStatus = hasBlocked ? "completed_with_blocks" as const : "completed" as const;
        const finalJob = {
          ...activeBatchJob,
          status: finalStatus,
          pending: 0,
          updatedAt: new Date().toISOString()
        };
        
        if (isSubscribed) {
          setActiveBatchJob(finalJob);
          setIsBatchJobRunning(false);
          toast.success(`Batch processing completed successfully! Status: ${finalStatus}`);
          await axios.post("/api/pipeline/batch-job", { ...finalJob, items: batchJobItems });
        }
        return;
      }

      const item = batchJobItems[nextIndex];
      const updated = [...batchJobItems];
      updated[nextIndex] = { ...item, status: "running", currentStep: "download" };
      setBatchJobItems(updated);
      
      try {
        await new Promise(r => setTimeout(r, 2500)); // Rate limit protection
        await processBatchItem(nextIndex, item);
      } catch (err: any) {
        console.error("Item crash in batch runner:", item.url, err);
        if (isSubscribed) {
          const failedItems = [...batchJobItems];
          failedItems[nextIndex] = {
            ...item,
            status: "failed",
            currentStep: "done",
            blockReason: err.message || "Failed during pipeline run steps"
          };
          setBatchJobItems(failedItems);
          setActiveBatchJob(prev => {
            if (!prev) return null;
            return {
              ...prev,
              pending: Math.max(0, prev.pending - 1),
              failed: prev.failed + 1,
              updatedAt: new Date().toISOString()
            };
          });
        }
      }
    };

    runNext();

    return () => {
      isSubscribed = false;
    };
  }, [isBatchJobRunning, batchJobItems, activeBatchJob]);

  // Load active or saved batch jobs on mount
  useEffect(() => {
    const loadSavedJobs = async () => {
      try {
        const res = await axios.get("/api/pipeline/batch-jobs");
        const jobs: BatchJob[] = res.data || [];
        if (jobs.length > 0) {
          const activeJob = jobs.find(j => j.status === "running" || j.status === "paused" || j.status === "queued") || jobs[0];
          if (activeJob) {
            const fullJobRes = await axios.get(`/api/pipeline/batch-job/${activeJob.id}`);
            const fullJob = fullJobRes.data;
            if (fullJob) {
              setActiveBatchJob({
                id: fullJob.id,
                name: fullJob.name,
                scope: fullJob.scope,
                totalItems: fullJob.totalItems,
                pending: fullJob.pending,
                running: fullJob.running,
                completed: fullJob.completed,
                blocked: fullJob.blocked,
                failed: fullJob.failed,
                skipped: fullJob.skipped,
                status: fullJob.status === "running" ? "paused" : fullJob.status,
                createdAt: fullJob.createdAt,
                updatedAt: fullJob.updatedAt,
                processedItems: fullJob.processedItems || 0
              });
              setBatchJobItems(fullJob.items || []);
              
              const newBlockedDetails: Record<string, BlockedItemDetails> = {};
              (fullJob.items || []).forEach((item: any) => {
                if (item.status === "blocked") {
                  newBlockedDetails[item.url] = {
                    blockReason: item.blockReason || "low_confidence_classification",
                    explanation: "Reloaded from persistent session.",
                    suggestedActions: ["Verify Moroccan curricular metadata and resolve below."],
                    candidateGrades: dictionary.grades || [],
                    candidateSubjects: dictionary.subjects || [],
                    candidateTopics: dictionary.topics || [],
                    candidateDocumentTypes: dictionary.allowedDocumentTypes || [],
                    sourcePreview: item.url
                  };
                }
              });
              setBlockedDetails(newBlockedDetails);
            }
          }
        }
      } catch (err) {
        console.warn("Could not reload active batch job context:", err);
      }
    };
    if (dictionary.grades && dictionary.grades.length > 0) {
      loadSavedJobs();
    }
  }, [dictionary]);

  const fetchDictionary = async () => {
    setLoadingDictionary(true);
    try {
      const res = await axios.get("/api/dictionary");
      setDictionary(res.data);
    } catch (e) {
      console.error("Failed to load reference dictionary", e);
      toast.error("Failed to fetch classification reference dictionary.");
    } finally {
      setLoadingDictionary(false);
    }
  };

  const handleCrawlPdfs = async () => {
    if (!crawlUrl) {
      toast.error("Target Crawl URL is required.");
      return;
    }

    setIsCrawling(true);
    setCrawledPdfs([]);
    setSelectedCrawled([]);
    toast.info("Site mapping & Link resolution phase active. Restructuring site hierarchy...");

    try {
      // Use the newly engineered Site Map Crawl endpoint
      const res = await axios.post("/api/site-map/crawl", {
        url: crawlUrl,
        maxPages,
        maxDepth: maxDepth || 3,
        topicFilter,
        fresh: true
      });

      let nodes = [];
      if (Array.isArray(res.data)) {
        nodes = res.data;
      } else if (res.data && Array.isArray(res.data.nodes)) {
        nodes = res.data.nodes;
      }
      setSiteMapNodes(nodes);

      // Filter only nodes that are detected as verified final assets as requested In Task 2,7
      const urls: string[] = Array.from(new Set(
        nodes
          .filter((n: any) => n.is_final_asset)
          .map((n: any) => n.canonical_url)
      ));

      setCrawledPdfs(urls);
      setSelectedCrawled(urls); // Selected by default

      toast.success(`Site mapping finished! disovered ${nodes.length} nodes, including ${urls.length} final assets.`);
    } catch (e: any) {
      console.error(e);
      toast.error(e.response?.data?.error || "Site crawling and structure mapping failed.");
    } finally {
      setIsCrawling(false);
    }
  };

  const handleUpdateSiteMapNode = async (id: string, updates: any) => {
    try {
      const res = await axios.post("/api/site-map/update-node", { id, updates });
      if (res.data && res.data.success) {
        setSiteMapNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
        const node = siteMapNodes.find(n => n.id === id);
        const role = updates.page_role || node?.page_role;
        const links = updates.discovered_links_count ?? node?.discovered_links_count ?? 0;
        
        if (role === "pdf_asset") {
           toast.success("PDF asset staged for Intake");
        } else if (role === "crawl_children") {
           toast.success(`Page saved \u2014 ${links} links discovered`);
        } else if (role === "hub_page") {
           toast.success("Hub page saved for crawl only");
        } else {
           toast.success("Site map node saved.");
        }
      }
    } catch (e: any) {
      toast.error("Failed to update site map node.");
    }
  };

  const handleAiCleanSiteMap = async () => {
    setIsAiCleaning(true);
    const resolveToast = toast.loading("AI is cleaning and organizing results...");
    try {
      const res = await axios.post("/api/site-map/ai-clean");
      if (res.data) {
        setSiteMapNodes(res.data);
        const autoSelected = Array.from(new Set(
          (res.data as any[])
            .filter(n => n.is_final_asset)
            .map(n => n.canonical_url)
        ));
        setCrawledPdfs(autoSelected as string[]);
        setSelectedCrawled(autoSelected as string[]);
        toast.success("AI Cleanup completed successfully", { id: resolveToast });
      }
    } catch (e: any) {
      toast.error("Failed to run AI cleanup.", { id: resolveToast });
    } finally {
      setIsAiCleaning(false);
    }
  };

  const handleClearSiteMap = async () => {
    try {
      await axios.post("/api/site-map/clear");
      setSiteMapNodes([]);
      setCrawledPdfs([]);
      setSelectedCrawled([]);
      toast.success("Site map cleared.");
    } catch (e: any) {
      toast.error("Failed to clear site map.");
    }
  };

  const handleStageUrlsWithMetadata = (assets: Array<{ url: string; grade: string; subject: string; topic: string; docType: string }>) => {
    if (assets.length === 0) {
      toast.error("No assets provided to stage.");
      return;
    }

    const initialStagedList = [...stagedPdfs];
    let newlyStagedCount = 0;

    assets.forEach(asset => {
      const exists = initialStagedList.some(s => s.url === asset.url);
      if (exists) return;

      const segments = asset.url.split(/[?#]/)[0].split("/").filter(Boolean);
      let baseOriginal = segments.length > 0 ? segments[segments.length - 1] : "scraped_document.pdf";
      try { baseOriginal = decodeURIComponent(baseOriginal); } catch {}
      
      const gradeId = asset.grade ? asset.grade.toLowerCase() : "1ac";
      const subjectId = asset.subject ? asset.subject.toLowerCase() : "math";
      const docTypeSegment = asset.docType || "Cours";
      const cleanTopic = asset.topic || "Topic";

      const gSegment = gradeId.toUpperCase();
      const sSegment = subjectId === "math" ? "Math" : subjectId === "pc" ? "PC" : subjectId === "svt" ? "SVT" : "French";
      const sourceSegment = asset.url.includes("talamidi") ? "Talamidi" : "Moutamadris";
      
      const baseFilename = `${gSegment}_${sSegment}_${cleanTopic.replace(/[\s\-_]+/g, "-")}_${docTypeSegment}_${sourceSegment}.pdf`.replace(/^[-_\s]+/, "");

      const newItem: any = {
        url: asset.url,
        originalName: decodeURIComponent(baseOriginal),
        status: "pending",
        assetType: asset.url.toLowerCase().split(/[?#]/)[0].endsWith(".pdf") ? "pdf" : "html_lesson",
        gradeId: gradeId,
        subjectId: subjectId,
        topicId: cleanTopic,
        documentTypeId: docTypeSegment,
        cleanTitle: cleanTopic,
        renamePattern: baseFilename,
        reason: "Pre-mapped from site crawl",
        rawText: null,
        isMatch: true,
        extractionStatus: "pending",
        ocrStatus: "not_needed",
        cleanCopyStatus: "pending",
        datasetRowStatus: "pending"
      };

      initialStagedList.push(newItem);
      newlyStagedCount++;
    });

    setStagedPdfs(initialStagedList);
    toast.success(`Staging finished! Staged ${newlyStagedCount} new final assets with complete grade & subject hierarchy.`);
  };

  const handleStageSelectedCrawled = async () => {
    if (selectedCrawled.length === 0) {
      toast.error("Please tick at least one crawled PDF link to stage.");
      return;
    }

    const uniqueToStage = selectedCrawled.filter(url => !stagedPdfs.some(item => item.url === url));
    const report = await stagePdfUrlsAsync(uniqueToStage, { autoSelect: true });

    setTimeout(() => {
      const el = document.getElementById("pdf-classification-workspace-card");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);

    toast.success(`Processing finished! Staged ${report.staged} new PDFs. ${report.duplicates} duplicates/skipped.`);
    if (report.staged > 0) {
      setShowReadyBanner(true);
    }
  };

  // Perform Local Workstation Pipeline process step
  const handlePipelineProcessSingle = async (index: number) => {
    const item = stagedPdfs[index];
    if (!item) return;

    setStagedPdfs(prev => prev.map((p, i) => i === index ? { ...p, status: "classifying", extractionStatus: "pending" } : p));
    toast.info(`Downloading & extracting: ${item.originalName}`);

    try {
      // Step 1: Download & Parse
      const parseRes = await axios.post("/api/pipeline/parse", {
        url: item.url,
        title: item.originalName,
        topicFilter
      });

      const pData = parseRes.data;
      if (!pData.success) {
        setStagedPdfs(prev => prev.map((p, i) => i === index ? {
          ...p,
          status: pData.status || "failed",
          pipelineStep: pData.pipelineStep || "extract",
          blockReason: pData.blockReason || "unknown_failure",
          reason: pData.reason || "Extraction step failed",
          technicalError: pData.technicalError || "",
          gradeId: pData.metadata?.gradeId || pData.metadata?.gradeHint || p.gradeId,
          subjectId: pData.metadata?.subjectId || pData.metadata?.subjectHint || p.subjectId,
          topicId: pData.metadata?.topicId || pData.metadata?.topicHint || p.topicId,
          documentTypeId: pData.metadata?.documentTypeId || pData.metadata?.documentTypeHint || p.documentTypeId,
          cleanTitle: pData.cleanTitle || p.cleanTitle,
          renamePattern: pData.renamePattern || p.renamePattern,
          isMatch: false,
          rawText: pData.metadata?.rawText || p.rawText
        } : p));
        toast.error(`Extraction failed: ${pData.reason}`);
        fetchPipelineStats();
        return;
      }

      // Update with extraction details
      setStagedPdfs(prev => prev.map((p, i) => i === index ? {
        ...p,
        hash: pData.hash,
        rawText: pData.textSnippet,
        textLength: pData.textLength,
        textQualityScore: pData.textQualityScore,
        needsOcr: pData.needsOcr,
        ocrStatus: pData.ocrStatus,
        extractionStatus: pData.extractionStatus,
        pdfTextType: pData.pdfTextType,
        gradeId: pData.metadata?.gradeId || p.gradeId,
        subjectId: pData.metadata?.subjectId || p.subjectId,
        topicId: pData.metadata?.topicId || p.topicId,
        documentTypeId: pData.metadata?.documentTypeId || p.documentTypeId,
        cleanTitle: pData.cleanTitle || p.cleanTitle,
        renamePattern: pData.renamePattern || p.renamePattern
      } : p));

      // Step 2: Classify strictly against reference dictionary
      toast.info(`Classifying metadata: ${item.originalName}`);
      const classifyRes = await axios.post("/api/classify", {
        title: item.originalName,
        url: item.url,
        text: pData.textSnippet || "",
        topicFilter
      });

      const cData = classifyRes.data;
      
      setStagedPdfs(prev => prev.map((p, i) => {
        if (i !== index) return p;
        let finalStatus: any = "rejected";
        if (cData.isMatch) {
          finalStatus = "classified";
        } else if (cData.needsReview) {
          finalStatus = "needs_review";
        } else if (cData.status) {
          finalStatus = cData.status;
        }
        return {
          ...p,
          status: finalStatus,
          pipelineStep: cData.pipelineStep || "classify",
          blockReason: cData.blockReason || "",
          gradeId: cData.gradeId || cData.metadata?.gradeId || p.gradeId,
          subjectId: cData.subjectId || cData.metadata?.subjectId || p.subjectId,
          topicId: cData.topicId || cData.metadata?.topicId || p.topicId,
          documentTypeId: cData.documentTypeId || cData.metadata?.documentTypeId || p.documentTypeId,
          cleanTitle: cData.cleanTitle || cData.metadata?.cleanFilename || p.cleanTitle,
          renamePattern: cData.renamePattern || p.renamePattern,
          reason: cData.reason,
          isMatch: !!cData.isMatch,
          confidenceScore: cData.confidenceScore,
          matchedTerms: cData.matchedTerms,
          matchedFields: cData.matchedFields
        };
      }));

      toast.success(`Pipeline success: ${cData.cleanTitle || item.originalName}`);
      fetchPipelineStats(); // refresh counts
    } catch (err: any) {
      console.error(err);
      setStagedPdfs(prev => prev.map((p, i) => i === index ? {
        ...p,
        status: "failed",
        pipelineStep: "system",
        blockReason: "exception",
        reason: err.message || "Failed at pipeline parse/classify"
      } : p));
      toast.error(`Processing error: ${err.message}`);
    }
  };

  const handleClassifySingle = async (index: number) => {
    await handlePipelineProcessSingle(index);
  };

  const handleRunOcr = async (index: number) => {
    const item = stagedPdfs[index];
    if (!item || !item.hash) {
      toast.error("Please run baseline extraction/parse first to compute file hash!");
      return;
    }

    setStagedPdfs(prev => prev.map((p, i) => i === index ? { ...p, ocrStatus: "running" } : p));
    toast.info(`Running Gemini OCR vision analysis on: ${item.originalName}`);

    try {
      const res = await axios.post("/api/pipeline/ocr", { hash: item.hash });
      const data = res.data;
      if (data.success) {
        setStagedPdfs(prev => prev.map((p, i) => i === index ? {
          ...p,
          ocrStatus: "done",
          extractionStatus: "ocr_done",
          rawText: data.ocrTextSnippet,
          textLength: data.ocrTextLength,
          textQualityScore: 100
        } : p));
        toast.success("OCR completed successfully!");
        fetchPipelineStats();
      } else {
        throw new Error(data.error || "OCR failed");
      }
    } catch (err: any) {
      console.error(err);
      setStagedPdfs(prev => prev.map((p, i) => i === index ? { ...p, ocrStatus: "failed" } : p));
      toast.error(`OCR failed: ${err.message}`);
    }
  };

  const handleBuildCleanCopy = async (index: number) => {
    const item = stagedPdfs[index];
    if (!item || !item.hash) {
      toast.error("Process the file structure and obtain a valid file hash first!");
      return;
    }
    if (!item.gradeId || !item.subjectId || !item.topicId || !item.documentTypeId) {
      toast.error("Classification metadata (Grade, Subject, Topic, Type) must be set before copy building!");
      return;
    }

    setStagedPdfs(prev => prev.map((p, i) => i === index ? { ...p, cleanCopyStatus: "building", datasetRowStatus: "saving" } : p));
    toast.info(`Generating clean stamped PDF & dataset row: ${item.originalName}`);

    try {
      const res = await axios.post("/api/pipeline/clean-copy", {
        hash: item.hash,
        gradeId: item.gradeId,
        subjectId: item.subjectId,
        topicId: item.topicId,
        documentTypeId: item.documentTypeId,
        title: item.cleanTitle || item.originalName,
        url: item.url,
        text: item.rawText || "",
        levelspace: item.levelspace
      });

      const data = res.data;
      if (data.success) {
        setStagedPdfs(prev => prev.map((p, i) => i === index ? {
          ...p,
          cleanCopyStatus: "success",
          datasetRowStatus: "success",
          cleanFilename: data.cleanName,
          datasetId: data.datasetId
        } : p));
        toast.success(`Generated: ${data.cleanName}`);
        
        // Auto-sync built clean PDF to Google Drive in background
        triggerAutoSyncIfEnabled("clean-pdfs", data.cleanName, `clean-pdfs/${data.cleanName}`);
        if (data.rawName) {
           triggerAutoSyncIfEnabled("downloads", data.rawName, `downloads/${data.rawName}`);
        }
        
        fetchPipelineStats();
      } else {
        throw new Error(data.error || "Clean copy failure");
      }
    } catch (err: any) {
      console.error(err);
      setStagedPdfs(prev => prev.map((p, i) => i === index ? { ...p, cleanCopyStatus: "failed", datasetRowStatus: "failed" } : p));
      toast.error(`Clean copy failed: ${err.message}`);
    }
  };

  const handleBuildCleanCopiesForSelected = async () => {
    const selectedIndices: number[] = [];
    const targetUrls = selectedPdfUrls.length > 0 ? selectedPdfUrls : stagedPdfs.filter(p => p.status === "classified").map(p => p.url);
    stagedPdfs.forEach((p, idx) => {
      if (targetUrls.includes(p.url)) {
        selectedIndices.push(idx);
      }
    });

    if (selectedIndices.length === 0) {
      toast.warning("No valid classified PDFs available to build.");
      return;
    }

    toast.info(`Starting target jobs for ${selectedIndices.length} items.`);
    for (const idx of selectedIndices) {
      const item = stagedPdfs[idx];
      if (item.status === "classified" || item.status === "needs_review") {
        await handleBuildCleanCopy(idx);
      }
    }
    toast.success("Finished building clean copies for selected files!");
  };

  const handleDownloadCleanPdf = (hash?: string) => {
    if (!hash) {
      toast.error("File hash is required to locate the clean copy download.");
      return;
    }
    window.location.assign(`/api/pipeline/download-clean/${hash}`);
  };

  const handleOpenCleanText = (hash?: string) => {
    if (!hash) {
      toast.error("File hash is required to locate the clean text copy.");
      return;
    }
    window.location.assign(`/api/pipeline/clean-text/${hash}`);
  };

  const handleExportDatasetJsonl = () => {
    window.location.assign("/api/pipeline/export-jsonl");
  };

  const handleExportReport = async () => {
    try {
      const res = await axios.get("/api/pipeline/reports");
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `workstation_pipeline_report_${Date.now()}.json`;
      link.click();
      toast.success("Auditing pipeline report exported!");
    } catch (e: any) {
      toast.error(`Report export failed: ${e.message}`);
    }
  };

  const handleBulkSelect = (type: "all" | "classified" | "needs_review" | "ocr_needed" | "clear") => {
    if (type === "clear") {
      setSelectedPdfUrls([]);
      toast.info("Cleared all selections.");
      return;
    }

    let targetUrls: string[] = [];
    if (type === "all") {
      targetUrls = stagedPdfs.map(p => p.url);
      toast.info(`Selected all ${targetUrls.length} staged PDFs.`);
    } else if (type === "classified") {
      targetUrls = stagedPdfs.filter(p => p.status === "classified").map(p => p.url);
      toast.info(`Selected ${targetUrls.length} Classified PDFs.`);
    } else if (type === "needs_review") {
      targetUrls = stagedPdfs.filter(p => p.status === "needs_review").map(p => p.url);
      toast.info(`Selected ${targetUrls.length} Needs Review PDFs.`);
    } else if (type === "ocr_needed") {
      targetUrls = stagedPdfs.filter(p => p.extractionStatus === "needs_ocr" || p.ocrStatus === "needed").map(p => p.url);
      toast.info(`Selected ${targetUrls.length} OCR Needed PDFs.`);
    }

    setSelectedPdfUrls(targetUrls);
  };

  const handleRunOcrForSelected = async () => {
    if (selectedPdfUrls.length === 0) {
      toast.warning("Select at least one staged PDF first.");
      return;
    }

    const matchedFiles = stagedPdfs.filter(p => selectedPdfUrls.includes(p.url));
    const itemsToOcr = matchedFiles.filter(p => p.hash && (p.extractionStatus === "needs_ocr" || p.ocrStatus === "needed"));
    const cleanFilesCount = matchedFiles.length - itemsToOcr.length;

    if (itemsToOcr.length === 0) {
      toast.warning(`Skipped all ${matchedFiles.length} selected files because they are clean-text PDFs or don't have valid hashes yet. (Only needs-OCR PDFs enter the queue).`);
      return;
    }

    toast.info(`Sending ${itemsToOcr.length} qualified OCR-needed files to the Controlled Queue. (Skipped ${cleanFilesCount} clean-text files).`);

    try {
      const response = await fetch("/api/pipeline/ocr/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: itemsToOcr.map(p => ({
            hash: p.hash,
            title: p.cleanTitle || p.originalName || "PDF " + p.hash.substring(0, 8),
            url: p.url
          }))
        })
      });
      const data = await response.json();
      if (data.success) {
        toast.success(`Successfully enqueued ${itemsToOcr.length} files to OCR async controlled queue! Check status in the panel below.`);
      } else {
        toast.error("Failed to enqueue OCR jobs: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      toast.error("Network error enqueuing OCR jobs: " + err.message);
    }
  };

  const handleExportSelected = () => {
    const activeSelected = stagedPdfs.filter(p => selectedPdfUrls.includes(p.url));
    if (activeSelected.length === 0) {
      toast.warning("Select at least one staged PDF first.");
      return;
    }
    const dataStr = JSON.stringify(activeSelected, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `selected_workstation_export_${Date.now()}.json`;
    link.click();
    toast.success("Successfully exported selected staged PDFs records!");
  };

  const validateBatchScopeAgainstDetectedInventory = (items: StagedPdf[]): { valid: boolean; error?: string } => {
    if (!topicFilter || topicFilter.trim().length === 0) {
      return { valid: true };
    }

    // Resolve filter(s) against local dictionary topics
    const filterTokens = topicFilter.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
    const matchedTopics = (dictionary.topics || []).filter(t => {
      const matchInId = filterTokens.includes(t.id?.toLowerCase() || "");
      const matchInSuffix = filterTokens.includes(t.suffix?.toLowerCase() || "");
      const matchInNameFr = filterTokens.some(tok => (t.nameFr || "").toLowerCase().includes(tok) || tok.includes((t.nameFr || "").toLowerCase()));
      const matchInNameAr = filterTokens.some(tok => (t.nameAr || "").toLowerCase().includes(tok) || tok.includes((t.nameAr || "").toLowerCase()));
      const matchInKw = (t.keywords || []).some(kw => filterTokens.some(tok => kw.toLowerCase().includes(tok) || tok.includes(kw.toLowerCase())));
      return matchInId || matchInSuffix || matchInNameFr || matchInNameAr || matchInKw;
    });

    if (matchedTopics.length === 0) {
      return { valid: true };
    }

    const matchedSubjectIds = Array.from(new Set(matchedTopics.map(t => t.subjectId).filter(Boolean)));

    // Detect apparent subjects of the incoming items
    let pendingCount = 0;
    let mathCount = 0;
    let pcCount = 0;
    let svtCount = 0;
    let frenchCount = 0;

    items.forEach(p => {
      const combined = `${p.url} ${p.originalName}`.toLowerCase();
      pendingCount++;
      if (combined.includes("math") || combined.includes("رياضيات") || combined.includes("الرياضيات")) {
        mathCount++;
      }
      if (combined.includes("physique") || combined.includes("chimie") || combined.includes(" pc ") || combined.includes("pc_") || combined.includes("_pc") || combined.includes("فيزياء")) {
        pcCount++;
      }
      if (combined.includes("svt") || combined.includes("علوم الحياة")) {
        svtCount++;
      }
      if (combined.includes("francais") || combined.includes("français") || combined.includes("french") || combined.includes("الفرنسية")) {
        frenchCount++;
      }
    });

    if (pendingCount === 0) return { valid: true };

    let apparentSubject = "";
    let maxCount = 0;
    if (mathCount > maxCount) { apparentSubject = "math"; maxCount = mathCount; }
    if (pcCount > maxCount) { apparentSubject = "pc"; maxCount = pcCount; }
    if (svtCount > maxCount) { apparentSubject = "svt"; maxCount = svtCount; }
    if (frenchCount > maxCount) { apparentSubject = "french"; maxCount = frenchCount; }

    if (!apparentSubject) return { valid: true };

    const subjectMatch = matchedSubjectIds.includes(apparentSubject);
    if (!subjectMatch) {
      const topicNames = matchedTopics.map(t => t.nameFr).join(", ");
      const filterStr = filterTokens.join(", ");
      const apparentSubjectName = apparentSubject === "math" ? "Math" : apparentSubject === "pc" ? "Physique Chimie" : apparentSubject === "svt" ? "SVT" : "Français";
      const actualSubjectOfTopic = matchedSubjectIds.map(sid => {
        const found = (dictionary.subjects || []).find(s => s.id === sid);
        return found ? found.nameFr : sid;
      }).join(", ");

      return {
        valid: false,
        error: `Topic filter '${filterStr}' maps to ${actualSubjectOfTopic} (${topicNames}), but current batch appears to be ${apparentSubjectName}. Clear filter or choose ${apparentSubjectName} topic.`
      };
    }

    return { valid: true };
  };

  const handleClassifyAllPending = async () => {
    const queue = stagedPdfs.filter(p => p.status === "pending" || p.status === "failed");
    if (queue.length === 0) {
      toast.info("No pending or failed PDFs to process.");
      return;
    }

    const preflight = validateBatchScopeAgainstDetectedInventory(queue);
    if (!preflight.valid) {
      toast.error(preflight.error);
      return;
    }

    setIsClassifyingAll(true);
    toast.info("Sequential classification queue starting. This respects API boundaries...");

    try {
      for (let i = 0; i < stagedPdfs.length; i++) {
        if (stagedPdfs[i].status === "pending" || stagedPdfs[i].status === "failed") {
          await handlePipelineProcessSingle(i);
        }
      }
      toast.success("Classification pipeline execution finished!");
    } catch (e) {
      console.error(e);
    } finally {
      setIsClassifyingAll(false);
    }
  };

  const handleProcessAllVisiblePending = async () => {
    const visiblePending = filteredStaged.filter(p => p.status === "pending" || p.status === "failed");
    if (visiblePending.length === 0) {
      toast.info("No visible pending or failed PDFs to process.");
      return;
    }

    const preflight = validateBatchScopeAgainstDetectedInventory(visiblePending);
    if (!preflight.valid) {
      toast.error(preflight.error);
      return;
    }

    setIsProcessAllVisibleRunning(true);
    toast.info(`Starting batch classification for ${visiblePending.length} visible pending PDFs...`);

    try {
      for (const item of visiblePending) {
        const realIndex = stagedPdfs.findIndex(p => p.url === item.url);
        if (realIndex !== -1) {
          await handlePipelineProcessSingle(realIndex);
        }
      }
      toast.success("Completed processing all visible pending/failed PDFs!");
    } catch (e: any) {
      console.error(e);
      toast.error(`Error processing visible PDFs: ${e.message}`);
    } finally {
      setIsProcessAllVisibleRunning(false);
    }
  };

  const handleRepairWorkspaceState = () => {
    // 1. remove duplicate staged PDFs by URL
    const uniqueStaged: StagedPdf[] = [];
    const seenUrls = new Set<string>();
    stagedPdfs.forEach(p => {
      const urlNormal = p.url.trim();
      if (!seenUrls.has(urlNormal)) {
        seenUrls.add(urlNormal);
        uniqueStaged.push(p);
      }
    });

    // 2. remove selected URLs that do not exist in the repaired stagedPdfs list
    const validStagedUrls = new Set(uniqueStaged.map(p => p.url));
    const repairedSelected = selectedPdfUrls.filter(url => validStagedUrls.has(url));

    // 3. reset filters to all
    setFilterStatus("all");
    setFilterGrade("all");
    setFilterSubject("all");

    // 4. Update states & save
    setStagedPdfs(uniqueStaged);
    setSelectedPdfUrls(repairedSelected);
    
    toast.success("Workspace state repaired! Filters reset, duplicates removed, and selections sterilized.");
  };

  const handleManualOverride = (index: number, key: string, value: any) => {
    setStagedPdfs(prev => prev.map((p, i) => {
      if (i !== index) return p;
      const updated = { ...p, [key]: value };
      
      // Dynamically calculate renamePattern if suffixes can be resolved
      if (key === "gradeId" || key === "subjectId" || key === "topicId" || key === "documentTypeId" || key === "cleanTitle") {
        const gradeSuffix = dictionary.grades.find(g => g.id === (key === "gradeId" ? value : p.gradeId))?.suffix || "UNKNOWN";
        const subjectSuffix = dictionary.subjects.find(s => s.id === (key === "subjectId" ? value : p.subjectId))?.suffix || "UNKNOWN";
        const topicSuffix = p.topicId ? (dictionary.topics.find(t => t.id === (key === "topicId" ? value : p.topicId))?.suffix || "TOP") : "GEN";
        const docTypeSuffix = dictionary.allowedDocumentTypes.find(d => d.id === (key === "documentTypeId" ? value : p.documentTypeId))?.suffix || "DOC";
        const titleStr = (key === "cleanTitle" ? value : p.cleanTitle) || "document";
        updated.renamePattern = `${gradeSuffix}_${subjectSuffix}_${topicSuffix}_${docTypeSuffix}_${titleStr.replace(/\s+/g, "_")}.pdf`;
      }
      return updated;
    }));
  };

  // Merge selected classified PDFs
  const handleMergeSelected = async (urlsToMerge: string[] = selectedPdfUrls, outputFilename: string = customMergeName) => {
    if (urlsToMerge.length === 0) {
      toast.warning("Select at least one staged PDF first.");
      return;
    }
    if (urlsToMerge.length < 2) {
      toast.error("Please choose at least 2 classified PDFs to combine/merge.");
      return;
    }

    setIsCombining(true);
    toast.info(`Fetching and combining ${urlsToMerge.length} PDFs locally. Please wait...`);

    try {
      const res = await axios.post("/api/combine-pdfs", { urls: urlsToMerge }, { responseType: "blob" });
      const fileBlob = new Blob([res.data], { type: "application/pdf" });
      const filename = `${outputFilename.replace(/\s+/g, "_")}.pdf`;
      
      const { saveAs } = await import("file-saver");
      saveAs(fileBlob, filename);
      toast.success(`PDF combined successfully! Output saved as: ${filename}`);
    } catch (err: any) {
      console.error(err);
      toast.error("PDF combination failed on backend.");
    } finally {
      setIsCombining(false);
    }
  };

  // Download all files in a single systematically named zip
  const handleZipDownloadSelected = async () => {
    setIsDownloadingZip(true);
    toast.info("Preparing comprehensive Levelspace-ready archive from server...");

    try {
      const res = await axios.get("/api/pipeline/export-zip", { responseType: "blob" });
      const { saveAs } = await import("file-saver");
      saveAs(res.data, `levelspace_ready_outputs_${Date.now()}.zip`);
      toast.success("Successfully downloaded Levelspace-ready archive containing original copies, clean PDFs, clean text assets, dataset rows, and reports!");
    } catch (err: any) {
      console.error(err);
      toast.error("Zipping procedure fell through: " + (err?.message || "Failed to download ZIP"));
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const [isIndexingRunning, setIsIndexingRunning] = useState(false);

  const handleRunIndexingJob = async () => {
    const toIndex = stagedPdfs.filter(p => !p.levelspace?.index_status && p.status === "classified");
    if (toIndex.length === 0) {
      toast.warning("No un-indexed classified PDFs available.");
      return;
    }
    
    setIsIndexingRunning(true);
    let count = 0;
    toast.info(`Starting Levelspace Indexing Job for ${toIndex.length} items...`);
    
    for (const item of toIndex) {
      try {
        const idxStr = count > 0 ? ` (${count+1}/${toIndex.length})` : '';
        toast.info(`Indexing: ${item.originalName}${idxStr}`);
        const res = await axios.post("/api/pipeline/index-levelspace", {
          url: item.url,
          filename: item.originalName,
          text: item.rawText,
          hints: {
            gradeId: item.gradeId,
            subjectId: item.subjectId,
            topicId: item.topicId,
            documentTypeId: item.documentTypeId
          }
        });
        
        if (res.data?.success && res.data.levelspace) {
          setStagedPdfs(prev => prev.map(p => 
            p.url === item.url ? { ...p, levelspace: res.data.levelspace } : p
          ));
        } else {
          setStagedPdfs(prev => prev.map(p => 
            p.url === item.url ? { ...p, levelspace: { index_status: "blocked", index_reason: "API error", curriculum_confidence: 0 } as any } : p
          ));
        }
      } catch (err) {
        console.error("Index error", err);
        setStagedPdfs(prev => prev.map(p => 
          p.url === item.url ? { ...p, levelspace: { index_status: "failed", index_reason: "Network error", curriculum_confidence: 0 } as any } : p
        ));
      }
      count++;
    }
    
    setIsIndexingRunning(false);
    toast.success("Levelspace Indexing Job complete.");
  };

  const handleExportJsonReport = () => {
    if (stagedPdfs.length === 0) {
      toast.error("No active staged documents to create report from.");
      return;
    }

    const docData = JSON.stringify(stagedPdfs, null, 2);
    const blob = new Blob([docData], { type: "application/json" });
    
    import("file-saver").then(({ saveAs }) => {
      saveAs(blob, `school_staged_scrapes_report_${Date.now()}.json`);
      toast.success("Classification metadata analysis report exported successfully!");
    });
  };

  // Group items by category to make it extremely easy to merge matching sets of lessons/exercises!
  const groupedClassified = stagedPdfs.reduce((acc, item) => {
    if (item.status !== "classified" || !item.isMatch) return acc;
    const key = `${item.gradeId || "unknown"}_${item.subjectId || "unknown"}_${item.topicId || "general"}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, StagedPdf[]>);

  // Manage reference dictionary additions
  const handleAddGrade = () => {
    if (!newGrade.id || !newGrade.nameAr || !newGrade.suffix) {
      toast.error("Grade ID, Arabic name, and unique suffix are mandatory.");
      return;
    }
    const keywordsArr = newGrade.keywords.split(",").map(k => k.trim()).filter(Boolean);
    const updated = {
      ...dictionary,
      grades: [...dictionary.grades, { ...newGrade, keywords: keywordsArr }]
    };
    setDictionary(updated);
    setNewGrade({ id: "", nameAr: "", nameFr: "", suffix: "", keywords: "" });
    toast.success("Grade added locally. Commit changes to save permanently.");
  };

  const handleAddSubject = () => {
    if (!newSubject.id || !newSubject.nameAr || !newSubject.suffix) {
      toast.error("Subject ID, Arabic name, and suffix are mandatory.");
      return;
    }
    const keywordsArr = newSubject.keywords.split(",").map(k => k.trim()).filter(Boolean);
    const updated = {
      ...dictionary,
      subjects: [...dictionary.subjects, { ...newSubject, keywords: keywordsArr }]
    };
    setDictionary(updated);
    setNewSubject({ id: "", nameAr: "", nameFr: "", suffix: "", keywords: "" });
    toast.success("Subject added locally.");
  };

  const handleAddTopic = () => {
    if (!newTopic.id || !newTopic.nameAr || !newTopic.subjectId) {
      toast.error("Topic ID, Arabic name, and Subject ownership are mandatory.");
      return;
    }
    const keywordsArr = newTopic.keywords.split(",").map(k => k.trim()).filter(Boolean);
    const updated = {
      ...dictionary,
      topics: [...dictionary.topics, { ...newTopic, keywords: keywordsArr }]
    };
    setDictionary(updated);
    setNewTopic({ id: "", nameAr: "", nameFr: "", suffix: "", subjectId: "", keywords: "" });
    toast.success("Topic added locally.");
  };

  const handleCommitDictionaryToDb = async () => {
    setSavingDictionary(true);
    try {
      await axios.post("/api/dictionary", dictionary);
      toast.success("Supabase Reference Dictionary synchronized & committed successfully!");
    } catch (e) {
      console.error(e);
      toast.error("Dictionary database commit failed.");
    } finally {
      setSavingDictionary(false);
    }
  };

  // Filtered staged list
  const filteredStaged = stagedPdfs.filter(pdf => {
    if (filterStatus !== "all" && pdf.status !== filterStatus) return false;
    if (filterGrade !== "all" && pdf.gradeId !== filterGrade) return false;
    if (filterSubject !== "all" && pdf.subjectId !== filterSubject) return false;
    return true;
  });

  // Calculate dynamic counts for current filters and states
  const pendingCount = stagedPdfs.filter(p => p.status === "pending" || p.status === "failed").length;
  const processedCount = stagedPdfs.filter(p => p.status === "classified").length;
  const blockedCount = stagedPdfs.filter(p => p.status === "needs_review" || p.status === "rejected").length;
  const failedCount = stagedPdfs.filter(p => p.status === "failed").length;

  const renderNextActionPanel = () => {
    let nextActionTitle = "";
    let nextActionButtonLabel = "";
    let nextActionColor = "bg-neutral-800 hover:bg-neutral-700 text-white";
    let nextActionHandler = () => {};

    if (crawledPdfs.length === 0 && stagedPdfs.length === 0) {
      nextActionTitle = "Scan a URL or paste PDF links";
      nextActionButtonLabel = "Go to Intake";
      nextActionColor = "bg-blue-600 hover:bg-blue-700 text-white";
      nextActionHandler = () => setActiveJobView("intake");
    } else if (stagedPdfs.length > 0 && processedCount === 0 && activeBatchJob?.status !== "running") {
      nextActionTitle = "Run Batch Job to process PDFs";
      nextActionButtonLabel = "Go to Processing";
      nextActionColor = "bg-emerald-600 hover:bg-emerald-700 text-white";
      nextActionHandler = () => setActiveJobView("processing");
    } else if (blockedCount > 0) {
      nextActionTitle = "Review blocked items";
      nextActionButtonLabel = "Go to Review";
      nextActionColor = "bg-amber-605 hover:bg-amber-705 text-white";
      nextActionHandler = () => setActiveJobView("review");
    } else if (processedCount > 0 && pipelineStats.cleanCopies === 0) {
      nextActionTitle = "Build clean PDFs and outputs";
      nextActionButtonLabel = "Go to Output";
      nextActionColor = "bg-emerald-600 hover:bg-emerald-700 text-white";
      nextActionHandler = () => setActiveJobView("output");
    } else {
      nextActionTitle = "Export Dataset or Download ZIP";
      nextActionButtonLabel = "Go to Output";
      nextActionColor = "bg-purple-600 hover:bg-purple-700 text-white";
      nextActionHandler = () => setActiveJobView("output");
    }

    return (
      <div id="next-action-panel" className="bg-white border border-[#141414] shadow-none p-3 select-none flex flex-row items-center justify-between gap-4 font-mono text-[11px] leading-none shrink-0 w-full">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-neutral-800 uppercase tracking-wider">Next Recommended Action:</span>
          <span className="font-bold text-neutral-600">{nextActionTitle}</span>
        </div>
        <div>
          <Button
            onClick={nextActionHandler}
            className={`font-mono text-[10px] h-7 px-3 rounded-none uppercase transition-all ${nextActionColor}`}
          >
            {nextActionButtonLabel}
          </Button>
        </div>
      </div>
    );
  };

  // ===== NEW LAYOUT SUB-RENDERS =====

  const renderActiveJobView = () => {
    switch (activeJobView) {
      case "collector":
        return <CollectorJobView />;
      case "intake":
        return (
          <IntakeJobView
            stagedPdfs={stagedPdfs}
            hasDriveConnected={!!gdriveUser}
            crawlUrl={crawlUrl}
            setCrawlUrl={setCrawlUrl}
            discoverPastedUrls={discoverPastedUrls}
            setDiscoverPastedUrls={setDiscoverPastedUrls}
            maxPages={maxPages}
            setMaxPages={setMaxPages}
            maxDepth={maxDepth}
            setMaxDepth={setMaxDepth}
            topicFilter={topicFilter}
            setTopicFilter={setTopicFilter}
            isCrawling={isCrawling}
            isDiscovering={isDiscovering}
            handleCrawlPdfs={handleCrawlPdfs}
            handleDiscoverPdfs={handleDiscoverPdfs}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            crawledPdfs={crawledPdfs}
            selectedCrawled={selectedCrawled}
            setSelectedCrawled={setSelectedCrawled}
            handleStageSelectedCrawled={handleStageSelectedCrawled}
            discoveredResults={discoveredResults}
            selectedDiscovered={selectedDiscovered}
            setSelectedDiscovered={setSelectedDiscovered}
            handleIncorporateDiscovered={handleIncorporateDiscovered}
            showAdvancedStaging={showAdvancedStaging}
            setShowAdvancedStaging={setShowAdvancedStaging}
            crawledPdfsCount={crawledPdfs.length}
            selectedPdfUrlsCount={selectedPdfUrls.length}
            stagedPdfsCount={stagedPdfs.length}
            classifiedCount={stagedPdfs.filter(p => p.status === "classified").length}
            failedCount={stagedPdfs.filter(p => p.status === "failed").length}
            siteMapNodes={siteMapNodes}
            onUpdateSiteMapNode={handleUpdateSiteMapNode}
            onClearSiteMap={handleClearSiteMap}
            onAiClean={handleAiCleanSiteMap}
            isAiCleaning={isAiCleaning}
            onStageUrlsWithMetadata={handleStageUrlsWithMetadata}
          />
        );
      case "processing":
        return <ProcessorJobView />;
      case "indexing":
        return (
          <IndexingJobView
            stagedPdfs={stagedPdfs}
            isIndexingRunning={isIndexingRunning}
            handleRunIndexingJob={handleRunIndexingJob}
          />
        );
      case "review":
        return (
          <ReviewJobView
            stagedPdfs={stagedPdfs}
            dictionary={dictionary}
            handleResolveBlock={handleResolveBlock}
          />
        );
      case "output":
        return (
          <OutputJobView
            selectedPdfUrls={selectedPdfUrls}
            stagedPdfs={stagedPdfs}
            pipelineStats={pipelineStats}
            isCombining={isCombining}
            isDownloadingZip={isDownloadingZip}
            customMergeName={customMergeName}
            setCustomMergeName={setCustomMergeName}
            handleBuildCleanCopiesForSelected={handleBuildCleanCopiesForSelected}
            handleZipDownloadSelected={handleZipDownloadSelected}
            handleMergeSelected={handleMergeSelected}
            handleExportDatasetJsonl={handleExportDatasetJsonl}
            
            // Google Drive Integration Props
            gdriveUser={gdriveUser}
            onGdriveSignIn={handleGdriveSignIn}
            onGdriveSignOut={handleGdriveSignOut}
            isSyncingAll={isSyncingAll}
            handleSyncAllToDrive={handleSyncAllToDrive}
            gdriveAutoSync={gdriveAutoSync}
            setGdriveAutoSync={setGdriveAutoSync}
            isSyncingSingle={isSyncingSingle}
            handleSyncSingleToDrive={handleSyncSingleToDrive}
            handleGeminiSyncToDrive={handleGeminiSyncToDrive}
            updateManyPdfs={updateManyPdfs}
          />
        );
      case "reports":
        return (
          <ReportsJobView
            stagedPdfs={stagedPdfs}
            pipelineStats={pipelineStats}
            fetchPipelineStats={fetchPipelineStats}
          />
        );
      case "settings":
        return (
          <SettingsJobView
            dictionary={dictionary}
            activeDictSubTab={activeDictSubTab}
            setActiveDictSubTab={setActiveDictSubTab}
            ocrBatchMode={ocrBatchMode}
            handleApplyOcrModePreset={handleApplyOcrModePreset}
            newGrade={newGrade}
            setNewGrade={setNewGrade}
            newSubject={newSubject}
            setNewSubject={setNewSubject}
            newTopic={newTopic}
            setNewTopic={setNewTopic}
            handleAddGrade={handleAddGrade}
            handleAddSubject={handleAddSubject}
            handleAddTopic={handleAddTopic}
            handleCommitDictionaryToDb={handleCommitDictionaryToDb}
            savingDictionary={savingDictionary}
          />
        );
      default:
        return <div>Select a job view.</div>;
    }
  };

  const renderSidebar = () => {
    switch (activeJobView) {
      case "intake":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Intake Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Discover and crawl PDFs from educational web sources. Fetches links into the staging area.</p>
            </div>
            
            <div className="space-y-4">
              {/* Method Switch */}
              <div className="grid grid-cols-2 gap-1 bg-neutral-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("crawl")}
                  className={`text-[10px] uppercase py-1.5 text-center font-bold ${activeTab === "crawl" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
                >
                  Crawler
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("discover")}
                  className={`text-[10px] uppercase py-1.5 text-center font-bold ${activeTab === "discover" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"}`}
                >
                  Paste URLs
                </button>
              </div>

              {activeTab === "crawl" ? (
                <>
                  <div className="space-y-1">
                    <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Start URL</label>
                    <Input 
                      value={crawlUrl}
                      onChange={e => setCrawlUrl(e.target.value)}
                      placeholder="https://..."
                      className="rounded-none border-[#141414] text-[11px] h-8 bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Depth</label>
                      <select 
                        value={maxDepth}
                        onChange={e => setMaxDepth(Number(e.target.value))}
                        className="w-full border border-[#141414] h-8 text-xs font-mono px-2 rounded-none bg-white"
                      >
                        <option value={1}>1 (Current)</option>
                        <option value={2}>2 (Standard)</option>
                        <option value={3}>3 (Deep)</option>
                        <option value={5}>5 (Deeper)</option>
                        <option value={10}>10 (Extreme)</option>
                        <option value={15}>15 (Unbounded)</option>
                        <option value={50}>50 (Insane)</option>
                        <option value={999}>999 (Infinite)</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Max Pages</label>
                      <Input 
                        type="number" value={maxPages} onChange={e => setMaxPages(Number(e.target.value))}
                        className="rounded-none border-[#141414] h-8 text-[11px]" min="1"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-1 flex flex-col h-32">
                  <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Paste Links (One per line)</label>
                  <textarea
                    value={discoverPastedUrls}
                    onChange={e => setDiscoverPastedUrls(e.target.value)}
                    className="w-full flex-1 border border-[#141414] p-2 text-[10px] font-mono bg-white resize-none"
                    placeholder="https://..."
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Topic Filters (csv)</label>
                <Input 
                  value={topicFilter}
                  onChange={e => setTopicFilter(e.target.value)}
                  placeholder="e.g. math, 1ac"
                  className="rounded-none border-[#141414] text-[11px] h-8 bg-white"
                />
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-neutral-200">
              <Button 
                onClick={activeTab === "crawl" ? handleCrawlPdfs : handleDiscoverPdfs}
                disabled={isCrawling || isDiscovering}
                className="w-full bg-[#141414] hover:bg-[#141414]/90 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
              >
                {(isCrawling || isDiscovering) ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Scanning...</> : <><Search className="w-4 h-4 mr-2" /> Scan Source</>}
              </Button>
            </div>
          </div>
        );
      case "processing":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Processing Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Run batched AI pipelines on staged files. Extracts texts, assigns classifications, and isolates problematic documents.</p>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Grade Scope</label>
                <select value={scopeGradeId} onChange={e => setScopeGradeId(e.target.value)} className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0">
                  <option value="all">ANY GRADE [ALL]</option>
                  {dictionary.grades.map(g => <option key={g.id} value={g.id}>{g.nameFr} ({g.nameAr})</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Subject Scope</label>
                <select value={scopeSubjectId} onChange={e => setScopeSubjectId(e.target.value)} className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0">
                  <option value="all">ANY SUBJECT [ALL]</option>
                  {dictionary.subjects.map(s => <option key={s.id} value={s.id}>{s.nameFr}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">File Status Scope</label>
                <select value={scopeStatus} onChange={e => setScopeStatus(e.target.value)} className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414] focus:ring-0">
                  <option value="all">ALL STAGED</option>
                  <option value="pending">PENDING ONLY</option>
                  <option value="needs_review">NEEDS REVIEW (RETRY)</option>
                  <option value="ocr_needed">NEEDS OCR ONLY</option>
                  <option value="failed">FAILED ONLY</option>
                </select>
              </div>
              
              <div className="border border-neutral-200 bg-neutral-50 p-3 mt-4">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block mb-2 flex items-center gap-1.5"><Settings className="w-3 h-3"/> OCR Policy</label>
                <select value={ocrBatchMode} onChange={e => handleApplyOcrModePreset(e.target.value.toLowerCase() as any).catch(console.error)} className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white focus:border-[#141414]">
                  <option value="Disabled">Disabled (Fastest)</option>
                  <option value="Safe">Safe Mode (Slow, API safe)</option>
                  <option value="Balanced">Balanced</option>
                  <option value="Fast">Fast (Parallel, High Quota)</option>
                </select>
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-neutral-200 space-y-3">
              {!isBatchJobRunning ? (
                 <Button onClick={activeBatchJob ? startBatchJob : createBatchJob} className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(37,99,235,0.5)]">
                   <Play className="w-4 h-4 mr-2" /> {activeBatchJob ? "Resume Job" : "Run Batch Job"}
                 </Button>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={pauseBatchJob} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <Pause className="w-4 h-4 mr-1" /> Pause
                  </Button>
                  <Button onClick={stopBatchJob} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <Square className="w-4 h-4 mr-1" /> Stop
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      case "indexing":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Levelspace Indexing</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Map generic classified PDFs to the precise curriculum path in Levelspace.</p>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Index Confidence Threshold</label>
                  <select className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white">
                  <option value="high">High (&gt;= 85%)</option>
                  <option value="medium">Medium (&gt;= 60%)</option>
                  <option value="all">Map All (Review Later)</option>
                </select>
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-neutral-200">
               <Button 
                 onClick={handleRunIndexingJob}
                 disabled={isIndexingRunning}
                 className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(37,99,235,0.5)]">
                 {isIndexingRunning ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Indexing...</> : <><Play className="w-4 h-4 mr-2" /> Run Indexing Job</>}
               </Button>
            </div>
          </div>
        );
      case "review":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Review Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Resolve uncertainties and blockages from the AI pipeline. Approve or correct metadata mappings manually.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase font-bold text-neutral-600 block">Block Reason</label>
                <select className="w-full border border-neutral-300 h-8 text-[11px] font-mono px-2 rounded-none bg-white">
                  <option value="all">ALL BLOCKS</option>
                  <option value="no_grade_match">Missing Grade</option>
                  <option value="no_subject_match">Missing Subject</option>
                  <option value="low_confidence">Low Confidence</option>
                </select>
              </div>
            </div>
            <div className="mt-auto pt-6 border-t border-neutral-200">
              <Button className="w-full bg-amber-600 hover:bg-amber-700 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                <CheckSquare className="w-4 h-4 mr-2" /> Apply Review Actions
              </Button>
            </div>
          </div>
        );
      case "output":
         return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Outputs Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Generate clean printed PDFs and dataset mappings from completed files.</p>
            </div>
            <div className="space-y-4">
              <div className="border border-emerald-200 bg-emerald-50/30 p-3">
                 <h3 className="text-[10px] font-bold text-emerald-800 uppercase mb-1">Clean Build Scope</h3>
                 <p className="text-[9px] text-emerald-600 mb-3">Applies stamps, normalizes names, and compiles standard PDFs to server build cache.</p>
                 <Button onClick={handleBuildCleanCopiesForSelected} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-none text-[10px] font-mono uppercase h-8">
                   Build Selected ({selectedPdfUrls.length || stagedPdfs.filter(p=>p.status==="classified").length})
                 </Button>
              </div>
              <div className="border border-purple-200 bg-purple-50/30 p-3">
                 <h3 className="text-[10px] font-bold text-purple-800 uppercase mb-1">Export ZIP</h3>
                 <p className="text-[9px] text-purple-600 mb-3">Zips the built output PDFs along with corresponding dataset JSONL.</p>
                 <Button variant="outline" onClick={handleZipDownloadSelected} className="w-full bg-transparent hover:bg-purple-50 text-purple-700 border border-purple-500 rounded-none text-[10px] font-mono uppercase h-8">
                   Download Archive
                 </Button>
              </div>
            </div>
          </div>
        );
      case "reports":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Reports Job</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">View internal logs and audit errors.</p>
            </div>
            <div className="mt-auto pt-6 border-t border-neutral-200">
               <Button onClick={fetchPipelineStats} variant="outline" className="w-full rounded-none border-[#141414] text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                 <RefreshCw className="w-4 h-4 mr-2" /> Refresh Statistics
               </Button>
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="p-4 flex flex-col h-full space-y-6">
            <div>
              <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Workstation Settings</h2>
              <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Configure master dictionary mappings and local OCR quotas.</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderMain = () => {
    switch (activeJobView) {
      case "intake":
        return (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-neutral-200 bg-white flex justify-between items-center shrink-0">
               <div>
                  <h3 className="font-bold text-neutral-800 flex items-center gap-2"><Globe className="w-4 h-4 text-emerald-600"/> URL Source Extraction</h3>
                  <p className="text-[11px] text-neutral-500">Discoveries map to the local staging engine.</p>
               </div>
               {activeTab === "crawl" && crawledPdfs.length > 0 && (
                 <Button onClick={handleStageSelectedCrawled} className="bg-[#141414] hover:bg-neutral-800 text-white rounded-none font-mono text-[10px] uppercase h-8">
                   Stage {selectedCrawled.length} to Workspace
                 </Button>
               )}
               {activeTab === "discover" && discoveredResults.length > 0 && (
                 <Button onClick={handleIncorporateDiscovered} className="bg-[#141414] hover:bg-neutral-800 text-white rounded-none font-mono text-[10px] uppercase h-8">
                   Stage {selectedDiscovered.length} Approved Links
                 </Button>
               )}
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-neutral-50/50">
               {activeTab === "crawl" ? (
                 crawledPdfs.length === 0 ? (
                   <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400">
                     <Search className="w-12 h-12 mb-3 opacity-20" />
                     <p className="text-xs uppercase font-mono tracking-wider font-bold">No URLs Extracted</p>
                     <p className="text-[10px] mt-1 max-w-xs">Enter a curriculum page URL in the sidebar and scan to find PDFs.</p>
                   </div>
                 ) : (
                   <div className="border border-neutral-200 bg-white">
                      <div className="flex items-center px-4 py-2 border-b border-neutral-200 bg-neutral-50">
                        <input type="checkbox" checked={selectedCrawled.length === crawledPdfs.length} onChange={() => setSelectedCrawled(selectedCrawled.length === crawledPdfs.length ? [] : [...crawledPdfs])} className="rounded-none border-neutral-300 mr-3" />
                        <span className="text-[10px] font-mono font-bold uppercase text-neutral-500">Select All Visible ({crawledPdfs.length})</span>
                      </div>
                      <div className="divide-y divide-neutral-100">
                         {crawledPdfs.map(url => (
                            <div key={url} className={`p-3 flex items-center gap-3 ${selectedCrawled.includes(url) ? 'bg-emerald-50' : 'hover:bg-neutral-50'}`}>
                              <input type="checkbox" checked={selectedCrawled.includes(url)} onChange={() => setSelectedCrawled(prev => prev.includes(url) ? prev.filter(u=>u!==url) : [...prev, url])} className="rounded-none border-neutral-300" />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-neutral-800 truncate" title={decodeURIComponent(url.split('/').pop() || url)}>{decodeURIComponent(url.split('/').pop() || url)}</div>
                                <div className="text-[10px] text-neutral-400 truncate mt-0.5">{url}</div>
                              </div>
                              <a href={url} target="_blank" className="shrink-0 text-neutral-400 hover:text-neutral-900"><ExternalLink className="w-4 h-4"/></a>
                            </div>
                         ))}
                      </div>
                   </div>
                 )
               ) : (
                 discoveredResults.length === 0 ? (
                   <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400">
                     <Sparkles className="w-12 h-12 mb-3 opacity-20" />
                     <p className="text-xs uppercase font-mono tracking-wider font-bold">No Discovery Matches</p>
                     <p className="text-[10px] mt-1 max-w-xs">Run a search query to surface educational PDFs from the web.</p>
                   </div>
                 ) : (
                    <div className="border border-neutral-200 bg-white">
                      <div className="flex items-center px-4 py-2 border-b border-neutral-200 bg-neutral-50">
                        <input type="checkbox" checked={selectedDiscovered.length === discoveredResults.length} onChange={() => setSelectedDiscovered(selectedDiscovered.length === discoveredResults.length ? [] : discoveredResults.map(r=>r.url))} className="rounded-none border-neutral-300 mr-3" />
                        <span className="text-[10px] font-mono font-bold uppercase text-neutral-500">Select All Verified ({discoveredResults.length})</span>
                      </div>
                      <div className="divide-y divide-neutral-100">
                         {discoveredResults.map(res => (
                            <div key={res.url} className={`p-3 flex items-start gap-3 ${selectedDiscovered.includes(res.url) ? 'bg-emerald-50' : 'hover:bg-neutral-50'}`}>
                              <input type="checkbox" checked={selectedDiscovered.includes(res.url)} onChange={() => setSelectedDiscovered(prev => prev.includes(res.url) ? prev.filter(u=>u!==res.url) : [...prev, res.url])} className="rounded-none border-neutral-300 mt-1" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {res.accepted ? <Badge className="bg-emerald-100 text-emerald-800 rounded-none border-emerald-300 px-1 py-0 shadow-none text-[8px] font-mono">Verified Match</Badge> : <Badge className="bg-amber-100 text-amber-800 rounded-none border-amber-300 px-1 py-0 shadow-none text-[8px] font-mono">Rejected (Excluded)</Badge>}
                                  {res.isDirectPdf && <Badge className="bg-blue-100 text-blue-800 rounded-none border-blue-300 px-1 py-0 shadow-none text-[8px] font-mono">Direct PDF</Badge>}
                                </div>
                                <div className="text-xs font-medium text-neutral-800 truncate">{res.url}</div>
                                <div className="text-[10px] text-neutral-500 mt-1">Reason: {res.reason}</div>
                              </div>
                            </div>
                         ))}
                      </div>
                    </div>
                 )
               )}
            </div>
          </div>
        );
      case "processing":
        return (
          <div className="flex flex-col h-full">
            {/* Top Summaries */}
            <div className="p-6 bg-white border-b border-neutral-200 shrink-0 grid grid-cols-5 gap-4">
              <div className="border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-[9px] uppercase font-bold text-neutral-500 mb-1">Queued</div>
                <div className="font-mono text-2xl font-bold text-neutral-800">{activeBatchJob ? activeBatchJob.pending : stagedPdfs.length}</div>
              </div>
              <div className="border border-blue-200 bg-blue-50 p-3">
                <div className="text-[9px] uppercase font-bold text-blue-600 mb-1">Running</div>
                <div className="font-mono text-xl font-bold text-blue-800">{activeBatchJob ? activeBatchJob.running : 0}</div>
              </div>
              <div className="border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[9px] uppercase font-bold text-emerald-600 mb-1">Completed</div>
                <div className="font-mono text-xl font-bold text-emerald-800">{activeBatchJob ? activeBatchJob.completed : stagedPdfs.filter(p=>p.status==="classified").length}</div>
              </div>
              <div className="border border-amber-200 bg-amber-50 p-3">
                <div className="text-[9px] uppercase font-bold text-amber-600 mb-1">Blocked (Review)</div>
                <div className="font-mono text-xl font-bold text-amber-800">{activeBatchJob ? activeBatchJob.blocked : stagedPdfs.filter(p=>p.status==="needs_review").length}</div>
              </div>
              <div className="border border-red-200 bg-red-50 p-3">
                <div className="text-[9px] uppercase font-bold text-red-600 mb-1">Failed</div>
                <div className="font-mono text-xl font-bold text-red-800">{activeBatchJob ? activeBatchJob.failed : stagedPdfs.filter(p=>p.status==="failed").length}</div>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-6 bg-neutral-50">
              {!activeBatchJob ? (
                <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400">
                   <Play className="w-12 h-12 mb-3 opacity-20" />
                   <p className="text-xs uppercase font-mono tracking-wider font-bold">No Active Batch Job</p>
                   <p className="text-[10px] mt-1 max-w-xs text-neutral-500">Configure parameters in the sidebar and click Run Batch Job to start processing staged PDFs.</p>
                </div>
              ) : (
                <div className="border border-neutral-200 bg-white">
                  <div className="divide-y divide-neutral-100">
                     {batchJobItems.slice(0, 50).map((item, idx) => (
                        <div key={item.id || item.url || `batch-item-${idx}`} className="p-3 flex items-center gap-4 text-sm font-mono">
                          <div className="text-[10px] text-neutral-400 w-6">#{idx+1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-neutral-800 truncate">{item.filename}</div>
                            <div className="text-[9px] text-neutral-500 mt-1 flex gap-2">
                              <span>Step: <span className="font-bold text-neutral-700 uppercase">{item.currentStep}</span></span>
                              <span>Status: <span className={`font-bold uppercase ${item.status==='clean_copy_done' ? 'text-emerald-600' : item.status==='blocked' ? 'text-amber-600' : item.status==='failed' ? 'text-red-600' : item.status==='running' ? 'text-blue-600' : 'text-neutral-500'}`}>{item.status}</span></span>
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
      case "indexing":
        return (
          <div className="flex flex-col h-full">
            {/* Top Summaries */}
            <div className="p-6 bg-white border-b border-neutral-200 shrink-0 grid grid-cols-4 gap-4">
              <div className="border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-[9px] uppercase font-bold text-neutral-500 mb-1">To Index</div>
                <div className="font-mono text-xl font-bold text-neutral-800">{stagedPdfs.filter(p => !p.levelspace?.index_status && p.status === "classified").length}</div>
              </div>
              <div className="border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-[9px] uppercase font-bold text-emerald-600 mb-1">Indexed</div>
                <div className="font-mono text-xl font-bold text-emerald-800">{stagedPdfs.filter(p => p.levelspace?.index_status === "indexed").length}</div>
              </div>
              <div className="border border-amber-200 bg-amber-50 p-3">
                <div className="text-[9px] uppercase font-bold text-amber-600 mb-1">Needs Review</div>
                <div className="font-mono text-xl font-bold text-amber-800">{stagedPdfs.filter(p => p.levelspace?.index_status === "needs_review").length}</div>
              </div>
              <div className="border border-red-200 bg-red-50 p-3">
                <div className="text-[9px] uppercase font-bold text-red-600 mb-1">Blocked</div>
                <div className="font-mono text-xl font-bold text-red-800">{stagedPdfs.filter(p => p.levelspace?.index_status === "blocked").length}</div>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-6 bg-neutral-50">
                <div className="border border-neutral-200 bg-white">
                  <div className="divide-y divide-neutral-100 table w-full">
                     <div className="table-row bg-neutral-50 text-[9px] font-mono font-bold uppercase text-neutral-500 border-b border-neutral-200">
                        <div className="table-cell p-3 w-10"></div>
                        <div className="table-cell p-3 w-48">Filename</div>
                        <div className="table-cell p-3 max-w-xs">Curriculum Path</div>
                        <div className="table-cell p-3">Role</div>
                        <div className="table-cell p-3">Role Status</div>
                        <div className="table-cell p-3">Status</div>
                     </div>
                     {stagedPdfs.filter(p => p.levelspace).map((item, idx) => (
                        <div key={item.url} className="table-row text-xs font-mono border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
                          <div className="table-cell p-3 text-neutral-400 align-middle">
                            <input type="checkbox" className="rounded-none border-neutral-300" />
                          </div>
                          <div className="table-cell p-3 font-bold text-neutral-800 truncate max-w-xs align-middle" title={item.originalName}>{item.originalName}</div>
                          <div className="table-cell p-3 text-neutral-500 align-middle">
                            <div className="truncate max-w-xs text-[10px]" title={item.levelspace?.curriculum_path || ""}>
                              {item.levelspace?.curriculum_path ? (
                                <span className="text-neutral-700">{item.levelspace.curriculum_path}</span>
                              ) : (
                                <span className="text-neutral-400 italic">Not mapped</span>
                              )}
                            </div>
                          </div>
                          <div className="table-cell p-3 align-middle text-[10px]">{item.levelspace?.document_role || "—"}</div>
                          <div className="table-cell p-3 align-middle">
                             <div className="flex gap-1" title="visible: S(tudent) T(eacher) A(dmin) AI">
                               {item.levelspace?.student_visible ? <Badge className="px-1 py-0 text-[8px] rounded-none bg-blue-100 text-blue-800 shadow-none hover:bg-blue-100">S</Badge> : null}
                               {item.levelspace?.teacher_visible ? <Badge className="px-1 py-0 text-[8px] rounded-none bg-emerald-100 text-emerald-800 shadow-none hover:bg-emerald-100">T</Badge> : null}
                               {item.levelspace?.admin_visible ? <Badge className="px-1 py-0 text-[8px] rounded-none bg-amber-100 text-amber-800 shadow-none hover:bg-amber-100">A</Badge> : null}
                               {item.levelspace?.ai_visible ? <Badge className="px-1 py-0 text-[8px] rounded-none bg-purple-100 text-purple-800 shadow-none hover:bg-purple-100">AI</Badge> : null}
                             </div>
                          </div>
                          <div className="table-cell p-3 align-middle font-bold">
                             <span className={`uppercase ${item.levelspace?.index_status === 'indexed' ? 'text-emerald-600' : item.levelspace?.index_status === 'needs_review' ? 'text-amber-600' : item.levelspace?.index_status === 'blocked' ? 'text-red-600' : 'text-neutral-500'}`}>
                               {item.levelspace?.index_status || "PENDING"}
                             </span>
                          </div>
                        </div>
                     ))}
                     {stagedPdfs.filter(p => p.levelspace).length === 0 && (
                        <div className="table-row">
                          <div className="table-cell p-8 text-center text-neutral-400 col-span-6">
                            No files have been indexed yet. Run the Indexing Job.
                          </div>
                        </div>
                     )}
                  </div>
                </div>
            </div>
          </div>
        );
      case "review":
        return (
          <div className="flex flex-col h-full bg-neutral-50">
            <div className="p-6">
              {stagedPdfs.filter(p => p.status === "needs_review").length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400 bg-white border border-neutral-200">
                   <CheckCircle className="w-12 h-12 mb-3 opacity-20" />
                   <p className="text-xs uppercase font-mono tracking-wider font-bold">No Blocks to Review</p>
                   <p className="text-[10px] mt-1 max-w-xs text-neutral-500">All processed documents were classified perfectly, or the queue is empty.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {stagedPdfs.filter(p => p.status === "needs_review").map(pdf => (
                    <div key={pdf.url} className="bg-white border text-left p-4 shadow-sm border-amber-300">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <Badge className="bg-amber-100 text-amber-800 rounded-none border-amber-300 px-2 py-0 shadow-none text-[9px] font-mono mb-2 uppercase">{pdf.reason || "Needs Review"}</Badge>
                          <h4 className="font-bold text-xs font-mono text-neutral-800 break-all">{pdf.originalName}</h4>
                        </div>
                        {pdf.confidenceScore !== undefined && (
                          <div className="text-[10px] font-mono font-bold px-2 py-1 bg-neutral-100 border border-neutral-200">
                            Confidence: {Math.round(pdf.confidenceScore*100)}%
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-3 bg-neutral-50 p-2 border border-neutral-100 text-[10px] font-mono">
                        <div><span className="text-neutral-400 uppercase block mb-1">Grade</span><span className="font-bold">{pdf.gradeId || "—"}</span></div>
                        <div><span className="text-neutral-400 uppercase block mb-1">Subject</span><span className="font-bold">{pdf.subjectId || "—"}</span></div>
                        <div><span className="text-neutral-400 uppercase block mb-1">Topic</span><span className="font-bold">{pdf.topicId || "—"}</span></div>
                        <div><span className="text-neutral-400 uppercase block mb-1">Type</span><span className="font-bold">{pdf.documentTypeId || "—"}</span></div>
                      </div>
                      <div className="flex gap-2 justify-end mt-2">
                        <Button className="bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 h-8 text-[10px] font-mono shadow-none rounded-none w-24">Reject</Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-[10px] font-mono shadow-none rounded-none w-24">Fix & Approve</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      case "output":
         return (
          <div className="flex flex-col h-full items-center justify-center bg-white">
             {/* Simple summary table */}
             <div className="mb-8 text-center max-w-lg">
                <Merge className="w-12 h-12 text-purple-200 mx-auto mb-4" />
                <h3 className="text-lg font-mono font-bold uppercase text-neutral-800 mb-2">Outputs & Data Assets</h3>
                <p className="text-xs text-neutral-500 leading-relaxed font-sans">
                  The outputs job allows you to compile clean, watermarked copies of your correctly classified PDFs alongside the structured JSONL metadata for AI dataset tuning. Select actions from the sidebar.
                </p>
             </div>
             
             <div className="grid grid-cols-2 gap-4 w-full max-w-2xl px-6">
                <div className="border border-neutral-200 p-6 flex items-center justify-between">
                   <div>
                      <div className="text-[10px] uppercase font-mono font-bold text-neutral-500">Processed Ready PDFs</div>
                   </div>
                   <div className="text-2xl font-black font-mono text-emerald-700">{stagedPdfs.filter(p=>p.status==="classified").length}</div>
                </div>
                <div className="border border-neutral-200 p-6 flex items-center justify-between">
                   <div>
                      <div className="text-[10px] uppercase font-mono font-bold text-neutral-500">Clean Cached Copies</div>
                   </div>
                   <div className="text-2xl font-black font-mono text-blue-700">{pipelineStats.cleanCopies}</div>
                </div>
             </div>
             
             {isCombining && (
                <div className="fixed inset-0 bg-neutral-900/80 z-50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
                  <Loader2 className="w-12 h-12 animate-spin mb-4 text-emerald-400" />
                  <h3 className="font-mono text-xl font-bold mb-2">Building Clean Copies</h3>
                  <p className="text-sm opacity-70">Watermarking PDFs and saving metadata dataset...</p>
                </div>
             )}
             
             {isDownloadingZip && (
                <div className="fixed inset-0 bg-neutral-900/80 z-50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
                  <Loader2 className="w-12 h-12 animate-spin mb-4 text-purple-400" />
                  <h3 className="font-mono text-xl font-bold mb-2">Compressing Archive</h3>
                  <p className="text-sm opacity-70">Gathering artifacts into a zip file for download...</p>
                </div>
             )}
          </div>
         );
      case "reports":
        return (
          <div className="flex flex-col h-full bg-neutral-50 p-6">
            <h3 className="font-bold text-neutral-800 flex items-center gap-2 mb-6"><Activity className="w-5 h-5 text-blue-600"/> Diagnostics Summary</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                 <div className="border border-neutral-300 bg-white p-6 flex flex-col text-center shadow-sm">
                   <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider mb-2">Total Downloads</span>
                   <span className="font-black text-3xl text-neutral-800">{pipelineStats.originalDownloads}</span>
                 </div>
                 <div className="border border-emerald-300 bg-emerald-50 p-6 flex flex-col text-center shadow-sm">
                   <span className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider mb-2">Clean Stamped Copies</span>
                   <span className="font-black text-3xl text-emerald-800">{pipelineStats.cleanCopies}</span>
                 </div>
                 <div className="border border-violet-300 bg-violet-50 p-6 flex flex-col text-center shadow-sm">
                   <span className="text-[10px] text-violet-600 uppercase font-bold tracking-wider mb-2">Dataset Rows (JSONL)</span>
                   <span className="font-black text-3xl text-violet-800">{pipelineStats.datasetRows}</span>
                 </div>
                 <div className="border border-red-300 bg-red-50 p-6 flex flex-col text-center shadow-sm">
                   <span className="text-[10px] text-red-600 uppercase font-bold tracking-wider mb-2">Failed Tasks</span>
                   <span className="font-black text-3xl text-red-800">{stagedPdfs.filter(p=>p.status==="failed").length}</span>
                 </div>
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="flex flex-col h-full p-6 bg-white overflow-y-auto">
             <h3 className="font-bold text-neutral-800 flex items-center gap-2 mb-4"><Settings className="w-5 h-5 text-neutral-600"/> Master Dictionary Editor</h3>
             <p className="text-xs text-neutral-500 mb-6 max-w-2xl">Modify the canonical dictionaries used for automated AI mapping. Topics and categories mapped here are passed strictly to the model prompt via standard JSON context.</p>
             {/* Re-use dictionary tabs logic briefly */}
             <div className="border border-neutral-200">
               <div className="flex overflow-x-auto border-b border-neutral-200 bg-neutral-50 text-[10px] font-mono font-bold uppercase text-neutral-500">
                 <button onClick={() => setActiveDictSubTab("grades")} className={`px-4 py-3 ${activeDictSubTab==='grades' ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#047857]' : 'hover:bg-neutral-100'}`}>Grades</button>
                 <button onClick={() => setActiveDictSubTab("subjects")} className={`px-4 py-3 ${activeDictSubTab==='subjects' ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#047857]' : 'hover:bg-neutral-100'}`}>Subjects</button>
                 <button onClick={() => setActiveDictSubTab("topics")} className={`px-4 py-3 ${activeDictSubTab==='topics' ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#047857]' : 'hover:bg-neutral-100'}`}>Topics</button>
                 <button onClick={() => setActiveDictSubTab("docs")} className={`px-4 py-3 ${activeDictSubTab==='docs' ? 'bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_#047857]' : 'hover:bg-neutral-100'}`}>Document Types</button>
               </div>
               <div className="p-4 flex flex-col items-center justify-center text-neutral-400 py-12">
                   <FolderArchive className="w-12 h-12 mb-3 opacity-20" />
                   <div className="flex items-center gap-2 mb-2"><Loader2 className="w-3 h-3 animate-spin"/></div>
                   <p className="text-xs font-mono tracking-wide">Dictionary records are populated by the active SCARPE database.</p>
               </div>
             </div>
          </div>
        );
      default:
        return <div>Select a job view.</div>;
    }
  };

  const handleSaveSecrets = () => {
    localStorage.setItem("scarpe_secret_nvidia_key", nvidiaApiKey);
    localStorage.setItem("scarpe_secret_mistral_key", mistralApiKey);
    localStorage.setItem("scarpe_secret_openrouter_key", openRouterApiKey);
    localStorage.setItem("scarpe_secret_openai_key", openAiApiKey);
    toast.success("AI Studio Secret credentials and placeholders successfully saved and cached locally!");
    setShowSecretModal(false);
  };

  return (
    <AppShell>
      {/* 1. Top Monitoring Bar */}
      <TopMonitoringBar
        activeJobView={activeJobView}
        onJobViewChange={setActiveJobView}
        onResetWorkspace={handleResetWorkspace}
        onRefreshStats={fetchPipelineStats}
        crawledPdfsCount={crawledPdfs.length}
        stagedPdfsCount={stagedPdfs.length}
        selectedPdfUrlsCount={selectedPdfUrls.length}
        classifiedCount={stagedPdfs.filter(p => p.status === "classified").length}
        needsReviewCount={stagedPdfs.filter(p => p.status === "needs_review").length}
        failedCount={stagedPdfs.filter(p => p.status === "failed").length}
        cleanCopiesCount={pipelineStats.cleanCopies}
        localRoot={pipelineStats.localRoot}
        isPaused={ocrConfig.isPaused}
        onPause={handlePauseOcrQueue}
        onResume={handleResumeOcrQueue}
        isBusy={isCrawling || isDiscovering || ocrQueue.some(i => i.status === "running")}
        onOpenSecretModal={() => setShowSecretModal(true)}
      />

      {/* 2. Job Workspace */}
      {renderActiveJobView()}

      {/* Secret AI Studio Keys Modal */}
      {showSecretModal && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white border-2 border-neutral-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] w-full max-w-lg flex flex-col font-mono text-left">
            {/* Header */}
            <div className="bg-neutral-900 text-white p-4 flex items-center justify-between border-b border-neutral-800">
              <span className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-500 fill-amber-500/20" />
                Secret AI Studio Credentials Config
              </span>
              <button 
                onClick={() => setShowSecretModal(false)}
                className="text-neutral-400 hover:text-white text-xs font-bold font-mono transition-colors"
                title="Close modal"
              >
                [✕]
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 font-sans text-xs">
              <div className="bg-amber-50/50 border border-amber-200 p-3 text-[10.5px] font-mono text-amber-850 leading-relaxed uppercase mb-2">
                Configure your secret API tokens here. These are used to authenticate requests to custom processing and OCR providers. Key values are saved securely on your local client cache.
              </div>

              {/* NVIDIA Key */}
              <div className="space-y-1">
                <label className="block text-[10.5px] font-mono font-bold uppercase text-neutral-700">
                  NVIDIA API Key
                </label>
                <input 
                  type="password"
                  placeholder="nvapi-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" 
                  value={nvidiaApiKey}
                  onChange={(e) => setNvidiaApiKey(e.target.value)}
                  className="w-full border border-neutral-300 focus:border-neutral-900 h-9 px-3 rounded-none bg-white font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-all"
                />
              </div>

              {/* MISTRAL Key */}
              <div className="space-y-1">
                <label className="block text-[10.5px] font-mono font-bold uppercase text-neutral-700">
                  Mistral API Key
                </label>
                <input 
                  type="password"
                  placeholder="U2VlfgDXXXXXXXXXXXXXXXXXXXXXXXXX" 
                  value={mistralApiKey}
                  onChange={(e) => setMistralApiKey(e.target.value)}
                  className="w-full border border-neutral-300 focus:border-neutral-900 h-9 px-3 rounded-none bg-white font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-all"
                />
              </div>

              {/* OPEN ROUTER Key */}
              <div className="space-y-1">
                <label className="block text-[10.5px] font-mono font-bold uppercase text-neutral-700">
                  OpenRouter API Key
                </label>
                <input 
                  type="password"
                  placeholder="sk-or-v1-XXXXXXXXXXXXXXXXXXXXXXXX" 
                  value={openRouterApiKey}
                  onChange={(e) => setOpenRouterApiKey(e.target.value)}
                  className="w-full border border-neutral-300 focus:border-neutral-900 h-9 px-3 rounded-none bg-white font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-all"
                />
              </div>

              {/* OPENAI Key */}
              <div className="space-y-1">
                <label className="block text-[10.5px] font-mono font-bold uppercase text-neutral-700">
                  OpenAI API Key
                </label>
                <input 
                  type="password"
                  placeholder="sk-proj-XXXXXXXXXXXXXXXXXXXXXXXX" 
                  value={openAiApiKey}
                  onChange={(e) => setOpenAiApiKey(e.target.value)}
                  className="w-full border border-neutral-300 focus:border-neutral-900 h-9 px-3 rounded-none bg-white font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-all"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-3 font-mono">
              <Button 
                onClick={() => setShowSecretModal(false)}
                variant="outline"
                className="h-9 rounded-none text-xs uppercase"
              >
                Cancel
              </Button>
              <Button 
                id="btn-save-secrets-studio"
                onClick={handleSaveSecrets}
                className="h-9 bg-neutral-900 hover:bg-neutral-800 text-white rounded-none text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)]"
              >
                Save Keys
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
};
