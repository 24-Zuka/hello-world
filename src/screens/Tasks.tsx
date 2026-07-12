import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { listen } from "../lib/events";
import { createTaskDraft, previewImportPayload, TASK_COLUMNS, tasksForColumn, validateImportPayload } from "../lib/taskAutomation";
import type { OrchestratorStatus, RoutingDecision, TaskArtifact, TaskCard, WorkerType } from "../types";

type Notice = { level: "info" | "warn" | "error"; title: string; body: string };
type Approval = { title: string; body: string; target: string; risk: number; approve: () => Promise<void> | void };

export function Tasks({ tasks, refresh, toast, requestApproval }: {
  tasks: TaskCard[];
  refresh: () => Promise<void>;
  toast: (notice: Notice) => void;
  requestApproval: (approval: Approval) => void;
}) {
  const [selectedId, setSelectedId] = useState(tasks[0]?.task_id ?? "");
  const [draft, setDraft] = useState<TaskCard>(createTaskDraft());
  const [route, setRoute] = useState<RoutingDecision | null>(null);
  const [orchestrator, setOrchestrator] = useState<OrchestratorStatus | null>(null);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([]);
  const [artifactText, setArtifactText] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  const selected = useMemo(() => tasks.find((task) => task.task_id === selectedId), [selectedId, tasks]);
  const importPreview = useMemo(() => previewImportPayload(importText), [importText]);
  useEffect(() => { if (selected) setDraft(selected); }, [selected]);
  useEffect(() => { if (!selectedId && tasks[0]) setSelectedId(tasks[0].task_id); }, [selectedId, tasks]);
  useEffect(() => { api.orchestratorStatus().then(setOrchestrator).catch(() => setOrchestrator(null)); }, []);
  useEffect(() => {
    if (!selectedId) { setArtifacts([]); return; }
    api.taskArtifacts(selectedId).then(setArtifacts).catch(() => setArtifacts([]));
  }, [selectedId, tasks]);
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const event of ["task:created", "task:updated", "task:completed", "task:failed", "task:cancelled"]) {
      void listen<TaskCard>(event, () => void refresh()).then((cleanup) => cleanups.push(cleanup));
    }
    void listen<{ task_id: string; line: string; stream: string }>("task:log", (entry) => {
      if (entry.task_id === selectedId) setLogs((current) => [...current.slice(-499), `[${entry.stream}] ${entry.line}`]);
    }).then((cleanup) => cleanups.push(cleanup));
    void listen<OrchestratorStatus>("orchestrator:status", setOrchestrator).then((cleanup) => cleanups.push(cleanup));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [refresh, selectedId]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    try { await action(); await refresh(); toast({ level: "info", title: "Tasks", body: message }); }
    catch (error) { toast({ level: "error", title: "操作失敗", body: String(error) }); }
  };

  const create = () => {
    setSelectedId("");
    setDraft(createTaskDraft());
    setRoute(null);
    setArtifacts([]);
    setArtifactText("");
  };

  const save = async () => {
    if (!draft.title.trim()) { toast({ level: "warn", title: "入力不足", body: "タイトルを入力してください。" }); return; }
    const saved = draft.task_id ? await api.taskUpdate(draft) : await api.taskCreate(draft);
    setSelectedId(saved.task_id);
    await refresh();
    toast({ level: "info", title: "保存", body: saved.title });
  };

  const preview = async () => {
    if (!draft.task_id) { toast({ level: "warn", title: "先に保存", body: "ルート確認の前にタスクを保存してください。" }); return; }
    setRoute(await api.taskRoutePreview(draft.task_id));
  };

  const importTasks = async () => {
    const error = validateImportPayload(importText);
    if (error) { toast({ level: "warn", title: "取込エラー", body: error }); return; }
    await run(async () => { const created = await api.taskImport(importText); setSelectedId(created[0]?.task_id ?? ""); setImportText(""); setShowImport(false); }, "取込を完了しました。");
  };

  const control = async (command: "start" | "pause" | "resume" | "stop" | "once") => {
    const next = command === "start" ? await api.orchestratorStart()
      : command === "pause" ? await api.orchestratorPause()
      : command === "resume" ? await api.orchestratorResume()
      : command === "stop" ? await api.orchestratorStop()
      : (await api.orchestratorRunOnce(), await api.orchestratorStatus());
    setOrchestrator(next);
  };

  return (
    <div className="min-h-full">
      <header className="flex flex-wrap items-center gap-2 border-b border-base-700 px-4 py-3 md:px-5">
        <div><h1 className="font-display text-2xl font-bold">Tasks</h1><p className="text-xs text-muted">AI実行オーケストレーター</p></div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Status mode={orchestrator?.mode ?? "stopped"} running={orchestrator?.running_tasks ?? 0} />
          <Action onClick={() => control(orchestrator?.mode === "running" ? "pause" : orchestrator?.mode === "paused" ? "resume" : "start")}>{orchestrator?.mode === "running" ? "一時停止" : orchestrator?.mode === "paused" ? "再開" : "開始"}</Action>
          <Action onClick={() => control("once")}>1回実行</Action>
          <Action onClick={() => control("stop")}>停止</Action>
          <Action onClick={create}>新規</Action>
          <Action onClick={() => setShowImport((value) => !value)}>貼り付けて取り込む</Action>
        </div>
      </header>

      {showImport && <section className="border-b border-base-700 bg-base-850 p-4">
        <label className="block text-xs text-muted" htmlFor="task-import">JSON / Markdown / 親子タスク</label>
        <textarea id="task-import" value={importText} onChange={(event) => setImportText(event.target.value)} className="mono mt-2 h-32 w-full rounded-lg border border-base-700 bg-base-900 p-3 text-xs outline-none focus:border-accent" />
        {importPreview && <div className="mt-2 rounded-lg border border-base-700 bg-base-900 p-2 text-xs text-text2"><span className="font-semibold">取込プレビュー:</span> {importPreview.format} / {importPreview.count}件 — {importPreview.titles.join("、")}</div>}
        <div className="mt-2 flex gap-2"><Action onClick={importTasks} disabled={!importPreview}>この内容を登録</Action><Action onClick={() => setShowImport(false)}>閉じる</Action></div>
      </section>}

      <div className="grid min-h-[calc(100vh-102px)] xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 overflow-x-auto border-b border-base-700 p-4 xl:border-b-0 xl:border-r">
          <div className="grid min-w-[1120px] grid-cols-7 gap-2">
            {TASK_COLUMNS.map((column) => <div key={column.label} className="min-w-0">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-text2"><span>{column.label}</span><span className="text-muted">{tasksForColumn(tasks, column.statuses).length}</span></div>
              <div className="space-y-2">
                {tasksForColumn(tasks, column.statuses).map((task) => <button key={task.task_id} onClick={() => { setSelectedId(task.task_id); setRoute(null); setLogs([]); }} className={`w-full rounded-lg border p-2 text-left ${selectedId === task.task_id ? "border-accent-border bg-accent-dim" : "border-base-700 bg-base-850 hover:border-base-600"}`}>
                  <div className="line-clamp-2 text-xs font-semibold">{task.title}</div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-muted"><span>{task.worker_type ?? "unrouted"}</span><span>{task.task_priority}</span></div>
                  <div className="mt-1 flex items-center justify-between text-[10px]"><span className={task.error_message ? "text-down" : "text-muted"}>{task.error_message ? "error" : `risk ${task.risk_score.toFixed(1)}`}</span><span className="text-muted">{task.attempt_count}/{task.max_attempts}</span></div>
                </button>)}
              </div>
            </div>)}
          </div>
        </section>

        <aside className="overflow-y-auto bg-base-850 p-4">
          <div className="mb-3 flex items-center gap-2"><h2 className="font-semibold">{draft.task_id ? "タスク詳細" : "新規タスク"}</h2><span className="mono ml-auto text-[10px] text-muted">{draft.task_id || "未保存"}</span></div>
          <TextField label="タイトル" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
          <div className="grid grid-cols-2 gap-2"><SelectField label="状態" value={draft.status} options={["DRAFT","READY","QUEUED","RUNNING","AI_REVIEW","AWAITING_INPUT","AWAITING_APPROVAL","COMPLETED","FAILED","CANCELLED","ARCHIVED"]} onChange={(status) => setDraft({ ...draft, status: status as TaskCard["status"] })} /><SelectField label="優先度" value={draft.task_priority} options={["LOW","MEDIUM","HIGH","CRITICAL"]} onChange={(task_priority) => setDraft({ ...draft, task_priority: task_priority as TaskCard["task_priority"] })} /></div>
          <TextField label="タスク種別" value={draft.task_type} onChange={(task_type) => setDraft({ ...draft, task_type })} />
          <TextArea label="目的" value={draft.objective} onChange={(objective) => setDraft({ ...draft, objective })} />
          <TextArea label="指示" value={draft.instructions} onChange={(instructions) => setDraft({ ...draft, instructions })} />
          <TextArea label="背景 / Context" value={draft.context} onChange={(context) => setDraft({ ...draft, context })} />
          <TextField label="情報源URL（カンマ区切り）" value={draft.source_urls.join(", ")} onChange={(value) => setDraft({ ...draft, source_urls: split(value) })} />
          <TextField label="依存Task ID（カンマ区切り）" value={draft.dependencies.join(", ")} onChange={(value) => setDraft({ ...draft, dependencies: split(value) })} />
          <TextField label="完了条件（カンマ区切り）" value={draft.acceptance_criteria.join(", ")} onChange={(value) => setDraft({ ...draft, acceptance_criteria: split(value) })} />
          <div className="grid grid-cols-2 gap-2"><SelectField label="ワーカー" value={draft.worker_type ?? ""} options={["","local_llm","codex","work_manual","human","mock"]} onChange={(worker) => setDraft({ ...draft, worker_type: (worker || null) as WorkerType | null })} /><TextField label="モデル" value={draft.requested_model ?? ""} onChange={(requested_model) => setDraft({ ...draft, requested_model: requested_model || null })} /></div>
          <div className="grid grid-cols-3 gap-2"><NumberField label="Risk" value={draft.risk_score} min={0} max={5} onChange={(risk_score) => setDraft({ ...draft, risk_score })} /><NumberField label="最大試行" value={draft.max_attempts} min={1} max={10} onChange={(max_attempts) => setDraft({ ...draft, max_attempts })} /><NumberField label="Timeout秒" value={draft.timeout_seconds} min={10} max={7200} onChange={(timeout_seconds) => setDraft({ ...draft, timeout_seconds })} /></div>
          <div className="mb-3 flex flex-wrap gap-4 text-xs"><Toggle label="自動実行" checked={draft.auto_run} onChange={(auto_run) => setDraft({ ...draft, auto_run })} /><Toggle label="人間承認" checked={draft.requires_human_approval} onChange={(requires_human_approval) => setDraft({ ...draft, requires_human_approval })} /></div>
          <div className="flex flex-wrap gap-2"><Action onClick={save}>保存</Action><Action onClick={preview} disabled={!draft.task_id}>ルート確認</Action><Action onClick={() => run(() => api.taskEnqueue(draft.task_id), "実行待ちへ移動しました。") } disabled={!draft.task_id}>実行待ちへ</Action><Action onClick={() => run(() => api.taskRunNow(draft.task_id), "実行を開始しました。") } disabled={!draft.task_id}>今すぐ実行</Action><Action onClick={() => run(() => api.taskCancel(draft.task_id), "キャンセルしました。") } disabled={!draft.task_id}>キャンセル</Action><Action onClick={() => run(() => api.taskRetry(draft.task_id), "再試行待ちへ移動しました。") } disabled={!draft.task_id}>再試行</Action></div>
          <div className="mt-2 flex flex-wrap gap-2"><Action disabled={!draft.task_id} onClick={() => requestApproval({ title: "タスク承認", body: "承認後、自動実行待ちへ移動します。", target: draft.task_id, risk: draft.risk_score, approve: () => run(() => api.taskApprove(draft.task_id), "承認しました。") })}>承認</Action><Action disabled={!draft.task_id} onClick={() => requestApproval({ title: "タスク差し戻し", body: "タスクをキャンセル状態へ移動します。", target: draft.task_id, risk: draft.risk_score, approve: () => run(() => api.taskReject(draft.task_id), "差し戻しました。") })}>差し戻し</Action><Action disabled={!draft.task_id} onClick={() => run(() => api.taskArchive(draft.task_id), "アーカイブしました。")}>アーカイブ</Action></div>

          {route && <section className="mt-4 rounded-lg border border-accent-border bg-accent-dim p-3 text-xs"><h3 className="font-semibold text-accent">ルートプレビュー</h3><dl className="mt-2 grid grid-cols-[110px_1fr] gap-1"><dt>Worker</dt><dd>{route.worker_type}</dd><dt>Model</dt><dd>{route.model ?? "none"}</dd><dt>Reasoning</dt><dd>{route.reasoning}</dd><dt>規模</dt><dd>{route.estimated_size}</dd><dt>理由</dt><dd>{route.reason}</dd><dt>承認</dt><dd>{route.requires_human_approval ? "必要" : "不要"}</dd></dl></section>}

          <section className="mt-4"><h3 className="mb-2 text-xs font-semibold text-text2">実行ログ</h3><pre className="mono max-h-40 overflow-auto rounded-lg border border-base-700 bg-base-900 p-2 text-[10px] text-text2">{logs.length ? logs.join("\n") : "ログはまだありません。"}</pre></section>
          <section className="mt-4"><h3 className="mb-2 text-xs font-semibold text-text2">成果物</h3><div className="flex flex-wrap gap-2">{artifacts.map((artifact) => <Action key={artifact.artifact_id} onClick={async () => setArtifactText(await api.taskArtifactRead(artifact.task_id, artifact.path))}>{artifact.kind}</Action>)}<Action disabled={!draft.task_id} onClick={() => api.taskArtifactOpen(draft.task_id)}>作業フォルダを開く</Action></div>{artifactText && <><pre className="mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-base-700 bg-base-900 p-3 text-xs text-text2">{artifactText}</pre><div className="mt-2 flex gap-2"><Action onClick={() => navigator.clipboard.writeText(artifactText)}>ChatGPT最終確認用にコピー</Action><Action onClick={() => navigator.clipboard.writeText(artifactText)}>Work用指示をコピー</Action></div></>}</section>
        </aside>
      </div>
    </div>
  );
}

function split(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function Status({ mode, running }: { mode: string; running: number }) { return <span className={`rounded-md px-2 py-1 text-xs ${mode === "running" ? "bg-ok/20 text-ok" : mode === "paused" ? "bg-warn/20 text-warn" : "bg-base-700 text-muted"}`}>{mode} / {running}</span>; }
function Action({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void | Promise<void>; disabled?: boolean }) { return <button type="button" onClick={() => void onClick?.()} disabled={disabled} className="rounded-lg border border-base-600 px-3 py-1.5 text-xs font-semibold text-text1 hover:border-accent-border hover:bg-base-800 disabled:opacity-40">{children}</button>; }
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="mb-2 block text-xs text-muted">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="mono mt-1 w-full rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-sm text-text1 outline-none focus:border-accent" /></label>; }
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="mb-2 block text-xs text-muted">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} className="mono mt-1 h-20 w-full rounded-lg border border-base-700 bg-base-900 p-2 text-xs text-text1 outline-none focus:border-accent" /></label>; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="mb-2 block text-xs text-muted">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-base-700 bg-base-900 px-2 py-2 text-xs text-text1">{options.map((option) => <option key={option} value={option}>{option || "自動"}</option>)}</select></label>; }
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) { return <label className="mb-2 block text-xs text-muted">{label}<input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-base-700 bg-base-900 px-2 py-2 text-xs text-text1" /></label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="inline-flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>; }
