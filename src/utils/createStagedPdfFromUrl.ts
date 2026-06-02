import { StagedPdf } from "../types/pdf";

export function createStagedPdfFromUrl(url: string): StagedPdf {
  const segments = url.split(/[?#]/)[0].split("/").filter(Boolean);
  let originalName = segments.length > 0 ? segments[segments.length - 1] : "scraped_document.pdf";
  if (!originalName.toLowerCase().endsWith(".pdf") && !originalName.toLowerCase().endsWith(".html")) {
    originalName += url.toLowerCase().split(/[?#]/)[0].endsWith(".pdf") ? ".pdf" : "";
  }
  try {
    originalName = decodeURIComponent(originalName);
  } catch {}

  // Clean raw filename from query strings or anchors
  if (originalName.includes("?")) {
    originalName = originalName.split("?")[0];
  }
  if (originalName.includes("#")) {
    originalName = originalName.split("#")[0];
  }

  const isPdf = url.toLowerCase().split(/[?#]/)[0].endsWith(".pdf");
  const assetType = isPdf ? ("pdf" as const) : ("html_lesson" as const);

  return {
    url,
    originalName,
    status: "pending" as const,
    assetType,
    gradeId: null,
    subjectId: null,
    topicId: null,
    documentTypeId: null,
    cleanTitle: null,
    renamePattern: null,
    reason: null,
    rawText: null,
    isMatch: false,
    extractionStatus: "pending",
    ocrStatus: "not_needed" as const,
    cleanCopyStatus: "pending" as const,
    datasetRowStatus: "pending" as const
  };
}
