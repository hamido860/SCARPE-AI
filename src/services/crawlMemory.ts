import axios from "axios";
import {
  LOCAL_MEMORY_STORES,
  clearLocalStore,
  getAllLocalRecords,
  getLocalRecord,
  putLocalRecord,
} from "./localMemoryDb";

export type CrawlMemoryStatus = "crawling" | "completed" | "no_pdf" | "failed";
export type CrawlMode = "new_only" | "retry_failed" | "force_recrawl";

export interface CrawlUrlRecord {
  canonicalUrl: string;
  originalUrl: string;
  domain: string;
  status: CrawlMemoryStatus;
  firstSeenAt: string;
  lastCrawledAt: string | null;
  nextRetryAt: string | null;
  pdfUrls: string[];
  pdfCount: number;
  httpStatus: number | null;
  errorMessage: string | null;
  updatedAt: string;
}

const DEFAULT_FRESH_DAYS = 30;
const FAILED_RETRY_HOURS = 6;
const TRACKING_PARAMETERS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
];

export function canonicalizeCrawlerUrl(input: string): string {
  const url = new URL(input.trim());
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  for (const parameter of TRACKING_PARAMETERS) {
    url.searchParams.delete(parameter);
  }
  url.searchParams.sort();

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

export async function getCrawlMemory(url: string): Promise<CrawlUrlRecord | null> {
  return getLocalRecord<CrawlUrlRecord>(
    LOCAL_MEMORY_STORES.crawlUrls,
    canonicalizeCrawlerUrl(url),
  );
}

export async function listCrawlMemory(): Promise<CrawlUrlRecord[]> {
  return getAllLocalRecords<CrawlUrlRecord>(LOCAL_MEMORY_STORES.crawlUrls);
}

export async function clearCrawlMemory(): Promise<void> {
  await clearLocalStore(LOCAL_MEMORY_STORES.crawlUrls);
}

export function isFreshCompletedCrawl(
  record: CrawlUrlRecord | null,
  freshDays = DEFAULT_FRESH_DAYS,
  now = Date.now(),
): boolean {
  if (!record || !["completed", "no_pdf"].includes(record.status) || !record.lastCrawledAt) {
    return false;
  }
  return now - new Date(record.lastCrawledAt).getTime() < freshDays * 24 * 60 * 60 * 1000;
}

async function saveCrawlState(
  url: string,
  patch: Partial<CrawlUrlRecord>,
): Promise<CrawlUrlRecord> {
  const canonicalUrl = canonicalizeCrawlerUrl(url);
  const existing = await getLocalRecord<CrawlUrlRecord>(LOCAL_MEMORY_STORES.crawlUrls, canonicalUrl);
  const now = new Date().toISOString();
  const record: CrawlUrlRecord = {
    originalUrl: existing?.originalUrl || url,
    domain: new URL(canonicalUrl).hostname,
    status: existing?.status || "crawling",
    firstSeenAt: existing?.firstSeenAt || now,
    lastCrawledAt: existing?.lastCrawledAt || null,
    nextRetryAt: existing?.nextRetryAt || null,
    pdfUrls: existing?.pdfUrls || [],
    pdfCount: existing?.pdfCount || 0,
    httpStatus: existing?.httpStatus || null,
    errorMessage: existing?.errorMessage || null,
    ...patch,
    canonicalUrl,
    updatedAt: now,
  };
  await putLocalRecord(LOCAL_MEMORY_STORES.crawlUrls, record);
  return record;
}

function parseBody(data: unknown): Record<string, any> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data && typeof data === "object" ? { ...(data as Record<string, any>) } : {};
}

function uniqueUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0)));
}

export function installCrawlerMemoryInterceptor(): void {
  const globalMarker = globalThis as typeof globalThis & {
    __scarpeCrawlerMemoryInstalled?: boolean;
  };
  if (globalMarker.__scarpeCrawlerMemoryInstalled) return;
  globalMarker.__scarpeCrawlerMemoryInstalled = true;

  axios.interceptors.request.use(async (config: any) => {
    const endpoint = String(config.url || "");
    const method = String(config.method || "get").toLowerCase();
    if (method !== "post" || !endpoint.includes("/api/crawl-pdfs")) return config;

    const body = parseBody(config.data);
    if (!body.url) return config;

    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeCrawlerUrl(String(body.url));
    } catch {
      return config;
    }

    const crawlMode: CrawlMode = body.crawlMode || "new_only";
    const metadata = {
      canonicalUrl,
      originalUrl: String(body.url),
      crawlMode,
      memoryHit: false,
    };
    config.__scarpeCrawlMemory = metadata;

    try {
      const existing = await getLocalRecord<CrawlUrlRecord>(
        LOCAL_MEMORY_STORES.crawlUrls,
        canonicalUrl,
      );

      if (crawlMode === "new_only" && isFreshCompletedCrawl(existing)) {
        metadata.memoryHit = true;
        config.adapter = async (adapterConfig: any) => ({
          data: {
            crawled: 0,
            pdfs: existing?.pdfUrls || [],
            skippedPreviouslyCrawled: 1,
            fromLocalMemory: true,
            memoryRecord: existing,
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: adapterConfig,
          request: undefined,
        });
        return config;
      }

      await saveCrawlState(canonicalUrl, {
        originalUrl: String(body.url),
        status: "crawling",
        errorMessage: null,
        nextRetryAt: null,
      });
    } catch (error) {
      console.warn("[CrawlMemory] Unable to read local crawl index:", error);
    }

    const nextBody = { ...body, url: canonicalUrl, crawlMode };
    config.data = typeof config.data === "string" ? JSON.stringify(nextBody) : nextBody;
    return config;
  });

  axios.interceptors.response.use(
    async (response: any) => {
      const metadata = response.config?.__scarpeCrawlMemory;
      if (!metadata || metadata.memoryHit) return response;

      const pdfUrls = uniqueUrls(response.data?.pdfs);
      try {
        await saveCrawlState(metadata.canonicalUrl, {
          status: pdfUrls.length > 0 ? "completed" : "no_pdf",
          lastCrawledAt: new Date().toISOString(),
          pdfUrls,
          pdfCount: pdfUrls.length,
          httpStatus: Number(response.status || 200),
          errorMessage: null,
          nextRetryAt: null,
        });
      } catch (error) {
        console.warn("[CrawlMemory] Unable to save completed crawl:", error);
      }
      return response;
    },
    async (error: any) => {
      const metadata = error.config?.__scarpeCrawlMemory;
      if (metadata && !metadata.memoryHit) {
        const nextRetryAt = new Date(Date.now() + FAILED_RETRY_HOURS * 60 * 60 * 1000).toISOString();
        try {
          await saveCrawlState(metadata.canonicalUrl, {
            status: "failed",
            lastCrawledAt: new Date().toISOString(),
            nextRetryAt,
            httpStatus: Number(error.response?.status || 0) || null,
            errorMessage: String(error.message || "Crawler request failed"),
          });
        } catch (memoryError) {
          console.warn("[CrawlMemory] Unable to save failed crawl:", memoryError);
        }
      }
      return Promise.reject(error);
    },
  );
}
