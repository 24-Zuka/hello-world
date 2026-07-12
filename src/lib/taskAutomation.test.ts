import { describe, expect, it } from "vitest";

import { createTaskDraft, previewImportPayload, tasksForColumn, validateImportPayload } from "./taskAutomation";

describe("task automation helpers", () => {
  it("creates a safe manual draft", () => {
    const task = createTaskDraft();
    expect(task.status).toBe("DRAFT");
    expect(task.auto_run).toBe(false);
    expect(task.max_attempts).toBe(3);
  });

  it("groups tasks by automation status", () => {
    const ready = { ...createTaskDraft(), task_id: "ready", status: "READY" as const };
    const running = { ...createTaskDraft(), task_id: "running", status: "RUNNING" as const };
    expect(tasksForColumn([ready, running], ["READY", "QUEUED"]).map((task) => task.task_id)).toEqual(["ready"]);
  });

  it("rejects empty imports", () => {
    expect(validateImportPayload("   ")).toMatch(/貼り付け/);
    expect(validateImportPayload("# Task")).toBeNull();
  });

  it("previews JSON and Markdown imports before registration", () => {
    expect(previewImportPayload('[{"title":"A"},{"title":"B"}]')).toEqual({
      count: 2,
      titles: ["A", "B"],
      format: "JSON",
    });
    expect(previewImportPayload("# 調査タスク\n本文")).toEqual({
      count: 1,
      titles: ["調査タスク"],
      format: "Markdown",
    });
  });
});
