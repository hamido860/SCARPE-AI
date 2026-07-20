import { buildEvidenceFingerprint, type ScraiLessonIdentity, type ScraiLessonMemory } from "./scraiPlanner";
import { getOrCreateScraiLessonMemory, saveScraiLessonMemory } from "./scraiMemoryStore";

export async function markMarkdownEvidence(input: {
  identity: ScraiLessonIdentity;
  path: string;
  exists: boolean;
  contentHash: string | null;
}): Promise<ScraiLessonMemory> {
  const memory = await getOrCreateScraiLessonMemory(input.identity);
  const changed = Boolean(memory.markdown.contentHash) && memory.markdown.contentHash !== input.contentHash;
  const next: ScraiLessonMemory = {
    ...memory,
    markdown: {
      path: input.path || null,
      exists: input.exists,
      contentHash: input.contentHash,
      lastVerifiedAt: new Date().toISOString(),
    },
    lastAction: "create_markdown",
  };
  if (changed || !input.exists) {
    next.chunks = { available: false, trustedCount: 0, chunkIds: [], fingerprint: null, sourceMarkdownHash: null, lastVerifiedAt: null };
    next.generatedDraft = { ...next.generatedDraft, available: false, contentHash: null, evidenceFingerprint: null, savedAt: null };
    next.review = { status: "not_started" };
  }
  return saveScraiLessonMemory(next);
}

export async function markTrustedChunks(input: {
  identity: ScraiLessonIdentity;
  chunkIds: string[];
  sourceMarkdownHash: string | null;
}): Promise<ScraiLessonMemory> {
  const memory = await getOrCreateScraiLessonMemory(input.identity);
  const chunkIds = Array.from(new Set(input.chunkIds.map(String))).sort();
  const fingerprint = buildEvidenceFingerprint({ markdownHash: input.sourceMarkdownHash, chunkIds });
  const changed = memory.chunks.fingerprint !== fingerprint;
  const next: ScraiLessonMemory = {
    ...memory,
    chunks: {
      available: chunkIds.length > 0,
      trustedCount: chunkIds.length,
      chunkIds,
      fingerprint,
      sourceMarkdownHash: input.sourceMarkdownHash,
      lastVerifiedAt: new Date().toISOString(),
    },
    lastAction: "create_chunks",
  };
  if (changed) {
    next.generatedDraft = { ...next.generatedDraft, available: false, contentHash: null, evidenceFingerprint: null, savedAt: null };
    next.review = { status: "not_started" };
  }
  return saveScraiLessonMemory(next);
}
