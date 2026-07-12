// ブラウザ単体起動（Tauri 外）用のモック IPC（§ plan: フロントのみ Web 起動確認）。
// 実 Rust backend が無い環境で 8 画面を描画・操作確認できるよう、§3.1 のデータ形を返す。
// ジョブ実行は疑似 JSONL ストリームを emit して LogStream の逐次表示を再現する。

import type {
  AppSettings,
  AuthStatus,
  Health,
  McpServer,
  Quota,
  ScheduleJob,
  SearchHit,
  TaskCard,
  TaskArtifact,
  RoutingDecision,
  OrchestratorStatus,
  ModelCapability,
  WorkerHealth,
  VaultNode,
  Worktree,
} from "../types";

// ── 疑似イベントバス（events.ts が購読） ──────────────────────────────────────
type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

export function on(event: string, handler: Handler): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => h(payload));
}

// ── モック状態 ───────────────────────────────────────────────────────────────
let settings: AppSettings = {
  airflow_store_path: "/Users/kai/Library/Application Support/AirFlow",
  vault_path: "/Users/kai/Obsidian/Vault",
  repos_parent: "/Users/kai/dev",
  scripts_path: "/Users/kai/.codex/scripts",
  workspace_root: "/Users/kai/jarvis-workspace",
  lmstudio_endpoint: "http://localhost:1234",
  obsidian_endpoint: "http://127.0.0.1:27123",
  default_model: "gpt-5.4-mini",
  retreat_mode: false,
  // デモでは未設定（赤旗オフ）。Quota 画面のロジック確認は store 側トグルで。
  openai_api_key_present: false,
  detected_api_keys: [],
  database_path: "/Users/kai/Library/Application Support/JARVIS Cockpit/jarvis.sqlite3",
  database_error: null,
  orchestrator_enabled: true,
  orchestrator_auto_start: false,
  poll_interval_seconds: 5,
  max_concurrency: 2,
  codex_concurrency: 1,
  lmstudio_concurrency: 1,
  codex_default_reasoning: "medium",
  luna_model: "gpt-5.4-mini",
  terra_model: "gpt-5.4",
  sol_model: "gpt-5.5",
  lmstudio_default_model: "qwen_qwen3.5-9b",
  auto_escalation: true,
  quality_threshold: 85,
  max_retries: 3,
  artifact_root: "/Users/kai/Library/Application Support/JARVIS Cockpit/workspace/tasks",
  log_retention_days: 30,
};

let jobSeq = 1;
const nextJob = () => `job-${String(jobSeq++).padStart(4, "0")}`;

// デモ用の JSONL 風ストリームを time-sliced に emit。
function streamJob(jobId: string, lines: string[]) {
  let i = 0;
  const tick = () => {
    if (i >= lines.length) {
      emit("job:done", { jobId, exitCode: 0, durationMs: lines.length * 400 });
      return;
    }
    const line = lines[i++];
    emit("job:log", { jobId, line, stream: "stdout" });
    try {
      const parsed = JSON.parse(line);
      emit("job:event", { jobId, type: parsed.type ?? "event", payload: parsed });
    } catch {
      /* not json */
    }
    setTimeout(tick, 400);
  };
  setTimeout(tick, 200);
}

const VAULT: VaultNode[] = [
  { path: "MEMORY.md", type: "note" },
  { path: "AI_Handoff.md", type: "note" },
  { path: "DECISION_LOG.md", type: "note" },
  {
    path: "Daily/",
    type: "dir",
    children: [{ path: "Daily/2026-06-27.md", type: "note" }],
  },
  { path: "00_Inbox/", type: "dir", children: [{ path: "00_Inbox/research_tauri.md", type: "note" }] },
  { path: "Projects/", type: "dir", children: [{ path: "Projects/JARVIS Cockpit.md", type: "note" }] },
  { path: "Agents/", type: "dir", children: [
    { path: "Agents/秘書AI.md", type: "note" },
    { path: "Agents/開発AI.md", type: "note" },
  ] },
];

const NOTES: Record<string, string> = {
  "Daily/2026-06-27.md": `# Daily 2026-06-27

## 最優先3件
1. JARVIS Cockpit MVP の worktree 作成
2. ローカルレビューの導線確認
3. Plus 残量ゲージの「不明」表示テスト

## 要承認
- main への初回マージ（承認待ち）
`,
  "AI_Handoff.md": `<!-- AI_HANDOFF_ANCHOR -->
## 2026-06-27 14:20 — 開発AI → 秘書AI
Cockpit の Build 画面を実装。レビュー待ち。

## 2026-06-27 11:05 — 秘書AI → 開発AI
worktree feat/cockpit を切って着手を指示。
`,
  "DECISION_LOG.md": `## 2026-06-27 — スタックは Tauri 2 に決定
理由: 24GB 機での軽量性と Keychain/プロセス連携の容易さ（§2）。

## 2026-06-26 — 課金ゼロ規律を UI で強制
APIキー入力欄を一切持たない方針を確定（§0.2）。
`,
  "MEMORY.md": "# MEMORY\n\n共有記憶のルート。書き物文化の中心。\n",
};

const AUTOMATION_DEFAULTS = {
  parent_task_id: null,
  description: "",
  objective: "",
  task_type: "general",
  status: "DRAFT",
  task_priority: "MEDIUM",
  worker_type: null,
  requested_model: null,
  selected_model: null,
  requested_reasoning: null,
  selected_reasoning: null,
  routing_reason: null,
  auto_run: false,
  requires_human_approval: false,
  instructions: "",
  context: "",
  input_refs: [],
  source_urls: [],
  output_format: "markdown",
  acceptance_criteria: [],
  max_attempts: 3,
  attempt_count: 0,
  timeout_seconds: 900,
  created_at: "2026-07-01T09:00:00+09:00",
  last_updated: "2026-07-01T09:00:00+09:00",
  queued_at: null,
  started_at: null,
  completed_at: null,
  result_summary: null,
  artifact_paths: [],
  error_message: null,
  lease_owner: null,
  lease_expires_at: null,
} satisfies Pick<TaskCard, "parent_task_id" | "description" | "objective" | "task_type" | "status" | "task_priority" | "worker_type" | "requested_model" | "selected_model" | "requested_reasoning" | "selected_reasoning" | "routing_reason" | "auto_run" | "requires_human_approval" | "instructions" | "context" | "input_refs" | "source_urls" | "output_format" | "acceptance_criteria" | "max_attempts" | "attempt_count" | "timeout_seconds" | "created_at" | "last_updated" | "queued_at" | "started_at" | "completed_at" | "result_summary" | "artifact_paths" | "error_message" | "lease_owner" | "lease_expires_at">;

let TASKS: TaskCard[] = [
  {
    ...AUTOMATION_DEFAULTS,
    id: "TKT-20260701-001",
    task_id: "TASK-2026-0701A",
    title: "AirFlow完全版仕様書をアプリ実装へ反映する",
    category: "Engineering",
    legacy_status: "Doing",
    priority: 1,
    risk_score: 2.4,
    created: "2026-07-01T09:00:00+09:00",
    updated: "2026-07-01T13:30:00+09:00",
    due: "2026-07-01",
    source: "manual",
    assignee: "codex",
    tier: 3,
    decision_required: false,
    dependencies: [],
    links: ["[[01_Projects/AirFlow AI自動化タスクボード 完全版仕様書]]"],
    log: ["Design Spec v1.0 をUIトークンへ反映中"],
    status: "RUNNING",
    task_priority: "HIGH",
    worker_type: "codex",
    auto_run: true,
    objective: "AirFlow仕様を実装する",
    instructions: "実装と検証を行う",
  },
  {
    ...AUTOMATION_DEFAULTS,
    id: "TKT-20260701-002",
    task_id: "TASK-2026-0701B",
    title: "OPENAI/GEMINI APIキー検出時の赤旗を確認する",
    category: "Business",
    legacy_status: "Waiting",
    priority: 1,
    risk_score: 3.2,
    created: "2026-07-01T09:30:00+09:00",
    updated: "2026-07-01T12:10:00+09:00",
    due: "2026-07-01",
    source: "ai",
    assignee: "human",
    tier: 2,
    decision_required: true,
    dependencies: ["TASK-2026-0701A"],
    links: ["[[04_Context/AI秘書システム]]"],
    log: ["risk_score >= 3.0 のため承認モーダル対象"],
    status: "AWAITING_APPROVAL",
    task_priority: "HIGH",
    worker_type: "human",
    requires_human_approval: true,
  },
  {
    ...AUTOMATION_DEFAULTS,
    id: "TKT-20260701-003",
    task_id: "TASK-2026-0701C",
    title: "明朝の朝礼レポートに要判断を集約する",
    category: "Content",
    legacy_status: "Today",
    priority: 2,
    risk_score: 1.4,
    created: "2026-07-01T10:00:00+09:00",
    updated: "2026-07-01T10:00:00+09:00",
    due: "2026-07-02",
    source: "obsidian-inbox",
    assignee: "lmstudio",
    tier: 2,
    decision_required: false,
    dependencies: [],
    links: ["[[90_Daily/AirFlow_2026-06-29_朝礼]]"],
    log: ["LM Studioで分類済み"],
    status: "READY",
    worker_type: "local_llm",
    auto_run: true,
  },
];

let orchestrator: OrchestratorStatus = { mode: "stopped", enabled: true, poll_interval_seconds: 5, running_tasks: 0, last_tick_at: null, last_error: null };
const artifacts = new Map<string, TaskArtifact[]>();

// ── invoke ハンドラ ──────────────────────────────────────────────────────────
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const a = args ?? {};
  const r = (v: unknown) => v as T;
  await new Promise((res) => setTimeout(res, 60)); // 疑似レイテンシ

  switch (cmd) {
    case "health_check":
      return r({ codex: "ok", lmstudio: "warn", obsidian: "ok",
        note: "LM Studio はモデル未ロード（警告）。Settings で疎通テスト可。" } as Health);
    case "codex_auth_status":
      return r({ logged_in: true, method: "chatgpt" } as AuthStatus);
    case "codex_login":
      return r("ok");
    case "quota_status":
      // §12: デモは「不明」を正直に返す（誤った安心を与えない）。
      return r({ window_used: 0, window_limit: 0, resets_at: null, weekly: null,
        source: "unknown" } as Quota);
    case "task_list":
      return r(TASKS);
    case "task_get": {
      const task = TASKS.find((task) => task.task_id === a.task_id);
      if (!task) throw new Error("task not found");
      return r(task);
    }
    case "task_create": {
      const input = a.task as TaskCard;
      const id = input.task_id || `task-${Date.now()}`;
      const task = { ...AUTOMATION_DEFAULTS, ...input, id: input.id || id, task_id: id, created_at: new Date().toISOString(), last_updated: new Date().toISOString() } as TaskCard;
      TASKS = [task, ...TASKS];
      emit("task:created", task);
      return r(task);
    }
    case "task_update": {
      const input = a.task as TaskCard;
      TASKS = TASKS.map((task) => task.task_id === input.task_id ? input : task);
      emit("task:updated", input);
      return r(input);
    }
    case "task_import": {
      const payload = String(a.payload ?? "");
      let imported: TaskCard[];
      try {
        const parsed = JSON.parse(payload) as TaskCard | TaskCard[];
        imported = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        imported = [{ ...AUTOMATION_DEFAULTS, id: "", task_id: "", title: payload.match(/^#\s+(.+)$/m)?.[1] ?? "Imported task", category: "Business", legacy_status: "Inbox", priority: 2, risk_score: 1, created: "", updated: "", due: null, source: "manual", assignee: "human", tier: 1, decision_required: false, dependencies: [], links: [], log: [], description: payload }];
      }
      const created = imported.map((input, index) => {
        const id = input.task_id || `task-${Date.now()}-${index}`;
        return { ...AUTOMATION_DEFAULTS, ...input, id: input.id || id, task_id: id, created_at: new Date().toISOString(), last_updated: new Date().toISOString() } as TaskCard;
      });
      TASKS = [...created, ...TASKS];
      created.forEach((task) => emit("task:created", task));
      return r(created);
    }
    case "task_archive":
      return r(updateMockTask(String(a.task_id), { status: "ARCHIVED", auto_run: false }));
    case "task_route_preview":
      return r(mockRoute(TASKS.find((task) => task.task_id === a.task_id)!));
    case "task_enqueue":
      return r(updateMockTask(String(a.task_id), { status: "QUEUED", legacy_status: "Today", auto_run: true, queued_at: new Date().toISOString() }));
    case "task_run_now": {
      const task = updateMockTask(String(a.task_id), { status: "RUNNING", legacy_status: "Doing", attempt_count: (TASKS.find((t) => t.task_id === a.task_id)?.attempt_count ?? 0) + 1 });
      const job = nextJob();
      streamJob(job, ["{\"type\":\"task_started\"}", "{\"type\":\"artifact_created\"}"]);
      setTimeout(() => {
        const path = `/mock/tasks/${task.task_id}/output.md`;
        artifacts.set(task.task_id, [{ artifact_id: `artifact-${task.task_id}`, task_id: task.task_id, kind: "output", path, media_type: "text/markdown", size_bytes: 180, created_at: new Date().toISOString() }]);
        const completed = updateMockTask(task.task_id, { status: "COMPLETED", legacy_status: "Done", completed_at: new Date().toISOString(), artifact_paths: [path], result_summary: "Mock worker completed" });
        emit("task:completed", completed);
      }, 1000);
      return r(task);
    }
    case "task_cancel":
      return r(updateMockTask(String(a.task_id), { status: "CANCELLED", auto_run: false }));
    case "task_retry":
      return r(updateMockTask(String(a.task_id), { status: "QUEUED", auto_run: true, error_message: null }));
    case "task_approve":
      return r(updateMockTask(String(a.task_id), { status: "QUEUED", auto_run: true, requires_human_approval: false, decision_required: false }));
    case "task_reject":
      return r(updateMockTask(String(a.task_id), { status: "CANCELLED", auto_run: false }));
    case "task_feedback":
      return r(updateMockTask(String(a.task_id), { status: "AWAITING_INPUT", auto_run: false, error_message: String(a.feedback ?? "") }));
    case "task_artifacts":
      return r(artifacts.get(String(a.task_id)) ?? []);
    case "task_artifact_read":
      return r("# Mock artifact\n\nブラウザデモで生成された決定論的な成果物です。");
    case "task_artifact_open":
      return r(undefined);
    case "orchestrator_status":
      return r(orchestrator);
    case "orchestrator_start":
      orchestrator = { ...orchestrator, mode: "running" }; emit("orchestrator:status", orchestrator); return r(orchestrator);
    case "orchestrator_pause":
      orchestrator = { ...orchestrator, mode: "paused" }; emit("orchestrator:status", orchestrator); return r(orchestrator);
    case "orchestrator_resume":
      orchestrator = { ...orchestrator, mode: "running" }; emit("orchestrator:status", orchestrator); return r(orchestrator);
    case "orchestrator_stop":
      orchestrator = { ...orchestrator, mode: "stopped" }; emit("orchestrator:status", orchestrator); return r(orchestrator);
    case "orchestrator_run_once":
      return r(null);
    case "worker_health":
      return r([{ worker_type: "codex", status: "ok", models: ["gpt-5.5", "gpt-5.4"], note: null }, { worker_type: "local_llm", status: "ok", models: ["qwen_qwen3.5-9b"], note: null }, { worker_type: "work_manual", status: "ok", models: [], note: null }, { worker_type: "mock", status: "ok", models: ["deterministic-mock"], note: null }] as WorkerHealth[]);
    case "model_capabilities":
    case "model_refresh":
      return r([{ worker_type: "codex", model: "gpt-5.5", reasoning_levels: ["low", "medium", "high", "very_high"], available: true }, { worker_type: "local_llm", model: "qwen_qwen3.5-9b", reasoning_levels: ["low"], available: true }] as ModelCapability[]);
    case "mcp_list":
      return r([
        { name: "obsidian", enabled: true, transport: "stdio" },
        { name: "filesystem", enabled: true, transport: "stdio" },
        { name: "web_search", enabled: false, transport: "http" },
      ] as McpServer[]);
    case "mcp_toggle":
      return r(undefined);

    case "worktree_list":
      return r([
        { repo: String(a.repo ?? "hello-world"), path: "/Users/kai/dev/hello-world", branch: "main", dirty: false },
        { repo: String(a.repo ?? "hello-world"), path: "/Users/kai/dev/hello-world-feat-cockpit", branch: "feat/cockpit", dirty: true },
      ] as Worktree[]);
    case "worktree_create":
      return r({ repo: String(a.repo), path: `/Users/kai/dev/${a.feature}`, branch: String(a.feature), dirty: false } as Worktree);
    case "codex_build": {
      const job = nextJob();
      streamJob(job, [
        '{"type":"task_started","prompt":' + JSON.stringify(a.prompt ?? "") + "}",
        '{"type":"tool_call","name":"read_file","path":"src/lib.rs"}',
        '{"type":"tool_call","name":"edit","path":"src/commands.rs"}',
        '{"type":"test_result","passed":12,"failed":0}',
        '{"type":"task_completed","status":"ok"}',
      ]);
      return r(job);
    }
    case "local_review": {
      const job = nextJob();
      streamJob(job, [
        '{"type":"review_started","base":' + JSON.stringify(a.base ?? "main") + "}",
        '{"type":"finding","severity":"HIGH","file":"src/exec.rs","line":42,"message":"spawn 前に dcg を通すこと"}',
        '{"type":"finding","severity":"LOW","file":"src/App.tsx","line":10,"message":"未使用 import"}',
        '{"type":"review_completed"}',
      ]);
      return r(job);
    }
    case "git_diff":
      return r(
        `diff --git a/src/App.tsx b/src/App.tsx\n@@ -1,3 +1,5 @@\n+import { Sidebar } from "./components/Sidebar";\n-// TODO\n+export function App() {}\n`
      );
    case "git_merge":
      return r(undefined);

    case "vault_tree":
      return r(VAULT as VaultNode[]);
    case "vault_read":
      return r((NOTES[String(a.path)] ?? `# ${a.path}\n\n（モック: 内容なし）`) as string);
    case "vault_write":
      if (a.mode === "replace") NOTES[String(a.path)] = String(a.content);
      else NOTES[String(a.path)] = (NOTES[String(a.path)] ?? "") + "\n" + String(a.content);
      return r(undefined);
    case "vault_delete":
      delete NOTES[String(a.path)];
      return r(undefined);
    case "vault_search":
      return r([
        { path: "DECISION_LOG.md", snippet: "…課金ゼロ規律を UI で強制…" },
        { path: "Daily/2026-06-27.md", snippet: "…Plus 残量ゲージの「不明」表示…" },
      ] as SearchHit[]);

    case "launchd_list":
      return r([
        { label: "org.jarvis.morning", next_run: "明日 07:30", loaded: true, last_result: "exit 0" },
        { label: "org.jarvis.research", next_run: "—", loaded: false, last_result: "exit 0" },
      ] as ScheduleJob[]);
    case "launchd_toggle":
    case "launchd_set_time":
      return r(undefined);
    case "launchd_run_now": {
      const job = nextJob();
      streamJob(job, ['{"type":"morning_started"}', "朝会を実行中…", '{"type":"morning_done"}']);
      return r(job);
    }

    case "research_scan": {
      const job = nextJob();
      streamJob(job, [
        '{"type":"scan_started","topic":' + JSON.stringify(a.topic ?? "") + "}",
        "ソースを収集中…",
        '{"type":"brief_written","path":"00_Inbox/research_' + String(a.topic ?? "topic").slice(0, 8) + '.md"}',
      ]);
      return r(job);
    }

    case "config_get_model":
      return r(settings.default_model);
    case "config_set_model":
      settings = { ...settings, default_model: String(a.model) };
      return r(undefined);
    case "secret_set":
      return r(undefined);
    case "settings_get":
      return r(settings);
    case "settings_set":
      settings = { ...settings, ...(a.patch as Partial<AppSettings>) };
      return r(settings);

    default:
      throw new Error(`browserMock: 未実装コマンド ${cmd}`);
  }
}

function updateMockTask(taskId: string, patch: Partial<TaskCard>): TaskCard {
  const current = TASKS.find((task) => task.task_id === taskId);
  if (!current) throw new Error("task not found");
  const updated = { ...current, ...patch, last_updated: new Date().toISOString() };
  TASKS = TASKS.map((task) => task.task_id === taskId ? updated : task);
  emit("task:updated", updated);
  return updated;
}

function mockRoute(task: TaskCard): RoutingDecision {
  const approval = task.requires_human_approval || task.risk_score >= 3;
  const worker = approval ? "human" : task.worker_type ?? (task.task_type.includes("summary") ? "local_llm" : "codex");
  return { worker_type: worker, model: worker === "codex" ? settings.default_model : worker === "local_llm" ? settings.lmstudio_default_model : null, reasoning: task.requested_reasoning ?? (worker === "local_llm" ? "low" : "medium"), reason: approval ? "人間承認が必要です。" : "タスク種別に基づくルール判定です。", estimated_size: "small", escalation_condition: "品質75点未満でエスカレーション", requires_human_approval: approval };
}

// 定期 health:tick / quota:tick を擬似発火（§7.2）。
let started = false;
export function startTicks() {
  if (started) return;
  started = true;
  setInterval(async () => {
    emit("health:tick", await invoke<Health>("health_check"));
    emit("quota:tick", await invoke<Quota>("quota_status"));
  }, 5000);
}
