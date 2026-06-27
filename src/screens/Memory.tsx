import { useEffect, useState } from "react";

import { Button, Card, ScreenHeader } from "../components/ui";
import { api } from "../lib/api";
import { useCockpit } from "../store/cockpit";
import type { SearchHit, VaultNode } from "../types";

// Memory（記憶 / Vault ブラウザ, §4.4）: 書き物文化の中心。閲覧・編集。
export function Memory() {
  const requestApproval = useCockpit((s) => s.requestApproval);
  const pushToast = useCockpit((s) => s.pushToast);

  const [tree, setTree] = useState<VaultNode[]>([]);
  const [path, setPath] = useState("Daily/2026-06-27.md");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    api.vaultTree().then(setTree).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    api.vaultRead(path).then(setContent).catch(() => setContent(""));
    setEditing(false);
  }, [path]);

  // AI_Handoff / DECISION_LOG は時系列タイムライン表示（§4.4）。
  const isTimeline = path === "AI_Handoff.md" || path === "DECISION_LOG.md";

  const save = async () => {
    // 編集 → PUT（replace）。MEMORY.md 上書きは要承認（§9）。
    if (path === "MEMORY.md") {
      requestApproval({
        title: "MEMORY.md の上書き",
        description: "共有記憶の中核ファイルを上書きします（§9 要承認）。",
        target: path,
        riskScore: 3.0,
        onApprove: async () => {
          await api.vaultWrite(path, content, "replace");
          pushToast({ level: "info", title: "保存", body: "MEMORY.md を更新しました。" });
          setEditing(false);
        },
      });
      return;
    }
    await api.vaultWrite(path, content, "replace");
    pushToast({ level: "info", title: "保存", body: `${path} を更新しました。` });
    setEditing(false);
  };

  // 削除は要承認モーダル + ゴミ箱経由（§4.4, §9）。
  const remove = () =>
    requestApproval({
      title: "ノート削除",
      description: "このノートをゴミ箱へ移動します（即時 unlink はしません）。復元可能ですが確認が必要です。",
      target: path,
      riskScore: 3.0,
      onApprove: async () => {
        await api.vaultDelete(path);
        pushToast({ level: "warn", title: "削除", body: `${path} をゴミ箱へ移動しました。` });
        api.vaultTree().then(setTree);
      },
    });

  const search = async () => setHits(await api.vaultSearch(query));

  const renderTree = (nodes: VaultNode[], depth = 0) =>
    nodes.map((n) => (
      <div key={n.path}>
        {n.type === "note" ? (
          <button
            onClick={() => setPath(n.path)}
            style={{ paddingLeft: 12 + depth * 14 }}
            className={`block w-full truncate rounded px-2 py-1 text-left text-sm ${
              path === n.path ? "bg-base-700 text-white" : "text-muted hover:bg-base-800"
            }`}
          >
            ▤ {n.path.split("/").pop()}
          </button>
        ) : (
          <div>
            <div style={{ paddingLeft: 12 + depth * 14 }} className="px-2 py-1 text-xs uppercase tracking-wide text-base-500">
              {n.path.replace("/", "")}
            </div>
            {n.children && renderTree(n.children, depth + 1)}
          </div>
        )}
      </div>
    ));

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Memory" jp="記憶 / Vault" />
      <div className="grid flex-1 grid-cols-[16rem_1fr_18rem] gap-4 overflow-hidden p-6">
        {/* 左: ツリー */}
        <Card title="Vault" className="overflow-auto">
          {tree.length ? renderTree(tree) : <span className="text-sm text-muted">未接続</span>}
        </Card>

        {/* 中央: プレビュー/編集 */}
        <Card
          title={path}
          className="flex flex-col overflow-hidden"
        >
          <div className="mb-3 flex gap-2">
            <Button variant={editing ? "ghost" : "default"} onClick={() => setEditing((e) => !e)}>
              {editing ? "プレビュー" : "編集"}
            </Button>
            {editing && (
              <Button variant="primary" onClick={save}>
                保存
              </Button>
            )}
            <Button variant="danger" onClick={remove}>
              削除（要承認）
            </Button>
          </div>
          {editing ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="mono h-[28rem] w-full resize-none rounded-md border border-base-700 bg-base-900 p-3 text-xs outline-none focus:border-accent"
            />
          ) : isTimeline ? (
            <Timeline content={content} />
          ) : (
            <pre className="mono max-h-[28rem] overflow-auto whitespace-pre-wrap text-xs text-gray-300">{content}</pre>
          )}
        </Card>

        {/* 右: 検索 */}
        <Card title="検索（全文）" className="overflow-auto">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="キーワード"
              className="flex-1 rounded-md border border-base-700 bg-base-900 px-2 py-1 text-sm outline-none focus:border-accent"
            />
            <Button onClick={search}>検索</Button>
          </div>
          <p className="mt-2 text-[10px] text-base-500">将来 Smart Connections の意味検索に拡張（§4.4）</p>
          <ul className="mt-3 space-y-2">
            {hits.map((h) => (
              <li key={h.path}>
                <button onClick={() => setPath(h.path)} className="block text-left">
                  <div className="text-sm text-accent">{h.path}</div>
                  <div className="text-xs text-muted">{h.snippet}</div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// 時系列タイムライン（§4.4）。`##` 見出し単位で区切って縦並びに。
function Timeline({ content }: { content: string }) {
  const entries = content
    .split(/^##\s+/m)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="max-h-[28rem] space-y-3 overflow-auto pr-1">
      {entries.map((e, i) => {
        const [head, ...rest] = e.split("\n");
        return (
          <div key={i} className="border-l-2 border-accent-dim pl-3">
            <div className="text-sm font-medium text-accent">{head}</div>
            <div className="mono whitespace-pre-wrap text-xs text-gray-300">{rest.join("\n")}</div>
          </div>
        );
      })}
    </div>
  );
}
