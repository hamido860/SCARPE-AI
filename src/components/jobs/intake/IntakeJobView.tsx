import React from "react";
import { 
  Search, Globe, ChevronRight, Loader2, ExternalLink, Sparkles, Wand2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { JobWorkspaceLayout } from "../../layout/JobWorkspaceLayout";
import { StagedPdf } from "../../../types/pdf";
import { generateCurriculumFilename } from "../../../utils/filenameGenerator";
import { ScrapedDataExporter } from "./ScrapedDataExporter";
import { toast } from "sonner";
import axios from "axios";

interface IntakeJobViewProps {
  stagedPdfs: StagedPdf[];
  // Config states & handlers
  crawlUrl: string;
  setCrawlUrl: (url: string) => void;
  discoverPastedUrls: string;
  setDiscoverPastedUrls: (urls: string) => void;
  maxPages: number;
  setMaxPages: (pages: number) => void;
  maxDepth: number;
  setMaxDepth: (depth: number) => void;
  topicFilter: string;
  setTopicFilter: (filter: string) => void;
  isCrawling: boolean;
  isDiscovering: boolean;
  handleCrawlPdfs: () => void;
  handleDiscoverPdfs: () => void;
  activeTab: "crawl" | "discover";
  setActiveTab: (tab: "crawl" | "discover") => void;

  // Crawled result states & handlers
  crawledPdfs: string[];
  selectedCrawled: string[];
  setSelectedCrawled: React.Dispatch<React.SetStateAction<string[]>>;
  handleStageSelectedCrawled: () => void;

  // Discovered result states & handlers
  discoveredResults: Array<{ url: string; isDirectPdf: boolean; accepted: boolean; reason: string; }>;
  selectedDiscovered: string[];
  setSelectedDiscovered: React.Dispatch<React.SetStateAction<string[]>>;
  handleIncorporateDiscovered: () => void;

  showAdvancedStaging: boolean;
  setShowAdvancedStaging: (val: boolean) => void;
  crawledPdfsCount: number;
  selectedPdfUrlsCount: number;
  stagedPdfsCount: number;
  classifiedCount: number;
  failedCount: number;
  siteMapNodes?: any[];
  onUpdateSiteMapNode?: (id: string, updates: any) => void;
  onClearSiteMap?: () => void;
  onAiClean?: () => void;
  isAiCleaning?: boolean;
  onStageUrlsWithMetadata?: (assets: Array<{ url: string; grade: string; subject: string; topic: string; docType: string }>) => void;
  hasDriveConnected?: boolean;
}

const getAssetTypeFromUrl = (url: string, isDirectPdf?: boolean): string => {
  const lowered = url.toLowerCase();
  if (isDirectPdf || lowered.split(/[?#]/)[0].endsWith(".pdf")) {
    return "PDF";
  }
  return "HTML Lesson";
};

const getFilenameFromUrl = (url: string): string => {
  try {
    const filename = url.split("/").pop() || url;
    return decodeURIComponent(filename).split(/[?#]/)[0] || "unnamed";
  } catch {
    return url;
  }
};

const getDomainFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
};

const getGradeFromUrl = (url: string): string => {
  const low = url.toLowerCase();
  try {
    const decoded = decodeURIComponent(url).toLowerCase();
    const l = decoded;
    if (l.includes("1ap") || l.includes("الاول-ابتدائي") || l.includes("الأول-ابتدائي") || l.includes("الاول ابتدائي")) return "1AEP";
    if (l.includes("2ap") || l.includes("الثاني-ابتدائي") || l.includes("الثانية-ابتدائي") || l.includes("الثاني ابتدائي")) return "2AEP";
    if (l.includes("3ap") || l.includes("الثالث-ابتدائي") || l.includes("الثالثة-ابتدائي") || l.includes("الثالث ابتدائي")) return "3AEP";
    if (l.includes("4ap") || l.includes("الرابع-ابتدائي") || l.includes("الرابعة-ابتدائي") || l.includes("الرابع ابتدائي")) return "4AEP";
    if (l.includes("5ap") || l.includes("الخامس-ابتدائي") || l.includes("الخامسة-ابتدائي") || l.includes("الخامس ابتدائي")) return "5AEP";
    if (l.includes("6ap") || l.includes("السادس-ابتدائي") || l.includes("السادسة-ابتدائي") || l.includes("السادس ابتدائي")) return "6AEP";
    
    if (l.includes("1ac") || l.includes("1ere_annee_college") || l.includes("1ere annee") || l.includes("الاولى-اعدادي") || l.includes("الاولى اعدادي")) return "1AC";
    if (l.includes("2ac") || l.includes("2eme_annee_college") || l.includes("2eme annee") || l.includes("الثانية-اعدادي") || l.includes("الثانية اعدادي")) return "2AC";
    if (l.includes("3ac") || l.includes("3eme_annee_college") || l.includes("3eme annee") || l.includes("الثالثة-اعدادي") || l.includes("الثالثة اعدادي")) return "3AC";
    if (l.includes("tcs") || l.includes("tronc") || l.includes("commun") || l.includes("جذع")) return "TC";
    if (l.includes("1bac") || l.includes("1ere_bac") || l.includes("الاولى-باك") || l.includes("اولى باك")) return "1BAC";
    if (l.includes("2bac") || l.includes("2eme_bac") || l.includes("الثانية-باك") || l.includes("ثانية باك") || l.includes("الثانية باك") || l.includes("البكالوريا")) return "2BAC";
  } catch (e) {}

  if (low.includes("1ac") || low.includes("1ere_annee_college") || low.includes("1ere annee")) return "1AC";
  if (low.includes("2ac") || low.includes("2eme_annee_college") || low.includes("2eme annee")) return "2AC";
  if (low.includes("3ac") || low.includes("3eme_annee_college") || low.includes("3eme annee")) return "3AC";
  if (low.includes("tcs") || low.includes("tronc") || low.includes("commun")) return "TC";
  if (low.includes("1bac") || low.includes("1ere_bac")) return "1BAC";
  if (low.includes("2bac") || low.includes("2eme_bac")) return "2BAC";
  
  return "-";
};

const getSubjectFromUrl = (url: string): string => {
  const low = url.toLowerCase();
  
  try {
    const decoded = decodeURIComponent(url).toLowerCase();
    const l = decoded;
    if (l.includes("math") || l.includes("mathematiques") || l.includes("رياضيات")) return "Maths";
    if (l.includes("physique") || l.includes("chimie") || l.includes("pc_") || l.includes("_pc") || l.includes(" pc ") || l.includes("فيزياء") || l.includes("كيمياء")) return "PC";
    if (l.includes("svt") || l.includes("علوم") || l.includes("الحياة") || l.includes("الارض")) return "SVT";
    if (l.includes("francais") || l.includes("français") || l.includes("french") || l.includes("فرنسي")) return "French";
    if (l.includes("arab") || l.includes("عربي")) return "Arabic";
    if (l.includes("islam") || l.includes("إسلامي") || l.includes("اسلامي") || l.includes("التربية")) return "Islamic";
    if (l.includes("philo") || l.includes("فلسف")) return "Philosophy";
    if (l.includes("hg") || l.includes("hist") || l.includes("geo") || l.includes("اجتماعيات") || l.includes("تاريخ") || l.includes("جغرافيا")) return "HG";
    if (l.includes("anglais") || l.includes("english") || l.includes("انجليزي")) return "English";
  } catch (e) {}

  if (low.includes("math") || low.includes("mathematiques")) return "Maths";
  if (low.includes("physique") || low.includes("chimie") || low.includes("pc_") || low.includes("_pc") || low.includes(" pc ")) return "PC";
  if (low.includes("svt")) return "SVT";
  if (low.includes("francais") || low.includes("français") || low.includes("french")) return "French";
  return "-";
};

const getTopicFromUrl = (url: string): string => {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const ignored = ["college", "1ac", "2ac", "3ac", "math", "pc", "svt", "french", "cours", "exercices"];
    const candidate = segments.find(seg => !ignored.includes(seg.toLowerCase()));
    if (candidate) return decodeURIComponent(candidate).replace(/[-_]/g, " ");
  } catch {}
  return "General";
};

export function IntakeJobView({
  stagedPdfs,
  crawlUrl,
  setCrawlUrl,
  discoverPastedUrls,
  setDiscoverPastedUrls,
  maxPages,
  setMaxPages,
  maxDepth,
  setMaxDepth,
  topicFilter,
  setTopicFilter,
  isCrawling,
  isDiscovering,
  handleCrawlPdfs,
  handleDiscoverPdfs,
  activeTab,
  setActiveTab,
  crawledPdfs,
  selectedCrawled,
  setSelectedCrawled,
  handleStageSelectedCrawled,
  discoveredResults,
  selectedDiscovered,
  setSelectedDiscovered,
  handleIncorporateDiscovered,
  showAdvancedStaging,
  setShowAdvancedStaging,
  crawledPdfsCount,
  selectedPdfUrlsCount,
  stagedPdfsCount,
  classifiedCount,
  failedCount,
  siteMapNodes = [],
  onUpdateSiteMapNode,
  onClearSiteMap,
  onAiClean,
  isAiCleaning,
  onStageUrlsWithMetadata,
  hasDriveConnected
}: IntakeJobViewProps) {

  const [siteMapSubTab, setSiteMapSubTab] = React.useState<"website_map" | "final_assets" | "staged_assets">("website_map");
  const [selectedSiteMapUrls, setSelectedSiteMapUrls] = React.useState<string[]>([]);
  const [selectedStagedUrls, setSelectedStagedUrls] = React.useState<string[]>([]);

  const stagedPdfAssets = siteMapNodes.filter((n: any) => 
    n.page_role === "pdf_asset" && 
    n.action === "stage_asset" && 
    n.status === "completed" && 
    !n.rejection_reason
  ).map((n: any) => {
    let finalGrade = n.extracted_grade;
    const computedUrlGrade = getGradeFromUrl(n.url || n.canonical_url || "");
    if (computedUrlGrade !== "-" && finalGrade !== computedUrlGrade) {
       finalGrade = computedUrlGrade;
    }

    return {
      ...n,
      extracted_grade: finalGrade,
      drive_status: n.drive_status || "not_uploaded",
      download_status: n.download_status || "not_downloaded",
      verification_status: n.verification_status || "unverified",
      selected: false,
      validation_errors: n.validation_errors || []
    };
  });

  const [isSavingToDrive, setIsSavingToDrive] = React.useState(false);

  const handleBulkSaveToDrive = async (urlsToSave: string[]) => {
    if (urlsToSave.length === 0) {
      toast.error("Please select at least one Link to save to Google Drive.");
      return;
    }

    const { getCachedToken, googleSignIn } = await import("../../../services/googleDriveService");
    let token = getCachedToken();
    if (!token) {
      toast.info("Connecting to Google Drive...");
      try {
        const result = await googleSignIn();
        token = result?.accessToken || null;
      } catch (err) {
        toast.error("Google Drive connection failed. Cannot start upload.");
        return;
      }
    }
    
    if (!token) {
      toast.error("Please connect your Google Drive account first.");
      return;
    }

    setIsSavingToDrive(true);
    let success = 0, failed = 0;
    
    const stats: Record<string, number> = {
      missing_google_token: 0,
      source_url_missing: 0,
      source_fetch_failed: 0,
      source_not_pdf: 0,
      placeholder_html_rejected: 0,
      pdf_too_large: 0,
      drive_upload_failed: 0,
      supabase_log_failed: 0
    };
    const first10Errors: string[] = [];
    
    toast.info(`Saving ${urlsToSave.length} files to Google Drive (this may take a few minutes)...`);
    
    // Test the first upload to ensure the pipeline isn't completely broken
    if (urlsToSave.length > 0) {
      try {
        const testUrl = urlsToSave[0];
        const testRes = await axios.post("/api/collector/collect", {
          url: testUrl, accessToken: token
        });
        
        if (!testRes.data.ok && testRes.data.stage === "missing_google_token") {
          setIsSavingToDrive(false);
          toast.error("Google Drive token invalid. Please reconnect.");
          return;
        }
        if (!testRes.data.ok && testRes.data.stage === "drive_upload_failed") {
          setIsSavingToDrive(false);
          const errm = testRes.data.googleError || testRes.data.error;
          toast.error(`Drive Upload Failed Globally: ${errm}`);
          return;
        }
      } catch (e) {
        // Will be caught in normal loop anyway, ignoring for now unless it's a fatal network error
      }
    }

    const batchSize = 5;
    for (let i = 0; i < urlsToSave.length; i += batchSize) {
      const batch = urlsToSave.slice(i, i + batchSize);
      await Promise.all(batch.map(async (url) => {
        try {
          const res = await axios.post("/api/collector/collect", {
            url, accessToken: token
          });
          
          if (res.data.ok) {
            success++;
            if (res.data.supabaseLogFailed) {
              stats.supabase_log_failed++;
            }
            if (onUpdateSiteMapNode && siteMapNodes) {
               const node = siteMapNodes.find((n: any) => n.canonical_url === url);
               if (node) {
                   onUpdateSiteMapNode(node.id, { drive_status: "uploaded" });
               }
            }
          } else {
            failed++;
            const stage = res.data.stage || "unknown_error";
            stats[stage] = (stats[stage] || 0) + 1;
            
            const errMsg = `[${stage}] ${url}: ${res.data.error || "No error details"}`;
            if (first10Errors.length < 10) first10Errors.push(errMsg);
            console.error(`Save to Drive Failed for ${url}:`, res.data);
          }
        } catch (err: any) {
          failed++;
          stats.drive_upload_failed = (stats.drive_upload_failed || 0) + 1;
          const errMsg = `[Network Exception] ${url}: ${err.message}`;
          if (first10Errors.length < 10) first10Errors.push(errMsg);
          console.error(`Save to Drive Exception for ${url}:`, err.message);
        }
      }));
    }
    
    setIsSavingToDrive(false);
    
    if (failed > 0) {
       console.log("Drive Sync Summary:", { 
         total: urlsToSave.length, 
         saved: success, 
         failed, 
         byStage: stats, 
         first10Errors 
       });
       toast.warning(`Drive Save: ${success} saved, ${failed} failed. See console for details. (e.g. ${failed} failed on ${Object.keys(stats).filter(k => stats[k]>0).join(", ")})`);
    } else {
       toast.success(`Google Drive Save Completed: All ${success} files saved successfully.`);
    }
  };



  const getComputedItemStatus = (url: string, res?: any) => {
    const staged = stagedPdfs?.find(s => s.url === url);
    
    // Check if explicit duplicate/download status in staged or res
    const checkStatus = staged?.status || res?.status || "";
    const lowerCheckStatus = checkStatus.toLowerCase();
    
    if (lowerCheckStatus === "exact_duplicate") return "exact_duplicate";
    if (lowerCheckStatus === "content_duplicate") return "content_duplicate";
    if (lowerCheckStatus === "same_ref_only") return "same_ref_only";
    if (lowerCheckStatus === "invalid_download") return "invalid_download";
    if (lowerCheckStatus === "placeholder_download") return "placeholder_download";
    if (lowerCheckStatus === "staged") return "staged";
    if (lowerCheckStatus === "pending_staged") return "pending_staged";
    
    // Check blockReason or status inside staged
    if (staged) {
      const blockReason = (staged.blockReason || "").toLowerCase();
      if (blockReason === "download_failed" || staged.status === "failed") return "invalid_download";
      if (blockReason === "placeholder_download") return "placeholder_download";
      if (blockReason === "exact_duplicate" || blockReason === "duplicate item hash skipped") return "exact_duplicate";
      if (blockReason === "content_duplicate" || blockReason === "duplicate content text skipped") return "content_duplicate";
      if (blockReason === "same_ref_only") return "same_ref_only";
      
      const rawFileHash = staged.raw_file_hash || staged.hash;
      const textContentHash = staged.text_content_hash;
      
      // Rule 8: same ref URL is not treated as duplicate unless hashes match
      if (rawFileHash) {
        const hasRawMatch = stagedPdfs?.some(s => s.url !== url && (s.raw_file_hash === rawFileHash || s.hash === rawFileHash));
        if (hasRawMatch) return "exact_duplicate";
      }
      if (textContentHash) {
        const hasTextMatch = stagedPdfs?.some(s => s.url !== url && s.text_content_hash === textContentHash);
        if (hasTextMatch) return "content_duplicate";
      }
      
      // If it exists in stagedPdfs but none of the duplicates/failures matched, it's staged
      if (staged.status === "classified" || staged.status === "classifying") {
        return "staged";
      }
      return "pending_staged";
    }
    
    if (res && !res.accepted) {
      return "Rejected";
    }
    
    return "pending";
  };

  const [fileExtensionFilter, setFileExtensionFilter] = React.useState<string>("all");
  const [customExtension, setCustomExtension] = React.useState<string>("");

  const [roleFilter, setRoleFilter] = React.useState<string>("all");
  const [actionFilter, setActionFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [navigationPathFilter, setNavigationPathFilter] = React.useState<string>("");
  
  type SortField = 'canonical_url' | 'navigation_path' | 'page_role' | 'action' | 'links' | 'metadata' | 'confidence' | 'status' | 'none';
  const [sortField, setSortField] = React.useState<SortField>('none');
  const [sortAsc, setSortAsc] = React.useState<boolean>(true);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortAsc) {
        setSortAsc(false);
      } else {
        setSortField('none');
        setSortAsc(true);
      }
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const tableItems = activeTab === "crawl" 
    ? crawledPdfs.map(url => ({
        url,
        title: getFilenameFromUrl(url),
        assetType: getAssetTypeFromUrl(url),
        domain: getDomainFromUrl(url),
        grade: getGradeFromUrl(url),
        subject: getSubjectFromUrl(url),
        topic: getTopicFromUrl(url),
        status: getComputedItemStatus(url),
        accepted: true,
        reason: "Discovered during web crawl"
      }))
    : discoveredResults.map(res => ({
        url: res.url,
        title: getFilenameFromUrl(res.url),
        assetType: getAssetTypeFromUrl(res.url, res.isDirectPdf),
        domain: getDomainFromUrl(res.url),
        grade: getGradeFromUrl(res.url),
        subject: getSubjectFromUrl(res.url),
        topic: getTopicFromUrl(res.url),
        status: getComputedItemStatus(res.url, res),
        accepted: res.accepted,
        reason: res.reason
      }));

  const filteredTableItems = tableItems.filter(item => {
    if (fileExtensionFilter === "all") return true;
    const cleanUrl = item.url.toLowerCase().split(/[?#]/)[0];
    
    if (fileExtensionFilter === "pdf") {
      return cleanUrl.endsWith(".pdf");
    }
    if (fileExtensionFilter === "html") {
      const nonHtmlExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".css", ".js", ".zip", ".rar", ".mp3", ".mp4", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];
      const hasNonHtmlExt = nonHtmlExtensions.some(suffix => cleanUrl.endsWith(suffix));
      return !hasNonHtmlExt;
    }
    if (fileExtensionFilter === "word") {
      return cleanUrl.endsWith(".docx") || cleanUrl.endsWith(".doc");
    }
    if (fileExtensionFilter === "ppt") {
      return cleanUrl.endsWith(".pptx") || cleanUrl.endsWith(".ppt");
    }
    if (fileExtensionFilter === "custom") {
      if (!customExtension.trim()) return true;
      const targetExt = customExtension.trim().toLowerCase();
      const dotExt = targetExt.startsWith(".") ? targetExt : `.${targetExt}`;
      return cleanUrl.endsWith(dotExt);
    }
    return true;
  });

  const filteredSiteMapNodes = siteMapNodes.filter(node => {
    if (roleFilter !== "all" && node.page_role !== roleFilter) return false;
    if (actionFilter !== "all" && node.action !== actionFilter) return false;
    if (statusFilter !== "all" && node.status !== statusFilter) return false;
    if (navigationPathFilter && !node.navigation_path?.toLowerCase().includes(navigationPathFilter.toLowerCase())) return false;

    if (fileExtensionFilter === "all") return true;
    const cleanUrl = node.canonical_url.toLowerCase().split(/[?#]/)[0];
    
    if (fileExtensionFilter === "pdf") {
      return cleanUrl.endsWith(".pdf");
    }
    if (fileExtensionFilter === "html") {
      const nonHtmlExtensions = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".css", ".js", ".zip", ".rar", ".mp3", ".mp4", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"];
      const hasNonHtmlExt = nonHtmlExtensions.some(suffix => cleanUrl.endsWith(suffix));
      return !hasNonHtmlExt;
    }
    if (fileExtensionFilter === "word") {
      return cleanUrl.endsWith(".docx") || cleanUrl.endsWith(".doc");
    }
    if (fileExtensionFilter === "ppt") {
      return cleanUrl.endsWith(".pptx") || cleanUrl.endsWith(".ppt");
    }
    if (fileExtensionFilter === "custom") {
      if (!customExtension.trim()) return true;
      const targetExt = customExtension.trim().toLowerCase();
      const dotExt = targetExt.startsWith(".") ? targetExt : `.${targetExt}`;
      return cleanUrl.endsWith(dotExt);
    }
    return true;
  });

  const sortedAndFilteredSiteMapNodes = [...filteredSiteMapNodes].sort((a, b) => {
    if (sortField === 'none') return 0;
    let aVal: any = '';
    let bVal: any = '';
    
    switch (sortField) {
      case 'canonical_url':
        aVal = a.canonical_url || '';
        bVal = b.canonical_url || '';
        break;
      case 'navigation_path':
        aVal = (a.navigation_path || '').replace(/ > /g, '');
        bVal = (b.navigation_path || '').replace(/ > /g, '');
        break;
      case 'page_role':
        aVal = a.page_role || '';
        bVal = b.page_role || '';
        break;
      case 'action':
        aVal = a.action || '';
        bVal = b.action || '';
        break;
      case 'links':
        aVal = a.discovered_links_count || 0;
        bVal = b.discovered_links_count || 0;
        break;
      case 'metadata':
        aVal = `${a.extracted_grade || ''} ${a.extracted_subject || ''} ${a.extracted_document_type || ''} ${a.extracted_topic || ''}`.trim();
        bVal = `${b.extracted_grade || ''} ${b.extracted_subject || ''} ${b.extracted_document_type || ''} ${b.extracted_topic || ''}`.trim();
        break;
      case 'confidence':
        aVal = a.confidence || 0;
        bVal = b.confidence || 0;
        break;
      case 'status':
        aVal = a.status || '';
        bVal = b.status || '';
        break;
    }
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });


  const pdfCount = tableItems.filter(item => item.accepted && item.assetType === "PDF").length;
  const htmlCount = tableItems.filter(item => item.accepted && item.assetType === "HTML Lesson").length;
  const rejectedCount = tableItems.filter(item => !item.accepted).length;

  const stagedCount = tableItems.filter(item => item.status === "staged" || item.status === "pending_staged").length;
  const duplicateCount = tableItems.filter(item => {
    const isSelected = activeTab === "crawl" 
      ? selectedCrawled.includes(item.url)
      : selectedDiscovered.includes(item.url);
    const isPendingOrStaged = item.status === "pending" || item.status === "staged" || item.status === "pending_staged";
    
    if (isSelected || isPendingOrStaged) {
      return false;
    }
    return item.status === "exact_duplicate" || item.status === "content_duplicate";
  }).length;

  const sidebarContent = (
    <div className="p-4 flex flex-col h-full space-y-6">
      <div>
        <h2 className="font-mono text-sm font-bold text-neutral-900 uppercase">Intake Job</h2>
        <p className="text-[10px] text-neutral-500 mt-1 leading-snug">
          Discover and crawl PDFs from educational web sources. Fetches links into the staging area.
        </p>
      </div>

      <div className="space-y-4">
        {/* Method Switch */}
        <div className="grid grid-cols-2 gap-1 bg-neutral-100 p-1">
          <button
            type="button"
            onClick={() => setActiveTab("crawl")}
            className={`text-[10px] uppercase py-1.5 text-center font-bold ${
              activeTab === "crawl" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
            }`}
          >
            Crawler
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("discover")}
            className={`text-[10px] uppercase py-1.5 text-center font-bold ${
              activeTab === "discover" ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
            }`}
          >
            Paste URLs
          </button>
        </div>

        {activeTab === "crawl" ? (
          <>
            <div className="space-y-1">
              <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Start URL</label>
              <Input 
                id="intake-crawl-url"
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
                  id="intake-max-depth"
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
                  id="intake-max-pages"
                  type="number" 
                  value={maxPages} 
                  onChange={e => setMaxPages(Number(e.target.value))}
                  className="rounded-none border-[#141414] h-8 text-[11px]" 
                  min="1"
                />
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-1 flex flex-col h-32">
            <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Paste Links (One per line)</label>
            <textarea
              id="intake-pasted-urls"
              value={discoverPastedUrls}
              onChange={e => setDiscoverPastedUrls(e.target.value)}
              className="w-full React-textarea flex-1 border border-[#141414] p-2 text-[10px] font-mono bg-white resize-none"
              placeholder="https://..."
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">Topic Filters (csv)</label>
          <Input 
            id="intake-topic-filter"
            value={topicFilter}
            onChange={e => setTopicFilter(e.target.value)}
            placeholder="e.g. math, 1ac"
            className="rounded-none border-[#141414] text-[11px] h-8 bg-white"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase opacity-60 font-bold block">File Extension Filter</label>
          <select 
            id="intake-file-ext-filter"
            value={fileExtensionFilter}
            onChange={e => setFileExtensionFilter(e.target.value)}
            className="w-full border border-[#141414] h-8 text-xs font-mono px-2 rounded-none bg-white font-bold"
          >
            <option value="all">ALL EXTENSIONS</option>
            <option value="pdf">PDF (.pdf)</option>
            <option value="html">HTML Lessons / Webpages</option>
            <option value="word">Word (.docx, .doc)</option>
            <option value="ppt">PowerPoint (.pptx, .ppt)</option>
            <option value="custom">CUSTOM...</option>
          </select>
          {fileExtensionFilter === "custom" && (
            <Input 
              id="intake-custom-file-ext"
              value={customExtension}
              onChange={e => setCustomExtension(e.target.value)}
              placeholder="e.g. xlsx, zip"
              className="rounded-none border-[#141414] text-[11px] h-8 bg-white mt-1.5 font-mono uppercase"
            />
          )}
        </div>

        <div className="pt-3 border-t border-dashed border-neutral-200">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input 
              type="checkbox"
              id="intake-advanced-toggle"
              checked={showAdvancedStaging}
              onChange={(e) => setShowAdvancedStaging(e.target.checked)}
              className="rounded-none border-[#141414] text-[#141414] focus:ring-[#141414] w-3 h-3"
            />
            <span className="font-mono text-[9px] uppercase font-bold text-neutral-600">Advanced Manual Staging</span>
          </label>
        </div>
      </div>

      <div className="mt-auto pt-6 border-t border-neutral-200">
        <Button 
          id="intake-scan-btn"
          onClick={activeTab === "crawl" ? handleCrawlPdfs : handleDiscoverPdfs}
          disabled={isCrawling || isDiscovering}
          className="w-full bg-[#141414] hover:bg-[#141414]/90 text-white rounded-none text-xs font-mono uppercase h-10 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
        >
          {(isCrawling || isDiscovering) ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Scanning...
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              Scan Source
            </>
          )}
        </Button>
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex flex-col h-full bg-neutral-100/30 overflow-hidden">
      {/* Top action bar */}
      <div className="p-4 border-b border-neutral-200 bg-white flex justify-between items-center shrink-0">
        <div className="flex items-center gap-6">
          <div>
            <h3 className="font-bold text-neutral-800 flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#141414]"/> URL Source Extraction
            </h3>
            <p className="text-[11px] text-neutral-500">Discoveries map to the local staging engine.</p>
          </div>
          
          <div className="w-px h-8 bg-neutral-200 hidden md:block" />

          {/* Core Counters Moved From Top Bar */}
          <div className="hidden md:flex items-center gap-4 text-[10px] font-mono font-bold uppercase text-neutral-500">
            <div className="flex flex-col">
              <span className="mb-0.5">Found:</span>
              <span className="text-blue-600 text-[11px]">{crawledPdfsCount}</span>
            </div>
            <div className="w-px h-6 bg-neutral-200" />
            <div className="flex flex-col">
              <span className="mb-0.5">Selected:</span>
              <span className="text-purple-600 text-[11px]">{selectedPdfUrlsCount}</span>
            </div>
            <div className="w-px h-6 bg-neutral-200" />
            <div className="flex flex-col">
              <span className="mb-0.5">Queued:</span>
              <span className="text-amber-600 text-[11px]">{stagedPdfsCount}</span>
            </div>
            <div className="w-px h-6 bg-neutral-200" />
            <div className="flex flex-col">
              <span className="mb-0.5">Done:</span>
              <span className="text-green-600 text-[11px]">{classifiedCount}</span>
            </div>
            <div className="w-px h-6 bg-neutral-200" />
            <div className="flex flex-col">
              <span className="mb-0.5">Failed:</span>
              <span className="text-red-600 text-[11px]">{failedCount}</span>
            </div>
          </div>
        </div>

        {showAdvancedStaging && activeTab === "crawl" && crawledPdfs.length > 0 && (
          <div className="flex gap-2">
            <Button 
              id="intake-stage-crawled-btn"
              onClick={handleStageSelectedCrawled} 
              className="bg-[#141414] hover:bg-neutral-800 text-white rounded-none font-mono text-[10px] uppercase h-8"
            >
              Stage {selectedCrawled.length} to Workspace
            </Button>
            {selectedCrawled.length > 0 && (
              <Button 
                variant="outline"
                onClick={() => handleBulkSaveToDrive(selectedCrawled)} 
                disabled={isSavingToDrive}
                className="h-8 rounded-none font-mono text-[10px] uppercase border-[#141414] text-[#141414]"
              >
                {isSavingToDrive ? "Saving..." : `Add ${selectedCrawled.length} to Drive`}
              </Button>
            )}
          </div>
        )}
        {showAdvancedStaging && activeTab === "discover" && discoveredResults.length > 0 && (
          <div className="flex gap-2">
            <Button 
              id="intake-stage-discovered-btn"
              onClick={handleIncorporateDiscovered} 
              className="bg-[#141414] hover:bg-neutral-800 text-white rounded-none font-mono text-[10px] uppercase h-8"
            >
              Stage {selectedDiscovered.length} Approved Links
            </Button>
            {selectedDiscovered.length > 0 && (
              <Button 
                variant="outline"
                onClick={() => handleBulkSaveToDrive(selectedDiscovered)} 
                disabled={isSavingToDrive}
                className="h-8 rounded-none font-mono text-[10px] uppercase border-[#141414] text-[#141414]"
              >
                {isSavingToDrive ? "Saving..." : `Add ${selectedDiscovered.length} to Drive`}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Dynamic Summary Cards */}
        {tableItems.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="bg-white border border-neutral-200 p-4 rounded-none shadow-xs">
              <span className="font-mono text-[10px] uppercase text-neutral-400 font-bold block">PDF Assets</span>
              <span className="text-2xl font-black text-neutral-900 mt-1 block">{pdfCount}</span>
            </div>
            <div className="bg-white border border-neutral-200 p-4 rounded-none shadow-xs">
              <span className="font-mono text-[10px] uppercase text-neutral-400 font-bold block text-emerald-600">HTML Lessons</span>
              <span className="text-2xl font-black text-emerald-600 mt-1 block">{htmlCount}</span>
            </div>
            <div className="bg-white border border-neutral-200 p-4 rounded-none shadow-xs">
              <span className="font-mono text-[10px] uppercase text-neutral-400 font-bold block text-neutral-500">Rejected Files</span>
              <span className="text-2xl font-black text-neutral-700 mt-1 block">{rejectedCount}</span>
            </div>
            <div className="bg-white border border-neutral-200 p-4 rounded-none shadow-xs">
              <span className="font-mono text-[10px] uppercase text-neutral-400 font-bold block text-amber-600">Staged</span>
              <span className="text-2xl font-black text-amber-600 mt-1 block">{stagedCount}</span>
            </div>
            <div className="bg-white border border-neutral-200 p-4 rounded-none shadow-xs">
              <span className="font-mono text-[10px] uppercase text-neutral-400 font-bold block text-red-600">Duplicates</span>
              <span className="text-2xl font-black text-red-600 mt-1 block">{duplicateCount}</span>
            </div>
          </div>
        )}

        {/* Global info callout banner */}
        {!showAdvancedStaging && (crawledPdfs.length > 0 || discoveredResults.length > 0) && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 font-mono text-[10px] leading-relaxed">
            <div className="font-bold mb-1 font-sans text-xs flex items-center gap-1.5 text-emerald-950">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              AUTOMATION ACTIVE: ZERO-TOUCH ASSET STAGING
            </div>
            All discovered educational PDFs and HTML lesson URLs are automatically validated, assigned initial pending states, auto-staged into the workspace, and auto-selected for processing. Switch to <span className="underline font-bold">Advanced Manual Staging</span> in the sidebar to manually select/deselect individual documents.
          </div>
        )}

        {/* Unified Assets Found Table container */}
        {activeTab === "crawl" ? (
          <div className="space-y-4">
            {/* Sub-Tabs Nav */}
            <div className="flex border-b border-neutral-200 bg-white p-1 select-none shrink-0 gap-1 shadow-xs">
              <button
                id="sitemapping-tab-webmap"
                type="button"
                onClick={() => setSiteMapSubTab("website_map")}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold transition-all flex items-center gap-1.5 ${
                  siteMapSubTab === "website_map"
                    ? "bg-neutral-900 text-white rounded-none"
                    : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50"
                }`}
              >
                Website Map ({filteredSiteMapNodes.length === siteMapNodes.length ? `${siteMapNodes.length} nodes` : `${filteredSiteMapNodes.length}/${siteMapNodes.length} filtered`})
              </button>
              <button
                id="sitemapping-tab-assets"
                type="button"
                onClick={() => setSiteMapSubTab("final_assets")}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold transition-all flex items-center gap-1.5 ${
                  siteMapSubTab === "final_assets"
                    ? "bg-neutral-900 text-white rounded-none"
                    : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50"
                }`}
              >
                Final Assets ({filteredSiteMapNodes.length === siteMapNodes.length ? `${siteMapNodes.filter((n: any) => n.is_final_asset).length} ready` : `${filteredSiteMapNodes.filter((n: any) => n.is_final_asset).length}/${siteMapNodes.filter((n: any) => n.is_final_asset).length} filtered`})
              </button>
              <button
                id="sitemapping-tab-staged"
                type="button"
                onClick={() => setSiteMapSubTab("staged_assets")}
                className={`px-4 py-2 text-xs font-mono uppercase font-bold transition-all flex items-center gap-1.5 ${
                  siteMapSubTab === "staged_assets"
                    ? "bg-neutral-900 text-white rounded-none"
                    : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50"
                }`}
              >
                Staged PDF Assets ({stagedPdfAssets.length})
              </button>
              
              {siteMapNodes.length > 0 && onAiClean && (
                <button
                  type="button"
                  onClick={onAiClean}
                  disabled={isAiCleaning}
                  className="ml-auto px-3 py-1.5 text-[9px] font-mono uppercase bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-none border border-indigo-200 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  <Wand2 className="w-3 h-3" />
                  {isAiCleaning ? "Cleaning..." : "AI Clean Search Results"}
                </button>
              )}
              {siteMapNodes.length > 0 && onClearSiteMap && (
                <button
                  type="button"
                  onClick={onClearSiteMap}
                  className="ml-2 px-3 py-1.5 text-[9px] font-mono uppercase text-red-600 hover:bg-red-50 rounded-none border border-red-200 transition-colors"
                >
                  Clear Results
                </button>
              )}
            </div>

            {siteMapNodes.length > 0 && (
              <ScrapedDataExporter data={siteMapNodes} />
            )}

            {siteMapNodes.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-center text-neutral-400 border border-dashed border-neutral-200 bg-white shadow-xs">
                <Globe className="w-10 h-10 mb-2 opacity-30 animate-pulse text-indigo-500" />
                <p className="text-xs uppercase font-mono tracking-wider font-bold text-neutral-800">Site Map Empty</p>
                <p className="text-[10px] mt-1 max-w-xs">Enter a start URL (e.g. Moutamadris or Talamidi cours index) in the sidebar and scan to map website navigation path.</p>
              </div>
            ) : siteMapSubTab === "website_map" ? (
              <div className="border border-neutral-200 bg-white overflow-x-auto shadow-sm">
                <div className="flex gap-2 p-2 bg-neutral-50 border-b border-neutral-200">
                  <input 
                    type="text"
                    placeholder="Filter by Navigation Path..."
                    value={navigationPathFilter}
                    onChange={e => setNavigationPathFilter(e.target.value)}
                    className="border border-neutral-300 text-[10px] font-mono px-2 py-1 bg-white min-w-[200px]"
                  />
                  <select 
                    value={roleFilter} 
                    onChange={e => setRoleFilter(e.target.value)} 
                    className="border border-neutral-300 text-[10px] font-mono px-2 py-1 bg-white"
                  >
                    <option value="all">ALL ROLES</option>
                    {Array.from(new Set(siteMapNodes.map(n => n.page_role).filter(Boolean))).map(role => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                  <select 
                    value={actionFilter} 
                    onChange={e => setActionFilter(e.target.value)} 
                    className="border border-neutral-300 text-[10px] font-mono px-2 py-1 bg-white"
                  >
                    <option value="all">ALL ACTIONS</option>
                    {Array.from(new Set(siteMapNodes.map(n => n.action).filter(Boolean))).map(action => (
                      <option key={action} value={action}>{action}</option>
                    ))}
                  </select>
                  <select 
                    value={statusFilter} 
                    onChange={e => setStatusFilter(e.target.value)} 
                    className="border border-neutral-300 text-[10px] font-mono px-2 py-1 bg-white"
                  >
                    <option value="all">ALL STATUSES</option>
                    {Array.from(new Set(siteMapNodes.map(n => n.status).filter(Boolean))).map(status => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200 text-[9px] font-mono uppercase text-neutral-500">
                      <th className="p-3 font-bold cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('canonical_url')}>Source ID & Canonical URL {sortField === 'canonical_url' && (sortAsc ? '↑' : '↓')}</th>
                      <th className="p-3 font-bold cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('navigation_path')}>Navigation Path / Breadcrumb {sortField === 'navigation_path' && (sortAsc ? '↑' : '↓')}</th>
                      <th className="p-3 font-bold cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('page_role')}>Role {sortField === 'page_role' && (sortAsc ? '↑' : '↓')}</th>
                      <th className="p-3 font-bold cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('action')}>Action {sortField === 'action' && (sortAsc ? '↑' : '↓')}</th>
                      <th className="p-3 font-bold text-center cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('links')}>Links {sortField === 'links' && (sortAsc ? '↑' : '↓')}</th>
                      <th className="p-3 font-bold cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('metadata')}>Deducted Metadata {sortField === 'metadata' && (sortAsc ? '↑' : '↓')}</th>
                      <th className="p-3 font-bold text-center cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('confidence')}>Confidence {sortField === 'confidence' && (sortAsc ? '↑' : '↓')}</th>
                      <th className="p-3 font-bold cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('status')}>Crawl Status {sortField === 'status' && (sortAsc ? '↑' : '↓')}</th>
                      <th className="p-3 font-bold w-12 text-center">Open</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-[11px]">
                    {sortedAndFilteredSiteMapNodes.map((node, idx) => {
                      const isHub = node.page_role === "hub_page";
                      return (
                        <tr key={node.id || idx} className="hover:bg-neutral-50/50 transition-colors">
                          <td className="p-3 font-medium text-neutral-800">
                            <div className="font-mono text-[9px] text-neutral-400 font-bold">#{node.id}</div>
                            <div className="font-mono text-[10px] text-neutral-600 truncate max-w-[200px] break-all select-all block mt-0.5" title={node.canonical_url}>
                              {node.canonical_url}
                            </div>
                          </td>
                          <td className="p-3 text-neutral-800 font-bold font-sans">
                            {node.navigation_path || "-"}
                          </td>
                          <td className="p-3">
                            <Badge className={`rounded-none text-[8px] font-mono py-0.5 px-1.5 shadow-none uppercase ${
                              node.page_role === "hub_page" ? "bg-purple-100/70 text-purple-800 border-purple-250 font-bold" :
                              node.page_role === "category_page" ? "bg-amber-100 text-amber-800 border-amber-250" :
                              node.page_role === "lesson_detail_page" ? "bg-emerald-100 text-emerald-800 border-emerald-250 font-semibold" : 
                              node.page_role === "pdf_asset" ? "bg-blue-100 text-blue-800 border-blue-250 font-semibold" : "bg-neutral-100 text-neutral-600 border border-neutral-200"
                            }`}>
                              {node.page_role}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <code className="text-[10px] bg-neutral-100 px-1 py-0.5 border border-neutral-200 text-neutral-750 font-mono">
                              {node.action}
                            </code>
                          </td>
                          <td className="p-3 font-mono text-center font-bold text-neutral-800 text-xs">
                            {isHub || node.action === "crawl_children" ? (
                              <span className="text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 font-bold">
                                {node.discovered_links_count || 0} links
                              </span>
                            ) : (
                              <span className="text-neutral-400 font-normal">
                                {node.discovered_links_count || 0}
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col gap-0.5 text-[9px] font-mono text-neutral-500">
                              <div>Grade: <span className="font-bold text-neutral-800">{node.extracted_grade}</span></div>
                              <div>Subject: <span className="font-bold text-neutral-800">{node.extracted_subject}</span></div>
                              <div>Type: <span className="font-bold text-neutral-800">{node.extracted_document_type}</span></div>
                              <div className="truncate max-w-[120px]">Topic: <span className="font-bold text-neutral-800">{node.extracted_topic}</span></div>
                            </div>
                          </td>
                          <td className="p-3 font-mono text-center">
                            <span className={`font-bold text-[10px] ${
                              node.confidence >= 0.9 ? "text-emerald-600" :
                              node.confidence >= 0.75 ? "text-blue-600" : "text-amber-600"
                            }`}>
                              {Math.round((node.confidence || 0) * 100)}%
                            </span>
                          </td>
                          <td className="p-3 font-mono text-[10px]">
                            <Badge className={`rounded-none text-[8px] font-mono py-0 px-1.5 shadow-none uppercase ${
                              node.status === "completed" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" :
                              node.status === "failed" ? "bg-red-50 text-red-800 border border-red-200" : "bg-neutral-50 text-neutral-600 border border-neutral-200"
                            }`}>
                              {node.status}
                            </Badge>
                            {node.rejection_reason && (
                              <div className="text-[8px] text-red-500 mt-1 max-w-[150px] whitespace-normal" title={node.rejection_reason}>
                                {node.rejection_reason}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <a href={node.canonical_url} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-neutral-900 inline-block align-middle">
                              <ExternalLink className="w-3.5 h-3.5"/>
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : siteMapSubTab === "final_assets" ? (
              <div className="space-y-4">
                {/* Advanced site mapping controller */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-neutral-200 p-4 shadow-xs gap-3">
                  <div>
                    <h4 className="font-bold text-xs text-neutral-800 uppercase font-mono tracking-tight flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-yellow-600 animate-bounce" />
                      Stage resolved assets with full metadata
                    </h4>
                    <p className="text-[10px] text-neutral-500 mt-1 font-sans">
                      Automatically maps subjects, grade codes and topics into standard workspace fields to avoid any missing data.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={selectedSiteMapUrls.length === 0}
                      onClick={() => {
                        const finalAssetNodes = siteMapNodes.filter(n => n.is_final_asset);
                        const targets = finalAssetNodes.filter(n => selectedSiteMapUrls.includes(n.canonical_url));
                        const targetUrls = targets.map(t => t.canonical_url);
                        
                        const current = (discoverPastedUrls || "").trim() ? (discoverPastedUrls || "").trim() + "\n" : "";
                        setDiscoverPastedUrls(current + targetUrls.join("\n"));
                        setActiveTab("discover");
                        setSelectedSiteMapUrls([]);
                      }}
                      variant="outline"
                      className="border-[#141414] text-[#141414] hover:bg-neutral-100 rounded-none font-mono text-[10px] uppercase h-9 px-4 shadow-[2px_2px_0px_rgba(0,0,0,1)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Promote to Crawler Job
                    </Button>
                    <Button
                      id="sitemapping-stage-selected-btn"
                      disabled={selectedSiteMapUrls.length === 0}
                      onClick={() => {
                        const finalAssetNodes = siteMapNodes.filter(n => n.is_final_asset);
                        const targets = finalAssetNodes.filter(n => selectedSiteMapUrls.includes(n.canonical_url));
                        if (onStageUrlsWithMetadata) {
                          onStageUrlsWithMetadata(
                            targets.map(t => ({
                              url: t.canonical_url,
                              grade: t.extracted_grade,
                              subject: t.extracted_subject,
                              topic: t.extracted_topic,
                              docType: t.extracted_document_type
                            }))
                          );
                          setSelectedSiteMapUrls([]);
                        }
                      }}
                      className="bg-[#141414] hover:bg-neutral-800 text-white rounded-none font-mono text-[10px] uppercase h-9 px-4 shadow-[2px_2px_0px_rgba(0,0,0,1)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Stage Checked Assets ({selectedSiteMapUrls.length})
                    </Button>
                    <Button 
                      variant="outline"
                      disabled={selectedSiteMapUrls.length === 0 || isSavingToDrive}
                      onClick={() => handleBulkSaveToDrive(selectedSiteMapUrls)}
                      className="h-9 rounded-none font-mono text-[10px] uppercase border-[#141414] text-[#141414] shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                    >
                      {isSavingToDrive ? "Saving..." : `Add Checked to Drive (${selectedSiteMapUrls.length})`}
                    </Button>
                  </div>
                </div>

                <div className="border border-neutral-200 bg-white overflow-x-auto shadow-sm">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                      <tr className="bg-neutral-50 border-b border-neutral-200 text-[9px] font-mono uppercase text-neutral-500">
                        <th className="p-3 w-10 text-center">
                          <input 
                            type="checkbox" 
                            checked={
                              filteredSiteMapNodes.filter(n => n.is_final_asset).length > 0 &&
                              selectedSiteMapUrls.length === filteredSiteMapNodes.filter(n => n.is_final_asset).length
                            } 
                            onChange={() => {
                              const finalAssetNodes = filteredSiteMapNodes.filter(n => n.is_final_asset);
                              if (selectedSiteMapUrls.length === finalAssetNodes.length) {
                                setSelectedSiteMapUrls([]);
                              } else {
                                setSelectedSiteMapUrls(finalAssetNodes.map(n => n.canonical_url));
                              }
                            }} 
                            className="rounded-none border-neutral-300 w-3.5 h-3.5 cursor-pointer" 
                          />
                        </th>
                        <th className="p-3 font-bold">Source Path / Breadcrumb</th>
                        <th className="p-3 font-bold">Clean proposed filename</th>
                        <th className="p-3 font-bold">Target url</th>
                        <th className="p-3 font-bold w-16">Grade</th>
                        <th className="p-3 font-bold w-16">Subject</th>
                        <th className="p-3 font-bold w-20">Doc type</th>
                        <th className="p-3 font-bold text-center w-20">Confidence</th>
                        <th className="p-3 font-bold w-24">Workspace Status</th>
                        <th className="p-3 font-bold w-12 text-center">Open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 text-[11px]">
                      {filteredSiteMapNodes.filter(n => n.is_final_asset).map((node, idx) => {
                        const isChecked = selectedSiteMapUrls.includes(node.canonical_url);
                        
                        // Create cleanest compliant base filename (Task 7)
                        const gSeg = (node.extracted_grade || "").trim() || "1AC";
                        const sSeg = (node.extracted_subject || "").trim() || "Math";
                        const cleanT = (node.extracted_topic || "Topic").trim().replace(/[\s\-_]+/g, "-");
                        const docSeg = node.extracted_document_type || "Cours";
                        const srcSegment = node.canonical_url.includes("talamidi") ? "Talamidi" : "Moutamadris";
                        
                        const generatedName = `${gSeg}_${sSeg}_${cleanT}_${docSeg}_${srcSegment}.pdf`.replace(/^[-_\s]+/, "");

                        const staged = stagedPdfs?.find(s => s.url === node.canonical_url);

                        return (
                          <tr key={node.id || idx} className={`hover:bg-neutral-50/50 transition-colors ${isChecked ? "bg-emerald-50/30" : ""}`}>
                            <td className="p-3 text-center">
                              <input 
                                type="checkbox" 
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedSiteMapUrls(prev => 
                                    prev.includes(node.canonical_url)
                                      ? prev.filter(u => u !== node.canonical_url)
                                      : [...prev, node.canonical_url]
                                  );
                                }}
                                className="rounded-none border-neutral-300 w-3.5 h-3.5 cursor-pointer" 
                              />
                            </td>
                            <td className="p-3">
                              <div className="font-sans text-[11px] text-neutral-900 font-bold">
                                {node.navigation_path || "Seed > Item"}
                              </div>
                              <div className="text-[9px] font-mono text-neutral-400 mt-0.5">Hash: {node.canonical_url_hash?.substring(0, 8)}</div>
                            </td>
                            <td className="p-3 font-mono text-[10px] text-emerald-800 font-semibold break-all max-w-[210px]">
                              {generatedName}
                            </td>
                            <td className="p-3 font-mono text-[10px] text-neutral-500 max-w-[180px] truncate" title={node.canonical_url}>
                              {node.canonical_url}
                            </td>
                            <td className="p-3">
                              <Badge className="bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-neutral-200 rounded-none text-[8px] font-mono shadow-none uppercase">
                                {node.extracted_grade}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <Badge className="bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-neutral-200 rounded-none text-[8px] font-mono shadow-none uppercase">
                                {node.extracted_subject}
                              </Badge>
                            </td>
                            <td className="p-3">
                              <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-none text-[8px] font-mono shadow-none uppercase">
                                {node.extracted_document_type}
                              </Badge>
                            </td>
                            <td className="p-1 font-mono text-center">
                              <span className={`font-bold text-[10px] ${
                                node.confidence >= 0.9 ? "text-emerald-700" :
                                node.confidence >= 0.75 ? "text-blue-700" : "text-amber-700"
                              }`}>
                                {Math.round((node.confidence || 0) * 100)}%
                              </span>
                            </td>
                            <td className="p-3">
                              {staged ? (
                                <Badge className="bg-amber-100 text-amber-850 hover:bg-amber-100 border border-amber-300 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-amber-50 shadow-none uppercase animate-pulse">
                                  Staged ({staged.status})
                                </Badge>
                              ) : (
                                <Badge className="bg-neutral-100 text-neutral-600 border border-neutral-250 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-neutral-50 shadow-none uppercase">
                                  Ready
                                </Badge>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex flex-col items-center gap-2">
                                <a href={node.canonical_url} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-neutral-900 inline-block align-middle">
                                  <ExternalLink className="w-3.5 h-3.5"/>
                                </a>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : siteMapSubTab === "staged_assets" ? (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <div className="border border-neutral-300 bg-white p-3 shadow-xs">
                    <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">Total Staged</div>
                    <div className="text-sm font-black font-mono text-blue-700 mt-1">{stagedPdfAssets.length}</div>
                  </div>
                  <div className="border border-neutral-300 bg-white p-3 shadow-xs">
                    <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">By Grade</div>
                    <div className="text-[9px] font-mono text-neutral-700 mt-1 max-h-24 overflow-y-auto">
                      {Object.entries(stagedPdfAssets.reduce((acc: any, curr: any) => { acc[curr.extracted_grade || 'Unknown'] = (acc[curr.extracted_grade || 'Unknown'] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([k,v]) => <div key={k}>{k}: {v as number}</div>)}
                    </div>
                  </div>
                  <div className="border border-neutral-300 bg-white p-3 shadow-xs">
                    <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">By Subject</div>
                    <div className="text-[9px] font-mono text-neutral-700 mt-1 max-h-24 overflow-y-auto">
                      {Object.entries(stagedPdfAssets.reduce((acc: any, curr: any) => { acc[curr.extracted_subject || 'Unknown'] = (acc[curr.extracted_subject || 'Unknown'] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([k,v]) => <div key={k}>{k}: {v as number}</div>)}
                    </div>
                  </div>
                  <div className="border border-neutral-300 bg-white p-3 shadow-xs flex-1">
                    <div className="text-[8px] uppercase font-mono font-bold text-neutral-500">By Type</div>
                    <div className="text-[9px] font-mono text-neutral-700 mt-1 max-h-24 overflow-y-auto w-full">
                      {Object.entries(stagedPdfAssets.reduce((acc: any, curr: any) => { acc[curr.extracted_document_type || 'Unknown'] = (acc[curr.extracted_document_type || 'Unknown'] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([k,v]) => <div key={k}>{k}: {v as number}</div>)}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 p-2 bg-neutral-50 border border-neutral-200">
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="text-[10px] uppercase font-mono bg-white"
                    onClick={() => setSelectedStagedUrls(stagedPdfAssets.map((n: any) => n.canonical_url))}
                  >
                    Select All ({stagedPdfAssets.length})
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="text-[10px] uppercase font-mono bg-white text-red-600"
                    onClick={() => setSelectedStagedUrls([])}
                  >
                    Clear Selection
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="text-[10px] uppercase font-mono bg-indigo-50 border-indigo-200 text-indigo-700"
                    onClick={() => handleBulkSaveToDrive(selectedStagedUrls)}
                    disabled={selectedStagedUrls.length === 0 || !hasDriveConnected || isSavingToDrive}
                  >
                    {isSavingToDrive ? "Saving..." : (hasDriveConnected ? "Add to Drive" : "Drive Not Configured")}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="text-[10px] uppercase font-mono bg-emerald-50 border-emerald-200 text-emerald-700 relative group overflow-hidden"
                    onClick={async () => {
                       try {
                         const JSZip = (await import("jszip")).default;
                         const zip = new JSZip();
                         
                         let completed = 0;
                         let failed = 0;
                         const total = selectedStagedUrls.length;
                         
                         const toastId = toast.loading(`Preparing PDF ZIP archive... 0/${total} downloaded`);
                         
                         // Process in small batches to preserve memory and avoid 429s/timeouts
                         const BATCH_SIZE = 5;
                         for (let i = 0; i < total; i += BATCH_SIZE) {
                           const batch = selectedStagedUrls.slice(i, i + BATCH_SIZE);
                           await Promise.all(batch.map(async (rawUrl) => {
                             try {
                               const response = await fetch("/api/proxy-download", {
                                 method: "POST",
                                 headers: { "Content-Type": "application/json" },
                                 body: JSON.stringify({ url: rawUrl })
                               });
                               if (!response.ok) throw new Error("Download failed");
                               const blob = await response.blob();
                               
                               let fileName = rawUrl.split('/').pop() || `document.pdf`;
                               try {
                                 fileName = decodeURIComponent(fileName);
                               } catch (e) {}
                               fileName = fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
                               
                               if (fileName.length > 80) {
                                 fileName = fileName.substring(fileName.length - 80);
                               }
                               
                               if (!fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';
                               
                               // lookup grade
                               const record = stagedPdfAssets.find((a: any) => a.canonical_url === rawUrl || a.url === rawUrl);
                               const grade = record?.extracted_grade || "Unknown_Grade";
                               const safeGrade = grade.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
                               
                               // prefix with index to prevent duplicate names replacing each other
                               const fileIndex = selectedStagedUrls.indexOf(rawUrl);
                               zip.file(`${safeGrade}/${fileIndex + 1}_${fileName}`, blob);
                               completed++;
                             } catch (err) {
                               console.error("Failed to fetch", rawUrl, err);
                               failed++;
                               zip.file(`Failed_Downloads/ERROR_${selectedStagedUrls.indexOf(rawUrl) + 1}.txt`, `Failed to download: ${rawUrl}`);
                             }
                           }));
                           
                           toast.loading(`Zipping PDFs... ${completed + failed}/${total} processed`, { id: toastId });
                         }

                         toast.loading(`Compressing final archive... (This may take a moment)`, { id: toastId });
                         const zipBlob = await zip.generateAsync({ type: "blob" });
                         
                         const urlObj = URL.createObjectURL(zipBlob);
                         const a = document.createElement("a");
                         a.href = urlObj;
                         a.download = `All_Grades_Export_${total}.zip`;
                         a.click();
                         
                         toast.success(`Successfully created ZIP archive! (${completed} success, ${failed} failed)`, { id: toastId });
                       } catch (e: any) {
                         console.error(e);
                         toast.error("Failed to export as ZIP.", { description: e.message });
                       }
                    }}
                    disabled={selectedStagedUrls.length === 0}
                  >
                    Export ZIP Archive
                  </Button>
                </div>

                {stagedPdfAssets.length === 0 ? (
                  <div className="p-8 text-center text-neutral-500 font-mono text-[10px] uppercase border border-dashed border-neutral-300">
                    No staged PDFs found.
                  </div>
                ) : (
                  <div className="border border-neutral-200 bg-white overflow-x-auto shadow-sm">
                    <table className="w-full text-left border-collapse min-w-[800px]">
                      <thead>
                        <tr className="bg-neutral-50 border-b border-neutral-200 text-[9px] font-mono uppercase text-neutral-500">
                          <th className="p-3 w-10 text-center">
                            <input 
                              type="checkbox" 
                              checked={stagedPdfAssets.length > 0 && selectedStagedUrls.length === stagedPdfAssets.length} 
                              onChange={() => {
                                if (selectedStagedUrls.length === stagedPdfAssets.length) {
                                  setSelectedStagedUrls([]);
                                } else {
                                  setSelectedStagedUrls(stagedPdfAssets.map((n: any) => n.canonical_url));
                                }
                              }} 
                              className="rounded-none border-neutral-300 w-3.5 h-3.5 cursor-pointer" 
                            />
                          </th>
                          <th className="p-3 font-bold w-16">Grade</th>
                          <th className="p-3 font-bold w-16">Subject</th>
                          <th className="p-3 font-bold w-20">Doc type</th>
                          <th className="p-3 font-bold">Topic</th>
                          <th className="p-3 font-bold text-center w-20">Confidence</th>
                          <th className="p-3 font-bold text-center">Source</th>
                          <th className="p-3 font-bold w-24">Drive Status</th>
                          <th className="p-3 font-bold w-12 text-center">Open</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 text-[11px]">
                        {stagedPdfAssets.map((node: any, idx: number) => {
                          const isChecked = selectedStagedUrls.includes(node.canonical_url);
                          return (
                            <tr key={node.id || idx} className={`hover:bg-neutral-50/50 transition-colors ${isChecked ? "bg-emerald-50/30" : ""}`}>
                              <td className="p-3 text-center">
                                <input 
                                  type="checkbox" 
                                  checked={isChecked}
                                  onChange={() => {
                                    setSelectedStagedUrls(prev => 
                                      prev.includes(node.canonical_url)
                                        ? prev.filter(u => u !== node.canonical_url)
                                        : [...prev, node.canonical_url]
                                    );
                                  }}
                                  className="rounded-none border-neutral-300 w-3.5 h-3.5 cursor-pointer" 
                                />
                              </td>
                              <td className="p-3 text-neutral-700">
                                 <Badge className="bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-neutral-200 rounded-none text-[8px] font-mono shadow-none uppercase">
                                    {node.extracted_grade || "—"}
                                 </Badge>
                              </td>
                              <td className="p-3 text-neutral-700">
                                 <Badge className="bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-neutral-200 rounded-none text-[8px] font-mono shadow-none uppercase">
                                    {node.extracted_subject || "—"}
                                 </Badge>
                              </td>
                              <td className="p-3 text-neutral-700">
                                 <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-none text-[8px] font-mono shadow-none uppercase">
                                    {node.extracted_document_type || "—"}
                                 </Badge>
                              </td>
                              <td className="p-3 font-mono text-[10px] text-neutral-600 truncate max-w-[200px]" title={node.extracted_topic || ""}>
                                 {node.extracted_topic || "—"}
                              </td>
                              <td className="p-1 font-mono text-center">
                                <span className={`font-bold text-[10px] ${
                                  node.confidence >= 0.9 ? "text-emerald-700" :
                                  node.confidence >= 0.75 ? "text-blue-700" : "text-amber-700"
                                }`}>
                                  {Math.round((node.confidence || 0) * 100)}%
                                </span>
                              </td>
                              <td className="p-3 text-center font-mono text-[10px]">
                                <a href={node.source_url || node.canonical_url} target="_blank" rel="noreferrer" className="text-neutral-500 hover:underline">
                                  {new URL(node.source_url || node.canonical_url || "http://unknown").hostname.replace("www.", "")}
                                </a>
                              </td>
                              <td className="p-3">
                                <Badge className={`rounded-none text-[8px] font-mono py-0 px-1 shadow-none uppercase ${node.drive_status === "uploaded" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-neutral-100 text-neutral-600 border-neutral-250 hover:bg-neutral-50"}`}>
                                   {node.drive_status}
                                </Badge>
                              </td>
                              <td className="p-3 text-center">
                                <a href={node.source_url || node.canonical_url} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-neutral-900 inline-block align-middle">
                                  <ExternalLink className="w-3.5 h-3.5"/>
                                </a>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="border border-neutral-200 bg-white overflow-x-auto shadow-sm">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-[9px] font-mono uppercase text-neutral-500">
                  {showAdvancedStaging && (
                    <th className="p-3 w-10 text-center">
                      <input 
                        type="checkbox" 
                        checked={filteredTableItems.length > 0 && filteredTableItems.every(r => selectedDiscovered.includes(r.url))} 
                        onChange={() => {
                          const allShowingUrls = filteredTableItems.map(r => r.url);
                          const isAllChecked = filteredTableItems.every(r => selectedDiscovered.includes(r.url));
                          if (isAllChecked) {
                            setSelectedDiscovered(prev => prev.filter(u => !allShowingUrls.includes(u)));
                          } else {
                            setSelectedDiscovered(prev => Array.from(new Set([...prev, ...allShowingUrls])));
                          }
                        }} 
                        className="rounded-none border-neutral-300 w-3.5 h-3.5 cursor-pointer" 
                      />
                    </th>
                  )}
                  <th className="p-3 font-bold">Original URL / File</th>
                  <th className="p-3 font-bold">Generated Filename</th>
                  <th className="p-3 font-bold">Extracted Topic</th>
                  <th className="p-3 font-bold w-28">Document Type</th>
                  <th className="p-3 font-bold w-24">Rename Confidence</th>
                  <th className="p-3 font-bold w-24">Status</th>
                  <th className="p-3 font-bold w-12 text-center">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-[11px]">
                {filteredTableItems.map((item, idx) => {
                  const isChecked = selectedDiscovered.includes(item.url);
                  
                  const staged = stagedPdfs?.find(s => s.url === item.url);
                  const nameResult = generateCurriculumFilename({
                    url: item.url,
                    grade: staged?.gradeId || item.grade,
                    subject: staged?.subjectId || item.subject,
                    documentType: staged?.documentTypeId,
                    htmlTitle: staged?.cleanTitle || item.title
                  });

                  return (
                    <tr 
                      key={item.url + idx} 
                      className={`hover:bg-neutral-50/50 transition-colors ${showAdvancedStaging && isChecked ? 'bg-emerald-50/30' : ''}`}
                    >
                      {showAdvancedStaging && (
                        <td className="p-3 text-center">
                          <input 
                            type="checkbox" 
                            checked={isChecked}
                            onChange={() => {
                              setSelectedDiscovered(prev => prev.includes(item.url) ? prev.filter(u => u !== item.url) : [...prev, item.url]);
                            }}
                            className="rounded-none border-neutral-300 w-3.5 h-3.5 cursor-pointer" 
                          />
                        </td>
                      )}
                      
                      <td className="p-3 font-medium text-neutral-800">
                        <div className="truncate max-w-[185px] text-[11px]" title={item.title}>
                          {item.title}
                        </div>
                        <div className="text-[9px] text-neutral-400 truncate max-w-[185px] font-mono break-all" title={item.url}>
                          {item.url}
                        </div>
                      </td>

                      <td className="p-3 font-mono text-[10px] text-emerald-800 font-semibold break-all max-w-[220px]" title={nameResult.filename}>
                        {nameResult.filename}
                      </td>

                      <td className="p-3">
                        <span className="font-mono bg-neutral-100 px-1.5 py-0.5 border border-neutral-200 text-neutral-800 text-[10px] truncate max-w-[125px] block font-medium" title={nameResult.extractedTopic}>
                          {nameResult.extractedTopic}
                        </span>
                      </td>

                      <td className="p-3 shrink-0">
                        <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-none text-[8px] font-mono py-0 px-1.5 shadow-none uppercase">
                          {nameResult.documentType}
                        </Badge>
                      </td>

                      <td className="p-3 font-mono text-[10px]">
                        <div className="flex items-center gap-1">
                          <span className={`font-bold ${
                            nameResult.confidence >= 0.9 ? "text-emerald-600" :
                            nameResult.confidence >= 0.8 ? "text-blue-600" : "text-amber-600"
                          }`}>
                            {Math.round(nameResult.confidence * 100)}%
                          </span>
                        </div>
                      </td>

                      <td className="p-3">
                        <div className="flex flex-col gap-1 items-start">
                          {item.status === "staged" ? (
                            <Badge className="bg-amber-50 text-amber-800 border border-amber-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-amber-50 shadow-none uppercase">
                              Staged
                            </Badge>
                          ) : item.status === "pending_staged" ? (
                            <Badge className="bg-amber-50/50 text-amber-700 border border-amber-150 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-amber-50/50 shadow-none uppercase">
                              Pending Staged
                            </Badge>
                          ) : item.status === "exact_duplicate" ? (
                            <Badge className="bg-red-50 text-red-700 border border-red-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-red-50 shadow-none uppercase">
                              Exact Duplicate
                            </Badge>
                          ) : item.status === "content_duplicate" ? (
                            <Badge className="bg-rose-50 text-rose-700 border border-rose-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-rose-50 shadow-none uppercase">
                              Content Duplicate
                            </Badge>
                          ) : item.status === "same_ref_only" ? (
                            <Badge className="bg-blue-50 text-blue-700 border border-blue-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-blue-50 shadow-none uppercase">
                              Same Ref Only
                            </Badge>
                          ) : item.status === "invalid_download" ? (
                            <Badge className="bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-neutral-150 shadow-none uppercase">
                              Invalid Download
                            </Badge>
                          ) : item.status === "placeholder_download" ? (
                            <Badge className="bg-purple-50 text-purple-700 border border-purple-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-purple-50 shadow-none uppercase">
                              Placeholder
                            </Badge>
                          ) : item.status === "Rejected" ? (
                            <Badge className="bg-neutral-100 text-neutral-500 border border-neutral-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-neutral-100 shadow-none uppercase">
                              Rejected
                            </Badge>
                          ) : item.status === "Staged" ? (
                            <Badge className="bg-amber-50 text-amber-800 border border-amber-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-amber-50 shadow-none uppercase">
                              Staged
                            </Badge>
                          ) : (
                            <Badge className="bg-neutral-50 text-neutral-700 border border-neutral-200 rounded-none text-[8px] font-mono py-0 px-1 hover:bg-neutral-50 shadow-none uppercase">
                              Pending
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="p-3 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <a 
                            href={item.url} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-neutral-400 hover:text-neutral-900 inline-block align-middle"
                          >
                            <ExternalLink className="w-3.5 h-3.5"/>
                          </a>
                        </div>
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
export default IntakeJobView;
