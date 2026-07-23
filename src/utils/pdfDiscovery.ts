import https from "https";
import crypto from "crypto";
import axios from "axios";
import { load, type CheerioAPI } from "cheerio";
import { formatLevelspaceReviewTitle } from "./filenameGenerator";

export interface DiscoveredItem {
  url: string;
  raw_url: string;
  normalized_url: string;
  source_page_url: string;
  pdf_url: string;
  url_type: "direct_pdf" | "source_page" | "source_page_no_pdfs";
  pdf_count: number;
  isDirectPdf: boolean;
  accepted: boolean;
  reason: string;
  title?: string;
  cleanTitle?: string;
  metadata?: {
    grade: string | null;
    subject: string | null;
    track: string | null;
    documentType: string | null;
    schoolYear: string | null;
    region: string | null;
    source: string | null;
  };
}

export interface CrawlerOptions {
  maxPages: number;
  maxDepth: number;
  maxPdfs: number;
  maxLinksPerPage: number;
  batchSize: number;
  timeLimitMs: number;
}

interface QueuedUrl {
  url: string;
  depth: number;
}

interface ScopeMetadata {
  grade: string | null;
  subject: string | null;
  track: string | null;
  documentType: string | null;
  schoolYear: string | null;
  region: string | null;
  source: string | null;
}

interface PdfEvidence {
  sourcePageUrl: string;
  context: string;
}

const MAIN_CONTENT_SELECTORS = [
  ".entry-content",
  ".post-content",
  "article",
  "main",
  "#content",
  ".content-area",
];

const EXCLUDED_LINK_ANCESTORS = [
  "header",
  "footer",
  "nav",
  "#sidebar",
  ".sidebar",
  ".widget",
  ".social-share",
  "#secondary",
  ".menu",
  ".navigation",
].join(", ");

// Arabic is matched after normalization: ة -> ه and ى -> ي.
const CONTENT_LINK_PATTERN = /(cours|le[cç]on|lesson|dars|sourate|درس|دروس|شرح|ملخص|تمارين|exercice|تمرين|correction|solution|سوره|مدخل|تزكيه|اقتداء|استجابه|قسط|حكمه)/i;
const BLOCKED_LINK_PATTERN = /(login|register|contact|privacy|policy|about|author|tag|category|feed|wp-admin|wp-login|facebook|twitter|instagram|youtube|telegram|whatsapp|all subjects|جميع المواد|باقي المواد|كل المواد|امتحانات|فروض|اختبارات|جذاذات|توزيع|استعمال الزمن|عطل|توجيه)/i;

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeMatchText(value: string): string {
  return safeDecode(String(value || ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F]/g, "")
    .replace(/[_\-./%+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitConcatenatedUrls(input: string): string[] {
  if (!input) return [];
  const results: string[] = [];

  for (const part of input.split(/\s+/).filter(Boolean)) {
    const indexes: number[] = [];
    const matcher = /https?:\/\//gi;
    let match: RegExpExecArray | null;

    while ((match = matcher.exec(part)) !== null) indexes.push(match.index);

    if (indexes.length <= 1) {
      results.push(part);
      continue;
    }

    for (let index = 0; index < indexes.length; index += 1) {
      results.push(part.slice(indexes[index], indexes[index + 1] ?? part.length));
    }
  }

  return results;
}

export function removeHashFragment(urlStr: string): string {
  return String(urlStr || "").split("#")[0];
}

export function normalizeUrlSafe(urlStr: string): string {
  const noHash = removeHashFragment(urlStr);
  try {
    const parsed = new URL(noHash);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return noHash.replace(/\/+$/, "");
  }
}

export function isDirectPdfUrl(urlStr: string): boolean {
  try {
    const cleanUrl = String(urlStr || "").split(/[?#]/)[0].toLowerCase();
    return cleanUrl.endsWith(".pdf") || cleanUrl.includes("drive.google.com/file/d/");
  } catch {
    return false;
  }
}

export function resolveRelativeUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

export function isAssetUrl(urlStr: string): boolean {
  const cleanUrl = String(urlStr || "").split(/[?#]/)[0].toLowerCase();
  return [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".svg",
    ".css",
    ".js",
    ".zip",
    ".rar",
    ".7z",
    ".mp3",
    ".mp4",
  ].some((extension) => cleanUrl.endsWith(extension));
}

export function isPaginationLink($el: any, href: string): boolean {
  if ($el.attr("rel") === "next") return true;

  const text = String($el.text() || "").toLowerCase().trim();
  const className = String($el.attr("class") || "").toLowerCase();
  const paginationTexts = [
    "next",
    "suivant",
    "suivante",
    "page suivante",
    "التالي",
    "الصفحة التالية",
    "older posts",
  ];

  if (paginationTexts.some((candidate) => text.includes(candidate))) return true;
  if (["next", "pagination-next", "nav-next", "page-numbers"].some((candidate) => className.includes(candidate))) return true;
  if (/[?&](page|paged|p)=\d+/i.test(href)) return true;
  if (/\/page\/\d+\/?/i.test(href)) return true;

  return /^\d+$/.test(text) && Boolean($el.parents(".pagination, .nav-links").length);
}

export function extractClassifyingMetadata(urlStr: string, textContext = ""): ScopeMetadata {
  const decodedUrl = normalizeMatchText(urlStr);
  const rootText = normalizeMatchText(textContext);
  const combinedText = `${decodedUrl} ${rootText}`.trim();

  const checkGrade = (source: string): string | null => {
    if (/(1ap|الاول ابتدائي|السنه الاولي ابتدائي)/.test(source)) return "1AEP";
    if (/(2ap|الثاني ابتدائي|السنه الثانيه ابتدائي)/.test(source)) return "2AEP";
    if (/(3ap|الثالث ابتدائي|السنه الثالثه ابتدائي)/.test(source)) return "3AEP";
    if (/(4ap|الرابع ابتدائي|السنه الرابعه ابتدائي)/.test(source)) return "4AEP";
    if (/(5ap|الخامس ابتدائي|السنه الخامسه ابتدائي)/.test(source)) return "5AEP";
    if (/(6ap|السادس ابتدائي|السنه السادسه ابتدائي)/.test(source)) return "6AEP";
    if (/(1bac|1ere bac|اولي باك|الاولي بكالوريا)/.test(source)) return "1BAC";
    if (/(2bac|2eme bac|ثانيه باك|الثانيه بكالوريا|البكالوريا)/.test(source)) return "2BAC";
    if (/(3apic|3ac|3eme annee college|الثالثه اعدادي|السنه الثالثه اعدادي)/.test(source)) return "3AC";
    if (/(2apic|2ac|2eme annee college|الثانيه اعدادي|السنه الثانيه اعدادي)/.test(source)) return "2AC";
    if (/(1apic|1ac|1ere annee college|الاولي اعدادي|اولي اعدادي|السنه الاولي اعدادي)/.test(source)) return "1AC";
    if (/(tronc commun|جذع مشترك|\btc\b|\btcs\b)/.test(source)) return "Tronc Commun";
    return null;
  };

  const checkSubject = (source: string): string | null => {
    if (/(math|رياضيات)/.test(source)) return "Mathématiques";
    if (/(physique|chimie|\bpc\b|فيزياء|الكيمياء)/.test(source)) return "Physique-Chimie";
    if (/(svt|sciences de la vie|علوم الحياه|علوم الارض)/.test(source)) return "SVT";
    if (/(francais|français|الفرنسيه)/.test(source)) return "Français";
    if (/(anglais|english|الانجليزيه)/.test(source)) return "Anglais";
    if (/(education islamique|islamic|التربيه الاسلاميه|تربيه اسلاميه|اسلاميه)/.test(source)) return "Education Islamique";
    if (/(arabe|اللغه العربيه|العربيه)/.test(source)) return "Arabe";
    if (/(الاجتماعيات|histoire|geographie|géographie)/.test(source)) return "Sciences Sociales";
    return null;
  };

  const checkDocumentType = (source: string): string | null => {
    if (/(examen regional|regional|جهوي)/.test(source)) return "Examen régional";
    if (/(examen national|national|وطني)/.test(source)) return "Examen national";
    if (/(resume|ملخص)/.test(source)) return "Résumé";
    if (/(corrige|correction|تصحيح|حلول)/.test(source)) return "Devoir corrigé";
    if (/(devoir|controle|فرض|فروض)/.test(source)) return "Devoir";
    if (/(exercice|serie|تمارين|سلسله)/.test(source)) return "Exercices";
    if (/(cours|lesson|درس|دروس|شرح)/.test(source)) return "Cours";
    return null;
  };

  const checkTrack = (source: string): string | null => {
    if (/(biof|خيار فرنسي|option francais)/.test(source)) return "Sciences Expérimentales BIOF";
    if (/(خيار عربي|option arabe)/.test(source)) return "Option Arabe";
    if (/(lettres|اداب)/.test(source)) return "Lettres";
    return null;
  };

  const regions = [
    "Casablanca-Settat",
    "Rabat-Salé-Kénitra",
    "Fès-Meknès",
    "Marrakech-Safi",
    "Tanger-Tétouan-Al Hoceïma",
    "Souss-Massa",
    "Béni Mellal-Khénifra",
    "Drâa-Tafilalet",
    "Oriental",
    "Guelmim-Oued Noun",
    "Laâyoune-Sakia El Hamra",
    "Dakhla-Oued Ed-Dahab",
  ];

  const region = regions.find((candidate) =>
    combinedText.includes(normalizeMatchText(candidate)),
  ) || null;
  const schoolYear = combinedText.match(/20\d{2}(?:\s*[-/]\s*20\d{2})?/)?.[0]?.replace(/\s+/g, "") || null;

  let source: string | null = null;
  try {
    const hostname = new URL(urlStr).hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    const sourceName = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    source = sourceName.charAt(0).toUpperCase() + sourceName.slice(1);
  } catch {
    source = null;
  }
  if (urlStr.includes("drive.google.com")) source = "Google Drive";

  return {
    grade: checkGrade(decodedUrl) || checkGrade(rootText),
    subject: checkSubject(decodedUrl) || checkSubject(rootText),
    track: checkTrack(decodedUrl) || checkTrack(rootText),
    documentType: checkDocumentType(decodedUrl) || checkDocumentType(rootText),
    schoolYear,
    region,
    source,
  };
}

function mergeScope(primary: ScopeMetadata, fallback: ScopeMetadata): ScopeMetadata {
  return {
    grade: primary.grade || fallback.grade,
    subject: primary.subject || fallback.subject,
    track: primary.track || fallback.track,
    documentType: primary.documentType || fallback.documentType,
    schoolYear: primary.schoolYear || fallback.schoolYear,
    region: primary.region || fallback.region,
    source: primary.source || fallback.source,
  };
}

function isScopeCompatible(expected: ScopeMetadata, candidate: ScopeMetadata): boolean {
  if (expected.grade && candidate.grade && expected.grade !== candidate.grade) return false;
  if (expected.subject && candidate.subject && expected.subject !== candidate.subject) return false;
  return true;
}

function getMainText($: CheerioAPI): string {
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const text = $(selector).first().text().replace(/\s+/g, " ").trim();
    if (text.length > 80) return text.slice(0, 5000);
  }
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000);
}

function hasSameOrigin(url: string, expectedOrigin: string): boolean {
  try {
    return new URL(url).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function isCandidatePageLink(params: {
  href: string;
  text: string;
  currentUrl: string;
  rootOrigin: string;
  rootScope: ScopeMetadata;
  isPagination: boolean;
}): boolean {
  const { href, text, currentUrl, rootOrigin, rootScope, isPagination } = params;
  if (!hasSameOrigin(href, rootOrigin)) return false;
  if (href === currentUrl || isAssetUrl(href) || isDirectPdfUrl(href)) return false;

  const normalized = normalizeMatchText(`${href} ${text}`);
  if (BLOCKED_LINK_PATTERN.test(normalized)) return false;

  const candidateScope = extractClassifyingMetadata(href, text);
  if (!isScopeCompatible(rootScope, candidateScope)) return false;

  if (isPagination) return true;
  if (CONTENT_LINK_PATTERN.test(normalized)) return true;
  if (rootScope.subject && candidateScope.subject === rootScope.subject) return true;
  if (rootScope.grade && candidateScope.grade === rootScope.grade && !candidateScope.subject) return true;

  return false;
}

export async function discoverPdfsFromInput(
  pastedText: string,
  topicFilter?: string,
  options: Partial<CrawlerOptions> = {},
): Promise<DiscoveredItem[]> {
  const opts: CrawlerOptions = {
    maxPages: 30,
    maxDepth: 2,
    maxPdfs: 150,
    maxLinksPerPage: 30,
    batchSize: 4,
    timeLimitMs: 90_000,
    ...options,
  };

  opts.maxPages = Math.max(1, Math.min(opts.maxPages, 30));
  opts.maxDepth = Math.max(0, Math.min(opts.maxDepth, 3));
  opts.maxPdfs = Math.max(1, Math.min(opts.maxPdfs, 150));
  opts.maxLinksPerPage = Math.max(1, Math.min(opts.maxLinksPerPage, 30));
  opts.batchSize = Math.max(1, Math.min(opts.batchSize, 5));

  const rawUrls = splitConcatenatedUrls(pastedText);
  const results: DiscoveredItem[] = [];

  for (const rawUrl of rawUrls) {
    const rootNormalized = normalizeUrlSafe(rawUrl);

    if (isDirectPdfUrl(rootNormalized)) {
      const metadata = extractClassifyingMetadata(rootNormalized);
      const cleanTitle = formatLevelspaceReviewTitle(metadata);
      results.push({
        url: rootNormalized,
        raw_url: rawUrl,
        normalized_url: rootNormalized,
        source_page_url: rootNormalized,
        pdf_url: rootNormalized,
        url_type: "direct_pdf",
        pdf_count: 1,
        isDirectPdf: true,
        accepted: true,
        reason: "Direct PDF document link detected",
        title: cleanTitle || rootNormalized.split("/").pop() || "Direct PDF",
        cleanTitle,
        metadata,
      });
      continue;
    }

    let rootOrigin: string;
    try {
      rootOrigin = new URL(rootNormalized).origin;
    } catch {
      results.push({
        url: rootNormalized,
        raw_url: rawUrl,
        normalized_url: rootNormalized,
        source_page_url: rootNormalized,
        pdf_url: rootNormalized,
        url_type: "source_page_no_pdfs",
        pdf_count: 0,
        isDirectPdf: false,
        accepted: false,
        reason: "Invalid source URL",
      });
      continue;
    }

    const queue: QueuedUrl[] = [{ url: rootNormalized, depth: 0 }];
    const queued = new Set<string>([rootNormalized]);
    const visited = new Set<string>();
    const pdfEvidence = new Map<string, PdfEvidence>();
    const startTime = Date.now();
    let pagesCrawled = 0;
    let rootPageTitle = "";
    let rootScope = extractClassifyingMetadata(rootNormalized, topicFilter || "");

    while (queue.length > 0 && pdfEvidence.size < opts.maxPdfs) {
      if (pagesCrawled >= opts.maxPages) break;
      if (Date.now() - startTime > opts.timeLimitMs) break;

      const batch = queue.splice(0, opts.batchSize).filter(({ url }) => !visited.has(url));
      if (batch.length === 0) continue;

      for (const item of batch) {
        if (pagesCrawled >= opts.maxPages || pdfEvidence.size >= opts.maxPdfs) break;
        if (Date.now() - startTime > opts.timeLimitMs) break;

        visited.add(item.url);
        pagesCrawled += 1;

        try {
          const response = await axios.get(item.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
              "Accept-Language": "fr,en-US;q=0.7,en;q=0.3",
            },
            httpsAgent,
            timeout: item.depth === 0 ? 60_000 : 12_000,
            validateStatus: () => true,
          });

          if (response.status >= 400) continue;
          const pageHtml = typeof response.data === "string" ? response.data : "";
          if (!pageHtml) continue;

          const $ = load(pageHtml);
          const pageTitle = $("title").text().trim();
          const mainText = getMainText($);
          const pageContext = `${pageTitle} ${mainText}`.trim();
          const pageScope = extractClassifyingMetadata(item.url, pageContext);

          if (item.depth === 0) {
            rootPageTitle = pageTitle;
            rootScope = mergeScope(pageScope, rootScope);
          } else if (!isScopeCompatible(rootScope, pageScope)) {
            continue;
          }

          const pageAnchors: Array<{ href: string; text: string; inMain: boolean; isPagination: boolean }> = [];
          $("a").each((_, element) => {
            const $element = $(element);
            if ($element.parents(EXCLUDED_LINK_ANCESTORS).length > 0) return;

            const rawHref = $element.attr("href");
            if (!rawHref || rawHref.startsWith("javascript:") || rawHref.startsWith("#")) return;

            const href = normalizeUrlSafe(resolveRelativeUrl(rawHref, item.url));
            const text = $element.text().replace(/\s+/g, " ").trim();
            const inMain = $element.parents(MAIN_CONTENT_SELECTORS.join(", ")).length > 0;
            const isPagination = isPaginationLink($element, rawHref);
            pageAnchors.push({ href, text, inMain, isPagination });
          });

          for (const anchor of pageAnchors) {
            if (!isDirectPdfUrl(anchor.href)) continue;
            if (pdfEvidence.size >= opts.maxPdfs) break;

            const pdfScope = extractClassifyingMetadata(
              anchor.href,
              `${anchor.text} ${pageTitle}`,
            );
            if (!isScopeCompatible(rootScope, pdfScope)) continue;

            pdfEvidence.set(anchor.href, {
              sourcePageUrl: item.url,
              context: `${anchor.text} ${pageTitle} ${rootPageTitle}`.trim(),
            });
          }

          if (item.depth >= opts.maxDepth) continue;

          const paginationLinks: string[] = [];
          const contentLinks: string[] = [];
          for (const anchor of pageAnchors) {
            if (!anchor.inMain && !anchor.isPagination) continue;
            if (visited.has(anchor.href) || queued.has(anchor.href)) continue;

            const allowed = isCandidatePageLink({
              href: anchor.href,
              text: anchor.text,
              currentUrl: item.url,
              rootOrigin,
              rootScope,
              isPagination: anchor.isPagination,
            });
            if (!allowed) continue;

            if (anchor.isPagination) paginationLinks.push(anchor.href);
            else contentLinks.push(anchor.href);
          }

          for (const href of paginationLinks.slice(0, 3)) {
            if (queued.has(href)) continue;
            queued.add(href);
            queue.unshift({ url: href, depth: item.depth });
          }

          for (const href of contentLinks.slice(0, opts.maxLinksPerPage)) {
            if (queued.has(href)) continue;
            queued.add(href);
            queue.push({ url: href, depth: item.depth + 1 });
          }
        } catch (error) {
          console.warn(`[Discover Service] Crawl failed for ${item.url}:`, error);
        }
      }

      if (queue.length > 0) await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const uniquePdfLinks = Array.from(pdfEvidence.keys());
    if (uniquePdfLinks.length === 0) {
      const metadata = rootScope;
      const cleanTitle = formatLevelspaceReviewTitle(metadata);
      results.push({
        url: rootNormalized,
        raw_url: rawUrl,
        normalized_url: rootNormalized,
        source_page_url: rootNormalized,
        pdf_url: rootNormalized,
        url_type: "source_page_no_pdfs",
        pdf_count: 0,
        isDirectPdf: false,
        accepted: true,
        reason: `No scoped educational PDFs discovered after crawling ${pagesCrawled} page(s).`,
        title: cleanTitle || rootPageTitle || rootNormalized,
        cleanTitle,
        metadata,
      });
      continue;
    }

    for (const pdfLink of uniquePdfLinks) {
      const evidence = pdfEvidence.get(pdfLink)!;
      const metadata = mergeScope(
        extractClassifyingMetadata(pdfLink, evidence.context),
        rootScope,
      );
      const cleanTitle = formatLevelspaceReviewTitle(metadata);

      results.push({
        url: pdfLink,
        raw_url: rawUrl,
        normalized_url: rootNormalized,
        source_page_url: evidence.sourcePageUrl,
        pdf_url: pdfLink,
        url_type: "source_page",
        pdf_count: uniquePdfLinks.length,
        isDirectPdf: true,
        accepted: true,
        reason: `Extracted from scoped educational source page: ${evidence.sourcePageUrl}`,
        title: cleanTitle || pdfLink.split("/").pop() || rootPageTitle,
        cleanTitle,
        metadata,
      });
    }
  }

  return results;
}
