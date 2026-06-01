import { useState, useEffect, useCallback } from "react";
import { Dictionary, DictionaryItem, TopicItem } from "../types/dictionary";
import { dictionaryApi } from "../services/dictionaryApi";
import { toast } from "sonner";

export function useDictionary() {
  const [dictionary, setDictionary] = useState<Dictionary>({
    grades: [],
    subjects: [],
    topics: [],
    allowedDocumentTypes: []
  });
  const [loadingDictionary, setLoadingDictionary] = useState(false);
  const [savingDictionary, setSavingDictionary] = useState(false);

  const fetchDictionary = useCallback(async () => {
    setLoadingDictionary(true);
    try {
      const data = await dictionaryApi.getDictionary();
      if (data && data.success && data.dictionary) {
        setDictionary(data.dictionary);
      } else if (data && data.dictionary) {
        setDictionary(data.dictionary);
      }
    } catch (e: any) {
      console.error("Failed to load reference dictionary", e);
      toast.error("Failed to fetch classification reference dictionary.");
    } finally {
      setLoadingDictionary(false);
    }
  }, []);

  const commitDictionary = useCallback(async (customDict?: Dictionary) => {
    setSavingDictionary(true);
    try {
      const dictToSave = customDict || dictionary;
      await dictionaryApi.commitDictionary(dictToSave);
      toast.success("Dictionary saved successfully to local database.");
    } catch (e: any) {
      console.error("Failed to save reference dictionary", e);
      toast.error("Failed to save reference dictionary to local database.");
    } finally {
      setSavingDictionary(false);
    }
  }, [dictionary]);

  const addGrade = useCallback((newGrade: DictionaryItem) => {
    setDictionary(prev => ({
      ...prev,
      grades: [...prev.grades, newGrade]
    }));
  }, []);

  const addSubject = useCallback((newSubject: DictionaryItem) => {
    setDictionary(prev => ({
      ...prev,
      subjects: [...prev.subjects, newSubject]
    }));
  }, []);

  const addTopic = useCallback((newTopic: TopicItem) => {
    setDictionary(prev => ({
      ...prev,
      topics: [...prev.topics, newTopic]
    }));
  }, []);

  useEffect(() => {
    fetchDictionary();
  }, [fetchDictionary]);

  return {
    dictionary,
    setDictionary,
    loadingDictionary,
    savingDictionary,
    fetchDictionary,
    commitDictionary,
    addGrade,
    addSubject,
    addTopic
  };
}
