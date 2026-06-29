// AIRFLOW dispatcher (§8). Runs on a schedule (launchd §8.5).
// Flow: STOP check → fetch board → filter needs-ai/ai-batch minus dispatcher-lock
//       → take 1 by priority → hand to Codex → write back → errors → blocked.
// Also runs the 72h auto-blocked sweep (§7.1) each invocation.
//
// Guard: if the `codex` binary is absent (e.g. this Linux dev box), the Codex
// step falls back to a no-op stub so the dispatcher still runs end-to-end and
// hands the task back to a human instead of crashing.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchDeny } from "./deny-list.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STOP_FILE = path.join(ROOT, "STOP");

const BASE_URL = process.env.BOARD_BASE_URL || "http://localhost:3000";
const TOKEN = process.env.DISPATCHER_TOKEN || process.env.TOKEN_CODEX_BATCH;
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

function log(...args) {
  console.log(`[dispatcher ${new Date().toISOString()}]`, ...args);
}

async function api(method, pathname, body) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      "X-Board-Token": TOKEN || "",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${pathname} → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// §8.4 — hand the task to Codex non-interactively. Returns the handoff text.
function runCodex(task) {
  const codexAvailable = spawnSync("which", ["codex"]).status === 0;
  const prompt =
    `AIRFLOWタスク${task.id}を処理せよ。\n` +
    `title: ${task.title}\n` +
    `handoff_note: ${task.handoff_note}\n` +
    `完了後は『何をやったか・次担当者への引継ぎ』を簡潔に出力すること。\n` +
    `不可逆操作（削除・外部送信・本番デプロイ）は実行せず needs-human に差し戻すこと。`;

  if (!codexAvailable) {
    log(`codex not found — using stub for ${task.id}.`);
    return {
      ok: true,
      handoff:
        "（codex 未インストールのためスタブ実行）タスク内容を確認しました。" +
        "実処理には codex CLI が必要です。人間の確認のため needs-human に差し戻します。",
      nextStatus: "needs-human",
    };
  }

  const res = spawnSync(
    "codex",
    [
      "exec",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      prompt,
    ],
    { encoding: "utf8", cwd: ROOT, timeout: 1000 * 60 * 10 },
  );

  if (res.status !== 0) {
    return { ok: false, error: res.stderr || `codex exited ${res.status}` };
  }
  const output = (res.stdout || "").trim();
  // §11.1 safety net: if Codex echoed a denied operation, flag it loudly in the
  // handoff so the human reviewer sees it. Either way we return to needs-human —
  // the dispatcher never auto-completes; a human confirms via /complete (§7).
  const denied = matchDeny(output);
  const handoff = denied
    ? `⚠️ deny-list match (${denied}) detected in output — review required.\n\n${output}`
    : output || "（出力なし）";
  return { ok: true, handoff, nextStatus: "needs-human" };
}

async function main() {
  // §11.3 emergency stop switch
  if (existsSync(STOP_FILE)) {
    log("STOP file present. Halting dispatcher.");
    process.exit(0);
  }
  if (!TOKEN) {
    log("No DISPATCHER_TOKEN / TOKEN_CODEX_BATCH set. Aborting.");
    process.exit(1);
  }

  // §7.1 auto-blocked sweep happens server-side data, but we trigger it by
  // PATCHing any stale task we detect here (the API has no cron of its own).
  const board = await api("GET", "/api/board");
  await sweepStale(board);

  // §8.2 select work
  const candidates = board
    .filter((t) => t.status === "needs-ai" && t.owner === "ai-batch")
    .filter((t) => !(t.tags || []).includes("dispatcher-lock")) // §11.4
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
    );

  if (candidates.length === 0) {
    log("No eligible needs-ai/ai-batch tasks. Done.");
    return;
  }

  const task = candidates[0]; // §8.3 one at a time
  log(`Processing ${task.id} (${task.priority}) — ${task.title}`);

  // mark in-progress
  await api("PATCH", `/api/board/${task.id}`, {
    status: "in-progress",
    action: "dispatcher: started",
  });

  try {
    const result = runCodex(task);
    if (!result || !result.ok) {
      throw new Error(result ? result.error : "no result from codex");
    }
    await api("PATCH", `/api/board/${task.id}`, {
      status: result.nextStatus,
      handoff_note: result.handoff,
      action: "dispatcher: processed via codex",
    });
    log(`${task.id} → ${result.nextStatus}`);
  } catch (err) {
    // §8.2 step 7 — on error, block the task with the reason recorded.
    await api("PATCH", `/api/board/${task.id}`, {
      status: "blocked",
      blocked_reason: String(err && err.message ? err.message : err),
      action: "dispatcher: error → blocked",
    });
    log(`${task.id} → blocked: ${err}`);
  }
}

// §7.1 — patch any task untouched >72h (and not done/blocked) to blocked.
async function sweepStale(board) {
  const cutoff = Date.now() - 72 * 3600 * 1000;
  for (const t of board) {
    if (t.status === "done" || t.status === "blocked") continue;
    const updated = Date.parse(t.updated_at);
    if (Number.isFinite(updated) && updated < cutoff) {
      await api("PATCH", `/api/board/${t.id}`, {
        status: "blocked",
        blocked_reason: "72時間変化なし",
        action: "auto-blocked: 72時間変化なし",
      });
      log(`${t.id} auto-blocked (stale >72h)`);
    }
  }
}

main().catch((err) => {
  log("FATAL", err);
  process.exit(1);
});
