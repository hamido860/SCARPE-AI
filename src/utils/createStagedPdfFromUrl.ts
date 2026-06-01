import { StagedPdf } from "../types/pdf";

export function createStagedPdfFromUrl(url: string): StagedPdf {
  let originalName = url.split("/").pop() || "scraped_document.pdf";
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
