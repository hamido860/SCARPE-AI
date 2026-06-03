import axios from "axios";
import * as cheerio from "cheerio";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import * as crypto from "crypto";

export interface SearchTarget {
  grade_id: string;
  grade_name: string;
  track_id: string | null;
  track_name: string | null;
  subject_id: string;
  subject_name: string | null;
  module_id: string | null;
  module_name: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  language: string; // 'ar', 'fr', or 'both'
  required_terms: string[];
  optional_terms: string[];
  negative_terms: string[];
  search_queries: string[];
}

/**
 * Normalizes Arabic strings by replacing Alifs, Tehs, digits, and trimming white spaces
 */
export function normalizeArabicString(str: string): string {
  if (!str) return "";
  let val = str.toLowerCase().trim();
  // Eastern Arabic numbers to Western Arabic
  val = val.replace(/٠/g, "0")
           .replace(/١/g, "1")
           .replace(/٢/g, "2")
           .replace(/٣/g, "3")
           .replace(/٤/g, "4")
           .replace(/٥/g, "5")
           .replace(/٦/g, "6")
           .replace(/٧/g, "7")
           .replace(/٨/g, "8")
           .replace(/٩/g, "9");
  // Alif Hamzas to plain Alif
  val = val.replace(/[أإآ]/g, "ا");
  // Tehs (ة) to Heh (ه)
  val = val.replace(/ة/g, "ه");
  // Ya to Alif Maqsura or vice versa
  val = val.replace(/ي/g, "ى");
  return val;
}

/**
 * Normalizes French strings by converting to lowercase and stripping accents
 */
export function normalizeFrenchString(str: string): string {
  if (!str) return "";
  let val = str.toLowerCase().trim();
  val = val.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return val;
}

/**
 * Checks if a string contains Arabic characters
 */
export function isArabicText(str: string): boolean {
  const arRegex = /[\u0600-\u06FF]/;
  return arRegex.test(str);
}

/**
 * Builds SearchTarget records from Supabase classification dictionary structure
 */
export function buildSearchTargetsFromSupabaseDictionary(dictionary: any): SearchTarget[] {
  if (!dictionary) return [];
  
  const grades = dictionary.grades || [];
  const subjects = dictionary.subjects || [];
  const topics = dictionary.topics || [];

  const targets: SearchTarget[] = [];

  // Default system-wide negative terms
  const systemNegativeTerms = [
    "ads", "publicite", "premium", "crack", "hack", "paywall", "login", "register",
    "connexion", "s'inscrire", "recrutement", "job", "offres", "maternelle", 
    "universitaire", "faculte", "master", "doctorat"
  ];

  for (const grade of grades) {
    for (const subject of subjects) {
      // Find topics (lessons) belonging to this subject
      const subjectTopics = topics.filter((t: any) => t.subjectId === subject.id);

      for (const topic of subjectTopics) {
        // Collect grade terms
        const gradeTerms = [
          grade.id,
          grade.suffix,
          ...(grade.keywords || [])
        ].map(k => isArabicText(k) ? normalizeArabicString(k) : normalizeFrenchString(k)).filter(Boolean);

        // Collect subject terms
        const subjectTerms = [
          subject.id,
          subject.suffix,
          ...(subject.keywords || [])
        ].map(k => isArabicText(k) ? normalizeArabicString(k) : normalizeFrenchString(k)).filter(Boolean);

        // Collect topic terms
        const topicTerms = [
          topic.id,
          topic.suffix,
          ...(topic.keywords || [])
        ].map(k => isArabicText(k) ? normalizeArabicString(k) : normalizeFrenchString(k)).filter(Boolean);

        // Required terms: grade suffix, subject suffix, topic root suffix/id
        const requiredTerms = Array.from(new Set([
          grade.suffix?.toLowerCase(),
          subject.suffix?.toLowerCase(),
          topic.id?.toLowerCase()
        ].filter(Boolean) as string[]));

        const optionalTerms = Array.from(new Set([
          ...gradeTerms,
          ...subjectTerms,
          ...topicTerms
        ].filter(t => !requiredTerms.includes(t))));

        // Build domain-aware search queries from grade + subject + topic keywords
        const queries: string[] = [];
        
        const qGrade = grade.suffix || grade.nameFr;
        const qSubject = subject.nameAr || subject.nameFr;
        const qTopic = topic.nameAr || topic.nameFr;

        // Arabic templates
        if (grade.nameAr && subject.nameAr && topic.nameAr) {
          queries.push(`site:moutamadris.ma/cours/ "${grade.nameAr}" "${subject.nameAr}" "${topic.nameAr}"`);
          queries.push(`site:pdfmath.com "${grade.nameAr}" "${topic.nameAr}"`);
          queries.push(`"${grade.nameAr}" "${subject.nameAr}" "${topic.nameAr}" filetype:pdf`);
        }

        // French templates
        if (grade.nameFr && subject.nameFr && topic.nameFr) {
          queries.push(`site:moutamadris.ma/cours/ "${qGrade}" "${subject.nameFr}" "${topic.nameFr}"`);
          queries.push(`site:pdfmath.com "${qGrade}" "${topic.nameFr}"`);
          queries.push(`"${qGrade}" "${subject.nameFr}" "${topic.nameFr}" filetype:pdf`);
        }

        // Catchall general template
        queries.push(`"${qGrade}" "${qSubject}" "${qTopic}" filetype:pdf`);

        // Determine main language
        let lang = "both";
        if (isArabicText(topic.nameAr) && !topic.nameFr) {
          lang = "ar";
        } else if (!isArabicText(topic.nameAr) && topic.nameFr) {
          lang = "fr";
        }

        targets.push({
          grade_id: grade.id,
          grade_name: grade.nameFr || grade.nameAr || "",
          track_id: null,
          track_name: null,
          subject_id: subject.id,
          subject_name: subject.nameFr || subject.nameAr || "",
          module_id: null,
          module_name: null,
          lesson_id: topic.id,
          lesson_title: topic.nameFr || topic.nameAr || "",
          language: lang,
          required_terms: requiredTerms,
          optional_terms: optionalTerms,
          negative_terms: systemNegativeTerms,
          search_queries: Array.from(new Set(queries))
        });
      }
    }
  }

  return targets;
}

/**
 * Fetches HTML of page, follows redirects. Handles timeouts cleanly.
 */
export async function crawlPage(url: string, options: any = {}): Promise<string> {
  const timeoutMs = options.timeout || 15000;
  
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/437.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
    },
    timeout: timeoutMs,
    httpsAgent: new https.Agent({ 
      rejectUnauthorized: false, 
      secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT 
    }),
    validateStatus: (status) => status < 400
  });

  return String(response.data || "");
}

/**
 * Clears menu/footer wrapper nodes to avoid off-topic sidebar crawling
 */
function cleanNavigationAndFooters($: cheerio.CheerioAPI) {
  $('header, footer, nav, .navigation, .nav, .menu, .sidebar, .widget, .footer, .header, #header, #footer, #sidebar, #navigation').remove();
}

/**
 * Extracts links ending with .pdf, or containing /wp-content/uploads/, or matching specific Arabic download labels
 */
export function extractPdfLinks(html: string, baseUrl: string): Array<{ url: string; anchorText: string }> {
  if (!html) return [];
  const $ = cheerio.load(html);
  cleanNavigationAndFooters($);

  const results: Array<{ url: string; anchorText: string }> = [];
  const seenStr = new Set<string>();

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href) return;

    try {
      const fullUrl = new URL(href, baseUrl).href;
      const lowerUrl = fullUrl.toLowerCase().split(/[?#]/)[0];
      const isPdfUrl = lowerUrl.endsWith('.pdf') || 
                       lowerUrl.includes('/wp-content/uploads/') || 
                       fullUrl.includes('drive.google.com/file/d/');

      // Check Arabic buttons containing download, lesson, summary, exercises, exam labels
      // تحميل, درس, ملخص, تمارين, جذاذة, فرض
      const hasArabicDownloadLabel = text.match(/(\u062A\u062D\u0645\u064A\u0644|\u062F\u0631\u0633|\u0645\u0644\u062E\u0635|\u062A\u0645\u0627\u0631\u064A\u0646|\u062C\u0630\u0627\u0630\u0629|\u0641\u0631\u0636)/);

      if (isPdfUrl || hasArabicDownloadLabel) {
        const canonicalKey = fullUrl.split(/[?#]/)[0].toLowerCase();
        if (!seenStr.has(canonicalKey)) {
          seenStr.add(canonicalKey);
          results.push({
            url: fullUrl,
            anchorText: text || "تحميل الملف"
          });
        }
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  });

  return results;
}

/**
 * Performs a rigorous HEAD / GET verification of PDF mime-type and magic bytes
 */
export async function verifyPdf(url: string, options: any = {}): Promise<{ 
  valid: boolean; 
  reason?: string; 
  mimeType?: string; 
  size?: number; 
  buffer?: Buffer; 
}> {
  try {
    let fetchUrl = url;
    // Map Google Drive preview URLs to direct download
    if (fetchUrl.includes("drive.google.com/file/d/")) {
      const fileIdMatch = fetchUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch && fileIdMatch[1]) {
        fetchUrl = `https://drive.google.com/uc?id=${fileIdMatch[1]}&export=download`;
      }
    }

    const response = await axios.get(fetchUrl, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/437.36"
      },
      timeout: options.timeout || 20000,
      httpsAgent: new https.Agent({ 
        rejectUnauthorized: false, 
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT 
      }),
      validateStatus: (status) => status < 500
    });

    const statusCode = response.status;
    if (statusCode !== 200) {
      return { 
        valid: false, 
        reason: `Server responded with status code ${statusCode} instead of 200` 
      };
    }

    const buffer = Buffer.from(response.data);
    const contentType = (response.headers["content-type"] || "").toLowerCase();
    const size = buffer.length;

    // Check size limit
    if (size < 400) {
      return { 
        valid: false, 
        reason: `File size is too small (${size} bytes) for a valid PDF document`,
        size
      };
    }

    // Check Magic Bytes
    const magic = buffer.slice(0, 5).toString("ascii");
    const isMagicPdf = magic.startsWith("%PDF");

    if (!isMagicPdf) {
      const bodyString = buffer.toString("utf8");
      
      // Look for standard workspace and platform placeholders
      if (bodyString.includes("Please wait while your application starts")) {
        return { valid: false, reason: "Placeholder HTML page containing 'Please wait while your application starts'", size };
      }
      if (bodyString.includes("Starting Server")) {
        return { valid: false, reason: "Placeholder HTML page containing 'Starting Server'", size };
      }
      if (bodyString.includes("Reload now")) {
        return { valid: false, reason: "Placeholder HTML page containing 'Reload now'", size };
      }
      if (bodyString.toLowerCase().includes("<!doctype html>")) {
        return { valid: false, reason: "DocType HTML found instead of PDF binary signature", size };
      }
      if (bodyString.includes("AI Studio Logo")) {
        return { valid: false, reason: "HTML error page with AI Studio Logo", size };
      }
      
      if (contentType.includes("html")) {
        return { valid: false, reason: "Expected PDF but received HTML content type", size };
      }
    }

    if (!isMagicPdf) {
      return { 
        valid: false, 
        reason: `Invalid file signature: expected '%PDF' but instead found '${magic}'`,
        size,
        mimeType: contentType
      };
    }

    return {
      valid: true,
      size,
      mimeType: "application/pdf",
      buffer
    };
  } catch (err: any) {
    return {
      valid: false,
      reason: `Verification network or system error: ${err.message}`
    };
  }
}

/**
 * Scores a candidate PDF using targeted keywords from SearchTarget
 */
export function scorePdfCandidate(
  candidate: { url: string; anchorText: string; pageTitle?: string; firstPageText?: string }, 
  target: SearchTarget
): number {
  const normUrl = normalizeFrenchString(candidate.url) + " " + normalizeArabicString(candidate.url);
  const normAnchor = normalizeFrenchString(candidate.anchorText) + " " + normalizeArabicString(candidate.anchorText);
  const normTitle = normalizeFrenchString(candidate.pageTitle || "") + " " + normalizeArabicString(candidate.pageTitle || "");
  const normFirstPage = normalizeFrenchString(candidate.firstPageText || "") + " " + normalizeArabicString(candidate.firstPageText || "");

  const fullCandidateText = `${normUrl} ${normAnchor} ${normTitle} ${normFirstPage}`.toLowerCase();

  // Reject immediately if any negative term matches
  for (const neg of target.negative_terms) {
    const normalizedNeg = isArabicText(neg) ? normalizeArabicString(neg) : normalizeFrenchString(neg);
    if (fullCandidateText.includes(normalizedNeg)) {
      return 0; // immediate rejection
    }
  }

  let score = 0;

  // Grade matching check
  let gradeMatched = false;
  for (const keyword of target.optional_terms) {
    const rawKeyword = String(keyword);
    const wordNormalized = isArabicText(rawKeyword) ? normalizeArabicString(rawKeyword) : normalizeFrenchString(rawKeyword);
    if (!wordNormalized) continue;

    // Check occurrences
    if (normUrl.includes(wordNormalized)) score += 10;
    if (normAnchor.includes(wordNormalized)) score += 10;
    if (normTitle.includes(wordNormalized)) score += 5;
    if (normFirstPage.includes(wordNormalized)) score += 5;
  }

  // Check required terms specifically
  for (const req of target.required_terms) {
    const nameNormalized = isArabicText(req) ? normalizeArabicString(req) : normalizeFrenchString(req);
    if (!nameNormalized) continue;

    if (normUrl.includes(nameNormalized)) score += 15;
    if (normAnchor.includes(nameNormalized)) score += 15;
    if (normTitle.includes(nameNormalized)) score += 10;
    if (normFirstPage.includes(nameNormalized)) score += 10;
  }

  return score;
}

/**
 * Downloads a verified PDF to buffer
 */
export async function downloadVerifiedPdf(url: string, options: any = {}): Promise<Buffer> {
  const verification = await verifyPdf(url, options);
  if (!verification.valid || !verification.buffer) {
    throw new Error(`PDF verification failed: ${verification.reason || "Unknown reason"}`);
  }
  return verification.buffer;
}
