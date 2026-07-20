import {
  buildEvidenceFingerprint,
  type ScraiLessonIdentity,
  type ScraiLessonMemory,
  type ScraiReviewStatus,
} from "./scraiPlanner";
import {
  getOrCreateScraiLessonMemory,
  getScraiLessonMemory,
  saveScraiLessonMemory,
} from "./scraiMemoryStore";

export async function markDraftSaved(input: {
  identity: ScraiLessonIdentity;
  contentHash: string | null;
  lessonId?: string | null;
  taskId?: string | null;
}): Promise<ScraiLessonMemory> {
  const memory = await getOrCreateScraiLessonMemory(input.identity);
  const evidenceReady =
    memory.markdown.exists &&
    Boolean(memory.markdown.contentHash) &&
    memory.chunks.available &&
    memory.chunks.trustedCount > 0 &&
    memory.chunks.sourceMarkdownHash === memory.markdown.contentHash;
  if (!evidenceReady) {
    throw new Error("SCRAI cannot mark a draft saved until Markdown and trusted chunks match.");
  }

  const evidenceFingerprint = buildEvidenceFingerprint({
    markdownHash: memory.markdown.contentHash,
    chunkIds: memory.chunks.chunkIds,
  });
  return saveScraiLessonMemory({
    ...memory,
    lessonId: input.lessonId || memory.lessonId,
    taskId: input.taskId || memory.taskId,
    generatedDraft: {
      available: true,
      contentHash: input.contentHash,
      lessonId: input.lessonId || memory.lessonId,
      taskId: input.taskId || memory.taskId,
      evidenceFingerprint,
      savedAt: new Date().toISOString(),
    },
    review: { status: "needs_review" },
    lastAction: "save_admin_draft",
  });
}

export async function markReviewStatus(
  lessonKey: string,
  status: ScraiReviewStatus,
): Promise<ScraiLessonMemory> {
  const memory = await getScraiLessonMemory(lessonKey);
  if (!memory) throw new Error(`SCRAI lesson memory not found: ${lessonKey}`);
  return saveScraiLessonMemory({
    ...memory,
    review: { status },
    lastAction: status === "approved" || status === "published" ? "completed" : memory.lastAction,
  });
}
