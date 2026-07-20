export type ScraiAction =
  | "locate_source"
  | "create_markdown"
  | "create_chunks"
  | "generate_lesson"
  | "save_admin_draft"
  | "wait_for_review"
  | "completed";

export type ScraiReviewStatus = "not_started" | "needs_review" | "approved" | "published";

export interface ScraiLessonIdentity {
  lessonId?: string | null;
  topicId?: string | null;
  taskId?: string | null;
  grade: string;
  subject: string;
  lessonTitle: string;
}

export interface ScraiLessonMemory {
  lessonKey: string;
  taskId: string | null;
  lessonId: string | null;
  topicId: string | null;
  grade: string;
  subject: string;
  lessonTitle: string;
  markdown: {
    path: string | null;
    exists: boolean;
    contentHash: string | null;
    lastVerifiedAt: string | null;
  };
  chunks: {
    available: boolean;
    trustedCount: number;
    chunkIds: string[];
    fingerprint: string | null;
    sourceMarkdownHash: string | null;
    lastVerifiedAt: string | null;
  };
  generatedDraft: {
    available: boolean;
    contentHash: string | null;
    lessonId: string | null;
    taskId: string | null;
    evidenceFingerprint: string | null;
    savedAt: string | null;
  };
  review: { status: ScraiReviewStatus };
  lastAction: ScraiAction | null;
  updatedAt: string;
}

export interface ScraiPlan {
  nextAction: ScraiAction;
  visibleActions: ScraiAction[];
  skippedActions: Array<{ action: ScraiAction; reason: string }>;
}

export function normalizeMemoryText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildLessonKey(identity: ScraiLessonIdentity): string {
  if (identity.lessonId) return `lesson:${identity.lessonId}`;
  if (identity.topicId) return `topic:${identity.topicId}`;
  return ["fallback", identity.grade, identity.subject, identity.lessonTitle]
    .map(normalizeMemoryText)
    .join(":");
}

export function buildEvidenceFingerprint(input: {
  markdownHash: string | null;
  chunkIds: string[];
}): string {
  return [input.markdownHash || "no-markdown", ...Array.from(new Set(input.chunkIds)).sort()].join("|");
}

export function createEmptyScraiMemory(identity: ScraiLessonIdentity): ScraiLessonMemory {
  return {
    lessonKey: buildLessonKey(identity),
    taskId: identity.taskId || null,
    lessonId: identity.lessonId || null,
    topicId: identity.topicId || null,
    grade: identity.grade,
    subject: identity.subject,
    lessonTitle: identity.lessonTitle,
    markdown: { path: null, exists: false, contentHash: null, lastVerifiedAt: null },
    chunks: {
      available: false,
      trustedCount: 0,
      chunkIds: [],
      fingerprint: null,
      sourceMarkdownHash: null,
      lastVerifiedAt: null,
    },
    generatedDraft: {
      available: false,
      contentHash: null,
      lessonId: identity.lessonId || null,
      taskId: identity.taskId || null,
      evidenceFingerprint: null,
      savedAt: null,
    },
    review: { status: "not_started" },
    lastAction: null,
    updatedAt: new Date().toISOString(),
  };
}

export function resolveScraiPlan(memory: ScraiLessonMemory): ScraiPlan {
  const skippedActions: ScraiPlan["skippedActions"] = [];

  if (!memory.markdown.path || !memory.markdown.exists || !memory.markdown.contentHash) {
    return {
      nextAction: "locate_source",
      visibleActions: ["locate_source", "create_markdown"],
      skippedActions,
    };
  }

  skippedActions.push({
    action: "create_markdown",
    reason: "A verified Markdown file already exists for this lesson.",
  });

  const chunksMatchMarkdown =
    memory.chunks.available &&
    memory.chunks.trustedCount > 0 &&
    memory.chunks.sourceMarkdownHash === memory.markdown.contentHash;

  if (!chunksMatchMarkdown) {
    return { nextAction: "create_chunks", visibleActions: ["create_chunks"], skippedActions };
  }

  skippedActions.push({
    action: "create_chunks",
    reason: `${memory.chunks.trustedCount} trusted chunks already match the current Markdown version.`,
  });

  const evidenceFingerprint = buildEvidenceFingerprint({
    markdownHash: memory.markdown.contentHash,
    chunkIds: memory.chunks.chunkIds,
  });
  const draftMatchesEvidence =
    memory.generatedDraft.available &&
    memory.generatedDraft.evidenceFingerprint === evidenceFingerprint;

  if (!draftMatchesEvidence) {
    return {
      nextAction: "generate_lesson",
      visibleActions: ["generate_lesson", "save_admin_draft"],
      skippedActions,
    };
  }

  skippedActions.push({
    action: "generate_lesson",
    reason: "A lesson draft already exists for the current evidence.",
  });
  skippedActions.push({
    action: "save_admin_draft",
    reason: "The matching draft is already saved for admin review.",
  });

  if (["not_started", "needs_review"].includes(memory.review.status)) {
    return { nextAction: "wait_for_review", visibleActions: ["wait_for_review"], skippedActions };
  }

  return { nextAction: "completed", visibleActions: ["completed"], skippedActions };
}
