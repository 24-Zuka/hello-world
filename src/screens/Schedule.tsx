import { useEffect, useState } from "react";

import { LogStream } from "../components/LogStream";
import { Button, Card, Pill, ScreenHeader } from "../components/ui";
import { api } from "../lib/api";
import { useCockpit } from "../store/cockpit";
import type { ScheduleJob } from "../types";

// Schedule（定時運用, §4.5）: 朝会など launchd ジョブの管理。
export function Schedule() {
  const startJob = useCockpit((s) => s.startJob);
  const jobs = useCockpit((s) => s.jobs);
  const pushToast = useCockpit((s) => s.pushToast);

  const [list, setList] = useState<ScheduleJob[]>([]);
  const [activeJob, setActiveJob] = useState("");

  const load = () => api.launchdList().then(setList).catch(() => setList([]));
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (job: ScheduleJob) => {
    await api.launchdToggle(job.label, !job.loaded);
    pushToast({ level: "info", title: job.loaded ? "無効化" : "有効化", body: job.label });
    void load();
  };

  const runNow = async (job: ScheduleJob) => {
    const id = await api.launchdRunNow(job.label);
    startJob(id, "morning");
    setActiveJob(id);
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Schedule" jp="定時運用" />
      <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-6">
        <Card title="launchd ジョブ">
          {list.length === 0 && <p className="text-sm text-muted">ジョブが見つかりません（launchctl 未接続）。</p>}
          <div className="space-y-2">
            {list.map((j) => (
              <div key={j.label} className="rounded-md border border-base-700 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="mono text-sm">{j.label}</span>
                  <Pill tone={j.loaded ? "ok" : "muted"}>{j.loaded ? "loaded" : "unloaded"}</Pill>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted">
                  <span>次回: {j.next_run ?? "—"}</span>
                  <span>最終: {j.last_result ?? "—"}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button variant="ghost" onClick={() => toggle(j)}>
                    {j.loaded ? "無効化" : "有効化"}
                  </Button>
                  <Button variant="ghost" onClick={() => runNow(j)}>
                    今すぐ実行
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      // 時刻編集 → plist の StartCalendarInterval → reload（§4.5）。
                      await api.launchdSetTime(j.label, 7, 30);
                      pushToast({ level: "info", title: "時刻変更", body: `${j.label} を 07:30 に設定` });
                    }}
                  >
                    07:30 に設定
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="最終実行ログ">
          <div className="h-80">
            <LogStream job={jobs[activeJob]} />
          </div>
          <p className="mt-2 text-[11px] text-base-500">/tmp/jarvis_morning.*.log を tail 表示（§4.5）</p>
        </Card>
      </div>
    </div>
  );
}
