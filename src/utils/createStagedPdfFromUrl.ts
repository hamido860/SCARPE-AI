import { StagedPdf } from "../types/pdf";
import { extractClassifyingMetadata } from "./pdfDiscovery";
import { formatLevelspaceReviewTitle, formatLevelspaceSafeFilename } from "./filenameGenerator";

export function createStagedPdfFromUrl(urlOrParams: string | { url: string; sourceTitle?: string; sourceName?: string; sourceType?: string }): StagedPdf {
  const url = typeof urlOrParams === "string" ? urlOrParams : urlOrParams.url;
  const sourceTitle = typeof urlOrParams === "object" ? urlOrParams.sourceTitle : undefined;
  
  const segments = url.split(/[?#]/)[0].split("/").filter(Boolean);
  let originalName = typeof urlOrParams === "object" && urlOrParams.sourceName ? urlOrParams.sourceName : (segments.length > 0 ? segments[segments.length - 1] : "scraped_document.pdf");
  
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

  let meta: any = { grade: null, subject: null, track: null, documentType: null, schoolYear: null, region: null, source: null };
  try {
    // Pass sourceTitle first if present, to prioritize it
    const textContext = sourceTitle ? `${sourceTitle} ${originalName}` : originalName;
    meta = extractClassifyingMetadata(url, textContext);
    if (typeof urlOrParams === "object" && urlOrParams.sourceType === "Google Drive") {
      meta.source = "Google Drive";
    }
  } catch {}

  const cleanTitle = formatLevelspaceReviewTitle(meta);
  const renamePattern = formatLevelspaceSafeFilename(meta);


  return {
    url,
    originalName,
    status: "pending" as const,
    assetType,
    gradeId: null,
    subjectId: null,
    topicId: null,
    documentTypeId: null,
    cleanTitle: cleanTitle || null,
    renamePattern: renamePattern || null,
    reason: null,
    rawText: null,
    isMatch: false,
    extractionStatus: "pending",
    ocrStatus: "not_needed" as const,
    cleanCopyStatus: "pending" as const,
    datasetRowStatus: "pending" as const
  };
}
