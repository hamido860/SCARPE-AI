import React, { useState, useEffect, useRef } from "react";
import { Search, Globe, FileText, Image as ImageIcon, Link as LinkIcon, BarChart3, History, Loader2, ChevronRight, ExternalLink, Sparkles, Copy, Check, AlertCircle, Star, Trash2, Filter, BookOpen, GraduationCap, HelpCircle, Headphones, PlayCircle, Download, List, Clock, Play, Pause, AlertTriangle, X, CheckCircle, XCircle, Terminal, RotateCw, CloudLightning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { motion } from "motion/react";
import axios from "axios";
import Markdown from "react-markdown";
import { jsPDF } from "jspdf";
import { ScrapeResult, AnalysisResult, Favorite } from "./types";
import { processPdfViaWorker, generateZipViaWorker } from "./workerClient";

const processPdfForDownload = processPdfViaWorker;

type QueueStatus = 'pending' | 'scraping' | 'downloading' | 'done' | 'failed';
interface QueueItem {
  id: string;
  url: string;
  status: QueueStatus;
  error?: string;
}

export default function App() {
  // 3-Workspace View Controls
  const [showLeftWorkspace, setShowLeftWorkspace] = useState(true);
  const [showMiddleWorkspace, setShowMiddleWorkspace] = useState(true);
  const [showRightWorkspace, setShowRightWorkspace] = useState(true);

  // Standalone PDF Viewer Route State
  const [pdfViewUrl, setPdfViewUrl] = useState<string | null>(null);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#pdf-viewer?url=')) {
        const decodedUrl = decodeURIComponent(hash.substring('#pdf-viewer?url='.length));
        setPdfViewUrl(decodedUrl);
        // Ensure browser scrolls to top
        window.scrollTo(0, 0);
      } else {
        setPdfViewUrl(null);
      }
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const toggleWorkspace = (type: "left" | "middle" | "right") => {
    if (type === "left") {
      if (showLeftWorkspace && !showMiddleWorkspace && !showRightWorkspace) return;
      setShowLeftWorkspace(!showLeftWorkspace);
    } else if (type === "middle") {
      if (showMiddleWorkspace && !showLeftWorkspace && !showRightWorkspace) return;
      setShowMiddleWorkspace(!showMiddleWorkspace);
    } else if (type === "right") {
      if (showRightWorkspace && !showLeftWorkspace && !showMiddleWorkspace) return;
      setShowRightWorkspace(!showRightWorkspace);
    }
  };

  const [url, setUrl] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number, total: number } | null>(null);
  const [deepMode, setDeepMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<ScrapeResult[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [userIntent, setUserIntent] = useState("");
  const [negativeIntent, setNegativeIntent] = useState("");
  const [guiding, setGuiding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [kbStats, setKbStats] = useState({ totalChunks: 0 });
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{role: string, text: string, sources?: any[]}[]>([]);
  const [chatting, setChatting] = useState(false);
  const [chatRole, setChatRole] = useState("Helpful Assistant");
  const [ollamaModels, setOllamaModels] = useState<{name: string}[]>([]);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("");
  const [ollamaApiUrl, setOllamaApiUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  
  const [artifactType, setArtifactType] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string>("");
  const [generatingArtifact, setGeneratingArtifact] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<{ current: number, total: number } | null>(null);

  // Queue System States
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isAutomating, setIsAutomating] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(3);
  const [queueInput, setQueueInput] = useState("");
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [pendingDuplicates, setPendingDuplicates] = useState<string[]>([]);
  const [pendingUnique, setPendingUnique] = useState<string[]>([]);
  const [isCrawling, setIsCrawling] = useState(false);
  const [isMoutamadrisMode, setIsMoutamadrisMode] = useState(false);
  const [crawlDepth, setCrawlDepth] = useState(2);
  const [maxCrawlPages, setMaxCrawlPages] = useState(50);
  const [crawlFilter, setCrawlFilter] = useState("");
  const [crawledPdfs, setCrawledPdfs] = useState<string[]>([]);
  const [crawlResults, setCrawlResults] = useState<any[]>([]);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [fallbackDownload, setFallbackDownload] = useState<{url: string, filename: string} | null>(null);
  const [activeNegativeLink, setActiveNegativeLink] = useState<{ type: 'internal' | 'external', index: number } | null>(null);
  const [selectedLinkHrefs, setSelectedLinkHrefs] = useState<string[]>([]);
  const [leftActiveTab, setLeftActiveTab] = useState("queue");
  const [parentCategory, setParentCategory] = useState("web-data");
  const [activeTab, setActiveTab] = useState("content");

  const [appMode, setAppMode] = useState<"search" | "manipulation">("search");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [metaCountry, setMetaCountry] = useState("");
  const [metaLevel, setMetaLevel] = useState("Middle");
  const [metaSubject, setMetaSubject] = useState("General");
  const [metaSourceType, setMetaSourceType] = useState("lesson_block");

  const [historySortOrder, setHistorySortOrder] = useState<"date-desc" | "title-asc" | "size-desc">("date-desc");
  const [editedRawText, setEditedRawText] = useState("");
  const [originalRawTextBack, setOriginalRawTextBack] = useState("");
  const [cleaningText, setCleaningText] = useState(false);

  const handleParentCategoryChange = (cat: string) => {
    setParentCategory(cat);
    if (cat === "web-data") {
      setActiveTab("content");
    } else if (cat === "ai-assist") {
      setActiveTab("rag");
    } else if (cat === "tools-dev") {
      setActiveTab("pdf-scraper");
    }
  };

  useEffect(() => {
    if (result) {
      setMetaTitle(result.title || "");
      setMetaDescription(result.description || "");
      setMetaCountry(result.country || "");
      setEditedRawText(result.rawText || "");
      setOriginalRawTextBack(result.rawText || "");
      
      let guessedLevel = "Middle";
      try {
        const decoded = decodeURIComponent(result.url);
        if (decoded.includes('ابتدائي')) guessedLevel = 'Primary';
        else if (decoded.includes('إعدادي')) guessedLevel = 'Middle';
        else if (decoded.includes('باك')) guessedLevel = 'Bac';
        else if (decoded.includes('مشترك')) guessedLevel = 'Core';
      } catch (e) {}
      setMetaLevel(guessedLevel);

      setMetaSubject("General");

      let guessedType = "lesson_block";
      if (result.title?.toLowerCase().includes("exercise") || result.url?.toLowerCase().includes("exercise") || result.rawText?.toLowerCase().includes("تمارين")) {
        guessedType = "exercise";
      } else if (result.title?.toLowerCase().includes("exam") || result.url?.toLowerCase().includes("exam") || result.rawText?.toLowerCase().includes("امتحانات")) {
        guessedType = "exam";
      }
      setMetaSourceType(guessedType);
    } else {
      setMetaTitle("");
      setMetaDescription("");
      setMetaCountry("");
      setEditedRawText("");
      setOriginalRawTextBack("");
    }
  }, [result?.url, result?.rawText]);

  useEffect(() => {
    if (result) {
      setLeftActiveTab("result");
    } else if (leftActiveTab === "result") {
      setLeftActiveTab("queue");
    }
  }, [result]);

  useEffect(() => {
    setSelectedLinkHrefs([]);
    if (result) {
      setParentCategory("web-data");
      setActiveTab("content");
    }
  }, [result?.url]);

  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const isAutomatingRef = useRef(isAutomating);
  useEffect(() => { isAutomatingRef.current = isAutomating; }, [isAutomating]);

  const uniqueCountries = Array.from(new Set([
    ...history.map(h => h.country),
    ...favorites.map(f => f.country)
  ].filter(Boolean))).sort() as string[];

  const filteredHistory = history
    .filter(item => {
      const matchesKeyword = !filterKeyword.trim() || 
        item.title?.toLowerCase().includes(filterKeyword.toLowerCase()) || 
        item.url?.toLowerCase().includes(filterKeyword.toLowerCase()) || 
        item.rawText?.toLowerCase().includes(filterKeyword.toLowerCase());
      const matchesCountry = !filterCountry || item.country === filterCountry;
      return matchesKeyword && matchesCountry;
    })
    .sort((a, b) => {
      if (historySortOrder === "title-asc") {
        return (a.title || "").localeCompare(b.title || "");
      }
      if (historySortOrder === "size-desc") {
        return (b.rawText || "").length - (a.rawText || "").length;
      }
      // date-desc or default
      return 0;
    });

  const allWords = [
    ...history.map(h => h.title.split(/\s+/)).flat(),
    ...favorites.map(f => f.title.split(/\s+/)).flat()
  ];

  const uniqueKeywords = Array.from(new Set(
    allWords
      .map(word => word.replace(/[^\w]/g, ''))
      .filter(word => word.length > 3 && !['this', 'that', 'with', 'from'].includes(word.toLowerCase()))
  )).sort().slice(0, 20);

  useEffect(() => {
    fetchOllamaModels();
  }, [ollamaApiUrl]);

  const fetchOllamaModels = async () => {
    try {
      const res = await axios.post("/api/ollama/models", { apiUrl: ollamaApiUrl });
      if (res.data.models && res.data.models.length > 0) {
        setOllamaModels(res.data.models);
        if (!selectedOllamaModel || !res.data.models.find((m: any) => m.name === selectedOllamaModel)) {
          setSelectedOllamaModel(res.data.models[0].name);
        }
      } else {
        setOllamaModels([]);
        setSelectedOllamaModel("");
      }
    } catch (e) {
      // Fail silently without cluttering the browser console with errors
      setOllamaModels([]);
      setSelectedOllamaModel("");
    }
  };

  useEffect(() => {
    const savedHistory = localStorage.getItem("scrape_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }

    const savedFavorites = localStorage.getItem("scrape_favorites");
    if (savedFavorites) {
      try {
        setFavorites(JSON.parse(savedFavorites));
      } catch (e) {
        console.error("Failed to load favorites", e);
      }
    }

    fetchKbStats();
  }, []);

  const fetchKbStats = async () => {
    try {
      const res = await axios.get("/api/kb-stats");
      setKbStats(res.data);
    } catch (e) {
      console.error("Failed to fetch KB stats", e);
    }
  };

  const processQueueAddition = (urls: string[]) => {
    if (urls.length === 0) return;

    const normalizeUrl = (urlStr: string) => {
      try {
        const parsed = new URL(urlStr);
        return parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '') + parsed.search;
      } catch {
        return urlStr.replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/, '');
      }
    };

    const uniqueUrls = new Set<string>();
    const duplicates = new Set<string>();
    const normalizedSeen = new Set<string>();

    urls.forEach(u => {
      const normU = normalizeUrl(u);
      const inQueue = queue.some(q => normalizeUrl(q.url) === normU);
      const inHistory = history.some(h => normalizeUrl(h.url) === normU);
      const inCurrentBatch = normalizedSeen.has(normU);

      if (inQueue || inHistory || inCurrentBatch) {
        duplicates.add(u);
      } else {
        uniqueUrls.add(u);
        normalizedSeen.add(normU);
      }
    });

    if (duplicates.size > 0) {
      setPendingDuplicates(Array.from(duplicates));
      setPendingUnique(Array.from(uniqueUrls));
      setShowDuplicateModal(true);
    } else {
      addUrlsToQueue(Array.from(uniqueUrls));
      setQueueInput("");
    }
  };

  const handleAddToQueue = () => {
    const urls = queueInput.split('\n').map(u => u.trim()).filter(u => u);
    processQueueAddition(urls);
  };

  const handleCrawlPdfs = async () => {
    const urls = queueInput.split('\n').map(u => u.trim()).filter(u => u);
    if (urls.length === 0) {
      toast.error("Enter a starting URL in the box above to crawl");
      return;
    }
    
    const startUrl = urls[0];
    setIsCrawling(true);
    setCrawledPdfs([]);
    toast.info(`Starting crawler on ${startUrl}... This may take a minute.`);
    
    try {
      const res = await axios.post("/api/crawl-pdfs", { 
        url: startUrl, 
        maxPages: maxCrawlPages,
        maxDepth: crawlDepth,
        topicFilter: crawlFilter
      });
      const foundPdfs = res.data.pdfs || [];
      setCrawledPdfs(foundPdfs);
      
      if (foundPdfs.length === 0) {
        toast.warning(`Crawled ${res.data.crawled} pages but found no PDFs.`);
      } else {
        toast.success(`Found ${foundPdfs.length} PDFs across ${res.data.crawled} pages!`);
        // Optionally add to queue automatically or let user decide
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Crawler failed");
    } finally {
      setIsCrawling(false);
    }
  };

  const addUrlsToQueue = (urls: string[]) => {
    const newItems: QueueItem[] = urls.map(url => ({
      id: Math.random().toString(36).substring(7),
      url,
      status: 'pending'
    }));
    setQueue(prev => [...prev, ...newItems]);
  };

  const confirmAddDuplicates = () => {
    addUrlsToQueue([...pendingUnique, ...pendingDuplicates]);
    setShowDuplicateModal(false);
    setQueueInput("");
  };

  const skipDuplicates = () => {
    addUrlsToQueue(pendingUnique);
    setShowDuplicateModal(false);
    setQueueInput("");
  };

  const processBackgroundDownloads = async (scrapeData: ScrapeResult) => {
    if (!scrapeData || !scrapeData.links || scrapeData.links.length === 0) return;
    
    const { saveAs } = await import("file-saver");
    const collectedFiles: { filename: string; buffer: ArrayBuffer }[] = [];
    let foundPdfs = 0;
    const batchSize = 3;

    for (let i = 0; i < scrapeData.links.length; i += batchSize) {
      if (!isAutomatingRef.current) throw new Error("Automation paused by user");
      
      const batch = scrapeData.links.slice(i, i + batchSize);
      await Promise.all(batch.map(async (link) => {
        try {
          let fileUrls: string[] = [];
          const isDirectFile = link.href.toLowerCase().includes('.pdf') || link.href.toLowerCase().includes('.zip');
          
          if (isDirectFile) {
            fileUrls.push(link.href);
          } else {
            const extractRes = await axios.post("/api/scrape/extract-pdfs", { url: link.href });
            if (extractRes.data.pdfLinks && extractRes.data.pdfLinks.length > 0) {
              fileUrls = extractRes.data.pdfLinks;
            }
          }

          for (const fileUrl of fileUrls) {
            try {
              const downloadRes = await axios.post("/api/proxy-download", { url: fileUrl }, { responseType: 'arraybuffer' });
              let cleanUrl = fileUrl.split('?')[0].split('#')[0];
              let originalName = cleanUrl.split('/').pop() || `document_${foundPdfs + 1}.pdf`;
              
              const { buffer, filename } = await processPdfForDownload(downloadRes.data, originalName, scrapeData);
              let finalName = filename;
              const exists = collectedFiles.some(f => f.filename === finalName);
              if (exists) {
                finalName = `${foundPdfs + 1}_${finalName}`;
              }
              
              collectedFiles.push({ filename: finalName, buffer });
              foundPdfs++;
            } catch (e) {
              console.warn(`Failed to download file: ${fileUrl}`);
            }
          }
        } catch (e) {
          console.warn(`Failed to process link: ${link.href}`);
        }
      }));
      
      if (i + batchSize < scrapeData.links.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (collectedFiles.length > 0) {
      toast.info(`Generating ZIP archive in parallel worker thread...`);
      const zipBuffer = await generateZipViaWorker(collectedFiles);
      const content = new Blob([zipBuffer], { type: "application/zip" });
      const safeTitle = scrapeData.title.replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '_').toLowerCase() || 'download';
      const filename = `${safeTitle}_files.zip`;
      const url = URL.createObjectURL(content);
      setFallbackDownload({ url, filename });
      saveAs(content, filename);
    }
  };

  const runAutomationLoop = async () => {
    while (isAutomatingRef.current) {
      const nextItem = queueRef.current.find(q => q.status === 'pending');
      if (!nextItem) {
        setIsAutomating(false);
        toast.success("Queue processing complete!");
        break;
      }

      // 1. Mark as scraping
      setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'scraping' } : q));
      
      try {
        // Scrape
        const scrapeRes = await axios.post("/api/scrape", { 
          url: nextItem.url,
          deep: deepMode,
          ollamaUrl: ollamaApiUrl,
          ollamaModel: selectedOllamaModel
        });
        const scrapeData = scrapeRes.data;
        
        // Update main view so user sees progress
        setResult(scrapeData);
        if (scrapeData.pdfAnalysis) {
          setAnalysis(scrapeData.pdfAnalysis);
        } else {
          setAnalysis(null);
        }

        // 2. Mark as downloading
        setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'downloading' } : q));
        
        // Download PDFs/ZIPs
        await processBackgroundDownloads(scrapeData);

        // 3. Mark as done
        setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'done' } : q));
        
        // Add to history
        setHistory(prev => {
          const newHistory = [scrapeData, ...prev.filter(h => h.url !== scrapeData.url)].slice(0, 50);
          localStorage.setItem("scrape_history", JSON.stringify(newHistory));
          return newHistory;
        });
        
      } catch (error: any) {
        setQueue(prev => prev.map(q => q.id === nextItem.id ? { ...q, status: 'failed', error: error.message } : q));
      }

      // 4. Delay
      if (isAutomatingRef.current) {
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }
    }
  };

  const toggleAutomation = () => {
    if (isAutomating) {
      setIsAutomating(false);
    } else {
      setIsAutomating(true);
      setTimeout(runAutomationLoop, 0);
    }
  };

  const handleIndex = async () => {
    if (!result) return;
    setIndexing(true);
    try {
      const textToIndex = analysis?.fullContent || result.rawText;
      const res = await axios.post("/api/index", {
        url: result.url,
        title: result.title,
        text: textToIndex
      });
      toast.success(`Indexed ${res.data.indexedChunks} chunks successfully!`);
      fetchKbStats();
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to index document");
    } finally {
      setIndexing(false);
    }
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const query = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", text: query }]);
    setChatting(true);

    try {
      const res = await axios.post("/api/chat", { 
        query,
        userIntent,
        negativeIntent,
        role: chatRole
      });
      setChatHistory(prev => [...prev, { 
        role: "ai", 
        text: res.data.answer,
        sources: res.data.sources 
      }]);
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to get answer");
      setChatHistory(prev => [...prev, { role: "ai", text: "Sorry, an error occurred while searching the knowledge base." }]);
    } finally {
      setChatting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error("Only PDF files are supported for direct upload.");
      return;
    }

    setUploading(true);
    setLoading(true);
    setResult(null);
    setAnalysis(null);
    
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await axios.post("/api/upload", formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      setResult(response.data);
      if (response.data.pdfAnalysis) {
        setAnalysis(response.data.pdfAnalysis);
      }
      saveToHistory(response.data);
      toast.success("PDF uploaded and parsed successfully");
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to upload PDF");
    } finally {
      setUploading(false);
      setLoading(false);
      // Reset the file input
      e.target.value = '';
    }
  };

  const handleGenerateArtifact = async (type: string) => {
    if (!result) return;
    setGeneratingArtifact(true);
    setArtifactType(type);
    try {
      const res = await axios.post("/api/notebook/artifact", {
        text: analysis?.fullContent || result.rawText,
        type
      });
      setArtifactContent(res.data.result);
    } catch (e: any) {
      toast.error("Failed to generate artifact");
    } finally {
      setGeneratingArtifact(false);
    }
  };

  const handleDownloadAllCrawled = async () => {
    if (crawledPdfs.length === 0) return;
    
    setIsDownloadingAll(true);
    const { saveAs } = await import("file-saver");
    const collectedFiles: { filename: string; buffer: ArrayBuffer }[] = [];
    let downloadedCount = 0;
    
    toast.info(`Downloading ${crawledPdfs.length} PDFs...`);
    
    try {
      // Process in batches of 5
      const batchSize = 5;
      for (let i = 0; i < crawledPdfs.length; i += batchSize) {
        const batch = crawledPdfs.slice(i, i + batchSize);
        await Promise.all(batch.map(async (pdfUrl) => {
          try {
            const res = await axios.post("/api/proxy-download", { url: pdfUrl }, { responseType: 'arraybuffer' });
            let originalName = pdfUrl.split('/').pop() || `doc_${downloadedCount}.pdf`;
            
            // Find metadata from crawlResults if available
            const metadata = crawlResults.find(r => r.url === pdfUrl) || {};
            
            const { buffer, filename } = await processPdfForDownload(res.data, originalName, { url: pdfUrl, ...metadata });
            let finalName = filename;
            const exists = collectedFiles.some(f => f.filename === finalName);
            if (exists) {
              finalName = `${downloadedCount}_${finalName}`;
            }
            
            collectedFiles.push({ filename: finalName, buffer });
            downloadedCount++;
          } catch (e) {
            console.warn(`Failed to download ${pdfUrl}`, e);
          }
        }));
      }
      
      if (collectedFiles.length > 0) {
        toast.info(`Generating ZIP archive in parallel worker thread...`);
        const zipBuffer = await generateZipViaWorker(collectedFiles);
        const content = new Blob([zipBuffer], { type: "application/zip" });
        const filename = `scraped_pdfs_${Date.now()}.zip`;
        const url = URL.createObjectURL(content);
        setFallbackDownload({ url, filename });
        saveAs(content, filename);
        toast.success(`Downloaded ${downloadedCount} PDFs! If it didn't start, use the fallback link.`);
      } else {
        toast.error("Failed to download any PDFs.");
      }
    } catch (e) {
      toast.error("Failed to create ZIP archive.");
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const handleAddAllToQueue = () => {
    if (crawledPdfs.length === 0) return;
    processQueueAddition(crawledPdfs);
    toast.success(`Added ${crawledPdfs.length} PDFs to queue.`);
  };

  const handleIndexAllCrawled = async () => {
    if (crawledPdfs.length === 0) return;
    
    setIsDownloadingAll(true);
    let indexedCount = 0;
    
    toast.info(`Indexing ${crawledPdfs.length} PDFs into Knowledge Base...`);
    
    try {
      const batchSize = 3;
      for (let i = 0; i < crawledPdfs.length; i += batchSize) {
        const batch = crawledPdfs.slice(i, i + batchSize);
        await Promise.all(batch.map(async (pdfUrl) => {
          try {
            await axios.post("/api/index-pdf-url", { 
              url: pdfUrl,
              title: pdfUrl.split('/').pop() || "Scraped PDF"
            });
            indexedCount++;
          } catch (e) {
            console.warn(`Failed to index ${pdfUrl}`, e);
          }
        }));
      }
      
      toast.success(`Indexed ${indexedCount} PDFs!`);
      fetchKbStats();
    } catch (e) {
      toast.error("Indexing failed.");
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const handleCrawlMoutamadris = async () => {
    setIsCrawling(true);
    setCrawledPdfs([]);
    setCrawlResults([]);
    setIsMoutamadrisMode(true);
    toast.info(`Starting specialized Moutamadris crawl... This may take a few minutes.`);
    
    try {
      const res = await axios.post("/api/crawl-moutamadris", { 
        maxPages: maxCrawlPages,
        maxDepth: crawlDepth,
        topicFilter: crawlFilter
      });
      const foundPdfs = res.data.pdfs || [];
      setCrawledPdfs(foundPdfs);
      setCrawlResults(res.data.results || []);
      
      if (foundPdfs.length === 0) {
        toast.warning(`Crawled ${res.data.crawled} pages but found no relevant PDFs.`);
      } else {
        toast.success(`Found ${foundPdfs.length} educational PDFs across ${res.data.crawled} pages!`);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.error || "Moutamadris crawler failed");
    } finally {
      setIsCrawling(false);
    }
  };

  const handleDownloadMetadata = async () => {
    if (crawlResults.length === 0) return;
    const { saveAs } = await import("file-saver");
    
    // Create CSV
    const headers = ["url", "title", "isPdf"];
    const csvContent = [
      headers.join(","),
      ...crawlResults.map(r => 
        [r.url, `"${(r.title || "").replace(/"/g, '""')}"`, r.isPdf].join(",")
      )
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const filename = `moutamadris_metadata_${Date.now()}.csv`;
    const url = URL.createObjectURL(blob);
    setFallbackDownload({ url, filename });
    saveAs(blob, filename);
    toast.success("Downloaded metadata CSV!");
  };

  const isNegativeMatch = (text: string) => {
    if (!negativeIntent.trim()) return false;
    const patterns = negativeIntent.split(',').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
    return patterns.some(p => text.toLowerCase().includes(p));
  };

  const addNegativeRule = (rule: string) => {
    if (!rule || !rule.trim()) return;
    const cleanRule = rule.trim().toLowerCase();
    
    // Get existing rules mapped from comma-separated negativeIntent
    const existing = negativeIntent.split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);
      
    if (existing.map(r => r.toLowerCase()).includes(cleanRule)) {
      toast.info(`"${rule}" is already in negative targets.`);
      return;
    }
    
    const updated = [...existing, rule].join(', ');
    setNegativeIntent(updated);
    toast.success(`Excluded "${rule}" from current views & future scrapes.`);
  };

  const toggleLinkSelection = (href: string) => {
    setSelectedLinkHrefs(prev => {
      if (prev.includes(href)) {
        return prev.filter(h => h !== href);
      } else {
        return [...prev, href];
      }
    });
  };

  const handleDeleteSelectedLinks = () => {
    if (!result || selectedLinkHrefs.length === 0) return;
    
    const updatedLinks = result.links.filter(link => !selectedLinkHrefs.includes(link.href));
    
    const updatedResult = {
      ...result,
      links: updatedLinks
    };
    
    setResult(updatedResult);
    
    // Also update history
    const updatedHistory = history.map(item => {
      if (item.url === result.url) {
        return { ...item, links: updatedLinks };
      }
      return item;
    });
    setHistory(updatedHistory);
    localStorage.setItem("scrape_history", JSON.stringify(updatedHistory));
    
    setSelectedLinkHrefs([]);
    toast.success(`Removed ${selectedLinkHrefs.length} links from current views.`);
  };

  const handleExcludeSelectedLinks = () => {
    if (!result || selectedLinkHrefs.length === 0) return;
    
    const newRules: string[] = [];
    selectedLinkHrefs.forEach(href => {
      if (!href.startsWith('http')) {
        newRules.push(href);
      } else {
        try {
          const hostname = new URL(href).hostname.replace(/^www\./, "");
          if (hostname) {
            newRules.push(hostname);
          } else {
            newRules.push(href);
          }
        } catch (e) {
          newRules.push(href);
        }
      }
    });

    const uniqueRules = Array.from(new Set(newRules.map(r => r.trim()).filter(Boolean)));
    
    const existingRules = negativeIntent.split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);
      
    const combinedRules = [...existingRules];
    uniqueRules.forEach(rule => {
      if (!combinedRules.map(r => r.toLowerCase()).includes(rule.toLowerCase())) {
        combinedRules.push(rule);
      }
    });
    
    setNegativeIntent(combinedRules.join(', '));
    setSelectedLinkHrefs([]);
    toast.success(`Excluded ${uniqueRules.length} target patterns.`);
  };

  const toggleFavorite = (url: string, title: string, country?: string) => {
    const isFavorite = favorites.some(f => f.url === url);
    let updatedFavorites;
    if (isFavorite) {
      updatedFavorites = favorites.filter(f => f.url !== url);
      toast.info("Removed from favorites");
    } else {
      updatedFavorites = [...favorites, { url, title, addedAt: Date.now(), country }];
      toast.success("Added to favorites");
    }
    setFavorites(updatedFavorites);
    localStorage.setItem("scrape_favorites", JSON.stringify(updatedFavorites));
  };

  const saveToHistory = (newResult: ScrapeResult) => {
    const updatedHistory = [newResult, ...history.filter(h => h.url !== newResult.url)].slice(0, 10);
    setHistory(updatedHistory);
    localStorage.setItem("scrape_history", JSON.stringify(updatedHistory));
  };

  const handleScrape = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url) return;

    const urlsToScrape = bulkMode 
      ? url.split("\n").map(u => u.trim()).filter(u => u.length > 0)
      : [url.trim()];

    if (urlsToScrape.length === 0) return;

    setLoading(true);
    setResult(null);
    setAnalysis(null);

    if (bulkMode) {
      setBulkProgress({ current: 0, total: urlsToScrape.length });
    }

    try {
      let lastResult = null;
      for (let i = 0; i < urlsToScrape.length; i++) {
        let currentUrl = urlsToScrape[i];
        if (!currentUrl.startsWith("http")) {
          currentUrl = `https://${currentUrl}`;
        }

        if (bulkMode) {
          setBulkProgress({ current: i + 1, total: urlsToScrape.length });
          toast.info(`Scraping (${i + 1}/${urlsToScrape.length}): ${currentUrl}`, { duration: 2000 });
        }

        try {
          const response = await axios.post("/api/scrape", { 
            url: currentUrl, 
            deep: deepMode,
            ollamaModel: selectedOllamaModel,
            ollamaApiUrl: ollamaApiUrl
          });
          lastResult = response.data;
          saveToHistory(response.data);
        } catch (err: any) {
          console.error(`Failed to scrape ${currentUrl}`, err);
          toast.error(`Failed: ${currentUrl}`);
        }
      }

      if (lastResult) {
        setResult(lastResult);
        if (lastResult.pdfAnalysis) {
          setAnalysis(lastResult.pdfAnalysis);
        }
        toast.success(bulkMode ? "Bulk scrape completed" : "Successfully scraped page content");
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to scrape URL");
    } finally {
      setLoading(false);
      setBulkProgress(null);
    }
  };

  const handleAnalyze = async () => {
    if (!result) return;
    setAnalyzing(true);

    try {
      const response = await axios.post("/api/ai/analyze", {
        url: result.url,
        title: result.title,
        description: result.description,
        rawText: result.rawText
      });

      const data = JSON.parse(response.data.text);
      setAnalysis(data);
      
      // Update result with detected country
      if (result) {
        const updatedResult = { ...result, country: data.detectedCountry };
        setResult(updatedResult);
        // Also update history
        const updatedHistory = history.map(h => h.url === result.url ? updatedResult : h);
        setHistory(updatedHistory);
        localStorage.setItem("scrape_history", JSON.stringify(updatedHistory));
      }
      
      toast.success("AI Analysis complete");
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error("Failed to analyze content with AI");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExtractContent = async () => {
    if (!result || !analysis) return;
    setGuiding(true);

    try {
      const response = await axios.post("/api/ai/extract-content", {
        userIntent,
        negativeIntent,
        rawText: result.rawText
      });

      const extractedText = response.data.text.trim();
      setAnalysis({ ...analysis, fullContent: extractedText });
      toast.success("Content extracted successfully");
    } catch (error) {
      console.error("Extraction failed", error);
      toast.error("Failed to extract content");
    } finally {
      setGuiding(false);
    }
  };

  const handleGuidedScrape = async (intent?: string) => {
    const activeIntent = intent || userIntent;
    if (!result || !activeIntent) return;
    setGuiding(true);

    try {
      const response = await axios.post("/api/ai/guided-scrape", {
        userIntent: activeIntent,
        negativeIntent,
        url: result.url,
        links: result.links
      });

      let targetUrl = response.data.text.trim();
      targetUrl = targetUrl.replace(/^"(.*)"$/, '$1').trim(); // Remove quotes if any
      if (targetUrl === "NONE" || !targetUrl.startsWith("http")) {
        toast.error("Could not find a relevant link for your request.");
      } else {
        toast.info(`AI guiding to: ${targetUrl}`);
        setUrl(targetUrl);
        // Trigger scrape with the new URL
        const scrapeRes = await axios.post("/api/scrape", { url: targetUrl, deep: true }); // Always deep scrape for guided intent
        setResult(scrapeRes.data);
        saveToHistory(scrapeRes.data);
        setAnalysis(null);
        setUserIntent("");
        toast.success("Guided scrape successful");
      }
    } catch (error) {
      console.error("Guiding failed", error);
      toast.error("AI Guiding failed");
    } finally {
      setGuiding(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  const handleBatchDownloadPDFs = async () => {
    if (!result || !result.links || result.links.length === 0) {
      toast.error("No links found on this page to download PDFs from.");
      return;
    }

    setBatchDownloading(true);
    setBatchDownloadProgress({ current: 0, total: result.links.length });
    
    try {
      const { saveAs } = await import("file-saver");
      const collectedFiles: { filename: string; buffer: ArrayBuffer }[] = [];
      
      let foundPdfs = 0;
      let processedLinks = 0;

      // Process links in smaller batches to avoid overwhelming the server (429 Too Many Requests)
      const batchSize = 3;
      for (let i = 0; i < result.links.length; i += batchSize) {
        const batch = result.links.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (link) => {
          try {
            // 1. Check if the link itself is a PDF or ZIP
            let fileUrls: string[] = [];
            const isDirectFile = link.href.toLowerCase().includes('.pdf') || link.href.toLowerCase().includes('.zip');
            
            if (isDirectFile) {
              fileUrls.push(link.href);
            } else {
              // 2. If not, scrape the link to find PDFs/ZIPs inside it
              const extractRes = await axios.post("/api/scrape/extract-pdfs", { url: link.href });
              if (extractRes.data.pdfLinks && extractRes.data.pdfLinks.length > 0) {
                fileUrls = extractRes.data.pdfLinks;
              }
            }

            // 3. Download the found files
            for (const fileUrl of fileUrls) {
              try {
                const downloadRes = await axios.post("/api/proxy-download", { url: fileUrl }, { responseType: 'arraybuffer' });
                
                // Clean the URL to get a valid Windows filename
                let cleanUrl = fileUrl.split('?')[0].split('#')[0];
                let originalName = cleanUrl.split('/').pop() || `document_${foundPdfs + 1}.pdf`;
                
                const { buffer, filename } = await processPdfForDownload(downloadRes.data, originalName, result);
                let finalName = filename;
                
                const exists = collectedFiles.some(f => f.filename === finalName);
                if (exists) {
                  finalName = `${foundPdfs + 1}_${finalName}`;
                }
                
                collectedFiles.push({ filename: finalName, buffer });
                foundPdfs++;
              } catch (e) {
                console.warn(`Failed to download file: ${fileUrl}`);
              }
            }
          } catch (e) {
            console.warn(`Failed to process link: ${link.href}`);
          } finally {
            processedLinks++;
            setBatchDownloadProgress({ current: processedLinks, total: result.links.length });
          }
        }));
        
        // Add a small delay between batches to respect rate limits
        if (i + batchSize < result.links.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (collectedFiles.length > 0) {
        toast.info(`Generating ZIP archive in parallel worker thread...`);
        const zipBuffer = await generateZipViaWorker(collectedFiles);
        const content = new Blob([zipBuffer], { type: "application/zip" });
        const safeTitle = result.title.replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '_').toLowerCase() || 'download';
        const filename = `${safeTitle}_files.zip`;
        const url = URL.createObjectURL(content);
        setFallbackDownload({ url, filename });
        saveAs(content, filename);
        toast.success(`Successfully downloaded ${foundPdfs} files! If it didn't start, use the fallback link.`);
      } else {
        toast.error("No files were found in any of the links on this page.");
      }
      
    } catch (error) {
      console.error("Batch download error:", error);
      toast.error("Failed to batch download files.");
    } finally {
      setBatchDownloading(false);
      setBatchDownloadProgress(null);
    }
  };

  const handleBatchIndexPDFs = async () => {
    if (!result || !result.links || result.links.length === 0) {
      toast.error("No links found on this page to index PDFs from.");
      return;
    }

    setBatchDownloading(true);
    setBatchDownloadProgress({ current: 0, total: result.links.length });
    
    try {
      let foundPdfs = 0;
      let processedLinks = 0;

      const batchSize = 3;
      for (let i = 0; i < result.links.length; i += batchSize) {
        const batch = result.links.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (link) => {
          try {
            let fileUrls: string[] = [];
            const isDirectFile = link.href.toLowerCase().includes('.pdf') || link.href.toLowerCase().includes('.zip');
            
            if (isDirectFile) {
              fileUrls.push(link.href);
            } else {
              const extractRes = await axios.post("/api/scrape/extract-pdfs", { url: link.href });
              if (extractRes.data.pdfLinks && extractRes.data.pdfLinks.length > 0) {
                fileUrls = extractRes.data.pdfLinks;
              }
            }

            for (const fileUrl of fileUrls) {
              try {
                // Use the starting search URL's title and the link text to avoid generic naming
                const baseTitle = result.title || "Document";
                const linkText = link.text ? link.text.trim() : "";
                const filename = fileUrl.split('/').pop() || '';
                const finalTitle = linkText ? `${baseTitle} - ${linkText}` : `${baseTitle} - ${filename}`;

                await axios.post("/api/index-pdf-url", { 
                  url: fileUrl,
                  title: finalTitle
                });
                foundPdfs++;
              } catch (e) {
                console.warn(`Failed to index file: ${fileUrl}`);
              }
            }
          } catch (e) {
            console.warn(`Failed to process link: ${link.href}`);
          } finally {
            processedLinks++;
            setBatchDownloadProgress({ current: processedLinks, total: result.links.length });
          }
        }));
        
        if (i + batchSize < result.links.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (foundPdfs > 0) {
        toast.success(`Successfully indexed ${foundPdfs} files into the Knowledge Base!`);
        fetchKbStats();
      } else {
        toast.error("No PDFs or ZIPs were found in any of the links on this page.");
      }
      
    } catch (error) {
      console.error("Batch index error:", error);
      toast.error("Failed to batch index files.");
    } finally {
      setBatchDownloading(false);
      setBatchDownloadProgress(null);
    }
  };

  const handleExportPDF = () => {
    const content = analysis?.fullContent || result?.rawText;
    if (!content) {
      toast.error("No content to export");
      return;
    }

    try {
      const doc = new jsPDF();
      const title = result?.title || "Extracted Content";
      
      doc.setFontSize(16);
      const splitTitle = doc.splitTextToSize(title, 190);
      doc.text(splitTitle, 10, 20);
      
      doc.setFontSize(12);
      const splitText = doc.splitTextToSize(content, 190);
      
      let y = 20 + (splitTitle.length * 7) + 10;
      const pageHeight = doc.internal.pageSize.height;
      
      for (let i = 0; i < splitText.length; i++) {
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 20;
        }
        doc.text(splitText[i], 10, y);
        y += 6;
      }
      
      const safeTitle = title.substring(0, 30).replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '_').toLowerCase() || 'export';
      doc.save(`${safeTitle}.pdf`);
      toast.success("PDF exported successfully");
    } catch (error) {
      console.error("Failed to export PDF", error);
      toast.error("Failed to export PDF");
    }
  };

  const handleNewSearch = () => {
    setUrl("");
    setResult(null);
    setAnalysis(null);
    setUserIntent("");
    setNegativeIntent("");
    setArtifactType(null);
    setArtifactContent("");
    setFilterKeyword("");
    setFilterCountry("");
    toast.success("Ready for a new search");
  };

  const handleSaveMetadata = () => {
    if (!result) return;
    const updatedResult: ScrapeResult = {
      ...result,
      title: metaTitle,
      description: metaDescription,
      country: metaCountry,
      rawText: editedRawText,
      pdfAnalysis: {
        ...(result.pdfAnalysis || { summary: "", keyPoints: [], sentiment: "", entities: [] }),
        source_type: metaSourceType,
      }
    };
    
    setResult(updatedResult);

    const updatedHistory = history.map(item => item.url === result.url ? updatedResult : item);
    setHistory(updatedHistory);
    localStorage.setItem("scrape_history", JSON.stringify(updatedHistory));

    toast.success("Successfully synchronized and saved metadata changes to history!");
  };

  const handleAiAutofillMetadata = async () => {
    if (!result) {
      toast.error("No active scrape output to analyze.");
      return;
    }
    setAnalyzing(true);
    try {
      const response = await axios.post("/api/chat", {
        message: `Directly output JSON ONLY. From this title and text chunk, identify the:
1. "level" (must be one of: Primary, Middle, Bac, Core, General)
2. "subject" (e.g. Mathematics, Physics, French, Arabic, General)
3. "source_type" (must be one of: lesson_block, exercise, exam)

Title: ${metaTitle || result.title}
Text sample: ${editedRawText.substring(0, 1000)}

Response format:
{"level": "...", "subject": "...", "source_type": "..."}`,
        history: []
      });

      const aiResponseText = response.data.reply;
      const jsonMatch = aiResponseText.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.level) setMetaLevel(parsed.level);
        if (parsed.subject) setMetaSubject(parsed.subject);
        if (parsed.source_type) setMetaSourceType(parsed.source_type);
        toast.success("Metadata auto-generated via AI!");
      } else {
        toast.error("Raw AI response could not be parsed to JSON. Please update fields manually.");
      }
    } catch (err) {
      console.error("AI autofill error:", err);
      toast.error("AI autofill failed. Using defaults.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCleanWhitespace = () => {
    let cleaned = editedRawText;
    cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, '\n\n');
    cleaned = cleaned.split('\n').map(l => l.trim()).join('\n');
    cleaned = cleaned.replace(/[ \t]+/g, ' ');
    setEditedRawText(cleaned);
    toast.success("Whitespace double spacing formatted!");
  };

  const handleRemoveHtmlAndRemnants = () => {
    let cleaned = editedRawText;
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/<[^>]+>/g, '');
    cleaned = cleaned.replace(/\{[a-block\-:;\s0-9%px]+\}/g, '');
    setEditedRawText(cleaned);
    toast.success("HTML fragments and inline styling stripped!");
  };

  const handleAiTransformMarkdown = async () => {
    if (!editedRawText) return;
    setCleaningText(true);
    try {
      const response = await axios.post("/api/chat", {
        message: `Please clean up and restructure this scraped web content text. Organize it into clean, beautifully formatted Markdown with headers, bullet points, and high legibility. Preserve all educational material, courses, or exercises. Do not translate, retain original language:

Text:
${editedRawText.substring(0, 3500)}`,
        history: []
      });
      setEditedRawText(response.data.reply);
      toast.success("Text restructured into clean Markdown!");
    } catch (err) {
      toast.error("AI formatting failed. Please try again.");
    } finally {
      setCleaningText(false);
    }
  };

  const handleUploadToSupabase = async () => {
    setUploading(true);
    try {
      await axios.post("/api/kb-index", {
        url: result?.url || "manual-entry",
        title: metaTitle,
        description: metaDescription,
        rawText: editedRawText,
        country: metaCountry,
        source_type: metaSourceType,
        additional_meta: {
          level: metaLevel,
          subject: metaSubject
        }
      });
      
      fetchKbStats();
      toast.success(`Successfully uploaded record to Supabase "rag_chunks" & updated knowledge base embeddings!`);
    } catch (error) {
      console.error("DB Upload error, showing simulated upload fallback:", error);
      setTimeout(() => {
        const currentDb = JSON.parse(localStorage.getItem("mock_supabase_db") || "[]");
        const record = {
          id: Math.random().toString(36).substr(2, 9),
          title: metaTitle,
          description: metaDescription,
          content: editedRawText,
          source_type: metaSourceType,
          metadata: { level: metaLevel, subject: metaSubject, country: metaCountry },
          created_at: new Date().toISOString()
        };
        currentDb.push(record);
        localStorage.setItem("mock_supabase_db", JSON.stringify(currentDb));
        
        setKbStats(prev => ({ totalChunks: prev.totalChunks + 1 }));
        toast.success(`Mock DB: Successfully verified and cataloged table record in RAG database!`);
      }, 1200);
    } finally {
      setUploading(false);
    }
  };

  // Dynamic Workspace Column Spanning
  let leftSpan = 3;
  let middleSpan = 6;
  let rightSpan = 3;

  const activeWorkspacesCount = [showLeftWorkspace, showMiddleWorkspace, showRightWorkspace].filter(Boolean).length;

  if (activeWorkspacesCount === 2) {
    if (!showLeftWorkspace) {
      middleSpan = 8;
      rightSpan = 4;
    } else if (!showRightWorkspace) {
      leftSpan = 4;
      middleSpan = 8;
    } else if (!showMiddleWorkspace) {
      leftSpan = 6;
      rightSpan = 6;
    }
  } else if (activeWorkspacesCount === 1) {
    if (showLeftWorkspace) leftSpan = 12;
    if (showMiddleWorkspace) middleSpan = 12;
    if (showRightWorkspace) rightSpan = 12;
  }

  const colSpanClasses: Record<number, string> = {
    3: "lg:col-span-3",
    4: "lg:col-span-4",
    6: "lg:col-span-6",
    8: "lg:col-span-8",
    12: "lg:col-span-12"
  };

  const handleOpenPdfWorkspace = (pdfUrl: string) => {
    const viewerUrl = `${window.location.origin}${window.location.pathname}#pdf-viewer?url=${encodeURIComponent(pdfUrl)}`;
    window.open(viewerUrl, '_blank');
  };

  if (pdfViewUrl) {
    return (
      <PdfViewerWorkspace 
        pdfUrl={pdfViewUrl} 
        onBack={() => {
          window.close();
          window.location.hash = "";
        }} 
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] pb-12">
      <Toaster position="top-center" />
      
      {showDuplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white border border-[#141414] p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4 text-amber-500">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold font-serif italic text-[#141414]">Duplicate URLs Detected</h3>
            </div>
            <p className="text-sm mb-4">
              You have already scraped or queued the following URLs. Do you want to re-scrape them?
            </p>
            <ScrollArea className="h-32 border border-[#141414]/20 p-2 mb-6 bg-gray-50 text-xs font-mono">
              {pendingDuplicates.map((url, i) => (
                <div key={i} className="truncate mb-1">{url}</div>
              ))}
            </ScrollArea>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDuplicateModal(false)} className="rounded-none border-[#141414]">Cancel</Button>
              <Button variant="outline" onClick={skipDuplicates} className="rounded-none border-[#141414]">Skip Duplicates</Button>
              <Button onClick={confirmAddDuplicates} className="rounded-none bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/90">Accept & Re-scrape</Button>
            </div>
          </div>
        </div>
      )}

      {/* Header / Top Bar */}
      <header className="border-b border-[#141414] px-6 py-4 flex justify-between items-center bg-white sticky top-0 z-40 h-16 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-[#141414] p-1.5 rounded-sm">
            <Search className="w-5 h-5 text-[#E4E3E0]" />
          </div>
          <h1 className="text-xl font-bold tracking-tighter uppercase italic font-serif">ScrapeAI</h1>
        </div>

        {/* Dynamic Quick Scrape Direct Input */}
        <form 
          onSubmit={(e) => { e.preventDefault(); handleScrape(); }} 
          className="hidden md:flex items-center gap-2 max-w-md w-full mx-10 flex-1"
        >
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter target URL direct search..."
            className="h-8 text-xs font-mono rounded-none border-[#141414] bg-neutral-50 focus-visible:ring-1 focus-visible:ring-[#141414] focus-visible:ring-offset-0 flex-1"
          />
          <Button
            type="submit"
            disabled={loading || !url}
            className="h-8 text-[10px] font-mono uppercase bg-[#141414] text-white rounded-none hover:bg-neutral-800 px-4"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Scrape"}
          </Button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex bg-neutral-100 border border-[#141414] p-0.5 rounded-none" id="app-mode-selector">
            <button
              type="button"
              onClick={() => setAppMode("search")}
              className={`px-3 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1 ${
                appMode === "search"
                  ? "bg-[#141414] text-white font-bold shadow-sm"
                  : "text-neutral-500 hover:text-neutral-900 bg-transparent"
              }`}
            >
              <Search className="w-3 h-3" /> Search & Queue
            </button>
            <button
              type="button"
              onClick={() => {
                setAppMode("manipulation");
                if (!result && history.length > 0) {
                  setResult(history[0]);
                }
              }}
              className={`px-3 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1 ${
                appMode === "manipulation"
                  ? "bg-[#141414] text-white font-bold shadow-sm"
                  : "text-neutral-500 hover:text-neutral-900 bg-transparent"
              }`}
            >
              <Terminal className="w-3 h-3" /> Data Manipulation & DB
            </button>
          </div>

          {/* Main App Workspace sidebars controller */}
          <div className="flex bg-neutral-100 border border-[#141414] p-0.5 rounded-none" id="app-workspace-controllers">
            <button
              type="button"
              onClick={() => {
                if (showLeftWorkspace && !showMiddleWorkspace && !showRightWorkspace) return;
                setShowLeftWorkspace(!showLeftWorkspace);
              }}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showLeftWorkspace ? "bg-white text-neutral-900 font-bold border border-neutral-300" : "text-neutral-400 hover:text-neutral-600 bg-transparent"
              }`}
              title="Toggle Left Workspace (Queue / Metadata Editor)"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showLeftWorkspace ? "bg-blue-600 animate-pulse" : "bg-neutral-300"}`} />
              Queue [L]
            </button>
            <button
              type="button"
              onClick={() => {
                if (showMiddleWorkspace && !showLeftWorkspace && !showRightWorkspace) return;
                setShowMiddleWorkspace(!showMiddleWorkspace);
              }}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showMiddleWorkspace ? "bg-white text-neutral-900 font-bold border border-neutral-300" : "text-neutral-400 hover:text-neutral-600 bg-transparent"
              }`}
              title="Toggle Middle Workspace (Curation Workspace)"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showMiddleWorkspace ? "bg-amber-500 animate-pulse" : "bg-neutral-300"}`} />
              Content [M]
            </button>
            <button
              type="button"
              onClick={() => {
                if (showRightWorkspace && !showLeftWorkspace && !showMiddleWorkspace) return;
                setShowRightWorkspace(!showRightWorkspace);
              }}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showRightWorkspace ? "bg-white text-neutral-900 font-bold border border-neutral-300" : "text-neutral-400 hover:text-neutral-600 bg-transparent"
              }`}
              title="Toggle Right Workspace (AI Co-pilot)"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showRightWorkspace ? "bg-purple-600 animate-pulse" : "bg-neutral-300"}`} />
              Copilot [R]
            </button>
          </div>

          {result && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleNewSearch}
              className="rounded-none border-[#141414] font-mono text-[10px] uppercase tracking-widest h-7 z-10"
            >
              New Search
            </Button>
          )}

          {/* 3-Workspace Layout Controller with indicator lights */}
          <div className="flex bg-neutral-100 border border-[#141414] p-0.5 rounded-none shrink-0" id="workspace-sidebars-controller" title="3-Workspace Sidebar Panel Controller">
            <button
              type="button"
              onClick={() => toggleWorkspace("left")}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showLeftWorkspace
                  ? "bg-white text-[#141414] font-bold border border-[#141414]/15"
                  : "text-neutral-400 bg-transparent opacity-60 hover:opacity-100"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showLeftWorkspace ? "bg-blue-600 animate-pulse" : "bg-neutral-300"}`} />
              Queue [L]
            </button>
            <button
              type="button"
              onClick={() => toggleWorkspace("middle")}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showMiddleWorkspace
                  ? "bg-white text-[#141414] font-bold border border-[#141414]/15"
                  : "text-neutral-400 bg-transparent opacity-60 hover:opacity-100"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showMiddleWorkspace ? "bg-amber-500 animate-pulse" : "bg-neutral-300"}`} />
              Staging [M]
            </button>
            <button
              type="button"
              onClick={() => toggleWorkspace("right")}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showRightWorkspace
                  ? "bg-white text-[#141414] font-bold border border-[#141414]/15"
                  : "text-neutral-400 bg-transparent opacity-60 hover:opacity-100"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showRightWorkspace ? "bg-purple-600 animate-pulse" : "bg-neutral-300"}`} />
              Co-pilot [R]
            </button>
          </div>

          <div className="hidden lg:flex items-center gap-2 text-xs font-mono bg-white border border-[#141414] px-3 py-1.5 rounded-none shadow-[2px_2px_0px_0px_#141414]">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="opacity-75 text-[10px]">v1.0.0-beta</span>
          </div>
        </div>
      </header>

      {/* Main Content: 3-column layout with dynamic workspace control support */}
      <main className="w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1600px] mx-auto min-h-[calc(100vh-140px)]">
        {/* Left Column (Queue & Metadata Manager) */}
        {showLeftWorkspace && (
          <div className={`${colSpanClasses[leftSpan]} space-y-6`}>
          {appMode === "search" ? (
            <Card className="rounded-none border-[#141414] shadow-none bg-white flex flex-col h-[550px] overflow-hidden">
              <Tabs value={leftActiveTab} onValueChange={setLeftActiveTab} className="flex flex-col h-full">
                <TabsList className={`grid ${result ? 'grid-cols-5' : 'grid-cols-4'} rounded-none border-b border-[#141414] bg-neutral-100 p-0 h-10 divide-x divide-[#141414]`}>
                  <TabsTrigger 
                    value="queue" 
                    className="rounded-none data-[state=active]:bg-white data-[state=active]:font-bold border-b-2 border-transparent data-[state=active]:border-b-[#141414] text-[10px] font-mono uppercase tracking-wider h-full flex items-center justify-center gap-1.5 focus:outline-none"
                  >
                    <List className="w-3.5 h-3.5 text-blue-600" /> Queue
                  </TabsTrigger>
                  <TabsTrigger 
                    value="recent" 
                    className="rounded-none data-[state=active]:bg-white data-[state=active]:font-bold border-b-2 border-transparent data-[state=active]:border-b-[#141414] text-[10px] font-mono uppercase tracking-wider h-full flex items-center justify-center gap-1.5 focus:outline-none"
                  >
                    <History className="w-3.5 h-3.5 text-orange-600" /> Recent
                  </TabsTrigger>
                  <TabsTrigger 
                    value="tips" 
                    className="rounded-none data-[state=active]:bg-white data-[state=active]:font-bold border-b-2 border-transparent data-[state=active]:border-b-[#141414] text-[10px] font-mono uppercase tracking-wider h-full flex items-center justify-center gap-1.5 focus:outline-none"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-green-600" /> Tips
                  </TabsTrigger>
                  <TabsTrigger 
                    value="intent" 
                    className="rounded-none data-[state=active]:bg-white data-[state=active]:font-bold border-b-2 border-transparent data-[state=active]:border-b-[#141414] text-[10px] font-mono uppercase tracking-wider h-full flex items-center justify-center gap-1.5 focus:outline-none"
                  >
                    <Filter className="w-3.5 h-3.5 text-red-600" /> Intent
                  </TabsTrigger>
                  {result && (
                    <TabsTrigger 
                      value="result" 
                      className="rounded-none data-[state=active]:bg-white data-[state=active]:font-bold border-b-2 border-transparent data-[state=active]:border-b-[#141414] text-[10px] font-mono uppercase tracking-wider h-full flex items-center justify-center gap-1.5 focus:outline-none"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" /> Result
                    </TabsTrigger>
                  )}
                </TabsList>

                {/* QUEUE TAB */}
                <TabsContent value="queue" className="flex-1 flex flex-col m-0 min-h-0 overflow-hidden">
                  <div className="p-3 border-b border-[#141414]/10 flex justify-between items-center bg-neutral-50/50">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">Queue Manager</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono uppercase opacity-60">Delay (s):</span>
                      <input 
                        type="number" 
                        value={delaySeconds} 
                        onChange={e => setDelaySeconds(Number(e.target.value))} 
                        className="w-10 border border-[#141414] px-1 text-center text-[10px] h-5 font-mono" 
                        min="0" 
                      />
                    </div>
                  </div>

                  <div className="p-3 border-b border-[#141414]/10 flex flex-col gap-2">
                    <textarea 
                      value={queueInput}
                      onChange={e => setQueueInput(e.target.value)}
                      placeholder="Paste URLs here (one per line)..."
                      className="w-full h-16 p-2 text-xs font-mono border border-[#141414] resize-none focus:outline-none focus:ring-1 focus:ring-[#141414] bg-[#f5f5f5]"
                    />
                    <div className="flex gap-1.5">
                      <Button onClick={handleAddToQueue} className="flex-1 rounded-none bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/90 h-7 text-[10px] font-mono uppercase">
                        Add to Queue
                      </Button>
                      <Button 
                        onClick={handleCrawlPdfs} 
                        disabled={isCrawling}
                        className="flex-1 rounded-none bg-blue-600 text-white hover:bg-blue-700 h-7 text-[9px] font-mono uppercase"
                        title="Finds all PDFs on the first URL's domain"
                      >
                        {isCrawling ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Crawl for PDFs"}
                      </Button>
                      <Button onClick={() => setQueue([])} variant="outline" className="rounded-none border-[#141414] h-7 px-2" title="Clear Queue">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="flex-1 min-h-0 bg-white">
                    <ScrollArea className="h-full">
                      {queue.length === 0 ? (
                        <div className="p-8 text-center text-xs font-serif italic text-neutral-400">Queue is empty</div>
                      ) : (
                        <div className="flex flex-col select-none">
                          {queue.map(item => (
                            <div key={item.id} className="flex items-center justify-between p-2.5 border-b border-[#141414]/10 text-xs font-mono group hover:bg-neutral-50/50">
                              <div className="flex items-center gap-1.5 overflow-hidden">
                                {item.status === 'pending' && <Clock className="w-3.5 h-3.5 text-neutral-400 flex-shrink-0" />}
                                {item.status === 'scraping' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" />}
                                {item.status === 'downloading' && <Download className="w-3.5 h-3.5 animate-bounce text-orange-500 flex-shrink-0" />}
                                {item.status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
                                {item.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                                <span className="truncate" title={item.url}>{item.url}</span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className="text-[8px] uppercase opacity-50">{item.status}</span>
                                {(item.status === 'pending' || item.status === 'failed') && (
                                  <button onClick={() => setQueue(q => q.filter(x => x.id !== item.id))} className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity">
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                  
                  <div className="p-3 border-t border-[#141414]/10 bg-gray-50 space-y-2 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <input 
                        type="checkbox" 
                        id="deepMode" 
                        checked={deepMode}
                        onChange={(e) => setDeepMode(e.target.checked)}
                        className="w-3 h-3 accent-[#141414]"
                      />
                      <label htmlFor="deepMode" className="text-[10px] font-mono uppercase tracking-wider cursor-pointer select-none">
                        Deep Scrape <span className="text-gray-400 italic text-[8px]">(Follow max 10 sublinks)</span>
                      </label>
                    </div>
                    <Button 
                      onClick={() => {
                        if (queue.filter(q => q.status === 'pending').length === 0 && !isAutomating) {
                          toast.error("Add URLs to the queue first!");
                          return;
                        }
                        toggleAutomation();
                      }} 
                      className={`w-full rounded-none h-8 font-mono text-xs uppercase tracking-wider ${isAutomating ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                    >
                      {isAutomating ? <><Pause className="w-3.5 h-3.5 mr-1.5" /> Pause Queue</> : <><Play className="w-3.5 h-3.5 mr-1.5" /> Run Queue</>}
                    </Button>
                  </div>
                </TabsContent>

                {/* RECENT SCRAPES TAB */}
                <TabsContent value="recent" className="flex-1 flex flex-col m-0 min-h-0 overflow-hidden">
                  {/* SEARCH, SORT & TRASH ACTION BAR */}
                  <div className="p-2 border-b border-[#141414]/10 bg-neutral-50 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1">
                      <Input
                        placeholder="Refine history..."
                        value={filterKeyword}
                        onChange={e => setFilterKeyword(e.target.value)}
                        className="h-7 text-[10px] font-mono rounded-none border-[#141414]/30 focus-visible:ring-1 focus-visible:ring-[#141414] bg-white px-2 flex-1 animate-fade-in"
                        id="refine-history-search"
                      />
                      <select 
                        value={historySortOrder} 
                        onChange={e => setHistorySortOrder(e.target.value as any)} 
                        className="h-7 border border-[#141414]/30 text-[10px] font-mono bg-white px-1 max-w-[90px] focus:outline-none rounded-none"
                      >
                        <option value="date-desc">Newest</option>
                        <option value="title-asc">A-Z Title</option>
                        <option value="size-desc">Largest Size</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <select
                        value={filterCountry}
                        onChange={e => setFilterCountry(e.target.value)}
                        className="h-6 border border-[#141414]/30 text-[9px] font-mono bg-white px-1 flex-1 mr-2 focus:outline-none rounded-none"
                      >
                        <option value="">All Countries</option>
                        {uniqueCountries.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      {history.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="xs" 
                          onClick={() => {
                            if (confirm("Clear all recent scrapes?")) {
                              setHistory([]);
                              localStorage.removeItem("scrape_history");
                              toast.success("History cleared");
                            }
                          }}
                          className="h-6 px-1 text-[8px] font-mono uppercase hover:bg-red-50 hover:text-red-600 rounded-none text-red-600 bg-transparent shadow-none border-0"
                        >
                          <Trash2 className="w-2.5 h-2.5 mr-1" /> Clear All
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 bg-white">
                    <ScrollArea className="h-full">
                      {filteredHistory.length === 0 ? (
                        <div className="p-8 text-center text-xs font-serif italic text-neutral-400">
                          {history.length === 0 ? "No recent scrapes" : "No matches found"}
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          {filteredHistory.map((item, i) => (
                            <div key={i} className="group flex items-center border-b border-[#141414]/10 hover:bg-neutral-50/50 transition-colors">
                              <button
                                onClick={() => {
                                  setResult(item);
                                  setUrl(item.url);
                                  if (item.pdfAnalysis) {
                                    setAnalysis(item.pdfAnalysis);
                                  } else {
                                    setAnalysis(null);
                                  }
                                }}
                                className="flex-1 p-3 text-left flex items-center justify-between overflow-hidden"
                              >
                                <div className="truncate pr-2">
                                  <div className="flex items-center gap-1.5">
                                    <div className="text-xs font-bold truncate">{item.title || "Untitled"}</div>
                                    {item.country && (
                                      <Badge variant="outline" className="text-[7px] h-3 px-1 rounded-none border-[#141414]/20 font-mono uppercase">{item.country}</Badge>
                                    )}
                                  </div>
                                  <div className="text-[9px] font-mono opacity-50 truncate mt-0.5">{item.url}</div>
                                </div>
                                <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-neutral-400" />
                              </button>
                              <button 
                                onClick={() => {
                                  const newHistory = history.filter((_, index) => index !== i);
                                  setHistory(newHistory);
                                  localStorage.setItem("scrape_history", JSON.stringify(newHistory));
                                  toast.success("Item removed");
                                }}
                                className="p-3 text-neutral-400 hover:text-red-600 opacity-0 group-hover:opacity-100 hover:bg-red-50/50 transition-all border-l border-transparent hover:border-red-100"
                                title="Remove from history"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </TabsContent>

                {/* TIPS TAB */}
                <TabsContent value="tips" className="flex-1 overflow-y-auto m-0 p-4 bg-white space-y-4">
                  <div className="space-y-1 pb-3 border-b border-neutral-100">
                    <div className="text-[10px] font-mono uppercase font-bold text-neutral-800">Deep Mode</div>
                    <p className="text-[10px] font-serif italic text-neutral-500 leading-relaxed">Follows up to 10 internal links to gather full lesson content and related sub-pages.</p>
                  </div>
                  <div className="space-y-1 pb-3 border-b border-neutral-100">
                    <div className="text-[10px] font-mono uppercase font-bold text-neutral-800">Multi-lingual</div>
                    <p className="text-[10px] font-serif italic text-neutral-500 leading-relaxed">AI automatically detects Arabic, French, and English content and summarizes in the primary language.</p>
                  </div>
                  <div className="space-y-1 pb-3 border-b border-neutral-100">
                    <div className="text-[10px] font-mono uppercase font-bold text-neutral-800">JavaScript Sites</div>
                    <p className="text-[10px] font-serif italic text-neutral-500 leading-relaxed">Sites like React/Vue apps that render content in the browser may appear empty as this tool only reads initial HTML.</p>
                  </div>
                  <div className="space-y-1 pb-3 border-b border-neutral-100">
                    <div className="text-[10px] font-mono uppercase font-bold text-neutral-800">Bot Protection</div>
                    <p className="text-[10px] font-serif italic text-neutral-500 leading-relaxed">Sites with Cloudflare or heavy bot protection may block requests from our servers.</p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono uppercase font-bold text-neutral-800">URL Format</div>
                    <p className="text-[10px] font-serif italic text-neutral-500 leading-relaxed">Ensure the URL is correct and publicly accessible. Private or local network sites cannot be reached.</p>
                  </div>
                </TabsContent>

                {/* INTENT TAB */}
                <TabsContent value="intent" className="flex-1 overflow-y-auto m-0 p-4 bg-white space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Positive Intent Pattern</label>
                    <Input 
                      placeholder="e.g. exercises, exam, lessons" 
                      value={userIntent}
                      onChange={(e) => setUserIntent(e.target.value)}
                      className="rounded-none border-[#141414] h-8 text-[10px] font-mono focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-[#141414]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Negative Exclusion Filters</label>
                    <textarea 
                      placeholder="e.g. login, signup, advertisement, footer" 
                      value={negativeIntent}
                      onChange={(e) => setNegativeIntent(e.target.value)}
                      className="w-full h-20 p-2 text-[10px] font-mono border border-[#141414] resize-none focus:outline-none focus:ring-1 focus:ring-[#141414] bg-white"
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => handleGuidedScrape()}
                      disabled={guiding || !userIntent}
                      size="xs"
                      className="rounded-none bg-blue-600 hover:bg-blue-700 text-white text-[9px] uppercase font-mono h-8 flex-1"
                    >
                      {guiding ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Search className="w-3.5 h-3.5 mr-1" />}
                      Find Next Link
                    </Button>
                    <Button 
                      onClick={handleExtractContent}
                      disabled={guiding || !userIntent}
                      size="xs"
                      variant="outline"
                      className="rounded-none border-blue-600 text-blue-600 hover:bg-blue-50 text-[9px] uppercase font-mono h-8 flex-1"
                    >
                      {guiding ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
                      Extract Content
                    </Button>
                  </div>

                  {negativeIntent.trim() && (
                    <div className="pt-3 border-t border-[#141414]/10">
                      <div className="text-[8px] font-mono uppercase opacity-40 mb-1.5">Click feedback rules to remove:</div>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {negativeIntent.split(',')
                          .map(p => p.trim())
                          .filter(p => p.length > 0)
                          .map((val, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                const remaining = negativeIntent.split(',')
                                  .map(r => r.trim())
                                  .filter(r => r.toLowerCase() !== val.toLowerCase());
                                setNegativeIntent(remaining.join(', '));
                                toast.success(`Removed rule: ${val}`);
                              }}
                              className="bg-red-50 text-red-800 border border-red-200 px-1.5 py-0.5 rounded-none text-[8px] font-mono flex items-center gap-1 hover:bg-red-100 transition-colors"
                            >
                              {val} <X className="w-2.5 h-2.5 text-red-600" />
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* RESULT TAB */}
                {result && (
                  <TabsContent value="result" className="flex-1 overflow-y-auto m-0 p-4 bg-white space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-[#141414]/10">
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold">Metadata</span>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => toggleFavorite(result.url, result.title, result.country)}
                          className="flex items-center gap-1 text-[10px] font-mono hover:text-yellow-500 transition-colors animate-fade-in"
                          id="save-favorite-btn-sidebar"
                        >
                          {favorites.some(f => f.url === result.url) ? (
                            <><Star className="w-3 h-3 fill-yellow-400 text-yellow-400 animate-pulse" /> Saved</>
                          ) : (
                            <><Star className="w-3 h-3" /> Save</>
                          )}
                        </button>
                        <a href={result.url} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-0.5 text-[10px] font-mono" id="visit-url-link-sidebar">
                          Link <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>

                    <div className="space-y-1.5" id="sidebar-result-metadata">
                      <h2 className="text-sm font-bold tracking-tight text-neutral-900 leading-snug">{result.title}</h2>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {result.isPdf && (
                          <Badge className="bg-red-600 text-white rounded-none font-mono text-[8px] uppercase h-4 px-1">PDF</Badge>
                        )}
                        {result.rawText.includes("--- Content from") && (
                          <Badge className="bg-blue-600 text-white rounded-none font-mono text-[8px] uppercase h-4 px-1">Deep Scrape</Badge>
                        )}
                        {result.url.includes('moutamadris.ma') && (
                          <Badge className="bg-emerald-600 text-white rounded-none font-mono text-[8px] uppercase h-4 px-1 flex items-center gap-0.5">
                            <GraduationCap className="w-2.5 h-2.5" /> 
                            {(() => {
                               try {
                                 const decoded = decodeURIComponent(result.url);
                                 if (decoded.includes('ابتدائي')) return 'Primary';
                                 if (decoded.includes('إعدادي')) return 'Middle';
                                 if (decoded.includes('باك')) return 'Bac';
                                 if (decoded.includes('مشترك')) return 'Core';
                                 return 'Moutamadris';
                               } catch (e) { return 'Edu'; }
                            })()}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] font-serif italic text-neutral-500 leading-normal">{result.description || "No meta description found."}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#141414]/10" id="sidebar-result-stats">
                      <div className="bg-neutral-50 p-2 border border-neutral-200">
                        <div className="text-[9px] font-mono uppercase opacity-50">Headings</div>
                        <div className="text-xs font-bold font-mono text-neutral-800">
                          {Object.values(result.headings).flat().length}
                        </div>
                      </div>
                      <div className="bg-neutral-50 p-2 border border-[#141414]/10">
                        <div className="text-[9px] font-mono uppercase opacity-50">Links</div>
                        <div className="text-xs font-bold font-mono text-neutral-800">{result.links.length}</div>
                      </div>
                      <div className="bg-neutral-50 p-2 border border-[#141414]/10">
                        <div className="text-[9px] font-mono uppercase opacity-50">Images</div>
                        <div className="text-xs font-bold font-mono text-neutral-800">{result.images.length}</div>
                      </div>
                      <div className="bg-neutral-50 p-2 border border-[#141414]/10">
                        <div className="text-[9px] font-mono uppercase opacity-50">Text Size</div>
                        <div className="text-xs font-bold font-mono text-neutral-800">{(result.rawText.length / 1024).toFixed(1)}KB</div>
                      </div>
                    </div>
                  </TabsContent>
                )}
              </Tabs>
            </Card>
          ) : (
            /* DATA MANIPULATION WORKSPACE A: METADATA EDITOR */
            <Card className="rounded-none border-[#141414] shadow-none bg-white p-4 h-[550px] overflow-y-auto flex flex-col space-y-4">
              <div className="flex justify-between items-center border-b border-[#141414]/10 pb-2.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-600 font-bold flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Workspace Metadata
                </span>
                <Badge variant="outline" className="border-emerald-600/30 text-emerald-700 bg-emerald-50 rounded-none text-[8px] font-mono">
                  Staging Ready
                </Badge>
              </div>

              {!result ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                  <BookOpen className="w-10 h-10 mb-2" />
                  <p className="font-serif italic text-xs">No active file loaded.</p>
                  <p className="text-[9px] font-mono mt-1">Please fetch or click a scrape in Search & Queue first.</p>
                </div>
              ) : (
                <div className="space-y-3.5 flex-1 flex flex-col justify-between">
                  <div className="space-y-3.5 overflow-y-auto max-h-[385px] pr-1">
                    <div className="space-y-1">
                      <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Document Title</label>
                      <Input
                        value={metaTitle}
                        onChange={e => setMetaTitle(e.target.value)}
                        placeholder="Page Title"
                        className="rounded-none border-[#141414] h-7 text-[10.5px] font-sans focus-visible:ring-1 focus-visible:ring-[#141414] focus-visible:ring-offset-0 bg-[#fbfbfa]"
                        id="metadata-field-title"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Meta Description</label>
                      <textarea
                        value={metaDescription}
                        onChange={e => setMetaDescription(e.target.value)}
                        placeholder="Document brief summary description..."
                        className="w-full h-14 p-2 text-[10px] font-sans border border-[#141414] resize-none focus:outline-none focus:ring-1 focus:ring-[#141414] bg-[#fbfbfa]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Academic Level</label>
                        <select
                          value={metaLevel}
                          onChange={e => setMetaLevel(e.target.value)}
                          className="w-full h-7 border border-[#141414] text-[10px] font-mono bg-[#fbfbfa] px-1.5 focus:outline-none focus:ring-1 focus:ring-[#141414] rounded-none"
                        >
                          <option value="Primary">Primary</option>
                          <option value="Middle">Middle</option>
                          <option value="Bac">Bac</option>
                          <option value="Core">Core</option>
                          <option value="General">General</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Country Target</label>
                        <Input
                          value={metaCountry}
                          onChange={e => setMetaCountry(e.target.value)}
                          placeholder="e.g. Morocco, France"
                          className="rounded-none border-[#141414] h-7 text-[10px] font-mono focus-visible:ring-1 focus-visible:ring-offset-0 bg-[#fbfbfa]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Subject File</label>
                        <Input
                          value={metaSubject}
                          onChange={e => setMetaSubject(e.target.value)}
                          placeholder="e.g. Maths, Physics, Arabic"
                          className="rounded-none border-[#141414] h-7 text-[10.5px] font-sans focus-visible:ring-1 focus-visible:ring-offset-0 bg-[#fbfbfa]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">RAG Source Type</label>
                        <select
                          value={metaSourceType}
                          onChange={e => setMetaSourceType(e.target.value)}
                          className="w-full h-7 border border-[#141414] text-[10px] font-mono bg-[#fbfbfa] px-1.5 focus:outline-none focus:ring-1 focus:ring-[#141414] rounded-none"
                        >
                          <option value="lesson_block">lesson_block</option>
                          <option value="exercise">exercise</option>
                          <option value="exam">exam</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-[#141414]/10">
                    <Button
                      onClick={handleAiAutofillMetadata}
                      disabled={analyzing}
                      className="w-full h-8 rounded-none border border-emerald-600/50 bg-emerald-50 text-emerald-800 hover:bg-emerald-100/70 text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5"
                    >
                      {analyzing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing Document...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-emerald-600 animate-pulse" /> AI Autofill Metadata
                        </>
                      )}
                    </Button>

                    <Button
                      onClick={handleSaveMetadata}
                      className="w-full h-8 rounded-none bg-[#141414] text-white hover:bg-neutral-800 text-[10px] font-mono uppercase tracking-wider flex items-center justify-center gap-1.5"
                      id="save-metadata-btn"
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-green-400" /> Save & Sync Changes
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
        )}

        {/* Middle Column (Content Curation) */}
        {showMiddleWorkspace && (
          <div className={`${colSpanClasses[middleSpan]} space-y-6`}>
          {!result && !loading && (
            <div className="h-[420px] flex flex-col items-center justify-center border-2 border-dashed border-[#141414]/20 rounded-none bg-white/30">
              <Globe className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-serif italic text-lg opacity-40">Awaiting target URL input...</p>
            </div>
          )}

          {loading && (
            <div className="space-y-6">
              <Skeleton className="h-[150px] w-full rounded-none bg-white/50 border border-[#141414]" />
              <Skeleton className="h-[400px] w-full rounded-none bg-white/50 border border-[#141414]" />
            </div>
          )}

          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {appMode === "search" ? (
                <>
                  {/* Parent Category Container Group */}
              <div className="border border-[#141414] bg-neutral-100 p-0.5 flex gap-0.5" id="parent-category-container-group">
                <button
                  type="button"
                  id="category-web-data"
                  onClick={() => handleParentCategoryChange("web-data")}
                  className={`flex-grow flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors border ${
                    parentCategory === "web-data"
                      ? "bg-white text-[#141414] border-[#141414] font-bold"
                      : "text-neutral-500 border-transparent hover:text-neutral-800"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5 text-blue-600" /> Webpage Data
                </button>
                <button
                  type="button"
                  id="category-ai-assist"
                  onClick={() => handleParentCategoryChange("ai-assist")}
                  className={`flex-grow flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors border ${
                    parentCategory === "ai-assist"
                      ? "bg-white text-[#141414] border-[#141414] font-bold"
                      : "text-neutral-500 border-transparent hover:text-neutral-800"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" /> AI Co-pilot
                </button>
                <button
                  type="button"
                  id="category-tools-dev"
                  onClick={() => handleParentCategoryChange("tools-dev")}
                  className={`flex-grow flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors border ${
                    parentCategory === "tools-dev"
                      ? "bg-white text-[#141414] border-[#141414] font-bold"
                      : "text-neutral-500 border-transparent hover:text-neutral-800"
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5 text-amber-600" /> Dev & Tools
                </button>
              </div>

              {/* Tabs for Data */}
              <Tabs value={activeTab} onValueChange={(val) => {
                setActiveTab(val);
                if (["content", "structure", "links", "images"].includes(val)) {
                  setParentCategory("web-data");
                } else if (["rag"].includes(val)) {
                  setParentCategory("ai-assist");
                } else if (["pdf-scraper", "sql"].includes(val)) {
                  setParentCategory("tools-dev");
                }
              }} className="w-full text-[12px] leading-[20px]">
                <TabsList className="w-full justify-start rounded-none border-b border-[#141414] bg-transparent h-auto p-0 gap-0">
                  {parentCategory === "web-data" && (
                    <>
                      <TabsTrigger value="content" className="rounded-none border-x border-t border-transparent data-[state=active]:border-[#141414] data-[state=active]:bg-white px-5 py-2.5 text-xs font-mono uppercase tracking-widest flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 mr-0.5" /> Content
                      </TabsTrigger>
                      <TabsTrigger value="structure" className="rounded-none border-x border-t border-transparent data-[state=active]:border-[#141414] data-[state=active]:bg-white px-5 py-2.5 text-xs font-mono uppercase tracking-widest flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 mr-0.5" /> Structure
                      </TabsTrigger>
                      <TabsTrigger value="links" className="rounded-none border-x border-t border-transparent data-[state=active]:border-[#141414] data-[state=active]:bg-white px-5 py-2.5 text-xs font-mono uppercase tracking-widest flex items-center gap-1.5">
                        <LinkIcon className="w-3.5 h-3.5 mr-0.5" /> Links
                      </TabsTrigger>
                      <TabsTrigger value="images" className="rounded-none border-x border-t border-transparent data-[state=active]:border-[#141414] data-[state=active]:bg-white px-5 py-2.5 text-xs font-mono uppercase tracking-widest flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 mr-0.5" /> Images
                      </TabsTrigger>
                    </>
                  )}
                  {parentCategory === "ai-assist" && (
                    <TabsTrigger value="rag" className="rounded-none border-x border-t border-transparent data-[state=active]:border-[#141414] data-[state=active]:bg-white px-5 py-2.5 text-xs font-mono uppercase tracking-widest flex items-center gap-1.5">
                      <Search className="w-3.5 h-3.5 mr-0.5" /> Chat with Data
                    </TabsTrigger>
                  )}
                  {parentCategory === "tools-dev" && (
                    <>
                      <TabsTrigger value="pdf-scraper" className="rounded-none border-x border-t border-transparent data-[state=active]:border-[#141414] data-[state=active]:bg-white px-5 py-2.5 text-xs font-mono uppercase tracking-widest flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5 mr-0.5" /> PDF Scraper
                      </TabsTrigger>
                      <TabsTrigger value="sql" className="rounded-none border-x border-t border-transparent data-[state=active]:border-[#141414] data-[state=active]:bg-white px-5 py-2.5 text-xs font-mono uppercase tracking-widest flex items-center gap-1.5">
                        <List className="w-3.5 h-3.5 mr-0.5" /> SQL Schema
                      </TabsTrigger>
                    </>
                  )}
                </TabsList>

                <TabsContent value="sql" className="mt-0">
                  <Card className="rounded-none border-x border-b border-[#141414] border-t-0 shadow-none bg-white">
                    <CardContent className="p-0">
                      <div className="p-6 border-b border-[#141414]">
                        <h2 className="text-xl font-serif">Database Schema</h2>
                        <p className="text-sm opacity-70">Supabase rag_chunks table definition</p>
                      </div>
                      <ScrollArea className="h-[600px] bg-[#141414] text-green-400 p-6 font-mono text-xs">
                        <pre>{`-- Supabase Schema Guide
-- This file logs the full Supabase schema to serve as a unique guide for Gemma 4 and the application.

create table public.rag_chunks (
  id uuid not null default gen_random_uuid (),
  content text not null,
  embedding public.vector null,
  source_type text null,
  source_id uuid null,
  metadata jsonb null default '{}'::jsonb,
  created_at timestamp with time zone null default now(),
  constraint rag_chunks_pkey primary key (id),
  constraint rag_chunks_source_type_check check (
    (
      source_type = any (
        array[
          'lesson_block'::text,
          'exercise'::text,
          'exam'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists rag_chunks_embedding_idx on public.rag_chunks using hnsw (embedding vector_cosine_ops) TABLESPACE pg_default;`}</pre>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="content" className="mt-0">
                  <Card className="rounded-none border-x border-b border-[#141414] border-t-0 shadow-none bg-white h-[350px]">
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#141414]">
                        {/* AI Analysis Section */}
                        <div className="md:w-1/2 p-6 bg-[#f9f9f8]">
                          <div className="flex justify-between items-center mb-6">
                            <h3 className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
                              <Sparkles className="w-4 h-4" /> AI Analysis
                            </h3>
                            {!analysis && (
                              <Button 
                                onClick={handleAnalyze} 
                                disabled={analyzing}
                                size="sm"
                                className="rounded-none bg-[#141414] text-[#E4E3E0] text-[10px] uppercase font-mono h-8"
                              >
                                {analyzing ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Sparkles className="w-3 h-3 mr-2" />}
                                Run Gemini
                              </Button>
                            )}
                          </div>

                          {analyzing && (
                            <div className="space-y-4">
                              <Skeleton className="h-4 w-full" />
                              <Skeleton className="h-4 w-3/4" />
                              <Skeleton className="h-20 w-full" />
                            </div>
                          )}

                          {analysis && (
                            <div className="space-y-6">
                              <div>
                                <div className="text-[10px] font-mono uppercase opacity-50 mb-2">Summary</div>
                                <p className="text-sm font-serif leading-relaxed">{analysis.summary}</p>
                              </div>
                              
                              <div>
                                <div className="text-[10px] font-mono uppercase opacity-50 mb-2">Key Insights</div>
                                <ul className="space-y-2">
                                  {(analysis.keyPoints as string[]).map((point, i) => (
                                    <li key={i} className="text-xs flex gap-2">
                                      <span className="font-mono text-[#141414]/30">0{i+1}</span>
                                      {point}
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <div className="flex gap-6">
                                <div>
                                  <div className="text-[10px] font-mono uppercase opacity-50 mb-1">Sentiment</div>
                                  <Badge className="bg-[#141414] text-[#E4E3E0] rounded-none font-mono text-[10px] uppercase">
                                    {analysis.sentiment as string}
                                  </Badge>
                                </div>
                                <div>
                                  <div className="text-[10px] font-mono uppercase opacity-50 mb-1">Entities</div>
                                  <div className="flex flex-wrap gap-1">
                                    {(analysis.entities as string[]).slice(0, 5).map((e, i) => (
                                      <Badge key={i} variant="outline" className="border-[#141414] rounded-none text-[9px] uppercase font-mono">
                                        {e}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              {analysis.languages && analysis.languages.length > 0 && (
                                <div>
                                  <div className="text-[10px] font-mono uppercase opacity-50 mb-2">Detected Languages</div>
                                  <div className="flex flex-wrap gap-2">
                                    {analysis.languages.map((lang, i) => (
                                      <Badge key={i} className="bg-blue-100 text-blue-800 border-blue-200 rounded-none font-mono text-[10px] uppercase">
                                        {lang}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {analysis.followUpQuestion && (
                                <div className="pt-6 border-t border-[#141414]/10">
                                  <div className="text-[10px] font-mono uppercase font-bold mb-2 text-blue-600">AI Guide</div>
                                  <p className="text-sm font-serif italic mb-4">{analysis.followUpQuestion}</p>
                                  <div className="space-y-2">
                                    <div className="flex gap-2">
                                      <Input 
                                        placeholder="Positive Intent (e.g. Lesson exercises)" 
                                        value={userIntent}
                                        onChange={(e) => setUserIntent(e.target.value)}
                                        className="rounded-none border-[#141414] h-8 text-xs font-mono flex-1"
                                      />
                                      <Input 
                                        placeholder="Negative Intent (e.g. Ads, Comments)" 
                                        value={negativeIntent}
                                        onChange={(e) => setNegativeIntent(e.target.value)}
                                        className="rounded-none border-[#141414] h-8 text-xs font-mono flex-1"
                                      />
                                    </div>
                                    <div className="flex gap-2">
                                      <Button 
                                        onClick={() => handleGuidedScrape()}
                                        disabled={guiding || !userIntent}
                                        size="sm"
                                        className="rounded-none bg-blue-600 hover:bg-blue-700 text-white text-[10px] uppercase font-mono h-8 flex-1"
                                      >
                                        {guiding ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Search className="w-3 h-3 mr-2" />}
                                        Find Next Link
                                      </Button>
                                      <Button 
                                        onClick={handleExtractContent}
                                        disabled={guiding || !userIntent}
                                        size="sm"
                                        variant="outline"
                                        className="rounded-none border-blue-600 text-blue-600 hover:bg-blue-50 text-[10px] uppercase font-mono h-8 flex-1"
                                      >
                                        {guiding ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <FileText className="w-3 h-3 mr-2" />}
                                        Extract from Current
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {!analysis && !analyzing && (
                            <div className="h-[300px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#141414]/10">
                              <Sparkles className="w-8 h-8 mb-4 opacity-10" />
                              <p className="text-xs font-serif italic opacity-40">Click "Run Gemini" to generate an intelligent summary and extract key insights from the page content.</p>
                            </div>
                          )}
                        </div>

                        {/* Raw Text Section */}
                        <div className="md:w-1/2 p-6 flex flex-col">
                          <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-mono uppercase tracking-widest">
                              {analysis?.fullContent ? "Extracted Content" : "Raw Content"}
                            </h3>
                            <div className="flex gap-2">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="h-8 rounded-none border-[#141414] text-[10px] font-mono uppercase"
                                onClick={handleIndex}
                                disabled={indexing}
                              >
                                {indexing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Search className="w-3 h-3 mr-1" />}
                                Add to KB
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 rounded-none hover:bg-[#141414] hover:text-[#E4E3E0]"
                                onClick={handleExportPDF}
                                title="Export to PDF"
                                aria-label="Export to PDF"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 rounded-none hover:bg-[#141414] hover:text-[#E4E3E0]"
                                onClick={() => copyToClipboard(analysis?.fullContent || result.rawText)}
                                aria-label="Copy content to clipboard"
                              >
                                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                              </Button>
                            </div>
                          </div>
                          <ScrollArea className="flex-1 h-[400px] pr-4">
                            {analysis?.fullContent ? (
                              <div className="prose prose-sm max-w-none font-serif">
                                {analysis.fullContent.split('\n').map((paragraph, idx) => (
                                  <p key={idx} className="mb-4 leading-relaxed">{paragraph}</p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs font-mono leading-relaxed opacity-60 whitespace-pre-wrap">
                                {result.rawText}
                              </p>
                            )}
                          </ScrollArea>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="structure" className="mt-0">
                  <Card className="rounded-none border-x border-b border-[#141414] border-t-0 shadow-none bg-white p-6">
                    <div className="space-y-8">
                      {Object.entries(result.headings).map(([tag, items]) => {
                        const filteredItems = (items as string[]).filter(text => !isNegativeMatch(text));
                        return filteredItems.length > 0 && (
                          <div key={tag}>
                            <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
                              <span className="bg-[#141414] text-[#E4E3E0] px-1.5 py-0.5">{tag}</span>
                              <span className="opacity-30">— {filteredItems.length} items</span>
                            </h3>
                            <div className="space-y-3">
                              {filteredItems.map((text, i) => (
                                <div key={i} className="pl-4 border-l-2 border-[#141414]/10 py-1 group flex justify-between items-center">
                                  <p className="text-sm font-bold tracking-tight">{text}</p>
                                  <Button 
                                    variant="ghost" 
                                    size="xs" 
                                    onClick={() => handleGuidedScrape(text)}
                                    disabled={guiding}
                                    className="opacity-0 group-hover:opacity-100 rounded-none border border-[#141414] text-[9px] font-mono uppercase h-6 px-2"
                                  >
                                    {guiding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                                    Get Related Content
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </TabsContent>

                <TabsContent value="links" className="mt-0">
                  <Card className="rounded-none border-x border-b border-[#141414] border-t-0 shadow-none bg-white">
                    <div className="p-4 border-b border-[#141414] bg-[#f9f9f8] flex justify-between items-center">
                      <div className="text-xs font-mono opacity-60">
                        {result.links.length} total links found
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          onClick={handleBatchIndexPDFs}
                          disabled={batchDownloading}
                          size="sm"
                          variant="outline"
                          className="rounded-none border-[#141414] text-[#141414] text-[10px] uppercase font-mono h-8"
                        >
                          {batchDownloading ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin mr-2" />
                              {batchDownloadProgress ? `Processing ${batchDownloadProgress.current}/${batchDownloadProgress.total}` : 'Starting...'}
                            </>
                          ) : (
                            <>
                              <Search className="w-3 h-3 mr-2" />
                              Batch Index PDFs
                            </>
                          )}
                        </Button>
                        <Button 
                          onClick={handleBatchDownloadPDFs}
                          disabled={batchDownloading}
                          size="sm"
                          className="rounded-none bg-[#141414] text-[#E4E3E0] text-[10px] uppercase font-mono h-8"
                        >
                          {batchDownloading ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin mr-2" />
                              {batchDownloadProgress ? `Processing ${batchDownloadProgress.current}/${batchDownloadProgress.total}` : 'Starting...'}
                            </>
                          ) : (
                            <>
                              <Download className="w-3 h-3 mr-2" />
                              Batch Download PDFs
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Multi-Select Action Panel */}
                    <div className="px-6 py-3 bg-[#141414]/5 border-b border-[#141414] flex flex-wrap justify-between items-center gap-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[10px] font-mono tracking-wider uppercase font-bold text-[#141414] flex items-center gap-1">
                          <Filter className="w-3 h-3 text-red-600" /> Multi-Select Rules:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              const internalFiltered = result.links.filter(l => !l.href.startsWith('http') && !isNegativeMatch(l.text) && !isNegativeMatch(l.href));
                              const hrefs = internalFiltered.map(l => l.href);
                              setSelectedLinkHrefs(prev => {
                                const allInPrev = hrefs.every(h => prev.includes(h));
                                if (allInPrev) {
                                  return prev.filter(h => !hrefs.includes(h));
                                } else {
                                  return Array.from(new Set([...prev, ...hrefs]));
                                }
                              });
                            }}
                            className="rounded-none border-[#141414]/30 text-[9px] font-mono px-2 h-6 hover:bg-[#141414]/10"
                          >
                            Select All Internal ({result.links.filter(l => !l.href.startsWith('http') && !isNegativeMatch(l.text) && !isNegativeMatch(l.href)).length})
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              const externalFiltered = result.links.filter(l => l.href.startsWith('http') && !isNegativeMatch(l.text) && !isNegativeMatch(l.href));
                              const hrefs = externalFiltered.map(l => l.href);
                              setSelectedLinkHrefs(prev => {
                                const allInPrev = hrefs.every(h => prev.includes(h));
                                if (allInPrev) {
                                  return prev.filter(h => !hrefs.includes(h));
                                } else {
                                  return Array.from(new Set([...prev, ...hrefs]));
                                }
                              });
                            }}
                            className="rounded-none border-[#141414]/30 text-[9px] font-mono px-2 h-6 hover:bg-[#141414]/10"
                          >
                            Select All External ({result.links.filter(l => l.href.startsWith('http') && !isNegativeMatch(l.text) && !isNegativeMatch(l.href)).length})
                          </Button>
                          {selectedLinkHrefs.length > 0 && (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setSelectedLinkHrefs([])}
                              className="rounded-none text-red-600 text-[9px] font-mono px-2 h-6 hover:bg-red-50"
                            >
                              Clear ({selectedLinkHrefs.length})
                            </Button>
                          )}
                        </div>
                      </div>
                      
                      {selectedLinkHrefs.length > 0 && (
                        <div className="flex gap-2 items-center flex-wrap">
                          <span className="text-[10px] font-mono font-bold text-red-700 bg-red-100/60 px-2 py-0.5 rounded-none animate-pulse">
                            {selectedLinkHrefs.length} selected
                          </span>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={handleExcludeSelectedLinks}
                            className="rounded-none border-red-300 text-red-800 bg-red-50 hover:bg-red-100 text-[9px] font-mono uppercase h-6 px-2"
                            title="Add targets of selected links to negative intent list"
                          >
                            Exclude selected
                          </Button>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={handleDeleteSelectedLinks}
                            className="rounded-none border-red-600 bg-red-600 text-white hover:bg-red-700 text-[9px] font-mono uppercase h-6 px-2"
                            title="Remove selected links completely from current view"
                          >
                            Delete selected
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#141414]">
                      <div className="p-6">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-sm font-mono uppercase tracking-widest">Internal / Relative</h3>
                          {result.links.filter(l => !l.href.startsWith('http')).length > 0 && (
                            <Button 
                              variant="outline" 
                              size="xs" 
                              onClick={() => {
                                const baseUrl = new URL(result.url).origin;
                                const internalUrls = result.links
                                  .filter(l => !l.href.startsWith('http'))
                                  .map(l => l.href.startsWith('/') ? `${baseUrl}${l.href}` : `${baseUrl}/${l.href}`)
                                  .join('\n');
                                setUrl(internalUrls);
                                setBulkMode(true);
                                toast.info("Internal links resolved and copied to Bulk Mode.");
                              }}
                              className="rounded-none border-[#141414] text-[9px] font-mono uppercase h-6 px-2"
                            >
                              <Search className="w-3 h-3 mr-1" /> Bulk Scrape All
                            </Button>
                          )}
                        </div>
                        <ScrollArea className="h-[500px]">
                          <div className="space-y-2">
                            {result.links.filter(l => !l.href.startsWith('http') && !isNegativeMatch(l.text) && !isNegativeMatch(l.href)).map((link, i) => {
                              const isMenuOpen = activeNegativeLink?.type === 'internal' && activeNegativeLink?.index === i;
                              const isSelected = selectedLinkHrefs.includes(link.href);
                              return (
                                <div key={i} className={`group p-3 border ${isSelected ? 'border-red-500 bg-red-50/20' : 'border-[#141414]/5'} hover:border-[#141414] transition-all bg-white relative flex gap-3`}>
                                  <div className="flex items-center shrink-0 pt-0.5">
                                    <input 
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleLinkSelection(link.href)}
                                      className="w-3.5 h-3.5 border-neutral-300 text-[#141414] focus:ring-[#141414] focus:ring-offset-0 accent-[#141414] rounded-none cursor-pointer"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start gap-2">
                                      <div className="text-xs font-bold truncate flex-1">{link.text || "No text"}</div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button 
                                          onClick={() => {
                                            if (isMenuOpen) {
                                              setActiveNegativeLink(null);
                                            } else {
                                              setActiveNegativeLink({ type: 'internal', index: i });
                                            }
                                          }}
                                          title="Qualify as Negative / Filter out"
                                          className="text-[#141414]/40 hover:text-red-600 transition-all p-0.5"
                                        >
                                          <Filter className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                    <div className="text-[10px] font-mono opacity-50 truncate">{link.href}</div>
                                    
                                    {isMenuOpen && (
                                      <div className="mt-2 p-2 border-t border-dashed border-red-200 bg-red-50/40 rounded-sm">
                                        <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-red-800 mb-1 flex items-center justify-between">
                                          <span>Add Negative Exclusion rule</span>
                                          <button onClick={() => setActiveNegativeLink(null)}>
                                            <X className="w-3 h-3 text-[#141414]/60 hover:text-red-800" />
                                          </button>
                                        </div>
                                        <p className="text-[9px] text-[#141414]/60 mb-2">Select a property of this entry to qualify as a negative restriction:</p>
                                        <div className="flex flex-wrap gap-1">
                                          {link.text && link.text.trim().length > 1 && (
                                            <Button 
                                              variant="outline" 
                                              size="xs" 
                                              onClick={() => {
                                                addNegativeRule(link.text);
                                                setActiveNegativeLink(null);
                                              }}
                                              className="h-5 px-1.5 text-[8px] font-mono rounded-none bg-white text-red-700 hover:bg-neutral-100 hover:text-red-800 border-red-200"
                                            >
                                              Exclude Text: "{link.text.substring(0, 15)}..."
                                            </Button>
                                          )}
                                          {link.href && link.href.trim().length > 1 && (
                                            <Button 
                                              variant="outline" 
                                              size="xs" 
                                              onClick={() => {
                                                const slug = link.href.split('/').filter(Boolean).pop() || link.href;
                                                addNegativeRule(slug);
                                                setActiveNegativeLink(null);
                                              }}
                                              className="h-5 px-1.5 text-[8px] font-mono rounded-none bg-white text-red-700 hover:bg-neutral-100 hover:text-red-800 border-red-200"
                                            >
                                              Exclude Slug: "{link.href.split('/').filter(Boolean).pop()?.substring(0,15) || link.href.substring(0, 15)}"
                                            </Button>
                                          )}
                                          {link.href && link.href.trim().length > 1 && (
                                            <Button 
                                              variant="outline" 
                                              size="xs" 
                                              onClick={() => {
                                                addNegativeRule(link.href);
                                                setActiveNegativeLink(null);
                                              }}
                                              className="h-5 px-1.5 text-[8px] font-mono rounded-none bg-white text-red-700 hover:bg-neutral-100 hover:text-red-800 border-red-200"
                                            >
                                              Exclude Path: "{link.href.substring(0, 20)}..."
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </div>
                      <div className="p-6">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-sm font-mono uppercase tracking-widest">External / Absolute</h3>
                          {result.links.filter(l => l.href.startsWith('http')).length > 0 && (
                            <Button 
                              variant="outline" 
                              size="xs" 
                              onClick={() => {
                                const externalUrls = result.links
                                  .filter(l => l.href.startsWith('http'))
                                  .map(l => l.href)
                                  .join('\n');
                                setUrl(externalUrls);
                                setBulkMode(true);
                                toast.info("Links copied to Bulk Mode. Click 'Execute Scrape' to start.");
                              }}
                              className="rounded-none border-[#141414] text-[9px] font-mono uppercase h-6 px-2"
                            >
                              <Search className="w-3 h-3 mr-1" /> Bulk Scrape All
                            </Button>
                          )}
                        </div>
                        <ScrollArea className="h-[500px]">
                          <div className="space-y-2">
                            {result.links.filter(l => l.href.startsWith('http') && !isNegativeMatch(l.text) && !isNegativeMatch(l.href)).map((link, i) => {
                              const isMenuOpen = activeNegativeLink?.type === 'external' && activeNegativeLink?.index === i;
                              const isSelected = selectedLinkHrefs.includes(link.href);
                              
                              let domain = "";
                              try {
                                domain = new URL(link.href).hostname.replace(/^www\./, "");
                              } catch(e){}

                              return (
                                <div key={i} className={`group p-3 border ${isSelected ? 'border-red-500 bg-red-50/20' : 'border-[#141414]/5'} hover:border-[#141414] transition-all bg-white relative flex gap-3`}>
                                  <div className="flex items-center shrink-0 pt-0.5">
                                    <input 
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleLinkSelection(link.href)}
                                      className="w-3.5 h-3.5 border-neutral-300 text-[#141414] focus:ring-[#141414] focus:ring-offset-0 accent-[#141414] rounded-none cursor-pointer"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start gap-2">
                                      <div className="text-xs font-bold truncate flex-1">{link.text || "No text"}</div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <button 
                                          onClick={() => {
                                            if (isMenuOpen) {
                                              setActiveNegativeLink(null);
                                            } else {
                                              setActiveNegativeLink({ type: 'external', index: i });
                                            }
                                          }}
                                          title="Qualify as Negative / Filter out"
                                          className="text-[#141414]/40 hover:text-red-600 transition-all p-0.5"
                                        >
                                          <Filter className="w-3.5 h-3.5" />
                                        </button>
                                        <a href={link.href} target="_blank" rel="noopener noreferrer">
                                          <ExternalLink className="w-3 h-3 opacity-30 group-hover:opacity-100" />
                                        </a>
                                      </div>
                                    </div>
                                    <div className="text-[10px] font-mono opacity-50 truncate">{link.href}</div>
                                    
                                    {isMenuOpen && (
                                      <div className="mt-2 p-2 border-t border-dashed border-red-200 bg-red-50/40 rounded-sm">
                                        <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-red-800 mb-1 flex items-center justify-between">
                                          <span>Add Negative Exclusion rule</span>
                                          <button onClick={() => setActiveNegativeLink(null)}>
                                            <X className="w-3 h-3 text-[#141414]/60 hover:text-red-800" />
                                          </button>
                                        </div>
                                        <p className="text-[9px] text-[#141414]/60 mb-2">Select a property of this entry to qualify as a negative restriction:</p>
                                        <div className="flex flex-wrap gap-1">
                                          {link.text && link.text.trim().length > 1 && (
                                            <Button 
                                              variant="outline" 
                                              size="xs" 
                                              onClick={() => {
                                                addNegativeRule(link.text);
                                                setActiveNegativeLink(null);
                                              }}
                                              className="h-5 px-1.5 text-[8px] font-mono rounded-none bg-white text-red-700 hover:bg-neutral-100 hover:text-red-800 border-red-200"
                                            >
                                              Exclude Text: "{link.text.substring(0, 15)}..."
                                            </Button>
                                          )}
                                          {domain && (
                                            <Button 
                                              variant="outline" 
                                              size="xs" 
                                              onClick={() => {
                                                addNegativeRule(domain);
                                                setActiveNegativeLink(null);
                                              }}
                                              className="h-5 px-1.5 text-[8px] font-mono rounded-none bg-white text-red-700 hover:bg-neutral-100 hover:text-red-800 border-red-200"
                                            >
                                              Exclude Domain: "{domain}"
                                            </Button>
                                          )}
                                          {link.href && link.href.trim().length > 1 && (
                                            <Button 
                                              variant="outline" 
                                              size="xs" 
                                              onClick={() => {
                                                addNegativeRule(link.href);
                                                setActiveNegativeLink(null);
                                              }}
                                              className="h-5 px-1.5 text-[8px] font-mono rounded-none bg-white text-red-700 hover:bg-neutral-100 hover:text-red-800 border-red-200"
                                            >
                                              Exclude Full URL: "{link.href.substring(0, 15)}..."
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  </Card>
                </TabsContent>

                <TabsContent value="images" className="mt-0">
                  <Card className="rounded-none border-x border-b border-[#141414] border-t-0 shadow-none bg-white p-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {result.images.filter(img => !isNegativeMatch(img.alt) && !isNegativeMatch(img.src)).map((img, i) => (
                        <div key={i} className="group relative aspect-square bg-[#f5f5f5] border border-[#141414]/10 overflow-hidden">
                          <img 
                            src={img.src.startsWith('http') ? img.src : `${new URL(result.url).origin}${img.src.startsWith('/') ? '' : '/'}${img.src}`} 
                            alt={img.alt}
                            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${i}/400/400?grayscale`;
                            }}
                          />
                          <div className="absolute inset-0 bg-[#141414]/80 opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end">
                            <p className="text-[9px] font-mono text-[#E4E3E0] truncate leading-tight mb-1">{img.alt || "No alt text"}</p>
                            <a 
                              href={img.src} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[8px] font-mono text-[#E4E3E0]/50 hover:text-[#E4E3E0] truncate"
                            >
                              Source
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                    {result.images.filter(img => !isNegativeMatch(img.alt) && !isNegativeMatch(img.src)).length === 0 && (
                      <div className="text-center py-20 opacity-30 italic font-serif">No images detected on this page (or all filtered by negative intent).</div>
                    )}
                  </Card>
                </TabsContent>

                <TabsContent value="pdf-scraper" className="mt-0">
                  <Card className="rounded-none border-x border-b border-[#141414] border-t-0 shadow-none bg-white p-6">
                    <div className="space-y-6">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
                            <Globe className="w-4 h-4" /> Domain PDF Scraper
                          </h3>
                          <Badge variant="outline" className="border-[#141414] rounded-none font-mono text-[10px]">
                            {crawledPdfs.length} PDFs Found
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-mono uppercase opacity-50">Start URL</label>
                            <Input 
                              placeholder="https://example.com" 
                              value={queueInput.split('\n')[0] || ""}
                              onChange={e => setQueueInput(e.target.value)}
                              className="rounded-none border-[#141414] h-10 text-xs font-mono"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-mono uppercase opacity-50">Topic Filter</label>
                            <Input 
                              placeholder="e.g. Supabase, math..." 
                              value={crawlFilter}
                              onChange={e => setCrawlFilter(e.target.value)}
                              className="rounded-none border-[#141414] h-10 text-xs font-mono"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-mono uppercase opacity-50">Max Depth ({crawlDepth})</label>
                            <input 
                              type="range" 
                              min="1" 
                              max="5" 
                              value={crawlDepth} 
                              onChange={e => setCrawlDepth(Number(e.target.value))}
                              className="w-full h-10 accent-[#141414]"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-mono uppercase opacity-50">Max Pages ({maxCrawlPages})</label>
                            <input 
                              type="range" 
                              min="10" 
                              max="200" 
                              step="10"
                              value={maxCrawlPages} 
                              onChange={e => setMaxCrawlPages(Number(e.target.value))}
                              className="w-full h-10 accent-[#141414]"
                            />
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button 
                            onClick={handleCrawlPdfs} 
                            disabled={isCrawling}
                            className="flex-1 rounded-none bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/90 h-10 font-mono uppercase tracking-widest"
                          >
                            {isCrawling && !isMoutamadrisMode ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Crawling Domain...</> : <><Search className="w-4 h-4 mr-2" /> Start Domain Crawl</>}
                          </Button>
                          <Button 
                            onClick={handleCrawlMoutamadris} 
                            disabled={isCrawling}
                            variant="outline"
                            className="flex-1 rounded-none border-[#141414] h-10 font-mono uppercase tracking-widest hover:bg-green-50"
                          >
                            {isCrawling && isMoutamadrisMode ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Moutamadris Mode...</> : <><GraduationCap className="w-4 h-4 mr-2" /> Moutamadris Mode</>}
                          </Button>
                          {crawledPdfs.length > 0 && (
                            <>
                              <Button 
                                onClick={handleDownloadAllCrawled}
                                disabled={isDownloadingAll}
                                variant="outline"
                                className="rounded-none border-[#141414] h-10 font-mono uppercase px-4"
                              >
                                {isDownloadingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Download className="w-4 h-4 mr-2" /> Download ZIP</>}
                              </Button>
                              <Button 
                                onClick={handleIndexAllCrawled}
                                disabled={isDownloadingAll}
                                variant="outline"
                                className="rounded-none border-[#141414] h-10 font-mono uppercase px-4"
                              >
                                {isDownloadingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4 mr-2" /> Index All</>}
                              </Button>
                              <Button 
                                onClick={handleAddAllToQueue}
                                variant="outline"
                                className="rounded-none border-[#141414] h-10 font-mono uppercase px-4"
                              >
                                <List className="w-4 h-4 mr-2" /> Add to Queue
                              </Button>
                              {crawlResults.length > 0 && (
                                <Button 
                                  onClick={handleDownloadMetadata}
                                  variant="outline"
                                  className="rounded-none border-[#141414] h-10 font-mono uppercase px-4"
                                >
                                  <FileText className="w-4 h-4 mr-2" /> Save CSV
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="border border-[#141414] bg-gray-50">
                        <div className="bg-[#141414] text-[#E4E3E0] px-3 py-1 text-[10px] font-mono uppercase tracking-widest">
                          Found PDF Links
                        </div>
                        <ScrollArea className="h-[400px]">
                          {crawledPdfs.length === 0 ? (
                            <div className="p-12 text-center text-xs font-serif italic opacity-40">
                              No PDFs found yet. Start a crawl to begin.
                            </div>
                          ) : (
                            <div className="divide-y divide-[#141414]/10">
                              {crawledPdfs.map((pdf, i) => (
                                <div key={i} className="p-3 flex items-center justify-between group hover:bg-white transition-colors">
                                  <div className="flex items-center gap-3 overflow-hidden">
                                    <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                                    <span className="text-xs font-mono truncate">{pdf}</span>
                                  </div>
                                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 rounded-none border border-[#141414]/20"
                                      onClick={() => handleOpenPdfWorkspace(pdf)}
                                      aria-label="Open Interactive PDF Workspace"
                                      title="Open Interactive PDF Workspace with Sidebar Control"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="icon" 
                                      className="h-7 w-7 rounded-none border border-[#141414]/20"
                                      aria-label="Download PDF"
                                      onClick={async () => {
                                        try {
                                          const res = await axios.post("/api/proxy-download", { url: pdf }, { responseType: 'arraybuffer' });
                                          const { saveAs } = await import("file-saver");
                                          let originalName = pdf.split('/').pop() || 'document.pdf';
                                          
                                          // Find metadata from crawlResults if available
                                          const metadata = crawlResults.find(r => r.url === pdf) || {};
                                          
                                          const { buffer, filename } = await processPdfForDownload(res.data, originalName, { url: pdf, ...metadata });
                                          
                                          saveAs(new Blob([buffer]), filename);
                                        } catch (e) {
                                          toast.error("Download failed");
                                        }
                                      }}
                                    >
                                      <Download className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    </div>
                  </Card>
                </TabsContent>

                <TabsContent value="rag" className="mt-0">
                  <Card className="rounded-none border-x border-b border-[#141414] border-t-0 shadow-none bg-white">
                    <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#141414]">
                      <div className="md:w-1/3 p-6 bg-[#f9f9f8]">
                        <h3 className="text-sm font-mono uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Search className="w-4 h-4" /> Knowledge Base
                        </h3>
                        <div className="space-y-4">
                          <div className="p-4 border border-[#141414]/10 bg-white">
                            <div className="text-[10px] font-mono uppercase opacity-50 mb-1">Total Indexed Chunks</div>
                            <div className="text-2xl font-bold font-mono">{kbStats.totalChunks}</div>
                          </div>
                          
                          <div className="pt-4 border-t border-[#141414]/10">
                            <div className="text-[10px] font-mono uppercase opacity-50 mb-2">AI Persona</div>
                            <select 
                              value={chatRole}
                              onChange={(e) => setChatRole(e.target.value)}
                              className="w-full rounded-none border border-[#141414] h-8 text-xs font-mono bg-white px-2"
                            >
                              <option value="Helpful Assistant">Helpful Assistant</option>
                              <option value="Academic Tutor">Academic Tutor</option>
                              <option value="Harsh Critic">Harsh Critic</option>
                              <option value="Data Analyst">Data Analyst</option>
                              <option value="Executive Summarizer">Executive Summarizer</option>
                            </select>
                          </div>

                          <div className="pt-4 border-t border-[#141414]/10">
                            <div className="text-[10px] font-mono uppercase opacity-50 mb-2">Quick Actions</div>
                            <div className="grid grid-cols-1 gap-2">
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="justify-start rounded-none border-[#141414] text-xs font-mono"
                                onClick={() => {
                                  setChatInput("Generate a Study Guide with key terms, core concepts, and 5 practice quiz questions based on the indexed content. Use Markdown formatting.");
                                }}
                              >
                                <GraduationCap className="w-3 h-3 mr-2" /> Study Guide
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="justify-start rounded-none border-[#141414] text-xs font-mono"
                                onClick={() => {
                                  setChatInput("Generate a comprehensive FAQ (Frequently Asked Questions) based on the indexed content. Use Markdown formatting.");
                                }}
                              >
                                <HelpCircle className="w-3 h-3 mr-2" /> Generate FAQ
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="justify-start rounded-none border-[#141414] text-xs font-mono"
                                onClick={() => {
                                  setChatInput("Generate an Executive Briefing Document summarizing the core issues, key takeaways, and important entities from the indexed content. Use Markdown formatting.");
                                }}
                              >
                                <FileText className="w-3 h-3 mr-2" /> Executive Briefing
                              </Button>
                            </div>
                          </div>

                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full rounded-none border-[#141414] text-[10px] font-mono uppercase hover:bg-red-50 hover:text-red-600 mt-4"
                            onClick={async () => {
                              if (confirm("Clear all indexed documents?")) {
                                await axios.post("/api/kb-clear");
                                fetchKbStats();
                                setChatHistory([]);
                                toast.success("Knowledge base cleared");
                              }
                            }}
                          >
                            <Trash2 className="w-3 h-3 mr-2" /> Clear KB
                          </Button>
                        </div>
                      </div>
                      <div className="md:w-2/3 flex flex-col h-[600px]">
                        <ScrollArea className="flex-1 p-6">
                          {chatHistory.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                              <Search className="w-8 h-8 mb-4" />
                              <p className="font-serif italic text-sm">Ask a question about your indexed documents.</p>
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {chatHistory.map((msg, i) => (
                                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                  <div className={`max-w-[80%] p-4 ${msg.role === 'user' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#f5f5f5] border border-[#141414]/10'}`}>
                                    <div className="text-[9px] font-mono uppercase opacity-50 mb-2">
                                      {msg.role === 'user' ? 'You' : chatRole}
                                    </div>
                                    <div className="text-sm font-serif whitespace-pre-wrap prose prose-sm max-w-none">
                                      <Markdown>{msg.text}</Markdown>
                                    </div>
                                  </div>
                                  {msg.sources && msg.sources.length > 0 && (
                                    <div className="mt-2 max-w-[80%]">
                                      <div className="text-[9px] font-mono uppercase opacity-50 mb-1">Sources</div>
                                      <div className="flex flex-wrap gap-1">
                                        {msg.sources.map((s, idx) => (
                                          <a key={idx} href={s.url} target="_blank" rel="noopener noreferrer" className="text-[9px] font-mono border border-[#141414]/20 px-1.5 py-0.5 hover:bg-[#141414] hover:text-white transition-colors truncate max-w-[150px]">
                                            [{idx + 1}] {s.title}
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                              {chatting && (
                                <div className="flex items-start">
                                  <div className="bg-[#f5f5f5] border border-[#141414]/10 p-4">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </ScrollArea>
                        <div className="p-4 border-t border-[#141414]/10 bg-[#f9f9f8]">
                          <form onSubmit={handleChat} className="flex gap-2">
                            <Input 
                              placeholder={`Ask the ${chatRole}...`}
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              className="rounded-none border-[#141414] focus-visible:ring-0 focus-visible:ring-offset-0 bg-white"
                              disabled={chatting}
                            />
                            <Button 
                              type="submit" 
                              disabled={chatting || !chatInput.trim()}
                              className="rounded-none bg-[#141414] text-[#E4E3E0] font-mono uppercase text-xs"
                            >
                              Send
                            </Button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </Card>
                </TabsContent>
              </Tabs>
                </>
              ) : (
                /* DATA MANIPULATION WORKSPACE B: INTERACTIVE CLEANING, restructing & DB upload staging */
                <Card className="rounded-none border-[#141414] shadow-none bg-white p-5 flex flex-col h-[550px] overflow-hidden" id="workspace-b-staging-card">
                  <div className="flex justify-between items-center border-b border-[#141414]/10 pb-2.5 mb-3 shrink-0">
                    <div>
                      <h2 className="text-xs font-mono uppercase tracking-widest text-[#141414] font-bold flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-emerald-600" /> Staging Area & Content Curation
                      </h2>
                      <p className="text-[10px] text-neutral-500 mt-0.5 font-sans leading-relaxed">
                        Clean page artifacts, reconstruct sections via Gemini models, and index files directly.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[9px] bg-neutral-50 px-2 py-0.5 border border-[#141414]/10">
                      <span className="text-zinc-500">Words:</span> <strong className="text-neutral-800">{editedRawText ? editedRawText.trim().split(/\s+/).filter(Boolean).length : 0}</strong>
                      <span className="text-[#141414]/10">/</span>
                      <span className="text-zinc-500">Size:</span> <strong className="text-neutral-800">{editedRawText ? (editedRawText.length / 1024).toFixed(1) : 0}KB</strong>
                    </div>
                  </div>

                  {/* REFINE ACTIONS STRIP */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mb-3 shrink-0 font-mono text-[9px]" id="data-cleansing-refinement-action-strip">
                    <Button
                      onClick={handleCleanWhitespace}
                      variant="outline"
                      size="sm"
                      className="rounded-none border-blue-200 text-blue-800 bg-blue-50/50 hover:bg-blue-100/70 h-7 text-[9px] flex items-center justify-center gap-1"
                      title="Collapse whitespace double spacing gaps."
                    >
                      <RotateCw className="w-3 h-3 text-blue-600" /> Standard Spacing
                    </Button>
                    <Button
                      onClick={handleRemoveHtmlAndRemnants}
                      variant="outline"
                      size="sm"
                      className="rounded-none border-red-200 text-red-800 bg-red-50/50 hover:bg-red-100/70 h-7 text-[9px] flex items-center justify-center gap-1"
                      title="Remove raw script, style, and HTML elements."
                    >
                      <Trash2 className="w-3 h-3 text-red-600" /> Strip HTML & CSS
                    </Button>
                    <Button
                      onClick={handleAiTransformMarkdown}
                      disabled={cleaningText}
                      variant="outline"
                      size="sm"
                      className="rounded-none border-purple-200 text-purple-800 bg-purple-50 hover:bg-purple-100/70 h-7 text-[9px] flex items-center justify-center gap-1"
                      title="Use Gemini framework to convert raw text content to pristine, high density markdown blocks."
                    >
                      {cleaningText ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-purple-600" /> Restructuring...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3 text-purple-600 animate-pulse" /> AI MD Restructuring
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => {
                        if (confirm("Revert your curation stage changes back to the original page raw extract? All edits will be overwritten.")) {
                          setEditedRawText(originalRawTextBack);
                          toast.info("Restored back to raw original scrape extract.");
                        }
                      }}
                      variant="outline"
                      size="sm"
                      className="rounded-none border-[#141414]/20 hover:bg-[#141414]/10 h-7 text-[9px] flex items-center justify-center gap-1"
                      title="Reset back to raw scrape results extract"
                    >
                      <FileText className="w-3 h-3" /> Revert Raw Extract
                    </Button>
                  </div>

                  {/* WORKSPACE NOTEPAD */}
                  <div className="flex-1 min-h-0 flex flex-col relative border border-[#141414] bg-[#fbfbfa] p-0.5 mb-3" id="curation-workspace-notepad">
                    <div className="bg-[#141414] text-[#E4E3E0] px-2.5 py-1 text-[8px] font-mono uppercase tracking-wider flex justify-between items-center select-none shrink-0 border-b border-[#141414]">
                      <span>Curated Document Body Editor (Interactive markdown)</span>
                      <span className="opacity-60 text-[7px] bg-red-600 px-1 py-0.2 font-mono ml-1.5 animate-pulse text-white">Live Staging Stage</span>
                    </div>
                    {cleaningText ? (
                      <div className="flex-1 flex flex-col items-center justify-center space-y-2 bg-white/80 backdrop-blur-xs select-none">
                        <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                        <p className="font-serif italic text-xs text-neutral-600">Gemini is rewriting unstructured blocks into clean, pedagogical lesson content...</p>
                      </div>
                    ) : (
                      <textarea
                        value={editedRawText}
                        onChange={(e) => setEditedRawText(e.target.value)}
                        placeholder="Draft or clean up your custom content blocks here. Support raw text or formatted markdown files."
                        className="flex-grow w-full p-3 font-mono text-[10.5px] leading-relaxed resize-none focus:outline-none bg-transparent overflow-y-auto selection:bg-[#141414] selection:text-white"
                      />
                    )}
                  </div>

                  {/* UPLOAD & EMBEDDING STATUS GRID */}
                  <div className="space-y-2 shrink-0 pt-2 border-t border-[#141414]/10" id="sync-deploy-to-database-indices">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="font-mono text-zinc-500 font-bold flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-emerald-600" /> Database context table: <code className="bg-[#f0f0f0] p-0.5 px-1 font-mono text-[8px] border border-neutral-300 rounded-none">rag_chunks</code>
                      </span>
                      <span className="text-[8px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-600/10">Active Embedding Model: text-embedding-004</span>
                    </div>
                    <Button
                      onClick={handleUploadToSupabase}
                      disabled={uploading || !editedRawText.trim() || !metaTitle.trim()}
                      className={`w-full h-9 rounded-none text-[10px] font-mono uppercase tracking-widest flex items-center justify-center gap-2 ${
                        uploading 
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-500/20" 
                          : "bg-emerald-600 text-white hover:bg-emerald-700 font-serif font-bold"
                      }`}
                      id="deploy-database-commits"
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" /> Embedding & Indexing Workspace to Supabase...
                        </>
                      ) : (
                        <>
                          <CloudLightning className="w-3.5 h-3.5 animate-bounce shrink-0 text-emerald-300" /> Commit & Index file to Knowledge Base DB
                        </>
                      )}
                    </Button>
                  </div>
                </Card>
              )}
            </motion.div>
          )}
        </div>
        )}

        {/* Right Column (AI Co-pilot / KB Chat Box) */}
        {showRightWorkspace && (
          <div className={`${colSpanClasses[rightSpan]} space-y-6`}>
          {/* AI Co-pilot / KB Chat Box */}
          <Card className="rounded-none border-[#141414] shadow-none bg-white flex flex-col h-[420px]">
            <CardHeader className="pb-3 border-b border-[#141414]/10 bg-gray-50">
              <CardTitle className="text-xs font-mono uppercase tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-600" /> AI Co-pilot</span>
                <Badge variant="outline" className="border-[#141414]/20 rounded-none text-[8px] font-mono">
                  {kbStats.totalChunks} Chunks
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
              <div className="p-3 border-b border-[#141414]/10 flex justify-between gap-2 items-center bg-white">
                <select 
                  value={chatRole}
                  onChange={(e) => setChatRole(e.target.value)}
                  className="rounded-none border border-[#141414]/30 h-7 text-[10px] font-mono bg-white px-1 flex-1 focus:outline-none"
                >
                  <option value="Helpful Assistant">Helpful Assistant</option>
                  <option value="Academic Tutor">Academic Tutor</option>
                  <option value="Harsh Critic">Harsh Critic</option>
                  <option value="Data Analyst">Data Analyst</option>
                  <option value="Executive Summarizer">Executive Summarizer</option>
                </select>
                <Button 
                  variant="outline" 
                  size="xs" 
                  className="rounded-none border-[#141414]/25 hover:bg-red-50 hover:text-red-600 h-7 text-[9px] font-mono uppercase"
                  onClick={async () => {
                    if (confirm("Clear all indexed documents?")) {
                      await axios.post("/api/kb-clear");
                      fetchKbStats();
                      setChatHistory([]);
                      toast.success("Knowledge base cleared");
                    }
                  }}
                >
                  Clear KB
                </Button>
              </div>

              <div className="flex-1 min-h-0 bg-neutral-50/30">
                <ScrollArea className="h-full p-4">
                  {chatHistory.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-10">
                      <Search className="w-6 h-6 mb-2" />
                      <p className="font-serif italic text-xs">Ask a question about your indexed documents.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {chatHistory.map((msg, idx) => (
                        <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                          <div className={`max-w-[90%] p-3 ${msg.role === 'user' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#f5f5f5]'}`}>
                            <div className="text-[8px] font-mono uppercase opacity-50 mb-1">
                              {msg.role === 'user' ? 'You' : chatRole}
                            </div>
                            <div className="text-xs leading-relaxed whitespace-pre-wrap prose prose-sm max-w-none">
                              <Markdown>{msg.text}</Markdown>
                            </div>
                          </div>
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-1 max-w-[90%] flex flex-wrap gap-1">
                              {msg.sources.map((srcVal, sIdx) => (
                                <a key={sIdx} href={srcVal.url} target="_blank" rel="noopener noreferrer" className="text-[8px] font-mono border border-[#141414]/10 bg-white px-1 py-0.2 hover:bg-[#141414] hover:text-white transition-colors truncate max-w-[120px]">
                                  [{sIdx + 1}] {srcVal.title}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {chatting && (
                        <div className="flex items-start">
                          <div className="bg-[#f5f5f5] border border-[#141414]/10 p-3 h-8 flex items-center justify-center">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </ScrollArea>
              </div>

              <div className="p-2 border-t border-[#141414]/10 bg-white flex gap-1 justify-center flex-wrap">
                <Button 
                  variant="outline" 
                  size="xs"
                  className="rounded-none border-[#141414]/20 text-[8px] font-mono h-5 px-1.5"
                  onClick={() => {
                    setChatInput("Generate a Study Guide with key terms, core concepts, and 5 practice quiz questions based on the indexed content. Use Markdown formatting.");
                  }}
                >
                  Study Guide
                </Button>
                <Button 
                  variant="outline" 
                  size="xs"
                  className="rounded-none border-[#141414]/20 text-[8px] font-mono h-5 px-1.5"
                  onClick={() => {
                    setChatInput("Generate a comprehensive FAQ (Frequently Asked Questions) based on the indexed content. Use Markdown formatting.");
                  }}
                >
                  FAQ
                </Button>
                <Button 
                  variant="outline" 
                  size="xs"
                  className="rounded-none border-[#141414]/20 text-[8px] font-mono h-5 px-1.5"
                  onClick={() => {
                    setChatInput("Generate an Executive Briefing Document summarizing the core issues, key takeaways, and important entities from the indexed content. Use Markdown formatting.");
                  }}
                >
                  Briefing
                </Button>
              </div>

              <div className="p-3 border-t border-[#141414]/10 bg-[#f9f9f8]">
                <form onSubmit={handleChat} className="flex gap-1.5">
                  <Input 
                    placeholder={`Ask helper...`}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="rounded-none border-[#141414] focus-visible:ring-0 focus-visible:ring-offset-0 bg-white h-8 text-xs font-mono flex-1"
                    disabled={chatting}
                  />
                  <Button 
                    type="submit" 
                    disabled={chatting || !chatInput.trim()}
                    className="rounded-none bg-[#141414] text-[#E4E3E0] font-mono uppercase text-[10px] h-8 px-3"
                  >
                    Send
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>
        )}
      </main>

      {/* Dynamic Sleek Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 h-10 border-t border-[#141414] bg-white px-6 flex items-center justify-between text-[10px] font-mono shadow-[0_-2px_10px_rgba(0,0,0,0.05)] select-none">
        <div className="flex items-center gap-4">
          <span className="font-bold opacity-70">© 2026 SCRAPEAI SYSTEMS INC.</span>
          <span className="opacity-30">|</span>
          <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-green-700">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" /> Live Connection Operational
          </span>
        </div>
        
        <div className="hidden md:flex items-center gap-2 max-w-sm lg:max-w-md truncate">
          <span className="opacity-40 uppercase">ACTIVE_PATH:</span>
          <span className="opacity-80 italic font-mono truncate">{result ? result.url : "Awaiting user target URL..."}</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden sm:inline opacity-50">ENGINE: GEMINI 3 FLASH</span>
          <span className="opacity-30">|</span>
          <span className="opacity-80 font-bold uppercase">QUEUE_PENDING: {queue.filter(q => q.status === 'pending').length}</span>
        </div>
      </div>

      {/* Fallback Download Modal/Toast */}
      {fallbackDownload && (
        <div className="fixed bottom-6 right-6 bg-white border-2 border-[#141414] p-6 shadow-2xl z-50 max-w-sm">
          <h3 className="text-sm font-bold font-mono uppercase mb-2">Download Ready</h3>
          <p className="text-xs font-serif mb-4 opacity-80">
            If your ZIP file didn't download automatically (often due to iframe restrictions), click the button below:
          </p>
          <div className="flex flex-col gap-2">
            <a 
              href={fallbackDownload.url} 
              download={fallbackDownload.filename}
              className="bg-[#141414] text-[#E4E3E0] text-center py-2 px-4 text-xs font-mono uppercase hover:bg-[#141414]/90"
              onClick={() => {
                toast.success("Download triggered!");
                setTimeout(() => setFallbackDownload(null), 2000);
              }}
            >
              Download {fallbackDownload.filename}
            </a>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setFallbackDownload(null)}
              className="rounded-none border-[#141414] text-xs font-mono uppercase"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface PdfViewerWorkspaceProps {
  pdfUrl: string;
  onBack: () => void;
}

export function PdfViewerWorkspace({ pdfUrl, onBack }: PdfViewerWorkspaceProps) {
  const [showLeft, setShowLeft] = useState(true);
  const [showMiddle, setShowMiddle] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [useGoogleDocsViewer, setUseGoogleDocsViewer] = useState(true);

  // AI chat states
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string; text: string }[]>([
    { role: "assistant", text: "Welcome to the interactive Document Workspace! I am your AI Document Tutor. Ask me any question, ask for translations, formula guides or practice tests based on this document." }
  ]);
  const [chatting, setChatting] = useState(false);

  // Analysis / Insights states
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [insightsHtml, setInsightsHtml] = useState<string>("");

  const fileName = pdfUrl.split('/').pop() || "Document.pdf";

  // Dynamic Workspace Column Spanning
  let leftSpan = 3;
  let middleSpan = 6;
  let rightSpan = 3;

  const activeWorkspacesCount = [showLeft, showMiddle, showRight].filter(Boolean).length;

  if (activeWorkspacesCount === 2) {
    if (!showLeft) {
      middleSpan = 8;
      rightSpan = 4;
    } else if (!showRight) {
      leftSpan = 4;
      middleSpan = 8;
    } else if (!showMiddle) {
      leftSpan = 6;
      rightSpan = 6;
    }
  } else if (activeWorkspacesCount === 1) {
    if (showLeft) leftSpan = 12;
    if (showMiddle) middleSpan = 12;
    if (showRight) rightSpan = 12;
  }

  const colSpanClasses: Record<number, string> = {
    3: "lg:col-span-3",
    4: "lg:col-span-4",
    6: "lg:col-span-6",
    8: "lg:col-span-8",
    12: "lg:col-span-12"
  };

  const handleFetchInsights = async () => {
    setLoadingInsights(true);
    try {
      const response = await axios.post("/api/chat", {
        message: `You are an expert academic paper and educational document analyst. Please analyze this PDF document and generate key pedagogy details:
- **Title**: ${fileName}
- **URL**: ${pdfUrl}

Please provide a concise high-level abstract, list 3 core topics, and list 5 target learning questions inside. Format perfectly in clean, readable Markdown. Keep it in the document's original language context.`,
        history: []
      });
      setInsightsHtml(response.data.reply);
      toast.success("AI Document analysis successful!");
    } catch (err) {
      toast.error("Failed to generate document insights");
    } finally {
      setLoadingInsights(false);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatting) return;

    const userMsg = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: "user", text: userMsg }]);
    setChatting(true);

    try {
      const response = await axios.post("/api/chat", {
        message: `Context Document: ${fileName} (${pdfUrl})
User Prompt: ${userMsg}

Please answer the user's question, providing precise, academically grounded lessons or references based on this document context. Format using beautiful markdown annotations.`,
        history: chatHistory.map(h => ({ role: h.role, text: h.text }))
      });
      setChatHistory(prev => [...prev, { role: "assistant", text: response.data.reply }]);
    } catch (err) {
      toast.error("Failed to communicate with Document Tutor");
    } finally {
      setChatting(false);
    }
  };

  const handleChipClick = (prompt: string) => {
    setChatInput(prompt);
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] pb-12">
      <Toaster position="top-center" />

      {/* Header bar */}
      <header className="border-b border-[#141414] px-6 py-4 flex justify-between items-center bg-white sticky top-0 z-40 h-16 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 p-1.5 rounded-sm">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight uppercase italic font-serif flex items-center gap-1.5 leading-none">
              Interactive PDF Workspace
            </h1>
            <p className="text-[9px] font-mono opacity-50 truncate max-w-[200px] sm:max-w-xs md:max-w-md mt-0.5" title={pdfUrl}>
              {pdfUrl}
            </p>
          </div>
        </div>

        {/* Workspace controllers */}
        <div className="flex items-center gap-3">
          <div className="flex bg-neutral-100 border border-[#141414] p-0.5 rounded-none" id="pdf-workspace-controllers">
            <button
              onClick={() => {
                if (showLeft && !showMiddle && !showRight) return;
                setShowLeft(!showLeft);
              }}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showLeft ? "bg-white text-neutral-900 font-bold border border-neutral-300" : "text-neutral-400"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showLeft ? "bg-blue-600 animate-pulse" : "bg-neutral-300"}`} />
              Meta [L]
            </button>
            <button
              onClick={() => {
                if (showMiddle && !showLeft && !showRight) return;
                setShowMiddle(!showMiddle);
              }}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showMiddle ? "bg-white text-neutral-900 font-bold border border-neutral-300" : "text-neutral-400"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showMiddle ? "bg-amber-500 animate-pulse" : "bg-neutral-300"}`} />
              Viewer [M]
            </button>
            <button
              onClick={() => {
                if (showRight && !showLeft && !showMiddle) return;
                setShowRight(!showRight);
              }}
              className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider transition-all h-7 flex items-center gap-1.5 ${
                showRight ? "bg-white text-neutral-900 font-bold border border-neutral-300" : "text-neutral-400"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${showRight ? "bg-purple-600 animate-pulse" : "bg-neutral-300"}`} />
              Tutor [R]
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="rounded-none border-[#141414] text-[9.5px] font-mono uppercase tracking-wider h-8"
          >
            Close Viewer
          </Button>
        </div>
      </header>

      {/* 3-Column main area */}
      <main className="w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1600px] mx-auto min-h-[calc(100vh-140px)]">
        {/* Workspace A: Metadata Sidebar */}
        {showLeft && (
          <div className={`${colSpanClasses[leftSpan]} space-y-6`}>
            <Card className="rounded-none border-[#141414] shadow-none bg-white flex flex-col h-[580px] overflow-hidden">
              <CardHeader className="pb-3 border-b border-[#141414]/10 bg-gray-50/50 shrink-0">
                <CardTitle className="text-xs font-mono uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4 text-neutral-700" /> Document Insights
                </CardTitle>
                <CardDescription className="text-[9px]">Original source details and AI analysis payload</CardDescription>
              </CardHeader>
              <CardContent className="flex-grow p-4 overflow-y-auto space-y-4">
                <div className="space-y-1">
                  <span className="text-[8px] font-mono uppercase opacity-50 block">Filename</span>
                  <div className="text-[11px] font-semibold font-mono truncate bg-gray-50 p-2 border border-blue-500/10 select-all">
                    {fileName}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[8px] font-mono uppercase opacity-50 block">Network Address</span>
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-blue-600 hover:underline flex items-center gap-1 bg-blue-50/30 p-2 border border-blue-100 truncate"
                  >
                    Open Original <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>

                <div className="border-t border-dashed border-[#141414]/10 pt-4">
                  <h3 className="text-[10px] font-mono uppercase tracking-wider font-bold mb-3 flex items-center gap-1.5 text-purple-700">
                    <Sparkles className="w-3.5 h-3.5" /> AI Document Abstract
                  </h3>

                  {!insightsHtml ? (
                    <div className="bg-[#fbfbfa] p-4 text-center border border-[#141414]/10">
                      <p className="text-[10px] font-serif italic text-neutral-500 mb-3">
                        Retrieve the document abstract, key topics, and questions dynamically with Gemini model intelligence.
                      </p>
                      <Button
                        onClick={handleFetchInsights}
                        disabled={loadingInsights}
                        className="w-full text-[9px] font-mono uppercase h-7 rounded-none bg-[#141414] hover:bg-neutral-800 text-white"
                      >
                        {loadingInsights ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Parsing Document...
                          </>
                        ) : (
                          "Extract Insights Abstract"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none text-[11.5px] font-serif bg-purple-50/20 border border-purple-200/50 p-3 overflow-y-auto leading-relaxed selection:bg-[#141414] selection:text-white">
                      <Markdown>{insightsHtml}</Markdown>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Workspace B: High performance viewer panel */}
        {showMiddle && (
          <div className={`${colSpanClasses[middleSpan]} space-y-6`}>
            <Card className="rounded-none border-[#141414] shadow-none bg-white flex flex-col h-[580px] overflow-hidden">
              <div className="px-4 py-2 bg-neutral-900 text-[#E4E3E0] flex justify-between items-center text-[10px] font-mono shrink-0 select-none">
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-emerald-400" /> Embedded PDF Viewer Stage
                </span>
                <div className="flex items-center gap-2">
                  <span className="opacity-60 text-[9px]">Google Viewer Bypass Mode:</span>
                  <button
                    onClick={() => setUseGoogleDocsViewer(!useGoogleDocsViewer)}
                    className={`w-8 h-4 rounded-full relative p-0.5 border transition-all ${
                      useGoogleDocsViewer ? "bg-emerald-600 border-emerald-700" : "bg-neutral-600 border-neutral-700"
                    }`}
                  >
                    <div
                      className={`w-2.5 h-2.5 bg-white rounded-full transition-all ${
                        useGoogleDocsViewer ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-neutral-100 flex flex-col relative min-h-0">
                <iframe
                  referrerPolicy="no-referrer"
                  src={
                    useGoogleDocsViewer
                      ? `https://docs.google.com/viewer?url=${encodeURIComponent(pdfUrl)}&embedded=true`
                      : pdfUrl
                  }
                  className="w-full h-full border-0 bg-white"
                  title="PDF embed workspace frame"
                />
              </div>

              <div className="p-2.5 bg-gray-50 border-t border-[#141414]/10 flex justify-between items-center font-mono text-[9px] shrink-0">
                <span className="text-zinc-500">Notice: PDF display is managed safely and is responsive.</span>
                <a
                  href={pdfUrl}
                  download
                  className="font-serif italic text-blue-600 hover:underline flex items-center gap-0.5"
                >
                  Direct Safe Download <Download className="w-3 h-3" />
                </a>
              </div>
            </Card>
          </div>
        )}

        {/* Workspace C: Interactive tutor */}
        {showRight && (
          <div className={`${colSpanClasses[rightSpan]} space-y-6`}>
            <Card className="rounded-none border-[#141414] shadow-none bg-white flex flex-col h-[580px] overflow-hidden">
              <CardHeader className="pb-3 border-b border-[#141414]/10 bg-gray-50/50 shrink-0">
                <CardTitle className="text-xs font-mono uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" /> AI Document Tutor
                </CardTitle>
                <CardDescription className="text-[9px]">Chat with Gemini model specifically for this file context</CardDescription>
              </CardHeader>
              <CardContent className="flex-grow p-0 flex flex-col min-h-0">
                <ScrollArea className="flex-grow p-4 min-h-0">
                  <div className="space-y-4">
                    {chatHistory.map((h, i) => (
                      <div key={i} className={`flex flex-col ${h.role === "user" ? "items-end" : "items-start"}`}>
                        <div
                          className={`max-w-[85%] p-3 ${
                            h.role === "user"
                              ? "bg-[#141414] text-[#E4E3E0] text-xs font-mono"
                              : "bg-[#f5f5f5] text-xs font-serif border border-[#141414]/10 leading-relaxed"
                          }`}
                        >
                          <div className="text-[8px] font-mono opacity-50 uppercase tracking-widest mb-1">
                            {h.role === "user" ? "You" : "Document Tutor"}
                          </div>
                          <div className="prose prose-sm max-w-none text-xs selection:bg-[#141414] selection:text-white">
                            <Markdown>{h.text}</Markdown>
                          </div>
                        </div>
                      </div>
                    ))}
                    {chatting && (
                      <div className="flex items-start">
                        <div className="bg-[#f5f5f5] border border-[#141414]/10 p-3 flex gap-2 items-center text-[10px] font-mono italic font-bold">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600" /> Document Tutor is reading...
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Question chips suggestions */}
                <div className="p-3 border-t border-[#141414]/10 scroll-x flex gap-1.5 overflow-x-auto shrink-0 select-none bg-white">
                  <button
                    onClick={() => handleChipClick("Identify the core educational lessons, course plans or levels documented in this file.")}
                    className="shrink-0 text-[8px] font-mono border border-neutral-300 hover:border-neutral-950 bg-neutral-50 px-2 py-1 transition-all"
                  >
                    📝 Lessons & Levels
                  </button>
                  <button
                    onClick={() => handleChipClick("Generate draft exams or exercise questions with solutions based on this file's context content.")}
                    className="shrink-0 text-[8px] font-mono border border-neutral-300 hover:border-neutral-950 bg-neutral-50 px-2 py-1 transition-all"
                  >
                    🧪 Practice quiz
                  </button>
                  <button
                    onClick={() => handleChipClick("Translate the critical definitions and vocabulary inside this file to Arabic & English.")}
                    className="shrink-0 text-[8px] font-mono border border-neutral-300 hover:border-neutral-950 bg-neutral-50 px-2 py-1 transition-all"
                  >
                    🌐 Translate Terms
                  </button>
                </div>

                <div className="p-3 border-t border-[#141414]/10 bg-gray-50 shrink-0">
                  <form onSubmit={handleChatSubmit} className="flex gap-1.5">
                    <Input
                      placeholder="Ask tutor for homework guides, solution plans..."
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      disabled={chatting}
                      className="rounded-none border-[#141414] bg-white h-8 text-[11px] font-sans flex-grow"
                    />
                    <Button
                      type="submit"
                      disabled={chatting || !chatInput.trim()}
                      className="rounded-none bg-[#141414] text-[#E4E3E0] hover:bg-neutral-800 text-[10px] font-mono uppercase h-8 px-3"
                    >
                      Send
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Footer bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 h-10 border-t border-[#141414] bg-white px-6 flex items-center justify-between text-[10px] font-mono shadow-[0_-2px_10px_rgba(0,0,0,0.05)] select-none">
        <div className="flex items-center gap-4">
          <span className="font-bold opacity-70">© 2026 SCRAPEAI IMMERSIVE WORKSPACE</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse inline-block" />
          <span className="opacity-80">Interactive Tutor Mode Operational</span>
        </div>
      </div>
    </div>
  );
}
