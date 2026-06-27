import { useEffect, useState } from "react";

import { QuotaGauge } from "../components/QuotaGauge";
import { Button, Card, Pill, ScreenHeader } from "../components/ui";
import { api } from "../lib/api";
import { useCockpit } from "../store/cockpit";

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

  useEffect(() => {
    // 今日のブリーフ: 最新 Daily ノートの抜粋（§4.1）。
    api.vaultRead("Daily/2026-06-27.md").then(setBrief).catch(() => setBrief(""));
  }, []);

  const activeThreads = Object.values(jobs).filter((j) => j.status === "running").length;

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
    <div>
      <ScreenHeader title="Dashboard" jp="司令室" />
      <div className="grid grid-cols-3 gap-4 p-6">
        {/* Plus 残量ゲージ */}
        <Card title="Plus 残量（5h ウィンドウ）">
          <div className="flex flex-col items-center gap-3">
            <QuotaGauge quota={quota} />
            {/* 80%超で警告 + 退避ボタン（§4.1）。不明時も退避は選択可。 */}
            <Button variant="primary" onClick={() => setRetreat(!(settings?.retreat_mode ?? false))}>
              {settings?.retreat_mode ? "退避モード解除" : "ローカルへ退避"}
            </Button>
          </div>
        </Card>

        {/* 今日のブリーフ */}
        <Card title="今日のブリーフ" className="col-span-2">
          <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap text-xs text-gray-300">
            {brief || "最新 Daily ノートが見つかりません。"}
          </pre>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setScreen("memory")}>
              Memory で開く →
            </Button>
          </div>
        </Card>

        {/* アクティブ */}
        <Card title="アクティブ">
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
        <Card title="クイックアクション" className="col-span-2">
          <div className="flex gap-3">
            <Button onClick={() => quickAction("morning")}>朝会を今すぐ</Button>
            <Button onClick={() => quickAction("review")}>レビュー実行</Button>
            <Button onClick={() => quickAction("research")}>調査スキャン</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
