import { describe, expect, it } from "vitest";
import {
  buildEvidenceFingerprint,
  createEmptyScraiMemory,
  resolveScraiPlan,
  type ScraiLessonIdentity,
} from "./scraiPlanner";

const identity: ScraiLessonIdentity = {
  lessonId: "lesson-1",
  topicId: "topic-1",
  taskId: "task-1",
  grade: "1AC",
  subject: "Français",
  lessonTitle: "Les compléments circonstanciels",
};

describe("SCRAI local action planner", () => {
  it("starts by locating and creating Markdown evidence", () => {
    const plan = resolveScraiPlan(createEmptyScraiMemory(identity));
    expect(plan.nextAction).toBe("locate_source");
    expect(plan.visibleActions).toEqual(["locate_source", "create_markdown"]);
  });

  it("skips Markdown and asks only for chunks when the file already exists", () => {
    const memory = createEmptyScraiMemory(identity);
    memory.markdown = {
      path: "C:/scrai/lesson.md",
      exists: true,
      contentHash: "md-v1",
      lastVerifiedAt: new Date().toISOString(),
    };
    const plan = resolveScraiPlan(memory);
    expect(plan.nextAction).toBe("create_chunks");
    expect(plan.skippedActions.map((item) => item.action)).toContain("create_markdown");
  });

  it("generates only after trusted chunks match the current Markdown hash", () => {
    const memory = createEmptyScraiMemory(identity);
    memory.markdown = { path: "C:/scrai/lesson.md", exists: true, contentHash: "md-v1", lastVerifiedAt: null };
    memory.chunks = {
      available: true,
      trustedCount: 2,
      chunkIds: ["chunk-b", "chunk-a"],
      fingerprint: "stored",
      sourceMarkdownHash: "md-v1",
      lastVerifiedAt: null,
    };
    expect(resolveScraiPlan(memory).nextAction).toBe("generate_lesson");

    memory.chunks.sourceMarkdownHash = "old-md";
    expect(resolveScraiPlan(memory).nextAction).toBe("create_chunks");
  });

  it("hides generation and save when a matching draft already exists", () => {
    const memory = createEmptyScraiMemory(identity);
    memory.markdown = { path: "C:/scrai/lesson.md", exists: true, contentHash: "md-v1", lastVerifiedAt: null };
    memory.chunks = {
      available: true,
      trustedCount: 2,
      chunkIds: ["chunk-b", "chunk-a"],
      fingerprint: "stored",
      sourceMarkdownHash: "md-v1",
      lastVerifiedAt: null,
    };
    memory.generatedDraft = {
      available: true,
      contentHash: "draft-v1",
      lessonId: "lesson-1",
      taskId: "task-1",
      evidenceFingerprint: buildEvidenceFingerprint({ markdownHash: "md-v1", chunkIds: memory.chunks.chunkIds }),
      savedAt: new Date().toISOString(),
    };
    memory.review.status = "needs_review";

    const plan = resolveScraiPlan(memory);
    expect(plan.nextAction).toBe("wait_for_review");
    expect(plan.visibleActions).toEqual(["wait_for_review"]);
    expect(plan.skippedActions.map((item) => item.action)).toEqual(
      expect.arrayContaining(["create_markdown", "create_chunks", "generate_lesson", "save_admin_draft"]),
    );

    memory.review.status = "approved";
    expect(resolveScraiPlan(memory).nextAction).toBe("completed");
  });
});
