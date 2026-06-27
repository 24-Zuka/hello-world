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
