import { useState, useEffect, useCallback } from "react";
import { PipelineStats } from "../types/pipeline";
import { reportsApi } from "../services/reportsApi";

export function usePipelineStats() {
  const [pipelineStats, setPipelineStats] = useState<PipelineStats>({
    originalDownloads: 0,
    cleanCopies: 0,
    datasetRows: 0,
    localRoot: ""
  });
  const [reports, setReports] = useState<any>(null);
  const [loadingReports, setLoadingReports] = useState(false);

  const fetchPipelineStats = useCallback(async () => {
    setLoadingReports(true);
    try {
      const data = await reportsApi.getPipelineReports();
      if (data && data.stats) {
        setPipelineStats(data.stats);
      }
      if (data && data.reports) {
        setReports(data.reports);
      }
    } catch (e) {
      console.error("Failed to load reports and statistics", e);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    fetchPipelineStats();
  }, [fetchPipelineStats]);

  return {
    pipelineStats,
    setPipelineStats,
    reports,
    loadingReports,
    fetchPipelineStats
  };
}
