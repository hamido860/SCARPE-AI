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

import JSZip from "jszip";
import { GoogleGenAI } from "@google/genai";
import { PDFDocument } from "pdf-lib";

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

    // collapse space/whitespace
    text = text.replace(/\s+/g, " ");
    return text;
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
    try {
      const { title, url, text, topicFilter } = req.body;
      if (!title && !url) {
        return res.status(400).json({ error: "Title or URL is required for classification" });
      }

      const activeDict = normalizeDictionary(await getActiveDictionary());

      let resolvedTopicFilters = null;
      let allowedTopicIds: string[] = [];
      if (topicFilter && topicFilter.trim().length > 0) {
        resolvedTopicFilters = resolveTopicFiltersAgainstDictionary(topicFilter, activeDict);
        allowedTopicIds = resolvedTopicFilters.matchedTopics.map((t: any) => t.topicId);
      }

      let topicFilterConstraint = "";
      if (allowedTopicIds.length > 0) {
        topicFilterConstraint = `\n
CRITICAL CONSTRAINT: The user has applied specific Topic Filters which matched these specific dictionary Topic IDs: ${JSON.stringify(allowedTopicIds)}.
You MUST ONLY choose a "topicId" from this set: ${JSON.stringify(allowedTopicIds)}. If the document matches none of these, set "topicId" to null and "isMatch" to false. Do not select any topicId outside this list.`;
      }

      const prompt = `You are a highly precise Moroccan school educational crawler & metadata classifier.
Analyze the following document's details:
Title: "${title || ""}"
URL: "${url || ""}"
Snippet from content / text: "${(text || "").substring(0, 1000)}"

YOUR TASK:
Classify this document structure strictly using the Provided Reference Classification Dictionary.${topicFilterConstraint}

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
Example: "1AC_MATH_EQ_EX_Equations_Et_Inequations.pdf" (using the suffixes listed in the dictionary). If not matched, this can be the original name.

Make sure to respond strictly with valid JSON. Do not include any markdown block fences or conversational text outside of the JSON representation.`;

      // Use gemini-3.5-flash as specified for text tasks
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const resultText = response.text || "{}";
      const classification = JSON.parse(resultText);

      let gradeId = classification.gradeId || null;
      let subjectId = classification.subjectId || null;
      let topicId = classification.topicId || null;
      let documentTypeId = classification.documentTypeId || null;
      let isMatch = !!classification.isMatch;
      let reason = classification.reason || "";
      let cleanTitle = classification.cleanTitle || title || "";
      let renamePattern = classification.renamePattern || title || "";

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

      if (validationFailed) {
        console.warn(`[Classify Validation Failed] ${validationReason}`);
        return res.json({
          gradeId: null,
          subjectId: null,
          topicId: null,
          documentTypeId: null,
          isMatch: false,
          reason: "Rejected: classification did not match Supabase dictionary constraints",
          cleanTitle: title,
          renamePattern: title
        });
      }

      res.json({
        gradeId,
        subjectId,
        topicId,
        documentTypeId,
        isMatch,
        reason,
        cleanTitle,
        renamePattern
      });
    } catch (error: any) {
      console.error("[Classification Error]", error);
      res.status(500).json({ error: error.message || "Failed to classify document" });
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
