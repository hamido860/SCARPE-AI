import React, { useState, useEffect } from "react";
import { Play, RefreshCw, Cpu, Layers, FileJson, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import axios from "axios";
import { getCachedToken } from "../../../services/googleDriveService";

export function ProcessorJobView() {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/processor/queue");
      setQueue(res.data.items || []);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load processing queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleProcess = async (item: any) => {
    const cachedToken = getCachedToken();
    if (!cachedToken) {
      toast.error("Connect Google Drive first.");
      return;
    }

    setProcessingId(item.hash);
    toast.info(`Processing ${item.file_name}...`);

    try {
      const res = await axios.post("/api/processor/process", {
        accessToken: cachedToken,
        driveFileId: item.drive_file_id,
        hash: item.hash
      });

      if (res.data.success) {
        toast.success(`Processed ${item.file_name}. Review Status: ${res.data.reviewStatus}`);
        fetchQueue();
      } else {
        toast.error(`Processing failed: ${res.data.error || res.data.reason}`);
      }
    } catch (e: any) {
      toast.error(`Error processing ${item.file_name}: ${e.response?.data?.error || e.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleProcessAll = async () => {
     for (const item of queue.filter(q => q.processing_status !== 'completed')) {
        await handleProcess(item);
     }
  };

  return (
    <div className="p-6 h-full flex flex-col space-y-6 overflow-y-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-purple-500" />
            PDF RAG Processor
          </CardTitle>
          <CardDescription>
            Process collected PDFs from Drive to extract text, run OCR, classify and chunk them for RAG.
          </CardDescription>
        </CardHeader>
        <CardContent>
           <div className="flex gap-4">
              <Button variant="outline" onClick={fetchQueue} disabled={loading}>
                 <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                 Refresh Queue
              </Button>
              <Button onClick={handleProcessAll} disabled={processingId !== null || queue.length === 0} className="bg-purple-600 hover:bg-purple-700">
                 <Play className="w-4 h-4 mr-2" />
                 Process Pending
              </Button>
           </div>

           <div className="mt-6 flex flex-col gap-2">
             {queue.length === 0 && !loading ? (
                <div className="text-sm text-neutral-500">No PDFs waiting in queue. Collect some first.</div>
             ) : (
                queue.map((item, i) => (
                   <div key={i} className="border p-3 rounded flex justify-between items-center bg-white shadow-sm">
                      <div className="min-w-0 flex-1 pr-4">
                         <div className="font-mono text-sm font-bold truncate text-neutral-800">{item.file_name}</div>
                         <div className="text-xs text-neutral-500 truncate flex gap-4 mt-1">
                            <span>Hash: {item.hash.substring(0,8)}</span>
                            <span>Status: {item.processing_status.replace('_', ' ')}</span>
                            <span>Review: {item.review_status.replace('_', ' ')}</span>
                         </div>
                      </div>
                      <div className="shrink-0 flex gap-2">
                         <Button variant="outline" size="sm" onClick={() => window.open(item.drive_url, "_blank")}>
                            View Drive
                         </Button>
                         <Button 
                            variant="default" 
                            size="sm" 
                            disabled={processingId === item.hash || item.processing_status === 'completed'}
                            onClick={() => handleProcess(item)}>
                            {processingId === item.hash ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Process"}
                         </Button>
                      </div>
                   </div>
                ))
             )}
           </div>
        </CardContent>
      </Card>
    </div>
  );
}
