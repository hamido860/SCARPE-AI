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
import { jsPDF } from "jspdf";
import { discoverPdfsFromInput } from "./src/utils/pdfDiscovery.js";
import { formatLevelspaceReviewTitle, formatLevelspaceSafeFilename } from "./src/utils/filenameGenerator.js";

// Initialize Supabase Client (if environment variables are present)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Local JSON file fallbacks for PDF management to handle missing Supabase tables/connections
const PDF_DOCS_STORE_PATH = path.join(process.cwd(), "pdf_documents_local.json");
const PDF_DRIVE_FILES_STORE_PATH = path.join(process.cwd(), "pdf_drive_files_local.json");

function getLocalPdfDocs(): any[] {
  try {
    if (fs.existsSync(PDF_DOCS_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(PDF_DOCS_STORE_PATH, "utf8"));
    }
  } catch (e) {
    console.error("Failed to read local PDF docs db:", e);
  }
  return [];
}

function saveLocalPdfDocs(docs: any[]) {
  try {
    fs.writeFileSync(PDF_DOCS_STORE_PATH, JSON.stringify(docs, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save local PDF docs db:", e);
  }
}

function getLocalDriveFiles(): any[] {
  try {
    if (fs.existsSync(PDF_DRIVE_FILES_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(PDF_DRIVE_FILES_STORE_PATH, "utf8"));
    }
  } catch (e) {
    console.error("Failed to read local drive files db:", e);
  }
  return [];
}

function saveLocalDriveFiles(files: any[]) {
  try {
    fs.writeFileSync(PDF_DRIVE_FILES_STORE_PATH, JSON.stringify(files, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save local drive files db:", e);
  }
}

// Initialize Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Robust helper to handle 429 rate / quota violations gracefully across all Gemini operations
async function callGeminiWithRetry(params: any, options = { maxRetries: 5, initialDelayMs: 2000, backoffFactor: 2 }) {
  let attempt = 1;
  while (true) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const errMsg = err.message || "";
      const isRateLimit = errMsg.includes("429") || 
                         errMsg.toLowerCase().includes("quota exceeded") || 
                         errMsg.toLowerCase().includes("rate limit") || 
                         errMsg.toLowerCase().includes("resource exhausted") || 
                         errMsg.toLowerCase().includes("too many requests") ||
                         JSON.stringify(err).toLowerCase().includes("quota");
                         
      if (isRateLimit && attempt <= options.maxRetries) {
        // Exponential backoff with random jitter (between 0.8 and 1.2 of expected delay)
        const delay = Math.round(
          options.initialDelayMs * Math.pow(options.backoffFactor, attempt - 1) * (0.8 + Math.random() * 0.4)
        );
        console.warn(`[Gemini Retry] Rate limit hit (429/quota). Attempt ${attempt}/${options.maxRetries}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { runMoutamadrisCrawl } from "./src/utils/moutamadrisCrawler.js";
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
        if (!Array.isArray(activeData)) {
          activeData = [];
        }
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

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

  function isJadhathaString(str: string): boolean {
    if (!str) return false;
    const s = String(str).toLowerCase();
    const normalized = normalizeMatchText(s);
    const jodadatKeywords = [
      "jodada", "jodadat", "jadhatha", "jadada", "jadadat",
      "جذاضه", "جذاذة", "جذاذات",
      "fiche pedagogique", "préparation pédagogique", "preparation pedagogique",
      "lesson plan", "teacher guide"
    ];
    return jodadatKeywords.some(kw => s.includes(kw) || normalized.includes(kw));
  }

  function isValidUrlSource(urlStr: string): { valid: boolean; reason?: string } {
    if (!urlStr) {
      return { valid: false, reason: "Malformed or unsupported source URL" };
    }
    const lowerUrl = urlStr.toLowerCase();
    if (lowerUrl.includes("cdn-cgi") || lowerUrl.includes("email-protection")) {
      return { valid: false, reason: "Bypassing Cloudflare diagnostic / email protection helper URLs" };
    }
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();
      if (host === "cours" || !host.includes(".")) {
        return { valid: false, reason: `Invalid hostname: ${host}` };
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

  function cleanServerTopicText(text: string): string {
    if (!text) return "";
    try {
      text = decodeURIComponent(text);
    } catch {}
    text = text.replace(/\.pdf$/i, "");
    const genericWords = [
      "cours", "exercice", "exercices", "corrige", "correction", "pdf", "fr", "ar", 
      "html", "lesson", "lecon", "dars", "serie", "solutions", "solution", "devoir", 
      "controle", "exam", "examen", "talamidi", "talamidi.com", "moutamadris", 
      "moutamadris.ma", "جميع", "دروس", "درس", "تمارين", "حلول", "تصحيح", "ملخص", 
      "فرض", "امتحان", "موقع", "تلاميذي", "تحميل", "الملف"
    ];
    const structuralLabels = [
      "1ac", "2ac", "3ac", "tcs", "1bac", "2bac", "math", "maths", 
      "mathematiques", "mathématiques", "pc", "physique", "chimie", "svt", 
      "french", "francais", "français"
    ];
    const words = text.split(/[\s\-_,.:;@+()\[\]{}'"’`|\\/]+/).filter(Boolean);
    const cleanedWords = words.filter(word => {
      const lw = word.toLowerCase().trim();
      if (genericWords.includes(lw) || structuralLabels.includes(lw)) {
        return false;
      }
      if (/^\d+$/.test(lw)) {
        return false;
      }
      return true;
    });
    if (cleanedWords.length === 0) return "";
    return cleanedWords.join("-");
  }

  function extractServerSource(url: string): string {
    if (!url) return "Source";
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const parts = hostname.replace("www.", "").split(".");
      const sld = parts.length > 1 ? parts[parts.length - 2] : parts[0];
      if (sld === "talamidi") return "Talamidi";
      if (sld === "moutamadris") return "Moutamadris";
      return sld.charAt(0).toUpperCase() + sld.slice(1);
    } catch {
      return "Source";
    }
  }

  function generateServerCurriculumFilename(params: {
    url: string;
    htmlTitle?: string;
    pdfTitle?: string;
    grade?: string;
    subject?: string;
    documentType?: string;
    fallbackSeq?: string;
  }) {
    const { url, htmlTitle, pdfTitle, grade, subject, documentType, fallbackSeq } = params;
    const urlLower = url.toLowerCase();

    let gradeCode = "1AC";
    if (grade) {
      const gClean = grade.toUpperCase().replace("_", "");
      if (["1AC", "2AC", "3AC", "TC", "1BAC", "2BAC"].includes(gClean)) {
        gradeCode = gClean;
      } else {
        gradeCode = gClean;
      }
    } else {
      if (urlLower.includes("1ac") || urlLower.includes("1ere_annee_college") || urlLower.includes("الأولى إعدادي")) gradeCode = "1AC";
      else if (urlLower.includes("2ac") || urlLower.includes("2eme_annee_college") || urlLower.includes("الثانية إعدادي")) gradeCode = "2AC";
      else if (urlLower.includes("3ac") || urlLower.includes("3eme_annee_college") || urlLower.includes("الثالثة إعدادي")) gradeCode = "3AC";
    }

    let subjectCode = "Math";
    if (subject) {
      const sLower = subject.toLowerCase();
      if (sLower.includes("math")) subjectCode = "Math";
      else if (sLower.includes("pc") || sLower.includes("physique") || sLower.includes("chimie")) subjectCode = "PC";
      else if (sLower.includes("svt")) subjectCode = "SVT";
      else if (sLower.includes("francais") || sLower.includes("français") || sLower.includes("french")) subjectCode = "French";
    }

    let docTypeSegment = "Cours";
    const rawFile = (url.split("/").pop() || "").toLowerCase();
    const rawTitle = (htmlTitle || "").toLowerCase();
    const checkDocType = (documentType || rawFile || rawTitle).toLowerCase();

    if (checkDocType.includes("corrige") || checkDocType.includes("corrigé") || checkDocType.includes("correction") || checkDocType.includes("solution") || checkDocType.includes("تصحيح") || checkDocType.includes("حلول") || checkDocType.includes("حل")) {
      docTypeSegment = "Correction";
    } else if (checkDocType.includes("exercice") || checkDocType.includes("exercise") || checkDocType.includes("serie") || checkDocType.includes("سلسلة") || checkDocType.includes("تمارين")) {
      docTypeSegment = "Exercices";
    } else if (checkDocType.includes("resume") || checkDocType.includes("résumé") || checkDocType.includes("summary") || checkDocType.includes("ملخص")) {
      docTypeSegment = "Resume";
    } else if (checkDocType.includes("devoir") || checkDocType.includes("فرض")) {
      docTypeSegment = "Devoir";
    } else if (checkDocType.includes("controle") || checkDocType.includes("contrôle") || checkDocType.includes("examen") || checkDocType.includes("امتحان")) {
      docTypeSegment = "Controle";
    }

    let extractedTopic = "";
    let urlTopicCandidate = "";
    try {
      const parsedUrl = new URL(url);
      const pathname = decodeURIComponent(parsedUrl.pathname);
      const pathSegments = pathname.split("/").filter(Boolean);
      const isLastSegmentFile = pathSegments[pathSegments.length - 1]?.toLowerCase().endsWith(".pdf");
      const searchSegments = isLastSegmentFile ? pathSegments.slice(0, pathSegments.length - 1) : pathSegments;
      
      const ignoredSegments = new Set([
        "college", "1ac", "2ac", "3ac", "tc", "1bac", "2bac", "math", "mathematiques", "mathématiques", 
        "pc", "physique", "chimie", "svt", "french", "francais", "français", "talamidi", "talamidi.com", 
        "cours", "exercices", "exercice", "correction", "corrige", "corrigé", "pdf", "maroc"
      ]);

      for (let i = searchSegments.length - 1; i >= 0; i--) {
        const seg = searchSegments[i];
        const cleaned = cleanServerTopicText(seg);
        if (cleaned && !ignoredSegments.has(seg.toLowerCase())) {
          urlTopicCandidate = cleaned;
          break;
        }
      }
    } catch {}

    if (urlTopicCandidate) {
      extractedTopic = urlTopicCandidate;
    } else if (htmlTitle) {
      const cleanedHtml = cleanServerTopicText(htmlTitle);
      if (cleanedHtml) extractedTopic = cleanedHtml;
    }

    if (!extractedTopic) {
      const filenameFromUrl = url.split("/").pop() || "";
      const matchNum = url.match(/_(\d+)\.pdf/i) || url.match(/[_-](\d+)/) || filenameFromUrl.match(/[_-](\d+)/);
      const seqNum = matchNum ? matchNum[1].padStart(2, "0") : (fallbackSeq || "01");
      extractedTopic = `Sequence-${seqNum}`;
    }

    const sourceSegment = extractServerSource(url);
    const sanitizeSegment = (text: string) => {
      return text
        .trim()
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/[\s\-_]+/g, "-")
        .replace(/-+/g, "-");
    };

    const finalTopic = sanitizeSegment(extractedTopic);
    let finalFilename = `${gradeCode}_${subjectCode}_${finalTopic}_${docTypeSegment}_${sourceSegment}.pdf`;

    // Prevent filenames starting with -_-_ or other special prefix symbols
    finalFilename = finalFilename.replace(/^[-_\s]+/, "");

    if (finalFilename.length > 140) {
      const extension = ".pdf";
      const availableLength = 140 - extension.length;
      const prefix = `${gradeCode}_${subjectCode}_`;
      const suffix = `_${docTypeSegment}_${sourceSegment}`;
      const overage = finalFilename.length - 140;
      if (finalTopic.length > overage) {
        const shortenedTopic = finalTopic.substring(0, finalTopic.length - overage);
        finalFilename = `${prefix}${shortenedTopic}${suffix}${extension}`;
      } else {
        finalFilename = finalFilename.substring(0, availableLength) + extension;
      }
    }

    return {
      filename: finalFilename,
      extractedTopic: finalTopic,
      documentType: docTypeSegment
    };
  }

  function extractMetadataFromUrlAndFilename(urlStr: string, originalName: string) {
    let sourceDomain = "";
    let sourceSite = "";
    let pathSegments: string[] = [];
    let decodedUrlPath = "";
    let filename = originalName || "";

    try {
      if (urlStr) {
        // Simple manual or URL based domain and path parsing
        let parsedUrl: URL | null = null;
        try {
          parsedUrl = new URL(urlStr);
          sourceDomain = parsedUrl.hostname.toLowerCase();
          decodedUrlPath = decodeURIComponent(parsedUrl.pathname);
        } catch {
          // If URL fails standard parsing but has http/https, let's try string ops
          const withoutProto = urlStr.replace(/^(https?:\/\/)?(www\.)?/, "");
          const slashIdx = withoutProto.indexOf("/");
          if (slashIdx !== -1) {
            sourceDomain = withoutProto.substring(0, slashIdx).toLowerCase();
            decodedUrlPath = decodeURIComponent(withoutProto.substring(slashIdx));
          } else {
            sourceDomain = withoutProto.toLowerCase();
            decodedUrlPath = "";
          }
        }

        const domainParts = sourceDomain.split(".");
        sourceSite = domainParts.length > 2 ? domainParts[domainParts.length - 2] : domainParts[0];
        
        // Ensure pathSegments are clean and decoded
        pathSegments = decodedUrlPath.split("/").filter(Boolean);
        
        // If filename is missing or unnamed, fallback to last segment
        if (!filename || filename === "unnamed" || filename.includes("/") || filename.includes("\\")) {
          filename = pathSegments[pathSegments.length - 1] || originalName || "unnamed.pdf";
        }
      }
    } catch (e) {
      console.error("[extractMetadataFromUrlAndFilename] Error parsing URL:", e);
    }

    const lowerPath = decodedUrlPath.toLowerCase();
    const lowerFile = filename.toLowerCase();
    const lowerCombined = `${lowerPath} ${lowerFile}`;

    let gradeHint = null;
    let gradeSlug = null;
    let sourceGradeRaw = "";

    // 1AC / 2AC / 3AC = grade hint
    if (lowerCombined.includes("1ac") || lowerCombined.includes("1ere_annee_college") || lowerCombined.includes("1ere annee") || lowerCombined.includes("الأولى إعدادي") || lowerCombined.includes("الاولى اعدادي")) {
      gradeHint = "1AC";
      gradeSlug = "1ere_annee_college";
      sourceGradeRaw = "1AC";
    } else if (lowerCombined.includes("2ac") || lowerCombined.includes("2eme_annee_college") || lowerCombined.includes("2eme annee") || lowerCombined.includes("الثانية إعدادي") || lowerCombined.includes("الثانية اعدادي")) {
      gradeHint = "2AC";
      gradeSlug = "2eme_annee_college";
      sourceGradeRaw = "2AC";
    } else if (lowerCombined.includes("3ac") || lowerCombined.includes("3eme_annee_college") || lowerCombined.includes("3eme annee") || lowerCombined.includes("الثالثة إعدادي") || lowerCombined.includes("الثالثة اعدادي")) {
      gradeHint = "3AC";
      gradeSlug = "3eme_annee_college";
      sourceGradeRaw = "3AC";
    } else if (lowerCombined.includes("tcs") || lowerCombined.includes("tc") || lowerCombined.includes("tronc_commun") || lowerCombined.includes("الجذع المشترك")) {
      gradeHint = "TC";
      gradeSlug = "tronc_commun";
      sourceGradeRaw = "TC";
    } else if (lowerCombined.includes("1bac") || lowerCombined.includes("1ere_bac") || lowerCombined.includes("1ere-bac") || lowerCombined.includes("الأولى بكالوريا") || lowerCombined.includes("الاولى بكالوريا") || lowerCombined.includes("أولى باك") || lowerCombined.includes("اولى باك") || lowerCombined.includes("الاولى باك") || lowerCombined.includes("الاولى-باك")) {
      gradeHint = "1BAC";
      gradeSlug = "1ere_bac";
      sourceGradeRaw = "1BAC";
    } else if (lowerCombined.includes("2bac") || lowerCombined.includes("2eme_bac") || lowerCombined.includes("2eme-bac") || lowerCombined.includes("الثانية بكالوريا") || lowerCombined.includes("الثانية باك") || lowerCombined.includes("الثانية-باك") || lowerCombined.includes("2ème_bac")) {
      gradeHint = "2BAC";
      gradeSlug = "2eme_bac";
      sourceGradeRaw = "2BAC";
    }

    // Additional path-based grade hint extraction for safety
    for (const segment of pathSegments) {
      const segLower = segment.toLowerCase();
      if (segLower === "1ac") {
        gradeHint = "1AC";
        gradeSlug = "1ere_annee_college";
        sourceGradeRaw = segment;
      } else if (segLower === "2ac") {
        gradeHint = "2AC";
        gradeSlug = "2eme_annee_college";
        sourceGradeRaw = segment;
      } else if (segLower === "3ac") {
        gradeHint = "3AC";
        gradeSlug = "3eme_annee_college";
        sourceGradeRaw = segment;
      }
    }

    let subjectHint = null;
    let subjectSlug = null;
    let sourceSubjectRaw = "";

    // Mathématiques / math = subject hint
    if (lowerCombined.includes("math") || lowerCombined.includes("رياضيات") || lowerCombined.includes("الرياضيات")) {
      subjectHint = "math";
      subjectSlug = "math";
      sourceSubjectRaw = "Mathématiques";
    } else if (lowerCombined.includes("physique") || lowerCombined.includes("chimie") || lowerCombined.includes(" pc ") || lowerCombined.includes("pc_") || lowerCombined.includes("_pc") || lowerCombined.includes("فيزياء")) {
      subjectHint = "pc";
      subjectSlug = "pc";
      sourceSubjectRaw = "Physique-Chimie";
    } else if (lowerCombined.includes("svt") || lowerCombined.includes("علوم الحياة")) {
      subjectHint = "svt";
      subjectSlug = "svt";
      sourceSubjectRaw = "SVT";
    } else if (lowerCombined.includes("francais") || lowerCombined.includes("français") || lowerCombined.includes("french") || lowerCombined.includes("الفرنسية")) {
      subjectHint = "french";
      subjectSlug = "french";
      sourceSubjectRaw = "Français";
    }

    // Additional path-based subject hint extraction
    for (const segment of pathSegments) {
      const segLower = segment.toLowerCase();
      if (segLower === "math" || segLower === "mathematiques" || segLower === "mathématiques") {
        subjectHint = "math";
        subjectSlug = "math";
        sourceSubjectRaw = segment;
      } else if (segLower === "pc" || segLower.includes("physique")) {
        subjectHint = "pc";
        subjectSlug = "pc";
        sourceSubjectRaw = segment;
      } else if (segLower === "svt") {
        subjectHint = "svt";
        subjectSlug = "svt";
        sourceSubjectRaw = segment;
      } else if (segLower.includes("francais") || segLower.includes("français")) {
        subjectHint = "french";
        subjectSlug = "french";
        sourceSubjectRaw = segment;
      }
    }

    let documentTypeHint = null;
    let documentTypeSlug = null;
    let sourceDocumentTypeRaw = "";

    // Parse document types from filename
    // - filename Cours = cours
    // - Exercice = exercice
    // - Corrige/Corrigé = correction
    // - Jodada/Jodadat/جذاذة/جذاذات = jadhatha
    // - Forod/فرض/فروض/Controle/Devoir = assessment
    if (lowerFile.includes("cours") || lowerFile.includes("lesson") || lowerFile.includes("lecon") || lowerFile.includes("درس") || lowerFile.includes("dars")) {
      documentTypeHint = "cours";
      documentTypeSlug = "cours";
      sourceDocumentTypeRaw = "Cours";
    } else if (lowerFile.includes("exercice") || lowerFile.includes("exercise") || lowerFile.includes("serie") || lowerFile.includes("تمارين") || lowerFile.includes("سلسلة")) {
      documentTypeHint = "exercice";
      documentTypeSlug = "exercice";
      sourceDocumentTypeRaw = "Exercice";
    } else if (lowerFile.includes("corrige") || lowerFile.includes("corrigé") || lowerFile.includes("correction") || lowerFile.includes("solution") || lowerFile.includes("حل") || lowerFile.includes("حلول")) {
      documentTypeHint = "correction";
      documentTypeSlug = "exercice"; // correction matches exercice in standard dictionary
      sourceDocumentTypeRaw = "Correction";
    } else if (isJadhathaString(lowerFile)) {
      documentTypeHint = "jadhatha";
      documentTypeSlug = "jadhatha";
      sourceDocumentTypeRaw = "Jadhatha";
    } else if (lowerFile.includes("forod") || lowerFile.includes("فرض") || lowerFile.includes("فروض") || lowerFile.includes("controle") || lowerFile.includes("devoir") || lowerFile.includes("exam") || lowerFile.includes("examen") || lowerFile.includes("امتحان")) {
      documentTypeHint = "assessment";
      documentTypeSlug = "exam_compilation";
      sourceDocumentTypeRaw = "Devoir/Examen";
    }

    // Default fallbacks using the remainder of path if still empty
    if (!documentTypeHint) {
      if (lowerPath.includes("cours") || lowerPath.includes("lesson") || lowerPath.includes("lecon") || lowerPath.includes("درس") || lowerPath.includes("dars")) {
        documentTypeHint = "cours";
        documentTypeSlug = "cours";
        sourceDocumentTypeRaw = "Cours";
      } else if (lowerPath.includes("exercice") || lowerPath.includes("exercise") || lowerPath.includes("serie") || lowerPath.includes("تمارين") || lowerPath.includes("سلسلة")) {
        documentTypeHint = "exercice";
        documentTypeSlug = "exercice";
        sourceDocumentTypeRaw = "Exercice";
      } else if (lowerPath.includes("corrige") || lowerPath.includes("corrigé") || lowerPath.includes("correction") || lowerPath.includes("solution") || lowerPath.includes("حل") || lowerPath.includes("حلول")) {
        documentTypeHint = "correction";
        documentTypeSlug = "exercice";
        sourceDocumentTypeRaw = "Correction";
      } else if (isJadhathaString(lowerPath)) {
        documentTypeHint = "jadhatha";
        documentTypeSlug = "jadhatha";
        sourceDocumentTypeRaw = "Jadhatha";
      } else if (lowerPath.includes("forod") || lowerPath.includes("فرض") || lowerPath.includes("فروض") || lowerPath.includes("controle") || lowerPath.includes("devoir") || lowerPath.includes("exam") || lowerPath.includes("examen") || lowerPath.includes("امتحان")) {
        documentTypeHint = "assessment";
        documentTypeSlug = "exam_compilation";
        sourceDocumentTypeRaw = "Devoir/Examen";
      }
    }

    // Extract topicHint: folder/topic name = topic hint
    // We filter out common structural directories to find the real topic name.
    let topicHint = null;
    let sourceTopicRaw = "";
    
    const ignoredSegments = new Set([
      "college", "1ac", "2ac", "3ac", "math", "mathematiques", "mathématiques", "pc", "physique", "chimie", "svt", "french", "francais", "français", "talamidi", "talamidi.com", "cours", "exercices"
    ]);

    const candidateTopicSegments = pathSegments.filter(seg => {
      const cleanSeg = seg.toLowerCase().trim();
      if (ignoredSegments.has(cleanSeg)) return false;
      if (cleanSeg.endsWith(".pdf")) return false;
      return true;
    });

    if (candidateTopicSegments.length > 0) {
      // Choose the last or deep segment as the topic hint
      const rawTopic = candidateTopicSegments[candidateTopicSegments.length - 1];
      // Format topic to space strings nicely
      topicHint = rawTopic.replace(/[-_]/g, " ").trim();
      // Capitalize first letters
      topicHint = topicHint.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      sourceTopicRaw = rawTopic;
    } else {
      // Fallback from filename if no folder segment was found
      const cleanFilePart = filename.replace(/\.(pdf|PDF)$/, "").replace(/[-_]/g, " ");
      // Strip common document types like "cours", "exercice"
      const words = cleanFilePart.split(" ").filter(w => {
        const lw = w.toLowerCase().trim();
        return lw !== "cours" && lw !== "exercice" && lw !== "exercices" && lw !== "corrige" && lw !== "corrigé" && lw !== "correction" && lw !== "pdf" && lw !== "talamidi";
      });
      if (words.length > 0) {
        topicHint = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        sourceTopicRaw = cleanFilePart;
      }
    }

    let languageHint = "fr";
    if (lowerCombined.includes(" ar ") || lowerCombined.includes("_ar") || lowerCombined.includes("العربية") || lowerCombined.includes("باالعربية")) {
      languageHint = "ar";
    } else if (lowerCombined.includes(" fr ") || lowerCombined.includes("_fr") || lowerCombined.includes("فرنسي")) {
      languageHint = "fr";
    }

    const confidenceHints = (gradeHint ? 0.35 : 0) + (subjectHint ? 0.35 : 0) + (documentTypeHint ? 0.15 : 0) + (topicHint ? 0.15 : 0);
    const metadataSourceFields = ["url.path", "filename"];

    const resultObj: any = {
      sourceDomain,
      sourceSite,
      decodedUrlPath,
      pathSegments,
      gradeHint,
      gradeSlug,
      subjectHint,
      subjectSlug,
      topicHint,
      topicSlug: topicHint ? topicHint.toLowerCase().replace(/\s+/g, "_") : null,
      documentTypeHint,
      documentTypeSlug,
      languageHint,
      sourceGradeRaw,
      sourceSubjectRaw,
      sourceTopicRaw,
      sourceDocumentTypeRaw,
      metadataSourceFields,
      filename,
      originalFilename: filename,
      cleanFilename: getSafeTitleFromFilename(filename),
      confidenceHints,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Do not output empty metadata rows/fields
    for (const key of Object.keys(resultObj)) {
      const val = resultObj[key];
      if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) {
        delete resultObj[key];
      }
    }

    return resultObj;
  }

  function mapMetadataHintsToDictionary(hints: any, dictionary: any) {
    const normDict = normalizeDictionary(dictionary);
    let gradeId = hints.gradeSlug || null;
    let subjectId = hints.subjectSlug || null;
    let topicId = hints.topicSlug || null;
    let documentTypeId = hints.documentTypeSlug || null;

    if (!gradeId && hints.gradeHint) {
      const normGradeHint = normalizeMatchText(hints.gradeHint);
      const matchedGrade = normDict.grades.find((g: any) => {
        if (normalizeMatchText(g.id) === normGradeHint || normalizeMatchText(g.suffix) === normGradeHint) return true;
        return (g.keywords || []).some((kw: string) => normalizeMatchText(kw) === normGradeHint);
      });
      if (matchedGrade) gradeId = matchedGrade.id;
    }

    if (!subjectId && hints.subjectHint) {
      const normSubHint = normalizeMatchText(hints.subjectHint);
      const matchedSub = normDict.subjects.find((s: any) => {
        if (normalizeMatchText(s.id) === normSubHint || normalizeMatchText(s.suffix) === normSubHint) return true;
        return (s.keywords || []).some((kw: string) => normalizeMatchText(kw).includes(normSubHint) || normSubHint.includes(normalizeMatchText(kw)));
      });
      if (matchedSub) subjectId = matchedSub.id;
    }

    if (!documentTypeId && hints.documentTypeHint) {
      const normDocHint = normalizeMatchText(hints.documentTypeHint);
      const matchedDoc = normDict.allowedDocumentTypes.find((d: any) => {
        if (normalizeMatchText(d.id) === normDocHint || normalizeMatchText(d.suffix) === normDocHint) return true;
        return (d.keywords || []).some((kw: string) => normalizeMatchText(kw) === normDocHint);
      });
      if (matchedDoc) documentTypeId = matchedDoc.id;
    }

    if (!topicId && hints.topicHint) {
      const normTopicHint = normalizeMatchText(hints.topicHint);
      const matchedTopic = normDict.topics.find((t: any) => {
        if (normalizeMatchText(t.id) === normTopicHint || normalizeMatchText(t.suffix) === normTopicHint) return true;
        if (subjectId && t.subjectId !== subjectId) return false;
        return (t.keywords || []).some((kw: string) => {
          const normKw = normalizeMatchText(kw);
          return normTopicHint.includes(normKw) || normKw.includes(normTopicHint);
        });
      });
      if (matchedTopic) topicId = matchedTopic.id;
    }

    return {
      gradeId,
      subjectId,
      topicId,
      documentTypeId
    };
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
    if (isJadhathaString(combinedStr)) {
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

  app.post("/api/pipeline/ai-rename-pdfs", async (req, res) => {
    try {
      const { pdfs } = req.body;
      if (!pdfs || !Array.isArray(pdfs) || pdfs.length === 0) {
        return res.json([]);
      }

      const prompt = `You are an educational asset evaluator. I will give you a JSON array of PDF metadata, filenames, and URL patterns.
Your job is to automatically extract and normalize the grade, subject, document type, and topic for standardized renaming.
If an item is completely non-educational, garbled, or completely unrelated, set isValid to false.
Otherwise, normalize the data (e.g. "3eme", "3apic" -> "3AC") and keep the topic/lesson clean and precise.

Input JSON:
${JSON.stringify(pdfs)}

Return a JSON array of ALL input items with their original 'id', setting 'isValid' to true or false.
For each valid item, return EXACTLY this structure:
[
  {
    "id": "the-original-id",
    "isValid": true,
    "grade": "extracted grade (e.g., 1AEP, 2AEP...6AEP, 1AC, 2AC, 3AC, TC, 1BAC, 2BAC...)",
    "subject": "extracted subject (e.g., SVT, PC, Math, Arabic, French...)",
    "docType": "extracted document type (e.g., Cours, Exercices, Examen...)",
    "topic": "the specific lesson or exam name (keep it clean and precise)"
  },
  {
    "id": "another-original-id",
    "isValid": false
  }
]
`;

      const response = await callGeminiWithRetry({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      let aiResults = [];
      try {
        if (response && response.text) {
          aiResults = JSON.parse(response.text.trim());
        }
      } catch (err) {
        console.error("Gemini failed to return valid JSON array", err);
      }

      res.json(Array.isArray(aiResults) ? aiResults : []);
    } catch (error: any) {
      console.error("AI rename error:", error);
      res.status(500).json({ error: "Failed to perform AI rename" });
    }
  });

  app.post("/api/pipeline/reset-workspace", async (req, res) => {
    try {
      console.log("[Workspace Reset] Clearing local output directories...");
      
      ocrConfig.isPaused = true; // Pause workers
      activeWorkerCount = 0; // Optimistically clear worker count
      queuedOcrItems.length = 0; // Clear queue
      
      const subdirs = [
        "downloads",
        "text",
        "ocr",
        "clean-pdfs",
        "dataset",
        "reports"
      ];

      for (const sub of subdirs) {
        const fullPath = path.join(LOCAL_OUTPUT_DIR, sub);
        if (fs.existsSync(fullPath)) {
          // Alternative to recursive rm to ensure directory structure remains
          const files = fs.readdirSync(fullPath);
          for (const file of files) {
            const filePath = path.join(fullPath, file);
            try {
              if (fs.lstatSync(filePath).isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
              } else {
                fs.unlinkSync(filePath);
              }
            } catch (err) {
              console.warn(`[Workspace Reset] Could not delete ${filePath}:`, err);
            }
          }
        }
      }

      // Re-create directory structure just in case anything was deleted
      subdirs.forEach(sub => {
        const fullPath = path.join(LOCAL_OUTPUT_DIR, sub);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
        }
      });

      console.log("[Workspace Reset] Local directories cleared successfully.");

      // Clear internal queues
      queuedOcrItems.length = 0;
      if (fs.existsSync(path.join(LOCAL_OUTPUT_DIR, "ocr_queue.json"))) {
        fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "ocr_queue.json"), "[]");
      }

      return res.json({ success: true, message: "Workspace reset successfully." });
    } catch (e: any) {
      console.error("[Workspace Reset] Error:", e);
      return res.status(500).json({ success: false, error: e.message });
    }
  });

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
        timeout: 60000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
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
        timeout: 60000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        validateStatus: (status) => status < 500,
        httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
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

    let activeDict: any = { grades: [], subjects: [], topics: [], allowedDocumentTypes: [] };
    try {
      activeDict = normalizeDictionary(await getActiveDictionary());
    } catch (dictErr) {
      console.warn("[Classify API] Failed to load active dictionary:", dictErr);
    }

    const deterministicMetadata = extractMetadataFromUrlAndFilename(url, title || "unnamed");
    const mappedIds = mapMetadataHintsToDictionary(deterministicMetadata, activeDict);
    const combinedMetadataAndIds = {
      ...deterministicMetadata,
      ...mappedIds
    };

    // Calculate rough classifications as fallback
    const roughGrade = mappedIds.gradeId || deterministicMetadata.gradeSlug || "1ere_annee_college";
    const roughSubject = mappedIds.subjectId || deterministicMetadata.subjectSlug || "math";
    const roughTopic = mappedIds.topicId || deterministicMetadata.topicSlug || deterministicMetadata.topicHint || "unknown";
    const language = deterministicMetadata.languageHint || "mixed";

    // Task 3: Perform deterministic dictionary matching before Gemini
    const matchDict = matchAgainstDictionary({ title, url, text, topicFilter, dictionary: activeDict });
    console.log(`[Classify API] Deterministic dictionary match results:`, {
      matchedGrades: matchDict.matchedGrades.map(g => g.id),
      matchedSubjects: matchDict.matchedSubjects.map(s => s.id),
      matchedTopics: matchDict.matchedTopics.map(t => t.id),
      matchedDocTypes: matchDict.matchedDocTypes.map(d => d.id)
    });

    // Populate candidate topics based on keywords of subject/grade/dictionary matching
    const candidateTopics = (activeDict.topics || [])
      .filter((t: any) => {
        if (mappedIds.subjectId && t.subjectId !== mappedIds.subjectId) return false;
        const nameFr = (t.nameFr || "").toLowerCase();
        const tId = (t.id || "").toLowerCase();
        const normSearch = `${title || ""} ${url || ""}`.toLowerCase();
        return normSearch.includes(nameFr) || normSearch.includes(tId) || (matchDict.matchedTerms || []).some((term: string) => nameFr.includes(term.toLowerCase()));
      })
      .map((t: any) => t.id)
      .slice(0, 10);

    if (candidateTopics.length === 0 && mappedIds.subjectId) {
      const subjectTopics = (activeDict.topics || [])
        .filter((t: any) => t.subjectId === mappedIds.subjectId)
        .map((t: any) => t.id);
      candidateTopics.push(...subjectTopics.slice(0, 10));
    }

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
          language,
          isMatch: false,
          needsReview: true,
          status: "needs_review",
          pipelineStep: "classify",
          blockReason: "missing_inputs",
          reason: "Title or URL is required for classification",
          cleanTitle: "unnamed",
          renamePattern: "needs-review__unnamed.pdf",
          confidenceScore: 0,
          matchedTerms: [],
          matchedFields: [],
          candidateTopics,
          roughGrade,
          roughSubject,
          roughTopic,
          rough_grade: roughGrade,
          rough_subject: roughSubject,
          rough_topic: roughTopic,
          metadata: combinedMetadataAndIds
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
            language,
            isMatch: false,
            needsReview: true,
            status: "needs_review",
            pipelineStep: "classify",
            blockReason: "malformed_url",
            reason: urlValidation.reason || "Malformed or unsupported source URL",
            cleanTitle: safeTitleFromFilename,
            renamePattern: fallbackRenamePattern,
            confidenceScore: 0,
            matchedTerms: [],
            matchedFields: [],
            candidateTopics,
            roughGrade,
            roughSubject,
            roughTopic,
            rough_grade: roughGrade,
            rough_subject: roughSubject,
            rough_topic: roughTopic,
            topicFilterReport,
            metadata: combinedMetadataAndIds
          });
        }
      }

      // Check for OCR Needed (Normal Problem)
      const cleanTextStr = (text || "").trim();
      if (cleanTextStr.length < 100) {
        console.warn(`[Classify API] OCR needed for document: Text length of "${cleanTextStr.length}" matches OCR threshold.`);
        return res.json({
          gradeId: mappedIds.gradeId || null,
          subjectId: mappedIds.subjectId || null,
          topicId: mappedIds.topicId || null,
          documentTypeId: matchDict.documentTypeId || null,
          language,
          isMatch: false,
          needsReview: true,
          status: "needs_review",
          pipelineStep: "classify",
          blockReason: "ocr_needed",
          reason: "Document text content is extremely short or empty, requiring OCR processing.",
          cleanTitle: safeTitleFromFilename,
          renamePattern: fallbackRenamePattern,
          confidenceScore: 0,
          matchedTerms: matchDict.matchedTerms,
          matchedFields: matchDict.matchedFields,
          candidateTopics,
          roughGrade,
          roughSubject,
          roughTopic,
          rough_grade: roughGrade,
          rough_subject: roughSubject,
          rough_topic: roughTopic,
          topicFilterReport,
          metadata: combinedMetadataAndIds
        });
      }

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
            gradeId: mappedIds.gradeId || null,
            subjectId: mappedIds.subjectId || null,
            topicId: null,
            documentTypeId: matchDict.documentTypeId || null,
            language,
            isMatch: false,
            needsReview: true,
            status: "needs_review",
            pipelineStep: "classify",
            blockReason: "topic_filter_mismatch",
            reason: "Topic filter did not match Supabase dictionary topics",
            cleanTitle: safeTitleFromFilename,
            renamePattern: fallbackRenamePattern,
            confidenceScore: 0,
            matchedTerms: matchDict.matchedTerms,
            matchedFields: matchDict.matchedFields,
            candidateTopics,
            roughGrade,
            roughSubject,
            roughTopic,
            rough_grade: roughGrade,
            rough_subject: roughSubject,
            rough_topic: roughTopic,
            topicFilterReport,
            metadata: combinedMetadataAndIds
          });
        }
      }

      // Task 9: Detect document type before AI using filename/url
      const predetectedDocType = predetectDocumentType(title, url, activeDict.allowedDocumentTypes);
      console.log(`[Classify API] Predetected document type: ${predetectedDocType}`);

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
Snippet from content / text: "${cleanTextStr.substring(0, 1200)}"

YOUR TASK:
Classify this document structure strictly using the Provided Reference Classification Dictionary.${topicFilterConstraint}${matchingContextHint}

CRITICAL: When matching the document to subjects or topics, consider conceptual variations, synonyms, and cross-language translations. For example, if the document mentions "mathematics", "calculus", or "function", it should map to the "math" subject and related topics like "functions", even if those exact words are not explicitly detailed in the keywords. Be smart about semantic matching.

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
5. "language": (string) "fr" (French), "ar" (Arabic), or "mixed" (both) based on document contents.
6. "isMatch": (boolean) true if the document belongs to first/second/third year middle school or BAC level math/science, relates to our dictionary, and is valid. Otherwise, false.
7. "reason": (string) Brief 1-sentence analytical justification.
8. "cleanTitle": (string) A beautiful, cleaned human-readable version of the title, removing website footprints (like "talamidi", "talamidi.com", "moutamadris", "PDF", timestamps, or spam suffixes). Keep it short (2-4 words, e.g., "Equations_Et_Inequations").
9. "renamePattern": (string) Suggested systematic file name using suffixes in format: "<Grade_Suffix>_<Subject_Suffix>_<Topic_Suffix>_<DocType_Suffix>_<CleanTitle>.pdf"
Example: "1AC_MATH_EQ_EX_Equations_Et_Inequations.pdf" (using the suffixes listed in the dictionary). If not matched, this can be original name.
10. "confidenceScore": (number, 0 to 1) Classifier confidence level in this match.

Make sure to respond strictly with valid JSON. Do not include any markdown block fences or conversational text outside of the JSON representation.`;

      // Call Gemini dynamically with robust resilience handling
      const response = await callGeminiWithRetry({
        model: "gemini-2.5-flash",
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
          gradeId: mappedIds.gradeId || null,
          subjectId: mappedIds.subjectId || null,
          topicId: mappedIds.topicId || null,
          documentTypeId: matchDict.documentTypeId || null,
          language,
          isMatch: false,
          needsReview: true,
          status: "needs_review",
          pipelineStep: "classify",
          blockReason: "ai_invalid_json",
          reason: "AI returned invalid JSON; manual review required",
          cleanTitle: safeTitleFromFilename,
          renamePattern: fallbackRenamePattern,
          confidenceScore: 0,
          matchedTerms: matchDict.matchedTerms,
          matchedFields: matchDict.matchedFields,
          candidateTopics,
          roughGrade,
          roughSubject,
          roughTopic,
          rough_grade: roughGrade,
          rough_subject: roughSubject,
          rough_topic: roughTopic,
          topicFilterReport,
          metadata: combinedMetadataAndIds
        });
      }

      let gradeId = classification.gradeId || null;
      let subjectId = classification.subjectId || null;
      let topicId = classification.topicId || null;
      let documentTypeId = classification.documentTypeId || null;
      let parsedLanguage = classification.language || language;
      let isMatch = !!classification.isMatch;
      let reason = classification.reason || "";
      let cleanTitle = classification.cleanTitle || title || "";
      let renamePattern = classification.renamePattern || title || "";
      let confidenceScore = typeof classification.confidenceScore === "number" ? classification.confidenceScore : (isMatch ? 0.8 : 0);

      // Task 12: Do deterministic validation after Gemini
      let blockReason = "";
      let isBlockedOrNeedsReview = false;

      if (gradeId !== null) {
        const exists = activeDict.grades.some((g: any) => g.id === gradeId);
        if (!exists) {
          isBlockedOrNeedsReview = true;
          blockReason = "validation_failed";
          reason = `Grade ID "${gradeId}" does not exist in dictionary.`;
        }
      }

      if (!subjectId) {
        isBlockedOrNeedsReview = true;
        blockReason = "no_subject_match";
        reason = "Subject could not be matched against the reference dictionary.";
      } else {
        const exists = activeDict.subjects.some((s: any) => s.id === subjectId);
        if (!exists) {
          isBlockedOrNeedsReview = true;
          blockReason = "no_subject_match";
          reason = `Subject ID "${subjectId}" does not exist in dictionary.`;
        }
      }

      if (!topicId) {
        isBlockedOrNeedsReview = true;
        blockReason = "no_topic_match";
        reason = "Topic could not be matched against the reference dictionary.";
      } else {
        const matchedTopic = activeDict.topics.find((t: any) => t.id === topicId);
        if (!matchedTopic) {
          isBlockedOrNeedsReview = true;
          blockReason = "no_topic_match";
          reason = `Topic ID "${topicId}" does not exist in dictionary.`;
        } else {
          if (subjectId !== null && matchedTopic.subjectId && matchedTopic.subjectId !== subjectId) {
            isBlockedOrNeedsReview = true;
            blockReason = "validation_failed";
            reason = `Topic ID "${topicId}" subjectId "${matchedTopic.subjectId}" mismatch with selected subjectId "${subjectId}".`;
          }
        }
      }

      // Check predetected or selected doc type
      if (!documentTypeId) {
        isBlockedOrNeedsReview = true;
        blockReason = "document_type_uncertain";
        reason = "The document type could not be confidently determined or is missing.";
      } else {
        const exists = activeDict.allowedDocumentTypes.some((d: any) => d.id === documentTypeId);
        if (!exists) {
          isBlockedOrNeedsReview = true;
          blockReason = "document_type_uncertain";
          reason = `Document Type ID "${documentTypeId}" does not exist in allowedDocumentTypes.`;
        }
      }

      if (topicFilter && topicFilter.trim().length > 0) {
        if (topicId !== null && !allowedTopicIds.includes(topicId)) {
          isBlockedOrNeedsReview = true;
          blockReason = "topic_filter_mismatch";
          reason = `Classifier selected topic "${topicId}" outside Topic Filters / Supabase dictionary match.`;
        }
      }

      if (confidenceScore < 0.6) {
        isBlockedOrNeedsReview = true;
        blockReason = "low_confidence";
        reason = `The AI classifier confidence level (${confidenceScore}) is below the acceptable threshold (0.6).`;
      }

      // Final statuses mapping
      let needsReview = !isMatch || isBlockedOrNeedsReview;
      let status = isMatch && !isBlockedOrNeedsReview ? "classified" : "needs_review";

      return res.json({
        gradeId,
        subjectId,
        topicId,
        documentTypeId,
        language: parsedLanguage,
        isMatch,
        needsReview,
        status,
        pipelineStep: "classify",
        blockReason,
        reason: reason || "Successfully matching Supabase reference parameters",
        cleanTitle,
        renamePattern,
        confidenceScore,
        matchedTerms: matchDict.matchedTerms,
        matchedFields: matchDict.matchedFields,
        candidateTopics,
        roughGrade,
        roughSubject,
        roughTopic,
        rough_grade: roughGrade,
        rough_subject: roughSubject,
        rough_topic: roughTopic,
        topicFilterReport,
        metadata: {
          ...combinedMetadataAndIds,
          gradeId,
          subjectId,
          topicId,
          documentTypeId,
          language: parsedLanguage,
          roughGrade,
          roughSubject,
          roughTopic
        }
      });

    } catch (error: any) {
      // Task 1: Global fail-safe wrapping. Never throw 500 unless extreme server crash.
      console.error("[Classification Fail-Safe Handled]", error);
      const errMsg = error.message || "";
      const isRateLimit = errMsg.includes("429") || 
                         errMsg.toLowerCase().includes("quota exceeded") || 
                         errMsg.toLowerCase().includes("rate limit") || 
                         errMsg.toLowerCase().includes("resource exhausted") || 
                         errMsg.toLowerCase().includes("too many requests") ||
                         JSON.stringify(error).toLowerCase().includes("quota");

      const blockReason = isRateLimit ? "rate_limit_exceeded" : "system_failed";
      const userReason = isRateLimit 
        ? "Gemini API Quota/Rate Limit Exceeded. Manual review or re-classification required once your quota is restored." 
        : (error.message || "Failed to parse/classify document pipeline fully");

      return res.json({
        gradeId: mappedIds.gradeId || null,
        subjectId: mappedIds.subjectId || null,
        topicId: mappedIds.topicId || null,
        documentTypeId: matchDict.documentTypeId || null,
        language,
        isMatch: false,
        needsReview: true,
        status: "needs_review",
        pipelineStep: "classify",
        blockReason: blockReason,
        reason: userReason,
        cleanTitle: safeTitleFromFilename,
        renamePattern: fallbackRenamePattern,
        confidenceScore: 0,
        matchedTerms: [],
        matchedFields: [],
        candidateTopics,
        roughGrade,
        roughSubject,
        roughTopic,
        rough_grade: roughGrade,
        rough_subject: roughSubject,
        rough_topic: roughTopic,
        topicFilterReport,
        metadata: combinedMetadataAndIds
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
              timeout: 60000 
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
        timeout: 60000 
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
    
    // Split into pages if \f is present so we can identify repeating headers/footers across pages.
    // If not \f, we will simulate pages (e.g. by grouping every 40 lines or using PAGE headers if present).
    let pages: string[] = [];
    if (text.includes("\f")) {
      pages = text.split("\f");
    } else if (text.includes("--- PAGE")) {
      pages = text.split(/--- PAGE \d+ ---\n?/g);
    } else {
      const lines = text.split(/\r?\n/);
      const pageSize = 40;
      for (let i = 0; i < lines.length; i += pageSize) {
        pages.push(lines.slice(i, i + pageSize).join("\n"));
      }
    }

    // Identify page-wise repeated lines.
    const normalizedPageLines: string[][] = pages.map(page => {
      return page.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 5);
    });

    const linePageOccurrences = new Map<string, Set<number>>();
    normalizedPageLines.forEach((pageLines, pageIdx) => {
      pageLines.forEach(line => {
        const normalized = line.replace(/\s+/g, " ");
        if (!linePageOccurrences.has(normalized)) {
          linePageOccurrences.set(normalized, new Set<number>());
        }
        linePageOccurrences.get(normalized)!.add(pageIdx);
      });
    });

    const linesToRemove = new Set<string>();
    
    // A repeated header/footer is any line repeating across 2 or more pages.
    for (const [line, pagesSet] of linePageOccurrences.entries()) {
      if (pagesSet.size >= 2) {
        const lower = line.toLowerCase();
        
        // Define exceptions (things to ALWAYS keep even if identical across page blocks)
        const isException = 
          /^(exercice|exercice\s+\d+|exemple\s*:|exemple|remarque\s*:|remarque|solution|correction|définition|propriété|théorème|activité|partie\s+\d+)/i.test(lower) ||
          /^[\d\s+\-*/=><√πθΣΔαβγλμφψω≤≥≈≡∞∈∉⊂⊃∪∩∧∨¬⇒⇔(),;:.\[\]{}]+$/.test(line); // Pure formulas
        
        if (!isException) {
          linesToRemove.add(line);
        }
      }
    }

    // Process line by line and apply watermarks and duplicated headers/footers cleaning
    const allLines = text.split(/\r?\n/);
    const cleanedLines: string[] = [];

    // Specific watermark patterns in descending order of length or specific order
    const watermarkPatterns = [
      /www\.talamidi\.com/gi,
      /talamidi\.com/gi,
      /تم تحميل هذا الملف من موقع تلاميذي/g,
      /تم تحميل هذا الملف من موقع/g,
      /موقع تلاميذي/g,
      /الموقع التربوي تلاميذي/g,
      /Talamidi/gi,
      /Moutamadris/gi,
      /moutamadris\.ma/gi,
      /Cours, Exercices, Examens corrigés/gi
    ];

    for (const line of allLines) {
      let currentLine = line.trim();
      const normalized = currentLine.replace(/\s+/g, " ");

      // Check if it's dual-page list matching a header/footer
      if (linesToRemove.has(normalized)) {
        continue;
      }

      // Apply specific watermark cleaning
      for (const pattern of watermarkPatterns) {
        if (pattern.test(currentLine)) {
          currentLine = currentLine.replace(pattern, "");
        }
      }

      // Skip lines that became empty after removing watermarks
      if (currentLine.trim().length === 0) {
        continue;
      }

      cleanedLines.push(currentLine);
    }

    let cleaned = cleanedLines.join("\n");

    // Replace repeated empty lines (consecutive blank lines to simple paragraph breaks)
    cleaned = cleaned.replace(/\n\s*\n/g, "\n\n");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

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
    url?: string;
    title?: string;
  }) {
    const shortHash = params.hash.substring(0, 8);
    let cleanName = `${params.grade_slug}__${params.subject_slug}__${params.topic_slug}__${params.document_type_slug}__${shortHash}.pdf`;
    
    if (params.url) {
      const generated = generateServerCurriculumFilename({
        url: params.url,
        htmlTitle: params.title || params.topic_label,
        grade: params.grade_slug,
        subject: params.subject_slug,
        documentType: params.document_type_slug
      });
      cleanName = generated.filename;
    }
    
    const cleanPath = path.join(LOCAL_OUTPUT_DIR, "clean-pdfs", cleanName);

    const originalPath = path.join(LOCAL_OUTPUT_DIR, "downloads", `${params.hash}.original.pdf`);
    let pdfBytes: Buffer;

    if (!fs.existsSync(originalPath)) {
      const downloadsDir = path.join(LOCAL_OUTPUT_DIR, "downloads");
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }

      // Load the HTML lesson's clean text file to compile into PDF format
      const cleanTextPath = path.join(LOCAL_OUTPUT_DIR, "text", `${params.hash}.clean.txt`);
      const cleanText = fs.existsSync(cleanTextPath) ? fs.readFileSync(cleanTextPath, "utf8") : "Clean lesson text empty";

      const doc = new jsPDF();
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(14);
      doc.text(cleanName.replace(".pdf", ""), 20, 25);
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(`Grade: ${params.grade_label}`, 20, 35);
      doc.text(`Subject: ${params.subject_label}`, 20, 40);
      doc.text(`Topic: ${params.topic_label}`, 20, 45);
      doc.text(`Type: ${params.document_type_label}`, 20, 50);
      doc.line(20, 55, 190, 55);
      
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      
      const splitText = doc.splitTextToSize(cleanText, 170);
      let y = 65;
      const pageHeight = doc.internal.pageSize.getHeight();
      for (let i = 0; i < splitText.length; i++) {
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 20;
        }
        doc.text(splitText[i], 20, y);
        y += 6;
      }
      
      pdfBytes = Buffer.from(doc.output("arraybuffer"));
      fs.writeFileSync(originalPath, pdfBytes);
    } else {
      pdfBytes = fs.readFileSync(originalPath);
    }

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
    fs.writeFileSync(cleanPath, cleanBytes);

    const rawName = cleanName.replace(".pdf", "_raw.pdf");
    const rawPath = path.join(LOCAL_OUTPUT_DIR, "downloads", rawName);
    if (fs.existsSync(originalPath)) {
      fs.copyFileSync(originalPath, rawPath);
    }

    return { cleanPath, cleanName, rawPath, rawName };
  }

  function saveDatasetRow(row: any) {
    const hash = row.hash;
    const jsonPath = path.join(LOCAL_OUTPUT_DIR, "dataset", `${hash}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(row, null, 2));

    const jsonLine = JSON.stringify(row) + "\n";
    const jsonlPath = path.join(LOCAL_OUTPUT_DIR, "dataset", "index.jsonl");
    fs.appendFileSync(jsonlPath, jsonLine);
  }

  // --- HTML LESSON EXTRACTION HELPERS & ENDPOINTS ---

  function extractHtmlLesson(html: string, url: string) {
    let title = "HTML Lesson Page";
    let contentHtml = "";
    let contentText = "";
    
    // 1. Try Readability first
    try {
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article && article.textContent && article.textContent.trim().length > 100) {
        title = article.title || title;
        contentHtml = article.content || "";
        contentText = article.textContent || "";
      }
    } catch (readErr) {
      console.warn("Readability extraction failed, falling back to cheerio:", readErr);
    }
    
    // 2. Fallback to Cheerio if Readability was not successful (no output or too short)
    if (!contentText || contentText.trim().length <= 100) {
      const $ = load(html);
      
      // Set webpage title
      title = $('title').text() || $('h1').first().text() || "HTML Lesson";
      
      // Remove unwanted elements
      const junkSelectors = [
        'nav', 'header', 'footer', 'script', 'style', 'noscript', 'iframe',
        '.ads', '.sidebar', '.comments', '.related-posts', '.share-buttons',
        '.cookie-banner', '.menu', '.login-block', '#menu', '#header', '#footer',
        '#sidebar', '.ad', '.adds', '.sharing', '.social'
      ];
      junkSelectors.forEach(sel => $(sel).remove());
      
      // Preferred containers
      const containers = [
        'article',
        'main',
        '.lesson-content',
        '.entry-content',
        '.post-content',
        '.content',
        'body'
      ];
      
      let matchedContainer = null;
      for (const sel of containers) {
        const el = $(sel);
        if (el.length > 0 && el.text().trim().length > 100) {
          matchedContainer = el;
          break;
        }
      }
      
      const target = matchedContainer || $('body');
      contentHtml = target.html() || "";
      contentText = target.text() || "";
    }
    
    return { title, contentHtml, contentText };
  }

  function cleanHtmlLessonText(text: string): string {
    if (!text) return "";
    
    let cleaned = text;
    
    // Remove known breadcrumb or repeated menus pattern, social utilities
    const lines = cleaned.split("\n");
    const filteredLines = lines.map(line => {
      const trimmed = line.trim();
      
      // Filters
      if (trimmed.toLowerCase().includes("read more") || trimmed.includes("إقرأ المزيد")) return "";
      if (trimmed.toLowerCase().includes("related articles") || trimmed.includes("مواضيع ذات صلة")) return "";
      if (trimmed.toLowerCase().includes("share on") || trimmed.includes("أنشر على")) return "";
      if (trimmed.toLowerCase().includes("follow us") || trimmed.includes("تابعنا")) return "";
      if (trimmed.toLowerCase().includes("copyright") || trimmed.includes("جميع الحقوق محفوظة")) return "";
      if (trimmed.toLowerCase().includes("cookie") || trimmed.includes("ملفات تعريف الارتباط")) return "";
      if (trimmed.toLowerCase().includes("home /") || trimmed.includes("الرئيسية /")) return "";
      
      // If it looks like repeated menu bar content (many links with separator characters like | or » or >)
      if (trimmed.includes(" | ") && trimmed.split("|").length > 4) return "";
      if (trimmed.includes(" • ") && trimmed.split("•").length > 4) return "";
      
      return line;
    });
    
    cleaned = filteredLines.join("\n");
    
    // Replace multiple empty lines with a single empty line
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, "\n\n");
    
    return cleaned.trim();
  }

  function extractHtmlLessonMetadata(urlStr: string, pageTitle: string, html: string, cleanText: string) {
    let sourceDomain = "";
    let sourceSite = "";
    try {
      const parsed = new URL(urlStr);
      sourceDomain = parsed.hostname.toLowerCase();
      const parts = sourceDomain.split(".");
      sourceSite = parts.length > 2 ? parts[parts.length - 2] : parts[0];
    } catch (e) {}

    const $ = load(html);
    
    const h1Text = $('h1').map((_, el) => $(el).text()).get().join(" ");
    const h2Text = $('h2').map((_, el) => $(el).text()).get().join(" ");
    const breadcrumbText = $('.breadcrumb, .breadcrumbs, .breadcrumb-item').map((_, el) => $(el).text()).get().join(" ");
    
    // Combine all strings for keyword analysis
    const normTextForSearch = `${urlStr || ""} ${pageTitle || ""} ${h1Text} ${h2Text} ${breadcrumbText} ${cleanText.substring(0, 1000)}`.toLowerCase();
    
    let gradeHint = "1AC";
    let gradeSlug = "1ere_annee_college";
    
    if (normTextForSearch.includes("2ac") || normTextForSearch.includes("2eme_annee_college") || normTextForSearch.includes("2eme annee") || normTextForSearch.includes("الثانية إعدادي")) {
      gradeHint = "2AC";
      gradeSlug = "2eme_annee_college";
    } else if (normTextForSearch.includes("3ac") || normTextForSearch.includes("3eme_annee_college") || normTextForSearch.includes("3eme annee") || normTextForSearch.includes("الثالثة إعدادي")) {
      gradeHint = "3AC";
      gradeSlug = "3eme_annee_college";
    } else if (normTextForSearch.includes("tcs") || normTextForSearch.includes("tc ") || normTextForSearch.includes("tronc_commun") || normTextForSearch.includes("جذع مشترك")) {
      gradeHint = "TC";
      gradeSlug = "tronc_commun";
    } else if (normTextForSearch.includes("1bac") || normTextForSearch.includes("1ere_bac") || normTextForSearch.includes("الأولى بكالوريا")) {
      gradeHint = "1BAC";
      gradeSlug = "1ere_bac";
    } else if (normTextForSearch.includes("2bac") || normTextForSearch.includes("2eme_bac") || normTextForSearch.includes("الثانية بكالوريا")) {
      gradeHint = "2BAC";
      gradeSlug = "2eme_bac";
    }

    let subjectHint = "math";
    let subjectSlug = "math";
    
    if (normTextForSearch.includes("physique") || normTextForSearch.includes("chimie") || normTextForSearch.includes(" pc ") || normTextForSearch.includes("فيزياء")) {
      subjectHint = "pc";
      subjectSlug = "pc";
    } else if (normTextForSearch.includes("svt") || normTextForSearch.includes("علوم الحياة")) {
      subjectHint = "svt";
      subjectSlug = "svt";
    } else if (normTextForSearch.includes("francais") || normTextForSearch.includes("français") || normTextForSearch.includes("الفرنسية")) {
      subjectHint = "french";
      subjectSlug = "french";
    }

    // Document Type & Document Role
    let documentTypeHint = "cours";
    if (normTextForSearch.includes("exercice") || normTextForSearch.includes("serie") || normTextForSearch.includes("تمارين")) {
      documentTypeHint = "exercice";
    } else if (normTextForSearch.includes("corrige") || normTextForSearch.includes("corrigé") || normTextForSearch.includes("correction") || normTextForSearch.includes("حلول")) {
      documentTypeHint = "correction";
    } else if (normTextForSearch.includes("jadhatha") || normTextForSearch.includes("جذاذة") || normTextForSearch.includes("جذاذات")) {
      documentTypeHint = "jadhatha";
    } else if (normTextForSearch.includes("forod") || normTextForSearch.includes("فرض") || normTextForSearch.includes("controle") || normTextForSearch.includes("exam")) {
      documentTypeHint = "assessment";
    }

    // Language detection
    let languageHint = "mixed";
    const hasArabic = /[\u0600-\u06FF]/.test(cleanText);
    const hasLatin = /[a-zA-Z]/.test(cleanText);
    if (hasArabic && hasLatin) {
      languageHint = "mixed";
    } else if (hasArabic) {
      languageHint = "ar";
    } else if (hasLatin) {
      languageHint = "fr";
    }

    return {
      sourceDomain,
      sourceSite,
      assetType: "html_lesson",
      gradeHint,
      gradeSlug,
      subjectHint,
      subjectSlug,
      topicHint: "", 
      lessonHint: "", 
      documentTypeHint,
      languageHint,
      metadataSourceFields: ["url_path", "title", "h1", "breadcrumbs"]
    };
  }

  async function processHtmlLessonInternal(url: string, htmlContent: string, activeDict: any) {
    const { title, contentHtml, contentText } = extractHtmlLesson(htmlContent, url);
    const cleanText = cleanHtmlLessonText(contentText);
    
    // Hash the raw HTML content combining with URL to avoid cross-lesson deduplication on generic templates
    const hash = crypto.createHash("sha256").update(url + "|" + htmlContent).digest("hex");
    
    // Save files locally
    const htmlDir = path.join(LOCAL_OUTPUT_DIR, "html");
    const textDir = path.join(LOCAL_OUTPUT_DIR, "text");
    const datasetDir = path.join(LOCAL_OUTPUT_DIR, "dataset");
    if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
    if (!fs.existsSync(textDir)) fs.mkdirSync(textDir, { recursive: true });
    if (!fs.existsSync(datasetDir)) fs.mkdirSync(datasetDir, { recursive: true });

    fs.writeFileSync(path.join(htmlDir, `${hash}.raw.html`), htmlContent, "utf8");
    fs.writeFileSync(path.join(textDir, `${hash}.raw.txt`), contentText, "utf8");
    fs.writeFileSync(path.join(textDir, `${hash}.clean.txt`), cleanText, "utf8");

    // Extract Metadata Hints
    const metadataHints = extractHtmlLessonMetadata(url, title, htmlContent, cleanText);
    
    // Words and text quality score
    const words = cleanText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    let textQualityScore = 0;
    if (wordCount > 0) {
      textQualityScore = Math.min(100, Math.round(40 + Math.min(60, wordCount / 5)));
    }

    return {
      hash,
      title,
      rawHtml: htmlContent,
      rawText: contentText,
      cleanText,
      language: metadataHints.languageHint,
      metadataHints,
      textQualityScore,
      needsOcr: false,
      extractionStatus: "html_extracted" as const
    };
  }

  app.post("/api/pipeline/parse-html-lesson", async (req, res) => {
    const { url, topicFilter } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const activeDict = normalizeDictionary(await getActiveDictionary());
      
      const response = await axios.get(url, {
        responseType: "arraybuffer", // consistent buffer fetching
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/437.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/437.36"
        },
        timeout: 60000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT })
      });
      const htmlContent = Buffer.from(response.data).toString("utf8");

      const processed = await processHtmlLessonInternal(url, htmlContent, activeDict);

      res.json({
        success: true,
        assetType: "html_lesson",
        url,
        sourceDomain: processed.metadataHints.sourceDomain,
        title: processed.title,
        rawHtml: processed.rawHtml,
        rawText: processed.rawText,
        cleanText: processed.cleanText,
        language: processed.language,
        metadataHints: processed.metadataHints,
        textQualityScore: processed.textQualityScore,
        needsOcr: false,
        extractionStatus: "html_extracted"
      });
    } catch (err: any) {
      console.error("[api/pipeline/parse-html-lesson Error]", err);
      res.status(500).json({ error: `Failed to scrape/parse HTML lesson page: ${err.message}` });
    }
  });

  // --- WORKSTATION PIPELINE ENDPOINTS ---

  async function runNvidiaIntakeAgent(
    filename: string, 
    contentType: string, 
    textPreview: string, 
    errorOccurred: boolean
  ) {
    const isPdf = contentType.includes("pdf") || filename.toLowerCase().endsWith(".pdf");
    const textLen = textPreview.trim().length;
    const emptyOrError = errorOccurred || textLen === 0;

    if (!process.env.NVIDIA_API_KEY) {
      console.warn("NVIDIA_API_KEY missing. Falling back to simple heuristic intake.");
      return {
        source_type: isPdf ? "pdf" : "unknown",
        needs_ocr: emptyOrError,
        routing_decision: emptyOrError ? "needs_ocr" : "text_extracted",
        confidence: 0.5
      };
    }
    
    try {
      const prompt = `You are the Scrap AI Intake Agent.
Analyze the following document metadata and snippet to determine its routing.
FileName: ${filename}
ContentType: ${contentType}
ParseExtractedTextLength: ${textPreview.length}
ParserErrorOccurred: ${errorOccurred}
TextSnippet (up to 1000 chars):
${textPreview.substring(0, 1000)}

Responsibilities:
1. Detect source_type (pdf, image, webpage, docx, txt, json, html, unknown)
2. Detect needs_ocr (boolean) - Does it need OCR if there is an error extracting text or text is garbage/empty?
3. Determine routing_decision (needs_ocr, text_extracted, extract_failed)
4. Give a confidence score (0.0 to 1.0)

Respond strictly in raw JSON without markdown:
{
  "source_type": "pdf",
  "needs_ocr": true,
  "routing_decision": "needs_ocr",
  "confidence": 0.9
}`;

      const aiResponse = await nvidia.chat.completions.create({
        model: process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.1
      });
      
      const content = aiResponse.choices?.[0]?.message?.content || "{}";
      const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleaned);
    } catch (e) {
      console.error("[NVIDIA Intake Agent] Error:", e);
      return { source_type: "unknown", needs_ocr: emptyOrError, routing_decision: emptyOrError ? "needs_ocr" : "text_extracted", confidence: 0 };
    }
  }

  app.post("/api/pipeline/parse", async (req, res) => {
    const { url, title, topicFilter } = req.body;

    let activeDict: any = { grades: [], subjects: [], topics: [], allowedDocumentTypes: [] };
    try {
      activeDict = await getActiveDictionary();
    } catch (dictErr) {
      console.warn("[Parse API] Failed to load active dictionary:", dictErr);
    }

    const deterministicMetadata = extractMetadataFromUrlAndFilename(url, title || "unnamed");
    const mappedIds = mapMetadataHintsToDictionary(deterministicMetadata, activeDict);
    const combinedMetadataAndIds = {
      ...deterministicMetadata,
      ...mappedIds
    };

    let trackHint = null;
    let schoolYearHint = null;
    const allTextToSearch = ((url || "") + " " + (title || "")).toLowerCase();
    
    if (allTextToSearch.includes("biof") || allTextToSearch.includes("خيار فرنسي") || allTextToSearch.includes("option francais")) {
      trackHint = "Sciences Expérimentales BIOF";
    } else if (allTextToSearch.includes("خيار عربي") || allTextToSearch.includes("option arabe")) {
      trackHint = "Option Arabe";
    }

    const yearMatch = allTextToSearch.match(/20\d{2}-20\d{2}/);
    if (yearMatch) {
      schoolYearHint = yearMatch[0];
    }
    
    let formattedSource = combinedMetadataAndIds.sourceSite || null;
    if (formattedSource) {
      formattedSource = formattedSource.charAt(0).toUpperCase() + formattedSource.slice(1);
    }

    const levelspaceMeta = {
      grade: combinedMetadataAndIds.sourceGradeRaw || combinedMetadataAndIds.gradeHint || null,
      subject: combinedMetadataAndIds.sourceSubjectRaw || combinedMetadataAndIds.subjectHint || null,
      track: trackHint,
      documentType: combinedMetadataAndIds.sourceDocumentTypeRaw || combinedMetadataAndIds.documentTypeHint || null,
      schoolYear: schoolYearHint,
      source: formattedSource
    };

    const safeTitle = formatLevelspaceReviewTitle(levelspaceMeta);
    const fallbackName = formatLevelspaceSafeFilename(levelspaceMeta);

    try {
      if (!url) {
        return res.json({
          success: false,
          status: "rejected",
          pipelineStep: "url_validation",
          blockReason: "missing_url",
          reason: "URL is required",
          technicalError: "",
          metadata: combinedMetadataAndIds
        });
      }

      const urlCheck = isValidUrlSource(url);
      if (!urlCheck.valid) {
        updateReport("rejection-report.json", { url, reason: urlCheck.reason, title });
        return res.json({
          success: false,
          status: "rejected",
          pipelineStep: "url_validation",
          blockReason: "malformed_url",
          reason: urlCheck.reason || "Malformed or unsupported source URL",
          technicalError: "",
          metadata: combinedMetadataAndIds,
          cleanTitle: safeTitle,
          renamePattern: fallbackName,
          needsReview: true,
          isMatch: false
        });
      }

      let pdfBytes: Buffer;
      let contentType = "";
      let statusCode = 200;
      let fetchUrl = url;
      
      // Handle Google Drive Links
      if (fetchUrl.includes("drive.google.com/file/d/")) {
        const fileIdMatch = fetchUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          fetchUrl = `https://drive.google.com/uc?id=${fileIdMatch[1]}&export=download`;
        }
      }

      try {
        const response = await axios.get(fetchUrl, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 60000,
          httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
          validateStatus: (status) => status < 500
        });
        pdfBytes = Buffer.from(response.data);
        contentType = (response.headers['content-type'] || '').toLowerCase();
        statusCode = response.status;
      } catch (dlErr: any) {
        updateReport("rejection-report.json", { url, reason: `Download failed: ${dlErr.message}`, title });
        return res.json({
          success: false,
          status: "blocked",
          pipelineStep: "download",
          blockReason: "download_failed",
          reason: `Download failed: ${dlErr.message}`,
          technicalError: dlErr.stack || String(dlErr),
          metadata: combinedMetadataAndIds,
          cleanTitle: safeTitle,
          renamePattern: fallbackName,
          needsReview: true,
          isMatch: false
        });
      }

      const isPdfByUrl = url.toLowerCase().split(/[?#]/)[0].endsWith(".pdf") || url.includes("drive.google.com/file/d/");
      const byteSize = pdfBytes ? pdfBytes.length : 0;
      const bodyString = pdfBytes ? pdfBytes.toString("utf8") : "";

      // Reject PDF-expected downloads that are actually HTML lessons, startup blocks or other placeholders
      if (isPdfByUrl) {
        let isInvalid = false;
        let rejectReason = "";

        if (contentType.includes("text/html")) {
          isInvalid = true;
          rejectReason = "Content-Type is text/html (expected a PDF binary)";
        } else if (byteSize < 400) {
          isInvalid = true;
          rejectReason = `File size is too small (${byteSize} bytes) for a valid PDF document`;
        } else if (bodyString.includes("Please wait while your application starts")) {
          isInvalid = true;
          rejectReason = "Download body contains 'Please wait while your application starts' placeholder message";
        } else if (bodyString.toLowerCase().includes("<!doctype html>")) {
          isInvalid = true;
          rejectReason = "Download body contains HTML doctype symbol instead of PDF binary signature";
        } else if (bodyString.includes("Starting Server")) {
          isInvalid = true;
          rejectReason = "Download body contains 'Starting Server' status message";
        } else if (statusCode !== 200) {
          isInvalid = true;
          rejectReason = `Download response status is ${statusCode} instead of 200`;
        }

        if (isInvalid) {
          console.warn(`[Pipeline Parse Validation Error] URL: ${url}, Reason: ${rejectReason}`);
          updateReport("rejection-report.json", { url, reason: `Rejected PDF: ${rejectReason}`, title });
          return res.json({
            success: false,
            status: "blocked",
            pipelineStep: "download",
            blockReason: "invalid_pdf_content",
            reason: rejectReason,
            technicalError: `Content Type: ${contentType}, Bytes: ${byteSize}, StatusCode: ${statusCode}`,
            metadata: combinedMetadataAndIds,
            cleanTitle: safeTitle,
            renamePattern: fallbackName,
            needsReview: true,
            isMatch: false
          });
        }
      }

      const isHtml = contentType.includes("text/html");

      if (isHtml && !isPdfByUrl) {
        const htmlString = pdfBytes.toString("utf8");
        const processed = await processHtmlLessonInternal(url, htmlString, activeDict);
        const hash = processed.hash;
        const textLen = processed.rawText.trim().length;
        const textQualityScore = processed.textQualityScore;
        const rawText = processed.rawText;
        const cleanText = processed.cleanText;

        const isDuplicateHtml = fs.existsSync(path.join(LOCAL_OUTPUT_DIR, "html", `${hash}.raw.html`));
        if (!isDuplicateHtml) {
          const htmlDir = path.join(LOCAL_OUTPUT_DIR, "html");
          const textDir = path.join(LOCAL_OUTPUT_DIR, "text");
          const datasetDir = path.join(LOCAL_OUTPUT_DIR, "dataset");
          if (!fs.existsSync(htmlDir)) fs.mkdirSync(htmlDir, { recursive: true });
          if (!fs.existsSync(textDir)) fs.mkdirSync(textDir, { recursive: true });
          if (!fs.existsSync(datasetDir)) fs.mkdirSync(datasetDir, { recursive: true });

          fs.writeFileSync(path.join(htmlDir, `${hash}.raw.html`), htmlString, "utf8");
          fs.writeFileSync(path.join(textDir, `${hash}.raw.txt`), rawText, "utf8");
          fs.writeFileSync(path.join(textDir, `${hash}.clean.txt`), cleanText, "utf8");
        }

        updateReport("extraction-report.json", {
          hash,
          url,
          title: processed.title,
          textLen,
          textQualityScore,
          needsOcr: false,
          isDuplicate: isDuplicateHtml,
          extractionStatus: "html_extracted",
          assetType: "html_lesson"
        });

        const deterministicMetadata = processed.metadataHints;
        const mappedIds = mapMetadataHintsToDictionary(deterministicMetadata, activeDict);
        const combinedMetadataAndIdsForHtml = {
          ...deterministicMetadata,
          ...mappedIds,
          assetType: "html_lesson"
        };

        return res.json({
          success: true,
          hash,
          isDuplicate: isDuplicateHtml,
          textSnippet: rawText.substring(0, 800),
          textLength: textLen,
          textQualityScore,
          needsOcr: false,
          ocrStatus: "not_needed",
          extractionStatus: "html_extracted",
          originalFilename: processed.title,
          status: "classified",
          pipelineStep: "extract",
          blockReason: "",
          technicalError: "",
          cleanTitle: safeTitle,
          renamePattern: fallbackName,
          metadata: {
            ...combinedMetadataAndIdsForHtml,
            rawTextLength: textLen,
            textQualityScore,
            needsOcr: false,
            ocrStatus: "not_needed",
            assetType: "html_lesson"
          }
        });
      }

      const hash = crypto.createHash("sha256").update(pdfBytes).digest("hex");
      
      const originalPath = path.join(LOCAL_OUTPUT_DIR, "downloads", `${hash}.original.pdf`);
      const { force_reprocess, repair_metadata } = req.body;
      let isDuplicate = fs.existsSync(originalPath);
      let duplicateOverridden = false;
      let finalDuplicateDecision = "skipped";
      let existingProcessingStatus = "unknown";
      let existingReviewStatus = "unknown";
      let existingChunksCount = 0;
      let existingBlockReason = "";
      
      if (isDuplicate) {
        // Detailed log audit prior to duplicate skip (as requested)
        const reportsDir = path.join(LOCAL_OUTPUT_DIR, "reports");
        let existingPdfUrl = "";
        let existingDocumentId = "";
        const extractionReportPath = path.join(reportsDir, "extraction-report.json");
        if (fs.existsSync(extractionReportPath)) {
          try {
            const reportData = JSON.parse(fs.readFileSync(extractionReportPath, "utf8"));
            const originalDoc = reportData.find((item: any) => item.hash === hash && !item.isDuplicate);
            if (originalDoc) {
              existingPdfUrl = originalDoc.url;
              existingDocumentId = originalDoc.hash.substring(0, 12);
            }
          } catch (e) {
            console.warn("[Duplicate Log] Failed to read extraction-report.json:", e);
          }
        }

        let sourcePageUrl = "";
        const discoveryMappingPath = path.join(reportsDir, "discovery-mapping.json");
        if (fs.existsSync(discoveryMappingPath)) {
          try {
            const mappingData = JSON.parse(fs.readFileSync(discoveryMappingPath, "utf8"));
            const mappingEntry = mappingData.find((item: any) => item.pdf_url === url);
            if (mappingEntry) {
              sourcePageUrl = mappingEntry.source_page_url;
            }
          } catch (e) {
            console.warn("[Duplicate Log] Failed to read discovery-mapping.json:", e);
          }
        }
        if (!sourcePageUrl) {
          sourcePageUrl = url;
        }
        
        // 1. Gather SiteMapNode status
        const siteMapNodes = loadSiteMap();
        const existingNode = siteMapNodes.find(n => n.hash === hash || n.raw_file_hash === hash);
        if (existingNode) {
          existingProcessingStatus = existingNode.processing_status || "unknown";
          existingReviewStatus = existingNode.review_status || existingNode.status || "unknown";
          existingBlockReason = existingNode.block_reason || existingNode.rejection_reason || existingNode.blockReason || "";
          existingDocumentId = existingNode.id || existingDocumentId;
        }

        // 2. Count existing chunks
        const chunkPath = path.join(LOCAL_OUTPUT_DIR, "dataset", `${hash}_chunks.json`);
        if (fs.existsSync(chunkPath)) {
          try {
             const chunkData = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
             existingChunksCount = Array.isArray(chunkData.chunks) ? chunkData.chunks.length : 0;
          } catch(e) {}
        }
        
        // 3. Skip only if
        let shouldSkip = false;
        if (
          existingProcessingStatus === "completed" && 
          existingChunksCount > 0 &&
          (existingReviewStatus === "auto_approved" || existingReviewStatus === "needs_metadata_review" || existingReviewStatus === "needs_review")
        ) {
          shouldSkip = true;
        }

        // 4. Force Reprocess if previously failed/blocked/no chunks
        if (
          existingProcessingStatus === "failed" ||
          existingProcessingStatus === "blocked" ||
          existingChunksCount === 0 ||
          existingBlockReason === "low_confidence_classification" ||
          existingProcessingStatus === "unknown" ||
          existingProcessingStatus === "pending" ||
          existingReviewStatus === "rejected"
        ) {
          shouldSkip = false;
        }
        
        if (repair_metadata) {
          shouldSkip = false;
          finalDuplicateDecision = "metadata_repair";
        } else if (force_reprocess) {
          shouldSkip = false;
          finalDuplicateDecision = "reprocessed (force)";
        } else {
          finalDuplicateDecision = shouldSkip ? "skipped" : "reprocessed";
        }

        console.log(`[Duplicate Pre-skip Audit Log]`);
        console.log(`- pdf_url: ${url}`);
        console.log(`- filename: ${title || path.basename(url)}`);
        console.log(`- content_type: ${contentType}`);
        console.log(`- status_code: ${statusCode}`);
        console.log(`- byte_size: ${pdfBytes.length}`);
        console.log(`- hash: ${hash}`);
        console.log(`- existing_pdf_url: ${existingPdfUrl || "not_found"}`);
        console.log(`- source_page_url: ${sourcePageUrl}`);
        
        console.log(`[Duplicate Resolution Log]`);
        console.log(`- duplicate hash found: ${hash}`);
        console.log(`- existing document id: ${existingDocumentId || "not_found"}`);
        console.log(`- existing processing_status: ${existingProcessingStatus}`);
        console.log(`- existing review_status: ${existingReviewStatus}`);
        console.log(`- existing chunks_count: ${existingChunksCount}`);
        console.log(`- final duplicate decision: ${finalDuplicateDecision}`);
        
        if (!shouldSkip) {
          isDuplicate = false;
          duplicateOverridden = true;
        }
      } 
      
      if (!isDuplicate || duplicateOverridden) {
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

      const intakeResult = await runNvidiaIntakeAgent(
        title || url,
        contentType,
        rawText.substring(0, 1000),
        errorOccurred
      );

      let needsOcr = intakeResult.needs_ocr;
      let ocrStatus: any = needsOcr ? "needed" : "not_needed";
      extractionStatus = intakeResult.routing_decision;

      const originalTextPath = path.join(LOCAL_OUTPUT_DIR, "text", `${hash}.original.txt`);
      fs.writeFileSync(originalTextPath, rawText);

      const rawTextPath = path.join(LOCAL_OUTPUT_DIR, "text", `${hash}.raw.txt`);
      fs.writeFileSync(rawTextPath, rawText);

      const cleanTextPath = path.join(LOCAL_OUTPUT_DIR, "text", `${hash}.clean.txt`);
      fs.writeFileSync(cleanTextPath, cleanExtractedText(rawText));

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
        originalFilename: path.basename(url || "unnamed.pdf"),
        status: needsOcr ? "blocked" : "classified",
        pipelineStep: "extract",
        blockReason: needsOcr ? "ocr_needed" : "",
        technicalError: errorOccurred ? errorMsg : "",
        cleanTitle: safeTitle,
        renamePattern: fallbackName,
        metadata: {
          ...combinedMetadataAndIds,
          rawTextLength: textLen,
          textQualityScore,
          needsOcr,
          ocrStatus
        }
      });

    } catch (err: any) {
      console.error("[Pipeline Parse Fatal Error]", err);
      res.json({
        success: false,
        status: "failed",
        pipelineStep: "extract",
        blockReason: "extraction_system_failure",
        reason: err.message || "Failed to process parse pipeline stepping",
        technicalError: err.stack || String(err),
        metadata: combinedMetadataAndIds
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
    ocrEngine: process.env.OCR_ENGINE || "gemini-2.5-flash",
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
        // If it's missing, it implies it was deleted (e.g. by reset workspace). Only allow pushing strictly new 'queued' items to prevent zombie jobs from returning.
        if (itemToSave.status === "queued" || itemToSave.status === "rate_limited" || itemToSave.status === "paused") {
          queuedOcrItems.push(itemToSave);
        } else {
          console.warn(`[OCR Queue] Dropping zombie job from progress save: ${itemToSave.pdfHash}`);
          return;
        }
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

      if (ocrConfig.ocrEngine === "mistral-ocr-latest") {
        try {
          console.log(`[OCR Mistral] Triggering full PDF OCR for ${item.pdfHash} using Mistral AI`);
          const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "U2VlfgD437CjUw7gVhY4ll7EWDnRIKf2";
          const filename = `${item.pdfHash}.pdf`;
          const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);

          const part1 = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="purpose"\r\n\r\n` +
            `ocr\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: application/pdf\r\n\r\n`
          );
          const part2 = Buffer.from(`\r\n--${boundary}--\r\n`);
          const payload = Buffer.concat([part1, pdfBytes, part2]);

          console.log("[OCR Mistral] Uploading PDF to /v1/files...");
          const uploadRes = await axios.post("https://api.mistral.ai/v1/files", payload, {
            headers: {
              "Authorization": `Bearer ${MISTRAL_API_KEY}`,
              "Content-Type": `multipart/form-data; boundary=${boundary}`
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          });

          const fileId = uploadRes.data.id;
          if (!fileId) {
            throw new Error("Failed to upload file to Mistral; no ID returned.");
          }
          console.log(`[OCR Mistral] File uploaded with ID: ${fileId}. Requesting OCR...`);

          const ocrRes = await axios.post("https://api.mistral.ai/v1/ocr", {
            model: "mistral-ocr-latest",
            document: {
              type: "file_id",
              file_id: fileId
            }
          }, {
            headers: {
              "Authorization": `Bearer ${MISTRAL_API_KEY}`,
              "Content-Type": "application/json",
              "Accept": "application/json"
            }
          });

          const mistralPages = ocrRes.data.pages || [];
          console.log(`[OCR Mistral] OCR completed! Pages returned: ${mistralPages.length}`);

          item.completedPages = [];
          for (const pInfo of mistralPages) {
            const pNum = pInfo.index + 1;
            const pageText = pInfo.markdown || "";
            
            const pageTextPath = path.join(LOCAL_OUTPUT_DIR, "ocr", `${item.pdfHash}.page_${pNum}.txt`);
            fs.writeFileSync(pageTextPath, pageText);
            
            if (!item.completedPages.includes(pNum)) {
              item.completedPages.push(pNum);
            }
          }
          item.totalPages = mistralPages.length;
          item.currentPage = item.totalPages;
          item.estimatedRemainingPages = 0;
          item.updatedAt = new Date().toISOString();

          let assembledText = "";
          for (let pCheck = 1; pCheck <= item.totalPages; pCheck++) {
            const pPath = path.join(LOCAL_OUTPUT_DIR, "ocr", `${item.pdfHash}.page_${pCheck}.txt`);
            if (fs.existsSync(pPath)) {
              assembledText += `--- PAGE ${pCheck} ---\n` + fs.readFileSync(pPath, "utf8") + "\n\n";
            }
          }
          fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "ocr", `${item.pdfHash}.ocr.txt`), assembledText);
          fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "text", `${item.pdfHash}.original.txt`), assembledText);
          fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "text", `${item.pdfHash}.raw.txt`), assembledText);
          fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "text", `${item.pdfHash}.clean.txt`), cleanExtractedText(assembledText));

          item.status = "done";
          item.errorMessage = undefined;
          item.delayCountdown = 0;
          saveOcrProgressLocally(item);

          try {
            await axios.delete(`https://api.mistral.ai/v1/files/${fileId}`, {
              headers: { "Authorization": `Bearer ${MISTRAL_API_KEY}` }
            });
            console.log(`[OCR Mistral] Deleted temporary file: ${fileId}`);
          } catch (delErr: any) {
            console.warn("[OCR Mistral] Failed to delete temporary file:", delErr.message);
          }

          updateReport("ocr-report.json", {
            hash: item.pdfHash,
            rawOcrLen: item.totalPages * 500,
            cleanLen: item.totalPages * 400
          });

          return;

        } catch (err: any) {
          console.error("[OCR Mistral Exception]", err);
          item.status = "failed";
          item.errorMessage = "Mistral OCR Failed: " + (err.response?.data?.message || err.message || "Unknown error");
          saveOcrProgressLocally(item);
          return;
        }
      }

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
            const response = await callGeminiWithRetry({
              model: "gemini-2.5-flash",
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
        fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "text", `${item.pdfHash}.original.txt`), assembledText);
        fs.writeFileSync(path.join(LOCAL_OUTPUT_DIR, "text", `${item.pdfHash}.raw.txt`), assembledText);
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
      ocrEngine,
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

    if (ocrEngine !== undefined) ocrConfig.ocrEngine = String(ocrEngine);
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

  app.post("/api/pipeline/chunk", async (req, res) => {
    try {
      const { hash, url, title, text } = req.body;
      if (!hash || !text) return res.status(400).json({ error: "Hash and Text required" });

      const chunks = chunkText(text);
      if (chunks.length > 0) {
        const datasetDir = path.join(LOCAL_OUTPUT_DIR, "dataset");
        if (!fs.existsSync(datasetDir)) fs.mkdirSync(datasetDir, { recursive: true });

        // Save generic chunks just for persistence before classification
        fs.writeFileSync(path.join(datasetDir, `${hash}_chunks.json`), JSON.stringify({
          hash,
          url,
          title,
          chunks,
          chunking_status: "rag_ready"
        }, null, 2));

        // Update site map to reflect chunking status
        updateReport("dataset-report.json", {
          hash,
          chunking_status: "rag_ready"
        });
      }

      res.json({ success: true, count: chunks.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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
      const grade = activeDict.grades.find((g: any) => g.id === gradeId) || { id: gradeId || "unknown", nameFr: "Unknown Grade", suffix: "unk_grade" };
      const subject = activeDict.subjects.find((s: any) => s.id === subjectId) || { id: subjectId || "unknown", nameFr: "Unknown Subject", suffix: "unk_subject" };
      const topic = activeDict.topics.find((t: any) => t.id === topicId) || { id: topicId || "unknown", nameFr: "Unknown Topic", suffix: "unk_topic" };
      const docType = activeDict.allowedDocumentTypes.find((d: any) => d.id === documentTypeId) || { id: documentTypeId || "unknown", nameFr: "Unknown Document Type", suffix: "unk_doctype" };

      const { cleanPath, cleanName, rawName } = await createCleanPdfCopy({
        hash,
        grade_label: grade.nameFr || grade.id,
        grade_slug: grade.suffix || grade.id,
        subject_label: subject.nameFr || subject.id,
        subject_slug: subject.suffix || subject.id,
        topic_label: topic.nameFr || topic.id,
        topic_slug: topic.suffix || topic.id,
        document_type_label: docType.nameFr || docType.id,
        document_type_slug: docType.suffix || docType.id,
        url,
        title
      });

      const cleanedTextContent = cleanExtractedText(text || "");

      // Ensure clean text is written to the files system output folder
      const cleanTextDir = path.join(LOCAL_OUTPUT_DIR, "text");
      if (!fs.existsSync(cleanTextDir)) {
        fs.mkdirSync(cleanTextDir, { recursive: true });
      }
      const cleanTextFilePath = path.join(cleanTextDir, `${hash}.clean.txt`);
      fs.writeFileSync(cleanTextFilePath, cleanedTextContent, "utf8");

      const shortHash = hash.substring(0, 8);
      const datasetId = `${grade.suffix || grade.id}_${subject.suffix || subject.id}_${topic.suffix || topic.id}_${docType.suffix || docType.id}_${shortHash}`.toUpperCase();

      const { levelspace } = req.body;
      let ls = levelspace || {};
      
      // Load curriculum to match modules and fill any missing curriculum names correctly
      try {
        const curIndex = await loadLevelspaceCurriculumIndex();
        const curGrade = curIndex.grades?.find((g: any) => g.id === gradeId);
        const curSubject = curIndex.subjects?.find((s: any) => s.id === subjectId);
        const curTopic = curIndex.topics?.find((t: any) => t.id === topicId);
        
        let curModule: any = null;
        if (curTopic && curTopic.module_id) {
          curModule = curIndex.modules?.find((m: any) => m.id === curTopic.module_id);
        }
        
        let curLesson = curIndex.lessons?.find((l: any) => l.id === ls.lesson_id);
        if (!curLesson && ls.lesson_id) {
          curLesson = curIndex.lessons?.find((l: any) => l.id === "add_sub_rel");
        }

        const candidateLessons = curIndex.lessons?.filter((l: any) => l.topic_id === topicId).map((l: any) => ({
          id: l.id,
          title: l.title,
          title_ar: l.title_ar
        })) || [];

        ls = {
          grade_id: ls.grade_id || gradeId,
          grade_name: ls.grade_name || curGrade?.nameFr || grade.nameFr,
          subject_id: ls.subject_id || subjectId,
          subject_name: ls.subject_name || curSubject?.nameFr || subject.nameFr,
          module_id: ls.module_id || curModule?.id || "nombres_et_calcul",
          module_name: ls.module_name || curModule?.nameFr || "Nombres et calcul",
          topic_id: ls.topic_id || topicId,
          topic_name: ls.topic_name || curTopic?.nameFr || topic.nameFr,
          lesson_id: ls.lesson_id || (curLesson ? curLesson.id : null),
          lesson_title: ls.lesson_title || (curLesson ? curLesson.title : null),
          skill_ids: ls.skill_ids || (curLesson ? curIndex.skills?.filter((s: any) => s.lesson_id === curLesson.id).map((s: any) => s.id) : []),
          objective_ids: ls.objective_ids || (curLesson ? curIndex.objectives?.filter((o: any) => o.lesson_id === curLesson.id).map((o: any) => o.id) : []),
          document_role: ls.document_role || (documentTypeId === "jadhatha" ? "pedagogical_planning_source" : (documentTypeId === "cours" ? "student_lesson_source" : "practice_source")),
          curriculum_path: ls.curriculum_path || (curLesson ? `${curGrade?.suffix || "1AC"} → ${curSubject?.nameFr || "Mathématiques"} → ${curModule?.nameFr || "Nombres et calcul"} → ${curTopic?.nameFr || "Nombres décimaux relatifs"} → ${curLesson.title}` : `${curGrade?.suffix || "1AC"} / ${curSubject?.nameFr || "Mathématiques"} / ${curTopic?.nameFr || "Nombres décimaux relatifs"}`),
          curriculum_confidence: ls.curriculum_confidence || 100,
          index_status: ls.index_status || "indexed",
          student_visible: documentTypeId === "jadhatha" ? false : (ls.student_visible ?? true),
          teacher_visible: ls.teacher_visible ?? true,
          admin_visible: ls.admin_visible ?? true,
          ai_visible: ls.ai_visible ?? true,
          ai_knowledge: documentTypeId === "jadhatha" ? true : (ls.ai_knowledge ?? false),
          knowledge_role: documentTypeId === "jadhatha" ? "pedagogical_planning" : (ls.knowledge_role || null),
          candidate_lessons: ls.candidate_lessons || candidateLessons,
          suggested_action: ls.suggested_action || null
        };
      } catch (curErr) {
        console.warn("[Clean Copy Curriculum Alignment Warn]", curErr);
      }

      const datasetRow: any = {
        "asset_id": hash,
        "source_url": url || "",
        "source_domain": url ? new URL(url).hostname : "",
        "original_filename": path.basename(url || "unnamed.pdf"),
        "clean_filename": cleanName,
        
        "levelspace_grade_id": ls.grade_id || gradeId,
        "levelspace_subject_id": ls.subject_id || subjectId,
        "levelspace_module_id": ls.module_id || "unknown",
        "levelspace_topic_id": ls.topic_id || topicId,
        "levelspace_lesson_id": ls.lesson_id || null,
        
        "levelspace_grade_name": ls.grade_name || grade.nameFr,
        "levelspace_subject_name": ls.subject_name || subject.nameFr,
        "levelspace_module_name": ls.module_name || "unknown",
        "levelspace_topic_name": ls.topic_name || topic.nameFr,
        "levelspace_lesson_title": ls.lesson_title || null,
        
        "skill_ids": ls.skill_ids || [],
        "objective_ids": ls.objective_ids || [],
        
        "document_type_id": documentTypeId || "cours",
        "document_role": ls.document_role || "student_lesson_source",
        
        "language": "ar",
        "text_source": fs.existsSync(path.join(LOCAL_OUTPUT_DIR, "ocr", `${hash}.ocr.txt`)) ? "ocr_text" : "pdf_text",
        "needs_ocr": false,
        
        "raw_text_path": `/workspace/downloads/${hash}.original.pdf`,
        "clean_text_path": `/workspace/ocr/${hash}.ocr.txt`,
        "clean_pdf_path": `/workspace/clean-pdfs/${cleanName}`,
        
        "curriculum_path": ls.curriculum_path || `${grade.id} / ${subject.id} / ${topic.id}`,
        "curriculum_confidence": ls.curriculum_confidence || 100,
        "index_status": ls.index_status || "indexed",
        
        "student_visible": ls.student_visible ?? true,
        "teacher_visible": ls.teacher_visible ?? true,
        "admin_visible": ls.admin_visible ?? true,
        "ai_visible": ls.ai_visible ?? true,
        
        "use_for_lesson_generation": ls.document_role === "student_lesson_source" || ls.document_role === "pedagogical_planning_source",
        "use_for_quiz_generation": ls.document_role === "practice_source",
        "use_for_roadmap_generation": true,
        
        "matched_terms": [],
        "matched_fields": [],
        "candidate_lessons": ls.candidate_lessons || [],
        "suggested_action": ls.suggested_action || null
      };

      // Compatibility fields for the old format (just to not break previous logic accidentally)
      datasetRow.id = datasetId;
      datasetRow.metadata = datasetRow.metadata || {};

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
        rawName,
        cleanPath,
        datasetId,
        datasetRow
      });

    } catch (err: any) {
      console.error("[Clean Copy Pipeline Error]", err);
      res.status(500).json({ error: err.message || "Failed to generate clean PDF copy" });
    }
  });

  function getDeterministicHash(url: string) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return "hash_" + Math.abs(hash).toString(36);
  }

  function mapToReportRow(pdf: any) {
    const asset_id = pdf.hash || getDeterministicHash(pdf.url || "unknown");
    const filename = pdf.originalName || pdf.filename || "scraped_document.pdf";
    const url = pdf.url || "";
    
    // Determine status and step
    let status = pdf.status || "pending";
    let step = "intake";
    let blockReason = pdf.reason || pdf.blockReason || (pdf.levelspace && pdf.levelspace.index_reason) || null;

    if (pdf.levelspace?.index_status === "indexed") {
      status = "indexed";
      step = "indexing";
    } else if (pdf.levelspace?.index_status === "needs_review") {
      status = "needs_review";
      step = "indexing";
    } else if (pdf.cleanCopyStatus === "success" || pdf.datasetRowStatus === "success") {
      status = "complete";
      step = "output";
    } else if (status === "classified") {
      step = "classification";
    } else if (pdf.extractionStatus === "success" || pdf.rawText) {
      step = "extraction";
    } else if (pdf.extractionStatus === "failed" || pdf.status === "failed") {
      status = "failed";
      step = "extraction";
    }

    if (!blockReason && status === "needs_review") {
      blockReason = "no_matching_lesson";
    }
    
    // Check missing lesson aliases
    if (!blockReason && filename.toLowerCase().includes("دروس") && !pdf.levelspace?.lesson_id) {
      blockReason = "lesson_alias_missing";
    }

    if (!blockReason && (pdf.ocrStatus === "ocr_needed" || status === "ocr_needed")) {
      blockReason = "ocr_needed";
    }

    const levelspace = pdf.levelspace || {};

    let suggestedAction = "No immediate action required. File is in active pipeline staging.";
    if (status === "indexed" || status === "complete") {
      suggestedAction = "Success: Document is mapped to Levelspace and is ready for export.";
    } else if (blockReason === "no_matching_lesson") {
      suggestedAction = "Map to Lesson: Select 'Map to Lesson' to choose an appropriate curriculum branch and resolve this index block.";
    } else if (blockReason === "multiple_candidate_lessons") {
      suggestedAction = "Disambiguate Candidates: Select 'Approve Candidate' or choose one candidate lesson directly to unblock the pipeline.";
    } else if (blockReason === "topic_not_in_curriculum") {
      suggestedAction = "Curriculum Override: Map to the nearest existing lesson or flag this topic to the curriculum alignment administrator.";
    } else if (blockReason === "module_missing") {
      suggestedAction = "Coordinate Dictionary: Define the parent framework domain in the dictionary or link this element to a Lesson node.";
    } else if (blockReason === "lesson_alias_missing") {
      suggestedAction = "Add search aliases (e.g. Arabic title variant) to the dictionary to refine automatic keyword matching.";
    } else if (blockReason === "grade_subject_mismatch") {
      suggestedAction = "Verify Mismatch: Resolve conflicts between grade designation and subjects by selecting manual grade-subject overrides.";
    } else if (blockReason === "document_type_uncertain") {
      suggestedAction = "Assign Type: Apply a manual document type override (e.g. cours vs exercices) to classify this document.";
    } else if (blockReason === "ocr_needed" || pdf.ocrStatus === "ocr_needed" || status === "ocr_needed") {
      suggestedAction = "OCR Required: Execute OCR Safe Mode to process text layers of scanned PDF imagery.";
    } else if (blockReason === "topic_filter_mismatch") {
      suggestedAction = "Reset exclusive topic boundaries, or enforce matching by using the 'Force Map Topic' override.";
    } else if (blockReason === "malformed_url") {
      suggestedAction = "Link Correction: Sanitize escaping errors/delimiters in the URL path, or skip this item.";
    } else if (blockReason === "jadhatha_needs_curriculum_mapping") {
      suggestedAction = "Jadhatha Alignment: Align the pedagogical Jadhatha sheet with the corresponding lesson node objectives.";
    } else if (status === "failed" || pdf.extractionStatus === "failed") {
      suggestedAction = "Network Retry: Trigger a retry download or inspect if the host URL is accessible and active.";
    } else if (status === "rejected") {
      suggestedAction = "Restore document: Review and restore the rejected file, or permanently delete the file from the current workspace.";
    }

    const technicalError = pdf.technicalError || (status === "failed" ? "PDF stream parsing timed out or was interrupted" : null);

    const metadata_hints = {
      original_grades: pdf.gradeId ? [pdf.gradeId] : [],
      original_subjects: pdf.subjectId ? [pdf.subjectId] : [],
      original_topics: pdf.topicId ? [pdf.topicId] : [],
      document_type_id: pdf.documentTypeId || null,
      clean_title: pdf.cleanTitle || null
    };

    const classification_result = {
      isMatch: pdf.isMatch || false,
      confidence: pdf.isMatch ? 90 : 20,
      parsedGradeId: pdf.gradeId || null,
      parsedSubjectId: pdf.subjectId || null,
      parsedTopicId: pdf.topicId || null,
      parsedDocumentTypeId: pdf.documentTypeId || null
    };

    const levelspace_index_result = {
      grade_id: levelspace.grade_id || pdf.gradeId || null,
      grade_name: levelspace.grade_name || null,
      subject_id: levelspace.subject_id || pdf.subjectId || null,
      subject_name: levelspace.subject_name || null,
      module_id: levelspace.module_id || "nombres_et_calcul",
      module_name: levelspace.module_name || "Nombres et calcul",
      topic_id: levelspace.topic_id || pdf.topicId || null,
      topic_name: levelspace.topic_name || null,
      lesson_id: levelspace.lesson_id || null,
      lesson_title: levelspace.lesson_title || null,
      curriculum_path: levelspace.curriculum_path || null,
      curriculum_confidence: levelspace.curriculum_confidence || 0,
      index_status: levelspace.index_status || (status === "indexed" ? "indexed" : "pending"),
      index_reason: blockReason,
      suggested_action: suggestedAction
    };

    return {
      "asset_id": asset_id,
      "filename": filename,
      "url": url,
      "status": status,
      "pipelineStep": step,
      "blockReason": blockReason,
      "technicalError": technicalError,
      "metadata hints": metadata_hints,
      "metadata_hints": metadata_hints,
      "classification result": classification_result,
      "classification_result": classification_result,
      "Levelspace index result": levelspace_index_result,
      "levelspace_index_result": levelspace_index_result,
      "levelspace": levelspace_index_result,
      "suggestedAction": suggestedAction
    };
  }

  function generateAllReports(stagedPdfs: any[]) {
    const reportsDir = path.join(LOCAL_OUTPUT_DIR, "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const allRows = (stagedPdfs || []).map(mapToReportRow);

    // 1. intake-report.json
    fs.writeFileSync(path.join(reportsDir, "intake-report.json"), JSON.stringify(allRows, null, 2), "utf8");

    // 2. extraction-report.json
    const extractionRows = allRows.filter((r: any) => r.pipelineStep !== "intake");
    fs.writeFileSync(path.join(reportsDir, "extraction-report.json"), JSON.stringify(extractionRows, null, 2), "utf8");

    // 3. classification-report.json
    const classificationRows = allRows.filter((r: any) => r.pipelineStep !== "intake" && r.pipelineStep !== "extraction");
    fs.writeFileSync(path.join(reportsDir, "classification-report.json"), JSON.stringify(classificationRows, null, 2), "utf8");

    // 4. indexing-report.json
    const indexingRows = allRows.filter((r: any) => r.pipelineStep === "indexing" || r.status === "needs_review" || r.status === "indexed" || r.levelspace?.lesson_id);
    fs.writeFileSync(path.join(reportsDir, "indexing-report.json"), JSON.stringify(indexingRows, null, 2), "utf8");

    // 5. blocked-items.json
    const blockedRows = allRows.filter((r: any) => r.status === "needs_review" || r.status === "blocked" || r.status === "failed" || r.status === "ocr_needed" || r.blockReason);
    fs.writeFileSync(path.join(reportsDir, "blocked-items.json"), JSON.stringify(blockedRows, null, 2), "utf8");

    // 6. output-report.json
    const outputRows = allRows.filter((r: any) => r.status === "indexed" || r.status === "complete");
    fs.writeFileSync(path.join(reportsDir, "output-report.json"), JSON.stringify(outputRows, null, 2), "utf8");

    // 7. batch-summary.json
    const summaryRows = allRows;
    const summary = {
      total_records: allRows.length,
      indexed: allRows.filter((r: any) => r.status === "indexed").length,
      needs_review: allRows.filter((r: any) => r.status === "needs_review").length,
      blocked: allRows.filter((r: any) => r.status === "blocked" || r.status === "needs_review" || r.blockReason === "ocr_needed").length,
      rejected: allRows.filter((r: any) => r.status === "rejected").length,
      failed_technical: allRows.filter((r: any) => r.status === "failed").length,
      ocr_needed: allRows.filter((r: any) => r.status === "ocr_needed" || r.blockReason === "ocr_needed").length,
      missing_lesson_aliases: allRows.filter((r: any) => r.blockReason === "lesson_alias_missing").length,
      average_confidence: allRows.length > 0 ? (allRows.reduce((acc, r) => acc + (r.levelspace?.curriculum_confidence || 0), 0) / allRows.length) : 0,
      timestamp: new Date().toISOString(),
      rows: summaryRows
    };
    fs.writeFileSync(path.join(reportsDir, "batch-summary.json"), JSON.stringify(summary, null, 2), "utf8");

    return {
      intake: allRows,
      extraction: extractionRows,
      classification: classificationRows,
      indexing: indexingRows,
      blocked: blockedRows,
      output: outputRows,
      summary: summary
    };
  }

  app.post("/api/pipeline/reports", async (req, res) => {
    try {
      const { stagedPdfs } = req.body;
      const results = generateAllReports(stagedPdfs || []);

      const downloadsDir = path.join(LOCAL_OUTPUT_DIR, "downloads");
      const cleanPdfsDir = path.join(LOCAL_OUTPUT_DIR, "clean-pdfs");
      const datasetDir = path.join(LOCAL_OUTPUT_DIR, "dataset");

      const countFiles = (dir: string, suffix: string) => {
        if (!fs.existsSync(dir)) return 0;
        return fs.readdirSync(dir).filter(f => f.endsWith(suffix)).length;
      };

      res.json({
        stats: {
          originalDownloads: countFiles(downloadsDir, ".original.pdf") || (stagedPdfs || []).length,
          cleanCopies: countFiles(cleanPdfsDir, ".pdf"),
          datasetRows: countFiles(datasetDir, ".json"),
          localRoot: LOCAL_OUTPUT_DIR
        },
        reports: {
          intake: results.intake,
          extraction: results.extraction,
          classification: results.classification,
          indexing: results.indexing,
          blocked: results.blocked,
          output: results.output,
          summary: results.summary
        }
      });
    } catch (err: any) {
      console.error("[Reports generation failed]", err);
      res.status(500).json({ error: err.message || "Failed to generate comprehensive reports" });
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
          originalDownloads: countFiles(downloadsDir, ".original.pdf"),
          cleanCopies: countFiles(cleanPdfsDir, ".pdf"),
          datasetRows: countFiles(datasetDir, ".json"),
          localRoot: LOCAL_OUTPUT_DIR
        },
        reports: {
          intake: loadReportFile("intake-report.json"),
          extraction: loadReportFile("extraction-report.json"),
          classification: loadReportFile("classification-report.json"),
          indexing: loadReportFile("indexing-report.json"),
          blocked: loadReportFile("blocked-items.json"),
          output: loadReportFile("output-report.json"),
          summary: loadReportFile("batch-summary.json")
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to aggregate statistics" });
    }
  });

  // Batch Jobs Listing Route
  app.get("/api/pipeline/batch-jobs", (req, res) => {
    const dirPath = path.join(LOCAL_OUTPUT_DIR, "reports", "batch-jobs");
    if (!fs.existsSync(dirPath)) {
      return res.json([]);
    }
    try {
      const files = fs.readdirSync(dirPath);
      const jobs = files
        .filter(f => f.endsWith(".json"))
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(dirPath, f), "utf8"));
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      res.json(jobs);
    } catch (err: any) {
      res.status(500).json({ error: `Failed to list batch jobs: ${err.message}` });
    }
  });

  // Single Batch Job Retrieve Route
  app.get("/api/pipeline/batch-job/:id", (req, res) => {
    const id = req.params.id;
    const jobPath = path.join(LOCAL_OUTPUT_DIR, "reports", "batch-jobs", `${id}.json`);
    if (!fs.existsSync(jobPath)) {
      return res.status(404).json({ error: "Batch job not found" });
    }
    try {
      const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
      res.json(job);
    } catch (err: any) {
      res.status(500).json({ error: `Failed to parse batch job: ${err.message}` });
    }
  });

  // Save Batch Job Progress Route
  app.post("/api/pipeline/batch-job", (req, res) => {
    const job = req.body;
    if (!job || !job.id) {
      return res.status(400).json({ error: "Missing job object or job ID" });
    }
    const dirPath = path.join(LOCAL_OUTPUT_DIR, "reports", "batch-jobs");
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const jobPath = path.join(dirPath, `${job.id}.json`);
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), "utf8");

    // Update batch-summary.json
    updateReport("batch-summary.json", {
      id: job.id,
      name: job.name,
      totalItems: job.totalItems,
      completed: job.completed,
      blocked: job.blocked,
      failed: job.failed,
      status: job.status,
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true });
  });

  // --- LEVELSPACE INDEXING ---
  function getField(obj: any, keys: string[]) {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return null;
  }

  function mergeWithAndEnsureDefaults(index: any) {
    const ensureEntry = (array: any[], matchFn: (item: any) => boolean, defaultObj: any) => {
      const existing = array.find(matchFn);
      if (existing) {
        for (const k of Object.keys(defaultObj)) {
          if (existing[k] === undefined || existing[k] === null) {
            existing[k] = defaultObj[k];
          }
        }
      } else {
        array.push(defaultObj);
      }
    };

    ensureEntry(index.grades, 
      (g) => {
        const id = getField(g, ["id", "grade_id"]) || "";
        const suff = getField(g, ["suffix"]) || "";
        return id.toLowerCase().includes("1ere_annee") || id.toLowerCase().includes("1ac") || suff.toUpperCase() === "1AC";
      },
      {
        id: "1ere_annee_college",
        grade_id: "1ere_annee_college",
        name_fr: "1ère Année Collège",
        nameFr: "1ère Année Collège",
        name_ar: "السنة الأولى إعدادي",
        nameAr: "السنة الأولى إعدادي",
        suffix: "1AC",
        code: "1ac"
      }
    );

    ensureEntry(index.subjects,
      (s) => {
        const id = getField(s, ["id", "subject_id"]) || "";
        const suff = getField(s, ["suffix"]) || "";
        return id.toLowerCase() === "math" || suff.toUpperCase() === "MATH";
      },
      {
        id: "math",
        subject_id: "math",
        name_fr: "Mathématiques",
        nameFr: "Mathématiques",
        name_ar: "الرياضيات",
        nameAr: "الرياضيات",
        suffix: "MATH",
        code: "math"
      }
    );

    ensureEntry(index.modules,
      (m) => {
        const id = getField(m, ["id", "module_id"]) || "";
        const nameFr = (getField(m, ["name_fr", "nameFr", "name"]) || "").toLowerCase();
        return id.toLowerCase().includes("nombre") || id.toLowerCase().includes("calcul") || nameFr.includes("nombre");
      },
      {
        id: "nombres_et_calcul",
        module_id: "nombres_et_calcul",
        name_fr: "Nombres et calcul",
        nameFr: "Nombres et calcul",
        name_ar: "الأعداد والحساب",
        nameAr: "الأعداد والحساب",
        grade_id: "1ere_annee_college",
        subject_id: "math"
      }
    );

    ensureEntry(index.topics,
      (t) => {
        const id = getField(t, ["id", "topic_id"]) || "";
        const nameFr = (getField(t, ["name_fr", "nameFr", "name"]) || "").toLowerCase();
        return id.toLowerCase().includes("decimals_rel") || nameFr.includes("décimaux relatifs") || nameFr.includes("decimaux relatifs");
      },
      {
        id: "decimals_rel",
        topic_id: "decimals_rel",
        name_fr: "Nombres décimaux relatifs",
        nameFr: "Nombres décimaux relatifs",
        name_ar: "الأعداد العشرية النسبية",
        nameAr: "الأعداد العشرية النسبية",
        subject_id: "math",
        module_id: "nombres_et_calcul"
      }
    );

    ensureEntry(index.lessons,
      (l) => {
        const id = getField(l, ["id", "lesson_id"]) || "";
        const nameFr = (getField(l, ["title", "title_fr", "name_fr", "nameFr", "name"]) || "").toLowerCase();
        return id.toLowerCase().includes("add_sub_rel") || nameFr.includes("addition et soustraction");
      },
      {
        id: "add_sub_rel",
        lesson_id: "add_sub_rel",
        title: "Addition et soustraction des nombres décimaux relatifs",
        name_fr: "Addition et soustraction des nombres décimaux relatifs",
        title_ar: "جمع و طرح الأعداد العشرية النسبية",
        name_ar: "جمع و طرح الأعداد العشرية النسبية",
        topic_id: "decimals_rel",
        module_id: "nombres_et_calcul",
        subject_id: "math",
        grade_id: "1ere_annee_college",
        aliases: [
          "جمع و طرح الأعداد العشرية النسبية",
          "جمع وطرح الأعداد العشرية النسبية",
          "addition et soustraction des nombres décimaux relatifs",
          "addition et soustraction",
          "addition soustraction decimaux relatifs"
        ]
      }
    );

    const defaultSkills = [
      { id: "add_same_sign", name: "Additionner deux nombres relatifs de même signe", lesson_id: "add_sub_rel" },
      { id: "add_diff_sign", name: "Additionner deux de signes contraires", lesson_id: "add_sub_rel" },
      { id: "sub_rel", name: "Soustraire deux nombres relatifs", lesson_id: "add_sub_rel" },
      { id: "identify_opp", name: "Identifier et utiliser l'opposé d'un nombre relatif", lesson_id: "add_sub_rel" }
    ];
    for (const sk of defaultSkills) {
      ensureEntry(index.skills, (s) => (getField(s, ["id", "skill_id"]) || "") === sk.id, sk);
    }

    const defaultObjectives = [
      { id: "obj_add_sub_rel", name: "Calculer la somme et la différence de deux nombres décimaux relatifs", lesson_id: "add_sub_rel" }
    ];
    for (const obj of defaultObjectives) {
      ensureEntry(index.objectives, (o) => (getField(o, ["id", "objective_id"]) || "") === obj.id, obj);
    }

    index.grades.forEach((g: any) => {
      g.id = getField(g, ["id", "grade_id", "code"]);
      g.nameFr = getField(g, ["nameFr", "name_fr", "name"]);
      g.nameAr = getField(g, ["nameAr", "name_ar", "title_ar"]);
      g.suffix = getField(g, ["suffix", "code"]);
    });

    index.subjects.forEach((s: any) => {
      s.id = getField(s, ["id", "subject_id", "code"]);
      s.nameFr = getField(s, ["nameFr", "name_fr", "name"]);
      s.nameAr = getField(s, ["nameAr", "name_ar", "title_ar"]);
      s.suffix = getField(s, ["suffix", "code"]);
    });

    index.modules.forEach((m: any) => {
      m.id = getField(m, ["id", "module_id", "code"]);
      m.nameFr = getField(m, ["nameFr", "name_fr", "name", "title_fr"]);
      m.nameAr = getField(m, ["nameAr", "name_ar", "title_ar"]);
      m.grade_id = getField(m, ["grade_id", "gradeId", "grade_code"]);
      m.subject_id = getField(m, ["subject_id", "subjectId", "subject_code"]);
    });

    index.topics.forEach((t: any) => {
      t.id = getField(t, ["id", "topic_id", "code"]);
      t.nameFr = getField(t, ["nameFr", "name_fr", "name", "title_fr"]);
      t.nameAr = getField(t, ["nameAr", "name_ar", "title_ar"]);
      t.subject_id = getField(t, ["subject_id", "subjectId"]);
      t.module_id = getField(t, ["module_id", "moduleId"]);
    });

    index.lessons.forEach((l: any) => {
      l.id = getField(l, ["id", "lesson_id", "code"]);
      l.title = getField(l, ["title", "title_fr", "nameFr", "name_fr", "name"]);
      l.title_ar = getField(l, ["title_ar", "nameAr", "name_ar", "titleAr"]);
      l.topic_id = getField(l, ["topic_id", "topicId"]);
      l.module_id = getField(l, ["module_id", "moduleId"]);
      l.subject_id = getField(l, ["subject_id", "subjectId"]);
      l.grade_id = getField(l, ["grade_id", "gradeId"]);
      l.aliases = getField(l, ["aliases", "search_aliases", "keywords"]) || [];
    });

    index.grades.forEach((g: any) => { g.nameFr = g.nameFr || g.nameAr || g.id; g.nameAr = g.nameAr || g.nameFr || g.id; });
    index.subjects.forEach((s: any) => { s.nameFr = s.nameFr || s.nameAr || s.id; s.nameAr = s.nameAr || s.nameFr || s.id; });
    index.modules.forEach((m: any) => { m.nameFr = m.nameFr || m.nameAr || m.id; m.nameAr = m.nameAr || m.nameFr || m.id; });
    index.topics.forEach((t: any) => { t.nameFr = t.nameFr || t.nameAr || t.id; t.nameAr = t.nameAr || t.nameFr || t.id; });
    index.lessons.forEach((l: any) => { l.title = l.title || l.title_ar || l.id; l.title_ar = l.title_ar || l.title || l.id; });
  }

  async function loadLevelspaceCurriculumIndex() {
    const index = {
      grades: [] as any[],
      subjects: [] as any[],
      modules: [] as any[],
      topics: [] as any[],
      lessons: [] as any[],
      skills: [] as any[],
      objectives: [] as any[],
      document_types: [] as any[]
    };

    if (supabase) {
      try {
        const { data: gData, error: gErr } = await supabase.from("grades").select("*");
        if (gData && !gErr) {
          index.grades = gData;
        }
      } catch (e) {
        console.warn("[loadLevelspaceCurriculumIndex] Error loading grades from Supabase:", e);
      }

      try {
        const { data: sData, error: sErr } = await supabase.from("subjects").select("*");
        if (sData && !sErr) {
          index.subjects = sData;
        }
      } catch (e) {
        console.warn("[loadLevelspaceCurriculumIndex] Error loading subjects from Supabase:", e);
      }

      const prefModuleTables = ["modules", "domains", "topic_domain_overview", "topic_outlines", "lesson_tracks", "topic_material_requirements"];
      for (const tbl of prefModuleTables) {
        try {
          const { data: mData, error: mErr } = await supabase.from(tbl).select("*");
          if (mData && !mErr && mData.length > 0) {
            index.modules = mData;
            break;
          }
        } catch {}
      }

      try {
        const { data: tData, error: tErr } = await supabase.from("topics").select("*");
        if (tData && !tErr) {
          index.topics = tData;
        } else {
          const { data: tSingleData, error: tSingleErr } = await supabase.from("topic").select("*");
          if (tSingleData && !tSingleErr) index.topics = tSingleData;
        }
      } catch (e) {
        console.warn("[loadLevelspaceCurriculumIndex] Error loading topics from Supabase:", e);
      }

      try {
        const { data: lData, error: lErr } = await supabase.from("lessons").select("*");
        if (lData && !lErr) {
          index.lessons = lData;
        } else {
          const { data: lSingleData, error: lSingleErr } = await supabase.from("lesson").select("*");
          if (lSingleData && !lSingleErr) index.lessons = lSingleData;
        }
      } catch (e) {
        console.warn("[loadLevelspaceCurriculumIndex] Error loading lessons from Supabase:", e);
      }

      try {
        const { data: skData, error: skErr } = await supabase.from("skills").select("*");
        if (skData && !skErr) {
          index.skills = skData;
        }
      } catch (e) {
        console.warn("[loadLevelspaceCurriculumIndex] Error loading skills from Supabase:", e);
      }

      try {
        const { data: oData, error: oErr } = await supabase.from("objectives").select("*");
        if (oData && !oErr) {
          index.objectives = oData;
        }
      } catch (e) {
        console.warn("[loadLevelspaceCurriculumIndex] Error loading objectives from Supabase:", e);
      }

      try {
        const { data: dtData, error: dtErr } = await supabase.from("document_types").select("*");
        if (dtData && !dtErr) {
          index.document_types = dtData;
        }
      } catch (e) {
        console.warn("[loadLevelspaceCurriculumIndex] Error loading document_types from Supabase:", e);
      }
    }

    mergeWithAndEnsureDefaults(index);
    return index;
  }

  async function indexPdfToLevelspace(params: {
    sourceUrl: string;
    originalFilename: string;
    cleanText: string;
    metadataHints?: any;
    classification?: any;
    curriculumIndex: any;
  }) {
    const { sourceUrl, originalFilename, cleanText, metadataHints, classification, curriculumIndex } = params;

    const normFilename = (originalFilename || "").toLowerCase();
    const normUrl = (sourceUrl || "").toLowerCase();
    const normText = (cleanText || "").trim().toLowerCase();

    const isJadhatha = isJadhathaString(originalFilename) || 
                       isJadhathaString(sourceUrl) ||
                       (metadataHints?.documentTypeId === "jadhatha") ||
                       (classification?.documentTypeId === "jadhatha");

    let matchedLesson: any = null;

    for (const l of curriculumIndex.lessons) {
      const lTitleFr = (l.title || "").toLowerCase();
      const lTitleAr = (l.title_ar || "").toLowerCase();

      const matchFound = 
        normFilename.includes(lTitleFr) || 
        normFilename.includes(lTitleAr) ||
        normUrl.includes(lTitleFr) ||
        normUrl.includes(lTitleAr) ||
        (l.aliases && l.aliases.some((alias: string) => {
          const normAlias = alias.toLowerCase();
          return normFilename.includes(normAlias) || normUrl.includes(normAlias);
        }));

      if (matchFound) {
        matchedLesson = l;
        break;
      }
    }

    if (!matchedLesson) {
      if (
        (normFilename.includes("الأعداد") && normFilename.includes("العشرية") && normFilename.includes("النسبية") && (normFilename.includes("جمع") || normFilename.includes("طرح"))) ||
        (normText.includes("جمع و طرح") && normText.includes("الأعداد العشرية النسبية")) ||
        (normText.includes("الأعداد العشرية") && normText.includes("النسبية") && (normText.includes("جمع") || normText.includes("طرح")))
      ) {
        matchedLesson = curriculumIndex.lessons.find((l: any) => l.id === "add_sub_rel");
      }
    }

    let aiResult: any = null;
    let confidence = 0;

    if (matchedLesson) {
      confidence = 90;
      aiResult = {
        gradeId: matchedLesson.grade_id || "1ere_annee_college",
        subjectId: matchedLesson.subject_id || "math",
        moduleId: matchedLesson.module_id || "nombres_et_calcul",
        topicId: matchedLesson.topic_id || "decimals_rel",
        lessonId: matchedLesson.id,
        confidence: 90,
        reason: "Deterministic keyword match found for lesson: " + matchedLesson.title
      };
    } else {
      try {
        const gradesList = curriculumIndex.grades.map((g: any) => `- Name: ${g.nameFr} (Arabic: ${g.nameAr}), ID: ${g.id}, Suffix: ${g.suffix}`).join("\n");
        const subjectsList = curriculumIndex.subjects.map((s: any) => `- Name: ${s.nameFr} (Arabic: ${s.nameAr}), ID: ${s.id}, Suffix: ${s.suffix}`).join("\n");
        const modulesList = curriculumIndex.modules.map((m: any) => `- Name: ${m.nameFr} (Arabic: ${m.nameAr}), ID: ${m.id}, Subject ID: ${m.subject_id}, Grade ID: ${m.grade_id}`).join("\n");
        const topicsList = curriculumIndex.topics.map((t: any) => `- Name: ${t.nameFr} (Arabic: ${t.nameAr}), ID: ${t.id}, Module ID: ${t.module_id}, Subject ID: ${t.subject_id}`).join("\n");
        const lessonsList = curriculumIndex.lessons.map((l: any) => `- Title: ${l.title} (Arabic: ${l.title_ar}), ID: ${l.id} (Topic ID: ${l.topic_id}), Aliases: ${JSON.stringify(l.aliases)}`).join("\n");

        const prompt = `Analyze the following document metadata and text content to index it into the Levelspace Curriculum.

Document details:
- Title/Filename: "${originalFilename || ""}"
- Source URL: "${sourceUrl || ""}"
- Text Snippet: "${(cleanText || "").substring(0, 1500)}"
- Classification Hints: ${JSON.stringify(classification || metadataHints || {})}

Levelspace Curriculum structure:

GRADES available:
${gradesList}

SUBJECTS available:
${subjectsList}

MODULES available:
${modulesList}

TOPICS available:
${topicsList}

LESSONS available:
${lessonsList}

YOUR CORE TASK:
Identify the precise Grade, Subject, Module, Topic, and Lesson where this document belongs.
CRITICAL: When matching the document, strongly consider conceptual variations, synonyms, and cross-language translations (e.g., "mathematics/calculus" = math, "الدوال" = functions). Match semantically even if the exact string isn't an alias.
If the exact lesson is missing or cannot be confidently matched against any lesson from the LESSONS available list, set lessonId to null and describe the issue in the reason.

Provide your output strictly as a JSON object with these fields:
1. "gradeId": (string or null) The ID of the matching Grade
2. "subjectId": (string or null) The ID of the matching Subject
3. "moduleId": (string or null) The ID of the matching Module
4. "topicId": (string or null) The ID of the matching Topic
5. "lessonId": (string or null) The ID of the matching Lesson from the provided lessons list; set to null if no lesson matches or if exact match/alias is missing.
6. "confidence": (number, 0 to 100) How confident are you in this mapping?
7. "reason": (string) Brief analytical rationale explaining the mapping or why the lesson is missing.

Respond strictly with valid JSON. Do not include markdown block fences or conversational text wrapper outside the JSON representation.`;

        const response = await callGeminiWithRetry({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json"
          }
        });

        const textRes = response.text || "{}";
        const parsed = safeJsonParseJsonObject(textRes);
        if (parsed) {
          aiResult = parsed;
          confidence = parsed.confidence || 50;
        }
      } catch (err: any) {
        console.error("[indexPdfToLevelspace] Gemini Indexing failed:", err);
        const errMsg = err.message || "";
        const isRateLimit = errMsg.includes("429") || 
                           errMsg.toLowerCase().includes("quota exceeded") || 
                           errMsg.toLowerCase().includes("rate limit") || 
                           errMsg.toLowerCase().includes("resource exhausted") || 
                           errMsg.toLowerCase().includes("too many requests") ||
                           JSON.stringify(err).toLowerCase().includes("quota");

        aiResult = {
          reason: isRateLimit 
            ? "Gemini API Quota/Rate Limit Exceeded. Default reference matching rules applied in fallback." 
            : `Gemini Indexing failed: ${err.message}`
        };
      }
    }

    aiResult = aiResult || {};
    let levelspaceGradeId = aiResult.gradeId || classification?.gradeId || metadataHints?.gradeId || "1ere_annee_college";
    let levelspaceSubjectId = aiResult.subjectId || classification?.subjectId || metadataHints?.subjectId || "math";
    let levelspaceModuleId = aiResult.moduleId || "nombres_et_calcul";
    let levelspaceTopicId = aiResult.topicId || classification?.topicId || metadataHints?.topicId || "decimals_rel";
    let levelspaceLessonId = aiResult.lessonId || null;
    let indexReason = aiResult.reason || null;

    const gradeExists = curriculumIndex.grades.some((g: any) => g.id === levelspaceGradeId);
    if (!gradeExists) levelspaceGradeId = "1ere_annee_college";

    const subjectExists = curriculumIndex.subjects.some((s: any) => s.id === levelspaceSubjectId);
    if (!subjectExists) levelspaceSubjectId = "math";

    const topicExists = curriculumIndex.topics.some((t: any) => t.id === levelspaceTopicId);
    if (!topicExists) levelspaceTopicId = "decimals_rel";

    const moduleExists = curriculumIndex.modules.some((m: any) => m.id === levelspaceModuleId);
    if (!moduleExists) levelspaceModuleId = "nombres_et_calcul";

    if (
      !levelspaceLessonId && 
      (normFilename.includes("النسبية") || normText.includes("النسبية") || normFilename.includes("add_sub_rel") || normFilename.includes("decimaux"))
    ) {
      levelspaceLessonId = "add_sub_rel";
      confidence = 90;
    }

    let lessonItem = curriculumIndex.lessons.find((l: any) => l.id === levelspaceLessonId);
    if (!lessonItem && levelspaceLessonId) {
      lessonItem = curriculumIndex.lessons.find((l: any) => l.id === "add_sub_rel");
      if (lessonItem) {
        levelspaceLessonId = "add_sub_rel";
      } else {
        levelspaceLessonId = null;
      }
    }

    let curriculumPath = null;
    let skillIds: string[] = [];
    let objectiveIds: string[] = [];

    if (levelspaceLessonId) {
      skillIds = curriculumIndex.skills
        .filter((s: any) => s.lesson_id === levelspaceLessonId)
        .map((s: any) => s.id);
      objectiveIds = curriculumIndex.objectives
        .filter((o: any) => o.lesson_id === levelspaceLessonId)
        .map((o: any) => o.id);
    }

    const gradeObj = curriculumIndex.grades.find((g: any) => g.id === levelspaceGradeId);
    const subjectObj = curriculumIndex.subjects.find((s: any) => s.id === levelspaceSubjectId);
    const moduleObj = curriculumIndex.modules.find((m: any) => m.id === levelspaceModuleId);
    const topicObj = curriculumIndex.topics.find((t: any) => t.id === levelspaceTopicId);

    const suffix = gradeObj?.suffix || "1AC";
    const subName = subjectObj?.nameFr || "Mathématiques";
    const modName = moduleObj?.nameFr || "Nombres et calcul";
    const topName = topicObj?.nameFr || "Nombres décimaux relatifs";
    const lesName = lessonItem?.title || "Addition et soustraction des nombres décimaux relatifs";

    curriculumPath = `${suffix} → ${subName} → ${modName} → ${topName} → ${lesName}`;

    let indexStatus: "indexed" | "needs_review" | "blocked" = "indexed";
    let suggestedAction = null;

    if (!levelspaceLessonId) {
      indexStatus = "needs_review";
      indexReason = isJadhatha ? "jadhatha_needs_curriculum_mapping" : "lesson_alias_missing";
      suggestedAction = isJadhatha ? "Align pedagogical planning sheet with lesson objectives" : "map to existing lesson or add alias";
      curriculumPath = null;
    } else {
      if (confidence >= 85) {
        indexStatus = "indexed";
      } else if (confidence >= 60) {
        indexStatus = "needs_review";
        indexReason = "low_indexing_confidence";
        suggestedAction = "verify suggested path mapping";
      } else {
        indexStatus = "blocked";
        indexReason = "curriculum_mapping_failed";
        suggestedAction = "manually map curriculum node";
      }
    }

    const candidateLessons = curriculumIndex.lessons
      .filter((l: any) => l.topic_id === levelspaceTopicId || l.subject_id === levelspaceSubjectId)
      .map((l: any) => ({
        id: l.id,
        title: l.title,
        title_ar: l.title_ar
      }));

    const candidateTopics = curriculumIndex.topics
      .filter((t: any) => t.subject_id === levelspaceSubjectId)
      .map((t: any) => ({
        id: t.id,
        name: t.nameFr,
        name_ar: t.nameAr
      }));

    return {
      levelspaceGradeId,
      levelspaceSubjectId,
      levelspaceModuleId,
      levelspaceTopicId,
      levelspaceLessonId,
      skillIds,
      objectiveIds,
      curriculumPath,
      curriculumConfidence: confidence,
      indexStatus,
      indexReason,
      candidateLessons,
      candidateTopics,
      suggestedAction,
      isJadhatha
    };
  }

  app.get("/api/levelspace/curriculum", async (req, res) => {
    try {
      const curriculumIndex = await loadLevelspaceCurriculumIndex();
      res.json(curriculumIndex);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load Levelspace curriculum index" });
    }
  });

  app.post("/api/pipeline/index-levelspace", async (req, res) => {
    try {
      const { url, filename, text, hints, classification } = req.body;
      
      const curriculumIndex = await loadLevelspaceCurriculumIndex();

      const indexingResult = await indexPdfToLevelspace({
        sourceUrl: url,
        originalFilename: filename,
        cleanText: text,
        metadataHints: hints,
        classification,
        curriculumIndex
      });

      let documentRole = "student_lesson_source";
      let studentVisible = true;
      let teacherVisible = true;
      let adminVisible = true;
      let aiVisible = true;
      let aiKnowledge = false;
      let knowledgeRole: string | null = null;

      const isJadhatha = isJadhathaString(filename) || 
                         isJadhathaString(url) || 
                         (hints?.documentTypeId === "jadhatha") || 
                         (classification?.documentTypeId === "jadhatha") || 
                         (indexingResult as any).isJadhatha;

      let docTypeId = isJadhatha ? "jadhatha" : (hints?.documentTypeId || classification?.documentTypeId || "").toLowerCase();
      if (!docTypeId && indexingResult.levelspaceLessonId) {
        docTypeId = "cours";
      }

      if (isJadhatha || docTypeId.includes("jadhatha") || docTypeId.includes("fiche")) {
        documentRole = "pedagogical_planning_source";
        studentVisible = false;
        aiKnowledge = true;
        knowledgeRole = "pedagogical_planning";
      } else if (docTypeId.includes("cours") || docTypeId.includes("lesson") || docTypeId.includes("lecon") || docTypeId.includes("crs")) {
        documentRole = "student_lesson_source";
      } else if (docTypeId.includes("exerc") || docTypeId.includes("series") || docTypeId.includes("ex")) {
        documentRole = "practice_source";
      } else if (docTypeId.includes("corr") || docTypeId.includes("solution") || docTypeId.includes("sol")) {
        documentRole = "solution_source";
      } else if (docTypeId.includes("forod") || docTypeId.includes("exam") || docTypeId.includes("ass") || docTypeId.includes("exm")) {
        documentRole = "assessment_source";
      }

      const gradeObj = curriculumIndex.grades.find((g: any) => g.id === indexingResult.levelspaceGradeId);
      const subjectObj = curriculumIndex.subjects.find((s: any) => s.id === indexingResult.levelspaceSubjectId);
      const moduleObj = curriculumIndex.modules.find((m: any) => m.id === indexingResult.levelspaceModuleId);
      const topicObj = curriculumIndex.topics.find((t: any) => t.id === indexingResult.levelspaceTopicId);
      const lessonObj = curriculumIndex.lessons.find((l: any) => l.id === indexingResult.levelspaceLessonId);

      const levelspace = {
        grade_id: indexingResult.levelspaceGradeId,
        grade_name: gradeObj?.nameFr || "1ère Année Collège",
        subject_id: indexingResult.levelspaceSubjectId,
        subject_name: subjectObj?.nameFr || "Mathématiques",
        module_id: indexingResult.levelspaceModuleId,
        module_name: moduleObj?.nameFr || "Nombres et calcul",
        topic_id: indexingResult.levelspaceTopicId,
        topic_name: topicObj?.nameFr || "Nombres décimaux relatifs",
        lesson_id: indexingResult.levelspaceLessonId,
        lesson_title: lessonObj?.title || null,
        skill_ids: indexingResult.skillIds,
        objective_ids: indexingResult.objectiveIds,
        curriculum_path: indexingResult.curriculumPath,
        curriculum_confidence: indexingResult.curriculumConfidence,
        index_status: indexingResult.indexStatus,
        index_reason: indexingResult.indexReason,
        document_role: documentRole,
        student_visible: studentVisible,
        teacher_visible: teacherVisible,
        admin_visible: adminVisible,
        ai_visible: aiVisible,
        ai_knowledge: aiKnowledge,
        knowledge_role: knowledgeRole,
        candidate_lessons: indexingResult.candidateLessons,
        candidate_topics: indexingResult.candidateTopics,
        suggested_action: indexingResult.suggestedAction
      };

      const hash = crypto.createHash("sha256").update(url || filename || "unknown").digest("hex");
      updateReport("indexing-report.json", {
        asset_id: hash,
        filename,
        status: indexingResult.indexStatus,
        curriculum_path: indexingResult.curriculumPath,
        confidence: indexingResult.curriculumConfidence,
        grade_id: levelspace.grade_id,
        subject_id: levelspace.subject_id,
        module_id: levelspace.module_id,
        topic_id: levelspace.topic_id,
        lesson_id: levelspace.lesson_id,
        candidate_lessons: indexingResult.candidateLessons,
        missing_level: !indexingResult.levelspaceLessonId ? "lesson" : null,
        suggested_action: indexingResult.suggestedAction
      });

      res.json({ success: true, levelspace });
    } catch (error: any) {
      console.error("[Index Levelspace Handled Fail-Safe]", error);
      res.json({
        success: false,
        status: "needs_review",
        pipelineStep: "index_levelspace",
        blockReason: "index_failed",
        reason: error.message || "Failed to map curriculum",
        levelspace: {
          grade_id: "1ac",
          subject_id: "math",
          index_status: "needs_review",
          index_reason: "system_failed",
          curriculum_confidence: 0,
          curriculum_path: null
        }
      });
    }
  });

  // Generic Report Entry Update Endpoint
  app.post("/api/pipeline/reports/update", (req, res) => {
    const { reportName, entry } = req.body;
    if (!reportName || !entry) {
      return res.status(400).json({ error: "reportName and entry are required" });
    }
    try {
      updateReport(reportName, entry);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      const isInline = req.query.inline === 'true';
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${isInline ? 'inline' : 'attachment'}; filename="${matchedFile}"`);
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

  app.get("/api/pipeline/dataset-rows", (req, res) => {
    const datasetDir = path.join(LOCAL_OUTPUT_DIR, "dataset");
    if (!fs.existsSync(datasetDir)) {
      return res.json([]);
    }
    try {
      const files = fs.readdirSync(datasetDir);
      const rows = files
        .filter(f => f.endsWith(".json") && f !== "gdrive_syncs.json" && f !== "gdrive_migration.json")
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(datasetDir, f), "utf-8"));
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
      return res.json(rows);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Failed to load database rows schema" });
    }
  });

  app.get("/api/pipeline/export-zip", async (req, res) => {
    try {
      const zip = new JSZip();

      const addDirToZip = (localDirName: string, zipDirName: string) => {
        const fullPath = path.join(LOCAL_OUTPUT_DIR, localDirName);
        if (fs.existsSync(fullPath)) {
          const files = fs.readdirSync(fullPath);
          for (const file of files) {
            const filePath = path.join(fullPath, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
              zip.file(`${zipDirName}/${file}`, fs.readFileSync(filePath));
            }
          }
        }
      };

      addDirToZip("downloads", "original");
      addDirToZip("clean-pdfs", "clean");
      addDirToZip("text", "text");
      addDirToZip("dataset", "dataset");
      addDirToZip("reports", "reports");

      const buffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", "attachment; filename=levelspace_ready_outputs.zip");
      return res.send(buffer);
    } catch (err: any) {
      console.error("[Export ZIP Error]", err);
      return res.status(500).json({ error: err.message || "Failed to generate ZIP archive" });
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

  // Site Mapping Database schema & helper functions (Tasks 1, 2, 3, 4, 5, 6, 8)
  
  interface SiteMapNode {
    id: string;
    source_domain: string;
    source_url: string;
    canonical_url: string;
    canonical_url_hash: string;
    parent_url: string | null;
    depth: number;
    page_role: string;
    navigation_path: string;
    extracted_grade: string;
    extracted_subject: string;
    extracted_document_type: string;
    extracted_topic: string;
    action: "crawl_children" | "stage_asset" | "reexamine" | "ignore" | string;
    status: "unvisited" | "crawling" | "completed" | "failed" | "ignored" | "rejected" | "needs_review" | string;
    discovered_links_count: number;
    confidence: number;
    rejection_reason: string;
    is_final_asset: boolean;
    validation_errors?: string[];
    target_grade_id?: string;
    target_subject_id?: string;
    target_module_id?: string | null;
    target_lesson_id?: string | null;
    verification_status?: string;
    hash?: string;
    raw_file_hash?: string;
    processing_status?: string;
    review_status?: string;
    block_reason?: string;
    blockReason?: string;
  }

  function classifyDocumentTypeWithPriority(urlStr: string, textContext: string = ""): string {
    const combined = `${urlStr || ""} ${textContext || ""}`.toLowerCase();
    
    if (combined.includes("non-corrige") || combined.includes("non-corriges") || combined.includes("non-corrigé") || combined.includes("غير مصحح")) {
      return "Exercices";
    }
    if (combined.includes("corrige") || combined.includes("correction") || combined.includes("تصحيح") || combined.includes("corriges") || combined.includes("corrig") || combined.includes("حلول")) {
      return "Correction";
    }
    if (combined.includes("devoir") || combined.includes("controle") || combined.includes("فرض") || combined.includes("contrôle")) {
      return "Devoir";
    }
    if (combined.includes("resume") || combined.includes("carte-mentale") || combined.includes("ملخص")) {
      return "Resume";
    }
    if (combined.includes("exercices") || combined.includes("serie") || combined.includes("activites") || combined.includes("تمارين") || combined.includes("سلسلة") || combined.includes("serie")) {
      return "Exercices";
    }
    if (combined.includes("cours") || combined.includes("lesson") || combined.includes("lecon") || combined.includes("درس")) {
      return "Course";
    }
    return "Course"; // Fallback
  }

  function checkNavigationPathConflict(navigationPath: string, grade: string, subject: string): { conflicted: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!navigationPath) return { conflicted: false, errors };

    const navLower = navigationPath.toLowerCase();

    // Islamic vs Math/PC/SVT/French subject conflict
    const isIslamicNav = navLower.includes("islam") || navLower.includes("إسلام") || navLower.includes("اسلام");
    if (isIslamicNav) {
      const subLower = (subject || "").toLowerCase();
      if (subLower === "math" || subLower === "pc" || subLower === "svt" || subLower === "french" || subLower === "physique" || subLower === "chimie") {
        errors.push("navigation_subject_conflict");
      }
    }

    // General subject mismatch
    if (navLower.includes("رياضيات") || navLower.includes("math")) {
      const subLower = (subject || "").toLowerCase();
      if (subLower && subLower !== "math" && subLower !== "mathematics" && subLower !== "pc" && subLower !== "physique") {
        errors.push("navigation_subject_conflict");
      }
    }
    if (navLower.includes("فيزياء") || navLower.includes("physique") || navLower.includes(" pc ")) {
      const subLower = (subject || "").toLowerCase();
      if (subLower && subLower !== "pc" && subLower !== "physique" && subLower !== "math") {
        errors.push("navigation_subject_conflict");
      }
    }
    if (navLower.includes("علوم الحياة") || navLower.includes("svt")) {
      const subLower = (subject || "").toLowerCase();
      if (subLower && subLower !== "svt") {
        errors.push("navigation_subject_conflict");
      }
    }

    // Grade mismatch
    if (navLower.includes("3ac") || navLower.includes("ثالثة اعدادي") || navLower.includes("3eme") || navLower.includes("3ème")) {
      if (grade && grade !== "3AC" && grade !== "3eme_annee_college") {
        errors.push("navigation_grade_conflict");
      }
    }
    if (navLower.includes("2ac") || navLower.includes("ثانية اعدادي") || navLower.includes("2eme") || navLower.includes("2ème")) {
      if (grade && grade !== "2AC" && grade !== "2eme_annee_college") {
        errors.push("navigation_grade_conflict");
      }
    }
    if (navLower.includes("1ac") || navLower.includes("اولى اعدادي") || navLower.includes("1eme") || navLower.includes("1ème")) {
      if (grade && grade !== "1AC" && grade !== "1ere_annee_college") {
        errors.push("navigation_grade_conflict");
      }
    }

    return {
      conflicted: errors.length > 0,
      errors
    };
  }

  function mapExtractedGradeToId(grade: string, activeDict: any): string | null {
    if (!grade || grade === "-") return null;
    const match = activeDict.grades?.find((g: any) => 
      g.id === grade || g.suffix === grade || g.nameFr === grade || g.nameAr === grade
    );
    return match ? match.id : null;
  }

  function mapExtractedSubjectToId(subject: string, activeDict: any): string | null {
    if (!subject || subject === "-") return null;
    const match = activeDict.subjects?.find((s: any) => 
      s.id === subject || s.suffix === subject || s.nameFr === subject || s.nameAr === subject
    );
    return match ? match.id : null;
  }

  function mapExtractedTopicToId(topic: string, activeDict: any): string | null {
    if (!topic || topic === "-" || topic === "General-Topic") return null;
    const match = activeDict.topics?.find((t: any) => 
      t.id === topic || t.suffix === topic || t.nameFr === topic || t.nameAr === topic || (t.keywords && t.keywords.some((kw: string) => kw.toLowerCase() === topic.toLowerCase()))
    );
    return match ? match.id : null;
  }

  function populatePdfAssetTargetFields(node: SiteMapNode, activeDict: any) {
    if (node.page_role === "pdf_asset" || node.is_final_asset) {
      node.target_grade_id = mapExtractedGradeToId(node.extracted_grade, activeDict) || undefined;
      node.target_subject_id = mapExtractedSubjectToId(node.extracted_subject, activeDict) || undefined;
      node.target_module_id = null;
      node.target_lesson_id = mapExtractedTopicToId(node.extracted_topic, activeDict) || null;
      node.source_url = node.source_url || node.canonical_url;
      node.canonical_url = node.canonical_url;
      node.verification_status = node.verification_status || "pending";
    }
  }

  function canonicalizeUrl(urlStr: string): string {
    if (!urlStr) return "";
    try {
      let resolved = String(urlStr).trim();
      try {
        resolved = decodeURIComponent(resolved);
      } catch {}
      try {
        resolved = decodeURIComponent(resolved);
      } catch {}
      
      const obj = new URL(resolved);
      obj.hash = ""; // remove fragment
      
      const searchParams = Array.from(obj.searchParams.entries());
      if (searchParams.length > 0) {
        searchParams.sort(([a], [b]) => a.localeCompare(b));
        obj.search = "";
        searchParams.forEach(([k, v]) => {
          obj.searchParams.set(k, v);
        });
      }
      
      let pathName = obj.pathname;
      if (pathName.length > 1 && !pathName.split("/").pop()?.includes(".")) {
        if (!pathName.endsWith("/")) {
          pathName += "/";
        }
      }
      obj.pathname = pathName;
      return obj.href;
    } catch {
      return String(urlStr).trim();
    }
  }

  function getCanonicalUrlHash(urlStr: string): string {
    const canonical = canonicalizeUrl(urlStr);
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  function classifyPageUrlRole(urlStr: string, htmlContent: string = "", linkText: string = "", parentRole?: string, parentMetadata?: any): {
    role: string;
    action: "crawl_children" | "stage_asset" | "ignore";
    grade: string;
    subject: string;
    docType: string;
    topic: string;
    confidence: number;
    rejectionReason: string;
    isFinal: boolean;
  } {
    const canonical = canonicalizeUrl(urlStr);
    let urlLower = canonical.toLowerCase();
    try {
      urlLower = decodeURIComponent(urlLower);
    } catch (e) {
      // Ignored
    }
    
    let role = "unknown";
    let action: "crawl_children" | "stage_asset" | "ignore" = "crawl_children";
    let grade = "";
    let subject = "";
    let docType = "Cours";
    let topic = "";
    let confidence = 0.5;
    let rejectionReason = "";
    let isFinal = false;

    // 1. Grade extraction
    if (urlLower.includes("1ap") || urlLower.includes("الاول-ابتدائي") || urlLower.includes("الأول-ابتدائي")) {
      grade = "1AEP";
    } else if (urlLower.includes("2ap") || urlLower.includes("الثاني-ابتدائي") || urlLower.includes("الثانية-ابتدائي")) {
      grade = "2AEP";
    } else if (urlLower.includes("3ap") || urlLower.includes("الثالث-ابتدائي") || urlLower.includes("الثالثة-ابتدائي")) {
      grade = "3AEP";
    } else if (urlLower.includes("4ap") || urlLower.includes("الرابع-ابتدائي") || urlLower.includes("الرابعة-ابتدائي")) {
      grade = "4AEP";
    } else if (urlLower.includes("5ap") || urlLower.includes("الخامس-ابتدائي") || urlLower.includes("الخامسة-ابتدائي")) {
      grade = "5AEP";
    } else if (urlLower.includes("6ap") || urlLower.includes("السادس-ابتدائي") || urlLower.includes("السادسة-ابتدائي")) {
      grade = "6AEP";
    } else if (urlLower.includes("1ac") || urlLower.includes("1ere-annee-college") || urlLower.includes("الاولى-اعدادي") || urlLower.includes("الأولى-إعدادي") || urlLower.includes("1ere_annee_college")) {
      grade = "1AC";
    } else if (urlLower.includes("2ac") || urlLower.includes("2eme-annee-college") || urlLower.includes("الثانية-إعدادي") || urlLower.includes("2eme_annee_college")) {
      grade = "2AC";
    } else if (urlLower.includes("3ac") || urlLower.includes("3eme-annee-college") || urlLower.includes("الثالثة-إعدادي") || urlLower.includes("3eme_annee_college")) {
      grade = "3AC";
    } else if (urlLower.includes("tcs") || urlLower.includes("tronc-commun") || urlLower.includes("الجذع-المشترك")) {
      grade = "TC";
    } else if (urlLower.includes("1bac") || urlLower.includes("السنة-الأولى-بكالوريا") || urlLower.includes("1ere-bac") || urlLower.includes("الاولى-باك")) {
      grade = "1BAC";
    } else if (urlLower.includes("2bac") || urlLower.includes("السنة-الثانية-بكالوريا") || urlLower.includes("2eme-bac") || urlLower.includes("الثانية-باك")) {
      grade = "2BAC";
    }

    // 2. Subject extraction
    if (urlLower.includes("math") || urlLower.includes("رياضيات") || urlLower.includes("mathematiques") || urlLower.includes("الرياضيات")) {
      subject = "Math";
    } else if (urlLower.includes("pc") || urlLower.includes("physique") || urlLower.includes("chimie") || urlLower.includes("علوم-الكيمياء") || urlLower.includes("الفيزياء-والكيمياء")) {
      subject = "PC";
    } else if (urlLower.includes("svt") || urlLower.includes("علوم-الحياة-والأرض") || urlLower.includes("sciences-vie-terre")) {
      subject = "SVT";
    } else if (urlLower.includes("francais") || urlLower.includes("français") || urlLower.includes("french") || urlLower.includes("فرنسي")) {
      subject = "French";
    }

    if (parentMetadata) {
      if (!grade && parentMetadata.grade) grade = parentMetadata.grade;
      if (!subject && parentMetadata.subject) subject = parentMetadata.subject;
      if (parentMetadata.docType) docType = parentMetadata.docType;
    }

    // 3. Document Type mapping
    docType = classifyDocumentTypeWithPriority(urlLower, `${linkText} ${htmlContent}`);

    // 4. News / Administrative Announcements Filter (Task 8)
    const isNewsAnnouncements = urlLower.includes("دخول-مدرسي") || urlLower.includes("نتائج") || urlLower.includes("تسجيل") || urlLower.includes("منحة") || urlLower.includes("توجيه") || urlLower.includes("مباراة") ||
      linkText.includes("تاريخ الدخول المدرسي") || linkText.includes("نتائج") || linkText.includes("تسجيل") || linkText.includes("منحة") || linkText.includes("توجيه") || linkText.includes("مباراة") ||
      htmlContent.includes("دخول مدرسي") || htmlContent.includes("نتائج البكالوريا");

    const hasStrongCurriculumSignal = urlLower.includes(".pdf") || urlLower.includes("/cours/") || htmlContent.includes(".pdf") || htmlContent.includes("تحميل الملف") || htmlContent.includes("pdf");

    const docExtensions = [".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls"];
    const isDocAsset = docExtensions.some(ext => {
      try {
        const cleanUrlPart = urlLower.split(/[?#]/)[0];
        return cleanUrlPart.endsWith(ext);
      } catch {
        return urlLower.endsWith(ext);
      }
    }) || linkText.toLowerCase().includes("pdf") || linkText.toLowerCase().includes("document word") || linkText.toLowerCase().includes("telecharger word");

    if (isDocAsset) {
      role = "pdf_asset";
      action = "stage_asset";
      isFinal = true;
      confidence = 0.95;
    } else if (urlLower === "https://moutamadris.ma/cours/" || urlLower === "https://moutamadris.ma/cours" || urlLower === "https://talamidi.com/" || urlLower === "https://talamidi.com") {
      role = "hub_page";
      action = "crawl_children";
      confidence = 1.0;
    } else if (isNewsAnnouncements && !hasStrongCurriculumSignal) {
      role = "administrative_article";
      action = "ignore";
      isFinal = false;
      rejectionReason = "Administrative news announcement matching exclusion filter.";
      confidence = 0.9;
    } else if (urlLower.includes("/examens/") || urlLower.includes("/فروض/") || urlLower.includes("/امتحانات/")) {
      role = "category_page";
      action = "crawl_children";
      confidence = 0.8;
    } else if (urlLower.includes("/cours/") && (urlLower.split("/cours/")[1] || "").split("/").filter(Boolean).length === 1) {
      role = "subject_selection_page";
      action = "crawl_children";
      confidence = 0.8;
    } else if (urlLower.includes("/cours/") && (urlLower.split("/cours/")[1] || "").split("/").filter(Boolean).length === 2) {
      role = "lesson_list_page";
      action = "crawl_children";
      confidence = 0.85;
    } else if (urlLower.includes("/cours/") && (urlLower.split("/cours/")[1] || "").split("/").filter(Boolean).length === 0) {
      role = "hub_page";
      action = "crawl_children";
      confidence = 0.9;
    } else if (grade && !subject) {
      role = "grade_selection_page";
      action = "crawl_children";
      confidence = 0.85;
    } else if (grade && subject && (urlLower.includes("les-cours") || urlLower.includes("دروس") || urlLower.includes("-cours") || urlLower.includes("cours-"))) {
      role = "lesson_list_page";
      action = "crawl_children";
      confidence = 0.85;
    } else if (grade && subject && (urlLower.match(/درس-/i) || urlLower.includes("les-lecons") || urlLower.includes("lecon") || urlLower.includes("/dars/") || htmlContent.includes("درس"))) {
      role = "lesson_detail_page";
      isFinal = true;
      action = "stage_asset";
      confidence = 0.9;
    } else if (urlLower.match(/\.(html|php|htm|asp|aspx)$/i) || urlLower.includes("/cours/")) {
      role = "html_lesson";
      isFinal = true;
      action = "stage_asset";
      confidence = 0.8;
    } else {
      role = "unknown";
      action = "crawl_children";
      confidence = 0.4;
    }

    const isHomepage = urlLower === "https://talamidi.com/" || urlLower === "https://talamidi.com";
    const isCoursIndex = urlLower.endsWith("/cours/") || urlLower.endsWith("/cours") || urlLower.endsWith("/examens/") || urlLower.endsWith("/examens");
    
    if (isHomepage || isCoursIndex) {
      isFinal = false;
      action = "crawl_children";
      role = "hub_page";
      rejectionReason = "Hub or homepage index is restricted from direct deployment staging.";
    }

    if (isFinal) {
      try {
        const parts = canonical.split("/").filter(Boolean);
        let lastPart = parts.pop() || "";
        if (lastPart.endsWith(".pdf") || lastPart.endsWith(".html") || lastPart.endsWith(".php")) {
          lastPart = lastPart.substring(0, lastPart.lastIndexOf("."));
        }
        const topicText = cleanServerTopicText(lastPart || linkText);
        if (topicText) {
          topic = topicText;
        } else {
          topic = "General-Topic";
        }
      } catch {
        topic = "General-Topic";
      }
    }

    return {
      role,
      action,
      grade,
      subject,
      docType,
      topic,
      confidence,
      rejectionReason,
      isFinal
    };
  }

  const SITEMAP_PATH = path.join(LOCAL_OUTPUT_DIR, "site_map.json");
  
  function loadSiteMap(): SiteMapNode[] {
    try {
      if (fs.existsSync(SITEMAP_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(SITEMAP_PATH, "utf8"));
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.nodes)) return parsed.nodes;
      }
    } catch (e) {
      console.error("Failed to load site map:", e);
    }
    return [];
  }

  function saveSiteMap(nodes: SiteMapNode[]) {
    try {
      const dir = path.dirname(SITEMAP_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SITEMAP_PATH, JSON.stringify(nodes, null, 2), "utf8");
    } catch (e) {
      console.error("Failed to save site map:", e);
    }
  }

  // Site Map CRUD API (Task 6, 9)
  app.get("/api/site-map", (req, res) => {
    res.json(loadSiteMap());
  });

  app.post("/api/site-map/ai-clean", async (req, res) => {
    try {
      const siteMap = loadSiteMap();
      if (!siteMap || siteMap.length === 0) {
        return res.json([]);
      }

      const itemsToAssess = siteMap.map(n => ({
        id: n.id,
        url: n.canonical_url,
        path: n.navigation_path,
        role: n.page_role
      }));

      const prompt = `You are an educational asset evaluator. I will give you a JSON array of URLs discovered during a web crawl.
Your job is to clean, sort, and classify these URLs.
Reject non-educational URLs (privacy, about us, ads, generic pages, unwanted links).
Keep ONLY valuable educational assets (especially PDFs, exams, lessons, exercises).
For the URLs you keep, extract the grade, subject, document type, and topic (lesson).

Input JSON:
${JSON.stringify(itemsToAssess)}

Return a JSON array of ALWAYS ONLY the ACCEPTED items. Do not include rejected items in your output.
For each accepted item, return exactly this structure:
[
  {
    "id": "the-original-id",
    "grade": "extracted grade (e.g., 1AEP..6AEP, 1AC, 2AC, 3AC, TC, 1BAC, 2BAC...)",
    "subject": "extracted subject (e.g., SVT, PC, Math, Arabic, French...)",
    "docType": "extracted document type (e.g., Cours, Exercices, Examen...)",
    "topic": "the specific lesson or exam name",
    "isFinalAsset": true
  }
]
`;

      const response = await callGeminiWithRetry({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      let aiResults = [];
      try {
        if (response && response.text) {
          aiResults = JSON.parse(response.text.trim());
        }
      } catch (err) {
        console.error("Gemini failed to return valid JSON array", err);
      }

      if (!Array.isArray(aiResults)) {
         aiResults = [];
      }

      const acceptedMap = new Map();
      for (const item of aiResults) {
        if (item.id) {
          acceptedMap.set(item.id, item);
        }
      }

      const updatedSiteMap = siteMap.map(node => {
        if (acceptedMap.has(node.id)) {
          const aiData = acceptedMap.get(node.id);
          return {
            ...node,
            extracted_grade: aiData.grade || node.extracted_grade,
            extracted_subject: aiData.subject || node.extracted_subject,
            extracted_document_type: aiData.docType || node.extracted_document_type,
            extracted_topic: aiData.topic || node.extracted_topic,
            action: "stage_asset",
            is_final_asset: true,
            status: "completed",
            rejection_reason: ""
          };
        } else {
          return {
            ...node,
            action: "ignore",
            is_final_asset: false,
            status: "ignored",
            rejection_reason: "Rejected by AI Cleanup"
          };
        }
      });

      saveSiteMap(updatedSiteMap);
      res.json(updatedSiteMap);
    } catch (error: any) {
      console.error("AI clean error:", error);
      res.status(500).json({ error: "Failed to perform AI cleanup" });
    }
  });

  app.post("/api/site-map/clear", (req, res) => {
    saveSiteMap([]);
    res.json({ success: true, message: "Site map cleared." });
  });

  app.post("/api/site-map/update-node", (req, res) => {
    const { id, updates } = req.body;
    let siteMap = loadSiteMap();
    let found = false;
    siteMap = siteMap.map(node => {
      if (node.id === id) {
        found = true;
        return { ...node, ...updates };
      }
      return node;
    });
    if (found) {
      saveSiteMap(siteMap);
      res.json({ success: true, node: siteMap.find(n => n.id === id) });
    } else {
      res.status(404).json({ error: "Node not found" });
    }
  });

  app.post("/api/site-map/crawl", async (req, res) => {
    const { url, maxPages = 30, maxDepth = 3, topicFilter, fresh = true } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Start URL is required" });
    }

    const startUrl = canonicalizeUrl(url);
    console.log(`[Site Map Crawl] Initiating crawl from: ${startUrl}, maxPages: ${maxPages}, maxDepth: ${maxDepth}`);

    let activeDict: any = { grades: [], subjects: [], topics: [], allowedDocumentTypes: [] };
    try {
      activeDict = normalizeDictionary(await getActiveDictionary());
    } catch (dictErr) {
      console.warn("[Site Map Crawl] Failed to load active dictionary:", dictErr);
    }

    const startClassification = classifyPageUrlRole(startUrl, "", "Seed", null, null);
    const targetGrade = startClassification.grade;
    const targetSubject = startClassification.subject;

    let siteMap = fresh ? [] : loadSiteMap();
    const mapByHash = new Map<string, SiteMapNode>(siteMap.map(n => [n.canonical_url_hash, n]));

    const queue: { url: string; depth: number; parentUrl: string | null; linkText: string; navPath: string }[] = [];
    queue.push({
      url: startUrl,
      depth: 0,
      parentUrl: null,
      linkText: "Seed",
      navPath: "Seed"
    });

    const visited = new Set<string>();
    let pagesProcessed = 0;

    let domain = "moutamadris.ma";
    try {
      domain = new URL(startUrl).hostname;
    } catch {}

    const SAFE_MAX_PAGES = Math.min(maxPages, 1000); // Prevent infinite loops
    const startTime = Date.now();

    while (queue.length > 0 && pagesProcessed < SAFE_MAX_PAGES) {
      if (Date.now() - startTime > 300000) {
        console.log(`[Site Map Scraper] Reached 5-minute time limit. Bailing out.`);
        break;
      }
      
      const current = queue.shift()!;
      let currentCanonical = canonicalizeUrl(current.url);
      
      // Auto-correct common URL typos (.pd instead of .pdf)
      if (currentCanonical.endsWith(".pd")) {
        currentCanonical += "f";
      }

      const currentHash = getCanonicalUrlHash(currentCanonical);

      if (visited.has(currentCanonical)) continue;
      
      // Skip Cloudflare email protection or other known unhelpful links
      const ignorePatterns = [
        "/cdn-cgi/l/email-protection", "javascript:", 
        "whatsapp.com", "facebook.com", "telegram.me", "t.me", "twitter.com", "x.com", 
        "youtube.com", "play.google.com", "wa.me"
      ];
      if (ignorePatterns.some(p => currentCanonical.includes(p))) {
        continue;
      }

      visited.add(currentCanonical);

      // Rule 4: Hard reject or needs_review when depth > 5
      if (current.depth > 5) {
        const classification = classifyPageUrlRole(currentCanonical, "", current.linkText, null, null);
        const node: SiteMapNode = {
          id: "node_" + crypto.randomBytes(4).toString("hex"),
          source_domain: domain,
          source_url: current.url,
          canonical_url: currentCanonical,
          canonical_url_hash: currentHash,
          parent_url: current.parentUrl,
          depth: current.depth,
          page_role: classification.role,
          navigation_path: current.navPath,
          extracted_grade: classification.grade || "-",
          extracted_subject: classification.subject || "-",
          extracted_document_type: classification.docType,
          extracted_topic: classification.topic || "Depth-Exceeded",
          action: "ignore",
          status: "needs_review",
          discovered_links_count: 0,
          confidence: 0.1,
          rejection_reason: "Crawl depth exceeded maximum limit (> 5)",
          is_final_asset: classification.isFinal,
          validation_errors: ["crawl_depth_exceeded"]
        };
        populatePdfAssetTargetFields(node, activeDict);
        mapByHash.set(currentHash, node);
        continue;
      }

      try {
        console.log(`[Site Map Scraper] Fetching: ${currentCanonical} (Depth: ${current.depth})`);
        
        let responseData = "";
        let contentType = "text/html";
        let isDirectPdf = currentCanonical.toLowerCase().endsWith(".pdf");

        if (!isDirectPdf) {
          try {
            const resp = await axios.get(currentCanonical, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              },
              timeout: 60000,
              validateStatus: (status) => status < 500, // Handle 404 gracefully
              httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
            });
            responseData = resp.data || "";
            contentType = (resp.headers['content-type'] || '').toLowerCase();
            
            if (resp.status === 404) {
              console.warn(`[Site Map Scraper] 404 Not Found for ${currentCanonical}`);
              responseData = "";
            }
          } catch (fetchErr: any) {
            console.warn(`[Site Map Scraper] Failed to fetch HTML for ${currentCanonical}: ${fetchErr.message}`);
            const classification = classifyPageUrlRole(currentCanonical, "", current.linkText, null, null);
            const parentNode = current.parentUrl ? mapByHash.get(getCanonicalUrlHash(current.parentUrl)) : null;
            
            const node: SiteMapNode = {
              id: "node_" + crypto.randomBytes(4).toString("hex"),
              source_domain: domain,
              source_url: current.url,
              canonical_url: currentCanonical,
              canonical_url_hash: currentHash,
              parent_url: current.parentUrl,
              depth: current.depth,
              page_role: classification.role,
              navigation_path: current.navPath,
              extracted_grade: parentNode?.extracted_grade || classification.grade || "-",
              extracted_subject: parentNode?.extracted_subject || classification.subject || "-",
              extracted_document_type: classification.docType,
              extracted_topic: classification.topic || "Failed-Topic",
              action: "ignore",
              status: "failed",
              discovered_links_count: 0,
              confidence: 0.1,
              rejection_reason: `Fetch failed: ${fetchErr.message}`,
              is_final_asset: false,
              validation_errors: ["missing_grade", "missing_subject"]
            };
            populatePdfAssetTargetFields(node, activeDict);
            mapByHash.set(currentHash, node);
            continue;
          }
        }

        pagesProcessed++;

        const $ = isDirectPdf ? null : load(responseData);
        const htmlTitle = $ ? ($('title').text() || $('h1').first().text() || "").trim() : "";
        const bodyText = $ ? $('body').text() : "";

        const parentNode = current.parentUrl ? mapByHash.get(getCanonicalUrlHash(current.parentUrl)) : null;

        const classification = classifyPageUrlRole(
          currentCanonical, 
          bodyText, 
          current.linkText || htmlTitle || "", 
          parentNode?.page_role,
          parentNode ? {
            grade: parentNode.extracted_grade,
            subject: parentNode.extracted_subject,
            docType: parentNode.extracted_document_type
          } : null
        );

        let displayTitle = current.linkText || htmlTitle || currentCanonical.split("/").filter(Boolean).pop() || "Page";
        if (displayTitle.length > 35) displayTitle = displayTitle.slice(0, 32) + "...";
        
        // Rule 6: Never inherit navigation_path across cross-grade or cross-subject jumps
        let nodeGrade = classification.grade || parentNode?.extracted_grade || "-";
        let nodeSubject = classification.subject || parentNode?.extracted_subject || "-";

        let inheritNav = true;
        if (parentNode) {
          const pGrade = parentNode.extracted_grade || "-";
          const pSubject = parentNode.extracted_subject || "-";
          if ((nodeGrade !== "-" && pGrade !== "-" && nodeGrade !== pGrade) || 
              (nodeSubject !== "-" && pSubject !== "-" && nodeSubject !== pSubject)) {
            inheritNav = false;
          }
        }

        let navPath = displayTitle;
        if (current.depth > 0 && inheritNav) {
          navPath = `${current.navPath} > ${displayTitle}`;
        } else {
          navPath = displayTitle;
        }

        navPath = navPath.replace(/Seed > /g, "").replace(/\.pdf/gi, "");

        // Rule 7 & 11: Navigation conflicts and validation tracking
        const valErrors: string[] = [];
        const conflictCheck = checkNavigationPathConflict(navPath, nodeGrade, nodeSubject);
        let nodeStatus = "completed";

        if (conflictCheck.conflicted) {
          navPath = displayTitle; // Reset navigation context
          valErrors.push(...conflictCheck.errors);
          nodeStatus = "needs_review";
        }

        // Rule 8: Do not stage homepage/hub/index pages
        const pathname = new URL(currentCanonical).pathname;
        const isHomeOrHub = pathname === "/" || pathname === "/cours/" || pathname === "/cours" || classification.role === "hub_page";
        
        let action = classification.action;
        if (isHomeOrHub && action === "stage_asset") {
          action = "crawl_children";
        }

        // Rule 9: Do not stage nodes with extracted_grade "-" and extracted_subject "-"
        if (nodeGrade === "-" && nodeSubject === "-" && action === "stage_asset") {
          action = "ignore";
        }

        // Fill validation errors for missing grade/subject
        if (!nodeGrade || nodeGrade === "-") {
          valErrors.push("missing_grade");
        }
        if (!nodeSubject || nodeSubject === "-") {
          valErrors.push("missing_subject");
        }

        // Rule 10: Do not mark status completed when rejection_reason is non-empty
        const rejectionReasonOutput = classification.rejectionReason || "";
        if (rejectionReasonOutput && nodeStatus === "completed") {
          nodeStatus = "needs_review"; // or "rejected"
        }

        const node: SiteMapNode = {
          id: mapByHash.get(currentHash)?.id || "node_" + crypto.randomBytes(4).toString("hex"),
          source_domain: domain,
          source_url: current.url,
          canonical_url: currentCanonical,
          canonical_url_hash: currentHash,
          parent_url: current.parentUrl,
          depth: current.depth,
          page_role: classification.role,
          navigation_path: navPath,
          extracted_grade: nodeGrade,
          extracted_subject: nodeSubject,
          extracted_document_type: classification.docType,
          extracted_topic: classification.topic || "Sequence-01",
          action: action,
          status: nodeStatus,
          discovered_links_count: 0,
          confidence: classification.confidence,
          rejection_reason: rejectionReasonOutput,
          is_final_asset: classification.isFinal,
          validation_errors: valErrors
        };

        populatePdfAssetTargetFields(node, activeDict);

        const discoveredLinks: string[] = [];
        const newChildren: any[] = [];
        if ($ && (action === "crawl_children" || action === "stage_asset") && current.depth < maxDepth && current.depth <= 5) {
          $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            try {
              const absoluteUrl = new URL(href, currentCanonical).href;
              const childCanonical = canonicalizeUrl(absoluteUrl);
              const childObj = new URL(childCanonical);
              
              const cleanDomain = domain.replace(/^www\./, "");
              const cleanChildHostname = childObj.hostname.replace(/^www\./, "");
              
              if (cleanChildHostname === cleanDomain) {
                // Check child classification
                const childClassification = classifyPageUrlRole(childCanonical, "", $(el).text().trim() || "Link", classification.role, {
                  grade: nodeGrade,
                  subject: nodeSubject,
                  docType: classification.docType
                });

                // Rule 5: Stop following links when grade or subject changes away from target
                if (targetGrade && childClassification.grade && childClassification.grade !== targetGrade) {
                  return;
                }
                if (targetSubject && childClassification.subject && childClassification.subject !== targetSubject) {
                  return;
                }

                if (!childCanonical.match(/\.(jpg|jpeg|png|gif|svg|css|js|zip|rar|tar|7z|mp3|mp4|wav|avi|woff|woff2|ttf|eot)$/i)) {
                  discoveredLinks.push(childCanonical);
                  if (!visited.has(childCanonical) && !queue.some(q => canonicalizeUrl(q.url) === childCanonical) && !newChildren.some(nc => canonicalizeUrl(nc.url) === childCanonical)) {
                    newChildren.push({
                      url: childCanonical,
                      depth: current.depth + 1,
                      parentUrl: currentCanonical,
                      linkText: $(el).text().trim() || "Link",
                      navPath: navPath
                    });
                  }
                }
              }
            } catch {}
          });
          queue.unshift(...newChildren);
        }

        node.discovered_links_count = discoveredLinks.length;
        mapByHash.set(currentHash, node);
      } catch (err: any) {
        console.error(`[Site Map Scraper] Serious error during processing of ${currentCanonical}:`, err);
      }
    }

    const resultNodes = Array.from(mapByHash.values());
    saveSiteMap(resultNodes);
    console.log(`[Site Map Crawl] Successfully completed. Total nodes mapped: ${resultNodes.length}`);
    res.json(resultNodes);
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
            timeout: 60000,
            validateStatus: (status) => status < 400,
            httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
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
          
          const newChildrenToVisit: {url: string, depth: number}[] = [];
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
              
              // 1. Check if it's a PDF or an HTML lesson webpage
              const isPdf = cleanUrl.toLowerCase().endsWith('.pdf') || 
                            linkText.toLowerCase().includes('pdf') || 
                            $(el).attr('type') === 'application/pdf';
              
              const isHtmlLesson = cleanUrl.toLowerCase().match(/\.(html|php|htm|asp|aspx)$/i) ||
                                  cleanUrl.toLowerCase().includes("/cours/") ||
                                  cleanUrl.toLowerCase().includes("/lesson/") ||
                                  cleanUrl.toLowerCase().includes("/lecon/") ||
                                  cleanUrl.toLowerCase().includes("/dars/") ||
                                  linkText.toLowerCase().includes("cours") ||
                                  linkText.includes("درس");

              if (isPdf || (isHtmlLesson && !cleanUrl.toLowerCase().endsWith('.pdf'))) {
                if (isValidUrlSource(cleanUrl).valid && checkTopicFilter(cleanUrl, linkText)) {
                  foundPdfs.add(cleanUrl);
                }
              } 
              
              // 2. Check if it's an internal link to follow
              const isInternal = urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain);
              if (isInternal && !visited.has(cleanUrl) && depth < maxDepth) {
                // Skip obvious non-html files
                if (!cleanUrl.match(/\.(jpg|jpeg|png|gif|svg|css|js|zip|rar|mp4|mp3|wav|avi|doc|docx|xls|xlsx|ppt|pptx)$/i)) {
                   if (isValidUrlSource(cleanUrl).valid) {
                     // Check if already in toVisit or newChildrenToVisit
                     if (!toVisit.some(v => v.url === cleanUrl) && !newChildrenToVisit.some(v => v.url === cleanUrl)) {
                       newChildrenToVisit.push({ url: cleanUrl, depth: depth + 1 });
                     }
                   }
                }
              }
            } catch (e) {
              // Invalid URL, ignore
            }
          });
          toVisit.unshift(...newChildrenToVisit);
          
          // Also check iframes and embeds for PDFs
          $('iframe, embed, object').each((_, el) => {
            const src = $(el).attr('src') || $(el).attr('data') || $(el).attr('href');
            if (src) {
              try {
                const absoluteUrl = new URL(src, currentUrl).href;
                const lowerAbs = absoluteUrl.toLowerCase();
                if (lowerAbs.endsWith('.pdf') || lowerAbs.includes('pdf') || lowerAbs.includes('drive.google.com/file/d/')) {
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
      let urlInput = "";

      if (pastedUrls && Array.isArray(pastedUrls)) {
        urlInput = pastedUrls.join(" ");
      } else if (query && query.trim().length > 0) {
        console.log(`[Discover] Querying search grounding for: ${query}`);
        const response = await callGeminiWithRetry({
          model: "gemini-2.5-flash",
          contents: `Find educational resources, lessons, exams or direct PDF files related to the search query: "${query}". Specify the full direct URLs from legitimate sources and educational webpages starting with http or https.`,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const rawUrls: string[] = [];
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (chunks && Array.isArray(chunks)) {
          for (const chunk of chunks) {
            if (chunk.web?.uri) {
              rawUrls.push(chunk.web.uri);
            }
          }
        }

        const text = response.text || "";
        const urlRegex = /(https?:\/\/[^\s$,;?#()\[\]"']+)/g;
        let match;
        while ((match = urlRegex.exec(text)) !== null) {
          rawUrls.push(match[1]);
        }
        urlInput = rawUrls.join(" ");
      }

      console.log(`[Discover PDFs Endpoint] Initiating discovery model for text: "${urlInput}"`);
      const results = await discoverPdfsFromInput(urlInput, topicFilter);

      // Now map results into a format containing our special fields and update record index
      for (const item of results) {
        if (item.accepted && item.isDirectPdf) {
          const mappingEntry = {
            raw_url: item.raw_url,
            normalized_url: item.normalized_url,
            source_page_url: item.source_page_url,
            pdf_url: item.pdf_url,
            url_type: item.url_type,
            pdf_count: item.pdf_count,
            metadata: item.metadata
          };
          updateReport("discovery-mapping.json", mappingEntry);
        }
      }

      // Check if any direct PDFs were discovered
      const anyPdfsFoundOnAtLeastOnePage = results.some(r => r.isDirectPdf);
      const responseStatus = anyPdfsFoundOnAtLeastOnePage ? "success" : "no_pdf_found";

      // Re-resolve active topic filter dictionary for topic filter reporting
      let topicFilterReport = null;
      if (topicFilter && topicFilter.trim().length > 0) {
        const activeDict = normalizeDictionary(await getActiveDictionary());
        const resolvedTopicFilters = resolveTopicFiltersAgainstDictionary(topicFilter, activeDict);
        if (resolvedTopicFilters) {
          topicFilterReport = {
            rawFilters: resolvedTopicFilters.rawFilters,
            matchedTopics: resolvedTopicFilters.matchedTopics,
            unmatchedFilters: resolvedTopicFilters.unmatchedFilters,
            expandedKeywords: resolvedTopicFilters.expandedKeywords
          };
        }
      }

      res.json({ results, topicFilterReport, status: responseStatus });
    } catch (err: any) {
      console.error("[Discover Error]", err);
      const errMsg = err.message || "";
      const isRateLimit = errMsg.includes("429") || 
                         errMsg.toLowerCase().includes("quota exceeded") || 
                         errMsg.toLowerCase().includes("rate limit") || 
                         errMsg.toLowerCase().includes("resource exhausted") || 
                         errMsg.toLowerCase().includes("too many requests") ||
                         JSON.stringify(err).toLowerCase().includes("quota");

      if (isRateLimit) {
        return res.status(429).json({
          error: "Gemini API Quota/Rate Limit Exceeded. You have exceeded your current API quota limit."
        });
      }
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
        timeout: 60000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
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

  app.post("/api/export-pdfs-zip", async (req, res) => {
    try {
      const archiver = require("archiver");
      const { urls } = req.body;
      if (!Array.isArray(urls)) {
        return res.status(400).json({ error: "urls array is required" });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="staged_pdfs.zip"');

      const archive = archiver('zip', {
        zlib: { level: 5 } // moderate compression for speed
      });

      archive.on('error', (err) => {
        console.error("Archiver error:", err);
        res.status(500).end();
      });

      archive.pipe(res);

      for (let i = 0; i < urls.length; i++) {
        const rawUrl = urls[i];
        try {
          const url = resolveUrl(rawUrl);
          const fetchUrl = url.includes("drive.google.com/file/d/") 
            ? `https://drive.google.com/uc?id=${url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1]}&export=download` 
            : url;
            
          const response = await axios.get(fetchUrl, {
            responseType: 'arraybuffer',
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
            },
            timeout: 60000,
            httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
            validateStatus: (status) => status < 400
          });

          let fileName = rawUrl.split('/').pop() || `document_${i}.pdf`;
          fileName = `${i}_${fileName}`;
          fileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_"); // sanitize
          if (!fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';

          archive.append(Buffer.from(response.data), { name: fileName });
          
          // await stream to finish appending? archiver handles streams internally.
          // actually appending a stream works asynchronously, but since we are fetching streams, 
          // we might want to let archiver process it. Archiver consumes streams nicely.
          
        } catch (err: any) {
          console.error(`[Zip Export] Error fetching ${rawUrl}:`, err.message);
          archive.append(`Error fetching this file: ${err.message}`, { name: `ERROR_${i}.txt` });
        }
      }

      await archive.finalize();

    } catch (err: any) {
      console.error("[Zip Export] Fatal error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
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
        timeout: 60000,
        httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
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

  // Google Drive Integration Helper Functions
  async function getOrCreateDriveFolderServer(accessToken: string, folderName: string, parentId?: string): Promise<string> {
    const safeFolderName = folderName.replace(/'/g, "\\'");
    let q = `name = '${safeFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId) {
      q += ` and '${parentId}' in parents`;
    }
    
    const searchRes = await axios.get("https://www.googleapis.com/drive/v3/files", {
      params: { q },
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const files = searchRes.data.files;
    if (files && files.length > 0) {
      return files[0].id;
    }
    
    const createBody: any = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder"
    };
    if (parentId) {
      createBody.parents = [parentId];
    }
    
    const createRes = await axios.post("https://www.googleapis.com/drive/v3/files", createBody, {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
    });
    return createRes.data.id;
  }

  async function uploadToDriveServer(
    accessToken: string,
    filename: string,
    mimeType: string,
    fileBuffer: Buffer,
    folderId: string
  ) {
    const safeFilename = filename.replace(/'/g, "\\'");
    const q = `name = '${safeFilename}' and '${folderId}' in parents and trashed = false`;
    const existRes = await axios.get("https://www.googleapis.com/drive/v3/files", {
      params: { q, fields: "files(id)" },
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const existingFiles = existRes.data.files;
    if (existingFiles && existingFiles.length > 0) {
      const existingFileId = existingFiles[0].id;
      await axios.patch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
        fileBuffer,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": mimeType
          }
        }
      );
      return { id: existingFileId, updated: true };
    } else {
      const boundary = "boundary_string_pipeline_gdrive";
      const metadata = {
        name: filename,
        parents: [folderId]
      };
      
      const metadataPart = 
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) + `\r\n`;
        
      const fileHeaderPart = 
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`;
        
      const fileFooterPart = `\r\n--${boundary}--`;
      
      const payload = Buffer.concat([
        Buffer.from(metadataPart, 'utf8'),
        Buffer.from(fileHeaderPart, 'utf8'),
        fileBuffer,
        Buffer.from(fileFooterPart, 'utf8')
      ]);
      
      const res = await axios.post(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`
          }
        }
      );
      return { id: res.data.id, updated: false };
    }
  }

  function recordDriveSync(filename: string, fileId: string, folder: string) {
    try {
      const gdriveSyncsDir = path.join(LOCAL_OUTPUT_DIR, "dataset");
      if (!fs.existsSync(gdriveSyncsDir)) fs.mkdirSync(gdriveSyncsDir, { recursive: true });
      const dbPath = path.join(gdriveSyncsDir, "gdrive_syncs.json");
      let syncs: any = {};
      if (fs.existsSync(dbPath)) {
        syncs = JSON.parse(fs.readFileSync(dbPath, "utf8"));
      }
      syncs[filename] = { fileId, folder, timestamp: new Date().toISOString() };
      fs.writeFileSync(dbPath, JSON.stringify(syncs, null, 2));
    } catch (e) {
      console.error("Failed to record drive sync:", e);
    }
  }

  app.get("/api/gdrive/sync-status", (req, res) => {
    try {
      const dbPath = path.join(LOCAL_OUTPUT_DIR, "dataset", "gdrive_syncs.json");
      if (fs.existsSync(dbPath)) {
        return res.json(JSON.parse(fs.readFileSync(dbPath, "utf8")));
      }
      return res.json({});
    } catch (e) {
      return res.json({});
    }
  });

  app.post("/api/gdrive/sync", async (req, res) => {
    try {
      const { accessToken, category, filepath, filename, fileBufferBase64, mimeType } = req.body;
      if (!accessToken) {
        return res.status(400).json({ error: "Access token is required" });
      }

      const rootFolderId = await getOrCreateDriveFolderServer(accessToken, "AI Studio Curriculum Pipeline Workspace");
      
      let categoryFolderName = "misc";
      if (category === "downloads") categoryFolderName = "Original-PDFs";
      else if (category === "clean-pdfs") categoryFolderName = "Clean-PDFs";
      else if (category === "dataset") categoryFolderName = "Datasets";
      else if (category === "reports") categoryFolderName = "Reports";
      
      const targetFolderId = await getOrCreateDriveFolderServer(accessToken, categoryFolderName, rootFolderId);

      let destFilename = filename;
      let buffer: Buffer;
      let targetMimeType = mimeType || "application/pdf";

      if (fileBufferBase64) {
        buffer = Buffer.from(fileBufferBase64, "base64");
      } else if (filepath) {
        const fullLocalPath = path.isAbsolute(filepath) ? filepath : path.join(LOCAL_OUTPUT_DIR, filepath);
        if (!fs.existsSync(fullLocalPath)) {
          return res.status(404).json({ error: `Local file not found at ${fullLocalPath}` });
        }
        buffer = fs.readFileSync(fullLocalPath);
        if (!destFilename) {
          destFilename = path.basename(fullLocalPath);
        }
        if (destFilename.endsWith(".txt")) targetMimeType = "text/plain";
        else if (destFilename.endsWith(".json") || destFilename.endsWith(".jsonl")) targetMimeType = "application/json";
      } else {
        return res.status(400).json({ error: "filepath or fileBufferBase64 is required" });
      }

      console.log(`[Google Drive Sync] Syncing ${destFilename} (${categoryFolderName}) to Drive...`);
      const result = await uploadToDriveServer(accessToken, destFilename, targetMimeType, buffer, targetFolderId);
      recordDriveSync(destFilename, result.id, categoryFolderName);
      
      res.json({
        success: true,
        fileId: result.id,
        updated: result.updated,
        folderName: categoryFolderName,
        filename: destFilename
      });
    } catch (err: any) {
      console.error("[Google Drive Sync Error]", err.response?.data || err.message);
      let errMsg = err.message;
      if (err.response?.status === 401) {
        errMsg = "Google Drive session has expired or is invalid. Please disconnect and reconnect your Google Drive in the app.";
      } else if (err.response?.data?.error?.message) {
        errMsg = err.response.data.error.message;
      }
      res.status(err.response?.status || 500).json({ error: errMsg });
    }
  });

  app.post("/api/gdrive/gemini-sync", async (req, res) => {
    try {
      const { accessToken, category, filepath, filename, fileBufferBase64, mimeType } = req.body;
      if (!accessToken) {
        return res.status(400).json({ error: "Access token is required" });
      }

      let buffer: Buffer;
      let destFilename = filename;
      let targetMimeType = mimeType || "application/pdf";

      if (fileBufferBase64) {
        buffer = Buffer.from(fileBufferBase64, "base64");
      } else if (filepath) {
        const fullLocalPath = path.isAbsolute(filepath) ? filepath : path.join(LOCAL_OUTPUT_DIR, filepath);
        if (!fs.existsSync(fullLocalPath)) {
          return res.status(404).json({ error: `Local file not found at ${fullLocalPath}` });
        }
        buffer = fs.readFileSync(fullLocalPath);
        if (!destFilename) {
          destFilename = path.basename(fullLocalPath);
        }
        if (destFilename.endsWith(".txt")) targetMimeType = "text/plain";
        else if (destFilename.endsWith(".json") || destFilename.endsWith(".jsonl")) targetMimeType = "application/json";
      } else {
        return res.status(400).json({ error: "filepath or fileBufferBase64 is required" });
      }

      // Read a text snippet from PDF to help Gemini categorize
      let textSnippet = "";
      if (targetMimeType === "application/pdf") {
        try {
          const pdfData = await pdf(buffer);
          textSnippet = pdfData.text ? pdfData.text.substring(0, 1500) : "";
        } catch (pdfErr) {
          console.warn("[Gemini Drive Sync] PDF parsing failed, using name only", pdfErr);
        }
      }

      const prompt = `You are a helpful assistant for Google Drive file structure organization.
Analyze this educational file:
Original Filename: "${destFilename}"
Content Snippet: "${textSnippet}"

Based on the title, language, and subject matter of this Moroccan or general educational document:
1. Generate an elegant, descriptive, clean, structured filename (e.g., "Math_3AC_Equations_Et_Inequations.pdf" or "SVT_1AC_Systeme_Digestif_Exercices.pdf"). Avoid timestamps, spammy characters, or website footprints. Ensure it ends with the appropriate file extension.
2. Determine up to 3 levels of highly relevant folders to organize this content inside Google Drive:
- Level 1 (Parent Folder): Broad subject (e.g., "Mathématiques", "SVT", "Physique-Chimie", "Français", "Datasets").
- Level 2 (Child Folder): Educational level/grade or theme (e.g., "3ème Année Collège", "1ère Année Collège", "Tronc Commun", "BAC Sciences").
- Level 3 (Grandchild Folder, optional): Specific unit, chapter, or type of document (e.g., "Équations et Inéquations", "Exercices et Contrôles", "Leçons", "Résumé").

Return your response strictly as a JSON object of the following format:
{
  "suggestedFilename": "Systematic_Descriptive_Name.pdf",
  "parentFolder": "Name of Parent Folder",
  "childFolder": "Name of Child Folder",
  "grandchildFolder": "Name of Grandchild Folder or empty/null"
}

Do not include any markdown format blocks or conversational text, specify valid JSON only.`;

      // Call Gemini 2.5 Flash as requested
      const response = await callGeminiWithRetry({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const geminiResult = response.text ? JSON.parse(response.text.trim()) : null;
      if (!geminiResult) {
        throw new Error("Gemini 2.5 Flash did not return a valid configuration.");
      }

      const { suggestedFilename, parentFolder, childFolder, grandchildFolder } = geminiResult;
      console.log(`[Gemini Drive Sync] Suggested structure: ${parentFolder} / ${childFolder} / ${grandchildFolder || ""} -> ${suggestedFilename}`);

      const rootFolderId = await getOrCreateDriveFolderServer(accessToken, "Gemini Automated Curriculums");
      
      let currentParentId = rootFolderId;
      if (parentFolder) {
        currentParentId = await getOrCreateDriveFolderServer(accessToken, parentFolder, currentParentId);
      }
      if (childFolder) {
        currentParentId = await getOrCreateDriveFolderServer(accessToken, childFolder, currentParentId);
      }
      if (grandchildFolder) {
        currentParentId = await getOrCreateDriveFolderServer(accessToken, grandchildFolder, currentParentId);
      }

      const finalName = suggestedFilename || destFilename;
      const result = await uploadToDriveServer(accessToken, finalName, targetMimeType, buffer, currentParentId);
      recordDriveSync(finalName, result.id, `Gemini Automated Curriculums / ${parentFolder || ""} / ${childFolder || ""} / ${grandchildFolder || ""}`);

      res.json({
        success: true,
        fileId: result.id,
        updated: result.updated,
        folderPath: `Gemini Automated Curriculums / ${parentFolder || ""} / ${childFolder || ""} / ${grandchildFolder || ""}`,
        filename: finalName
      });
    } catch (err: any) {
      console.error("[Gemini Drive Sync Error]", err.response?.data || err.message);
      let errMsg = err.message;
      if (err.response?.status === 401) {
        errMsg = "Google Drive session has expired or is invalid. Please disconnect and reconnect your Google Drive in the app.";
      } else if (err.response?.data?.error?.message) {
        errMsg = err.response.data.error.message;
      }
      res.status(err.response?.status || 500).json({ error: errMsg });
    }
  });

  app.post("/api/gdrive/sync-all", async (req, res) => {
    try {
      const { accessToken, categoryFilter } = req.body;
      if (!accessToken) {
        return res.status(400).json({ error: "Access token is required" });
      }

      const rootFolderId = await getOrCreateDriveFolderServer(accessToken, "AI Studio Curriculum Pipeline Workspace");

      let categories = [
        { dir: "downloads", label: "Original-PDFs", mime: "application/pdf", suffix: "original.pdf" },
        { dir: "clean-pdfs", label: "Clean-PDFs", mime: "application/pdf", suffix: null },
        { dir: "dataset", label: "Datasets", mime: "application/json", suffix: null },
        { dir: "reports", label: "Reports", mime: "application/json", suffix: null }
      ];

      if (categoryFilter) {
         categories = categories.filter(c => c.dir === categoryFilter);
      }

      const syncedFiles: Array<{ filename: string, folderName: string, updated: boolean, id: string }> = [];

      for (const cat of categories) {
        const fullDir = path.join(LOCAL_OUTPUT_DIR, cat.dir);
        if (!fs.existsSync(fullDir)) continue;

        const files = fs.readdirSync(fullDir);
        if (files.length === 0) continue;

        const folderId = await getOrCreateDriveFolderServer(accessToken, cat.label, rootFolderId);

        for (const file of files) {
          if (cat.suffix && !file.endsWith(cat.suffix)) continue;
          if (file.startsWith(".")) continue;

          const filepath = path.join(fullDir, file);
          const stat = fs.statSync(filepath);
          if (!stat.isFile()) continue;

          const buffer = fs.readFileSync(filepath);
          let mime = cat.mime;
          if (file.endsWith(".jsonl")) mime = "application/x-jsonlines";
          else if (file.endsWith(".txt")) mime = "text/plain";

          console.log(`[GDrive Sync-All] Syncing ${file}...`);
          const uploadRes = await uploadToDriveServer(accessToken, file, mime, buffer, folderId);
          recordDriveSync(file, uploadRes.id, `AI Studio Curriculum Pipeline Workspace / ${cat.label}`);
          syncedFiles.push({
            filename: file,
            folderName: cat.label,
            updated: uploadRes.updated,
            id: uploadRes.id
          });
        }
      }

      res.json({
        success: true,
        count: syncedFiles.length,
        files: syncedFiles
      });
    } catch (err: any) {
      console.error("[Google Drive Sync-All Error]", err.response?.data || err.message);
      let errMsg = err.message;
      if (err.response?.status === 401) {
        errMsg = "Google Drive session has expired or is invalid. Please disconnect and reconnect your Google Drive in the app.";
      } else if (err.response?.data?.error?.message) {
        errMsg = err.response.data.error.message;
      }
      res.status(err.response?.status || 500).json({ error: errMsg });
    }
  });

    // The dist path serving and index.html catch-all was moved to the very end of server.ts

  app.post("/api/crawl-moutamadris-advanced", async (req, res) => {
    try {
      const outputJson = path.join(process.cwd(), "moutamadris_assets.json");
      const outputCsv = path.join(process.cwd(), "moutamadris_assets.csv");
      
      // Kick off asynchronously since this is a deep crawl
      runMoutamadrisCrawl(outputJson, outputCsv).catch(err => {
        console.error("Advanced crawl failed:", err);
      });
      
      res.json({ message: "Advanced crawl started in the background. Check moutamadris_assets json and csv locally." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

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
        const host = parsed.hostname;
        if (!host.includes("moutamadris.ma") && !host.includes("drive.google.com")) {
          return { allowed: false, reason: "external-domain" };
        }
        
        const path = parsed.pathname.toLowerCase();
        if (BLOCKED_EXTENSIONS.test(path)) return { allowed: false, reason: "static-file" };

        if (url.toLowerCase().endsWith(".pdf") || host.includes("drive.google.com")) {
          if (BLOCKED_PDF_SOURCES.test(url)) return { allowed: false, reason: "blocked-pdf-source" };
          return { allowed: true, reason: "ok" };
        }

        if (BLOCKED_PATH_PATTERNS.test(path + "/")) return { allowed: false, reason: "blocked-path" };

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
            timeout: 60000,
            validateStatus: (status) => status < 400,
            httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
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

          const newChildrenToVisit: {url: string, depth: number}[] = [];
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
                if (!toVisit.some(v => v.url === cleanUrl) && !newChildrenToVisit.some(v => v.url === cleanUrl)) {
                  newChildrenToVisit.push({ url: cleanUrl, depth: depth + 1 });
                }
              }
            } catch (e) {}
          });
          toVisit.unshift(...newChildrenToVisit);
          
          // Also check iframes/embeds
          $('iframe, embed, object').each((_, el) => {
            const src = $(el).attr('src') || $(el).attr('data') || $(el).attr('href');
            if (src) {
              try {
                const absoluteUrl = new URL(src, currentUrl).href;
                const lowerAbs = absoluteUrl.toLowerCase();
                if (lowerAbs.endsWith('.pdf') || lowerAbs.includes('pdf') || lowerAbs.includes('drive.google.com/file/d/')) {
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

  app.post("/api/collector/collect", async (req, res) => {
    try {
      const { url, accessToken } = req.body;
      if (!accessToken) return res.status(400).json({ ok: false, stage: "missing_google_token", error: "Missing required parameters." });
      if (!url) return res.status(400).json({ ok: false, stage: "source_url_missing", error: "Missing required parameters." });
      
      console.log(`[Collector] Starting sequence for ${url}`);
      
      let fetchUrl = url;
      if (fetchUrl.includes("drive.google.com/file/d/")) {
        const fileIdMatch = fetchUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          fetchUrl = `https://drive.google.com/uc?id=${fileIdMatch[1]}&export=download`;
        }
      }
      
      let fileBytes: Buffer | null = null;
      let contentType = "";
      let fetchStatus = 0;
      try {
        const response = await axios.get(fetchUrl, {
          responseType: "arraybuffer",
          headers: {
             "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 60000,
          maxContentLength: 60 * 1024 * 1024, // 60 MB
          validateStatus: (status) => status < 400,
          httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
        });
        fetchStatus = response.status;
        fileBytes = Buffer.from(response.data);
        contentType = (response.headers['content-type'] || '').toLowerCase();
      } catch (dlErr: any) {
        console.error(`[Collector] Fetch fail for ${url}:`, dlErr.message);
        return res.json({ 
          ok: false, 
          stage: "source_fetch_failed", 
          error: dlErr.message,
          status: dlErr.response?.status 
        });
      }
      
      if (!fileBytes || fileBytes.length === 0) {
         return res.json({ ok: false, stage: "source_fetch_failed", error: "Empty file downloaded" });
      }

      if (fileBytes.length > 50 * 1024 * 1024) {
        return res.json({ ok: false, stage: "pdf_too_large", error: "File exceeds 50MB" });
      }

      const textSnippet = fileBytes.toString("utf8", 0, 1000).toLowerCase();
      
      if (
        textSnippet.includes("<!doctype html>") || 
        textSnippet.includes("<html") ||
        textSnippet.includes("please wait while your application starts") ||
        textSnippet.includes("starting server") ||
        textSnippet.includes("reload now") ||
        textSnippet.includes("ai studio logo")
      ) {
         return res.json({ 
           ok: false, 
           stage: "placeholder_html_rejected", 
           contentType, 
           sample: textSnippet.substring(0, 200) 
         });
      }
      
      const fileHeader = fileBytes.toString("utf8", 0, 5);
      const isPdfContent = contentType.includes("application/pdf");
      
      if (fileHeader !== "%PDF-" && !isPdfContent) {
         return res.json({ 
           ok: false, 
           stage: "source_not_pdf", 
           contentType, 
           sample: textSnippet.substring(0, 200) 
         });
      }
      
      const hash = crypto.createHash("sha256").update(fileBytes).digest("hex");
      
      let existingRecord = null;
      if (supabase) {
         try {
            const { data, error } = await supabase.from('pdf_documents').select('processing_status, review_status').eq('hash', hash).maybeSingle();
            if (!error && data) {
               existingRecord = data;
            }
         } catch(e) {}
      }
      if (!existingRecord) {
         const localDocs = getLocalPdfDocs();
         existingRecord = localDocs.find((d: any) => d.hash === hash) || null;
      }
      if (existingRecord && existingRecord.processing_status === 'completed') {
         return res.json({ ok: true, status: "duplicate", hash, record: existingRecord });
      }
      
      const destFilename = `${hash}.original.pdf`;
      let driveResult;
      try {
        const rootFolderId = await getOrCreateDriveFolderServer(accessToken, "AI Studio Curriculum Pipeline Workspace");
        const collectFolderId = await getOrCreateDriveFolderServer(accessToken, "Collected-Originals", rootFolderId);
        driveResult = await uploadToDriveServer(accessToken, destFilename, "application/pdf", fileBytes, collectFolderId);
      } catch (driveErr: any) {
        console.error("[Collector] Drive Upload Error:", driveErr.message, driveErr.response?.data);
        return res.json({
          ok: false,
          stage: "drive_upload_failed",
          error: driveErr.message,
          status: driveErr.response?.status,
          googleError: driveErr.response?.data?.error?.message
        });
      }
      
      const driveUrl = `https://drive.google.com/file/d/${driveResult.id}/view`;
      
      const documentData = {
         url,
         file_name: url.split('/').pop() || "document.pdf",
         hash,
         drive_file_id: driveResult.id,
         drive_url: driveUrl,
         storage_status: 'saved_to_drive',
         processing_status: 'not_started',
         review_status: 'not_reviewed',
         updated_at: new Date().toISOString(),
         created_at: new Date().toISOString()
      };

      let supabaseLogFailed = false;
      if (supabase) {
         try {
           const { error } = await supabase.from('pdf_documents').upsert(documentData, { onConflict: 'hash' });
           if (error) throw error;
         } catch(e: any) {
           console.error("[Collector] Supabase save error, using local fallback:", e.message);
           supabaseLogFailed = true;
         }
      } else {
         supabaseLogFailed = true;
      }

      // Always save to local JSON DB as fallback/mirror
      try {
         const localDocs = getLocalPdfDocs();
         const idx = localDocs.findIndex((d: any) => d.hash === hash);
         if (idx >= 0) {
            localDocs[idx] = { ...localDocs[idx], ...documentData };
         } else {
            localDocs.push(documentData);
         }
         saveLocalPdfDocs(localDocs);
      } catch (errLocal: any) {
         console.error("Failed to write PDF doc locally:", errLocal.message);
      }
      
      return res.json({ 
        ok: true, 
        status: "saved", 
        hash, 
        driveUrl,
        supabaseLogFailed 
      });
      
    } catch(err: any) {
      console.error("[Collector Error]", err);
      // Unexpected top-level error
      res.status(500).json({ ok: false, stage: "drive_upload_failed", error: err.message });
    }
  });

  app.get("/api/processor/queue", async (req, res) => {
     try {
       let items: any[] = [];
       let fetchedFromSupabase = false;
       if (supabase) {
          try {
             const { data, error } = await supabase.from('pdf_documents').select('*')
                 .eq('storage_status', 'saved_to_drive')
                 .order('created_at', { ascending: false });
             if (!error && data) {
                items = data;
                fetchedFromSupabase = true;
             }
          } catch(e) {}
       }
       if (!fetchedFromSupabase) {
          const localDocs = getLocalPdfDocs();
          items = localDocs
             .filter((d: any) => d.storage_status === 'saved_to_drive')
             .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
       }
       res.json({ items });
     } catch (e: any) { 
        res.status(500).json({ error: e.message }); 
     }
  });

  app.post("/api/processor/process", async (req, res) => {
    try {
      const { accessToken, driveFileId, hash } = req.body;
      if (!accessToken || !driveFileId) return res.status(400).json({ error: "Missing required parameters." });

      const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!driveRes.ok) {
        throw new Error(`Failed to download from Drive. Status: ${driveRes.status}`);
      }
      const fileBytes = Buffer.from(await driveRes.arrayBuffer());

      let rawText = "";
      try {
         const data = await pdf(fileBytes);
         rawText = data.text.replace(/\s+/g, " ").trim();
      } catch (err: any) {
         console.warn("[Processor] Error extracting text with pdf-parse", err);
      }

      if (rawText.length < 50) {
         // TODO: Fallback to OCR. Assuming text extraction via API. Focus mode or quick gemini vision
         rawText = "OCR NOT FULLY IMPLEMENTED IN MOCK - " + rawText;
      }

      const promptMetadata = `Analyze the following educational text from the Moroccan curriculum and classify it:
Text snippet: ${rawText.substring(0, 3000)}

Return JSON with format:
{
  "grade": "grade name or null (e.g. 1AEP, 2AEP, 3AC, TC, 1BAC, 2BAC - must be null if unknown)",
  "subject": "subject name or null",
  "topic": "topic name or null",
  "confidenceScore": 0.95
}`;
      const aiResponse = await nvidia.chat.completions.create({
         model: 'meta/llama-3.1-70b-instruct',
         messages: [{ role: 'user', content: promptMetadata }]
      });
      
      let classData: any = {};
      try {
         classData = JSON.parse(aiResponse.choices[0].message.content || '{}');
      } catch(e) {}
      
      const confidence = classData.confidenceScore || 0;
      let reviewStatus = "auto_approved";
      
      if (confidence < 0.7 || !classData.grade || !classData.subject) {
         reviewStatus = "needs_metadata_review";
      }

      // 6. Create chunks
      const chunks = [];
      const lines = rawText.split('\n');
      for (let i = 0; i < lines.length; i += 20) {
         const chunkText = lines.slice(i, i + 20).join('\n').trim();
         if (chunkText.length > 10) chunks.push(chunkText);
      }

      // 7. Save chunks
      if (supabase) {
         try {
            for (const chunk of chunks) {
               await supabase.from('rag_chunks').insert({
                 content: chunk,
                 source_type: 'pdf_document',
                 source_id: hash,
                 metadata: { grade: classData.grade, subject: classData.subject, topic: classData.topic, confidence }
               });
            }
         } catch (chunkErr: any) {
            console.error("Warning: Failed to insert chunks to Supabase, continuing:", chunkErr.message);
         }
      }

      // 8. Set processing_status
      if (supabase) {
         try {
            await supabase.from('pdf_documents').update({
              processing_status: 'completed',
              review_status: reviewStatus,
              updated_at: new Date().toISOString()
            }).eq('hash', hash);
         } catch (statusErr: any) {
            console.error("Warning: Failed to update status in Supabase pdf_documents, using local fallback copy:", statusErr.message);
         }
      }

      // Mirror the status update in the local database
      try {
         const localDocs = getLocalPdfDocs();
         const idx = localDocs.findIndex((d: any) => d.hash === hash);
         if (idx >= 0) {
            localDocs[idx] = {
               ...localDocs[idx],
               processing_status: 'completed',
               review_status: reviewStatus,
               updated_at: new Date().toISOString()
            };
            saveLocalPdfDocs(localDocs);
         }
      } catch (errLocal: any) {
         console.error("Failed to mirror status update locally:", errLocal.message);
      }

      res.json({ success: true, chunksCount: chunks.length, reviewStatus, classData });
    } catch(err: any) {
      console.error("[Processor Error]", err);
      res.status(500).json({ status: "failed", error: err.message });
    }
  });

  app.post("/api/pdf/fetch-source", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ ok: false, stage: "source_url_missing", error: "Invalid URL provided." });
      }
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return res.status(400).json({ ok: false, stage: "source_url_missing", error: "URL must start with http or https." });
      }

      console.log(`[Fetch Source] Fetching external PDF: ${url}`);
      
      let fetchUrl = url;
      if (fetchUrl.includes("drive.google.com/file/d/")) {
        const fileIdMatch = fetchUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          fetchUrl = `https://drive.google.com/uc?id=${fileIdMatch[1]}&export=download`;
        }
      }

      let response;
      try {
        response = await axios.get(fetchUrl, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 60000,
          maxContentLength: 60 * 1024 * 1024, // 60 MB matching MAX_FILE_SIZE_MB
          validateStatus: (status) => status < 400,
          httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
        });
      } catch (dlErr: any) {
         return res.status(400).json({ 
           ok: false, 
           stage: "source_fetch_failed", 
           error: dlErr.message,
           status: dlErr.response?.status 
         });
      }

      if (response.status !== 200) {
        return res.status(400).json({ ok: false, stage: "source_fetch_failed", status: response.status, error: `Source responded with status ${response.status}` });
      }

      const fileBytes = Buffer.from(response.data);
      if (fileBytes.length === 0) {
        return res.status(400).json({ ok: false, stage: "source_fetch_failed", error: "Source file is empty." });
      }

      const contentType = (response.headers["content-type"] || "").toLowerCase();
      const fileHeader = fileBytes.toString("utf8", 0, 5);
      const isPdfContent = contentType.includes("application/pdf");
      const hasPdfHeader = fileHeader === "%PDF-";

      const textSnippet = fileBytes.toString("utf8", 0, 1000).toLowerCase();

      if (
        textSnippet.includes("<!doctype html>") || 
        textSnippet.includes("<html") || 
        textSnippet.includes("please wait while your application starts") ||
        textSnippet.includes("starting server") ||
        textSnippet.includes("reload now") ||
        textSnippet.includes("ai studio logo")
      ) {
        return res.status(400).json({ 
          ok: false, 
          stage: "placeholder_html_rejected", 
          contentType,
          error: "Source URL returned an HTML page or placeholder instead of a PDF.",
          sample: textSnippet.substring(0, 200)
        });
      }

      if (!isPdfContent && !hasPdfHeader) {
        return res.status(400).json({ 
          ok: false, 
          stage: "source_not_pdf", 
          contentType, 
          error: "File is not a valid PDF document.",
          sample: textSnippet.substring(0, 200) 
        });
      }

      // Generate a clean filename if needed
      let fileName = url.split("/").pop() || "document.pdf";
      if (!fileName.toLowerCase().endsWith(".pdf")) {
        fileName += ".pdf";
      }
      
      // Clean up messy URL parameters in the filename
      fileName = fileName.split("?")[0].split("#")[0];

      res.json({
        ok: true,
        fileName,
        mimeType: "application/pdf",
        size: fileBytes.length,
        base64: fileBytes.toString("base64")
      });

    } catch (err: any) {
      console.error("[Fetch Source Error]", err.message);
      res.status(500).json({ ok: false, stage: "source_fetch_failed", error: `Failed to fetch PDF: ${err.message}` });
    }
  });

  app.post("/api/pdf/log-drive-upload", async (req, res) => {
    try {
      const { source_url, drive_file_id, drive_view_url, file_name, mime_type, file_size, status, error_message } = req.body;
      const logData = {
        source_url, drive_file_id, drive_view_url, file_name, mime_type, file_size, status, error_message,
        created_at: new Date().toISOString()
      };

      if (supabase) {
         try {
           const { error } = await supabase.from('pdf_drive_files').insert([logData]);
           if (error) {
              console.warn("[Supabase] Failed to insert to pdf_drive_files, recording locally:", error.message);
           }
         } catch (dbErr: any) {
            console.warn("[Supabase] Error inserting to pdf_drive_files, using local JSON fallback:", dbErr.message);
         }
      }

      // Always save to local JSON file
      try {
         const localDriveFiles = getLocalDriveFiles();
         localDriveFiles.push(logData);
         saveLocalDriveFiles(localDriveFiles);
      } catch (localErr: any) {
         console.error("Failed to save drive upload log locally:", localErr.message);
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.warn("[Supabase Logging Error]", err.message);
      res.json({ ok: false }); // non-blocking
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
