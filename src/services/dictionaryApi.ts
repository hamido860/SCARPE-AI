import apiClient from "./apiClient";
import { Dictionary } from "../types/dictionary";

export const dictionaryApi = {
  getDictionary: async () => {
    const res = await apiClient.get("/api/dictionary");
    return res.data;
  },

  commitDictionary: async (dictionary: Dictionary) => {
    const res = await apiClient.post("/api/dictionary", dictionary);
    return res.data;
  }
};
