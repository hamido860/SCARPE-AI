export interface LevelspaceMetadata {
  grade_id: string | null;
  grade_name: string | null;
  subject_id: string | null;
  subject_name: string | null;
  module_id: string | null;
  module_name: string | null;
  topic_id: string | null;
  topic_name: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  skill_ids: string[];
  objective_ids: string[];
  curriculum_path: string | null;
  curriculum_confidence: number;
  index_status: "indexed" | "needs_review" | "blocked" | "rejected";
  index_reason: string | null;
  document_role: string | null;
  student_visible: boolean;
  teacher_visible: boolean;
  admin_visible: boolean;
  ai_visible: boolean;
  candidate_lessons?: string[];
  suggested_action?: string | null;
}

export interface StagedPdf {
  url: string;
  originalName: string;
  status: "pending" | "classifying" | "classified" | "rejected" | "failed" | "needs_review" | "staged" | "pending_staged" | "exact_duplicate" | "content_duplicate" | "same_ref_only" | "invalid_download" | "placeholder_download";
  assetType?: "pdf" | "html_lesson" | "unknown";
  
  levelspace?: LevelspaceMetadata;
  
  hash?: string;
  raw_file_hash?: string;
  text_content_hash?: string;
  extractionStatus?: "pending" | "text_extracted" | "needs_ocr" | "ocr_done" | "extract_failed";
  ocrStatus?: "not_needed" | "needed" | "queued" | "running" | "done" | "failed";
  pdfTextType?: string;
  textQualityScore?: number;
  textLength?: number;

  pipelineStep?: string;
  blockReason?: string;

  gradeId: string | null;
  subjectId: string | null;
  topicId: string | null;
  documentTypeId: string | null;
  cleanTitle: string | null;
  renamePattern: string | null;
  reason: string | null;
  rawText: string | null;
  isMatch: boolean;

  confidenceScore?: number;
  matchedTerms?: string[];
  matchedFields?: string[];

  cleanCopyStatus?: "pending" | "building" | "success" | "failed";
  datasetRowStatus?: "pending" | "saving" | "success" | "failed";
  cleanFilename?: string;
  datasetId?: string;
}
