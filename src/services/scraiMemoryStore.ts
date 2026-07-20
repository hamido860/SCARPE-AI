import {
  LOCAL_MEMORY_STORES,
  clearLocalStore,
  getAllLocalRecords,
  getLocalRecord,
  putLocalRecord,
} from "./localMemoryDb";
import {
  buildLessonKey,
  createEmptyScraiMemory,
  type ScraiAction,
  type ScraiLessonIdentity,
  type ScraiLessonMemory,
} from "./scraiPlanner";

export interface ScraiActionHistoryRecord {
  id: string;
  lessonKey: string;
  action: ScraiAction;
  result: "started" | "completed" | "failed" | "skipped";
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export async function getScraiLessonMemory(lessonKey: string): Promise<ScraiLessonMemory | null> {
  return getLocalRecord<ScraiLessonMemory>(LOCAL_MEMORY_STORES.scraiLessons, lessonKey);
}

export async function listScraiLessonMemory(): Promise<ScraiLessonMemory[]> {
  return getAllLocalRecords<ScraiLessonMemory>(LOCAL_MEMORY_STORES.scraiLessons);
}

export async function getOrCreateScraiLessonMemory(identity: ScraiLessonIdentity): Promise<ScraiLessonMemory> {
  const lessonKey = buildLessonKey(identity);
  const existing = await getScraiLessonMemory(lessonKey);
  if (existing) return existing;
  const created = createEmptyScraiMemory(identity);
  await putLocalRecord(LOCAL_MEMORY_STORES.scraiLessons, created);
  return created;
}

export async function saveScraiLessonMemory(memory: ScraiLessonMemory): Promise<ScraiLessonMemory> {
  const saved = { ...memory, updatedAt: new Date().toISOString() };
  await putLocalRecord(LOCAL_MEMORY_STORES.scraiLessons, saved);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("scrai-memory-updated", {
      detail: { lessonKey: saved.lessonKey },
    }));
  }
  return saved;
}

export async function recordScraiAction(
  lessonKey: string,
  action: ScraiAction,
  result: ScraiActionHistoryRecord["result"],
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const id = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await putLocalRecord(LOCAL_MEMORY_STORES.actionHistory, {
    id,
    lessonKey,
    action,
    result,
    reason,
    metadata,
    createdAt: new Date().toISOString(),
  } satisfies ScraiActionHistoryRecord);
}

export async function clearScraiMemory(): Promise<void> {
  await Promise.all([
    clearLocalStore(LOCAL_MEMORY_STORES.scraiLessons),
    clearLocalStore(LOCAL_MEMORY_STORES.actionHistory),
  ]);
}
