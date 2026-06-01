import apiClient from "./apiClient";

export const pdfPipelineApi = {
  discoverPdfs: async (payload: any) => {
    const res = await apiClient.post("/api/discover-pdfs", payload);
    return res.data;
  },
  
  crawlPdfs: async (payload: { url: string; maxPages: number; maxDepth: number; topicFilter: string }) => {
    const res = await apiClient.post("/api/crawl-pdfs", payload);
    return res.data;
  },

  parsePdf: async (payload: { url: string; title: string; topicFilter?: string }) => {
    const res = await apiClient.post("/api/pipeline/parse", payload);
    return res.data;
  },

  classifyPdf: async (payload: { text: string; filename: string }) => {
    const res = await apiClient.post("/api/classify", payload);
    return res.data;
  },

  buildCleanCopy: async (payload: {
    hash: string;
    gradeId: string;
    subjectId: string;
    topicId: string;
    documentTypeId: string;
    title: string;
    url: string;
    text: string;
    levelspace?: any;
  }) => {
    const res = await apiClient.post("/api/pipeline/clean-copy", payload);
    return res.data;
  },

  combinePdfs: async (urls: string[]) => {
    const res = await apiClient.post("/api/combine-pdfs", { urls }, { responseType: "blob" });
    return res.data;
  },

  indexLevelspace: async (payload: {
    url: string;
    filename: string;
    text: string;
    hints: {
      gradeId: string | null;
      subjectId: string | null;
      topicId: string | null;
      documentTypeId: string | null;
    };
  }) => {
    const res = await apiClient.post("/api/pipeline/index-levelspace", payload);
    return res.data;
  },

  // Batch Job Endpoints
  saveBatchJob: async (job: any) => {
    const res = await apiClient.post("/api/pipeline/batch-job", job);
    return res.data;
  },

  getBatchJobs: async () => {
    const res = await apiClient.get("/api/pipeline/batch-jobs");
    return res.data;
  },

  getBatchJob: async (jobId: string) => {
    const res = await apiClient.get(`/api/pipeline/batch-job/${jobId}`);
    return res.data;
  },

  updateReportEntry: async (payload: { reportName: string; entry: any }) => {
    const res = await apiClient.post("/api/pipeline/reports/update", payload);
    return res.data;
  },

  proxyDownload: async (url: string) => {
    const res = await apiClient.post("/api/proxy-download", { url }, { responseType: "arraybuffer" });
    return res.data;
  }
};
