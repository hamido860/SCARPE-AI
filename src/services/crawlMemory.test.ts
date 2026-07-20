import { describe, expect, it } from "vitest";
import {
  buildCrawlRequestFingerprint,
  canonicalizeCrawlerUrl,
  isFreshCompletedCrawl,
  type CrawlUrlRecord,
} from "./crawlMemory";

function record(lastCrawledAt: string, requestFingerprint = "scope-a"): CrawlUrlRecord {
  return {
    canonicalUrl: "https://moutamadris.ma/page",
    originalUrl: "https://www.moutamadris.ma/page/?utm_source=test#files",
    domain: "moutamadris.ma",
    requestFingerprint,
    status: "completed",
    firstSeenAt: lastCrawledAt,
    lastCrawledAt,
    nextRetryAt: null,
    pdfUrls: ["https://moutamadris.ma/file.pdf"],
    pdfCount: 1,
    httpStatus: 200,
    errorMessage: null,
    updatedAt: lastCrawledAt,
  };
}

describe("crawler local memory", () => {
  it("maps tracking, www, fragment, and trailing slash variants to one key", () => {
    expect(canonicalizeCrawlerUrl("https://www.moutamadris.ma/page/?utm_source=test#files"))
      .toBe("https://moutamadris.ma/page");
    expect(canonicalizeCrawlerUrl("https://moutamadris.ma/page"))
      .toBe("https://moutamadris.ma/page");
  });

  it("preserves meaningful query parameters in sorted order", () => {
    expect(canonicalizeCrawlerUrl("https://example.com/list?b=2&a=1&utm_campaign=x"))
      .toBe("https://example.com/list?a=1&b=2");
  });

  it("skips a completed crawl only while it is fresh and the request target matches", () => {
    const now = new Date("2026-07-20T12:00:00Z").getTime();
    expect(isFreshCompletedCrawl(record("2026-07-19T12:00:00Z"), 30, now, "scope-a")).toBe(true);
    expect(isFreshCompletedCrawl(record("2026-07-19T12:00:00Z"), 30, now, "scope-b")).toBe(false);
    expect(isFreshCompletedCrawl(record("2026-05-01T12:00:00Z"), 30, now, "scope-a")).toBe(false);
  });

  it("changes the scope when topic or crawl depth changes", () => {
    const first = buildCrawlRequestFingerprint({ topicFilter: "Fractions", maxPages: 50, maxDepth: 3 });
    const normalized = buildCrawlRequestFingerprint({ topicFilter: "  fractions ", maxPages: 50, maxDepth: 3 });
    const deeper = buildCrawlRequestFingerprint({ topicFilter: "fractions", maxPages: 50, maxDepth: 5 });
    expect(first).toBe(normalized);
    expect(first).not.toBe(deeper);
  });
});
