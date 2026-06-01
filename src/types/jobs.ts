export type JobView = "intake" | "processing" | "indexing" | "review" | "output" | "reports" | "settings";

export interface BatchJob {
  id: string; // uuid
  name: string;
  scope: {
    gradeId?: string | null;
    subjectId?: string | null;
    topicId?: string | null;
    documentTypeId?: string | null;
    status?: string | null;
  };
  totalItems: number;
  pending: number;
  running: number;
  completed: number;
  blocked: number;
  failed: number;
  skipped: number;
  status: "queued" | "running" | "paused" | "completed" | "completed_with_blocks" | "failed";
  createdAt: string;
  updatedAt: string;
  processedItems?: number;
}

export interface BatchJobItem {
  id?: string;
  url: string;
  pdfUrl?: string;
  hash?: string;
  filename: string;
  originalName?: string;
  status: "queued" | "running" | "classified" | "clean_copy_done" | "blocked" | "failed" | "skipped" | "completed";
  currentStep: "download" | "extract" | "ocr" | "classify" | "clean_copy" | "dataset" | "done" | string;
  blockReason?: string | null;
  blockedReason?: string | null;
  confidenceScore?: number;
  requiresUserAction?: boolean;
  stepProgress?: {
    downloaded: boolean;
    ocrDone: boolean;
    classified: boolean;
    cleanBuilt: boolean;
  };
}

export interface BlockedItemDetails {
  blockReason: string;
  explanation: string;
  suggestedActions: string[];
  candidateGrades?: Array<{ id: string, nameAr: string, nameFr: string }>;
  candidateSubjects?: Array<{ id: string, nameAr: string, nameFr: string }>;
  candidateTopics?: Array<{ id: string, nameAr: string, nameFr: string }>;
  candidateDocumentTypes?: Array<{ id: string, nameAr: string, nameFr: string }>;
  confidenceScore?: number;
  matchedTerms?: string[];
  sourcePreview?: string;
  textPreview?: string;
}
