import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import { load } from "cheerio";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import { createRequire } from "module";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import fs from "fs";
import crypto from "crypto";

import JSZip from "jszip";
import { GoogleGenAI } from "@google/genai";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Initialize Supabase Client (if environment variables are present)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Initialize Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

import pdfParse from "pdf-parse/lib/pdf-parse.js";
const pdf = (pdfParse as any).default || pdfParse;

const upload = multer({ storage: multer.memoryStorage() });

const nvidia = new OpenAI({ 
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY 
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  const LOCAL_OUTPUT_DIR = process.env.LOCAL_OUTPUT_DIR || path.join(process.cwd(), "scarpe-output");
  
  // Create directory structures
  [
    "",
    "downloads",
    "text",
    "ocr",
    "clean-pdfs",
    "dataset",
    "reports"
  ].forEach(sub => {
    const fullPath = path.join(LOCAL_OUTPUT_DIR, sub);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });

  function updateReport(reportName: string, entry: any) {
    const reportPath = path.join(LOCAL_OUTPUT_DIR, "reports", reportName);
    let activeData: any[] = [];
    if (fs.existsSync(reportPath)) {
      try {
        activeData = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      } catch (e) {
        activeData = [];
      }
    }
    activeData.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(reportPath, JSON.stringify(activeData, null, 2));
  }

  app.use(express.json());

  // --- URL Redirect Resolver ---
  function resolveUrl(urlStr: string): string {
    try {
      if (!urlStr) return urlStr;
      const parsed = new URL(urlStr);
      // Facebook redirect
      if (parsed.hostname.includes("facebook.com") && parsed.pathname.endsWith("/l.php")) {
        const uParam = parsed.searchParams.get("u");
        if (uParam) {
          return resolveUrl(uParam);
        }
      }
      // Google redirect
      if (parsed.hostname.includes("google.com") && parsed.pathname.endsWith("/url")) {
        const qParam = parsed.searchParams.get("q") || parsed.searchParams.get("url");
        if (qParam) {
          return resolveUrl(qParam);
        }
      }
      // General redirect/hop params if they are valid URLs
      for (const key of ["u", "url", "target", "dest", "destination", "redirect", "href", "q"]) {
        const val = parsed.searchParams.get(key);
        if (val && (val.startsWith("http://") || val.startsWith("https://"))) {
          return resolveUrl(val);
        }
      }
    } catch (e) {
      // Ignore invalid/malformed URLs
    }
    return urlStr;
  }

  // --- Text Normalization and Dictionary Topic Matching Helpers ---

  function normalizeMatchText(value: string): string {
    if (!value) return "";
    let text = String(value).toLowerCase().trim();
    try {
      if (text.includes("%")) {
        text = decodeURIComponent(text).toLowerCase();
      }
    } catch (e) {}

    // Remove French accents/diacritics
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Normalize Arabic letters deterministic rules
    text = text
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/[\u064B-\u065F]/g, ""); // remove Arabic diacritics/harakat if any

    // replace separators _, -, ., /, %, + with spaces
    text = text.replace(/[_\-\.\/%\+]/g, " ");

    // collapse space/whitespace
    text = text.replace(/\s+/g, " ");
    return text.trim();
  }

  function isValidUrlSource(urlStr: string): { valid: boolean; reason?: string } {
    if (!urlStr) {
      return { valid: false, reason: "Malformed or unsupported source URL" };
    }
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();
      if (!host.includes(".")) {
        return { valid: false, reason: "Malformed or unsupported source URL" };
      }
      const parts = host.split(".");
      const blacklistedParts = ["cours", "maroc", "college"];
      
      const domainSLD = parts[parts.length - 2];
      if (blacklistedParts.includes(host) || blacklistedParts.includes(domainSLD)) {
        return { valid: false, reason: "Malformed or unsupported source URL" };
      }
      return { valid: true };
    } catch (e) {
      return { valid: false, reason: "Malformed or unsupported source URL" };
    }
  }

  function getSafeTitleFromFilename(filename: string): string {
    if (!filename) return "unnamed";
    let name = filename.replace(/\.[^/.]+$/, "");
    name = name.replace(/[_\-\.\/%\+]/g, " ");
    name = name.replace(/\s+/g, "_");
    return name || "unnamed";
  }

  function predetectDocumentType(title: string, url: string, allowedDocTypes: any[]): string | null {
    const combinedStr = normalizeMatchText(`${title} ${url}`);
    
    if (combinedStr.includes("cours") || combinedStr.includes("lesson") || combinedStr.includes("lecon") || combinedStr.includes("dars") || combinedStr.includes("درس") || combinedStr.includes("شرح") || combinedStr.includes("ملخص")) {
      return "cours";
    }
    if (combinedStr.includes("exercice") || combinedStr.includes("exercise") || combinedStr.includes("exercices") || combinedStr.includes("td") || combinedStr.includes("tp") || combinedStr.includes("serie") || combinedStr.includes("سلسلة") || combinedStr.includes("تمارين")) {
      return "exercice";
    }
    if (combinedStr.includes("corriger") || combinedStr.includes("corrige") || combinedStr.includes("correction") || combinedStr.includes("solution") || combinedStr.includes("حل") || combinedStr.includes("حلول")) {
      return "correction";
    }
    if (combinedStr.includes("forod") || combinedStr.includes("devoir") || combinedStr.includes("controle") || combinedStr.includes("فرض") || combinedStr.includes("frod") || combinedStr.includes("exam") || combinedStr.includes("examen") || combinedStr.includes("test") || combinedStr.includes("امتحان") || combinedStr.includes("فروض")) {
      return "exam_compilation";
    }
    if (combinedStr.includes("jodada") || combinedStr.includes("جذاذة") || combinedStr.includes("جذاذات")) {
      return "jadhatha";
    }
    if (combinedStr.includes("bilan") || combinedStr.includes("revision") || combinedStr.includes("resume") || combinedStr.includes("summary")) {
      return "summary_or_revision";
    }
    return null;
  }

  function buildDictionaryIndex(dictionary: any) {
    const norm = normalizeDictionary(dictionary);
    const gradesById: Record<string, any> = {};
    const subjectsById: Record<string, any> = {};
    const topicsById: Record<string, any> = {};
    const docTypesById: Record<string, any> = {};

    const gradeSearchEntries: any[] = [];
    const subjectSearchEntries: any[] = [];
    const topicSearchEntries: any[] = [];
    const docTypeSearchEntries: any[] = [];

    const addSearchEntry = (list: any[], item: any, sourceField: string, val: string, isKeyword: boolean) => {
      const normVal = normalizeMatchText(val);
      if (!normVal) return;
      list.push({
        id: item.id,
        item,
        field: sourceField,
        normVal,
        isKeyword
      });
    };

    norm.grades.forEach((g: any) => {
      gradesById[g.id] = g;
      addSearchEntry(gradeSearchEntries, g, "id", g.id, false);
      addSearchEntry(gradeSearchEntries, g, "nameAr", g.nameAr, false);
      addSearchEntry(gradeSearchEntries, g, "nameFr", g.nameFr, false);
      addSearchEntry(gradeSearchEntries, g, "suffix", g.suffix, false);
      if (Array.isArray(g.keywords)) {
        g.keywords.forEach((kw: string) => addSearchEntry(gradeSearchEntries, g, "keyword", kw, true));
      }
    });

    norm.subjects.forEach((s: any) => {
      subjectsById[s.id] = s;
      addSearchEntry(subjectSearchEntries, s, "id", s.id, false);
      addSearchEntry(subjectSearchEntries, s, "nameAr", s.nameAr, false);
      addSearchEntry(subjectSearchEntries, s, "nameFr", s.nameFr, false);
      addSearchEntry(subjectSearchEntries, s, "suffix", s.suffix, false);
      if (Array.isArray(s.keywords)) {
        s.keywords.forEach((kw: string) => addSearchEntry(subjectSearchEntries, s, "keyword", kw, true));
      }
    });

    norm.topics.forEach((t: any) => {
      topicsById[t.id] = t;
      addSearchEntry(topicSearchEntries, t, "id", t.id, false);
      addSearchEntry(topicSearchEntries, t, "nameAr", t.nameAr, false);
      addSearchEntry(topicSearchEntries, t, "nameFr", t.nameFr, false);
      addSearchEntry(topicSearchEntries, t, "suffix", t.suffix, false);
      if (Array.isArray(t.keywords)) {
        t.keywords.forEach((kw: string) => addSearchEntry(topicSearchEntries, t, "keyword", kw, true));
      }
    });

    norm.allowedDocumentTypes.forEach((d: any) => {
      docTypesById[d.id] = d;
      addSearchEntry(docTypeSearchEntries, d, "id", d.id, false);
      addSearchEntry(docTypeSearchEntries, d, "nameAr", d.nameAr, false);
      addSearchEntry(docTypeSearchEntries, d, "nameFr", d.nameFr, false);
      addSearchEntry(docTypeSearchEntries, d, "suffix", d.suffix, false);
      if (Array.isArray(d.keywords)) {
        d.keywords.forEach((kw: string) => addSearchEntry(docTypeSearchEntries, d, "keyword", kw, true));
      }
    });

    return {
      gradesById,
      subjectsById,
      topicsById,
      docTypesById,
      gradeSearchEntries,
      subjectSearchEntries,
      topicSearchEntries,
      docTypeSearchEntries
    };
  }

  function matchAgainstDictionary(params: {
    title: string;
    url: string;
    text: string;
    topicFilter?: string;
    dictionary: any;
  }) {
    const { title, url, text, topicFilter, dictionary } = params;
    const index = buildDictionaryIndex(dictionary);
    const normFilenameUrl = normalizeMatchText(`${title || ""} ${url || ""}`);
    const normText = normalizeMatchText(text || "");

    const matchedTermsSet = new Set<string>();
    const matchedFieldsSet = new Set<string>();

    const scoreMap = (searchEntries: any[], typeLabel: string) => {
      const scores: Record<string, number> = {};
      for (const entry of searchEntries) {
        const val = entry.normVal;
        if (!val || val.length <= 1) continue;
        
        let matchPlace: "filename" | "text" | null = null;
        let isMatch = false;

        if (val.length <= 2) {
          const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escaped}\\b`, "i");
          if (regex.test(normFilenameUrl)) {
            matchPlace = "filename";
            isMatch = true;
          } else if (regex.test(normText)) {
            matchPlace = "text";
            isMatch = true;
          }
        } else {
          if (normFilenameUrl.includes(val)) {
            matchPlace = "filename";
            isMatch = true;
          } else if (normText.includes(val)) {
            matchPlace = "text";
            isMatch = true;
          }
        }

        if (isMatch && matchPlace) {
          let pts = 0;
          if (matchPlace === "filename") {
            pts = entry.isKeyword ? 20 : 40;
          } else {
            pts = entry.isKeyword ? 10 : 25;
          }
          scores[entry.id] = (scores[entry.id] || 0) + pts;
          matchedTermsSet.add(entry.normVal);
          matchedFieldsSet.add(`${typeLabel}.${entry.field}`);
        }
      }
      return scores;
    };

    const gradeScores = scoreMap(index.gradeSearchEntries, "grade");
    const subjectScores = scoreMap(index.subjectSearchEntries, "subject");
    const topicScores = scoreMap(index.topicSearchEntries, "topic");
    const docTypeScores = scoreMap(index.docTypeSearchEntries, "documentType");

    // Add cross-relation scoring bonuses
    const bestGradeId = Object.keys(gradeScores).reduce((a, b) => gradeScores[a] > gradeScores[b] ? a : b, "");
    if (bestGradeId) {
      gradeScores[bestGradeId] += 10;
    }

    const bestSubjectId = Object.keys(subjectScores).reduce((a, b) => subjectScores[a] > subjectScores[b] ? a : b, "");
    if (bestSubjectId) {
      subjectScores[bestSubjectId] += 10;
    }

    // Topic subjectId relation bonus
    if (bestSubjectId) {
      Object.keys(topicScores).forEach(tId => {
        const topic = index.topicsById[tId];
        if (topic && topic.subjectId === bestSubjectId) {
          topicScores[tId] += 15;
        }
      });
    }

    const bestDocTypeId = Object.keys(docTypeScores).reduce((a, b) => docTypeScores[a] > docTypeScores[b] ? a : b, "");
    if (bestDocTypeId) {
      docTypeScores[bestDocTypeId] += 10;
    }

    // Limit topicId selections based on topicFilter if provided
    let filteredTopicScores = { ...topicScores };
    let activeFilterReport: any = null;
    let allowedTopicIds: string[] = [];

    if (topicFilter && topicFilter.trim().length > 0) {
      const resolved = resolveTopicFiltersAgainstDictionary(topicFilter, dictionary);
      allowedTopicIds = resolved.matchedTopics.map((m: any) => m.topicId);
      
      activeFilterReport = {
        rawFilters: topicFilter,
        matchedTopics: resolved.matchedTopics,
        unmatchedFilters: resolved.unmatchedFilters,
        expandedKeywords: resolved.expandedKeywords
      };

      const temp: Record<string, number> = {};
      allowedTopicIds.forEach(tId => {
        if (topicScores[tId] !== undefined) {
          temp[tId] = topicScores[tId];
        } else {
          temp[tId] = 5;
        }
      });
      filteredTopicScores = temp;
    }

    const finalGradeId = Object.keys(gradeScores).reduce((a, b) => gradeScores[a] > gradeScores[b] ? a : b, null as any);
    const finalSubjectId = Object.keys(subjectScores).reduce((a, b) => subjectScores[a] > subjectScores[b] ? a : b, null as any);
    const finalTopicId = Object.keys(filteredTopicScores).reduce((a, b) => filteredTopicScores[a] > filteredTopicScores[b] ? a : b, null as any);
    const finalDocTypeId = Object.keys(docTypeScores).reduce((a, b) => docTypeScores[a] > docTypeScores[b] ? a : b, null as any);

    const isMatched = !!(finalGradeId && finalSubjectId && finalTopicId && finalDocTypeId);

    return {
      gradeId: finalGradeId,
      subjectId: finalSubjectId,
      topicId: finalTopicId,
      documentTypeId: finalDocTypeId,
      isMatch: isMatched,
      matchedGrades: finalGradeId ? [index.gradesById[finalGradeId]] : [],
      matchedSubjects: finalSubjectId ? [index.subjectsById[finalSubjectId]] : [],
      matchedTopics: finalTopicId ? [index.topicsById[finalTopicId]] : [],
      matchedDocTypes: finalDocTypeId ? [index.docTypesById[finalDocTypeId]] : [],
      matchedTerms: Array.from(matchedTermsSet),
      matchedFields: Array.from(matchedFieldsSet),
      topicFilterReport: activeFilterReport,
      allowedTopicIds
    };
  }

  function safeJsonParseJsonObject(text: string): any {
    if (!text) return null;
    try {
      return JSON.parse(text.trim());
    } catch (e) {
      try {
        let cleaned = text.trim();
        if (cleaned.includes("```")) {
          const matches = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (matches && matches[1]) {
            cleaned = matches[1];
            return JSON.parse(cleaned.trim());
          }
        }
      } catch (e2) {}
      return null;
    }
  }

  function normalizeDictionary(rawDict: any) {
    const dict = rawDict || {};
    const safeArray = (arr: any) => Array.isArray(arr) ? arr : [];

    const mapItem = (item: any) => {
      if (!item || typeof item !== "object") return null;
      return {
        id: item.id || "",
        nameAr: item.nameAr || "",
        nameFr: item.nameFr || "",
        suffix: item.suffix || "",
        keywords: safeArray(item.keywords).map((kw: any) => String(kw || "").trim()),
        subjectId: item.subjectId || undefined
      };
    };

    const mapDocType = (item: any) => {
      if (!item || typeof item !== "object") return null;
      return {
        id: item.id || "",
        nameAr: item.nameAr || "",
        nameFr: item.nameFr || "",
        suffix: item.suffix || "",
        keywords: safeArray(item.keywords).map((kw: any) => String(kw || "").trim())
      };
    };

    return {
      grades: safeArray(dict.grades).map(mapItem).filter(Boolean),
      subjects: safeArray(dict.subjects).map(mapItem).filter(Boolean),
      topics: safeArray(dict.topics).map(mapItem).filter(Boolean),
      allowedDocumentTypes: safeArray(dict.allowedDocumentTypes || dict.allowed_document_types || dict.documentTypes).map(mapDocType).filter(Boolean)
    };
  }

  function parseTopicFilters(topicFilterStr: string): string[] {
    if (!topicFilterStr) return [];
    return Array.from(new Set(
      topicFilterStr
        .split(",")
        .map(p => normalizeMatchText(p))
        .filter(Boolean)
    ));
  }

  function resolveTopicFiltersAgainstDictionary(topicFilterStr: string, dictionary: any) {
    const normDict = normalizeDictionary(dictionary);
    const rawFilters = topicFilterStr ? topicFilterStr.split(",").map(f => f.trim()).filter(Boolean) : [];
    const parsedFilters = parseTopicFilters(topicFilterStr);

    const matchedTopics: any[] = [];
    const matchedFilterSet = new Set<string>();
    const expandedSet = new Set<string>();

    for (const f of parsedFilters) {
      for (const topic of normDict.topics) {
        const normId = normalizeMatchText(topic.id);
        const normNameAr = normalizeMatchText(topic.nameAr);
        const normNameFr = normalizeMatchText(topic.nameFr);
        const normSuffix = normalizeMatchText(topic.suffix);

        let matchType: "id" | "nameAr" | "nameFr" | "suffix" | "keyword" | null = null;

        if (f === normId || normId.includes(f) || f.includes(normId)) {
          matchType = "id";
        } else if (f === normNameAr || normNameAr.includes(f) || f.includes(normNameAr)) {
          matchType = "nameAr";
        } else if (f === normNameFr || normNameFr.includes(f) || f.includes(normNameFr)) {
          matchType = "nameFr";
        } else if (f === normSuffix || normSuffix.includes(f) || f.includes(normSuffix)) {
          matchType = "suffix";
        } else {
          for (const kw of topic.keywords) {
            const normKw = normalizeMatchText(kw);
            if (f === normKw || normKw.includes(f) || f.includes(normKw)) {
              matchType = "keyword";
              break;
            }
          }
        }

        if (matchType) {
          matchedFilterSet.add(f);

          matchedTopics.push({
            filter: f,
            topicId: topic.id,
            topicNameAr: topic.nameAr,
            topicNameFr: topic.nameFr,
            subjectId: topic.subjectId,
            matchedBy: matchType
          });

          expandedSet.add(f);
          if (topic.id) expandedSet.add(topic.id);
          if (topic.nameAr) expandedSet.add(topic.nameAr);
          if (topic.nameFr) expandedSet.add(topic.nameFr);
          if (topic.suffix) expandedSet.add(topic.suffix);
          for (const kw of topic.keywords) {
            if (kw) expandedSet.add(kw);
          }

          if (topic.subjectId) {
            const parentSub = normDict.subjects.find((s: any) => s.id === topic.subjectId);
            if (parentSub) {
              if (parentSub.nameAr) expandedSet.add(parentSub.nameAr);
              if (parentSub.nameFr) expandedSet.add(parentSub.nameFr);
              if (parentSub.suffix) expandedSet.add(parentSub.suffix);
              for (const kw of parentSub.keywords) {
                if (kw) expandedSet.add(kw);
              }
            }
          }
        }
      }
    }

    const unmatchedFiltersSet = new Set<string>();
    for (const rawF of rawFilters) {
      const normF = normalizeMatchText(rawF);
      if (!matchedFilterSet.has(normF)) {
        unmatchedFiltersSet.add(rawF);
      }
    }

    const unmatchedFilters = Array.from(unmatchedFiltersSet);
    const expandedKeywords = Array.from(expandedSet).map(s => s.trim()).filter(Boolean);

    console.log(`[TopicFilters] Raw filters: ${JSON.stringify(rawFilters)}`);
    console.log(`[TopicFilters] Matched topics: ${JSON.stringify(matchedTopics)}`);
    console.log(`[TopicFilters] Unmatched filters: ${JSON.stringify(unmatchedFilters)}`);

    return {
      rawFilters,
      matchedTopics,
      unmatchedFilters,
      expandedKeywords
    };
  }

  // --- RAG / Vector Store Implementation ---
  
  interface VectorDocument {
    id: string;
    url: string;
    title: string;
    text: string;
    embedding: number[];
  }

  const vectorStore: VectorDocument[] = [];

  // --- Supabase Logger ---
  async function saveToSupabase(data: { url: string; title: string; description: string; rawText: string; isPdf: boolean; }) {
    if (!supabase) return;
    try {
      const domain = new URL(data.url).hostname;
      // Extract educational metadata directly if it's Moutamadris
      let gradeLevel = getMoutamadrisGrade(data.url);
      let subject = null;
      try {
        const decoded = decodeURIComponent(data.url);
        const isSubject = /(رياضيات|عربية|فرنسية|إسلامية|نشاط علمي|فيزياء|كيمياء|علوم|حياة|أرض|فلسفة|اجتماعيات|تاريخ|جغرافيا|إنجليزية|إعلاميات)/i.exec(decoded);
        if(isSubject && isSubject[0]) subject = isSubject[0];
      } catch(e) {}

      await supabase.from('scraped_content').upsert({
        url: data.url,
        domain,
        title: data.title,
        description: data.description,
        raw_text: data.rawText,
        is_pdf: data.isPdf,
        grade_level: gradeLevel,
        subject: subject,
        updated_at: new Date().toISOString()
      }, { onConflict: 'url' }).select('id');
    } catch (err) {
      console.error("[Supabase Save Error]", err);
    }
  }

  // --- Moutamadris Educational Context Helpers ---
  function getMoutamadrisGrade(url: string): string | null {
    try {
      const decoded = decodeURIComponent(url).toLowerCase();
      // Regex to capture common grade slugs in Moutamadris
      const gradePattern = /\/([^\/]+-(?:ابتدائي|إعدادي|باك|مشترك|ثانوي))\//i;
      const match = decoded.match(gradePattern);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  function isStrictlyEducational(href: string, text: string, targetGrade: string | null): boolean {
    const combined = (decodeURIComponent(href) + " " + text).toLowerCase();
    
    // 1. Grade check: If we have a target grade, the link MUST contain it or be a direct child
    if (targetGrade && !combined.includes(targetGrade.toLowerCase())) {
      // Allow links that are very likely content links if they don't explicitly mention the grade but are relative
      if (!href.startsWith('http') || href.includes('moutamadris.ma')) {
         // Proceed to keyword check
      } else {
        return false;
      }
    }

    // 2. Strict Content Check (Courses, Exercises & Subjects only)
    const hasBlocked = /(examen|examens|forod|controle|devoir|test|sujet|امتحانات|فروض|اختبارات|جذاذات|نماذج|concours|توزيع|استعمال|الزمن|توجيه|عطل|عطلة|تقويم|تشخيصي|حركة|انتقالية|مهني|تكوين)/i.test(combined);
    
    if (hasBlocked) return false;

    const hasAllowedTopic = /(cours|lecon|lesson|dars|درس|شرح|ملخص|تمارين|exercice|تمرين|correction|solution)/i.test(combined);
    const isSubject = /(رياضيات|عربية|فرنسية|إسلامية|نشاط علمي|فيزياء|كيمياء|علوم|حياة|أرض|فلسفة|اجتماعيات|تاريخ|جغرافيا|إنجليزية|إعلاميات|تربية|فنية|بدنية|math|physique|chimie|svt|francais|arabe|english)/i.test(combined);

    return hasAllowedTopic || isSubject;
  }

  function cosineSimilarity(vecA: number[], vecB: number[]) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + chunkSize));
      i += chunkSize - overlap;
    }
    return chunks;
  }

  app.post("/api/ollama/models", async (req, res) => {
    try {
      let { apiUrl } = req.body;
      let targetUrl = apiUrl || process.env.OLLAMA_API_URL || "http://localhost:11434";
      if (typeof targetUrl === 'string') {
        targetUrl = targetUrl.trim();
      }
      if (targetUrl) {
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = `http://${targetUrl}`;
        }
      }
      
      const ollamaRes = await axios.get(`${targetUrl}/api/tags`, { timeout: 3000 });
      if (ollamaRes.data && ollamaRes.data.models) {
        return res.json({ models: ollamaRes.data.models });
      }
      return res.json({ models: [] });
    } catch (e: any) {
      // Return empty list gracefully without printing errors/warnings to the console
      return res.json({ models: [] });
    }
  });

  app.post("/api/ai/analyze", async (req, res) => {
    try {
      const { url, title, description, rawText } = req.body;
      if (!rawText) return res.status(400).json({ error: "rawText is required" });

      const prompt = `Analyze the following scraped web content and provide a summary, key points, sentiment, and main entities mentioned. 
        
      CRITICAL INSTRUCTIONS:
      1. Detect the primary COUNTRY associated with the content (e.g., "Morocco", "France", "USA").
      2. Detect the LANGUAGES used in the content (e.g., ["Arabic", "French", "English"]).
      3. Provide the summary and key points in the primary language of the content, but keep the sentiment and entities in English.
      4. Ask a short, engaging follow-up question in the primary language of the content. Specifically ask if they want to narrow down the data (e.g., "Do you only want the exercises or the main lesson?").
      5. Extract the main valuable content into 'fullContent', removing navigation, ads, and junk. CRITICAL: If the content contains exams, exercises, mathematical formulas, symbols (like ∀, ∈, ℝ), or code, PRESERVE THEM EXACTLY AS THEY ARE without summarizing, translating, or truncating them.
      
      Return the result in JSON format.
      
      Title: ${title}
      Description: ${description}
      Content: ${rawText}`;

      const aiResponse = await nvidia.chat.completions.create({
        model: "meta/llama-3.1-70b-instruct",
        messages: [{ role: "user", content: prompt + "\n\nRespond strictly with JSON containing: summary, keyPoints (array), sentiment, entities (array), followUpQuestion, detectedCountry, languages (array), and fullContent." }],
        response_format: { type: "json_object" }
      });

      // Update Supabase with AI metadata
      if (supabase && url && aiResponse.choices[0].message.content) {
        try {
          const aiData = JSON.parse(aiResponse.choices[0].message.content || '{}');
          await supabase.from('scraped_content').update({
            ai_summary: aiData.summary,
            ai_sentiment: aiData.sentiment,
            detected_country: aiData.detectedCountry,
            detected_languages: aiData.languages
          }).eq('url', url);
        } catch (e) {
          console.error("Failed to update AI metadata in Supabase", e);
        }
      }

      res.json({ text: aiResponse.choices[0].message.content });
    } catch (error: any) {
      console.error("[Analyze AI Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/extract-content", async (req, res) => {
    try {
      const { userIntent, negativeIntent, rawText } = req.body;
      if (!rawText) return res.status(400).json({ error: "rawText is required" });

      const prompt = `The user wants to EXTRACT and FILTER specific information from the provided text.
      
      POSITIVE INTENT (What to Keep): ${userIntent || "Everything valuable"}
      NEGATIVE INTENT (What to EXCLUDE/REMOVE): ${negativeIntent || "None"}
      
      TASK:
      1. Return ONLY the content that matches the POSITIVE INTENT.
      2. STRICTLY REMOVE any paragraphs, links, or sections that match the NEGATIVE INTENT or are irrelevant to the positive intent.
      3. If the extracted content contains exams, exercises, mathematical formulas, or special symbols (like ∀, ∈, ℝ), PRESERVE THEM EXACTLY.
      4. DO NOT return the original text untouched. You MUST apply the positive/negative filters to prune the text.
      5. Return ONLY the extracted, cleaned text without markdown code blocks like \`\`\`text.
      
      Original Text:
      ${rawText}`;

      const aiResponse = await nvidia.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [{ role: 'user', content: prompt }]
      });

      res.json({ text: aiResponse.choices[0].message.content });
    } catch (error: any) {
      console.error("[Extract AI Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/guided-scrape", async (req, res) => {
    try {
      const { userIntent, negativeIntent, url, links } = req.body;
      if (!links || !Array.isArray(links)) return res.status(400).json({ error: "links array is required" });

      const prompt = `The user is looking for: "${userIntent}" on the website "${url}".
      They specifically want full posts, detailed content, and documents (especially PDFs) related to this topic.
      
      CRITICAL: The user wants to AVOID or EXCLUDE links related to: "${negativeIntent || 'None'}". Do NOT pick links matching this negative intent.
      
      Here is a list of links found on the current page:
      ${JSON.stringify(links, null, 2)}
      
      Return the SINGLE BEST URL (as a raw string) that is highly relevant to the positive intent and DOES NOT match the negative intent.
      If none are highly relevant, return "NONE". ONLY return the raw string URL or "NONE", nothing else. Do not use JSON formatting.`;

      const aiResponse = await nvidia.chat.completions.create({
        model: "meta/llama-3.1-70b-instruct",
        messages: [{ role: "user", content: prompt }]
      });

      res.json({ text: aiResponse.choices[0].message.content });
    } catch (error: any) {
      console.error("[Guided Scrape AI Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/index", async (req, res) => {
    try {
      const { url, title, text } = req.body;
      if (!text) return res.status(400).json({ error: "Text is required" });

      const chunks = chunkText(text);
      let indexedCount = 0;

      for (const chunk of chunks) {
        if (chunk.trim().length < 10) continue;

        const embedResponse = await nvidia.embeddings.create({
          model: 'nvidia/nv-embedqa-e5-v5',
          input: chunk,
          encoding_format: "float",
          // @ts-ignore
          // @ts-ignore\n        extra_body: { input_type: "passage" }
        });
        const embedding = embedResponse.data[0].embedding;

        if (embedding) {
          vectorStore.push({
            id: Math.random().toString(36).substring(7),
            url,
            title,
            text: chunk,
            embedding
          });
          indexedCount++;
        }
      }

      res.json({ success: true, indexedChunks: indexedCount, totalDocuments: vectorStore.length });
    } catch (error: any) {
      console.error("[Index Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/index-pdf-url", async (req, res) => {
    try {
      const { url, title } = req.body;
      if (!url) return res.status(400).json({ error: "URL is required" });

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 30000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: (status) => status < 500
      });

      if (response.status === 404) {
        return res.status(404).json({ error: "File not found on target server" });
      }

      let indexedCount = 0;
      const isZip = url.toLowerCase().endsWith('.zip') || response.headers['content-type']?.includes('zip');

      if (isZip) {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(response.data);
        
        for (const [filename, fileData] of Object.entries(zipContent.files)) {
          const file = fileData as any;
          if (!file.dir && filename.toLowerCase().endsWith('.pdf')) {
            try {
              const buffer = await file.async("nodebuffer");
              const data = await pdf(buffer);
              const text = data.text.replace(/\s+/g, " ").trim();
              
              if (text) {
                const chunks = chunkText(text);
                for (const chunk of chunks) {
                  if (chunk.trim().length < 10) continue;
                  const embedResponse = await nvidia.embeddings.create({
          model: 'nvidia/nv-embedqa-e5-v5',
          input: chunk,
          encoding_format: "float",
          // @ts-ignore\n        extra_body: { input_type: "passage" }
        });
        const embedding = embedResponse.data[0].embedding;
                  if (embedding) {
                    vectorStore.push({
                      id: Math.random().toString(36).substring(7),
                      url: `${url}#${filename}`,
                      title: `${title} - ${filename}`,
                      text: chunk,
                      embedding
                    });
                    indexedCount++;
                  }
                }
              }
            } catch (e) {
              console.warn(`Failed to parse PDF inside zip: ${filename}`, e);
            }
          }
        }
      } else {
        // 2. Parse PDF
        const data = await pdf(response.data);
        const text = data.text.replace(/\s+/g, " ").trim();

        if (!text) {
          return res.status(400).json({ error: "Could not extract text from PDF" });
        }

        // 3. Chunk and Index
        const chunks = chunkText(text);

        for (const chunk of chunks) {
          if (chunk.trim().length < 10) continue;

          const embedResponse = await nvidia.embeddings.create({
          model: 'nvidia/nv-embedqa-e5-v5',
          input: chunk,
          encoding_format: "float",
          // @ts-ignore\n        extra_body: { input_type: "passage" }
        });
        const embedding = embedResponse.data[0].embedding;

          if (embedding) {
            vectorStore.push({
              id: Math.random().toString(36).substring(7),
              url,
              title: title || url.split('/').pop() || 'PDF Document',
              text: chunk,
              embedding
            });
            indexedCount++;
          }
        }
      }

      res.json({ success: true, indexedChunks: indexedCount, totalDocuments: vectorStore.length });
    } catch (error: any) {
      console.error(`[Index File URL Error] ${req.body.url}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { query, userIntent, negativeIntent, role } = req.body;
      if (!query) return res.status(400).json({ error: "Query is required" });

      if (vectorStore.length === 0) {
        return res.json({ 
          answer: "The knowledge base is empty. Please scrape and index some documents first.",
          sources: []
        });
      }

      // Embed the query
      const embedResponse = await nvidia.embeddings.create({
        model: 'nvidia/nv-embedqa-e5-v5',
        input: query,
        encoding_format: "float",
        // @ts-ignore\n        extra_body: { input_type: "query", truncate: "START" }
      });
      const queryEmbedding = embedResponse.data[0].embedding;

      if (!queryEmbedding) {
        throw new Error("Failed to generate embedding for query");
      }

      // Find top K similar chunks
      const scoredChunks = vectorStore.map(doc => ({
        ...doc,
        score: cosineSimilarity(queryEmbedding, doc.embedding)
      }));

      scoredChunks.sort((a, b) => b.score - a.score);
      const topK = scoredChunks.slice(0, 5);

      // Construct context
      const contextText = topK.map((chunk, i) => `[Source ${i + 1} - ${chunk.title} (${chunk.url})]:\n${chunk.text}`).join("\n\n");

      let preferenceGuide = "";
      if (userIntent) preferenceGuide += `\nThe user is specifically interested in: ${userIntent}`;
      if (negativeIntent) preferenceGuide += `\nThe user wants to avoid or ignore: ${negativeIntent}`;

      let rolePrompt = "You are a helpful assistant.";
      if (role === "Academic Tutor") {
        rolePrompt = "You are an Academic Tutor. Explain concepts clearly, step-by-step, and provide examples where helpful. Encourage critical thinking.";
      } else if (role === "Harsh Critic") {
        rolePrompt = "You are a Harsh Critic. Point out flaws, inconsistencies, and weak arguments in the provided data. Be direct and uncompromising.";
      } else if (role === "Data Analyst") {
        rolePrompt = "You are a Data Analyst. Focus on numbers, trends, and logical deductions. Be concise and structured in your response.";
      } else if (role === "Executive Summarizer") {
        rolePrompt = "You are an Executive Summarizer. Provide high-level, actionable insights. Get straight to the point without fluff.";
      }

      const prompt = `${rolePrompt} Use the following retrieved context to answer the user's question. If the answer is not in the context, say "I cannot find the answer in the provided documents."
${preferenceGuide}

DATABASE SCHEMA GUIDE:
You are trained to serve the following Supabase schema for 'rag_chunks':
Table: public.rag_chunks
- id: uuid
- content: text
- embedding: vector
- source_type: text (lesson_block, exercise, exam)
- source_id: uuid
- metadata: jsonb
- created_at: timestamp

Context:
${contextText}

Question: ${query}

Answer:`;

      const aiResponse = await nvidia.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [{ role: 'user', content: prompt }]
      });

      res.json({
        answer: aiResponse.choices[0].message.content || '',
        sources: topK.map(c => ({ title: c.title, url: c.url, score: c.score, text: c.text }))
      });

    } catch (error: any) {
      console.error("[Chat Error]", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/kb-stats", (req, res) => {
    res.json({ totalChunks: vectorStore.length });
  });

  app.post("/api/kb-clear", (req, res) => {
    vectorStore.length = 0;
    res.json({ success: true });
  });

  async function analyzePdfContent(text: string) {
    if (!text || text.length < 50) return null;

    try {
      const prompt = `Analyze the following PDF document content and provide a structured JSON response.
      Keep it short and concise.`;
      
      const aiResponse = await nvidia.chat.completions.create({
        model: "meta/llama-3.1-70b-instruct",
        messages: [{ role: "user", content: prompt + "\n\nRespond strictly with JSON containing: summary, keyPoints (array), sentiment, entities (array), detectedCountry, languages (array), followUpQuestion, and source_type." }],
        response_format: { type: "json_object" }
      });

      return JSON.parse(aiResponse.choices[0].message.content || "{}");
    } catch (error) {
      console.error("PDF Analysis Error:", error);
      return null;
    }
  }

  // Helper to scrape a single URL
  async function scrapeUrl(url: string, isMainPage = true, ollamaModel?: string, ollamaApiUrl?: string) {
    const targetUrl = resolveUrl(url);
    try {
      const response = await axios.get(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 15000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        validateStatus: (status) => status < 500,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      });

      if (response.status >= 400) {
        console.warn(`[Scraper] Target returned ${response.status} for ${targetUrl}`);
        return {
          url: targetUrl,
          title: `Error ${response.status}`,
          description: `Target returned ${response.status}`,
          headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
          links: [],
          images: [],
          rawText: `Target returned ${response.status}`,
          isPdf: false
        };
      }

      const contentType = response.headers['content-type'] || '';
      
      // Handle PDF
      if (contentType.includes('application/pdf') || targetUrl.toLowerCase().endsWith('.pdf')) {
        const data = await pdf(Buffer.from(response.data));
        const rawText = data.text.replace(/\s+/g, " ").trim();
        const analysis = await analyzePdfContent(rawText);
        
        return {
          url: targetUrl,
          title: path.basename(targetUrl),
          description: "PDF Document",
          headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
          links: [],
          images: [],
          rawText,
          isPdf: true,
          country: analysis?.detectedCountry,
          pdfAnalysis: analysis
        };
      }

      // Handle Image (OCR)
      const isImage = contentType.startsWith('image/') || targetUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i) != null;
      if (isImage) {
        console.log(`[Scraper] Performing OCR on image: ${targetUrl}`);
        const base64Image = Buffer.from(response.data).toString('base64');
        
        try {
          let extractedData = { title: "No title found", fullContent: "No text found" };
          let apiUrl = ollamaApiUrl || process.env.OLLAMA_API_URL;

          if (typeof apiUrl === 'string') {
            apiUrl = apiUrl.trim();
          }

          let isValidUrl = false;
          if (apiUrl) {
            if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
              apiUrl = `http://${apiUrl}`;
            }
            try {
              new URL(apiUrl);
              isValidUrl = true;
            } catch (e) {
              console.warn(`[Scraper] Invalid Ollama URL: ${apiUrl}`);
            }
          }

          if (isValidUrl) {
            console.log(`[Scraper] Using local Ollama at ${apiUrl}`);
            const modelToUse = ollamaModel || process.env.OLLAMA_MODEL || 'llava';
            const ollamaResponse = await axios.post(`${apiUrl}/api/generate`, {
              model: modelToUse,
              prompt: "Extract all the text from this image. Maintain the original language and structure. Output the result as JSON containing two fields: 'title' (the main heading or title) and 'fullContent' (all the text found in the image).",
              images: [base64Image],
              stream: false,
              format: 'json'
            });
            
            if (ollamaResponse.data && ollamaResponse.data.response) {
              try {
                extractedData = JSON.parse(ollamaResponse.data.response);
              } catch (e) {
                console.error("Failed to parse JSON from Ollama response", e);
                extractedData.fullContent = ollamaResponse.data.response;
              }
            }
          } else {
            const aiResponse = await nvidia.chat.completions.create({
              model: "meta/llama-3.2-90b-vision-instruct",
              messages: [{
                role: "user", 
                content: [
                  { type: "text", text: "Extract all the text from this image. Maintain the original language and structure. Output the result as JSON containing two fields: 'title' (the main heading or title) and 'fullContent' (all the text found in the image)." },
                  { type: "image_url", image_url: { url: `data:${contentType || 'image/jpeg'};base64,${base64Image}` } }
                ]
              }],
              response_format: { type: "json_object" }
            });

            if (aiResponse.choices[0].message.content) {
              try {
                extractedData = JSON.parse(aiResponse.choices[0].message.content);
              } catch (e) {
                console.error("Failed to parse JSON from AI response", e);
              }
            }
          }

          return {
            url: targetUrl,
            title: extractedData.title,
            description: "Image Document (OCR - Full Content)",
            headings: { h1: [extractedData.title], h2: [], h3: [], h4: [], h5: [], h6: [] },
            links: [],
            images: [{ alt: extractedData.title, src: targetUrl }],
            rawText: extractedData.fullContent,
            isPdf: false
          };
        } catch (ocrError: any) {
          console.error(`[Scraper] OCR failed for ${targetUrl}:`, ocrError.message);
          throw new Error(`OCR failed: ${ocrError.message}`);
        }
      }

      // Handle HTML
      const html = Buffer.from(response.data).toString('utf-8');
      const $ = load(html);

      const title = $("title").text().trim() || "";
      const description = $('meta[name="description"]').attr("content") || 
                         $('meta[property="og:description"]').attr("content") || "";
      
      const headings: Record<string, string[]> = {
        h1: [], h2: [], h3: [], h4: [], h5: [], h6: []
      };
      ["h1", "h2", "h3", "h4", "h5", "h6"].forEach(tag => {
        $(tag).each((_, el) => {
          const text = $(el).text().trim();
          if (text) headings[tag].push(text);
        });
      });

      const links: { text: string; href: string }[] = [];
      $("a").each((_, el) => {
        const text = $(el).text().trim();
        const href = $(el).attr("href");
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          try {
            const absoluteUrl = new URL(href, targetUrl).toString();
            // Resolve recursive wrappers on discovered links too
            const resolvedAbsoluteUrl = resolveUrl(absoluteUrl);
            links.push({ text: text || href, href: resolvedAbsoluteUrl });
          } catch (e) {
            links.push({ text: text || href, href });
          }
        }
      });

      const images: { alt: string; src: string }[] = [];
      $("img").each((_, el) => {
        const alt = $(el).attr("alt") || "";
        const src = $(el).attr("src") || $(el).attr("data-src");
        if (src) {
          try {
            const absoluteSrc = new URL(src, targetUrl).toString();
            images.push({ alt, src: absoluteSrc });
          } catch (e) {
            images.push({ alt, src });
          }
        }
      });

      // Better text extraction using Readability
      let rawText = "";
      try {
        const dom = new JSDOM(html, { url: targetUrl });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        if (article && article.textContent) {
          rawText = article.textContent.replace(/\s+/g, " ").trim();
        }
        
        // If Readability stripped too much (e.g., directory of links), fall back to aggressive extraction
        if (rawText.length < 500) {
          $("script, style, nav, footer, header, noscript, ad").remove();
          
          // Preserve iframes (often used for embedded PDFs)
          $("iframe").each((_, el) => {
            const src = $(el).attr("src");
            if (src) {
              $(el).replaceWith(` [Embedded Content: ${src}] `);
            } else {
              $(el).remove();
            }
          });
          
          // Remove inline link injection since we now have a clean Links array
          
          rawText = $("body").text().replace(/\s+/g, " ").trim();
        }
      } catch (e) {
        console.warn("[Scraper] Readability failed, falling back to cheerio", e);
        $("script, style, nav, footer, header, noscript, ad").remove();
        
        $("iframe").each((_, el) => {
          const src = $(el).attr("src");
          if (src) {
            $(el).replaceWith(` [Embedded Content: ${src}] `);
          } else {
            $(el).remove();
          }
        });
        
        // Remove inline link injection since we now have a clean Links array
        
        rawText = $("body").text().replace(/\s+/g, " ").trim();
      }

      return {
        url: targetUrl,
        title,
        description,
        headings,
        links,
        images,
        rawText,
        isPdf: false
      };
    } catch (error: any) {
      console.error(`[Scraper] Error scraping ${targetUrl}:`, error.message);
      throw error;
    }
  }

  // --- Classification Dictionary & Workspace API Endpoints ---
  
  const DEFAULT_DICTIONARY_PATH = path.join(process.cwd(), "src", "default_dictionary.json");

  // Load the current active reference dictionary
  async function getActiveDictionary() {
    // 1. Try Supabase dictionary tables
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("classification_dictionary")
          .select("data")
          .eq("id", "active_dictionary")
          .single();
        if (data && data.data && !error) {
          return data.data;
        }
      } catch (e) {
        console.warn("[Dictionary] Supabase table load failed, falling back to local file:", e);
      }
    }

    // 2. Fallback to local default_dictionary.json
    try {
      if (fs.existsSync(DEFAULT_DICTIONARY_PATH)) {
        const content = fs.readFileSync(DEFAULT_DICTIONARY_PATH, "utf-8");
        return JSON.parse(content);
      }
    } catch (e) {
      console.error("[Dictionary] Failed to read local default_dictionary.json:", e);
    }

    // 3. Absolute failsafe inline representation
    return { grades: [], subjects: [], topics: [], allowedDocumentTypes: [] };
  }

  // GET Route to load active dictionary
  app.get("/api/dictionary", async (req, res) => {
    try {
      const dict = await getActiveDictionary();
      res.json(dict);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load dictionary" });
    }
  });

  // POST Route to save / sync dictionary
  app.post("/api/dictionary", async (req, res) => {
    try {
      const dictionaryData = req.body;
      
      // Save locally first
      fs.writeFileSync(DEFAULT_DICTIONARY_PATH, JSON.stringify(dictionaryData, null, 2), "utf-8");

      // Save/upsert to Supabase if configured
      if (supabase) {
        try {
          await supabase.from("classification_dictionary").upsert({
            id: "active_dictionary",
            data: dictionaryData,
            updated_at: new Date().toISOString()
          });
        } catch (e) {
          console.warn("[Dictionary] Sync with Supabase classification_dictionary table failed:", e);
        }
      }

      res.json({ success: true, message: "Dictionary updated successfully locally" });
    } catch (error: any) {
      console.error("[Dictionary Save Error]", error);
      res.status(500).json({ error: error.message || "Failed to save dictionary" });
    }
  });

  // POST Route for Gemini-powered reference classification
  app.post("/api/classify", async (req, res) => {
    const { title, url, text, topicFilter } = req.body;
    
    // Fallback names
    const safeTitleFromFilename = getSafeTitleFromFilename(title || url || "unnamed");
    const fallbackRenamePattern = `needs-review__${safeTitleFromFilename}.pdf`;

    // Dynamic logging for debugging
    console.log(`[Classify API] Initiated for title: "${title || ""}", url: "${url || ""}"`);

    // Dynamic default report structure
    let topicFilterReport: any = null;
    let allowedTopicIds: string[] = [];
    let resolvedTopicFilters: any = null;

    try {
      if (!title && !url) {
        return res.json({
          gradeId: null,
          subjectId: null,
          topicId: null,
          documentTypeId: null,
          isMatch: false,
          needsReview: true,
          status: "needs_review",
          reason: "Title or URL is required for classification",
          cleanTitle: "unnamed",
          renamePattern: "needs-review__unnamed.pdf",
          confidenceScore: 0,
          matchedTerms: [],
          matchedFields: []
        });
      }

      // Task 8: Check for malformed URL rejection
      if (url) {
        const urlValidation = isValidUrlSource(url);
        if (!urlValidation.valid) {
          console.warn(`[Classify API] Rejected URL: ${url} - ${urlValidation.reason}`);
          return res.json({
            gradeId: null,
            subjectId: null,
            topicId: null,
            documentTypeId: null,
            isMatch: false,
            needsReview: true,
            status: "needs_review",
            reason: urlValidation.reason || "Malformed or unsupported source URL",
            cleanTitle: safeTitleFromFilename,
            renamePattern: fallbackRenamePattern,
            confidenceScore: 0,
            matchedTerms: [],
            matchedFields: [],
            topicFilterReport
          });
        }
      }

      // Load active dictionary
      const activeDict = normalizeDictionary(await getActiveDictionary());

      // Task 3: Perform deterministic dictionary matching before Gemini
      const matchDict = matchAgainstDictionary({ title, url, text, topicFilter, dictionary: activeDict });
      console.log(`[Classify API] Deterministic dictionary match results:`, {
        matchedGrades: matchDict.matchedGrades.map(g => g.id),
        matchedSubjects: matchDict.matchedSubjects.map(s => s.id),
        matchedTopics: matchDict.matchedTopics.map(t => t.id),
        matchedDocTypes: matchDict.matchedDocTypes.map(d => d.id)
      });

      // Task 9: Detect document type before AI using filename/url
      const predetectedDocType = predetectDocumentType(title, url, activeDict.allowedDocumentTypes);
      console.log(`[Classify API] Predetected document type: ${predetectedDocType}`);

      // Task 4: Fix topic filter logic
      if (topicFilter && topicFilter.trim().length > 0) {
        resolvedTopicFilters = resolveTopicFiltersAgainstDictionary(topicFilter, activeDict);
        allowedTopicIds = resolvedTopicFilters.matchedTopics.map((t: any) => t.topicId);
        
        topicFilterReport = {
          rawFilters: topicFilter,
          matchedTopics: resolvedTopicFilters.matchedTopics,
          unmatchedFilters: resolvedTopicFilters.unmatchedFilters,
          expandedKeywords: resolvedTopicFilters.expandedKeywords
        };

        if (allowedTopicIds.length === 0) {
          console.warn(`[Classify API] Topic filter "${topicFilter}" has no dictionary matches.`);
          return res.json({
            gradeId: null,
            subjectId: null,
            topicId: null,
            documentTypeId: null,
            isMatch: false,
            needsReview: true,
            status: "needs_review",
            reason: "Topic filter did not match Supabase dictionary topics",
            cleanTitle: safeTitleFromFilename,
            renamePattern: fallbackRenamePattern,
            confidenceScore: 0,
            matchedTerms: matchDict.matchedTerms,
            matchedFields: matchDict.matchedFields,
            topicFilterReport
          });
        }
      }

      // Build specific AI hint constraints
      let topicFilterConstraint = "";
      if (allowedTopicIds.length > 0) {
        topicFilterConstraint = `\n
CRITICAL CONSTRAINT: The user has applied specific Topic Filters which matched these specific dictionary Topic IDs: ${JSON.stringify(allowedTopicIds)}.
You MUST ONLY choose a "topicId" from this set: ${JSON.stringify(allowedTopicIds)}. If the document matches none of these, set "topicId" to null and "isMatch" to false. Do not select any topicId outside this list.`;
      }

      // Pre-classification context to assist Gemini with match findings
      const matchingContextHint = `\nDETERMINISTIC ANALYSIS HINTS:
- Matching Grades in Dictionary: ${JSON.stringify(matchDict.matchedGrades.map(g => g.id))}
- Matching Subjects in Dictionary: ${JSON.stringify(matchDict.matchedSubjects.map(s => s.id))}
- Matching Topics in Dictionary: ${JSON.stringify(matchDict.matchedTopics.map(t => t.id))}
- Predetected Document Type: ${predetectedDocType ? `"${predetectedDocType}"` : "null"}`;

      const prompt = `You are a highly precise Moroccan school educational crawler & metadata classifier.
Analyze the following document's details:
Title: "${title || ""}"
URL: "${url || ""}"
Snippet from content / text: "${(text || "").substring(0, 1000)}"

YOUR TASK:
Classify this document structure strictly using the Provided Reference Classification Dictionary.${topicFilterConstraint}${matchingContextHint}

You MUST select EXACTLY ONE Grade ID, Subject ID, Topic ID, and Document Type ID only if they exist in the dictionary and correspond to the document context.
If the document does not match any subject or topic in our reference dictionary, or looks entirely unrelated to secondary school math/physics/svt, set "isMatch" to false.

REFERENCE CLASSIFICATION DICTIONARY:
${JSON.stringify(activeDict, null, 2)}

OUTPUT SCHEMA:
Return a JSON object containing:
1. "gradeId": (string or null) The ID of the matching grade level (e.g. "1ere_annee_college", "3eme_annee_college", etc.)
2. "subjectId": (string or null) The ID of the matching subject (e.g. "math", "pc", etc.)
3. "topicId": (string or null) The ID of the matching educational topic (e.g. "equations", "symmetry", etc.)
4. "documentTypeId": (string or null) The ID of the matching educational document type (e.g. "cours", "exercice", "summary_or_revision", "exam_compilation")
5. "isMatch": (boolean) true if the document belongs to first/second/third year middle school or BAC level math/science, relates to our dictionary, and is valid. Otherwise, false.
6. "reason": (string) Brief 1-sentence analytical justification.
7. "cleanTitle": (string) A beautiful, cleaned human-readable version of the title, removing website footprints (like "talamidi", "talamidi.com", "moutamadris", "PDF", timestamps, or spam suffixes). Keep it short (2-4 words, e.g., "Equations_Et_Inequations").
8. "renamePattern": (string) Suggested systematic file name using suffixes in format: "<Grade_Suffix>_<Subject_Suffix>_<Topic_Suffix>_<DocType_Suffix>_<CleanTitle>.pdf"
Example: "1AC_MATH_EQ_EX_Equations_Et_Inequations.pdf" (using the suffixes listed in the dictionary). If not matched, this can be original name.
9. "confidenceScore": (number, 0 to 1) Classifier confidence level in this match.

Make sure to respond strictly with valid JSON. Do not include any markdown block fences or conversational text outside of the JSON representation.`;

      // Call Gemini dynamically
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const resultText = response.text || "{}";

      // Task 2: Robust safe JSON parse for Gemini
      const classification = safeJsonParseJsonObject(resultText);
      if (!classification) {
        console.warn("[Classify API] Gemini returned invalid JSON:", resultText);
        return res.json({
          gradeId: null,
          subjectId: null,
          topicId: null,
          documentTypeId: null,
          isMatch: false,
          needsReview: true,
          status: "needs_review",
          reason: "AI returned invalid JSON; manual review required",
          cleanTitle: safeTitleFromFilename,
          renamePattern: fallbackRenamePattern,
          confidenceScore: 0,
          matchedTerms: matchDict.matchedTerms,
          matchedFields: matchDict.matchedFields,
          topicFilterReport
        });
      }

      let gradeId = classification.gradeId || null;
      let subjectId = classification.subjectId || null;
      let topicId = classification.topicId || null;
      let documentTypeId = classification.documentTypeId || null;
      let isMatch = !!classification.isMatch;
      let reason = classification.reason || "";
      let cleanTitle = classification.cleanTitle || title || "";
      let renamePattern = classification.renamePattern || title || "";
      let confidenceScore = typeof classification.confidenceScore === "number" ? classification.confidenceScore : (isMatch ? 0.8 : 0);

      // Task 12: Do deterministic validation after Gemini
      let validationFailed = false;
      let validationReason = "";

      if (gradeId !== null) {
        const exists = activeDict.grades.some((g: any) => g.id === gradeId);
        if (!exists) {
          validationFailed = true;
          validationReason = `Grade ID "${gradeId}" does not exist in dictionary.`;
        }
      }

      if (subjectId !== null) {
        const exists = activeDict.subjects.some((s: any) => s.id === subjectId);
        if (!exists) {
          validationFailed = true;
          validationReason = `Subject ID "${subjectId}" does not exist in dictionary.`;
        }
      }

      if (topicId !== null) {
        const matchedTopic = activeDict.topics.find((t: any) => t.id === topicId);
        if (!matchedTopic) {
          validationFailed = true;
          validationReason = `Topic ID "${topicId}" does not exist in dictionary.`;
        } else {
          if (subjectId !== null && matchedTopic.subjectId && matchedTopic.subjectId !== subjectId) {
            validationFailed = true;
            validationReason = `Topic ID "${topicId}" subjectId "${matchedTopic.subjectId}" mismatch with selected subjectId "${subjectId}".`;
          }
        }
      }

      // Check predetected or selected doc type
      if (documentTypeId !== null) {
        const exists = activeDict.allowedDocumentTypes.some((d: any) => d.id === documentTypeId);
        if (!exists) {
          validationFailed = true;
          validationReason = `Document Type ID "${documentTypeId}" does not exist in allowedDocumentTypes.`;
        }
      }

      if (topicFilter && topicFilter.trim().length > 0) {
        if (topicId !== null && !allowedTopicIds.includes(topicId)) {
          validationFailed = true;
          validationReason = `Classifier selected topic "${topicId}" outside Topic Filters / Supabase dictionary match.`;
        }
      }

      // If documentTypeId is null or mismatched but everything else is valid, mark needsReview instead of total failure
      let needsReview = !isMatch || validationFailed;
      let status = isMatch && !validationFailed ? "classified" : "needs_review";

      if (validationFailed) {
        console.warn(`[Classify Validation Failed] ${validationReason}`);
        return res.json({
          gradeId: null,
          subjectId: null,
          topicId: null,
          documentTypeId: null,
          isMatch: false,
          needsReview: true,
          status: "needs_review",
          reason: validationReason,
          cleanTitle: safeTitleFromFilename,
          renamePattern: fallbackRenamePattern,
          confidenceScore: 0,
          matchedTerms: matchDict.matchedTerms,
          matchedFields: matchDict.matchedFields,
          topicFilterReport
        });
      }

      // Return normal successful HTTP 200 representation with all reporting parameters
      return res.json({
        gradeId,
        subjectId,
        topicId,
        documentTypeId,
        isMatch,
        needsReview,
        status,
        reason: reason || "Successfully matching Supabase reference parameters",
        cleanTitle,
        renamePattern,
        confidenceScore,
        matchedTerms: matchDict.matchedTerms,
        matchedFields: matchDict.matchedFields,
        topicFilterReport
      });

    } catch (error: any) {
      // Task 1: Global fail-safe wrapping. Never throw 500 unless extreme server crash.
      console.error("[Classification Fail-Safe Handled]", error);
      return res.json({
        gradeId: null,
        subjectId: null,
        topicId: null,
        documentTypeId: null,
        isMatch: false,
        needsReview: true,
        status: "needs_review",
        reason: error.message || "Failed to parse/classify document pipeline fully",
        cleanTitle: safeTitleFromFilename,
        renamePattern: fallbackRenamePattern,
        confidenceScore: 0,
        matchedTerms: [],
        matchedFields: [],
        topicFilterReport
      });
    }
  });

  // POST Route to Combine/Merge multiple PDFs
  app.post("/api/combine-pdfs", async (req, res) => {
    try {
      const { urls } = req.body;
      if (!urls || !Array.isArray(urls) || urls.length < 2) {
        return res.status(400).json({ error: "At least 2 PDF URLs are required to combine." });
      }

      console.log(`[Combiner] Merging ${urls.length} PDFs into a single file...`);
      const mergedPdf = await PDFDocument.create();

      for (const pdfUrl of urls) {
        try {
          let pdfBytes: ArrayBuffer;
          if (pdfUrl.startsWith("file://")) {
            // Local fallback if we have a file path
            const filename = pdfUrl.substring(7);
            const localPath = path.join(process.cwd(), "downloads", filename);
            if (fs.existsSync(localPath)) {
              pdfBytes = fs.readFileSync(localPath);
            } else {
              throw new Error(`Local file not found: ${localPath}`);
            }
          } else {
            // Fetch remote URL
            const response = await axios.get(pdfUrl, { 
              responseType: "arraybuffer",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              },
              timeout: 15000 
            });
            pdfBytes = response.data;
          }

          const srcPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
          const copiedPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
          copiedPages.forEach((page) => mergedPdf.addPage(page));
        } catch (e: any) {
          console.error(`[Combiner] Skip merging failed URL: ${pdfUrl}`, e.message);
        }
      }

      const mergedPdfBytes = await mergedPdf.save();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=combined_workstation_export.pdf");
      res.send(Buffer.from(mergedPdfBytes));
    } catch (error: any) {
      console.error("[Combiner Error]", error);
      res.status(500).json({ error: error.message || "Failed to combine PDFs" });
    }
  });

  // POST Route to extract text from a remote PDF link directly on the server
  app.post("/api/parse-pdf", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "PDF URL is required" });
      }

      console.log(`[Parser] Extracting text from: ${url}`);
      let pdfBytes: ArrayBuffer;

      const response = await axios.get(url, { 
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 15000 
      });
      pdfBytes = response.data;

      const data = await pdf(Buffer.from(pdfBytes));
      const text = data.text.replace(/\s+/g, " ").trim();

      res.json({ text, title: path.basename(url) });
    } catch (error: any) {
      console.error("[Parser Error]", error);
      res.status(500).json({ error: error.message || "Failed to parse PDF text content" });
    }
  });

  // --- LOCAL-FIRST CURRICULUM PIPELINE SUPPORT AND HELPER PROCEDURES ---

  function cleanExtractedText(text: string): string {
    if (!text) return "";
    let cleaned = text;
    const patternsToRemove = [
      /تم تحميل هذا الملف من موقع/g,
      /موقع تلاميذي/g,
      /talamidi\.com/gi,
      /www\.talamidi\.com/gi,
      /Cours, Exercices, Examens corrigés/gi,
      /الموقع التربوي تلاميذي/g,
      /Talamidi/gi,
      /Moutamadris/gi,
      /moutamadris\.ma/gi
    ];
    patternsToRemove.forEach(pat => {
      cleaned = cleaned.replace(pat, "");
    });

    cleaned = cleaned.replace(/[ \t]+/g, " ");
    cleaned = cleaned.replace(/\n\s*\n/g, "\n\n");
    return cleaned.trim();
  }

  async function createCleanPdfCopy(params: {
    hash: string;
    grade_label: string;
    grade_slug: string;
    subject_label: string;
    subject_slug: string;
    topic_label: string;
    topic_slug: string;
    document_type_label: string;
    document_type_slug: string;
  }) {
    const originalPath = path.join(LOCAL_OUTPUT_DIR, "downloads", `${params.hash}.original.pdf`);
    if (!fs.existsSync(originalPath)) {
      throw new Error("Original PDF file not found locally");
    }

    const pdfBytes = fs.readFileSync(originalPath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    if (pages.length > 0) {
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();
      
      const safeMargin = height > 200 && width > 200;
      
      if (safeMargin) {
        const fontSize = 8;
        const opacity = 0.35;
        const color = rgb(0.5, 0.5, 0.5);

        // Stamp - Top-left
        firstPage.drawText("Levelspace", {
          x: 30,
          y: height - 20,
          size: fontSize,
          font: font,
          color: color,
          opacity: opacity
        });

        // Stamp - Top-right
        const rightLines = [
          `Grade: ${params.grade_label}`,
          `Subject: ${params.subject_label}`,
          `Topic: ${params.topic_label}`,
          `Type: ${params.document_type_label}`
        ];

        rightLines.forEach((line, index) => {
          firstPage.drawText(line, {
            x: width - 200,
            y: height - 20 - (index * 10),
            size: fontSize,
            font: font,
            color: color,
            opacity: opacity
          });
        });
      }
    }

    const cleanBytes = await pdfDoc.save();
    const shortHash = params.hash.substring(0, 8);
    const cleanName = `${params.grade_slug}__${params.subject_slug}__${params.topic_slug}__${params.document_type_slug}__${shortHash}.pdf`;
    const cleanPath = path.join(LOCAL_OUTPUT_DIR, "clean-pdfs", cleanName);
    
    fs.writeFileSync(cleanPath, cleanBytes);
    return { cleanPath, cleanName };
  }

  function saveDatasetRow(row: any) {
    const hash = row.hash;
    const jsonPath = path.join(LOCAL_OUTPUT_DIR, "dataset", `${hash}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(row, null, 2));

    const jsonLine = JSON.stringify(row) + "\n";
    const jsonlPath = path.join(LOCAL_OUTPUT_DIR, "dataset", "index.jsonl");
    fs.appendFileSync(jsonlPath, jsonLine);
  }

  // --- WORKSTATION PIPELINE ENDPOINTS ---

  app.post("/api/pipeline/parse", async (req, res) => {
    const { url, title, topicFilter } = req.body;
    const safeTitle = getSafeTitleFromFilename(title || url || "unnamed");
    const fallbackName = `needs-review__${safeTitle}.pdf`;

    try {
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      const urlCheck = isValidUrlSource(url);
      if (!urlCheck.valid) {
        updateReport("rejection-report.json", { url, reason: urlCheck.reason, title });
        return res.json({
          status: "rejected",
          reason: urlCheck.reason || "Malformed or unsupported source URL",
          cleanTitle: safeTitle,
          renamePattern: fallbackName,
          needsReview: true,
          isMatch: false
        });
      }

      let pdfBytes: Buffer;
      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 20000
        });
        pdfBytes = Buffer.from(response.data);
      } catch (dlErr: any) {
        updateReport("rejection-report.json", { url, reason: `Download failed: ${dlErr.message}`, title });
        return res.json({
          status: "failed",
          reason: `Download failed: ${dlErr.message}`,
          cleanTitle: safeTitle,
          renamePattern: fallbackName,
          needsReview: true,
          isMatch: false
        });
      }

      const hash = crypto.createHash("sha256").update(pdfBytes).digest("hex");
      
      const originalPath = path.join(LOCAL_OUTPUT_DIR, "downloads", `${hash}.original.pdf`);
      let isDuplicate = fs.existsSync(originalPath);
      if (!isDuplicate) {
        fs.writeFileSync(originalPath, pdfBytes);
      }

      let rawText = "";
      let extractionStatus: any = "text_extracted";
      let errorOccurred = false;
      let errorMsg = "";

      try {
        const parsed = await pdf(pdfBytes);
        rawText = parsed.text || "";
      } catch (parseErr: any) {
        errorOccurred = true;
        errorMsg = parseErr.message;
        extractionStatus = "extract_failed";
      }

      const textLen = rawText.trim().length;
      let textQualityScore = 0;

      if (textLen > 0) {
        const words = rawText.trim().split(/\s+/).filter(Boolean);
        const wordCount = words.length;
        const avgWordLen = textLen / (wordCount || 1);
        if (wordCount >= 20 && avgWordLen >= 3 && avgWordLen <= 12) {
          textQualityScore = Math.min(100, Math.round(40 + Math.min(60, wordCount / 5)));
        } else {
          textQualityScore = Math.max(10, Math.round(Math.min(50, wordCount * 2)));
        }
      }

      let needsOcr = false;
      let ocrStatus: any = "not_needed";

      if (errorOccurred) {
        needsOcr = true;
        ocrStatus = "needed";
        extractionStatus = "extract_failed";
      } else if (textLen < 100) {
        needsOcr = true;
        ocrStatus = "needed";
        extractionStatus = "needs_ocr";
      } else if (textLen >= 300 && textQualityScore >= 60) {
        needsOcr = false;
        ocrStatus = "not_needed";
        extractionStatus = "text_extracted";
      } else {
        needsOcr = false;
        ocrStatus = "not_needed";
        extractionStatus = "text_extracted";
      }

      const originalTextPath = path.join(LOCAL_OUTPUT_DIR, "text", `${hash}.original.txt`);
      fs.writeFileSync(originalTextPath, rawText);

      updateReport("extraction-report.json", {
        hash,
        url,
        title,
        textLen,
        textQualityScore,
        needsOcr,
        isDuplicate,
        extractionStatus
      });

      res.json({
        success: true,
        hash,
        isDuplicate,
        textSnippet: rawText.substring(0, 800),
        textLength: textLen,
        textQualityScore,
        needsOcr,
        ocrStatus,
        extractionStatus,
        originalFilename: path.basename(url || "unnamed.pdf")
      });

    } catch (err: any) {
      console.error("[Pipeline Parse Fatal Error]", err);
      res.json({
        success: false,
        error: err.message || "Failed to process parse pipeline stepping"
      });
    }
  });

  // --- OCR QUEUE STATE & ENGINES ---
  interface OcrQueueItem {
    jobId: string;
    pdfHash: string;
    originalName: string;
    url: string;
    status: "queued" | "running" | "waiting_delay" | "rate_limited" | "retrying" | "done" | "failed" | "paused";
    currentPage: number;
    totalPages: number;
    completedPages: number[];
    failedPages: number[];
    retryCount: number;
    delayCountdown: number;
    estimatedRemainingPages: number;
    quotaUsedToday: number;
    errorMessage?: string;
    updatedAt: string;
  }

  let queuedOcrItems: OcrQueueItem[] = [];
  let ocrConfig = {
    concurrency: parseInt(process.env.OCR_CONCURRENCY || "1"),
    delayBetweenPagesMs: parseInt(process.env.OCR_DELAY_BETWEEN_PAGES_MS || "8000"),
    delayBetweenPdfsMs: parseInt(process.env.OCR_DELAY_BETWEEN_PDFS_MS || "30000"),
    maxPagesPerPdf: parseInt(process.env.OCR_MAX_PAGES_PER_PDF || "30"),
    maxPdfsPerBatch: parseInt(process.env.OCR_MAX_PDFS_PER_BATCH || "5"),
    maxRetries: parseInt(process.env.OCR_MAX_RETRIES || "3"),
    backoffMultiplier: parseInt(process.env.OCR_BACKOFF_MULTIPLIER || "2"),
    dailyPageLimit: parseInt(process.env.OCR_DAILY_PAGE_LIMIT || "100"),
    isPaused: false
  };
  let quotaUsedTodayCounter = 0;
  let activeWorkerCount = 0;
  let masterQueueTimer: NodeJS.Timeout | null = null;

  function loadOcrProgress() {
    const progressPath = path.join(LOCAL_OUTPUT_DIR, "reports", "ocr-progress.json");
    if (fs.existsSync(progressPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(progressPath, "utf8"));
        if (Array.isArray(data)) {
          queuedOcrItems = data;
        } else if (typeof data === "object") {
          queuedOcrItems = Object.values(data);
        }
      } catch (e) {
        console.error("Error loading OCR progress:", e);
      }
    }
    updateQuotaUsedToday();
  }

  function updateQuotaUsedToday() {
    const todayStr = new Date().toISOString().substring(0, 10);
    let count = 0;
    queuedOcrItems.forEach(item => {
      if (item.updatedAt && item.updatedAt.substring(0, 10) === todayStr) {
        count += (item.completedPages || []).length;
      }
    });
    quotaUsedTodayCounter = count;
  }

  function saveOcrProgressLocally(itemToSave?: OcrQueueItem) {
    const progressPath = path.join(LOCAL_OUTPUT_DIR, "reports", "ocr-progress.json");
    const absolutePathAlt = "/scarpe-output/reports/ocr-progress.json";

    if (itemToSave) {
      const idx = queuedOcrItems.findIndex(i => i.pdfHash === itemToSave.pdfHash);
      if (idx !== -1) {
        queuedOcrItems[idx] = itemToSave;
      } else {
        queuedOcrItems.push(itemToSave);
      }
    }

    updateQuotaUsedToday();

    const fileData = JSON.stringify(queuedOcrItems, null, 2);
    try {
      fs.writeFileSync(progressPath, fileData);
    } catch (err) {
      console.error(`Failed writing to ${progressPath}:`, err);
    }

    try {
      const dir = path.dirname(absolutePathAlt);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(absolutePathAlt, fileData);
    } catch (err) {
      // ignore
    }
  }

  async function runOcrJob(item: OcrQueueItem) {
    item.status = "running";
    item.updatedAt = new Date().toISOString();
    saveOcrProgressLocally(item);

    const originalPath = path.join(LOCAL_OUTPUT_DIR, "downloads", `${item.pdfHash}.original.pdf`);
    if (!fs.existsSync(originalPath)) {
      item.status = "failed";
      item.errorMessage = "Original PDF not found locally.";
      saveOcrProgressLocally(item);
      return;
    }

    try {
      const pdfBytes = fs.readFileSync(originalPath);
      let srcDoc;
      try {
        srcDoc = await PDFDocument.load(pdfBytes);
      } catch {
        item.status = "failed";
        item.errorMessage = "Invalid PDF file bytes.";
        saveOcrProgressLocally(item);
        return;
      }

      const realPages = srcDoc.getPageCount();
      item.totalPages = Math.min(realPages, ocrConfig.maxPagesPerPdf);
      item.estimatedRemainingPages = item.totalPages - (item.currentPage || 0);
      saveOcrProgressLocally(item);

      for (let pNum = 1; pNum <= item.totalPages; pNum++) {
        if (ocrConfig.isPaused || (item.status as string) === "paused" || (item.status as string) === "failed") {
          break;
        }

        if (item.completedPages.includes(pNum)) {
          continue;
        }

        updateQuotaUsedToday();
        if (quotaUsedTodayCounter >= ocrConfig.dailyPageLimit) {
          item.status = "paused";
          item.errorMessage = `Daily page limit reached (${ocrConfig.dailyPageLimit}). Queue paused.`;
          saveOcrProgressLocally(item);
          ocrConfig.isPaused = true;
          break;
        }

        // Delay BEFORE OCR page
        item.status = "waiting_delay";
        let countdown = Math.ceil(ocrConfig.delayBetweenPagesMs / 1000);
        while (countdown > 0) {
          if (ocrConfig.isPaused || (item.status as string) === "paused" || (item.status as string) === "failed") {
            break;
          }
          item.delayCountdown = countdown;
          saveOcrProgressLocally(item);
          await new Promise(resolve => setTimeout(resolve, 1000));
          countdown--;
        }
        item.delayCountdown = 0;
        if (ocrConfig.isPaused || (item.status as string) === "paused" || (item.status as string) === "failed") {
          break;
        }

        item.status = "running";
        saveOcrProgressLocally(item);

        let pageBytes: Buffer;
        try {
          const subDoc = await PDFDocument.create();
          const [copiedPage] = await subDoc.copyPages(srcDoc, [pNum - 1]);
          subDoc.addPage(copiedPage);
          const pageSaved = await subDoc.save();
          pageBytes = Buffer.from(pageSaved);
        } catch (err: any) {
          item.failedPages.push(pNum);
          item.errorMessage = `Failed to extract page ${pNum}: ${err.message}`;
          saveOcrProgressLocally(item);
          continue;
        }

        let attempt = 1;
        let success = false;
        let pageText = "";

        while (attempt <= ocrConfig.maxRetries) {
          try {
            console.log(`[OCR Queue] Sending PDF page ${pNum}/${item.totalPages} for hash ${item.pdfHash} (Attempt ${attempt})`);
            const response = await ai.models.generateContent({
              model: "gemini-3.5-flash",
              contents: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: pageBytes.toString("base64")
                  }
                },
                `Extract all text from page ${pNum} using vision-native OCR. Return the plain text exactly as shown, preserving educational contents, exercises, formulas, Arabic and French headings, layout structures. Return text segment only.`
              ]
            });
            pageText = response.text || "";
            success = true;
            break;
          } catch (err: any) {
            const errMsg = err.message || "";
            const isRateLimit = errMsg.includes("429") || 
                               errMsg.toLowerCase().includes("quota exceeded") || 
                               errMsg.toLowerCase().includes("rate limit") || 
                               errMsg.toLowerCase().includes("resource exhausted") || 
                               errMsg.toLowerCase().includes("too many requests");

            if (isRateLimit && attempt < ocrConfig.maxRetries) {
              item.status = "rate_limited";
              item.retryCount = attempt;
              saveOcrProgressLocally(item);

              let waitSecs = Math.ceil((15000 * Math.pow(ocrConfig.backoffMultiplier, attempt)) / 1000);
              item.errorMessage = `Rate limited. Backing off for ${waitSecs}s.`;
              console.warn(`[OCR Queue] Rate limit hit on page ${pNum}. Retrying in ${waitSecs}s...`);

              let rateCountdown = waitSecs;
              while (rateCountdown > 0) {
                if (ocrConfig.isPaused || (item.status as string) === "paused" || (item.status as string) === "failed") break;
                item.delayCountdown = rateCountdown;
                saveOcrProgressLocally(item);
                await new Promise(resolve => setTimeout(resolve, 1000));
                rateCountdown--;
              }
              item.delayCountdown = 0;
              if (ocrConfig.isPaused || (item.status as string) === "paused" || (item.status as string) === "failed") {
                break;
              }
              item.status = "retrying";
              saveOcrProgressLocally(item);
              attempt++;
            } else {
              // Unrecoverable non-429 error or ran out of retries
              item.status = "failed";
              item.errorMessage = isRateLimit 
                ? "OCR paused because quota/rate limit was reached. Partial progress was saved." 
                : `Page ${pNum} failed: ` + (err.message || "Unknown API error");
              ocrConfig.isPaused = isRateLimit ? true : ocrConfig.isPaused;
              saveOcrProgressLocally(item);
              break;
            }
          }
        }

        if (!success) {
          break;
        }

        const pageTextPath = path.join(LOCAL_OUTPUT_DIR, "ocr", `${item.pdfHash}.page_${pNum}.txt`);
        fs.writeFileSync(pageTextPath, pageText);

        if (!item.completedPages.includes(pNum)) {
          item.completedPages.push(pNum);
        }
        item.currentPage = pNum;
        item.estimatedRemainingPages = item.totalPages - pNum;
        item.updatedAt = new Date().toISOString();

        let assembledText = "";
        for (let pCheck = 1; pCheck <= item.totalPages; pCheck++) {
          const pPath = path.join(LOCAL_OUTPUT_DIR, "ocr", `${item.pdfHash}.page_${pCheck}.txt`);
          if (fs.existsSync(pPath)) {
            assembledText += `--- PAGE ${pCheck} ---\n` + fs.readFileSync(pPath, "utf8") + "\n\n";
          }
        }
        fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "ocr", `${item.pdfHash}.ocr.txt`), assembledText);
        fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "text", `${item.pdfHash}.clean.txt`), cleanExtractedText(assembledText));

        saveOcrProgressLocally(item);
      }

      if (item.completedPages.length === item.totalPages) {
        item.status = "done";
        item.errorMessage = undefined;
        item.delayCountdown = 0;
        item.estimatedRemainingPages = 0;
        saveOcrProgressLocally(item);

        updateReport("ocr-report.json", {
          hash: item.pdfHash,
          rawOcrLen: item.totalPages * 500,
          cleanLen: item.totalPages * 400
        });

        const hasMore = queuedOcrItems.some(i => i.status === "queued" || i.status === "retrying");
        if (hasMore) {
          console.log(`[OCR Queue] PDF completed. Starting cross-PDF wait of ${ocrConfig.delayBetweenPdfsMs}ms...`);
          let pdfCountdown = Math.ceil(ocrConfig.delayBetweenPdfsMs / 1000);
          
          const nextJob = queuedOcrItems.find(i => i.status === "queued" || i.status === "retrying");
          if (nextJob) {
            nextJob.status = "waiting_delay";
            saveOcrProgressLocally(nextJob);
            
            while (pdfCountdown > 0) {
              if (ocrConfig.isPaused || (nextJob.status as string) === "paused" || (nextJob.status as string) === "failed") {
                break;
              }
              nextJob.delayCountdown = pdfCountdown;
              saveOcrProgressLocally(nextJob);
              await new Promise(resolve => setTimeout(resolve, 1000));
              pdfCountdown--;
            }
            nextJob.delayCountdown = 0;
            if ((nextJob.status as string) === "waiting_delay") {
              nextJob.status = "queued";
            }
            saveOcrProgressLocally(nextJob);
          }
        }
      } else {
        if ((item.status as string) !== "failed" && (item.status as string) !== "paused" && (item.status as string) !== "rate_limited") {
          item.status = "paused";
          saveOcrProgressLocally(item);
        }
      }

    } catch (fatalErr: any) {
      console.error("[OCR Queue Worker] Fatal Exception:", fatalErr);
      item.status = "failed";
      item.errorMessage = "Fatal: " + fatalErr.message;
      saveOcrProgressLocally(item);
    }
  }

  function startOcrQueueWorker() {
    if (masterQueueTimer) return;
    loadOcrProgress();

    masterQueueTimer = setInterval(async () => {
      if (ocrConfig.isPaused) return;
      if (activeWorkerCount >= ocrConfig.concurrency) return;

      const nextItem = queuedOcrItems.find(item => item.status === "queued" || item.status === "retrying");
      if (!nextItem) return;

      activeWorkerCount++;
      try {
        await runOcrJob(nextItem);
      } catch (err) {
        console.error("[OCR Worker Exception]", err);
      } finally {
        activeWorkerCount--;
      }
    }, 1000);
  }

  startOcrQueueWorker();

  app.post("/api/pipeline/ocr", async (req, res) => {
    const { hash } = req.body;
    if (!hash) {
      return res.status(400).json({ error: "Hash parameter is required" });
    }

    try {
      const originalPath = path.join(LOCAL_OUTPUT_DIR, "downloads", `${hash}.original.pdf`);
      if (!fs.existsSync(originalPath)) {
        return res.status(404).json({ error: "Original PDF not found locally to OCR" });
      }

      let job = queuedOcrItems.find(j => j.pdfHash === hash);
      if (!job) {
        job = {
          jobId: "ocr_" + crypto.randomBytes(4).toString("hex"),
          pdfHash: hash,
          originalName: "PDF " + hash.substring(0, 8),
          url: "",
          status: "queued",
          currentPage: 0,
          totalPages: 0,
          completedPages: [],
          failedPages: [],
          retryCount: 0,
          delayCountdown: 0,
          estimatedRemainingPages: 0,
          quotaUsedToday: 0,
          updatedAt: new Date().toISOString()
        };
        saveOcrProgressLocally(job);
      } else {
        job.status = "queued";
        job.errorMessage = undefined;
        saveOcrProgressLocally(job);
      }

      ocrConfig.isPaused = false;
      
      let waitCounter = 0;
      while (job.status !== "done" && job.status !== "failed" && waitCounter < 8) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCounter++;
        const refreshed = queuedOcrItems.find(j => j.pdfHash === hash);
        if (refreshed) job = refreshed;
      }

      const cleanPath = path.join(LOCAL_OUTPUT_DIR, "text", `${hash}.clean.txt`);
      const snippet = fs.existsSync(cleanPath) ? fs.readFileSync(cleanPath, "utf8").substring(0, 1000) : "";

      res.json({
        success: job.status === "done" || snippet.length > 0,
        ocrTextSnippet: snippet,
        ocrTextLength: snippet.length,
        status: job.status === "done" ? "ocr_done" : job.status,
        message: job.errorMessage
      });

    } catch (err: any) {
      console.error("[OCR API Route Compat Error]", err);
      res.json({
        success: false,
        error: err.message || "Failed to process single-hash compat OCR"
      });
    }
  });

  app.get("/api/pipeline/ocr/status", (req, res) => {
    updateQuotaUsedToday();
    res.json({
      success: true,
      queue: queuedOcrItems,
      config: ocrConfig,
      quotaUsedToday: quotaUsedTodayCounter
    });
  });

  app.post("/api/pipeline/ocr/config", (req, res) => {
    const {
      concurrency,
      delayBetweenPagesMs,
      delayBetweenPdfsMs,
      maxPagesPerPdf,
      maxPdfsPerBatch,
      maxRetries,
      backoffMultiplier,
      dailyPageLimit,
      isPaused
    } = req.body;

    if (concurrency !== undefined) ocrConfig.concurrency = Number(concurrency);
    if (delayBetweenPagesMs !== undefined) ocrConfig.delayBetweenPagesMs = Number(delayBetweenPagesMs);
    if (delayBetweenPdfsMs !== undefined) ocrConfig.delayBetweenPdfsMs = Number(delayBetweenPdfsMs);
    if (maxPagesPerPdf !== undefined) ocrConfig.maxPagesPerPdf = Number(maxPagesPerPdf);
    if (maxPdfsPerBatch !== undefined) ocrConfig.maxPdfsPerBatch = Number(maxPdfsPerBatch);
    if (maxRetries !== undefined) ocrConfig.maxRetries = Number(maxRetries);
    if (backoffMultiplier !== undefined) ocrConfig.backoffMultiplier = Number(backoffMultiplier);
    if (dailyPageLimit !== undefined) ocrConfig.dailyPageLimit = Number(dailyPageLimit);
    if (isPaused !== undefined) ocrConfig.isPaused = Boolean(isPaused);

    res.json({ success: true, config: ocrConfig });
  });

  app.post("/api/pipeline/ocr/enqueue", (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items array of shape { hash, title?, url? } is required" });
    }

    const enqueuedList: string[] = [];
    items.forEach(it => {
      let existing = queuedOcrItems.find(item => item.pdfHash === it.hash);
      if (existing) {
        existing.status = "queued";
        existing.errorMessage = undefined;
        if (it.title) existing.originalName = it.title;
        if (it.url) existing.url = it.url;
        existing.retryCount = 0;
        existing.updatedAt = new Date().toISOString();
        saveOcrProgressLocally(existing);
      } else {
        existing = {
          jobId: "ocr_" + crypto.randomBytes(4).toString("hex"),
          pdfHash: it.hash,
          originalName: it.title || "PDF " + it.hash.substring(0, 8),
          url: it.url || "",
          status: "queued",
          currentPage: 0,
          totalPages: 0,
          completedPages: [],
          failedPages: [],
          retryCount: 0,
          delayCountdown: 0,
          estimatedRemainingPages: 0,
          quotaUsedToday: 0,
          updatedAt: new Date().toISOString()
        };
        saveOcrProgressLocally(existing);
      }
      enqueuedList.push(existing.pdfHash);
    });

    ocrConfig.isPaused = false;
    res.json({ success: true, count: items.length, enqueued: enqueuedList });
  });

  app.post("/api/pipeline/ocr/pause", (req, res) => {
    ocrConfig.isPaused = true;
    queuedOcrItems.forEach(item => {
      if (item.status === "running" || item.status === "waiting_delay" || item.status === "retrying" || item.status === "queued" || item.status === "rate_limited") {
        item.status = "paused";
        item.delayCountdown = 0;
        saveOcrProgressLocally(item);
      }
    });
    res.json({ success: true, config: ocrConfig });
  });

  app.post("/api/pipeline/ocr/resume", (req, res) => {
    ocrConfig.isPaused = false;
    queuedOcrItems.forEach(item => {
      if (item.status === "paused") {
        item.status = "queued";
        saveOcrProgressLocally(item);
      }
    });
    res.json({ success: true, config: ocrConfig });
  });

  app.post("/api/pipeline/ocr/stop", (req, res) => {
    queuedOcrItems.forEach(item => {
      if (item.status === "queued" || item.status === "running" || item.status === "waiting_delay" || item.status === "rate_limited" || item.status === "retrying") {
        item.status = "paused";
        item.delayCountdown = 0;
        item.errorMessage = "Stopped by user batch actions.";
        saveOcrProgressLocally(item);
      }
    });
    ocrConfig.isPaused = true;
    res.json({ success: true, config: ocrConfig });
  });

  app.post("/api/pipeline/clean-copy", async (req, res) => {
    const {
      hash,
      gradeId,
      subjectId,
      topicId,
      documentTypeId,
      title,
      url,
      text
    } = req.body;

    if (!hash || !gradeId || !subjectId || !topicId || !documentTypeId) {
      return res.status(400).json({ error: "All classification inputs (hash, gradeId, subjectId, topicId, documentTypeId) are required" });
    }

    try {
      const activeDict = normalizeDictionary(await getActiveDictionary());
      const grade = activeDict.grades.find((g: any) => g.id === gradeId);
      const subject = activeDict.subjects.find((s: any) => s.id === subjectId);
      const topic = activeDict.topics.find((t: any) => t.id === topicId);
      const docType = activeDict.allowedDocumentTypes.find((d: any) => d.id === documentTypeId);

      if (!grade || !subject || !topic || !docType) {
        return res.status(400).json({ error: "One or more of selected metadata keys are missing from reference" });
      }

      const { cleanPath, cleanName } = await createCleanPdfCopy({
        hash,
        grade_label: grade.nameFr || grade.id,
        grade_slug: grade.suffix || grade.id,
        subject_label: subject.nameFr || subject.id,
        subject_slug: subject.suffix || subject.id,
        topic_label: topic.nameFr || topic.id,
        topic_slug: topic.suffix || topic.id,
        document_type_label: docType.nameFr || docType.id,
        document_type_slug: docType.suffix || docType.id
      });

      const cleanedTextContent = cleanExtractedText(text || "");

      const shortHash = hash.substring(0, 8);
      const datasetId = `${grade.suffix || grade.id}_${subject.suffix || subject.id}_${topic.suffix || topic.id}_${docType.suffix || docType.id}_${shortHash}`.toUpperCase();

      const datasetRow = {
        "$schema": "../../schemas/curriculum_asset_v1.schema.json",
        "id": datasetId,
        "hash": hash,
        "original_url": url || "",
        "classification": {
          "grade": gradeId,
          "subject": subjectId,
          "topic": topicId,
          "document_type": documentTypeId
        },
        "metadata": {
          "title_arabic": topic.nameAr || "",
          "title_french": topic.nameFr || "",
          "text_source": fs.existsSync(path.join(LOCAL_OUTPUT_DIR, "ocr", `${hash}.ocr.txt`)) ? "ocr_text" : "searchable_text",
          "original_filename": path.basename(url || "unnamed.pdf"),
          "cleaned_filename": cleanName,
          "num_pages": 1,
          "has_solutions": documentTypeId === "correction"
        },
        "content": {
          "raw_text_extracted": text || "",
          "cleaned_text": cleanedTextContent
        }
      };

      try {
        const originalFilePath = path.join(LOCAL_OUTPUT_DIR, "downloads", `${hash}.original.pdf`);
        if (fs.existsSync(originalFilePath)) {
          const originalBytes = fs.readFileSync(originalFilePath);
          const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
          datasetRow.metadata.num_pages = pdfDoc.getPageCount();
        }
      } catch (pageErr) {
        console.warn("[Clean Copy Page Count Warn]", pageErr);
      }

      saveDatasetRow(datasetRow);

      updateReport("clean-copy-report.json", {
        hash,
        cleanName,
        datasetId,
        stampApplied: "Top-Left (Levelspace) & Top-Right parameters"
      });

      updateReport("dataset-report.json", {
        datasetId,
        hash,
        cleanName,
        gradeId,
        subjectId,
        topicId,
        documentTypeId
      });

      res.json({
        success: true,
        cleanName,
        cleanPath,
        datasetId,
        datasetRow
      });

    } catch (err: any) {
      console.error("[Clean Copy Pipeline Error]", err);
      res.status(500).json({ error: err.message || "Failed to generate clean PDF copy" });
    }
  });

  app.get("/api/pipeline/reports", async (req, res) => {
    try {
      const downloadsDir = path.join(LOCAL_OUTPUT_DIR, "downloads");
      const cleanPdfsDir = path.join(LOCAL_OUTPUT_DIR, "clean-pdfs");
      const datasetDir = path.join(LOCAL_OUTPUT_DIR, "dataset");
      const reportsDir = path.join(LOCAL_OUTPUT_DIR, "reports");

      const countFiles = (dir: string, suffix: string) => {
        if (!fs.existsSync(dir)) return 0;
        return fs.readdirSync(dir).filter(f => f.endsWith(suffix)).length;
      };

      const originalCount = countFiles(downloadsDir, ".original.pdf");
      const cleanCount = countFiles(cleanPdfsDir, ".pdf");
      const datasetCount = countFiles(datasetDir, ".json");

      const loadReportFile = (name: string) => {
        const p = path.join(reportsDir, name);
        if (fs.existsSync(p)) {
          try {
            return JSON.parse(fs.readFileSync(p, "utf8"));
          } catch (e) {
            return [];
          }
        }
        return [];
      };

      res.json({
        stats: {
          originalDownloads: originalCount,
          cleanCopies: cleanCount,
          datasetRows: datasetCount,
          localRoot: LOCAL_OUTPUT_DIR
        },
        reports: {
          crawl: loadReportFile("crawl-report.json"),
          extraction: loadReportFile("extraction-report.json"),
          ocr: loadReportFile("ocr-report.json"),
          classification: loadReportFile("classification-report.json"),
          cleanCopy: loadReportFile("clean-copy-report.json"),
          rejection: loadReportFile("rejection-report.json"),
          dataset: loadReportFile("dataset-report.json")
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to aggregate statistics" });
    }
  });

  app.get("/api/pipeline/clean-text/:hash", (req, res) => {
    const { hash } = req.params;
    const cleanPath = path.join(LOCAL_OUTPUT_DIR, "text", `${hash}.clean.txt`);
    const originalPath = path.join(LOCAL_OUTPUT_DIR, "text", `${hash}.original.txt`);

    if (fs.existsSync(cleanPath)) {
      return res.send(fs.readFileSync(cleanPath, "utf8"));
    } else if (fs.existsSync(originalPath)) {
      return res.send(fs.readFileSync(originalPath, "utf8"));
    } else {
      return res.status(404).send("No extracted text found for this file.");
    }
  });

  app.get("/api/pipeline/download-clean/:hash", (req, res) => {
    const { hash } = req.params;
    const cleanPdfsDir = path.join(LOCAL_OUTPUT_DIR, "clean-pdfs");
    if (!fs.existsSync(cleanPdfsDir)) {
      return res.status(404).send("Clean output directory not found.");
    }

    const files = fs.readdirSync(cleanPdfsDir);
    const matchedFile = files.find(f => f.endsWith(`${hash.substring(0, 8)}.pdf`) || f.includes(hash));

    if (matchedFile) {
      const fullPath = path.join(cleanPdfsDir, matchedFile);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${matchedFile}`);
      return res.send(fs.readFileSync(fullPath));
    } else {
      return res.status(404).send("Clean PDF file copy not generated yet.");
    }
  });

  app.get("/api/pipeline/export-jsonl", (req, res) => {
    const jsonlPath = path.join(LOCAL_OUTPUT_DIR, "dataset", "index.jsonl");
    if (fs.existsSync(jsonlPath)) {
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", "attachment; filename=normalized_dataset.jsonl");
      return res.send(fs.readFileSync(jsonlPath, "utf8"));
    } else {
      return res.status(404).send("No dataset rows created yet.");
    }
  });

  // API Route for PDF Upload
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileBuffer = req.file.buffer;
      const fileName = req.file.originalname;

      if (req.file.mimetype === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        const data = await pdf(fileBuffer);
        const rawText = data.text.replace(/\s+/g, " ").trim();
        const analysis = await analyzePdfContent(rawText);
        
        const result = {
          url: `file://${fileName}`,
          title: fileName,
          description: "Uploaded PDF Document",
          headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
          links: [],
          images: [],
          rawText,
          isPdf: true,
          country: analysis?.detectedCountry,
          pdfAnalysis: analysis
        };
        return res.json(result);
      } else {
        return res.status(400).json({ error: "Only PDF files are currently supported for upload." });
      }
    } catch (error: any) {
      console.error("[Upload Error]", error);
      res.status(500).json({ error: error.message || "Failed to process uploaded file" });
    }
  });

  // API Route for crawling a site for PDFs
  app.post("/api/crawl-pdfs", async (req, res) => {
    const { url, maxPages = 50, maxDepth = 3, topicFilter } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const resolvedStartUrl = resolveUrl(url);
    console.log(`[Crawler] Starting PDF crawl on: ${resolvedStartUrl} (originally: ${url}, max pages: ${maxPages}, max depth: ${maxDepth})`);
    
    try {
      const activeDict = normalizeDictionary(await getActiveDictionary());
      console.log(`[Dictionary] Loaded active dictionary: ${activeDict.grades.length} grades, ${activeDict.subjects.length} subjects, ${activeDict.topics.length} topics`);

      let resolvedTopicFilters = null;
      let expandedFilterTerms: string[] = [];

      if (topicFilter && topicFilter.trim().length > 0) {
        resolvedTopicFilters = resolveTopicFiltersAgainstDictionary(topicFilter, activeDict);
        if (resolvedTopicFilters.matchedTopics.length === 0) {
          console.log(`[Crawler] Rejected because none of the filters in "${topicFilter}" matched dictionary topics.`);
          return res.json({
            crawled: 0,
            pdfs: [],
            rejected: true,
            reason: "No Topic Filters matched Supabase dictionary topics",
            unmatchedFilters: resolvedTopicFilters.unmatchedFilters
          });
        }
        expandedFilterTerms = resolvedTopicFilters.expandedKeywords.map(normalizeMatchText);
      }

      const startUrlObj = new URL(resolvedStartUrl);
      const baseUrl = startUrlObj.origin;
      const domain = startUrlObj.hostname;
      
      const visited = new Set<string>();
      const toVisit: { url: string; depth: number }[] = [{ url: resolvedStartUrl, depth: 0 }];
      const foundPdfs = new Set<string>();
      
      let pagesCrawled = 0;

      while (toVisit.length > 0 && pagesCrawled < maxPages) {
        const { url: currentUrl, depth } = toVisit.shift()!;
        
        if (visited.has(currentUrl) || depth > maxDepth) continue;
        visited.add(currentUrl);
        
        try {
          console.log(`[Crawler] Visiting [Depth ${depth}]: ${currentUrl}`);
          const response = await axios.get(currentUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            },
            timeout: 10000,
            validateStatus: (status) => status < 400,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          });
          
          pagesCrawled++;
          
          const contentType = (response.headers['content-type'] || '').toLowerCase();
          
          const checkTopicFilter = (u: string, linkText: string = "") => {
            if (!topicFilter || topicFilter.trim().length === 0) return true;
            if (expandedFilterTerms.length === 0) return false;
            
            const normUrl = normalizeMatchText(u);
            const normText = normalizeMatchText(linkText);
            
            for (const term of expandedFilterTerms) {
              if (normUrl.includes(term) || normText.includes(term)) {
                return true;
              }
            }
            console.log(`[Crawler] Rejected by dictionary topic filter: URL: "${u}" text: "${linkText}"`);
            return false;
          };

          // If the page itself is a PDF
          if (contentType.includes('application/pdf') || currentUrl.toLowerCase().endsWith('.pdf')) {
            if (checkTopicFilter(currentUrl)) {
              foundPdfs.add(currentUrl);
            }
            continue;
          }
          
          // Only parse HTML for more links
          if (!contentType.includes('text/html')) {
            continue;
          }
          
          const $ = load(response.data);
          
          $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            
            try {
              const absoluteUrl = new URL(href, currentUrl).href;
              const resolvedAbsoluteUrl = resolveUrl(absoluteUrl);
              const urlObj = new URL(resolvedAbsoluteUrl);
              
              // Clean URL (remove hash and query params that might cause loops)
              urlObj.hash = '';
              const cleanUrl = urlObj.href;
              const linkText = $(el).text();
              
              // 1. Check if it's a PDF
              if (cleanUrl.toLowerCase().endsWith('.pdf') || 
                  linkText.toLowerCase().includes('pdf') || 
                  $(el).attr('type') === 'application/pdf') {
                if (checkTopicFilter(cleanUrl, linkText)) {
                  foundPdfs.add(cleanUrl);
                }
              } 
              
              // 2. Check if it's an internal link to follow
              const isInternal = urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain);
              if (isInternal && !visited.has(cleanUrl) && depth < maxDepth) {
                // Skip obvious non-html files
                if (!cleanUrl.match(/\.(jpg|jpeg|png|gif|svg|css|js|zip|rar|mp4|mp3|wav|avi|doc|docx|xls|xlsx|ppt|pptx)$/i)) {
                   // Check if already in toVisit
                   if (!toVisit.some(v => v.url === cleanUrl)) {
                     toVisit.push({ url: cleanUrl, depth: depth + 1 });
                   }
                }
              }
            } catch (e) {
              // Invalid URL, ignore
            }
          });
          
          // Also check iframes and embeds for PDFs
          $('iframe, embed, object').each((_, el) => {
            const src = $(el).attr('src') || $(el).attr('data') || $(el).attr('href');
            if (src) {
              try {
                const absoluteUrl = new URL(src, currentUrl).href;
                if (absoluteUrl.toLowerCase().endsWith('.pdf') || absoluteUrl.includes('pdf')) {
                  if (checkTopicFilter(absoluteUrl)) {
                    foundPdfs.add(absoluteUrl);
                  }
                }
              } catch (e) {}
            }
          });

        } catch (err: any) {
          console.log(`[Crawler] Failed to fetch ${currentUrl}: ${err.message}`);
        }
      }
      
      console.log(`[Crawler] Finished. Crawled ${pagesCrawled} pages, found ${foundPdfs.size} PDFs.`);
      
      let topicFilterReport = null;
      if (topicFilter && topicFilter.trim().length > 0 && resolvedTopicFilters) {
        topicFilterReport = {
          rawFilters: resolvedTopicFilters.rawFilters,
          matchedTopics: resolvedTopicFilters.matchedTopics,
          unmatchedFilters: resolvedTopicFilters.unmatchedFilters,
          expandedKeywords: resolvedTopicFilters.expandedKeywords
        };
      }

      res.json({
        crawled: pagesCrawled,
        pdfs: Array.from(foundPdfs),
        topicFilterReport
      });
      
    } catch (error: any) {
      console.error(`[Crawler] Error:`, error);
      res.status(500).json({ error: `Crawler failed: ${error.message}` });
    }
  });

  // API Route for PDF Discovery & Filtering (Search API / Pasted URLs)
  app.post("/api/discover-pdfs", async (req, res) => {
    try {
      const { query, pastedUrls, topicFilter } = req.body;
      let urlsToProcess: string[] = [];

      if (pastedUrls && Array.isArray(pastedUrls)) {
        urlsToProcess = pastedUrls.filter((u: any) => typeof u === "string" && u.trim().length > 0);
      } else if (query && query.trim().length > 0) {
        console.log(`[Discover] Querying search grounding for: ${query}`);
        // Use gemini-3.5-flash as specified for text/search grounding tasks
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: `Find educational resources, articles, lessons, exams or direct PDF files related to the search query: "${query}". Specify the full direct URLs from legitimate sources and educational webpages starting with http or https.`,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (chunks && Array.isArray(chunks)) {
          for (const chunk of chunks) {
            if (chunk.web?.uri) {
              urlsToProcess.push(chunk.web.uri);
            }
          }
        }

        // Enrich by extracting any potential URLs found inside the generated response text itself
        const text = response.text || "";
        const urlRegex = /(https?:\/\/[^\s$,;?#()\[\]"']+)/g;
        let match;
        while ((match = urlRegex.exec(text)) !== null) {
          urlsToProcess.push(match[1]);
        }
      }

      // De-duplicate, resolve redirect trails, and normalize URLs
      urlsToProcess = Array.from(new Set(urlsToProcess.map(u => resolveUrl(u.trim()))));

      // Resolve topic filter against dictionary
      const activeDict = normalizeDictionary(await getActiveDictionary());
      let resolvedTopicFilters = null;
      let topicFilterMatched = false;
      let expandedFilterTerms: string[] = [];

      if (topicFilter && topicFilter.trim().length > 0) {
        resolvedTopicFilters = resolveTopicFiltersAgainstDictionary(topicFilter, activeDict);
        if (resolvedTopicFilters.matchedTopics.length > 0) {
          topicFilterMatched = true;
          expandedFilterTerms = resolvedTopicFilters.expandedKeywords.map(normalizeMatchText);
        }
      }

      const results = urlsToProcess.map(urlStr => {
        try {
          const validationInfo = isValidUrlSource(urlStr);
          if (!validationInfo.valid) {
            return {
              url: urlStr,
              isDirectPdf: false,
              accepted: false,
              reason: `Rejected: ${validationInfo.reason || "Malformed or unsupported source URL"}`
            };
          }

          const parsed = new URL(urlStr);
          const pathname = parsed.pathname.toLowerCase();
          const hostname = parsed.hostname.toLowerCase();

          const isDirectPdf = pathname.endsWith(".pdf");

          // Filter out obvious noise domains to satisfy criteria [App rejects unrelated links]
          const isNoisy = hostname.includes("facebook.com") || 
                          hostname.includes("twitter.com") || 
                          hostname.includes("instagram.com") || 
                          hostname.includes("youtube.com") || 
                          hostname.includes("linkedin.com") || 
                          hostname.includes("github.com") || 
                          hostname.includes("stackoverflow.com") || 
                          hostname.includes("npm") || 
                          hostname.includes("localhost") ||
                          hostname === "google.com" ||
                          hostname === "www.google.com";

          // Educational indicators (curriculum pathways, schools, pdf indicators)
          const isEduPage = hostname.includes("talamidi") || 
                            hostname.includes("moutamadris") || 
                            hostname.includes("alloschool") || 
                            pathname.includes("math") || 
                            pathname.includes("physique") || 
                            pathname.includes("cours") || 
                            pathname.includes("exerc") || 
                            pathname.includes("exam") || 
                            pathname.includes("pdf") ||
                            pathname.includes("download") ||
                            pathname.includes("drive.google.com");

          let accepted = false;
          let reason = "";

          // Apply strict user request matching rules
          if (topicFilter && topicFilter.trim().length > 0) {
            if (!topicFilterMatched) {
              accepted = false;
              reason = "Rejected: topic filters do not match Supabase dictionary";
            } else {
              // Filters matched, check if URL matches any expanded keyword
              const normUrl = normalizeMatchText(urlStr);
              let matchedTerm = false;
              for (const term of expandedFilterTerms) {
                if (normUrl.includes(term)) {
                  matchedTerm = true;
                  break;
                }
              }

              if (!matchedTerm) {
                accepted = false;
                reason = "Rejected: URL does not match any of the resolved topic keywords";
              } else {
                // If it matched, apply typical acceptance logic
                if (isDirectPdf) {
                  accepted = true;
                  reason = "Direct PDF document link detected";
                } else if (isNoisy) {
                  accepted = false;
                  reason = "Rejected: Noisy domain (social utility or search engine)";
                } else if (isEduPage) {
                  accepted = true;
                  reason = "Accepted: Educational domain or URL path parameter suggestive of academic documents";
                } else {
                  accepted = true;
                  reason = "Accepted: Link likely contains educational indexes or PDF downloads";
                }
              }
            }
          } else {
            // No topic filter applied
            if (isDirectPdf) {
              accepted = true;
              reason = "Direct PDF document link detected";
            } else if (isNoisy) {
              accepted = false;
              reason = "Rejected: Noisy domain (social utility or search engine)";
            } else if (isEduPage) {
              accepted = true;
              reason = "Accepted: Educational domain or URL path parameter suggestive of academic documents";
            } else {
              accepted = true;
              reason = "Accepted: Link likely contains educational indexes or PDF downloads";
            }
          }

          if (!accepted && topicFilter && topicFilterMatched) {
            console.log(`[Crawler] Rejected by dictionary topic filter: URL: "${urlStr}"`);
          }

          return {
            url: urlStr,
            isDirectPdf,
            accepted,
            reason
          };
        } catch (err) {
          return {
            url: urlStr,
            isDirectPdf: false,
            accepted: false,
            reason: "Rejected: Invalid malformed URL structure"
          };
        }
      });

      let topicFilterReport = null;
      if (topicFilter && topicFilter.trim().length > 0 && resolvedTopicFilters) {
        topicFilterReport = {
          rawFilters: resolvedTopicFilters.rawFilters,
          matchedTopics: resolvedTopicFilters.matchedTopics,
          unmatchedFilters: resolvedTopicFilters.unmatchedFilters,
          expandedKeywords: resolvedTopicFilters.expandedKeywords
        };
      }

      res.json({ results, topicFilterReport });
    } catch (err: any) {
      console.error("[Discover Error]", err);
      res.status(500).json({ error: err.message || "Failed during PDF discovery" });
    }
  });

  // API Route for scraping
  app.post("/api/scrape", async (req, res) => {
    const { url, deep = false, ollamaModel, ollamaApiUrl } = req.body;

    console.log(`[Scraper] Request to scrape: ${url} (Deep: ${deep})`);

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const mainResult = await scrapeUrl(url, true, ollamaModel, ollamaApiUrl);
      
      if (deep && !mainResult.isPdf) {
        // Deep scraping: follow first 10 internal links
        const internalLinks = mainResult.links
          .filter(l => l.href.startsWith(new URL(url).origin))
          .slice(0, 10);
        
        let extraText = "";
        for (const link of internalLinks) {
          try {
            console.log(`[Scraper] Deep scraping sub-page: ${link.href}`);
            const subResult = await scrapeUrl(link.href, false, ollamaModel, ollamaApiUrl);
            extraText += `\n\n--- Content from ${link.href} ---\n${subResult.rawText}`;
            saveToSupabase(subResult).catch(console.error); // Save individually
          } catch (e) {
            console.warn(`[Scraper] Failed to scrape sub-page ${link.href}`);
          }
        }
        mainResult.rawText += extraText;
      }

      saveToSupabase(mainResult).catch(console.error);

      res.json({
        ...mainResult,
        links: mainResult.links.slice(0, 200),
        images: mainResult.images.slice(0, 100),
        rawText: mainResult.rawText.substring(0, 100000), // Larger limit for deep/pdf
      });
    } catch (error: any) {
      res.status(500).json({ 
        error: `Failed to connect to ${url}. Details: ${error.message}` 
      });
    }
  });

  app.post("/api/scrape/extract-pdfs", async (req, res) => {
    try {
      const { url: rawUrl } = req.body;
      if (!rawUrl) return res.status(400).json({ error: "URL is required" });
      const url = resolveUrl(rawUrl);

      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        timeout: 15000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: (status) => status < 500
      });

      if (response.status === 404) {
        return res.json({ pdfLinks: [] });
      }

      const $ = load(response.data);
      const pdfLinks: { url: string; filtered: boolean; reason?: string }[] = [];
      const targetGrade = getMoutamadrisGrade(url);
      
      const addPdfLink = (href: string | undefined, elementText: string = "") => {
        if (href && (href.toLowerCase().includes('.pdf') || href.toLowerCase().includes('.zip') || href.toLowerCase().includes('drive.google.com') || href.toLowerCase().includes('facebook.com/l.php'))) {
          try {
            const absoluteUrl = resolveUrl(new URL(href, url).toString());
            
            // Apply Strict Educational Filter for Moutamadris
            if (url.includes('moutamadris.ma')) {
               if (!isStrictlyEducational(absoluteUrl, elementText, targetGrade)) {
                 return; // Silently skip if not strictly educational (courses/exercises)
               }
            } else {
              // Legacy filtering for other sites
              const decodedUrl = decodeURIComponent(absoluteUrl).toLowerCase();
              if (!/(cours|lesson|lecon|dars|درس|شرح|ملخص)/i.test(decodedUrl)) {
                return; 
              }
            }

            if (!pdfLinks.some(l => l.url === absoluteUrl)) {
              pdfLinks.push({ url: absoluteUrl, filtered: false });
            }
          } catch (e) {
            // Fallback for invalid URLs
          }
        }
      };

      $("a").each((_, el) => addPdfLink($(el).attr("href"), $(el).text()));
      $("iframe").each((_, el) => addPdfLink($(el).attr("src")));
      $("embed, object").each((_, el) => addPdfLink($(el).attr("src") || $(el).attr("data")));

      res.json({ pdfLinks: pdfLinks.map(l => l.url) });
    } catch (error: any) {
      console.error(`[PDF Extract] Error scraping ${req.body.url}:`, error.message);
      // Return empty array instead of 500 so batch download doesn't crash on a single bad link
      res.json({ pdfLinks: [] });
    }
  });

  app.post("/api/proxy-download", async (req, res) => {
    try {
      const { url: rawUrl } = req.body;
      if (!rawUrl) return res.status(400).json({ error: "URL is required" });
      const url = resolveUrl(rawUrl);

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 30000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: (status) => status < 500 // Don't throw for 404
      });

      if (response.status === 404) {
        return res.status(404).json({ error: "File not found on target server" });
      }

      res.set('Content-Type', response.headers['content-type'] || 'application/pdf');
      res.send(response.data);
    } catch (error: any) {
      console.error(`[Proxy Download] Error downloading ${req.body.url}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
  }

  // Specialized Moutamadris Scraper Endpoint
  app.post("/api/crawl-moutamadris", async (req, res) => {
    const { maxPages = 100, maxDepth = 3, topicFilter } = req.body;
    const START_URLS = [
      "https://moutamadris.ma/cours/",
      "https://moutamadris.ma/examens/",
      "https://moutamadris.ma/forod/",
    ];

    const CONTENT_PATTERNS = /\/(cours|exercice|exercise|td|tp|serie|correction|solution|درس|تمارين|شرح|ملخص)\//i;
    const BLOCKED_PDF_SOURCES = /(men\.gov\.ma|taalim\.ma|gov\.ma|ministere|insight[\-_]?guide|guide[\-_]?insight|officiel|bulletin[\-_]?officiel|BO[\-_]|\bbo\b)/i;
    const BLOCKED_PATH_PATTERNS = /\/(login|register|contact|about|team|privacy|terms|feedback|follow|support|help|msg|prof|students|orientation|concours|haraka|jodadat|ofppt|universite|bac-libre|service-en-ligne|notes|moutamadris-|taalim|massar|wp-admin|wp-login|cart|checkout|tag|author|page\/\d+|examen|examens|forod|controle|devoir|test|sujet|عطل|توجيه|توزيع)\//i;
    const BLOCKED_EXTENSIONS = /\.(jpg|jpeg|png|gif|svg|ico|css|js|xml|zip|rar|mp4|mp3)$/i;

    function isAllowedMoutamadris(url: string): { allowed: boolean; reason: string } {
      try {
        const parsed = new URL(url);
        if (!parsed.hostname.includes("moutamadris.ma")) return { allowed: false, reason: "external-domain" };
        
        const path = parsed.pathname.toLowerCase();
        if (BLOCKED_EXTENSIONS.test(path)) return { allowed: false, reason: "static-file" };

        if (url.toLowerCase().endsWith(".pdf")) {
          if (BLOCKED_PDF_SOURCES.test(url)) return { allowed: false, reason: "blocked-pdf-source" };
          if (!CONTENT_PATTERNS.test(path)) return { allowed: false, reason: "pdf-no-content-path" };
        }

        if (BLOCKED_PATH_PATTERNS.test(path + "/")) return { allowed: false, reason: "blocked-path" };
        if (!CONTENT_PATTERNS.test(path + "/")) return { allowed: false, reason: "no-content-pattern" };

        return { allowed: true, reason: "ok" };
      } catch (e) {
        return { allowed: false, reason: "invalid-url" };
      }
    }

    console.log(`[Moutamadris] Starting crawl (max pages: ${maxPages}, max depth: ${maxDepth})`);
    
    try {
      const visited = new Set<string>();
      const toVisit: { url: string; depth: number }[] = START_URLS.map(u => ({ url: u, depth: 0 }));
      const foundPdfs = new Set<string>();
      const results: any[] = [];
      
      let pagesCrawled = 0;

      while (toVisit.length > 0 && pagesCrawled < maxPages) {
        const { url: currentUrl, depth } = toVisit.shift()!;
        
        if (visited.has(currentUrl) || depth > maxDepth) continue;
        visited.add(currentUrl);
        
        const { allowed, reason } = isAllowedMoutamadris(currentUrl);
        if (!allowed && !START_URLS.includes(currentUrl)) {
          console.log(`[Moutamadris] Skip: ${reason} - ${currentUrl}`);
          continue;
        }

        try {
          console.log(`[Moutamadris] Visiting [Depth ${depth}]: ${currentUrl}`);
          const response = await axios.get(currentUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; LevelSpace-Bot/1.0; +https://levelespace.com/bot)",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            },
            timeout: 10000,
            validateStatus: (status) => status < 400,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          });
          
          pagesCrawled++;
          
          const contentType = (response.headers['content-type'] || '').toLowerCase();
          
          const checkTopicFilter = (u: string, linkText: string = "") => {
            if (!topicFilter) {
              // Fallback to strict moutamadris mode defaults
              const decodedFallback = decodeURIComponent(u).toLowerCase();
              return /(cours|lesson|lecon|dars|درس|شرح|ملخص|exercice|exercise|td|tp|serie|correction|solution|تمارين|فروض|فرض|devoir|forod|exam|examen)/i.test(decodedFallback);
            }
            const filterStr = topicFilter.toLowerCase();
            const decodedUrl = decodeURIComponent(u).toLowerCase();
            const textStr = linkText.toLowerCase();
            
            const keywords = filterStr.split(',').map((s: string) => s.trim()).filter(Boolean);
            if (keywords.length === 0) return true;
            
            for (const keyword of keywords) {
              if (decodedUrl.includes(keyword) || textStr.includes(keyword)) {
                return true;
              }
            }
            return false;
          };

          if (contentType.includes('application/pdf') || currentUrl.toLowerCase().endsWith('.pdf')) {
            if (checkTopicFilter(currentUrl)) {
              foundPdfs.add(currentUrl);
            }
            continue;
          }
          
          if (!contentType.includes('text/html')) continue;
          
          const $ = load(response.data);
          
          // Collect metadata for results
          results.push({
            url: currentUrl,
            title: $("title").text().trim(),
            isPdf: false
          });

          $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            
            try {
              const absoluteUrl = new URL(href, currentUrl).href;
              const urlObj = new URL(absoluteUrl);
              urlObj.hash = '';
              const cleanUrl = urlObj.href;
              const linkText = $(el).text();
              
              const { allowed: linkAllowed } = isAllowedMoutamadris(cleanUrl);
              
              if (cleanUrl.toLowerCase().endsWith('.pdf') || linkText.toLowerCase().includes('pdf') || $(el).attr('type') === 'application/pdf') {
                if (linkAllowed && checkTopicFilter(cleanUrl, linkText)) {
                  foundPdfs.add(cleanUrl);
                }
              } else if (linkAllowed && !visited.has(cleanUrl) && depth < maxDepth) {
                if (!toVisit.some(v => v.url === cleanUrl)) {
                  toVisit.push({ url: cleanUrl, depth: depth + 1 });
                }
              }
            } catch (e) {}
          });
          
          // Also check iframes/embeds
          $('iframe, embed, object').each((_, el) => {
            const src = $(el).attr('src') || $(el).attr('data') || $(el).attr('href');
            if (src) {
              try {
                const absoluteUrl = new URL(src, currentUrl).href;
                if (absoluteUrl.toLowerCase().endsWith('.pdf') || absoluteUrl.includes('pdf')) {
                  const { allowed: linkAllowed } = isAllowedMoutamadris(absoluteUrl);
                  if (linkAllowed && checkTopicFilter(absoluteUrl)) foundPdfs.add(absoluteUrl);
                }
              } catch (e) {}
            }
          });

        } catch (err: any) {
          console.log(`[Moutamadris] Failed to fetch ${currentUrl}: ${err.message}`);
        }
      }
      
      res.json({
        crawled: pagesCrawled,
        pdfs: Array.from(foundPdfs),
        results: results
      });
      
    } catch (error: any) {
      console.error(`[Moutamadris] Error:`, error);
      res.status(500).json({ error: `Moutamadris crawler failed: ${error.message}` });
    }
  });

  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
