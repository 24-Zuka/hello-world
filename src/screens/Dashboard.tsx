import { useEffect, useState } from "react";

import { QuotaGauge } from "../components/QuotaGauge";
import { Button, Card, Pill, ScreenHeader } from "../components/ui";
import { api } from "../lib/api";
import { useCockpit } from "../store/cockpit";
import type { AirFlowCategory, AirFlowStatus, TaskCard } from "../types";

const STATUS_TONE: Record<AirFlowStatus, "muted" | "ok" | "warn" | "accent"> = {
  Inbox: "muted",
  Today: "accent",
  Doing: "ok",
  Waiting: "warn",
  Done: "muted",
};

const CATEGORY_CLASS: Record<AirFlowCategory, string> = {
  Business: "text-accent bg-accent-dim border-accent-border",
  Engineering: "text-teal bg-teal/10 border-teal/30",
  Content: "text-warn bg-warn/10 border-warn/30",
};

// Dashboard（司令室, §4.1）: 起動直後の一望。今日やること・健全性・課金残量を即把握。
export function Dashboard() {
  const quota = useCockpit((s) => s.quota);
  const settings = useCockpit((s) => s.settings);
  const setRetreat = useCockpit((s) => s.setRetreatMode);
  const setScreen = useCockpit((s) => s.setScreen);
  const startJob = useCockpit((s) => s.startJob);
  const pushToast = useCockpit((s) => s.pushToast);
  const jobs = useCockpit((s) => s.jobs);

  const [brief, setBrief] = useState<string>("");
  const [tasks, setTasks] = useState<TaskCard[]>([]);

  useEffect(() => {
    // 今日のブリーフ: 最新 Daily ノートの抜粋（§4.1）。
    api.vaultRead("Daily/2026-06-27.md").then(setBrief).catch(() => setBrief(""));
    api.taskList().then(setTasks).catch(() => setTasks([]));
  }, []);

  const activeThreads = Object.values(jobs).filter((j) => j.status === "running").length;
  const waiting = tasks.filter((t) => t.status === "Waiting" || t.decision_required);
  const today = tasks.filter((t) => t.status === "Today" || t.status === "Doing");
  const highRisk = tasks.filter((t) => t.risk_score >= 3.0);

  const quickAction = async (kind: "morning" | "review" | "research") => {
    if (kind === "morning") {
      // 朝会を今すぐ → scripts/morning_meeting.sh（§4.1 操作→裏側）。
      const id = await api.launchdRunNow("org.jarvis.morning");
      startJob(id, "morning");
      setScreen("schedule");
    } else if (kind === "research") {
      const id = await api.researchScan("最新AIエージェント動向");
      startJob(id, "research");
      setScreen("research");
    } else {
      pushToast({ level: "info", title: "レビュー", body: "Build 画面で対象 worktree を選んで実行します。" });
      setScreen("build");
    }
  };

  return (
    <div className="min-h-full">
      <ScreenHeader title="Dashboard" jp="司令室">
        <Pill tone={waiting.length > 0 ? "warn" : "ok"}>要判断 {waiting.length}</Pill>
        <Pill tone={highRisk.length > 0 ? "down" : "muted"}>{`risk>=3.0 ${highRisk.length}`}</Pill>
      </ScreenHeader>
      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-12 xl:p-6">
        <section className="xl:col-span-12">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Today" value={today.length} tone="accent" />
            <Metric label="Doing" value={tasks.filter((t) => t.status === "Doing").length} tone="ok" />
            <Metric label="Waiting" value={waiting.length} tone="warn" />
            <Metric label="Active Threads" value={`${activeThreads}/4`} tone={activeThreads >= 4 ? "warn" : "muted"} />
          </div>
        </section>

        {/* Plus 残量ゲージ */}
        <Card title="Plus 残量（5h ウィンドウ）" className="xl:col-span-3">
          <div className="flex flex-col items-center gap-3">
            <QuotaGauge quota={quota} />
            {/* 80%超で警告 + 退避ボタン（§4.1）。不明時も退避は選択可。 */}
            <Button variant="primary" onClick={() => setRetreat(!(settings?.retreat_mode ?? false))}>
              {settings?.retreat_mode ? "退避モード解除" : "ローカルへ退避"}
            </Button>
          </div>
        </Card>

        {/* 今日のブリーフ */}
        <Card title="今日のブリーフ" className="xl:col-span-5">
          <pre className="mono max-h-56 overflow-auto whitespace-pre-wrap text-xs text-text2">
            {brief || "最新 Daily ノートが見つかりません。"}
          </pre>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setScreen("memory")}>
              Memory で開く →
            </Button>
          </div>
        </Card>

        <Card title="AirFlow タスクボード" className="xl:col-span-4">
          <div className="space-y-2">
            {tasks.slice(0, 5).map((task) => (
              <TaskRow key={task.task_id} task={task} />
            ))}
            {tasks.length === 0 && (
              <p className="text-sm text-muted">
                チケットがありません。Inbox取り込みか自然文起票から開始してください。
              </p>
            )}
          </div>
        </Card>

        {/* アクティブ */}
        <Card title="アクティブ" className="xl:col-span-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">実行中スレッド</span>
              <Pill tone={activeThreads > 0 ? "accent" : "muted"}>{activeThreads} / 4</Pill>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">直近ジョブ</span>
              <span>{Object.keys(jobs).length} 件</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">退避モード</span>
              <Pill tone={settings?.retreat_mode ? "warn" : "ok"}>
                {settings?.retreat_mode ? "ON" : "OFF"}
              </Pill>
            </div>
          </div>
        </Card>

        {/* クイックアクション */}
        <Card title="クイックアクション" className="xl:col-span-8">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => quickAction("morning")}>朝会を今すぐ</Button>
            <Button onClick={() => quickAction("review")}>レビュー実行</Button>
            <Button onClick={() => quickAction("research")}>調査スキャン</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "accent" | "ok" | "warn" | "muted";
}) {
  const color = {
    accent: "text-accent",
    ok: "text-ok",
    warn: "text-warn",
    muted: "text-muted",
  }[tone];

  return (
    <div className="rounded-lg border border-base-700 bg-base-850 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.13em] text-muted">{label}</div>
      <div className={`font-display text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function TaskRow({ task }: { task: TaskCard }) {
  return (
    <div className="rounded-lg border border-base-700 bg-base-900 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_CLASS[task.category]}`}>
          {task.category}
        </span>
        <Pill tone={STATUS_TONE[task.status]}>{task.status}</Pill>
        <span className="mono ml-auto text-[11px] text-muted">{task.id}</span>
      </div>
      <div className="mt-1 text-sm font-medium text-text1">{task.title}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
        <span className="mono">risk {task.risk_score.toFixed(1)}</span>
        <span>priority {task.priority}</span>
        <span>{task.assignee}</span>
        {task.decision_required && <span className="ml-auto text-warn">要判断</span>}
      </div>
    </div>
  );
}
