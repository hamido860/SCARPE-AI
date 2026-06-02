import https from 'https';
import crypto from 'crypto';
import axios from "axios";
import { load } from "cheerio";

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
  metadata?: {
    grade: string | null;
    subject: string | null;
    track: string | null;
  };
}

/**
 * Splits concatenated URLs that might have been pasted together without separation
 * e.g., "https://site1.comhttps://site2.com/doc.pdf" -> ["https://site1.com", "https://site2.com/doc.pdf"]
 */
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

/**
 * Removes hash fragments and returns a clean URL
 */
export function removeHashFragment(urlStr: string): string {
  if (!urlStr) return "";
  return urlStr.split("#")[0];
}

/**
 * Validates with pathname suffix check weather a URL represents a direct PDF
 */
export function isDirectPdfUrl(urlStr: string): boolean {
  try {
    const cleanUrl = urlStr.split(/[?#]/)[0];
    const lowerUrl = cleanUrl.toLowerCase();
    return lowerUrl.endsWith(".pdf") || lowerUrl.includes("drive.google.com/file/d/");
  } catch {
    return urlStr.toLowerCase().includes(".pdf") || urlStr.toLowerCase().includes("drive.google.com/file/d/");
  }
}

/**
 * Resolves a redirect or relative URL cleanly
 */
export function resolveRelativeUrl(href: string, baseUrl: string): string {
  try {
    const resolved = new URL(href, baseUrl);
    return resolved.href;
  } catch {
    return href;
  }
}

/**
 * Helper to extract grade, subject and track from url/metadata context (Task 7)
 */
export function extractClassifyingMetadata(urlStr: string, textContext: string = ""): { grade: string | null; subject: string | null; track: string | null } {
  let grade: string | null = null;
  let subject: string | null = null;
  let track: string | null = null;

  let decodedUrl = urlStr;
  try {
    decodedUrl = decodeURIComponent(urlStr);
  } catch {}

  const combinedText = `${decodedUrl} ${textContext}`.toLowerCase();

  // Grade Detection
  if (combinedText.includes("3ac") || combinedText.includes("3eme") || combinedText.includes("3ème") || combinedText.includes("ثالثة اعدادي") || combinedText.includes("السنة الثالثة اعدادي")) {
    grade = "3AC";
  } else if (combinedText.includes("2ac") || combinedText.includes("ثانية اعدادي") || combinedText.includes("السنة الثانية اعدادي")) {
    grade = "2AC";
  } else if (combinedText.includes("1ac") || combinedText.includes("اولى اعدادي") || combinedText.includes("السنة الاولى اعدادي")) {
    grade = "1AC";
  } else if (combinedText.includes("tronc commun") || combinedText.includes("جذع مشترك")) {
    grade = "Tronc Commun";
  } else if (combinedText.includes("2bac") || combinedText.includes("ثانية باك") || combinedText.includes("البكالوريا")) {
    grade = "2BAC";
  } else if (combinedText.includes("1bac") || combinedText.includes("اولى باك") || combinedText.includes("الأولى بكالوريا")) {
    grade = "1BAC";
  }

  // Subject Detection
  if (combinedText.includes("math") || combinedText.includes("رياضيات") || combinedText.includes("الرياضيات")) {
    subject = "Mathématiques";
  } else if (combinedText.includes("physique") || combinedText.includes("chimie") || combinedText.includes("الفيزياء")) {
    subject = "Physique-Chimie";
  } else if (combinedText.includes("svt") || combinedText.includes("sciences de la vie") || combinedText.includes("الارض") || combinedText.includes("الأرض")) {
    subject = "SVT";
  } else if (combinedText.includes("francais") || combinedText.includes("français") || combinedText.includes("الفرنسية")) {
    subject = "Français";
  } else if (combinedText.includes("arabe") || combinedText.includes("العربية")) {
    subject = "Arabe";
  } else if (combinedText.includes("anglais") || combinedText.includes("الانجليزية") || combinedText.includes("الإنجليزية")) {
    subject = "Anglais";
  }

  // Track Detection
  if (combinedText.includes("biof") || combinedText.includes("خيار فرنسي") || combinedText.includes("option francais") || combinedText.includes("option français")) {
    track = "BIOF (Option Français)";
  } else if (combinedText.includes("خيار عربي") || combinedText.includes("option arabe")) {
    track = "Option Arabe";
  } else if (combinedText.includes("science") || combinedText.includes("علوم") || combinedText.includes("العلوم")) {
    track = "Sciences";
  } else if (combinedText.includes("lettres") || combinedText.includes("اداب") || combinedText.includes("الآداب")) {
    track = "Lettres";
  }

  return { grade, subject, track };
}

/**
 * Main PDF Discovery entry point
 */
export async function discoverPdfsFromInput(
  pastedText: string,
  topicFilter?: string
): Promise<DiscoveredItem[]> {
  const rawUrls = splitConcatenatedUrls(pastedText);
  const results: DiscoveredItem[] = [];

  for (const rawUrl of rawUrls) {
    const normalizedUrl = removeHashFragment(rawUrl);
    
    if (isDirectPdfUrl(normalizedUrl)) {
      // 1. Direct PDF asset case
      const meta = extractClassifyingMetadata(normalizedUrl);
      results.push({
        url: normalizedUrl,
        raw_url: rawUrl,
        normalized_url: normalizedUrl,
        source_page_url: normalizedUrl,
        pdf_url: normalizedUrl,
        url_type: "direct_pdf",
        pdf_count: 1,
        isDirectPdf: true,
        accepted: true,
        reason: "Direct PDF document link detected",
        title: normalizedUrl.split("/").pop() || "Direct PDF",
        metadata: meta
      });
    } else {
      // 2. HTML source page case
      try {
        console.log(`[Discover Service] Fetching source HTML page: ${normalizedUrl}`);
        const htmlRes = await axios.get(normalizedUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "fr,en-US;q=0.7,en;q=0.3"
          },
          httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
          timeout: 60000,
          validateStatus: () => true
        });

        if (htmlRes.status >= 400 && htmlRes.status !== 404) {
          throw new Error(`Request failed with status code ${htmlRes.status}`);
        }

        const pageHtml = typeof htmlRes.data === "string" ? htmlRes.data : "";
        const $ = load(pageHtml);
        const pageTitle = $("title").text().trim();
        
        const pagePdfLinks: string[] = [];

        // 1. First try to find PDFs exclusively within primary content areas 
        // to avoid grabbing social links or standard sidebar navigation PDFs.
        const mainContentSelectors = [
          ".entry-content",
          ".post-content",
          "article",
          "main",
          "#content", 
          ".content-area"
        ];
        
        let foundInMain = false;
        
        for (const selector of mainContentSelectors) {
          const $main = $(selector);
          if ($main.length > 0) {
            $main.find("a").each((_, el) => {
              const href = $(el).attr("href");
              if (!href) return;
              try {
                const absoluteStr = resolveRelativeUrl(href, normalizedUrl);
                const cleanAbsoluteStr = removeHashFragment(absoluteStr);
                if (isDirectPdfUrl(cleanAbsoluteStr)) {
                  pagePdfLinks.push(cleanAbsoluteStr);
                  foundInMain = true;
                }
              } catch {}
            });
          }
        }
        
        // 2. If nothing is found in typical main containers, fallback to whole page scan 
        // BUT explicitly avoid common negative (red) areas: sidebar, widgets, etc.
        if (!foundInMain && pagePdfLinks.length === 0) {
          $("a").each((_, el) => {
            // Check if element is inside an excluded area
            const isExcluded = $(el).parents("#sidebar, .sidebar, .widget, .social-share, footer, header, #secondary").length > 0;
            if (isExcluded) return;
            
            const href = $(el).attr("href");
            if (!href) return;
            try {
              const absoluteStr = resolveRelativeUrl(href, normalizedUrl);
              const cleanAbsoluteStr = removeHashFragment(absoluteStr);
              if (isDirectPdfUrl(cleanAbsoluteStr)) {
                pagePdfLinks.push(cleanAbsoluteStr);
              }
            } catch {}
          });
        }
        
        // 3. Absolute Fallback: if STILL nothing, just grab any a tag (sometimes the DOM is non-semantic)
        if (pagePdfLinks.length === 0) {
          $("a").each((_, el) => {
            const href = $(el).attr("href");
            if (!href) return;
            try {
              const absoluteStr = resolveRelativeUrl(href, normalizedUrl);
              const cleanAbsoluteStr = removeHashFragment(absoluteStr);
              if (isDirectPdfUrl(cleanAbsoluteStr)) {
                pagePdfLinks.push(cleanAbsoluteStr);
              }
            } catch {}
          });
        }

        // 3.5 Check iframes and embeds (Moutamadris often uses drive iframes to show PDFs)
        if (pagePdfLinks.length === 0) {
          $("iframe, embed, object").each((_, el) => {
            const src = $(el).attr("src") || $(el).attr("data") || $(el).attr("href");
            if (!src) return;
            try {
              const absoluteStr = resolveRelativeUrl(src, normalizedUrl);
              const cleanAbsoluteStr = removeHashFragment(absoluteStr);
              if (isDirectPdfUrl(cleanAbsoluteStr)) {
                pagePdfLinks.push(cleanAbsoluteStr);
              }
            } catch {}
          });
        }

        // 4. One-Level Deep Crawl Strategy for Category Pages (e.g. Moutamadris.ma)
        // If the URL is a category page that points to lessons (which in turn contain PDFs),
        // we'll fetch the lesson links to discover actual PDFs.
        if (pagePdfLinks.length === 0) {
          let candidateDeepLinks: string[] = [];
          
          for (const selector of mainContentSelectors) {
             const $main = $(selector);
             if ($main.length > 0) {
               $main.find("a").each((_, el) => {
                  const href = $(el).attr("href");
                  if (!href) return;
                  try {
                    const absoluteStr = resolveRelativeUrl(href, normalizedUrl);
                    const cleanAbsoluteStr = removeHashFragment(absoluteStr);
                    // Only crawl links on the same origin that don't look like utility pages
                    if (cleanAbsoluteStr.startsWith(new URL(normalizedUrl).origin) && !cleanAbsoluteStr.endsWith(".jpg") && !cleanAbsoluteStr.endsWith(".png")) {
                       candidateDeepLinks.push(cleanAbsoluteStr);
                    }
                  } catch {}
               });
               if (candidateDeepLinks.length > 0) break; // found links in the primary content area
             }
          }

          candidateDeepLinks = Array.from(new Set(candidateDeepLinks)).filter(u => u !== normalizedUrl).slice(0, 15);
          
          if (candidateDeepLinks.length > 0) {
             console.log(`[Discover Service] Deep crawling ${candidateDeepLinks.length} sub-pages for PDFs...`);
             const BATCH_SIZE = 5;
             const startTime = Date.now();
             for (let i = 0; i < candidateDeepLinks.length; i += BATCH_SIZE) {
                if (Date.now() - startTime > 30000) {
                  console.log(`[Discover Service] Deep crawl time limit of 30s elapsed. Halting deeper scan.`);
                  break;
                }
               const batchUrls = candidateDeepLinks.slice(i, i + BATCH_SIZE);
               await Promise.all(batchUrls.map(async (deepUrl) => {
                 try {
                    const deepRes = await axios.get(deepUrl, {
                      headers: { 
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
                      },
                      httpsAgent: new https.Agent({ rejectUnauthorized: false, secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }),
                      timeout: 12000,
                      validateStatus: () => true
                    });
                    
                    if (deepRes.status === 200 && typeof deepRes.data === "string") {
                       const $d = load(deepRes.data);
                       $d("a").each((_, el) => {
                          const href = $d(el).attr("href");
                          if (!href) return;
                          try {
                            const absoluteStr = resolveRelativeUrl(href, deepUrl);
                            const cleanAbsoluteStr = removeHashFragment(absoluteStr);
                            if (isDirectPdfUrl(cleanAbsoluteStr)) {
                               pagePdfLinks.push(cleanAbsoluteStr);
                            }
                          } catch {}
                       });
                    }
                 } catch (e: any) { 
                    console.log(`[Discover Service] Deep crawl failed for ${deepUrl}: ${e.message}`);
                 }
               }));
               // slight delay between batches to avoid 429
               await new Promise(r => setTimeout(r, 600));
             }
          }
        }

        const uniquePdfLinks = Array.from(new Set(pagePdfLinks));
        
        // If we found PDFs either directly or via deep crawl
        if (uniquePdfLinks.length > 0) {
          // Found direct PDFs on this page
          for (const pdfLink of uniquePdfLinks) {
            const meta = extractClassifyingMetadata(pdfLink, pageTitle + " " + pageHtml.substring(0, 5000));
            results.push({
              url: pdfLink,
              raw_url: rawUrl,
              normalized_url: normalizedUrl,
              source_page_url: normalizedUrl,
              pdf_url: pdfLink,
              url_type: "source_page",
              pdf_count: uniquePdfLinks.length,
              isDirectPdf: true,
              accepted: true,
              reason: `Extracted from educational source page: ${normalizedUrl}`,
              title: pdfLink.split("/").pop() || pageTitle,
              metadata: meta
            });
          }
        } else {
          // No PDFs found at all
          const meta = extractClassifyingMetadata(normalizedUrl, pageTitle + " " + pageHtml.substring(0, 5000));
          results.push({
            url: normalizedUrl,
            raw_url: rawUrl,
            normalized_url: normalizedUrl,
            source_page_url: normalizedUrl,
            pdf_url: normalizedUrl,
            url_type: "source_page_no_pdfs",
            pdf_count: 0,
            isDirectPdf: false,
            accepted: true,
            reason: "No educational PDFs discovered on page. Staged for manual review.",
            title: pageTitle || normalizedUrl,
            metadata: meta
          });
        }
      } catch (err: any) {
        console.error(`[Discover Service] Failed to crawl URL: ${normalizedUrl}`, err.message);
        results.push({
          url: normalizedUrl,
          raw_url: rawUrl,
          normalized_url: normalizedUrl,
          source_page_url: normalizedUrl,
          pdf_url: normalizedUrl,
          url_type: "source_page_no_pdfs",
          pdf_count: 0,
          isDirectPdf: false,
          accepted: false,
          reason: `Error during discovery: ${err.message}`
        });
      }
    }
  }

  return results;
}
