import { useEffect, useState } from "react";

import { DiffViewer } from "../components/DiffViewer";
import { LogStream } from "../components/LogStream";
import { Button, Card, Pill, ScreenHeader } from "../components/ui";
import { api } from "../lib/api";
import { useCockpit } from "../store/cockpit";
import type { ReviewFinding, ReviewSeverity, Worktree } from "../types";

const REPO = "hello-world";
const SEV_TONE: Record<ReviewSeverity, "down" | "warn" | "muted"> = {
  HIGH: "down",
  MEDIUM: "warn",
  LOW: "muted",
};

// Build（開発パイプライン, §4.3）: spec→ビルド→レビューの3ステップを画面で完結。
export function Build() {
  const startJob = useCockpit((s) => s.startJob);
  const jobs = useCockpit((s) => s.jobs);
  const requestApproval = useCockpit((s) => s.requestApproval);
  const pushToast = useCockpit((s) => s.pushToast);

  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [activeJob, setActiveJob] = useState<string>("");
  const [diff, setDiff] = useState("");
  const [findings, setFindings] = useState<ReviewFinding[]>([]);

  const load = () =>
    api.worktreeList(REPO).then((w) => {
      setWorktrees(w);
      if (!selected && w[1]) setSelected(w[1].path);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // レビュー結果 finding を job:event から収集（ローカルレビュー）。
  useEffect(() => {
    const job = jobs[activeJob];
    if (!job) return;
    const fs: ReviewFinding[] = [];
    for (const l of job.logs) {
      try {
        const v = JSON.parse(l);
        if (v.type === "finding") fs.push({ severity: v.severity, file: v.file, line: v.line, message: v.message });
      } catch {
        /* not json */
      }
    }
    if (fs.length) setFindings(fs);
  }, [jobs, activeJob]);

  const runningCount = Object.values(jobs).filter((j) => j.status === "running").length;
  const atCapacity = runningCount >= 4; // §4.3 並列上限ガード（max_threads=4）。

  const build = async () => {
    if (atCapacity) {
      pushToast({ level: "warn", title: "待機キュー", body: "同時実行は最大4件です。完了をお待ちください。" });
      return;
    }
    const id = await api.codexBuild(selected, prompt, undefined);
    startJob(id, "build", selected);
    setActiveJob(id);
    setFindings([]);
  };

  const review = async () => {
    const id = await api.localReview(selected, "main");
    startJob(id, "review", selected);
    setActiveJob(id);
    setFindings([]);
  };

  const showDiff = async () => setDiff(await api.gitDiff(selected, "main"));

  // main へのマージは要承認モーダル（§4.3, §9）。人間のみ。
  const merge = () =>
    requestApproval({
      title: "main へのマージ",
      description: "このマージは main ブランチを更新します。人間の明示的承認が必要です（§9 権限表）。",
      target: `${selected} → main`,
      riskScore: 3.5,
      onApprove: async () => {
        await api.gitMerge(selected, "main");
        pushToast({ level: "info", title: "マージ完了", body: `${selected} を main にマージしました。` });
        void load();
      },
    });

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Build" jp="開発パイプライン">
        <Pill tone={atCapacity ? "warn" : "muted"}>並列 {runningCount}/4</Pill>
      </ScreenHeader>

      <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-6">
        {/* Worktree 一覧 + ビルドパネル */}
        <div className="space-y-4">
          <Card title="Worktree 一覧">
            <div className="space-y-1">
              {worktrees.map((w) => (
                <button
                  key={w.path}
                  onClick={() => setSelected(w.path)}
                  className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                    selected === w.path ? "bg-base-700" : "hover:bg-base-800"
                  }`}
                >
                  <span className="mono truncate">{w.branch}</span>
                  {w.dirty && <Pill tone="warn">dirty</Pill>}
                </button>
              ))}
              <Button
                variant="ghost"
                onClick={async () => {
                  const wt = await api.worktreeCreate(REPO, `feat/${Date.now().toString().slice(-4)}`);
                  pushToast({ level: "info", title: "新規 worktree", body: wt.branch });
                  void load();
                }}
              >
                + 新規 worktree（worktree_new.sh）
              </Button>
            </div>
          </Card>

          <Card title="ビルドパネル">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="ビルドプロンプト（codex_build.sh に渡す）"
              className="h-24 w-full resize-none rounded-md border border-base-700 bg-base-900 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={build} disabled={!selected || !prompt}>
                ビルド実行
              </Button>
              <Button onClick={review} disabled={!selected}>
                ローカルレビュー
              </Button>
              <Button onClick={showDiff} disabled={!selected}>
                差分を表示
              </Button>
              <Button variant="danger" onClick={merge} disabled={!selected}>
                main へマージ（要承認）
              </Button>
            </div>
          </Card>

          {findings.length > 0 && (
            <Card title="レビュー結果（深刻度別）">
              <ul className="space-y-1.5 text-sm">
                {findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Pill tone={SEV_TONE[f.severity]}>{f.severity}</Pill>
                    <div>
                      <span className="mono text-xs text-muted">
                        {f.file}{f.line ? `:${f.line}` : ""}
                      </span>
                      <div className="text-gray-300">{f.message}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* ログストリーム + 差分 */}
        <div className="flex flex-col gap-4">
          <Card title="実行ログ（JSONL ストリーム）" className="flex-1">
            <div className="h-72">
              <LogStream job={jobs[activeJob]} />
            </div>
          </Card>
          {diff && (
            <Card title="差分ビューア">
              <div className="max-h-56 overflow-auto">
                <DiffViewer diff={diff} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
