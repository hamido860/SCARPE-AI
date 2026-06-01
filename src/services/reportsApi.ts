import apiClient from "./apiClient";

export const reportsApi = {
  getPipelineReports: async () => {
    const res = await apiClient.get("/api/pipeline/reports");
    return res.data;
  }
};
