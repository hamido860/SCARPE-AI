import { resolveScraiPlan, type ScraiLessonMemory, type ScraiPlan } from "./scraiPlanner";
import {
  getScraiLessonMemory,
  listScraiLessonMemory,
} from "./scraiMemoryStore";
import { markMarkdownEvidence, markTrustedChunks } from "./scraiEvidenceMemory";
import { markDraftSaved, markReviewStatus } from "./scraiOutputMemory";

export * from "./scraiPlanner";
export * from "./scraiMemoryStore";
export * from "./scraiEvidenceMemory";
export * from "./scraiOutputMemory";

export async function listScraiLessonsNeedingAction(): Promise<
  Array<{ memory: ScraiLessonMemory; plan: ScraiPlan }>
> {
  const lessons = await listScraiLessonMemory();
  return lessons
    .map((memory) => ({ memory, plan: resolveScraiPlan(memory) }))
    .filter(({ plan }) => !["wait_for_review", "completed"].includes(plan.nextAction));
}

export async function listCompletedScraiLessons(): Promise<
  Array<{ memory: ScraiLessonMemory; plan: ScraiPlan }>
> {
  const lessons = await listScraiLessonMemory();
  return lessons
    .map((memory) => ({ memory, plan: resolveScraiPlan(memory) }))
    .filter(({ plan }) => ["wait_for_review", "completed"].includes(plan.nextAction));
}

declare global {
  interface Window {
    SCRAI_MEMORY?: {
      get: typeof getScraiLessonMemory;
      list: typeof listScraiLessonMemory;
      plan: typeof resolveScraiPlan;
      needingAction: typeof listScraiLessonsNeedingAction;
      completed: typeof listCompletedScraiLessons;
      markMarkdown: typeof markMarkdownEvidence;
      markChunks: typeof markTrustedChunks;
      markDraftSaved: typeof markDraftSaved;
      markReview: typeof markReviewStatus;
    };
  }
}

export function installScraiMemoryBridge(): void {
  if (typeof window === "undefined" || window.SCRAI_MEMORY) return;
  window.SCRAI_MEMORY = {
    get: getScraiLessonMemory,
    list: listScraiLessonMemory,
    plan: resolveScraiPlan,
    needingAction: listScraiLessonsNeedingAction,
    completed: listCompletedScraiLessons,
    markMarkdown: markMarkdownEvidence,
    markChunks: markTrustedChunks,
    markDraftSaved,
    markReview: markReviewStatus,
  };
}
