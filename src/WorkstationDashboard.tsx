import React, { useState, useEffect } from "react";
import { 
  Search, Globe, FileText, Download, List, Settings, 
  Trash2, Filter, GraduationCap, CheckCircle, XCircle, 
  Loader2, Sparkles, AlertTriangle, Merge, Share2, 
  ArrowRight, ExternalLink, RefreshCw, Layers, Check, 
  ChevronRight, ChevronDown, CheckSquare, Square, Save, 
  FileJson, Plus, FileDown, FolderArchive, Play
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import axios from "axios";
import { generateZipViaWorker } from "./workerClient";

// Standard props and interface definitions
interface DictionaryItem {
  id: string;
  nameAr: string;
  nameFr: string;
  suffix: string;
  keywords: string[];
}

interface TopicItem extends DictionaryItem {
  subjectId: string;
}

interface Dictionary {
  grades: DictionaryItem[];
  subjects: DictionaryItem[];
  topics: TopicItem[];
  allowedDocumentTypes: DictionaryItem[];
}

interface StagedPdf {
  url: string;
  originalName: string;
  status: "pending" | "classifying" | "classified" | "rejected" | "failed" | "needs_review";
  
  hash?: string;
  extractionStatus?: "pending" | "text_extracted" | "needs_ocr" | "ocr_done" | "extract_failed";
  ocrStatus?: "not_needed" | "needed" | "queued" | "running" | "done" | "failed";
  pdfTextType?: string;
  textQualityScore?: number;
  textLength?: number;

  gradeId: string | null;
  subjectId: string | null;
  topicId: string | null;
  documentTypeId: string | null;
  cleanTitle: string | null;
  renamePattern: string | null;
  reason: string | null;
  rawText: string | null;
  isMatch: boolean;

  confidenceScore?: number;
  matchedTerms?: string[];
  matchedFields?: string[];

  cleanCopyStatus?: "pending" | "building" | "success" | "failed";
  datasetRowStatus?: "pending" | "saving" | "success" | "failed";
  cleanFilename?: string;
  datasetId?: string;
}

export default function WorkstationDashboard() {
  // App states
  const [crawlUrl, setCrawlUrl] = useState("https://talamidi.com/%D8%AF%D8%B1%D9%88%D8%B3-%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A%D8%A7%D8%AA-%D9%84%D9%84%D8%B3%D9%86%D8%A9-%D8%A7%D9%84%D8%A7%D9%88%D9%84%D9%89-%D8%A7%D8%B9%D8%AF%D8%A7%D8%AF%D9%8A/");
  const [maxPages, setMaxPages] = useState(30);
  const [maxDepth, setMaxDepth] = useState(2);
  const [topicFilter, setTopicFilter] = useState(""); // User custom crawling topic filter
  
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawledPdfs, setCrawledPdfs] = useState<string[]>([]);
  const [selectedCrawled, setSelectedCrawled] = useState<string[]>([]);

  // Workspace-wide dictionary state
  const [dictionary, setDictionary] = useState<Dictionary>({
    grades: [],
    subjects: [],
    topics: [],
    allowedDocumentTypes: []
  });
  const [loadingDictionary, setLoadingDictionary] = useState(false);
  const [savingDictionary, setSavingDictionary] = useState(false);

  // Active classification staged PDFs
  const [stagedPdfs, setStagedPdfs] = useState<StagedPdf[]>([]);
  const [isClassifyingAll, setIsClassifyingAll] = useState(false);
  const [activeInspectedIndex, setActiveInspectedIndex] = useState<number | null>(null);

  // Selection for combine
  const [selectedForCombine, setSelectedForCombine] = useState<string[]>([]);
  const [customMergeName, setCustomMergeName] = useState("Combined_Exercises_Report");
  const [isCombining, setIsCombining] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  // Filters for displaying files in staging
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterGrade, setFilterGrade] = useState<string>("all");
  const [filterSubject, setFilterSubject] = useState<string>("all");

  // PDF Search and Discovery Tab states
  const [activeTab, setActiveTab] = useState<"crawl" | "discover">("crawl");
  const [activeDiscoverTab, setActiveDiscoverTab] = useState<"query" | "paste">("query");
  const [discoverQuery, setDiscoverQuery] = useState("3eme annee college examens de physique pdf option francaise");
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
      const res = await axios.get("/api/pipeline/reports");
      if (res.data && res.data.stats) {
        setPipelineStats(res.data.stats);
      }
    } catch (e) {
      console.warn("Could not fetch local reports stats:", e);
    }
  };

  // Initial loading
  useEffect(() => {
    fetchActiveDictionary();
    loadLocalStagedPdfs();
    fetchPipelineStats();
  }, []);

  // Save staged files to localStorage to act as durable local-first persistence
  useEffect(() => {
    if (stagedPdfs.length > 0) {
      localStorage.setItem("scarpe_staged_pdfs", JSON.stringify(stagedPdfs));
    }
  }, [stagedPdfs]);

  const loadLocalStagedPdfs = () => {
    try {
      const cached = localStorage.getItem("scarpe_staged_pdfs");
      if (cached) {
        setStagedPdfs(JSON.parse(cached));
      }
    } catch (e) {
      console.warn("Could not retrieve cached staged files:", e);
    }
  };

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

      // Auto select accepted URLs initially
      const acceptedUrls = results.filter((r: any) => r.accepted).map((r: any) => r.url);
      setSelectedDiscovered(acceptedUrls);

      toast.success(`Discovery finished! Evaluated ${results.length} links according to curricular parameters.`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.error || "Discovery session encountered an error.");
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleIncorporateDiscovered = async () => {
    if (selectedDiscovered.length === 0) {
      toast.error("Please elect at least one discovered link.");
      return;
    }

    const clickedItems = discoveredResults.filter(r => selectedDiscovered.includes(r.url));
    const directPdfs = clickedItems.filter(r => r.isDirectPdf);
    const webpages = clickedItems.filter(r => !r.isDirectPdf);

    let stagedCount = 0;
    let crawlQueue: string[] = [];

    // Stage direct PDFs
    if (directPdfs.length > 0) {
      const uniqueToStage = directPdfs.filter(p => !stagedPdfs.some(item => item.url === p.url));
      if (uniqueToStage.length > 0) {
        const newItems = uniqueToStage.map(p => {
          let originalName = p.url.split("/").pop() || "discovered_document.pdf";
          try {
            originalName = decodeURIComponent(originalName);
          } catch {}
          return {
            url: p.url,
            originalName,
            status: "pending" as const,
            gradeId: null,
            subjectId: null,
            topicId: null,
            documentTypeId: null,
            cleanTitle: null,
            renamePattern: null,
            reason: null,
            rawText: null,
            isMatch: true
          };
        });
        setStagedPdfs(prev => [...prev, ...newItems]);
        stagedCount += newItems.length;
      }
    }

    if (webpages.length > 0) {
      crawlQueue = webpages.map(w => w.url);
      toast.info(`Staged ${directPdfs.length} direct PDFs. Activating crawling pipeline for ${webpages.length} pages...`);
      
      setIsCrawling(true);
      let pagePdfsFound: string[] = [];
      
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
        toast.success(`Crawl completed! Discovered & Staged ${uniqueFound.length} additional PDFs from the educational web indices.`);
      } else {
        toast.warning("Underlying pages didn't yield any instant PDFs. Try refining your Topic Filters.");
      }
    }

    if (stagedCount > 0) {
      toast.success(`Staged ${stagedCount} direct PDFs into the Classifier Workspace!`);
    }
  };

  const fetchActiveDictionary = async () => {
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
    toast.info("Crawl session initiated. Running deep site scraping...");

    try {
      const res = await axios.post("/api/crawl-pdfs", {
        url: crawlUrl,
        maxPages,
        maxDepth,
        topicFilter
      });

      // Filter or display PDFs returned by crawled endpoint
      const urls: string[] = Array.from(new Set(res.data.pdfs || []));
      setCrawledPdfs(urls);
      setSelectedCrawled(urls); // Auto select all found links initially
      toast.success(`Crawl completed! Discovered ${urls.length} relevant educational PDF links.`);
    } catch (e: any) {
      console.error(e);
      toast.error(e.response?.data?.error || "Crawl job failed on backend.");
    } finally {
      setIsCrawling(false);
    }
  };

  const handleStageSelectedCrawled = () => {
    if (selectedCrawled.length === 0) {
      toast.error("Please tick at least one crawled PDF link to stage.");
      return;
    }

    const uniqueToStage = selectedCrawled.filter(url => !stagedPdfs.some(item => item.url === url));
    if (uniqueToStage.length === 0) {
      toast.info("All selected files are already active in the Staging Workspace.");
      return;
    }

    const newItems = uniqueToStage.map(url => {
      let originalName = url.split("/").pop() || "scraped_document.pdf";
      try {
        originalName = decodeURIComponent(originalName);
      } catch {}
      return {
        url,
        originalName,
        status: "pending" as const,
        gradeId: null,
        subjectId: null,
        topicId: null,
        documentTypeId: null,
        cleanTitle: null,
        renamePattern: null,
        reason: null,
        rawText: null,
        isMatch: false
      };
    });

    setStagedPdfs(prev => [...prev, ...newItems]);
    toast.success(`Staged ${newItems.length} new PDFs into the Classification Workspace!`);
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
      if (!pData.success && pData.status === "rejected") {
        setStagedPdfs(prev => prev.map((p, i) => i === index ? {
          ...p,
          status: "rejected",
          reason: pData.reason
        } : p));
        toast.error(`URL Rejected: ${pData.reason}`);
        return;
      }

      if (!pData.success && pData.status === "failed") {
        setStagedPdfs(prev => prev.map((p, i) => i === index ? {
          ...p,
          status: "failed",
          reason: pData.reason
        } : p));
        toast.error(`Download failed: ${pData.reason}`);
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
        pdfTextType: pData.pdfTextType
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
        }
        return {
          ...p,
          status: finalStatus,
          gradeId: cData.gradeId,
          subjectId: cData.subjectId,
          topicId: cData.topicId,
          documentTypeId: cData.documentTypeId,
          cleanTitle: cData.cleanTitle,
          renamePattern: cData.renamePattern,
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
        text: item.rawText || ""
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
    stagedPdfs.forEach((p, idx) => {
      if (selectedForCombine.includes(p.url)) {
        selectedIndices.push(idx);
      }
    });

    if (selectedIndices.length === 0) {
      toast.warning("Select at least one staged PDF first.");
      return;
    }

    toast.info(`Starting clean copies compilation for ${selectedIndices.length} selected items.`);
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
    window.open(`/api/pipeline/download-clean/${hash}`, "_blank");
  };

  const handleOpenCleanText = (hash?: string) => {
    if (!hash) {
      toast.error("File hash is required to locate the clean text copy.");
      return;
    }
    window.open(`/api/pipeline/clean-text/${hash}`, "_blank");
  };

  const handleExportDatasetJsonl = () => {
    window.open("/api/pipeline/export-jsonl", "_blank");
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
      setSelectedForCombine([]);
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

    setSelectedForCombine(targetUrls);
  };

  const handleRunOcrForSelected = async () => {
    if (selectedForCombine.length === 0) {
      toast.warning("Select at least one staged PDF first.");
      return;
    }

    const matchedFiles = stagedPdfs.filter(p => selectedForCombine.includes(p.url));
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
    const activeSelected = stagedPdfs.filter(p => selectedForCombine.includes(p.url));
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

  const handleClassifyAllPending = async () => {
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
  const handleMergeSelected = async (urlsToMerge: string[] = selectedForCombine, outputFilename: string = customMergeName) => {
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
    if (selectedForCombine.length === 0) {
      toast.warning("Select at least one staged PDF first.");
      return;
    }
    const activeSelected = stagedPdfs.filter(p => selectedForCombine.includes(p.url) && p.status === "classified");
    if (activeSelected.length === 0) {
      toast.error("No classified, checked items available to archive.");
      return;
    }

    setIsDownloadingZip(true);
    toast.info(`Preparing renamed archive of ${activeSelected.length} documents...`);

    try {
      const collectedFiles: { filename: string; buffer: ArrayBuffer }[] = [];
      
      // Process sequential buffer fetching proxy
      for (const item of activeSelected) {
        try {
          const res = await axios.post("/api/proxy-download", { url: item.url }, { responseType: "arraybuffer" });
          const finalName = item.renamePattern || item.originalName;
          collectedFiles.push({ filename: finalName, buffer: res.data });
        } catch (e) {
          console.error(`Zip skip failed URL: ${item.url}`, e);
        }
      }

      if (collectedFiles.length > 0) {
        toast.info("Compiling local ZIP archive off main thread...");
        const zipBuffer = await generateZipViaWorker(collectedFiles);
        const zipBlob = new Blob([zipBuffer], { type: "application/zip" });
        const zipFilename = `school_scr_named_archive_${Date.now()}.zip`;
        
        const { saveAs } = await import("file-saver");
        saveAs(zipBlob, zipFilename);
        toast.success(`Successfully saved named archive local file!`);
      } else {
        toast.error("No PDF buffers could be retrieved.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Zipping procedure fell through.");
    } finally {
      setIsDownloadingZip(false);
    }
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

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-140px)]">
      
      {/* COLUMN 1: Crawler & URL Extraction (Left Column, spanned 4 cols) */}
      <div className="col-span-1 lg:col-span-4 space-y-6">
        <Card className="rounded-none border-[#141414] shadow-none bg-white flex flex-col h-[580px] overflow-hidden">
          {/* Custom Dual Tab Header Selection */}
          <div className="grid grid-cols-2 border-b border-[#141414] select-none shrink-0 text-xs font-mono font-bold uppercase tracking-wider">
            <button
              onClick={() => setActiveTab("crawl")}
              className={`py-3.5 px-4 text-center border-r border-[#141414] transition-all flex items-center justify-center gap-1.5 ${
                activeTab === "crawl" 
                  ? "bg-white text-emerald-700 font-extrabold" 
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-50"
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-emerald-600" />
              Syllabus Crawler
            </button>
            <button
              onClick={() => setActiveTab("discover")}
              className={`py-3.5 px-4 text-center transition-all flex items-center justify-center gap-1.5 ${
                activeTab === "discover" 
                  ? "bg-white text-emerald-700 font-extrabold" 
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-50"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              PDF Discovery
            </button>
          </div>

          {activeTab === "crawl" ? (
            <CardContent className="p-4 flex flex-col flex-1 overflow-hidden space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Extraction Hub URL</label>
                <div className="flex gap-2">
                  <Input 
                    value={crawlUrl}
                    onChange={e => setCrawlUrl(e.target.value)}
                    placeholder="Paste curriculum syllabus URL e.g. talamidi.com"
                    className="rounded-none border-[#141414] text-[11px] h-8 bg-[#fdfdfd]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 shrink-0">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Depth Limit</label>
                  <select 
                    value={maxDepth}
                    onChange={e => setMaxDepth(Number(e.target.value))}
                    className="w-full border border-[#141414] h-8 text-xs font-mono px-2 rounded-none bg-[#fdfdfd]"
                  >
                    <option value={1}>1 (Current Page only)</option>
                    <option value={2}>2 (Standard children folders)</option>
                    <option value={3}>3 (Deep course trees)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Page Limit</label>
                  <Input 
                    type="number"
                    value={maxPages}
                    onChange={e => setMaxPages(Number(e.target.value))}
                    className="rounded-none border-[#141414] h-8 text-[11px] font-mono"
                    min="5"
                  />
                </div>
              </div>

              <div className="space-y-1 shrink-0">
                <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Topic Filters (Separated by comma)</label>
                <Input 
                  value={topicFilter}
                  onChange={e => setTopicFilter(e.target.value)}
                  placeholder="e.g. math, equations, exercice, 1ac"
                  className="rounded-none border-[#141414] text-[10px] h-8 bg-[#fdfdfd]"
                />
                <span className="text-[8px] font-mono opacity-50 block">Only extracts links matching or belonging directly to these curriculum terms.</span>
              </div>

              <div className="flex gap-2 shrink-0 select-none">
                <Button 
                  onClick={handleCrawlPdfs}
                  disabled={isCrawling}
                  className="flex-1 bg-[#141414] hover:bg-[#141414]/90 text-white rounded-none text-[10px] font-mono uppercase tracking-wider h-8"
                >
                  {isCrawling ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Crawling Site...
                    </>
                  ) : (
                    <>
                      <Search className="w-3.5 h-3.5 mr-1.5" /> Scan curriculum URL
                    </>
                  )}
                </Button>
              </div>

              <div className="border-t border-dashed border-[#141414]/20 pt-3 flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="flex justify-between items-center mb-2 shrink-0">
                  <span className="text-[10px] font-mono uppercase opacity-50 tracking-wider">
                    Crawler Results ({crawledPdfs.length} PDFs)
                  </span>
                  {crawledPdfs.length > 0 && (
                    <button 
                      onClick={() => {
                        if (selectedCrawled.length === crawledPdfs.length) {
                          setSelectedCrawled([]);
                        } else {
                          setSelectedCrawled(crawledPdfs);
                        }
                      }}
                      className="text-[9px] font-mono font-bold text-blue-600 hover:underline select-none"
                    >
                      Select Toggle
                    </button>
                  )}
                </div>

                <ScrollArea className="flex-1 border border-[#141414]/15 bg-gray-50/50 p-2 min-h-0">
                  {crawledPdfs.length === 0 ? (
                    <div className="h-[200px] flex flex-col items-center justify-center text-center p-4">
                      <Globe className="w-8 h-8 opacity-25 text-neutral-400 mb-1" />
                      <p className="text-[10px] font-serif italic text-neutral-400">PDF listing is empty. Scan an educational page link to crawl documents.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 select-none">
                      {crawledPdfs.map((pdf, idx) => {
                        const isSelected = selectedCrawled.includes(pdf);
                        let decodedName = pdf.split("/").pop() || pdf;
                        try {
                          decodedName = decodeURIComponent(decodedName);
                        } catch {}
                        
                        return (
                          <div 
                            key={idx} 
                            className={`flex items-start gap-1 p-1.5 border text-[10px] font-mono transition-colors ${
                              isSelected ? "bg-emerald-50/50 border-emerald-400/40 text-emerald-950" : "bg-white border-neutral-200 text-neutral-800"
                            }`}
                          >
                            <input 
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedCrawled(prev => 
                                  isSelected ? prev.filter(u => u !== pdf) : [...prev, pdf]
                                );
                              }}
                              className="mt-0.5 rounded-none border-[#141414] focus:ring-0 mr-1.5"
                            />
                            <div className="truncate flex-1">
                              <div className="font-semibold truncate text-[9px] sm:text-[10.5px]" title={decodedName}>
                                {decodedName}
                              </div>
                              <div className="text-[8px] opacity-40 truncate">{pdf}</div>
                            </div>
                            <a 
                              href={pdf} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-neutral-400 hover:text-neutral-900 mt-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
                
                {crawledPdfs.length > 0 && (
                  <div className="pt-3 shrink-0">
                    <Button
                      onClick={handleStageSelectedCrawled}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-mono rounded-none text-[10px] uppercase h-9"
                    >
                      <Layers className="w-3.5 h-3.5 mr-1.5" /> Stage checked files for classification ({selectedCrawled.length})
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          ) : (
            /* NEW DISCOVERY ENGINE TAB MODULE */
            <CardContent className="p-4 flex flex-col flex-1 overflow-hidden space-y-3.5 text-xs font-mono">
              {/* Query vs Paste Method Toggle */}
              <div className="grid grid-cols-2 gap-1.5 bg-neutral-100 p-1 shrink-0 select-none">
                <button
                  type="button"
                  onClick={() => setActiveDiscoverTab("query")}
                  className={`text-[9.5px] uppercase py-1 text-center font-bold tracking-tight ${
                    activeDiscoverTab === "query" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  Search API Engine
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDiscoverTab("paste")}
                  className={`text-[9.5px] uppercase py-1 text-center font-bold tracking-tight ${
                    activeDiscoverTab === "paste" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  Manually Paste URLs
                </button>
              </div>

              {activeDiscoverTab === "query" ? (
                <div className="space-y-1.5 shrink-0">
                  <label className="text-[9px] uppercase opacity-75 font-bold block text-neutral-800">Grounding Search Query</label>
                  <Input
                    value={discoverQuery}
                    onChange={e => setDiscoverQuery(e.target.value)}
                    placeholder="Enter academic terms (e.g. maths 1ac cours pdf)"
                    className="rounded-none border-[#141414] text-[11px] h-8 bg-white"
                  />
                  <p className="text-[8.5px] text-neutral-400 leading-normal font-sans">
                    Leverages official embedded Google web grounding to extract authentic resource catalogs without browser scraping blocks or proxy evasion.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 flex-1 flex flex-col min-h-[90px] shrink-0">
                  <label className="text-[9px] uppercase opacity-75 font-bold block text-neutral-800">Target Search Listings (One per line)</label>
                  <textarea
                    value={discoverPastedUrls}
                    onChange={e => setDiscoverPastedUrls(e.target.value)}
                    placeholder="https://talamidi.com/examens-1ac-colleges-math&#10;https://example.com/curriculum/exercises.pdf"
                    className="w-full flex-1 border border-[#141414] p-2 text-[10.5px] bg-[#fdfdfd] resize-none focus:outline-none min-h-[70px]"
                  />
                  <p className="text-[8.5px] text-neutral-400 leading-none font-sans">
                    Paste external indexing listings or manual links. Evaluates file status recursively.
                  </p>
                </div>
              )}

              <Button
                onClick={handleDiscoverPdfs}
                disabled={isDiscovering}
                className="w-full bg-[#141414] hover:bg-[#141414]/90 text-white rounded-none text-[10px] uppercase h-8 shrink-0 tracking-wider font-mono font-extrabold"
              >
                {isDiscovering ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Investigating targets...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Discover & Filter Links
                  </>
                )}
              </Button>

              {/* Dynamic evaluation checklists */}
              <div className="border-t border-[#141414]/15 pt-2 flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="flex justify-between items-center mb-1.5 shrink-0 select-none">
                  <span className="text-[9.5px] font-mono uppercase bg-neutral-900 text-white px-2 py-0.5 font-bold">
                    Discovery Map ({discoveredResults.length} Links)
                  </span>
                  {discoveredResults.length > 0 && (
                    <button
                      onClick={() => {
                        const accepted = discoveredResults.filter(r => r.accepted).map(r => r.url);
                        if (selectedDiscovered.length === accepted.length) {
                          setSelectedDiscovered([]);
                        } else {
                          setSelectedDiscovered(accepted);
                        }
                      }}
                      className="text-[9px] font-bold text-blue-600 hover:underline"
                    >
                      Toggle Selected
                    </button>
                  )}
                </div>

                <ScrollArea className="flex-1 bg-neutral-50 border border-[#141414]/15 p-1.5 min-h-0">
                  {discoveredResults.length === 0 ? (
                    <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center p-3 font-sans text-neutral-400">
                      <Sparkles className="w-5 h-5 opacity-40 text-neutral-500 mb-1" />
                      <p className="text-[10px] italic">No active query catalog found. Execute search query or paste target nodes to test.</p>
                    </div>
                  ) : (
                    <div className="space-y-2 select-none">
                      {/* Accepted items list */}
                      <div className="space-y-1">
                        <div className="text-[8px] uppercase tracking-wider font-extrabold text-emerald-800 opacity-80">Passed Academic Filter:</div>
                        {discoveredResults.filter(r => r.accepted).length === 0 ? (
                          <div className="text-[9px] italic text-neutral-400 pl-2">No qualified downloads resolved.</div>
                         ) : (
                          discoveredResults.filter(r => r.accepted).map((item, idx) => {
                            const isChecked = selectedDiscovered.includes(item.url);
                            const decodedName = item.url.split("/").pop() || item.url;
                            return (
                              <div
                                key={idx}
                                className={`p-1.5 border flex items-start gap-1 transition-all ${
                                  isChecked 
                                    ? "bg-emerald-50/50 border-emerald-400/40 text-emerald-950" 
                                    : "bg-white border-neutral-200 text-neutral-800"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    setSelectedDiscovered(prev => 
                                      isChecked ? prev.filter(u => u !== item.url) : [...prev, item.url]
                                    );
                                  }}
                                  className="mt-0.5 rounded-none border-[#141414] focus:ring-0 mr-1"
                                />
                                <div className="truncate flex-1">
                                  <div className="font-semibold truncate text-[9.5px]" title={decodedName}>
                                    {item.isDirectPdf ? (
                                      <span className="bg-red-100 text-red-800 text-[8px] font-bold px-1.5 py-0.2 mr-1 inline-block uppercase select-none rounded-[1px]">PDF</span>
                                    ) : (
                                      <span className="bg-blue-100 text-blue-800 text-[8px] font-bold px-1.5 py-0.2 mr-1 inline-block uppercase select-none rounded-[1px]">PAGE</span>
                                    )}
                                    {decodedName}
                                  </div>
                                  <div className="text-[7.5px] opacity-45 truncate">{item.url}</div>
                                  <div className="text-[7.5px] text-emerald-700 italic font-sans flex items-center gap-0.5 mt-0.5">
                                    <CheckCircle className="w-2.5 h-2.5 shrink-0" /> {item.reason}
                                  </div>
                                </div>
                                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-neutral-800 mt-0.5">
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {/* Rejected links list for full transparency */}
                      <div className="space-y-1 pt-2 border-t border-dashed border-neutral-300">
                        <div className="text-[8px] uppercase tracking-wider font-extrabold text-red-800 opacity-80">Rejected Unrelated / Noise Links:</div>
                        {discoveredResults.filter(r => !r.accepted).length === 0 ? (
                          <div className="text-[9px] italic text-neutral-400 pl-2">No noisy pages excluded. Good catalog yield!</div>
                         ) : (
                          discoveredResults.filter(r => !r.accepted).map((item, idx) => {
                            const decodedName = item.url.split("/").pop() || item.url;
                            return (
                              <div key={idx} className="p-1 border bg-red-50/20 border-red-200/50 text-neutral-500 rounded-none flex items-start opacity-70">
                                <XCircle className="w-3 h-3 text-red-600 mt-0.5 mr-1.5 shrink-0" />
                                <div className="truncate flex-1">
                                  <div className="truncate font-semibold text-[9px]" title={decodedName}>{decodedName}</div>
                                  <div className="text-[7px] truncate opacity-50">{item.url}</div>
                                  <div className="text-[8.5px] text-red-850 font-sans mt-0.5 font-semibold leading-tight">{item.reason}</div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </ScrollArea>

                {selectedDiscovered.length > 0 && (
                  <div className="pt-2 shrink-0">
                    <Button
                      onClick={handleIncorporateDiscovered}
                      disabled={isCrawling}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-mono rounded-none text-[9px] uppercase h-9 flex items-center justify-center gap-1 shadow-xs"
                    >
                      <Layers className="w-3 h-3" />
                      Injected Selected ({selectedDiscovered.length}) to Pipeline
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {/* COLUMN 2: PDF Classification Workplace (Center Column, spanned 5 cols) */}
      <div className="col-span-1 lg:col-span-5 space-y-6">
        <Card className="rounded-none border-[#141414] shadow-none bg-white flex flex-col h-[580px] overflow-hidden">
          <CardHeader className="bg-neutral-50/80 border-b border-[#141414]/10 shrink-0 pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                Curriculum Classification Staging
              </CardTitle>
              <Badge className="bg-[#141414] text-white font-mono text-[9px] rounded-none">
                {stagedPdfs.length} Staged Documents
              </Badge>
            </div>
            <CardDescription className="text-[10px]">Verify, inspect, re-evaluate or override educational class metadata locally first.</CardDescription>
          </CardHeader>

          <CardContent className="p-4 flex flex-col flex-1 overflow-hidden space-y-4">
            
            {/* Local Pipeline Directory Stats Dashboard */}
            <div className="grid grid-cols-3 gap-2 bg-neutral-900 text-[#E4E3E0] p-2.5 font-mono text-[9px] shrink-0 border border-neutral-950">
              <div className="space-y-0.5 border-r border-neutral-800">
                <span className="opacity-60 block text-[8px] uppercase">Downloads</span>
                <span className="text-sm font-bold text-blue-450">{pipelineStats.originalDownloads} Files</span>
              </div>
              <div className="space-y-0.5 border-r border-neutral-800 px-2">
                <span className="opacity-60 block text-[8px] uppercase">Clean PDFs</span>
                <span className="text-sm font-bold text-emerald-400">{pipelineStats.cleanCopies} PDFs</span>
              </div>
              <div className="space-y-0.5 px-2">
                <span className="opacity-60 block text-[8px] uppercase">Dataset Rows</span>
                <span className="text-sm font-bold text-purple-400">{pipelineStats.datasetRows} Rows</span>
              </div>
            </div>

            {/* 🔄 OCR Async Queue Control & Settings Panel */}
            <div className="border border-neutral-300 bg-white text-zinc-900 shrink-0">
              <div 
                onClick={() => setShowOcrConfigPanel(!showOcrConfigPanel)}
                className="bg-neutral-100 p-2 border-b border-neutral-200 flex justify-between items-center cursor-pointer select-none font-mono text-[10px]"
              >
                <div className="flex items-center gap-1.5 font-bold text-neutral-800">
                  <Play className="w-3 h-3 text-emerald-600 fill-emerald-600 bg-transparent rotate-95" />
                  <span>🔄 OCR BATCH QUEUE & CONTROL PANEL</span>
                  <Badge variant="outline" className={`py-0 h-4 rounded-none text-[8px] font-bold ${ocrConfig.isPaused ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-emerald-400 bg-emerald-50 text-emerald-850'}`}>
                    {ocrConfig.isPaused ? "PAUSED" : "ACTIVE / RUNNING"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[#141414]/65">Quota today: <strong>{ocrQuotaUsedToday}</strong> / {ocrConfig.dailyPageLimit} pages</span>
                  <span className="text-[10px] text-neutral-500">{showOcrConfigPanel ? "▲ Collapse" : "▼ Expand Settings"}</span>
                </div>
              </div>

              {showOcrConfigPanel && (
                <div className="p-3 bg-neutral-50/50 space-y-3 font-mono text-[9.5px] border-b border-neutral-200">
                  <div className="bg-amber-50 border border-amber-200/50 p-2 text-[8.5px] text-amber-800 leading-normal mb-1">
                    ⚠️ <span className="font-bold">OCR may consume API quota. Use slow mode for large batches.</span> Clean-text PDFs are skipped automatically during queue enqueuing.
                  </div>

                  {/* Mode presets */}
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <span className="font-bold text-neutral-600">PRESET MODES:</span>
                    <button 
                      onClick={() => handleApplyOcrModePreset("safe")}
                      className="bg-white hover:bg-neutral-100 border border-neutral-300 py-0.5 px-1 font-semibold text-[8px] sm:text-[9px] rounded-none shadow-sm transition-all"
                      title="1 PDF, 1 page / 8s page delay, 30s PDF delay"
                    >
                      🛡️ Safe Mode (Default)
                    </button>
                    <button 
                      onClick={() => handleApplyOcrModePreset("balanced")}
                      className="bg-white hover:bg-neutral-100 border border-neutral-300 py-0.5 px-1 font-semibold text-[8px] sm:text-[9px] rounded-none shadow-sm transition-all"
                      title="1 PDF, 1 page / 4s page delay, 15s PDF delay"
                    >
                      ⚖️ Balanced Mode
                    </button>
                    <button 
                      onClick={() => handleApplyOcrModePreset("fast")}
                      className="bg-white hover:bg-neutral-100 border border-neutral-300 py-0.5 px-1 font-semibold text-[8px] sm:text-[9px] rounded-none shadow-sm transition-all text-red-750 border-red-200 hover:bg-red-50/10"
                      title="2 PDFs, Multithreaded / 2s page delay, 5s PDF delay"
                    >
                      🚀 Fast mode (Quota risk)
                    </button>
                  </div>

                  {/* Settings Grid inputs */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2 pt-2 border-t border-dashed border-neutral-200">
                    <div>
                      <label className="block text-[8px] text-neutral-500 font-bold uppercase mb-0.5">Concurrency</label>
                      <input 
                        type="number" 
                        value={ocrConfig.concurrency || 1} 
                        min={1} 
                        max={5}
                        onChange={e => handleUpdateOcrConfig({ concurrency: parseInt(e.target.value) || 1 })}
                        className="w-full h-5 border border-neutral-300 bg-white px-1 font-mono text-[9px] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] text-neutral-500 font-bold uppercase mb-0.5">Page Delay (ms)</label>
                      <input 
                        type="number" 
                        value={ocrConfig.delayBetweenPagesMs || 8000} 
                        step={100}
                        onChange={e => handleUpdateOcrConfig({ delayBetweenPagesMs: parseInt(e.target.value) || 8000 })}
                        className="w-full h-5 border border-neutral-300 bg-white px-1 font-mono text-[9px] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] text-neutral-500 font-bold uppercase mb-0.5">PDF Delay (ms)</label>
                      <input 
                        type="number" 
                        value={ocrConfig.delayBetweenPdfsMs || 30000} 
                        step={100}
                        onChange={e => handleUpdateOcrConfig({ delayBetweenPdfsMs: parseInt(e.target.value) || 30000 })}
                        className="w-full h-5 border border-neutral-300 bg-white px-1 font-mono text-[9px] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] text-neutral-500 font-bold uppercase mb-0.5">Max Pages/PDF</label>
                      <input 
                        type="number" 
                        value={ocrConfig.maxPagesPerPdf || 30} 
                        min={1}
                        onChange={e => handleUpdateOcrConfig({ maxPagesPerPdf: parseInt(e.target.value) || 30 })}
                        className="w-full h-5 border border-neutral-300 bg-white px-1 font-mono text-[9px] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[8px] text-neutral-500 font-bold uppercase mb-0.5">Max PDFs/Batch</label>
                      <input 
                        type="number" 
                        value={ocrConfig.maxPdfsPerBatch || 5} 
                        min={1}
                        onChange={e => handleUpdateOcrConfig({ maxPdfsPerBatch: parseInt(e.target.value) || 5 })}
                        className="w-full h-5 border border-neutral-300 bg-white px-1 font-mono text-[9px] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] text-neutral-500 font-bold uppercase mb-0.5">Daily Page limit</label>
                      <input 
                        type="number" 
                        value={ocrConfig.dailyPageLimit || 100} 
                        min={1}
                        onChange={e => handleUpdateOcrConfig({ dailyPageLimit: parseInt(e.target.value) || 100 })}
                        className="w-full h-5 border border-neutral-300 bg-white px-1 font-mono text-[9px] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] text-neutral-500 font-bold uppercase mb-0.5">Max Retries</label>
                      <input 
                        type="number" 
                        value={ocrConfig.maxRetries || 3} 
                        min={0}
                        onChange={e => handleUpdateOcrConfig({ maxRetries: parseInt(e.target.value) || 3 })}
                        className="w-full h-5 border border-neutral-300 bg-white px-1 font-mono text-[9px] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] text-neutral-500 font-bold uppercase mb-0.5">Backoff Factor</label>
                      <input 
                        type="number" 
                        value={ocrConfig.backoffMultiplier || 2} 
                        min={1}
                        onChange={e => handleUpdateOcrConfig({ backoffMultiplier: parseFloat(e.target.value) || 2 })}
                        className="w-full h-5 border border-neutral-300 bg-white px-1 font-mono text-[9px] focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="flex gap-2 justify-end pt-2 border-t border-dashed border-neutral-200">
                    <button 
                      onClick={handleResumeOcrQueue}
                      disabled={!ocrConfig.isPaused}
                      className="bg-emerald-650 hover:bg-emerald-700 text-white py-1 px-3 shadow-none text-[8.5px] font-bold select-none disabled:opacity-40 rounded-none uppercase"
                    >
                      ▶️ Resume OCR Queue
                    </button>
                    <button 
                      onClick={handlePauseOcrQueue}
                      disabled={ocrConfig.isPaused}
                      className="bg-amber-600 hover:bg-amber-700 text-white py-1 px-3 shadow-none text-[8.5px] font-bold select-none disabled:opacity-40 rounded-none uppercase"
                    >
                      ⏸️ Pause OCR Queue
                    </button>
                    <button 
                      onClick={handleStopOcrQueueBatch}
                      className="bg-rose-750 hover:bg-rose-800 text-white py-1 px-3 shadow-none text-[8.5px] font-bold select-none rounded-none uppercase"
                    >
                      🛑 Stop / Clear Queue
                    </button>
                  </div>
                </div>
              )}

              {/* Active list display */}
              {ocrQueue.length > 0 && (
                <div className="max-h-[140px] overflow-y-auto p-2 border-t border-neutral-200 bg-white font-mono text-[8px]">
                  <div className="font-bold text-neutral-700 uppercase pb-1 flex justify-between items-center text-[8.5px]">
                    <span>🎯 ACTIVE QUEUE MONITORED JOBS ({ocrQueue.length})</span>
                    <span className="text-[7.5px] text-neutral-500">Processed sequentially bottom to top</span>
                  </div>
                  <div className="space-y-1">
                    {ocrQueue.map((qi: any) => {
                      const qColors: Record<string, string> = {
                        queued: "text-blue-650 font-semibold",
                        running: "text-emerald-750 font-bold",
                        waiting_delay: "text-amber-650 font-medium",
                        rate_limited: "text-rose-600 font-black animate-pulse",
                        retrying: "text-orange-650 font-medium",
                        done: "text-neutral-500 font-semibold",
                        failed: "text-red-700 font-bold",
                        paused: "text-zinc-500 font-bold"
                      };
                      return (
                        <div key={qi.id || qi.pdfHash} className="flex justify-between items-center border border-dashed border-neutral-200 p-1 bg-neutral-50/50">
                          <span className="truncate max-w-[240px]" title={qi.title}>• {qi.title}</span>
                          <div className="flex gap-2 items-center">
                            <span className={qColors[qi.status] || ""}>[{qi.status.toUpperCase()}]</span>
                            <span>Page {qi.currentPage || 0}/{qi.totalPages || "?"}</span>
                            {qi.delayCountdown > 0 && (
                              <span className="bg-amber-200/50 text-amber-900 px-0.5 font-bold">⏳ {qi.delayCountdown}s</span>
                            )}
                            {qi.retryCount > 0 && (
                              <span>Attempt {qi.retryCount}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Pipeline Controls & Filters */}
            <div className="bg-neutral-50 border border-neutral-200 p-2 text-xs flex flex-wrap gap-2 justify-between items-center select-none shrink-0">
              <div className="flex flex-wrap gap-2">
                <select 
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="border border-[#141414]/20 text-[9px] font-mono h-6 bg-white shrink-0"
                >
                  <option value="all">Statuses (All)</option>
                  <option value="pending">Pending</option>
                  <option value="classifying">Classifying</option>
                  <option value="classified">Classified</option>
                  <option value="needs_review">Needs Review</option>
                  <option value="rejected">Rejected</option>
                  <option value="failed">Failed</option>
                </select>

                <select 
                  value={filterGrade}
                  onChange={e => setFilterGrade(e.target.value)}
                  className="border border-[#141414]/20 text-[9px] font-mono h-6 bg-white shrink-0"
                >
                  <option value="all">Grades (All)</option>
                  {dictionary.grades.map(g => (
                    <option key={g.id} value={g.id}>{g.nameFr}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-1.5 shrink-0">
                <Button 
                  onClick={handleClassifyAllPending}
                  disabled={isClassifyingAll || stagedPdfs.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-mono h-6 px-2 rounded-none"
                >
                  {isClassifyingAll ? (
                    <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Pipeline active</>
                  ) : (
                    <><Sparkles className="w-3 h-3 mr-1" /> Classify pending</>
                  )}
                </Button>

                <Button 
                  onClick={handleBuildCleanCopiesForSelected}
                  disabled={selectedForCombine.length === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[9px] font-mono h-6 px-1.5 rounded-none"
                  title={selectedForCombine.length === 0 ? "Select one or more PDFs first." : "Build clean stamped PDFs and JSON dataset rows for selected files"}
                >
                  <FolderArchive className="w-3 h-3 mr-1 bg-transparent" /> Build Copies
                </Button>
                
                <Button 
                  variant="outline"
                  onClick={() => {
                    setStagedPdfs([]);
                    toast.info("Cleared all staged elements.");
                  }}
                  className="border-[#141414]/20 hover:bg-neutral-100 text-[#141414] text-[9px] font-mono h-6 px-1.5 rounded-none"
                >
                  <Trash2 className="w-3 h-3 bg-transparent" />
                </Button>
              </div>
            </div>

            {/* Selection Status & Empty warning message */}
            {stagedPdfs.length > 0 && selectedForCombine.length === 0 && (
              <div id="selection-warning-banner" className="bg-amber-100/60 border border-amber-300 text-amber-800 p-2 text-[10px] font-mono leading-relaxed select-none shrink-0 mb-1">
                ⚠️ <span className="font-bold">PDFs are staged, but none are selected.</span> Use the checkbox beside each PDF or click Select All.
              </div>
            )}

            {/* Bulk Selection Toolbar */}
            {stagedPdfs.length > 0 && (
              <div className="bg-neutral-100 border border-neutral-300 p-2 text-[9.5px] font-mono select-none space-y-1.5 shrink-0 mb-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-neutral-700 uppercase tracking-tight">Bulk Staging Selection:</span>
                  <Badge variant="outline" className="border-blue-500 text-blue-600 bg-blue-50/50 font-bold font-mono py-0 h-4 rounded-none text-[9px]">
                    {selectedForCombine.length === 0 ? "0 selected" : `${selectedForCombine.length} selected`}
                  </Badge>
                </div>
                
                {/* Buttons: Select All, Select Classified, Select Needs Review, Select OCR Needed, Clear Selection */}
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => handleBulkSelect("all")}
                    className="bg-white hover:bg-neutral-200 px-1.5 py-0.5 border border-neutral-300 text-[8px] transition-colors font-mono"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => handleBulkSelect("classified")}
                    className="bg-white hover:bg-neutral-200 px-1.5 py-0.5 border border-neutral-300 text-[8px] transition-colors font-mono"
                  >
                    Select Classified
                  </button>
                  <button
                    onClick={() => handleBulkSelect("needs_review")}
                    className="bg-white hover:bg-neutral-200 px-1.5 py-0.5 border border-neutral-300 text-[8px] transition-colors font-mono"
                  >
                    Select Needs Review
                  </button>
                  <button
                    onClick={() => handleBulkSelect("ocr_needed")}
                    className="bg-white hover:bg-neutral-200 px-1.5 py-0.5 border border-neutral-300 text-[8px] transition-colors font-mono"
                  >
                    Select OCR Needed
                  </button>
                  <button
                    onClick={() => handleBulkSelect("clear")}
                    className="bg-white hover:bg-neutral-200 px-1.5 py-0.5 border border-neutral-300 text-[8px] text-red-650 transition-colors font-bold font-mono"
                  >
                    Clear Selection
                  </button>
                </div>

                {/* Bulk actions list */}
                <div className="flex flex-wrap gap-1 pt-1.5 border-t border-dashed border-neutral-300">
                  <Button
                    onClick={handleBuildCleanCopiesForSelected}
                    disabled={selectedForCombine.length === 0}
                    title={selectedForCombine.length === 0 ? "Select one or more PDFs first." : "Build clean stamped PDFs and JSON dataset rows for selected files"}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[8px] font-mono h-[20px] px-1.5 rounded-none shadow-none"
                  >
                    Build Clean Copies for Selected
                  </Button>

                  <Button
                    onClick={handleRunOcrForSelected}
                    disabled={selectedForCombine.length === 0}
                    title={selectedForCombine.length === 0 ? "Select one or more PDFs first." : "Run Gemini OCR fallback on selected files"}
                    className="bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-[#E4E3E0] text-[8px] font-mono h-[20px] px-1.5 rounded-none shadow-none"
                  >
                    Run OCR for Selected
                  </Button>

                  <Button
                    onClick={() => handleMergeSelected()}
                    disabled={selectedForCombine.length === 0}
                    title={selectedForCombine.length === 0 ? "Select one or more PDFs first." : "Combine selected classified documents together"}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[8px] font-mono h-[20px] px-1.5 rounded-none shadow-none"
                  >
                    Merge Selected
                  </Button>

                  <Button
                    onClick={handleExportSelected}
                    disabled={selectedForCombine.length === 0}
                    title={selectedForCombine.length === 0 ? "Select one or more PDFs first." : "Export metadata JSON of selected elements"}
                    className="bg-[#141414] hover:bg-neutral-800 disabled:opacity-40 text-white text-[8px] font-mono h-[20px] px-1.5 rounded-none shadow-none"
                  >
                    Export Selected
                  </Button>

                  <Button
                    onClick={handleZipDownloadSelected}
                    disabled={selectedForCombine.length === 0}
                    title={selectedForCombine.length === 0 ? "Select one or more PDFs first." : "Download systematically named archives of selected files"}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-[8px] font-mono h-[20px] px-1.5 rounded-none shadow-none"
                  >
                    Download ZIP Selected
                  </Button>
                </div>
              </div>
            )}

            {/* Interactive list of staged PDFs */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <ScrollArea className="flex-grow border border-neutral-200 min-h-0 bg-neutral-50/20 p-2">
                {stagedPdfs.length === 0 ? (
                  <div className="h-[250px] flex flex-col items-center justify-center text-center p-6">
                    <Layers className="w-10 h-10 opacity-20 text-neutral-400 mb-2" />
                    <p className="text-[11px] font-mono font-bold text-amber-600 mb-1">Staging Area Empty</p>
                    <p className="text-[10.5px] font-serif italic text-neutral-500">No PDFs staged yet. Crawl or discover PDFs first.</p>
                  </div>
                ) : filteredStaged.length === 0 ? (
                  <div className="h-[250px] flex flex-col items-center justify-center text-center p-6">
                    <Layers className="w-10 h-10 opacity-20 text-neutral-400 mb-2" />
                    <p className="text-[10px] font-serif italic text-neutral-400">No staged PDFs match active filters.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredStaged.map((item, idx) => {
                      const realIndex = stagedPdfs.findIndex(p => p.url === item.url);
                      const isInspected = activeInspectedIndex === realIndex;
                      const isStagedChecked = selectedForCombine.includes(item.url);
                      
                      // Status Badge classes
                      let badgeColor = "bg-gray-100 text-gray-800";
                      if (item.status === "classifying") badgeColor = "bg-blue-100 text-blue-800 animate-pulse";
                      else if (item.status === "classified") badgeColor = "bg-emerald-100 text-emerald-800 border border-emerald-200";
                      else if (item.status === "needs_review") badgeColor = "bg-amber-100 text-amber-850 border border-amber-200";
                      else if (item.status === "rejected") badgeColor = "bg-red-50 text-red-700 border border-red-100";
                      else if (item.status === "failed") badgeColor = "bg-red-100 text-red-800";
 
                      return (
                        <div 
                          key={idx} 
                          className={`border p-3 transition-all flex gap-3 ${
                            item.status === "rejected" ? "border-red-200 bg-red-50/10" : 
                            item.status === "needs_review" ? "border-amber-200 bg-amber-50/10" :
                            isInspected ? "border-[#141414] bg-neutral-50/50" : "border-neutral-200 bg-white"
                          }`}
                        >
                          {/* Checkbox */}
                          <div className="pt-0.5 shrink-0 flex items-start">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedForCombine(prev => 
                                  isStagedChecked ? prev.filter(u => u !== item.url) : [...prev, item.url]
                                );
                              }}
                              className="text-neutral-500 hover:text-neutral-900 transition-colors focus:outline-none"
                              title="Select this document"
                            >
                              {isStagedChecked ? (
                                <CheckSquare className="w-4 h-4 text-blue-600" />
                              ) : (
                                <Square className="w-4 h-4 text-neutral-400" />
                              )}
                            </button>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-2">
                              <div className="truncate flex-1">
                                <span className="text-[8px] font-mono text-zinc-400 truncate block">ORIGINAL: {item.originalName}</span>
                                <div className="font-bold text-[11px] text-zinc-900 truncate mt-0.5 leading-snug">
                                  {item.cleanTitle || item.originalName}
                                </div>
                                {(() => {
                                  const qItem = ocrQueue.find(qi => qi.pdfHash === item.hash);
                                  if (!qItem) return null;
                                  const statusColors: Record<string, string> = {
                                    queued: "bg-blue-50 text-blue-800 border-blue-200/50",
                                    running: "bg-emerald-50 text-emerald-850 border-emerald-200/50 animate-pulse",
                                    waiting_delay: "bg-amber-50 text-amber-800 border-amber-200/50",
                                    rate_limited: "bg-red-50 text-red-800 border-red-200/50 font-bold",
                                    retrying: "bg-orange-50 text-orange-800 border-orange-200/50",
                                    done: "bg-neutral-50 text-neutral-650 border-neutral-200/50",
                                    failed: "bg-rose-50 text-rose-800 border-rose-200/50",
                                    paused: "bg-zinc-50 text-zinc-800 border-zinc-200/50"
                                  };
                                  return (
                                    <div className={`mt-1.5 flex flex-wrap items-center gap-1 p-1 border text-[8px] font-mono rounded-none ${statusColors[qItem.status] || "bg-neutral-50"}`}>
                                      <span className="font-bold uppercase">OCR Queue: {qItem.status}</span>
                                      <span>•</span>
                                      <span>Page {qItem.currentPage || 0}/{qItem.totalPages || "?"}</span>
                                      {qItem.delayCountdown > 0 && (
                                        <>
                                          <span>•</span>
                                          <span className="font-bold text-amber-700">⏳ {qItem.delayCountdown}s delay</span>
                                        </>
                                      )}
                                      {qItem.retryCount > 0 && (
                                        <>
                                          <span>•</span>
                                          <span>Attempt {qItem.retryCount}</span>
                                        </>
                                      )}
                                      {qItem.errorMessage && (
                                        <div className="w-full text-[7.5px] text-red-600 mt-1 uppercase truncate" title={qItem.errorMessage}>
                                          Error: {qItem.errorMessage}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <Badge className={`${badgeColor} rounded-none text-[8px] font-mono px-1 h-4 shrink-0 shadow-none`}>
                                {item.status.toUpperCase()}
                              </Badge>
                            </div>

                          {/* Classification Properties (Manual Overrides & Values representation) */}
                          <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-dashed border-neutral-100 select-none">
                            <div className="space-y-0.5">
                              <span className="text-[8px] font-mono opacity-50 block">Grade Classification</span>
                              <select 
                                value={item.gradeId || ""}
                                onChange={e => handleManualOverride(realIndex, "gradeId", e.target.value)}
                                className="w-full text-[9px] font-mono border border-neutral-200 bg-white h-5 focus:outline-none"
                              >
                                <option value="">(Unassigned)</option>
                                {dictionary.grades.map(g => (
                                  <option key={g.id} value={g.id}>{g.nameFr} ({g.suffix})</option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-0.5">
                              <span className="text-[8px] font-mono opacity-50 block">Subject Classification</span>
                              <select 
                                value={item.subjectId || ""}
                                onChange={e => handleManualOverride(realIndex, "subjectId", e.target.value)}
                                className="w-full text-[9px] font-mono border border-neutral-200 bg-white h-5 focus:outline-none"
                              >
                                <option value="">(Unassigned)</option>
                                {dictionary.subjects.map(s => (
                                  <option key={s.id} value={s.id}>{s.nameFr} ({s.suffix})</option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-0.5">
                              <span className="text-[8px] font-mono opacity-50 block">Topic Classification</span>
                              <select 
                                value={item.topicId || ""}
                                onChange={e => handleManualOverride(realIndex, "topicId", e.target.value)}
                                className="w-full text-[9px] font-mono border border-neutral-200 bg-white h-5 focus:outline-none"
                              >
                                <option value="">(Unassigned/General)</option>
                                {dictionary.topics.map(t => (
                                  <option key={t.id} value={t.id}>{t.nameFr} ({t.suffix})</option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-0.5">
                              <span className="text-[8px] font-mono opacity-50 block">Document Type</span>
                              <select 
                                value={item.documentTypeId || ""}
                                onChange={e => handleManualOverride(realIndex, "documentTypeId", e.target.value)}
                                className="w-full text-[9px] font-mono border border-neutral-200 bg-white h-5 focus:outline-none"
                              >
                                <option value="">(Unassigned)</option>
                                {dictionary.allowedDocumentTypes.map(d => (
                                  <option key={d.id} value={d.id}>{d.nameFr} ({d.suffix})</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Extra info & overwrite checks */}
                          {item.renamePattern && (
                            <div className="mt-2 text-[8px] font-mono bg-blue-50/50 p-1.5 border border-blue-200/30 font-semibold select-all text-blue-900 truncate">
                              🔑 SUGGESTED NAME: {item.renamePattern}
                            </div>
                          )}

                          {item.reason && (
                            <div className="mt-1.5 text-[9px] font-serif text-neutral-500 italic leading-snug p-1 border border-neutral-100 bg-neutral-50 max-h-12 overflow-y-auto">
                              Reason: {item.reason}
                            </div>
                          )}

                          {/* Trigger actions */}
                          <div className="flex gap-2 justify-between items-center mt-3 pt-2 border-t border-neutral-100 select-none">
                            <div className="flex gap-2">
                              <button 
                                onClick={() => setActiveInspectedIndex(isInspected ? null : realIndex)}
                                className="text-[9px] font-mono text-neutral-500 hover:text-neutral-900 hover:underline flex items-center gap-0.5"
                              >
                                {isInspected ? "Collapse View" : "Preview Details"} 
                                {isInspected ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </button>
                              
                              <div className="flex items-center gap-1 text-[9px] font-mono ml-2">
                                <span className="opacity-60">Status:</span>
                                <button 
                                  onClick={() => handleManualOverride(realIndex, "isMatch", !item.isMatch)}
                                  className={`px-1 rounded font-bold ${
                                    item.isMatch ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
                                  }`}
                                >
                                  {item.isMatch ? "MATCH (RETAINED)" : "REJECTED"}
                                </button>
                              </div>
                            </div>

                            <div className="flex gap-1.5 align-middle">
                              <Button
                                onClick={() => handlePipelineProcessSingle(realIndex)}
                                disabled={item.status === "classifying"}
                                className="bg-[#141414] text-[#E4E3E0] hover:bg-neutral-800 text-[9px] font-mono h-6 px-2.5 rounded-none"
                              >
                                {item.status === "classifying" ? "Processing..." : "Process Pipeline"}
                              </Button>

                              <button 
                                onClick={() => setStagedPdfs(prev => prev.filter((_, i) => i !== realIndex))}
                                className="text-red-500 hover:text-red-700 p-1 bg-transparent border-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Inspection panel */}
                          {isInspected && (
                            <div className="mt-3 p-3 border border-neutral-200 bg-neutral-100/50 space-y-3 max-h-[300px] overflow-y-auto leading-relaxed">
                              {/* Layout of Pipeline parameters */}
                              <div className="grid grid-cols-2 gap-3 text-[10px] font-mono border-b border-dashed border-neutral-200 pb-2 bg-white/50 p-2">
                                <div>
                                  <span className="opacity-60 block text-[8px]">SHA-256 HASH</span>
                                  <span className="font-bold text-neutral-800 break-all select-all">{item.hash || "NOT COMPUTED"}</span>
                                </div>
                                <div className="truncate">
                                  <span className="opacity-60 block text-[8px]">SOURCE URL</span>
                                  <span className="font-bold text-zinc-650 truncate block select-all" title={item.url}>{item.url}</span>
                                </div>
                                <div>
                                  <span className="opacity-60 block text-[8px]">TEXT EXTRACTION</span>
                                  <span className="font-bold text-neutral-800 capitalize">{item.extractionStatus || "PENDING"}</span>
                                </div>
                                <div>
                                  <span className="opacity-60 block text-[8px]">TEXT QUALITY SCORE</span>
                                  <span className="font-bold text-neutral-800">
                                    {item.textQualityScore !== undefined ? `${item.textQualityScore}/100` : "PENDING"}
                                    {item.textQualityScore !== undefined && item.textQualityScore < 65 && " (WEAK/LOW)"}
                                  </span>
                                </div>
                                <div>
                                  <span className="opacity-60 block text-[8px]">OCR Fallback DIGITIZATION</span>
                                  <span className="font-bold text-neutral-800 capitalize">{item.ocrStatus || "PENDING"}</span>
                                </div>
                                <div>
                                  <span className="opacity-60 block text-[8px]">CLEAN COPY EXPORT</span>
                                  <span className="font-bold text-neutral-800 capitalize">{item.cleanCopyStatus || "PENDING"}</span>
                                </div>
                                <div className="col-span-2">
                                  <span className="opacity-60 block text-[8px]">CLEAN FILENAME</span>
                                  <span className="font-bold text-zinc-700 block truncate text-[9px] select-all">{item.cleanFilename || "NOT GENERATED"}</span>
                                </div>
                              </div>

                              {item.confidenceScore !== undefined && (
                                <div className="text-[10px] font-mono bg-white p-2 border border-neutral-200 grid grid-cols-2 gap-2">
                                  <div>
                                    <span className="opacity-65 block text-[8px]">CONFIDENCE SCORE</span>
                                    <span className="font-bold text-neutral-800">{(item.confidenceScore * 100).toFixed(0)}%</span>
                                  </div>
                                  <div>
                                    <span className="opacity-65 block text-[8px]">MATCHED REF TERMS</span>
                                    <span className="font-bold text-zinc-700 truncate block text-[9px]" title={item.matchedTerms?.join(", ")}>
                                      {item.matchedTerms && item.matchedTerms.length > 0 ? item.matchedTerms.join(", ") : "(None)"}
                                    </span>
                                  </div>
                                </div>
                              )}

                              {/* Interactive controllers */}
                              <div className="flex flex-wrap gap-2 select-none border-b border-neutral-200 pb-2">
                                <Button
                                  onClick={() => handlePipelineProcessSingle(realIndex)}
                                  className="bg-blue-650 hover:bg-blue-700 text-white font-mono text-[9px] h-6 px-2 rounded-none shadow-none"
                                >
                                  Process & Classify Pipeline
                                </Button>

                                <Button
                                  onClick={() => handleRunOcr(realIndex)}
                                  disabled={!item.hash || item.ocrStatus === "running"}
                                  className="bg-[#141414] hover:bg-neutral-800 text-[#E4E3E0] font-mono text-[9px] h-6 px-2 rounded-none shadow-none"
                                >
                                  {item.ocrStatus === "running" ? "Running Gemini OCR..." : "Run OCR fallback"}
                                </Button>

                                <Button
                                  onClick={() => handleBuildCleanCopy(realIndex)}
                                  disabled={!item.hash || !item.gradeId || !item.subjectId || !item.topicId || !item.documentTypeId}
                                  className="bg-emerald-600 hover:bg-emerald-700 font-mono text-white text-[9px] h-6 px-2 rounded-none shadow-none"
                                >
                                  Build Clean Copy & Row
                                </Button>
                              </div>

                              <div className="flex flex-wrap gap-2 select-none">
                                {item.hash && (
                                  <>
                                    <Button
                                      variant="outline"
                                      onClick={() => handleOpenCleanText(item.hash)}
                                      className="border-neutral-300 hover:bg-neutral-50 font-mono text-[9px] h-6 px-2 rounded-none"
                                    >
                                      Open Clean Text
                                    </Button>

                                    <Button
                                      variant="outline"
                                      onClick={() => handleDownloadCleanPdf(item.hash)}
                                      className="border-neutral-300 hover:bg-neutral-50 font-mono text-[9px] h-6 px-2 rounded-none"
                                    >
                                      Download Clean PDF
                                    </Button>
                                  </>
                                )}
                              </div>

                              <div className="font-bold font-mono text-[9px] uppercase tracking-wider text-neutral-500 block pt-1">Active text buffer snippet:</div>
                              <pre className="font-mono text-neutral-700 whitespace-pre-wrap select-all text-[8.5px] bg-white p-2 border border-neutral-200 max-h-[120px] overflow-y-auto">
                                {item.rawText || "No text parsed yet. Select 'Process Pipeline' or 'Run OCR' to fetch."}
                              </pre>
                            </div>
                          )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
              
              {/* Exporters and Reports block */}
              {stagedPdfs.length > 0 && (
                <div className="pt-3 shrink-0 select-none flex gap-2">
                  <Button
                    onClick={handleExportDatasetJsonl}
                    className="flex-1 bg-purple-700 hover:bg-purple-800 text-white font-mono rounded-none text-[8.5px] tracking-tight uppercase h-9 shadow-none"
                  >
                    <FileDown className="w-3.5 h-3.5 mr-1" /> Export Dataset JSONL
                  </Button>
                  <Button
                    onClick={handleExportReport}
                    className="flex-1 bg-[#141414] hover:bg-neutral-800 text-white font-mono rounded-none text-[8.5px] tracking-tight uppercase h-9 shadow-none"
                  >
                    <FileJson className="w-3.5 h-3.5 mr-1" /> Export Audit Report (JSON)
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* COLUMN 3: Renamer, Combiner, & Supabase Dictionary (Right Column, spanned 3 cols) */}
      <div className="col-span-1 lg:col-span-3 space-y-6">
        <Card className="rounded-none border-[#141414] shadow-none bg-white flex flex-col h-[580px] overflow-hidden">
          <Tabs defaultValue="combine" className="flex flex-col h-full">
            <TabsList className="grid grid-cols-2 rounded-none border-b border-[#141414] bg-neutral-100 p-0 h-10 divide-x divide-[#141414]">
              <TabsTrigger 
                value="combine" 
                className="rounded-none data-[state=active]:bg-white data-[state=active]:font-bold border-b-2 border-transparent data-[state=active]:border-b-[#141414] text-[10px] font-mono uppercase tracking-wider h-full flex items-center justify-center gap-1"
              >
                <Merge className="w-3.5 h-3.5 text-blue-600" /> Combine & Save
              </TabsTrigger>
              <TabsTrigger 
                value="dictionary" 
                className="rounded-none data-[state=active]:bg-white data-[state=active]:font-bold border-b-2 border-transparent data-[state=active]:border-b-[#141414] text-[10px] font-mono uppercase tracking-wider h-full flex items-center justify-center gap-1"
              >
                <Settings className="w-3.5 h-3.5 text-neutral-600" /> Dictionary DB
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: PDF Combining & Saving Panel */}
            <TabsContent value="combine" className="flex-1 flex flex-col m-0 p-4 overflow-hidden min-h-0 space-y-4">
              
              <div className="space-y-3 flex-1 flex flex-col min-h-0">
                <span className="text-[10px] font-mono uppercase tracking-wider opacity-60 font-bold block select-none">
                  Curriculum Groups Merge Workbench
                </span>
                
                <ScrollArea className="flex-1 border border-neutral-200 bg-neutral-50/50 p-2 min-h-0">
                  {Object.keys(groupedClassified).length === 0 ? (
                    <div className="h-[200px] flex flex-col items-center justify-center text-center p-4">
                      <Layers className="w-8 h-8 opacity-25 text-neutral-400 mb-1" />
                      <p className="text-[10px] font-serif italic text-neutral-400">No classified elements available to merge.</p>
                      <p className="text-[9px] font-mono mt-1 text-zinc-400">Classify documents first in the center dashboard!</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {Object.entries(groupedClassified).map(([groupKey, items]) => {
                        const [gradeId, subjectId, topicId] = groupKey.split("_");
                        const gradeSuffix = dictionary.grades.find(g => g.id === gradeId)?.suffix || "GEN";
                        const subjSuffix = dictionary.subjects.find(s => s.id === subjectId)?.suffix || "SUBJ";
                        const groupTitle = `${gradeSuffix} - ${subjSuffix} (${items.length} Files)`;

                        const docUrls = items.map(p => p.url);
                        
                        return (
                          <div key={groupKey} className="border border-neutral-200 bg-white p-2.5">
                            <div className="flex justify-between items-center pb-1.5 border-b border-neutral-100 mb-2">
                              <span className="font-mono text-[10.5px] font-bold text-neutral-900">{groupTitle}</span>
                              <Button
                                onClick={() => handleMergeSelected(docUrls, `${gradeSuffix}_${subjSuffix}_Combined`)}
                                disabled={isCombining}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[9px] h-5 px-1.5 rounded-none flex items-center gap-0.5 shadow-none"
                              >
                                <Merge className="w-2.5 h-2.5" /> Combine Group
                              </Button>
                            </div>

                            <div className="space-y-1">
                              {items.map((item, idy) => (
                                <div key={idy} className="flex items-center justify-between text-[9px] font-mono text-neutral-600 gap-1 pl-1">
                                  <span className="truncate flex-1">• {item.cleanTitle || item.originalName}</span>
                                  <span className="shrink-0 text-zinc-400 text-[8px]">({item.documentTypeId || "doc"})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>

                {/* Individual check list combining tool */}
                <div className="border-t border-neutral-200 pt-3 flex-1 flex flex-col min-h-0 select-none">
                  <span className="text-[9px] font-mono uppercase tracking-wider opacity-60 font-bold block mb-2">
                    Bulk checked merging & archiving
                  </span>
                  
                  <ScrollArea className="flex-1 border border-neutral-200 bg-neutral-50/50 p-2 min-h-0 mb-3">
                    {stagedPdfs.filter(p => p.status === "classified").length === 0 ? (
                      <p className="text-[10px] font-serif italic text-neutral-400 text-center pt-8">No classified elements available to select.</p>
                    ) : (
                      <div className="space-y-1">
                        {stagedPdfs.filter(p => p.status === "classified").map((item, index) => {
                          const isChecked = selectedForCombine.includes(item.url);
                          return (
                            <div 
                              key={index}
                              onClick={() => {
                                setSelectedForCombine(prev => 
                                  isChecked ? prev.filter(u => u !== item.url) : [...prev, item.url]
                                );
                              }}
                              className="flex items-center gap-2 p-1 border border-transparent hover:bg-neutral-100 cursor-pointer text-[10px] font-mono text-zinc-700"
                            >
                              {isChecked ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" /> : <Square className="w-3.5 h-3.5" />}
                              <span className="truncate flex-1">{item.cleanTitle || item.originalName}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>

                  {/* Input filename & combines */}
                  <div className="space-y-2 shrink-0">
                    <Input 
                      value={customMergeName}
                      onChange={e => setCustomMergeName(e.target.value)}
                      placeholder="Merged document filename"
                      className="rounded-none border-[#141414] h-7 text-[10px]"
                    />
                    
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        onClick={() => handleMergeSelected()}
                        disabled={isCombining || selectedForCombine.length < 2}
                        className="bg-neutral-900 text-white hover:bg-neutral-800 text-[9px] font-mono rounded-none h-8 px-2"
                      >
                        <Merge className="w-3 h-3 mr-1" /> Combine Selected
                      </Button>

                      <Button
                        onClick={handleZipDownloadSelected}
                        disabled={isDownloadingZip || selectedForCombine.length === 0}
                        className="bg-emerald-600 text-white hover:bg-emerald-700 text-[9px] font-mono rounded-none h-8 px-1"
                      >
                        <FolderArchive className="w-3 h-3 mr-1" /> Download Named ZIP
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: Supabase Dictionary reference manager */}
            <TabsContent value="dictionary" className="flex-1 flex flex-col m-0 p-4 overflow-hidden min-h-0 space-y-3">
              
              <div className="flex justify-between items-center select-none shrink-0">
                <span className="text-[10px] font-mono uppercase tracking-wider opacity-60 font-bold">
                  Reference Dictionary
                </span>
                <Button 
                  onClick={handleCommitDictionaryToDb}
                  disabled={savingDictionary}
                  className="bg-neutral-900 text-[#E4E3E0] hover:bg-neutral-800 text-[9px] font-mono h-6 px-2 rounded-none flex items-center gap-1 shrink-0"
                >
                  <Save className="w-3 h-3" /> Commit Changes
                </Button>
              </div>

              {/* Dictionary selector tabs */}
              <div className="flex border border-[#141414]/20 select-none shrink-0">
                {(["grades", "subjects", "topics", "docs"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveDictSubTab(tab)}
                    className={`flex-1 text-[9px] font-mono py-1 capitalize border-r border-[#141414]/15 last:border-0 transition-colors ${
                      activeDictSubTab === tab ? "bg-neutral-200 font-bold" : "bg-white hover:bg-neutral-100"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Editor List */}
              <ScrollArea className="flex-1 border border-neutral-200 bg-neutral-50/50 p-2 min-h-0">
                
                {activeDictSubTab === "grades" && (
                  <div className="space-y-3.5">
                    <div className="bg-white border rounded p-2 text-[10px] space-y-1.5 shrink-0">
                      <span className="font-bold font-mono text-[9px] tracking-wider text-[#141414] uppercase">Create Grade</span>
                      <Input 
                        placeholder="Grade ID e.g. 1ere_annee_college" 
                        value={newGrade.id} 
                        onChange={e => setNewGrade({...newGrade, id: e.target.value})}
                        className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          placeholder="Arabic Name" 
                          value={newGrade.nameAr} 
                          onChange={e => setNewGrade({...newGrade, nameAr: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                        <Input 
                          placeholder="French Name" 
                          value={newGrade.nameFr} 
                          onChange={e => setNewGrade({...newGrade, nameFr: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          placeholder="Suffix e.g. 1AC" 
                          value={newGrade.suffix} 
                          onChange={e => setNewGrade({...newGrade, suffix: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                        <Input 
                          placeholder="Keywords e.g. 1ac, 1ere" 
                          value={newGrade.keywords} 
                          onChange={e => setNewGrade({...newGrade, keywords: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                      </div>
                      <Button onClick={handleAddGrade} size="sm" className="w-full text-[9px] font-mono h-6 bg-blue-600 hover:bg-blue-700 text-white rounded-none">
                        <Plus className="w-3 h-3 mr-1" /> Add Grade element
                      </Button>
                    </div>

                    <div className="space-y-1.5 select-none">
                      {dictionary.grades?.map((item, i) => (
                        <div key={i} className="border border-neutral-200 bg-white p-2 text-[10px] flex justify-between items-start">
                          <div>
                            <div className="font-bold text-[#141414] font-mono">{item.id} ({item.suffix})</div>
                            <div className="text-[9px] text-zinc-500 font-serif">{item.nameFr} | {item.nameAr}</div>
                            <div className="text-[8px] opacity-60 font-mono mt-1">Triggers: {item.keywords?.join(", ")}</div>
                          </div>
                          <button 
                            onClick={() => setDictionary(prev => ({...prev, grades: prev.grades.filter((_, id) => id !== i)}))}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeDictSubTab === "subjects" && (
                  <div className="space-y-3.5">
                    <div className="bg-white border rounded p-2 text-[10px] space-y-1.5 shrink-0">
                      <span className="font-bold font-mono text-[9px] tracking-wider text-[#141414] uppercase">Create Subject</span>
                      <Input 
                        placeholder="Subject ID e.g. math" 
                        value={newSubject.id} 
                        onChange={e => setNewSubject({...newSubject, id: e.target.value})}
                        className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          placeholder="Arabic Name" 
                          value={newSubject.nameAr} 
                          onChange={e => setNewSubject({...newSubject, nameAr: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                        <Input 
                          placeholder="French Name" 
                          value={newSubject.nameFr} 
                          onChange={e => setNewSubject({...newSubject, nameFr: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          placeholder="Suffix e.g. MATH" 
                          value={newSubject.suffix} 
                          onChange={e => setNewSubject({...newSubject, suffix: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                        <Input 
                          placeholder="Keywords e.g. calculation, math" 
                          value={newSubject.keywords} 
                          onChange={e => setNewSubject({...newSubject, keywords: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                      </div>
                      <Button onClick={handleAddSubject} size="sm" className="w-full text-[9px] font-mono h-6 bg-blue-600 hover:bg-blue-700 text-white rounded-none">
                        <Plus className="w-3 h-3 mr-1" /> Add Subject element
                      </Button>
                    </div>

                    <div className="space-y-1.5 select-none">
                      {dictionary.subjects?.map((item, i) => (
                        <div key={i} className="border border-neutral-200 bg-white p-2 text-[10px] flex justify-between items-start">
                          <div>
                            <div className="font-bold text-[#141414] font-mono">{item.id} ({item.suffix})</div>
                            <div className="text-[9px] text-zinc-500 font-serif">{item.nameFr} | {item.nameAr}</div>
                            <div className="text-[8px] opacity-60 font-mono mt-1">Triggers: {item.keywords?.join(", ")}</div>
                          </div>
                          <button 
                            onClick={() => setDictionary(prev => ({...prev, subjects: prev.subjects.filter((_, id) => id !== i)}))}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeDictSubTab === "topics" && (
                  <div className="space-y-3.5">
                    <div className="bg-white border rounded p-2 text-[10px] space-y-1.5 shrink-0">
                      <span className="font-bold font-mono text-[9px] tracking-wider text-[#141414] uppercase">Create Topic</span>
                      <Input 
                        placeholder="Topic ID e.g. equations" 
                        value={newTopic.id} 
                        onChange={e => setNewTopic({...newTopic, id: e.target.value})}
                        className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          placeholder="Arabic Name" 
                          value={newTopic.nameAr} 
                          onChange={e => setNewTopic({...newTopic, nameAr: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                        <Input 
                          placeholder="French Name" 
                          value={newTopic.nameFr} 
                          onChange={e => setNewTopic({...newTopic, nameFr: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          value={newTopic.subjectId}
                          onChange={e => setNewTopic({...newTopic, subjectId: e.target.value})}
                          className="w-full border border-neutral-200 h-6 text-[9px] font-mono px-1 bg-white select-all"
                        >
                          <option value="">Subject?</option>
                          {dictionary.subjects?.map(s => (
                            <option key={s.id} value={s.id}>{s.nameFr}</option>
                          ))}
                        </select>
                        <Input 
                          placeholder="Suffix e.g. EQ" 
                          value={newTopic.suffix} 
                          onChange={e => setNewTopic({...newTopic, suffix: e.target.value})}
                          className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                        />
                      </div>
                      <Input 
                        placeholder="Keywords e.g. equation, inequation" 
                        value={newTopic.keywords} 
                        onChange={e => setNewTopic({...newTopic, keywords: e.target.value})}
                        className="h-6 rounded-none border-[#141414]/30 text-[9px]"
                      />
                      <Button onClick={handleAddTopic} size="sm" className="w-full text-[9px] font-mono h-6 bg-blue-600 hover:bg-blue-700 text-white rounded-none">
                        <Plus className="w-3 h-3 mr-1" /> Add Topic element
                      </Button>
                    </div>

                    <div className="space-y-1.5 select-none">
                      {dictionary.topics?.map((item, i) => (
                        <div key={i} className="border border-neutral-200 bg-white p-2 text-[10px] flex justify-between items-start">
                          <div>
                            <div className="font-bold text-[#141414] font-mono">{item.id} ({item.suffix})</div>
                            <div className="text-[9px] text-[#141414] font-semibold font-mono">Owner: {item.subjectId}</div>
                            <div className="text-[9px] text-zinc-500 font-serif">{item.nameFr} | {item.nameAr}</div>
                            <div className="text-[8px] opacity-60 font-mono mt-1">Triggers: {item.keywords?.join(", ")}</div>
                          </div>
                          <button 
                            onClick={() => setDictionary(prev => ({...prev, topics: prev.topics.filter((_, id) => id !== i)}))}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeDictSubTab === "docs" && (
                  <div className="space-y-1.5">
                    {dictionary.allowedDocumentTypes?.map((item, i) => (
                      <div key={i} className="border border-neutral-200 bg-white p-2.5 text-[10px] font-mono">
                        <div className="font-bold text-[#141414]">{item.id} ({item.suffix})</div>
                        <div className="text-[9px] text-zinc-500 font-serif">{item.nameFr} | {item.nameAr}</div>
                        <div className="text-[8px] opacity-60 mt-1 block">Triggers: {item.keywords?.join(", ")}</div>
                      </div>
                    ))}
                  </div>
                )}
                
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </Card>
      </div>

    </div>
  );
}
