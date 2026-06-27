// invoke ラッパー（§7.1）。Tauri 内なら実 Rust commands を、ブラウザ単体起動なら
// browserMock を呼ぶ。各画面はこの api のみに依存する（mock/実の分岐はここ1箇所）。

import type {
  AppSettings,
  AuthStatus,
  Health,
  McpServer,
  Quota,
  ScheduleJob,
  SearchHit,
  VaultNode,
  Worktree,
} from "../types";
import * as browserMock from "./browserMock";

// Tauri ランタイム内かどうか。__TAURI_INTERNALS__ は Tauri v2 が注入する。
export const isTauri = (): boolean =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  return browserMock.invoke<T>(cmd, args);
}

// ── §7.1 Commands ────────────────────────────────────────────────────────────

export const api = {
  healthCheck: () => call<Health>("health_check"),
  codexAuthStatus: () => call<AuthStatus>("codex_auth_status"),
  codexLogin: () => call<string>("codex_login"),
  quotaStatus: () => call<Quota>("quota_status"),

  mcpList: () => call<McpServer[]>("mcp_list"),
  mcpToggle: (name: string, enabled: boolean) => call<void>("mcp_toggle", { name, enabled }),

  worktreeList: (repo: string) => call<Worktree[]>("worktree_list", { repo }),
  worktreeCreate: (repo: string, feature: string) =>
    call<Worktree>("worktree_create", { repo, feature }),
  codexBuild: (worktree: string, prompt: string, profile?: string) =>
    call<string>("codex_build", { worktree, prompt, profile }),
  localReview: (worktree: string, base: string) =>
    call<string>("local_review", { worktree, base }),
  gitDiff: (worktree: string, base: string) => call<string>("git_diff", { worktree, base }),
  // 要承認: 呼び出し前に承認モーダルを通す契約（§9, §14.3）。
  gitMerge: (worktree: string, base: string) => call<void>("git_merge", { worktree, base }),

  vaultTree: () => call<VaultNode[]>("vault_tree"),
  vaultRead: (path: string) => call<string>("vault_read", { path }),
  vaultWrite: (path: string, content: string, mode: "append" | "replace", heading?: string) =>
    call<void>("vault_write", { path, content, mode, heading }),
  // 要承認 + ゴミ箱経由（§4.4, §9）。
  vaultDelete: (path: string) => call<void>("vault_delete", { path }),
  vaultSearch: (query: string) => call<SearchHit[]>("vault_search", { query }),

  launchdList: () => call<ScheduleJob[]>("launchd_list"),
  launchdToggle: (label: string, on: boolean) => call<void>("launchd_toggle", { label, on }),
  launchdRunNow: (label: string) => call<string>("launchd_run_now", { label }),
  launchdSetTime: (label: string, hour: number, minute: number) =>
    call<void>("launchd_set_time", { label, hour, minute }),

  researchScan: (topic: string) => call<string>("research_scan", { topic }),

  configGetModel: () => call<string>("config_get_model"),
  // 要確認（§9）。
  configSetModel: (model: string) => call<void>("config_set_model", { model }),
  secretSet: (key: string, value: string) => call<void>("secret_set", { key, value }),
  settingsGet: () => call<AppSettings>("settings_get"),
  settingsSet: (patch: Partial<AppSettings>) => call<AppSettings>("settings_set", { patch }),
};

export type Api = typeof api;
