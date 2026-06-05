import https from 'https';
import crypto from 'crypto';
import axios from "axios";
import { load } from "cheerio";
import { formatLevelspaceReviewTitle, formatLevelspaceSafeFilename } from "./filenameGenerator";

export interface DiscoveredItem {
  url: string;               // direct pdf link (resolved) - maps to item.url in frontend
  raw_url: string;           // original user-input pasted URL with hash
  normalized_url: string;    // split + no hash
  source_page_url: string;   // normalized_url of source html page (if not direct pdf) or equal to pdf_url (if direct pdf)
  pdf_url: string;           // direct pdf link (resolved)
  url_type: "direct_pdf" | "source_page" | "source_page_no_pdfs";
  pdf_count: number;         // count of uniquely discovered PDFs
  isDirectPdf: boolean;      // standard helper for client-side staging
  accepted: boolean;         // default acceptance state
  reason: string;            // status explanation
  title?: string;            // page/doc title
  cleanTitle?: string;
  metadata?: {
    grade: string | null;
    subject: string | null;
    track: string | null;
    documentType: string | null;
    schoolYear: string | null;
    source: string | null;
  };
}

export function splitConcatenatedUrls(input: string): string[] {
  if (!input) return [];
  const parts = input.split(/\s+/).filter(Boolean);
  const results: string[] = [];
  const regex = /https?:\/\//gi;
  
  for (const part of parts) {
    const matches: number[] = [];
    let match;
    while ((match = regex.exec(part)) !== null) {
      matches.push(match.index);
    }
    if (matches.length <= 1) {
      results.push(part);
    } else {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i];
        const end = i + 1 < matches.length ? matches[i + 1] : part.length;
        results.push(part.substring(start, end));
      }
    }
  }
  return results;
}

export function removeHashFragment(urlStr: string): string {
  if (!urlStr) return "";
  return urlStr.split("#")[0];
}

export function normalizeUrlSafe(urlStr: string): string {
  const noHash = removeHashFragment(urlStr);
  try {
    const parsed = new URL(noHash);
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return noHash.replace(/\/$/, "");
  }
}

export function isDirectPdfUrl(urlStr: string): boolean {
  try {
    const cleanUrl = urlStr.split(/[?#]/)[0];
    const lowerUrl = cleanUrl.toLowerCase();
    return lowerUrl.endsWith(".pdf") || lowerUrl.includes("drive.google.com/file/d/");
  } catch {
    return urlStr.toLowerCase().includes(".pdf") || urlStr.toLowerCase().includes("drive.google.com/file/d/");
  }
}

export function resolveRelativeUrl(href: string, baseUrl: string): string {
  try {
    const resolved = new URL(href, baseUrl);
    return resolved.href;
  } catch {
    return href;
  }
}

export function isAssetUrl(urlStr: string): boolean {
  try {
    const cleanUrl = urlStr.split(/[?#]/)[0].toLowerCase();
    return [".jpg", ".png", ".webp", ".gif", ".css", ".js", ".zip", ".rar"].some(ext => cleanUrl.endsWith(ext));
  } catch {
    return false;
  }
}

export function isPaginationLink($el: any, href: string): boolean {
  if ($el.attr("rel") === "next") return true;
  
  const text = $el.text().toLowerCase().trim();
  const paginationTexts = ["next", "suivant", "suivante", "page suivante", "التالي", "الصفحة التالية", "older posts"];
  if (paginationTexts.some(t => text.includes(t))) return true;

  const className = ($el.attr("class") || "").toLowerCase();
  const paginationClasses = ["next", "pagination-next", "nav-next", "page-numbers"];
  if (paginationClasses.some(c => className.includes(c))) return true;

  if (href.match(/[?&](page|paged|p)=\d+/i)) return true;
  if (href.match(/\/page\/\d+\/?/i)) return true;

  if (/^\d+$/.test(text) && (className.includes("page") || $el.parents('.pagination, .nav-links').length > 0)) {
    return true;
  }

  return false;
}

export function extractClassifyingMetadata(urlStr: string, textContext: string = "") {
  let grade: string | null = null;
  let subject: string | null = null;
  let track: string | null = null;
  let documentType: string | null = null;
  let schoolYear: string | null = null;
  let region: string | null = null;
  let source: string | null = null;

  let decodedUrl = urlStr;
  try {
    decodedUrl = decodeURIComponent(urlStr).toLowerCase();
  } catch {}

  const rootText = textContext.toLowerCase();
  
  const checkGrades = (source: string) => {
    if (source.match(/(1ap|الاول-ابتدائي|الأول-ابتدائي|الاول ابتدائي|السنة الأولى ابتدائي)/)) return "1AEP";
    if (source.match(/(2ap|الثاني-ابتدائي|الثانية-ابتدائي|الثاني ابتدائي|السنة الثانية ابتدائي)/)) return "2AEP";
    if (source.match(/(3ap|الثالث-ابتدائي|الثالثة-ابتدائي|الثالث ابتدائي|السنة الثالثة ابتدائي)/)) return "3AEP";
    if (source.match(/(4ap|الرابع-ابتدائي|الرابعة-ابتدائي|الرابع ابتدائي|السنة الرابعة ابتدائي)/)) return "4AEP";
    if (source.match(/(5ap|الخامس-ابتدائي|الخامسة-ابتدائي|الخامس ابتدائي|السنة الخامسة ابتدائي)/)) return "5AEP";
    if (source.match(/(6ap|السادس-ابتدائي|السادسة-ابتدائي|السادس ابتدائي|السنة السادسة ابتدائي)/)) return "6AEP";
    if (source.match(/(3apic|3ac|3eme|3ème|ثالثة اعدادي|السنة الثالثة اعدادي)/)) return "3AC";
    if (source.match(/(2ac|ثانية اعدادي|السنة الثانية اعدادي)/)) return "2AC";
    if (source.match(/(1ac|اولى اعدادي|السنة الاولى اعدادي|الاولى اعدادي)/)) return "1AC";
    if (source.match(/(tronc commun|جذع مشترك|tc|tcs)/)) return "Tronc Commun";
    if (source.match(/(1bac|1ere bac|اولى باك|الأولى بكالوريا|الاولى باك)/)) return "1BAC";
    if (source.match(/(2bac|2eme bac|ثانية باك|الثانية باك|البكالوريا|ثانية بكالوريا)/)) return "2BAC";
    return null;
  };

  grade = checkGrades(decodedUrl) || checkGrades(rootText);

  const checkSubjects = (source: string) => {
    if (source.match(/(math|رياضيات|الرياضيات)/)) return "Mathématiques";
    if (source.match(/(physique|chimie|pc|الفيزياء)/)) return "Physique-Chimie";
    if (source.match(/(svt|sciences de la vie|الارض|الأرض)/)) return "SVT";
    if (source.match(/(francais|français|الفرنسية)/)) return "Français";
    if (source.match(/(anglais|english|الانجليزية|الإنجليزية)/)) return "Anglais";
    if (source.match(/(islamic|education islamique|التربية الاسلامية|التربية الإسلامية)/)) return "Education Islamique";
    if (source.match(/(arabe|العربية)/)) return "Arabe";
    return null;
  };

  subject = checkSubjects(decodedUrl) || checkSubjects(rootText);

  const checkTracks = (source: string) => {
    if (source.match(/(biof|خيار فرنسي|option francais|option français)/)) return "Sciences Expérimentales BIOF";
    if (source.match(/(خيار عربي|option arabe)/)) return "Option Arabe";
    if (!source.match(/(sciences de la vie|علوم الحياة)/) && source.match(/(science |sciences |علوم|العلوم)/)) return "Sciences";
    if (source.match(/(lettres|اداب|الآداب)/)) return "Lettres";
    return null;
  };
  
  track = checkTracks(decodedUrl) || checkTracks(rootText);

  const checkDocTypes = (source: string) => {
    if (source.match(/(examen régional|examen regional|régional|regional|جهوي)/)) return "Examen régional";
    if (source.match(/(examen national|national|وطني)/)) return "Examen national";
    if (source.match(/(cours|lesson|درس|دروس)/)) return "Cours";
    if (source.match(/(exercice|serie|تمارين|سلسلة)/)) return "Exercices";
    if (source.match(/(corrige|correction|تصحيح)/)) return "Devoir corrigé";
    if (source.match(/(devoir|controle|فرض|فروض)/)) return "Devoir";
    if (source.match(/(resume|ملخص|ملخصات)/)) return "Résumé";
    return null;
  };

  documentType = checkDocTypes(decodedUrl) || checkDocTypes(rootText);

  // Common Moroccan regions
  const regions = [
    "Casablanca-Settat", "Rabat-Salé-Kénitra", "Fès-Meknès", "Marrakech-Safi", 
    "Tanger-Tétouan-Al Hoceïma", "Souss-Massa", "Béni Mellal-Khénifra", 
    "Drâa-Tafilalet", "Oriental", "Guelmim-Oued Noun", "Laâyoune-Sakia El Hamra", 
    "Dakhla-Oued Ed-Dahab"
  ];
  
  for (const r of regions) {
    if (combinedText.replace(/-/g, " ").includes(r.toLowerCase().replace(/-/g, " "))) {
      region = r;
      break;
    }
  }

  const yearMatch = combinedText.match(/20\d{2}(-20\d{2})?/);
  if (yearMatch) {
    schoolYear = yearMatch[0];
  }

  try {
    if (urlStr.startsWith("http")) {
      const hostname = new URL(urlStr).hostname;
      const parts = hostname.replace("www.", "").split(".");
      source = parts.length > 1 ? parts[parts.length - 2] : parts[0];
      source = source.charAt(0).toUpperCase() + source.slice(1);
    }
  } catch {}

  // Google Drive override
  if (urlStr.includes("drive.google.com")) {
    source = "Google Drive";
  }

  return { grade, subject, track, documentType, schoolYear, region, source };
}

export interface CrawlerOptions {
  maxPages: number;
  maxDepth: number;
  batchSize: number;
  timeLimitMs: number;
}

interface QueuedUrl {
  url: string;
  depth: number;
}

export async function discoverPdfsFromInput(
  pastedText: string,
  topicFilter?: string,
  options: Partial<CrawlerOptions> = {}
): Promise<DiscoveredItem[]> {
  const opts = {
    maxPages: 50,
    maxDepth: 3,
    batchSize: 5,
    timeLimitMs: 90000,
    ...options
  };

  const rawUrls = splitConcatenatedUrls(pastedText);
  const results: DiscoveredItem[] = [];

  for (const rawUrl of rawUrls) {
    const rootNormalized = normalizeUrlSafe(rawUrl);

    if (isDirectPdfUrl(rootNormalized)) {
      const meta = extractClassifyingMetadata(rootNormalized);
      const cleanTitle = formatLevelspaceReviewTitle(meta);
      
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
        cleanTitle: cleanTitle,
        metadata: meta
      });
      continue;
    }

    console.log(`[Discover Service] Starting crawl for root HTML page: ${rootNormalized}`);
    
    const queue: QueuedUrl[] = [{ url: rootNormalized, depth: 0 }];
    const visited = new Set<string>();
    const pagePdfLinks = new Set<string>();
    let pagesCrawled = 0;
    const startTime = Date.now();
    
    let rootPageTitle = "";
    let rootPageHtml = "";

    while (queue.length > 0) {
      if (pagesCrawled >= opts.maxPages) {
        console.log(`[Discover Service] Stop reason: maxPages (${opts.maxPages}) reached`);
        break;
      }
      if (Date.now() - startTime > opts.timeLimitMs) {
        console.log(`[Discover Service] Stop reason: timeLimitMs (${opts.timeLimitMs}) reached`);
        break;
      }
      
      const batch = queue.splice(0, opts.batchSize);
      const validBatch = batch.filter(q => !visited.has(q.url));
      
      if (validBatch.length === 0) continue;

      validBatch.forEach(q => visited.add(q.url));
      pagesCrawled += validBatch.length;

      const mainContentSelectors = [
        ".entry-content", ".post-content", "article", "main", "#content", ".content-area"
      ];

      await Promise.all(validBatch.map(async ({ url: currentUrl, depth }) => {
        console.log(`[Discover Service] Crawl page ${pagesCrawled} depth ${depth}: ${currentUrl}`);
        
        try {
          const htmlRes = await axios.get(currentUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
              "Accept-Language": "fr,en-US;q=0.7,en;q=0.3"
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
            timeout: currentUrl === rootNormalized ? 60000 : 12000,
            validateStatus: () => true
          });

          if (htmlRes.status >= 400 && htmlRes.status !== 404) {
            console.log(`[Discover Service] Request failed for ${currentUrl} with status ${htmlRes.status}`);
            return;
          }

          const pageHtml = typeof htmlRes.data === "string" ? htmlRes.data : "";
          const $ = load(pageHtml);
          const pageTitle = $("title").text().trim();
          
          if (currentUrl === rootNormalized) {
             rootPageTitle = pageTitle;
             rootPageHtml = pageHtml;
          }

          let foundPdfsOnPage = 0;
          let foundInMain = false;
          
          for (const selector of mainContentSelectors) {
             const $main = $(selector);
             if ($main.length > 0) {
               $main.find("a").each((_, el) => {
                 const href = $(el).attr("href");
                 if (!href) return;
                 try {
                   const absoluteStr = resolveRelativeUrl(href, currentUrl);
                   const cleanAbsoluteStr = normalizeUrlSafe(absoluteStr);
                   if (isDirectPdfUrl(cleanAbsoluteStr)) {
                     pagePdfLinks.add(cleanAbsoluteStr);
                     foundInMain = true;
                     foundPdfsOnPage++;
                   }
                 } catch {}
               });
             }
          }

          if (!foundInMain && foundPdfsOnPage === 0) {
            $("a").each((_, el) => {
               const isExcluded = $(el).parents("#sidebar, .sidebar, .widget, .social-share, footer, header, #secondary").length > 0;
               if (isExcluded) return;
               const href = $(el).attr("href");
               if (!href) return;
               try {
                 const absoluteStr = resolveRelativeUrl(href, currentUrl);
                 const cleanAbsoluteStr = normalizeUrlSafe(absoluteStr);
                 if (isDirectPdfUrl(cleanAbsoluteStr)) {
                   pagePdfLinks.add(cleanAbsoluteStr);
                   foundPdfsOnPage++;
                 }
               } catch {}
            });
          }

          if (foundPdfsOnPage === 0) {
            $("a").each((_, el) => {
               const href = $(el).attr("href");
               if (!href) return;
               try {
                 const absoluteStr = resolveRelativeUrl(href, currentUrl);
                 const cleanAbsoluteStr = normalizeUrlSafe(absoluteStr);
                 if (isDirectPdfUrl(cleanAbsoluteStr)) {
                   pagePdfLinks.add(cleanAbsoluteStr);
                   foundPdfsOnPage++;
                 }
               } catch {}
            });
            
            $("iframe, embed, object").each((_, el) => {
               const src = $(el).attr("src") || $(el).attr("data") || $(el).attr("href");
               if (!src) return;
               try {
                 const absoluteStr = resolveRelativeUrl(src, currentUrl);
                 const cleanAbsoluteStr = normalizeUrlSafe(absoluteStr);
                 if (isDirectPdfUrl(cleanAbsoluteStr)) {
                   pagePdfLinks.add(cleanAbsoluteStr);
                   foundPdfsOnPage++;
                 }
               } catch {}
            });
          }

          console.log(`[Discover Service] Found ${foundPdfsOnPage} PDFs on URL: ${currentUrl}`);

          if (depth < opts.maxDepth) {
            const paginationCandidates = new Set<string>();
            const deepCandidateLinks = new Set<string>();
            const origin = new URL(currentUrl).origin;
            
            $("a").each((_, el) => {
               const href = $(el).attr("href");
               if (!href) return;
               
               let absoluteStr = "";
               try {
                 absoluteStr = resolveRelativeUrl(href, currentUrl);
               } catch { return; }
               
               const cleanAbsoluteStr = normalizeUrlSafe(absoluteStr);
               
               if (
                 cleanAbsoluteStr.startsWith(origin) && 
                 !isAssetUrl(cleanAbsoluteStr) && 
                 !isDirectPdfUrl(cleanAbsoluteStr) &&
                 !visited.has(cleanAbsoluteStr)
               ) {
                  const isPagination = isPaginationLink($(el), href);
                  
                  if (isPagination) {
                    paginationCandidates.add(cleanAbsoluteStr);
                  } else {
                    if (foundPdfsOnPage === 0) {
                      const inMain = $(el).parents(mainContentSelectors.join(", ")).length > 0;
                      if (inMain) {
                        deepCandidateLinks.add(cleanAbsoluteStr);
                      }
                    }
                  }
               }
            });

            for (const link of paginationCandidates) {
              if (!queue.find(q => q.url === link)) {
                queue.unshift({ url: link, depth: depth });
                console.log(`[Discover Service] Enqueued next page (pagination): ${link}`);
              }
            }
            
            const candidateArray = Array.from(deepCandidateLinks).slice(0, 50);
            for (const link of candidateArray) {
              if (!queue.find(q => q.url === link)) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        } catch (err: any) {
           console.log(`[Discover Service] Crawl failed for ${currentUrl}: ${err.message}`);
        }
      }));
      
      if (queue.length === 0) {
        console.log(`[Discover Service] Stop reason: noMoreUrls`);
      } else {
        await new Promise(r => setTimeout(r, 600));
      }
    }

    const uniquePdfLinks = Array.from(pagePdfLinks);
    
    if (uniquePdfLinks.length > 0) {
      for (const pdfLink of uniquePdfLinks) {
        let meta: Record<string, any> = { grade: null, subject: null, track: null, documentType: null, schoolYear: null, source: null };
        try {
          meta = extractClassifyingMetadata(pdfLink, rootPageTitle + " " + rootPageHtml.substring(0, 5000));
        } catch {}
        
        const cleanTitle = formatLevelspaceReviewTitle(meta as any);

        results.push({
          url: pdfLink,
          raw_url: rawUrl,
          normalized_url: rootNormalized,
          source_page_url: rootNormalized,
          pdf_url: pdfLink,
          url_type: "source_page",
          pdf_count: uniquePdfLinks.length,
          isDirectPdf: true,
          accepted: true,
          reason: `Extracted from educational source page: ${rootNormalized}`,
          title: cleanTitle || pdfLink.split("/").pop() || rootPageTitle,
          cleanTitle: cleanTitle,
          metadata: meta as any
        });
      }
    } else {
      let meta: Record<string, any> = { grade: null, subject: null, track: null, documentType: null, schoolYear: null, source: null };
      try {
        meta = extractClassifyingMetadata(rootNormalized, rootPageTitle + " " + rootPageHtml.substring(0, 5000));
      } catch {}
      
      const cleanTitle = formatLevelspaceReviewTitle(meta as any);

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
        reason: "No educational PDFs discovered on page. Staged for manual review.",
        title: cleanTitle || rootPageTitle || rootNormalized,
        cleanTitle: cleanTitle,
        metadata: meta as any
      });
    }
  }

  return results;
}
