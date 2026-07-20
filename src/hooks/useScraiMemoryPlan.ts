import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildLessonKey,
  createEmptyScraiMemory,
  resolveScraiPlan,
  type ScraiAction,
  type ScraiLessonIdentity,
  type ScraiLessonMemory,
} from "../services/scraiPlanner";
import { getScraiLessonMemory } from "../services/scraiMemoryStore";

export function useScraiMemoryPlan(identity: ScraiLessonIdentity) {
  const lessonKey = useMemo(
    () => buildLessonKey(identity),
    [identity.lessonId, identity.topicId, identity.grade, identity.subject, identity.lessonTitle],
  );
  const [memory, setMemory] = useState<ScraiLessonMemory | null>(null);

  const refresh = useCallback(async () => {
    setMemory(await getScraiLessonMemory(lessonKey));
  }, [lessonKey]);

  useEffect(() => {
    void refresh();
    const onMemoryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ lessonKey?: string }>).detail;
      if (!detail?.lessonKey || detail.lessonKey === lessonKey) void refresh();
    };
    window.addEventListener("scrai-memory-updated", onMemoryUpdated);
    return () => window.removeEventListener("scrai-memory-updated", onMemoryUpdated);
  }, [lessonKey, refresh]);

  const effectiveMemory = memory || createEmptyScraiMemory(identity);
  const plan = resolveScraiPlan(effectiveMemory);

  return {
    lessonKey,
    memory,
    plan,
    refresh,
    isActionVisible: (action: ScraiAction) => plan.visibleActions.includes(action),
    isActionSkipped: (action: ScraiAction) => plan.skippedActions.some((item) => item.action === action),
  };
}
