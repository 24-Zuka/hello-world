import { useEffect, useState } from "react";

import { api, isTauri } from "../lib/api";
import * as bridge from "../lib/bridge";
import { listen, startBackgroundTicks } from "../lib/events";
import type {
  AppSettings,
  AuthStatus,
  Health,
  Job,
  McpServer,
  Quota,
  ScheduleJob,
  SearchHit,
  TaskCard,
  VaultNode,
  Worktree,
} from "../types";

type Screen = "dashboard" | "agents" | "build" | "memory" | "schedule" | "research" | "quota" | "settings";
type Toast = { id: number; level: "info" | "warn" | "error"; title: string; body: string };
type Approval = {
  title: string;
  body: string;
  target: string;
  risk: number;
  approve: () => Promise<void> | void;
};

const NAV: { id: Screen; label: string; jp: string; group: "管制" | "運用" }[] = [
  { id: "dashboard", label: "Dashboard", jp: "司令室", group: "管制" },
  { id: "agents", label: "Agents", jp: "組織図", group: "管制" },
  { id: "build", label: "Build", jp: "開発パイプライン", group: "管制" },
  { id: "memory", label: "Memory", jp: "記憶 / Vault", group: "管制" },
  { id: "schedule", label: "Schedule", jp: "定時運用", group: "運用" },
  { id: "research", label: "Research", jp: "調査", group: "運用" },
  { id: "quota", label: "Quota & Cost", jp: "コスト管制", group: "運用" },
  { id: "settings", label: "Settings", jp: "設定", group: "運用" },
];

const AGENTS = [
  ["秘書AI", "受付・割当・品質確認", "Codex", "Tier3", "approval"],
  ["開発AI", "実装・検証・差分作成", "Codex", "Tier3", "solo"],
  ["レビューAI", "ローカルレビュー・危険検知", "LM Studio", "Tier1", "solo"],
  ["調査AI", "情報収集・要約・Inbox化", "Gemini / LM Studio", "Tier2", "solo"],
  ["運用AI", "朝礼・launchd・ループ運用", "LM Studio", "Tier2", "solo"],
  ["戦略AI", "方針整理・判断材料作成", "Codex", "Tier2", "approval"],
] as const;

let toastSeq = 1;

export function AirFlowApp() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [palette, setPalette] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [transport, setTransport] = useState<"tauri" | "bridge" | "mock">("mock");

  const [health, setHealth] = useState<Health | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});

  const toast = (t: Omit<Toast, "id">) => setToasts((cur) => [...cur, { ...t, id: toastSeq++ }]);
  const reloadSettings = async () => setSettings(await api.settingsGet());
  const refreshTasks = async () => setTasks(await api.taskList());

  useEffect(() => {
    let alive = true;
    const init = async () => {
      if (!isTauri()) await bridge.autoConnect();
      const nextTransport = isTauri() ? "tauri" : bridge.isBridgeActive() ? "bridge" : "mock";
      if (!alive) return;
      setTransport(nextTransport);
      const [h, q, a, s, t] = await Promise.all([
        api.healthCheck(),
        api.quotaStatus(),
        api.codexAuthStatus(),
        api.settingsGet(),
        api.taskList(),
      ]);
      if (!alive) return;
      setHealth(h);
      setQuota(q);
      setAuth(a);
      setSettings(s);
      setTasks(t);
      startBackgroundTicks();
      await listen<Health>("health:tick", setHealth);
      await listen<Quota>("quota:tick", setQuota);
      await listen<{ jobId: string; line: string }>("job:log", (e) =>
        setJobs((cur) => {
          const job = cur[e.jobId] ?? { id: e.jobId, kind: "build", status: "running", logs: [] as string[] };
          return { ...cur, [e.jobId]: { ...job, logs: [...job.logs, e.line] } };
        }),
      );
      await listen<{ jobId: string; exitCode: number }>("job:done", (e) =>
        setJobs((cur) => {
          const job = cur[e.jobId] ?? { id: e.jobId, kind: "build", status: "running", logs: [] as string[] };
          return { ...cur, [e.jobId]: { ...job, status: e.exitCode === 0 ? "done" : "error" } };
        }),
      );
      await listen<{ level: string; title: string; body: string }>("notify", (n) =>
        toast({ level: n.level === "error" ? "error" : n.level === "warn" ? "warn" : "info", title: n.title, body: n.body }),
      );
    };
    void init().catch((e) => toast({ level: "error", title: "初期化失敗", body: String(e) }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setApproval(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = {
    screen,
    setScreen,
    health,
    quota,
    auth,
    settings,
    tasks,
    jobs,
    transport,
    toast,
    requestApproval: setApproval,
    reloadSettings,
    refreshTasks,
    setJobs,
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-base-900 text-text1 md:flex-row">
      <aside className="shrink-0 border-b border-base-700 bg-[#080A0D] md:w-[236px] md:border-b-0 md:border-r">
        <div className="flex items-end justify-between px-4 py-3 md:block md:px-5 md:py-6">
          <div className="font-display text-2xl font-bold text-accent">AirFlow</div>
          <div className="hidden text-[11px] uppercase tracking-[0.28em] text-muted sm:block">JARVIS Cockpit</div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:overflow-visible md:pb-0">
          {NAV.map((n, i) => (
            <button
              key={n.id}
              onClick={() => setScreen(n.id)}
              className={`h-10 min-w-[138px] rounded-lg border px-3 text-left text-[13px] transition md:mb-1 md:flex md:w-full md:min-w-0 md:items-center ${
                screen === n.id
                  ? "border-accent-border bg-accent-dim text-text1"
                  : "border-transparent text-text2 hover:border-base-700 hover:bg-base-850"
              }`}
            >
              <span className="mono mr-3 text-accent">{String(i + 1).padStart(2, "0")}</span>
              <span>{n.label}</span>
              <span className="hidden md:ml-auto md:inline text-[10px] text-muted">{n.jp}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setPalette(true)}
          className="m-2 hidden w-[calc(100%-1rem)] rounded-lg border border-base-700 px-3 py-2 text-xs text-muted hover:border-accent-border hover:text-text1 md:block"
        >
          ⌘K コマンドパレット
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <HealthRail health={health} transport={transport} note={health?.note} />
        <div className="flex-1 overflow-auto">
          {screen === "dashboard" && <Dashboard {...ctx} />}
          {screen === "agents" && <Agents />}
          {screen === "build" && <Build {...ctx} />}
          {screen === "memory" && <Memory {...ctx} />}
          {screen === "schedule" && <Schedule {...ctx} />}
          {screen === "research" && <Research {...ctx} />}
          {screen === "quota" && <QuotaScreen {...ctx} />}
          {screen === "settings" && <SettingsScreen {...ctx} />}
        </div>
      </main>

      {palette && <CommandPalette setScreen={setScreen} close={() => setPalette(false)} />}
      {approval && <ApprovalModal approval={approval} close={() => setApproval(null)} />}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-lg border bg-base-850 px-4 py-3 shadow-xl ${toastClass(t.level)}`}>
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>{t.title}</span>
              <button onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))} className="text-muted hover:text-text1">
                x
              </button>
            </div>
            <p className="mt-1 text-xs text-text2">{t.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthRail({ health, transport, note }: { health: Health | null; transport: string; note?: string | null }) {
  return (
    <div className="flex min-h-[42px] items-center gap-4 overflow-x-auto border-b border-base-700 bg-base-850 px-4 text-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Health</span>
      <HealthPill label="Codex" status={health?.codex ?? "unknown"} />
      <HealthPill label="LM Studio" status={health?.lmstudio ?? "unknown"} />
      <HealthPill label="Obsidian" status={health?.obsidian ?? "unknown"} />
      {note && <span className="ml-auto hidden whitespace-nowrap text-xs text-warn lg:inline">{note}</span>}
      <span className="rounded-full border border-base-700 bg-base-900 px-3 py-0.5 text-[11px] text-muted">{transport}</span>
    </div>
  );
}

function HealthPill({ label, status }: { label: string; status: string }) {
  const color = status === "ok" ? "bg-ok" : status === "warn" ? "bg-warn" : status === "down" ? "bg-down" : "bg-muted";
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-text2">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Header({ title, jp, children }: { title: string; jp: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-[58px] items-center gap-3 border-b border-base-700 px-4 py-3 md:px-5">
      <h1 className="font-display text-2xl font-bold md:text-[26px]">{title}</h1>
      <span className="text-[11px] text-muted">{jp}</span>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

function Dashboard({ tasks, quota, settings, setScreen, jobs, toast }: typeof ctxShape) {
  const today = tasks.filter((t) => t.status === "Today" || t.status === "Doing");
  const waiting = tasks.filter((t) => t.status === "Waiting" || t.decision_required);
  const active = Object.values(jobs).filter((j) => j.status === "running").length;
  return (
    <div>
      <Header title="Dashboard" jp="司令室">
        <Pill tone={waiting.length ? "warn" : "ok"}>要判断 {waiting.length}</Pill>
        <Pill tone={tasks.some((t) => t.risk_score >= 3) ? "down" : "muted"}>{`risk>=3.0 ${tasks.filter((t) => t.risk_score >= 3).length}`}</Pill>
      </Header>
      <div className="grid gap-4 p-4 xl:grid-cols-12 xl:p-6">
        <Metric label="Today" value={today.length} tone="accent" />
        <Metric label="Doing" value={tasks.filter((t) => t.status === "Doing").length} tone="ok" />
        <Metric label="Waiting" value={waiting.length} tone="warn" />
        <Metric label="Threads" value={`${active}/4`} tone="muted" />
        <Panel title="Plus残量（5h ウィンドウ）" className="xl:col-span-3">
          <QuotaDial quota={quota} />
          <Button onClick={() => toast({ level: "info", title: "退避モード", body: settings?.retreat_mode ? "解除はQuotaで実行します。" : "Quotaでローカル退避を有効化できます。" })}>
            ローカルへ退避
          </Button>
        </Panel>
        <Panel title="今日の要判断" className="xl:col-span-4">
          <div className="space-y-2">
            {waiting.map((t) => <TaskCardView key={t.task_id} task={t} />)}
            {!waiting.length && <Empty title="要判断はありません" hint="risk_score >= 3.0 または decision_required のチケットがここに並びます。" />}
          </div>
        </Panel>
        <Panel title="AirFlowタスクボード" className="xl:col-span-5">
          <div className="grid gap-2">
            {tasks.map((t) => <TaskCardView key={t.task_id} task={t} />)}
          </div>
        </Panel>
        <Panel title="クイックアクション" className="xl:col-span-12">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setScreen("schedule")}>朝会を今すぐ</Button>
            <Button onClick={() => setScreen("build")}>レビュー実行</Button>
            <Button onClick={() => setScreen("research")}>調査スキャン</Button>
            <Button onClick={() => setScreen("memory")}>Vaultを開く</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Agents() {
  return (
    <div>
      <Header title="Agents" jp="組織図" />
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px] xl:p-6">
        <Panel title="AI社員構成">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {AGENTS.map(([name, role, model, tier, auth]) => (
              <div key={name} className="rounded-xl border border-base-700 bg-base-900 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{name}</div>
                  <Pill tone={auth === "approval" ? "warn" : "ok"}>{auth === "approval" ? "要承認" : "単独可"}</Pill>
                </div>
                <p className="mt-2 text-sm text-text2">{role}</p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                  <span>{model}</span>
                  <span>{tier}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="運用原則">
          <ul className="space-y-3 text-sm text-text2">
            <li>社長 → 秘書AI → AI社員 → 秘書AIチェック → 社長へ提示。</li>
            <li>AI社員は直接納品せず、秘書AIが統合・品質確認する。</li>
            <li>1つのAIへ全文脈を混ぜず、必要範囲だけ読む。</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Build({ jobs, setJobs, requestApproval, toast }: typeof ctxShape) {
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selected, setSelected] = useState("");
  const [prompt, setPrompt] = useState("AirFlow完全版仕様書に従って、対象画面を実装・検証する");
  const [activeJob, setActiveJob] = useState("");
  const [diff, setDiff] = useState("");

  useEffect(() => {
    api.worktreeList("hello-world").then((w) => {
      setWorktrees(w);
      setSelected(w[0]?.path ?? "");
    }).catch(() => setWorktrees([]));
  }, []);

  const start = async (kind: "build" | "review") => {
    const id = kind === "build" ? await api.codexBuild(selected, prompt) : await api.localReview(selected, "main");
    setJobs((cur) => ({ ...cur, [id]: { id, kind, status: "running", logs: [] } }));
    setActiveJob(id);
  };

  const merge = () => requestApproval({
    title: "mainへのマージ",
    body: "mainブランチを更新します。不可逆に近い操作のため人間承認が必要です。",
    target: selected || "未選択",
    risk: 3.5,
    approve: async () => {
      await api.gitMerge(selected, "main");
      toast({ level: "info", title: "マージ完了", body: selected });
    },
  });

  return (
    <div>
      <Header title="Build" jp="開発パイプライン"><Pill tone="muted">並列 {Object.values(jobs).filter((j) => j.status === "running").length}/4</Pill></Header>
      <div className="grid gap-4 p-4 xl:grid-cols-2 xl:p-6">
        <Panel title="Worktree / 実行">
          <div className="space-y-2">
            {worktrees.map((w) => (
              <button key={w.path} onClick={() => setSelected(w.path)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selected === w.path ? "border-accent-border bg-accent-dim" : "border-base-700 bg-base-900"}`}>
                <span className="mono">{w.branch}</span><span className="float-right text-muted">{w.dirty ? "dirty" : "clean"}</span>
              </button>
            ))}
            {!worktrees.length && <Empty title="worktree未接続" hint="BridgeまたはDesktopで実リポジトリへ接続すると一覧が出ます。DemoではMockへ縮退します。" />}
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mono h-28 w-full rounded-lg border border-base-700 bg-base-900 p-3 text-xs outline-none focus:border-accent" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => start("build")} disabled={!selected}>codex build</Button>
              <Button onClick={() => start("review")} disabled={!selected}>local review</Button>
              <Button onClick={async () => setDiff(await api.gitDiff(selected, "main"))} disabled={!selected}>diff</Button>
              <Button danger onClick={merge} disabled={!selected}>main merge</Button>
            </div>
          </div>
        </Panel>
        <Panel title="ストリーミングログ">
          <Log job={jobs[activeJob]} />
          {diff && <pre className="mono mt-3 max-h-52 overflow-auto rounded-lg border border-base-700 bg-[#0A0D12] p-3 text-xs text-text2">{diff}</pre>}
        </Panel>
      </div>
    </div>
  );
}

function Memory({ requestApproval, toast }: typeof ctxShape) {
  const [tree, setTree] = useState<VaultNode[]>([]);
  const [path, setPath] = useState("AI_Handoff.md");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => { api.vaultTree().then(setTree).catch(() => setTree([])); }, []);
  useEffect(() => { api.vaultRead(path).then(setContent).catch(() => setContent("")); }, [path]);

  const save = () => {
    const run = async () => {
      await api.vaultWrite(path, content, "replace");
      toast({ level: "info", title: "保存", body: path });
    };
    if (path === "MEMORY.md") requestApproval({ title: "MEMORY上書き", body: "共有記憶の中核を上書きします。", target: path, risk: 3, approve: run });
    else void run();
  };

  return (
    <div>
      <Header title="Memory" jp="記憶 / Vault" />
      <div className="grid gap-4 p-4 xl:grid-cols-[260px_1fr_300px] xl:p-6">
        <Panel title="Vault Tree">
          <Tree nodes={tree} select={setPath} selected={path} />
        </Panel>
        <Panel title={path}>
          <div className="grid gap-3 lg:grid-cols-2">
            <textarea value={content} onChange={(e) => setContent(e.target.value)} className="mono h-[520px] w-full resize-none rounded-lg border border-base-700 bg-base-900 p-3 text-xs text-text2 outline-none focus:border-accent" />
            <div className="h-[520px] overflow-auto rounded-lg border border-base-700 bg-base-900 p-4">
              {isTimelineNote(path) ? <TimelinePreview content={content} /> : <MarkdownPreview content={content} />}
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <Button onClick={save}>保存</Button>
            <Button danger onClick={() => requestApproval({ title: "ノート削除", body: "ゴミ箱経由で削除します。", target: path, risk: 3, approve: async () => api.vaultDelete(path) })}>削除</Button>
          </div>
        </Panel>
        <Panel title="検索">
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-sm outline-none focus:border-accent" placeholder="Vault全文検索" />
          <Button onClick={async () => setHits(await api.vaultSearch(query))} disabled={!query.trim()}>検索</Button>
          <div className="mt-3 space-y-2">{hits.map((h) => <div key={h.path} className="rounded border border-base-700 p-2 text-xs"><b>{h.path}</b><p className="text-text2">{h.snippet}</p></div>)}</div>
        </Panel>
      </div>
    </div>
  );
}

function Schedule({ jobs, setJobs, toast }: typeof ctxShape) {
  const [list, setList] = useState<ScheduleJob[]>([]);
  const [active, setActive] = useState("");
  const [time, setTime] = useState("07:30");
  useEffect(() => { api.launchdList().then(setList).catch(() => setList([])); }, []);
  const run = async (j: ScheduleJob) => {
    const id = await api.launchdRunNow(j.label);
    setJobs((cur) => ({ ...cur, [id]: { id, kind: "morning", status: "running", logs: [] } }));
    setActive(id);
  };
  const toggle = async (j: ScheduleJob) => {
    await api.launchdToggle(j.label, !j.loaded);
    setList((cur) => cur.map((x) => x.label === j.label ? { ...x, loaded: !x.loaded } : x));
  };
  const saveTime = async (j: ScheduleJob) => {
    const [hour, minute] = time.split(":").map((v) => Number(v));
    await api.launchdSetTime(j.label, Number.isFinite(hour) ? hour : 7, Number.isFinite(minute) ? minute : 30);
    toast({ level: "info", title: "時刻設定", body: `${j.label} を ${time} に設定しました。` });
  };
  return (
    <div>
      <Header title="Schedule" jp="定時運用" />
      <div className="grid gap-4 p-4 xl:grid-cols-2 xl:p-6">
        <Panel title="launchd jobs">
          <div className="space-y-2">{list.map((j) => <div key={j.label} className="rounded-lg border border-base-700 bg-base-900 p-3"><div className="flex justify-between"><span className="mono">{j.label}</span><Pill tone={j.loaded ? "ok" : "muted"}>{j.loaded ? "loaded" : "off"}</Pill></div><div className="mt-2 grid gap-2 text-xs text-text2 sm:grid-cols-[1fr_auto]"><div>next: {j.next_run ?? "不明"} / last: {j.last_result ?? "未実行"}</div><button onClick={() => toggle(j)} className={`rounded-full border px-3 py-1 text-[11px] ${j.loaded ? "border-ok/40 text-ok" : "border-base-600 text-muted"}`}>{j.loaded ? "unload" : "load"}</button></div><div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => run(j)}>今すぐ実行</Button><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-lg border border-base-700 bg-base-900 px-2 py-1 text-xs text-text2 outline-none focus:border-accent" /><Button onClick={() => saveTime(j)}>時刻保存</Button></div></div>)}</div>
          {!list.length && <Empty title="launchd未接続" hint="Bridge/Desktopで `launchctl list` を読めるとここに表示されます。" />}
        </Panel>
        <Panel title="最終ログ"><Log job={jobs[active]} /></Panel>
      </div>
    </div>
  );
}

function Research({ jobs, setJobs, toast }: typeof ctxShape) {
  const [topic, setTopic] = useState("最新AIエージェント運用");
  const [active, setActive] = useState("");
  const [note, setNote] = useState("");
  const scan = async () => {
    const id = await api.researchScan(topic);
    setJobs((cur) => ({ ...cur, [id]: { id, kind: "research", status: "running", logs: [] } }));
    setActive(id);
  };
  return (
    <div>
      <Header title="Research" jp="調査" />
      <div className="grid gap-4 p-4 xl:grid-cols-2 xl:p-6">
        <Panel title="自動スキャン / 手動取込">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} className="w-full rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-sm outline-none focus:border-accent" />
          <div className="mt-2 flex flex-wrap gap-2"><Button onClick={scan}>スキャン実行</Button><a className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-accent" href="https://gemini.google.com/" target="_blank" rel="noreferrer">Gemini Deep Research</a><a className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-accent" href="https://notebooklm.google.com/" target="_blank" rel="noreferrer">NotebookLM</a></div>
          <p className="mt-2 text-xs text-warn">外部サービスは自動化不可。結果だけInboxへ取り込みます。</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="mono mt-3 h-40 w-full rounded-lg border border-base-700 bg-base-900 p-3 text-xs outline-none focus:border-accent" placeholder="調査結果Markdown" />
          <Button onClick={async () => { await api.vaultWrite(`00_Inbox/research_${Date.now()}.md`, note, "replace"); toast({ level: "info", title: "Inbox取込", body: "調査結果を保存しました。" }); setNote(""); }} disabled={!note.trim()}>Inboxへ取込</Button>
        </Panel>
        <Panel title="スキャンログ"><Log job={jobs[active]} /></Panel>
      </div>
    </div>
  );
}

function QuotaScreen({ quota, auth, settings, reloadSettings, requestApproval, toast }: typeof ctxShape) {
  const apiKeyFlag = !!settings?.openai_api_key_present || auth?.method === "api";
  return (
    <div>
      <Header title="Quota & Cost" jp="コスト管制"><Pill tone={apiKeyFlag ? "down" : "ok"}>{apiKeyFlag ? "赤旗" : "課金ゼロ"}</Pill></Header>
      <div className="grid gap-4 p-4 xl:grid-cols-3 xl:p-6">
        <Panel title="5hウィンドウ"><QuotaDial quota={quota} /></Panel>
        <Panel title="認証経路"><div className={`rounded-lg border p-3 ${apiKeyFlag ? "border-down bg-down/10" : "border-ok/40 bg-ok/10"}`}><b>{apiKeyFlag ? "従量課金系APIキーを検出" : "APIキー未検出"}</b><p className="mt-1 text-xs text-text2">{settings?.detected_api_keys?.join(", ") || "ChatGPTログイン経路のみを使います。"}</p></div></Panel>
        <Panel title="課金ポリシー"><div className="space-y-2 text-sm"><Row k="クレジット購入" v="無効固定" tone="down" /><Row k="APIキー入力欄" v="存在させない" tone="ok" /><Row k="退避モード" v={settings?.retreat_mode ? "ON" : "OFF"} tone={settings?.retreat_mode ? "warn" : "muted"} /></div><Button onClick={async () => { await api.settingsSet({ retreat_mode: !settings?.retreat_mode }); await reloadSettings(); }}>退避モード切替</Button></Panel>
        <Panel title="既定モデル" className="xl:col-span-3">
          <div className="flex flex-wrap gap-2">{["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"].map((m) => <Button key={m} onClick={() => requestApproval({ title: "既定モデル変更", body: `${m} へ切り替えます。`, target: m, risk: 2, approve: async () => { await api.configSetModel(m); await reloadSettings(); toast({ level: "info", title: "モデル変更", body: m }); } })}>{m}</Button>)}</div>
        </Panel>
      </div>
    </div>
  );
}

function SettingsScreen({ settings, health, transport, reloadSettings, toast, refreshTasks }: typeof ctxShape) {
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [token, setToken] = useState("");
  const [bridgeUrl, setBridgeUrl] = useState(bridge.getBridgeConfig().url || "http://127.0.0.1:8787");
  const [bridgeToken, setBridgeToken] = useState("");
  const [mcp, setMcp] = useState<McpServer[]>([]);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => { api.mcpList().then(setMcp).catch(() => setMcp([])); }, []);
  const toggleMcp = async (server: McpServer) => {
    await api.mcpToggle(server.name, !server.enabled);
    setMcp((cur) => cur.map((s) => s.name === server.name ? { ...s, enabled: !s.enabled } : s));
  };
  return (
    <div>
      <Header title="Settings" jp="設定"><Pill tone={transport === "mock" ? "muted" : "ok"}>{transport}</Pill></Header>
      <div className="grid gap-4 p-4 xl:grid-cols-2 xl:p-6">
        {!isTauri() && <Panel title="Bridge接続"><Field label="URL" value={bridgeUrl} onChange={setBridgeUrl} /><Field label="Token" value={bridgeToken} onChange={setBridgeToken} password /><Button onClick={async () => { const ok = await bridge.connectBridge(bridgeUrl, bridgeToken); toast({ level: ok ? "info" : "warn", title: "Bridge", body: ok ? "接続しました。再読込します。" : "接続できません。" }); if (ok) setTimeout(() => location.reload(), 500); }} disabled={!bridgeToken}>接続</Button></Panel>}
        <Panel title="パス">
          <Field label="AirFlow Store" value={draft?.airflow_store_path ?? ""} onChange={(v) => setDraft((d) => d && { ...d, airflow_store_path: v })} />
          <Field label="Vault" value={draft?.vault_path ?? ""} onChange={(v) => setDraft((d) => d && { ...d, vault_path: v })} />
          <Field label="Repos parent" value={draft?.repos_parent ?? ""} onChange={(v) => setDraft((d) => d && { ...d, repos_parent: v })} />
          <Field label="Scripts" value={draft?.scripts_path ?? ""} onChange={(v) => setDraft((d) => d && { ...d, scripts_path: v })} />
          <Field label="Workspace root" value={draft?.workspace_root ?? ""} onChange={(v) => setDraft((d) => d && { ...d, workspace_root: v })} />
          <Button onClick={async () => { if (draft) await api.settingsSet(draft); await reloadSettings(); await refreshTasks(); toast({ level: "info", title: "設定保存", body: "Storeとパス設定を更新しました。" }); }}>保存</Button>
          <p className="mt-2 text-xs text-text2">Storeは `tickets/*.md` のYAML frontmatterを読み、タスクボードへ反映します。</p>
        </Panel>
        <Panel title="接続 / 疎通">
          <Field label="LM Studio Endpoint" value={draft?.lmstudio_endpoint ?? ""} onChange={(v) => setDraft((d) => d && { ...d, lmstudio_endpoint: v })} />
          <Field label="Obsidian Endpoint" value={draft?.obsidian_endpoint ?? ""} onChange={(v) => setDraft((d) => d && { ...d, obsidian_endpoint: v })} />
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-3"><Row k="Codex" v={health?.codex ?? "unknown"} tone={health?.codex === "ok" ? "ok" : health?.codex === "warn" ? "warn" : "muted"} /><Row k="LM Studio" v={health?.lmstudio ?? "unknown"} tone={health?.lmstudio === "ok" ? "ok" : health?.lmstudio === "warn" ? "warn" : "muted"} /><Row k="Obsidian" v={health?.obsidian ?? "unknown"} tone={health?.obsidian === "ok" ? "ok" : health?.obsidian === "warn" ? "warn" : "muted"} /></div>
          <div className="flex flex-wrap gap-2"><Button onClick={async () => { await api.healthCheck(); toast({ level: "info", title: "疎通テスト", body: "ヘルスチェックを実行しました。" }); }}>疎通テスト</Button><Button onClick={async () => { await api.codexLogin(); toast({ level: "info", title: "codex login", body: "ログイン処理を開始しました。" }); }}>codex login</Button></div>
        </Panel>
        <Panel title="Keychain"><Field label="Obsidian Token" value={token} onChange={setToken} password /><Button onClick={async () => { await api.secretSet("obsidian", token); setToken(""); toast({ level: "info", title: "Keychain", body: "保存しました。" }); }} disabled={!token}>保存</Button><p className="mt-2 text-xs text-text2">APIキー欄は作りません。秘密はKeychainだけに保存します。</p></Panel>
        <Panel title="MCP"><div className="space-y-2">{mcp.map((s) => <div key={s.name} className="grid gap-2 rounded border border-base-700 p-2 text-sm sm:grid-cols-[1fr_auto_auto]"><span className="mono">{s.name}</span><span className="text-xs text-muted">{s.transport}</span><button onClick={() => toggleMcp(s)} className={`rounded-full border px-3 py-1 text-[11px] ${s.enabled ? "border-ok/40 text-ok" : "border-base-600 text-muted"}`}>{s.enabled ? "on" : "off"}</button></div>)}</div></Panel>
      </div>
    </div>
  );
}

const ctxShape = {} as {
  screen: Screen;
  setScreen: (s: Screen) => void;
  health: Health | null;
  quota: Quota | null;
  auth: AuthStatus | null;
  settings: AppSettings | null;
  tasks: TaskCard[];
  jobs: Record<string, Job>;
  transport: "tauri" | "bridge" | "mock";
  toast: (t: Omit<Toast, "id">) => void;
  requestApproval: (a: Approval) => void;
  reloadSettings: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  setJobs: React.Dispatch<React.SetStateAction<Record<string, Job>>>;
};

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-base-700 bg-base-850 ${className}`}><div className="border-b border-base-700 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-text2">{title}</div><div className="p-4">{children}</div></section>;
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: "accent" | "ok" | "warn" | "muted" }) {
  const cls = tone === "accent" ? "text-accent" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-muted";
  return <div className="rounded-xl border border-base-700 bg-base-850 p-4 xl:col-span-3"><div className="text-[10px] uppercase tracking-[0.13em] text-muted">{label}</div><div className={`font-display text-3xl font-bold ${cls}`}>{value}</div></div>;
}

function TaskCardView({ task }: { task: TaskCard }) {
  const cat = task.category === "Engineering" ? "text-teal bg-teal/10 border-teal/30" : task.category === "Content" ? "text-warn bg-warn/10 border-warn/30" : "text-accent bg-accent-dim border-accent-border";
  return <div className="rounded-lg border border-base-700 bg-base-900 p-3"><div className="flex items-center gap-2"><span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${cat}`}>{task.category}</span><Pill tone={task.status === "Waiting" ? "warn" : task.status === "Doing" ? "ok" : task.status === "Today" ? "accent" : "muted"}>{task.status}</Pill><span className="mono ml-auto text-[11px] text-muted">{task.id}</span></div><div className="mt-2 text-sm font-semibold">{task.title}</div><div className="mt-1 flex gap-3 text-[11px] text-muted"><span className="mono">risk {task.risk_score.toFixed(1)}</span><span>priority {task.priority}</span><span>{task.assignee}</span>{task.decision_required && <span className="ml-auto text-warn">要判断</span>}</div></div>;
}

function QuotaDial({ quota }: { quota: Quota | null }) {
  const unknown = !quota || quota.source === "unknown" || quota.window_limit <= 0;
  const pct = unknown ? 0 : Math.round((quota.window_used / quota.window_limit) * 100);
  return <div className="flex flex-col items-center justify-center py-4"><div className="flex h-36 w-36 items-center justify-center rounded-full border-[12px] border-base-800"><div className="text-center"><div className="font-display text-3xl font-bold text-muted">{unknown ? "不明" : `${pct}%`}</div><div className="text-[10px] text-muted">{unknown ? "公式API無し" : "5h window"}</div></div></div><p className="mt-4 text-xs text-text2">{unknown ? "残量を取得できません" : "取得済み"}</p></div>;
}

function Button({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  return <button disabled={disabled} onClick={onClick} className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${danger ? "border border-down/50 text-down hover:bg-down/10" : "border border-base-600 text-text1 hover:border-accent-border hover:bg-base-800"}`}>{children}</button>;
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "muted" | "ok" | "warn" | "down" | "accent" }) {
  const cls = tone === "ok" ? "bg-ok/20 text-ok" : tone === "warn" ? "bg-warn/20 text-warn" : tone === "down" ? "bg-down/20 text-down" : tone === "accent" ? "bg-accent/20 text-accent" : "bg-base-700 text-muted";
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function Row({ k, v, tone }: { k: string; v: string; tone: "muted" | "ok" | "warn" | "down" }) {
  return <div className="flex items-center justify-between"><span className="text-text2">{k}</span><Pill tone={tone}>{v}</Pill></div>;
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return <div className="rounded-lg border border-dashed border-base-700 p-5 text-center"><div className="font-semibold">{title}</div><p className="mt-1 text-xs text-text2">{hint}</p></div>;
}

function Log({ job }: { job?: Job }) {
  if (!job) return <Empty title="ジョブ未実行" hint="実行すると JSONL ログがここに逐次表示されます。" />;
  return <div className="mono h-[420px] overflow-auto rounded-lg border border-base-700 bg-[#0A0D12] p-3 text-xs text-text2">{job.logs.map((l, i) => <div key={i}>{l}</div>)}</div>;
}

function Tree({ nodes, select, selected, depth = 0 }: { nodes: VaultNode[]; select: (p: string) => void; selected: string; depth?: number }) {
  return <div className="space-y-1">{nodes.map((n) => n.type === "note" ? <button key={n.path} onClick={() => select(n.path)} style={{ paddingLeft: 8 + depth * 12 }} className={`block w-full truncate rounded px-2 py-1 text-left text-sm ${selected === n.path ? "bg-accent-dim text-text1" : "text-text2 hover:bg-base-900"}`}>{n.path.split("/").pop()}</button> : <div key={n.path}><div style={{ paddingLeft: 8 + depth * 12 }} className="text-[11px] uppercase tracking-wide text-muted">{n.path}</div>{n.children && <Tree nodes={n.children} select={select} selected={selected} depth={depth + 1} />}</div>)}</div>;
}

function isTimelineNote(path: string) {
  return /handoff|decision/i.test(path);
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split("\n").slice(0, 160);
  return <div className="space-y-2 text-sm text-text2">{lines.map((line, i) => {
    if (line.startsWith("# ")) return <h2 key={i} className="font-display text-xl font-bold text-text1">{line.slice(2)}</h2>;
    if (line.startsWith("## ")) return <h3 key={i} className="mt-4 text-sm font-semibold text-text1">{line.slice(3)}</h3>;
    if (line.startsWith("- ")) return <div key={i} className="pl-3 before:mr-2 before:text-accent before:content-['-']">{line.slice(2)}</div>;
    if (!line.trim()) return <div key={i} className="h-2" />;
    return <p key={i}>{line}</p>;
  })}</div>;
}

function TimelinePreview({ content }: { content: string }) {
  const entries = content.split("\n").filter((line) => line.startsWith("## ")).slice(0, 12);
  if (!entries.length) return <Empty title="タイムラインなし" hint="`## 日時 — 送信元 → 宛先` 形式の行がここへ並びます。" />;
  return <div className="space-y-3">{entries.map((entry) => <div key={entry} className="border-l-2 border-accent/50 pl-3"><div className="text-sm font-semibold text-text1">{entry.replace(/^##\s*/, "")}</div><div className="mt-1 text-xs text-muted">Handoff / Decision Log</div></div>)}</div>;
}

function Field({ label, value, onChange, password }: { label: string; value: string; onChange: (v: string) => void; password?: boolean }) {
  return <label className="mb-2 block"><span className="mb-1 block text-xs text-muted">{label}</span><input type={password ? "password" : "text"} value={value} onChange={(e) => onChange(e.target.value)} className="mono w-full rounded-lg border border-base-700 bg-base-900 px-3 py-2 text-sm outline-none focus:border-accent" /></label>;
}

function CommandPalette({ setScreen, close }: { setScreen: (s: Screen) => void; close: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-28" onClick={close}><div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-xl border border-base-700 bg-base-850 shadow-xl"><div className="border-b border-base-700 px-4 py-3 text-sm text-text2">⌘K Command Palette</div>{NAV.map((n) => <button key={n.id} onClick={() => { setScreen(n.id); close(); }} className="flex w-full justify-between px-4 py-2 text-left text-sm hover:bg-base-800"><span>{n.label}</span><span className="text-muted">{n.jp}</span></button>)}</div></div>;
}

function ApprovalModal({ approval, close }: { approval: Approval; close: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-lg rounded-xl border border-base-700 bg-base-850 shadow-xl"><div className="flex items-center gap-3 border-b border-base-700 px-5 py-3"><h2 className="font-semibold">要承認: {approval.title}</h2><Pill tone={approval.risk >= 3 ? "down" : "warn"}>risk {approval.risk.toFixed(1)}</Pill></div><div className="space-y-3 p-5"><p className="text-sm text-text2">{approval.body}</p><div className="rounded-lg border border-base-700 bg-base-900 p-3"><div className="text-[10px] uppercase tracking-wide text-muted">Target</div><div className="mono text-sm">{approval.target}</div></div></div><div className="flex justify-end gap-2 border-t border-base-700 px-5 py-3"><Button onClick={close}>Reject</Button><Button onClick={close}>Feedback</Button><Button onClick={async () => { await approval.approve(); close(); }}>Approve</Button></div></div></div>;
}

function toastClass(level: Toast["level"]) {
  return level === "error" ? "border-down/50 text-down" : level === "warn" ? "border-warn/50 text-warn" : "border-accent/50 text-accent";
}
