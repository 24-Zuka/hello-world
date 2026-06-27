import { useState } from "react";

import { LogStream } from "../components/LogStream";
import { Button, Card, ScreenHeader } from "../components/ui";
import { api } from "../lib/api";
import { useCockpit } from "../store/cockpit";

// 手動ステーション（§4.6）。ブラウザ専用のため自動化不可と明記。
const STATIONS = [
  { name: "Gemini Deep Research", url: "https://gemini.google.com/" },
  { name: "NotebookLM", url: "https://notebooklm.google.com/" },
];

// Research（調査, §4.6）: 自動調査の発火と手動調査ステーションへの導線。
export function Research() {
  const startJob = useCockpit((s) => s.startJob);
  const jobs = useCockpit((s) => s.jobs);
  const pushToast = useCockpit((s) => s.pushToast);

  const [topic, setTopic] = useState("");
  const [activeJob, setActiveJob] = useState("");
  const [imported, setImported] = useState("");

  const scan = async () => {
    // スキャン → scripts/research_scan.sh "<topic>"（§4.6）。
    const id = await api.researchScan(topic);
    startJob(id, "research");
    setActiveJob(id);
  };

  const importNote = async () => {
    const path = `00_Inbox/research_manual_${Date.now().toString().slice(-6)}.md`;
    await api.vaultWrite(path, imported, "replace");
    pushToast({ level: "info", title: "Inbox 取込", body: path });
    setImported("");
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Research" jp="調査" />
      <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-6">
        <div className="space-y-4">
          <Card title="自動スキャン">
            <div className="flex gap-2">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="調査テーマ"
                className="flex-1 rounded-md border border-base-700 bg-base-900 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <Button variant="primary" onClick={scan} disabled={!topic}>
                スキャン実行
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">生成されたブリーフは 00_Inbox に保存され Memory で閲覧できます。</p>
          </Card>

          <Card title="手動ステーション">
            <p className="mb-2 text-xs text-warn">これらはブラウザ専用のため自動化不可（§4.6）。外部リンクで開きます。</p>
            <div className="flex flex-col gap-2">
              {STATIONS.map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-base-600 px-3 py-2 text-sm text-accent hover:bg-base-800"
                >
                  {s.name} ↗
                </a>
              ))}
            </div>
          </Card>

          <Card title="手動結果の取り込み">
            <textarea
              value={imported}
              onChange={(e) => setImported(e.target.value)}
              placeholder="Markdown を貼り付け → Inbox ノート化"
              className="mono h-32 w-full resize-none rounded-md border border-base-700 bg-base-900 p-2 text-xs outline-none focus:border-accent"
            />
            <div className="mt-2">
              <Button onClick={importNote} disabled={!imported.trim()}>
                Inbox に取り込む
              </Button>
            </div>
          </Card>
        </div>

        <Card title="スキャンログ">
          <div className="h-96">
            <LogStream job={jobs[activeJob]} />
          </div>
        </Card>
      </div>
    </div>
  );
}
