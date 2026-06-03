import {
  discoverPdfsFromInput,
  normalizeUrlSafe,
  isPaginationLink
} from "../src/utils/pdfDiscovery";
import { load } from "cheerio";
// Mock axios
import axios from "axios";

// Setup basic jest functions if ran natively via tsx for manual testing
const mockHtmlPages: Record<string, string> = {
  "https://example.com/category": `
    <html>
      <body>
        <main>
           <a href="https://example.com/category/doc1.pdf">Doc 1</a>
           <a href="https://example.com/category?page=2">Next</a>
        </main>
      </body>
    </html>
  `,
  "https://example.com/category?page=2": `
    <html>
      <body>
        <main>
           <a href="https://example.com/category/doc2.pdf">Doc 2</a>
           <a href="https://example.com/category?page=3">Next</a>
        </main>
      </body>
    </html>
  `,
  "https://example.com/category?page=3": `
    <html>
      <body>
        <main>
           <a href="https://example.com/category/doc3.pdf">Doc 3</a>
           <a href="https://example.com/category?page=4" rel="next">Page 4</a>
           <a href="https://example.com/category?page=2">Prev</a>
        </main>
      </body>
    </html>
  `,
  "https://example.com/category?page=4": `
    <html>
      <body>
        <main>
           <a href="https://example.com/category/doc4.pdf">Doc 4</a>
           <!-- End of pagination -->
           <!-- Test loop with duplicate link -->
           <a href="https://example.com/category?page=4" rel="next">Next</a>
        </main>
      </body>
    </html>
  `
};

export async function runManualTests() {
  console.log("Mocking axios to serve local mock HTML");
  (axios.get as any) = async (url: string) => {
    if (mockHtmlPages[url]) {
      return { status: 200, data: mockHtmlPages[url] };
    }
    return { status: 404, data: "" };
  };

  console.log("\\n--- TEST 1: Normalizer ---");
  const norm1 = normalizeUrlSafe("https://example.com/category?page=2#top");
  if (norm1 === "https://example.com/category?page=2") {
    console.log("✅ Query parameters preserved and hash removed");
  } else {
    console.error("❌ Normalizer failed:", norm1);
  }

  const norm2 = normalizeUrlSafe("https://example.com/path/");
  if (norm2 === "https://example.com/path") {
    console.log("✅ Trailing slash removed");
  } else {
    console.error("❌ Normalizer trailing slash failed:", norm2);
  }

  console.log("\\n--- TEST 2: Pagination Detection ---");
  const $page = load('<a href="?page=2">Suivante</a>');
  if (isPaginationLink($page("a"), "?page=2")) {
    console.log("✅ Pagination anchor text matched");
  } else {
    console.error("❌ Pagination anchor text failed");
  }

  console.log("\\n--- TEST 3: Crawl Category Page 1 -> 4 ---");
  const results = await discoverPdfsFromInput("https://example.com/category", undefined, { maxPages: 10, batchSize: 2 });
  
  const foundPdfs = results.map(r => r.pdf_url);
  console.log("Found PDFs:", foundPdfs);

  if (foundPdfs.includes("https://example.com/category/doc1.pdf") &&
      foundPdfs.includes("https://example.com/category/doc2.pdf") &&
      foundPdfs.includes("https://example.com/category/doc3.pdf") &&
      foundPdfs.includes("https://example.com/category/doc4.pdf")) {
    console.log("✅ Successfully crawled through page 1, 2, 3, 4");
  } else {
    console.error("❌ Failed to reach all pages");
  }

  if (foundPdfs.length === 4) {
    console.log("✅ No duplicate loops (page 4 looping to 4 ignored)");
  } else {
    console.error("❌ Found duplicate entries or missed some");
  }

  console.log("\\n--- TEST 4: Max Pages Limit ---");
  const limitedResults = await discoverPdfsFromInput("https://example.com/category", undefined, { maxPages: 2, batchSize: 1 });
  const limitedPdfs = limitedResults.map(r => r.pdf_url);
  console.log("Limited PDFs found:", limitedPdfs.length);
  if (limitedPdfs.length < 4 && limitedPdfs.length > 0) {
    console.log("✅ Max pages limit respected");
  } else {
    console.error("❌ Max pages limit failed");
  }
}

import { test } from "vitest";

test("pdf discovery tests", async () => {
  await runManualTests();
});
