import apiClient from "./apiClient";

export const ocrApi = {
  getStatus: async () => {
    const res = await apiClient.get("/api/pipeline/ocr/status");
    return res.data;
  },

  pauseQueue: async () => {
    const res = await apiClient.post("/api/pipeline/ocr/pause");
    return res.data;
  },

  resumeQueue: async () => {
    const res = await apiClient.post("/api/pipeline/ocr/resume");
    return res.data;
  },

  stopQueue: async () => {
    const res = await apiClient.post("/api/pipeline/ocr/stop");
    return res.data;
  },

  updateConfig: async (newConfig: any) => {
    const res = await apiClient.post("/api/pipeline/ocr/config", newConfig);
    return res.data;
  },

  runOcr: async (hash: string) => {
    const res = await apiClient.post("/api/pipeline/ocr", { hash });
    return res.data;
  }
};
