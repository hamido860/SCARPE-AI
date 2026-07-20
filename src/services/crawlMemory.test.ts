import { describe, expect, it } from "vitest";
import {
  canonicalizeCrawlerUrl,
  isFreshCompletedCrawl,
  type CrawlUrlRecord,
} from "./crawlMemory";

function record(lastCrawledAt: string): CrawlUrlRecord {
  return {
    canonicalUrl: "https://moutamadris.ma/page",
    originalUrl: "https://www.moutamadris.ma/page/?utm_source=test#files",
    domain: "moutamadris.ma",
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

  it("skips a completed crawl only while it is fresh", () => {
    const now = new Date("2026-07-20T12:00:00Z").getTime();
    expect(isFreshCompletedCrawl(record("2026-07-19T12:00:00Z"), 30, now)).toBe(true);
    expect(isFreshCompletedCrawl(record("2026-05-01T12:00:00Z"), 30, now)).toBe(false);
  });
});
