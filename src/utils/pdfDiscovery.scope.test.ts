import assert from "node:assert/strict";
import axios from "axios";
import { afterEach, test, vi } from "vitest";
import { discoverPdfsFromInput } from "./pdfDiscovery";

afterEach(() => {
  vi.restoreAllMocks();
});

test("keeps a Moutamadris crawl inside the seed subject", async () => {
  const root = "https://moutamadris.ma/education-islamique-1ac";
  const islamicLesson = "https://moutamadris.ma/sourate-q-1ac";
  const physicsCategory = "https://moutamadris.ma/physique-chimie-1ac";
  const islamicPdf = "https://moutamadris.ma/wp-content/uploads/sourate-q-1ac.pdf";
  const physicsPdf = "https://moutamadris.ma/wp-content/uploads/physique-1ac.pdf";

  const pages: Record<string, string> = {
    [root]: `
      <html>
        <head><title>Education Islamique 1AC</title></head>
        <body>
          <main>
            <a href="${islamicLesson}">Sourate Q 1AC</a>
            <a href="${physicsCategory}">Physique Chimie 1AC</a>
          </main>
        </body>
      </html>
    `,
    [islamicLesson]: `
      <html>
        <head><title>Sourate Q 1AC</title></head>
        <body><main><a href="${islamicPdf}">Cours Sourate Q</a></main></body>
      </html>
    `,
    [physicsCategory]: `
      <html>
        <head><title>Physique Chimie 1AC</title></head>
        <body><main><a href="${physicsPdf}">Cours de physique</a></main></body>
      </html>
    `,
  };

  const requestedUrls: string[] = [];
  vi.spyOn(axios, "get").mockImplementation(async (url) => {
    const requestedUrl = String(url);
    requestedUrls.push(requestedUrl);
    return {
      status: pages[requestedUrl] ? 200 : 404,
      data: pages[requestedUrl] || "",
    } as any;
  });

  const results = await discoverPdfsFromInput(root, undefined, {
    maxPages: 10,
    maxDepth: 2,
    maxPdfs: 20,
    batchSize: 1,
  });

  assert.deepEqual(results.map((item) => item.pdf_url), [islamicPdf]);
  assert.equal(results[0]?.metadata?.subject, "Education Islamique");
  assert.equal(requestedUrls.includes(physicsCategory), false);
});

test("caps discovery output before a runaway result can be produced", async () => {
  const root = "https://moutamadris.ma/education-islamique-1ac";
  const pdfLinks = Array.from(
    { length: 120 },
    (_, index) => `<a href="https://moutamadris.ma/wp-content/uploads/islamic-${index + 1}-1ac.pdf">PDF ${index + 1}</a>`,
  ).join("\n");

  vi.spyOn(axios, "get").mockResolvedValue({
    status: 200,
    data: `<html><head><title>Education Islamique 1AC</title></head><body><main>${pdfLinks}</main></body></html>`,
  } as any);

  const results = await discoverPdfsFromInput(root, undefined, {
    maxPages: 5,
    maxDepth: 1,
    maxPdfs: 100,
  });

  assert.equal(results.length, 100);
  assert.equal(results.every((item) => item.pdf_count === 100), true);
});
