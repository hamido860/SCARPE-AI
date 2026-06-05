import React, { useState } from "react";
import { Search, Globe, FileText, Download, Save, RefreshCw, Layers, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import axios from "axios";
import { getCachedToken } from "../../../services/googleDriveService";

export function CollectorJobView() {
  const [crawlUrl, setCrawlUrl] = useState("");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredResults, setDiscoveredResults] = useState<{ url: string; isDirectPdf: boolean; accepted: boolean; reason: string; }[]>([]);
  const [selectedDiscovered, setSelectedDiscovered] = useState<string[]>([]);
  const [isCollecting, setIsCollecting] = useState(false);
  
  const [collectStats, setCollectStats] = useState({
    discovered: 0, downloaded: 0, saved: 0, duplicate: 0, failed: 0
  });

  const handleDiscoverPdfs = async () => {
    if (!crawlUrl.trim()) {
      toast.error("Please enter a website URL or PDF URL.");
      return;
    }

    setIsDiscovering(true);
    setDiscoveredResults([]);
    setSelectedDiscovered([]);
    toast.info("Discovering PDFs...");

    try {
      const payload: any = { topicFilter: "" };
      if (crawlUrl.includes("\n") || crawlUrl.endsWith(".pdf")) {
        payload.pastedUrls = crawlUrl.split("\n").map(l => l.trim()).filter(Boolean);
      } else {
        payload.query = crawlUrl;
      }

      const res = await axios.post("/api/discover-pdfs", payload);
      const results = res.data.results || [];
      setDiscoveredResults(results);

      const acceptedUrls = results.filter((r: any) => r.accepted).map((r: any) => r.url);
      setSelectedDiscovered(acceptedUrls);
      
      setCollectStats(prev => ({ ...prev, discovered: results.length }));
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.error || "Discovery session encountered an error.");
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleCollectToDrive = async () => {
    if (selectedDiscovered.length === 0) {
      toast.error("Please select at least one discovered URL.");
      return;
    }

    const cachedToken = getCachedToken();
    if (!cachedToken) {
      toast.error("Please connect your Google Drive account first.");
      return;
    }

    setIsCollecting(true);
    toast.info("Collecting PDFs to Drive...");
    
    // We process sequentially or in chunks so we don't overwhelm the backend
    let downloaded = 0;
    let saved = 0;
    let duplicate = 0;
    let failed = 0;

    setCollectStats(prev => ({ ...prev, downloaded: 0, saved: 0, duplicate: 0, failed: 0 }));

    for (const url of selectedDiscovered) {
       try {
         const res = await axios.post("/api/collector/collect", {
           url,
           accessToken: cachedToken
         });
         
         if (res.data.status === "saved") {
            saved++; downloaded++;
         } else if (res.data.status === "duplicate") {
            duplicate++;
         } else {
            failed++;
         }
       } catch (err: any) {
         failed++;
         console.error("Failed to collect", url, err);
       }
       setCollectStats(prev => ({ ...prev, downloaded, saved, duplicate, failed }));
    }

    setIsCollecting(false);
    toast.success(`Collection finished. Saved: ${saved}, Duplicate: ${duplicate}, Failed: ${failed}`);
  };

  return (
    <div className="p-6 h-full flex flex-col space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-500" />
            PDF Drive Collector
          </CardTitle>
          <CardDescription>
            Discover PDFs and collect them safely into Google Drive without processing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input 
               placeholder="Paste site URL, or raw multiline PDF urls..." 
               value={crawlUrl}
               onChange={(e) => setCrawlUrl(e.target.value)}
            />
            <Button onClick={handleDiscoverPdfs} disabled={isDiscovering}>
              {isDiscovering ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Find PDFs
            </Button>
          </div>
          
          <div className="grid grid-cols-5 gap-4 mt-6">
            <div className="bg-neutral-50 border p-3 flex flex-col">
              <span className="text-xs text-neutral-500 font-bold uppercase tracking-wider">Discovered</span>
              <span className="text-2xl font-mono font-bold">{collectStats.discovered}</span>
            </div>
            <div className="bg-blue-50 border border-blue-100 p-3 flex flex-col">
              <span className="text-xs text-blue-500 font-bold uppercase tracking-wider">Downloaded</span>
              <span className="text-2xl font-mono font-bold text-blue-700">{collectStats.downloaded}</span>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 p-3 flex flex-col">
              <span className="text-xs text-emerald-500 font-bold uppercase tracking-wider">Saved to Drive</span>
              <span className="text-2xl font-mono font-bold text-emerald-700">{collectStats.saved}</span>
            </div>
            <div className="bg-amber-50 border border-amber-100 p-3 flex flex-col">
              <span className="text-xs text-amber-500 font-bold uppercase tracking-wider">Duplicates</span>
              <span className="text-2xl font-mono font-bold text-amber-700">{collectStats.duplicate}</span>
            </div>
            <div className="bg-red-50 border border-red-100 p-3 flex flex-col">
              <span className="text-xs text-red-500 font-bold uppercase tracking-wider">Failed</span>
              <span className="text-2xl font-mono font-bold text-red-700">{collectStats.failed}</span>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {discoveredResults.length > 0 && (
         <Card className="flex-1 flex flex-col min-h-0">
           <CardHeader className="shrink-0 flex flex-row items-center justify-between">
              <div>
                <CardTitle>Discovered Links ({discoveredResults.length})</CardTitle>
                <CardDescription>Select the valid PDFs you want to collect into your Google Drive.</CardDescription>
              </div>
              <Button onClick={handleCollectToDrive} disabled={isCollecting} className="bg-emerald-600 hover:bg-emerald-700">
                {isCollecting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save PDFs to Drive
              </Button>
           </CardHeader>
           <CardContent className="flex-1 overflow-y-auto">
             <div className="space-y-2">
                {discoveredResults.map((r, i) => (
                   <div key={i} className={`p-2 flex gap-3 text-sm border rounded hover:bg-neutral-50 ${selectedDiscovered.includes(r.url) ? 'border-emerald-500 bg-emerald-50 hover:bg-emerald-50' : 'border-neutral-200'} cursor-pointer`}
                      onClick={() => {
                        setSelectedDiscovered(prev => prev.includes(r.url) ? prev.filter(x => x !== r.url) : [...prev, r.url]);
                      }}>
                     <div className="shrink-0 pt-0.5">
                       {selectedDiscovered.includes(r.url) ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <div className="w-4 h-4 border rounded" />}
                     </div>
                     <div className="flex-1 min-w-0 font-mono break-all text-neutral-800">
                        {r.url}
                     </div>
                     <div className="shrink-0 w-32 truncate text-right">
                        {r.isDirectPdf ? <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">PDF</span> : <span className="text-xs bg-neutral-100 px-2 py-0.5 rounded">Web URL</span>}
                     </div>
                   </div>
                ))}
             </div>
           </CardContent>
         </Card>
      )}
    </div>
  );
}
