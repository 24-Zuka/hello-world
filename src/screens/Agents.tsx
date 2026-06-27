import { useState } from "react";

import { Card, Pill, ScreenHeader } from "../components/ui";
import type { Agent } from "../types";

// 組織図（§4.2）。秘書を頂点に開発・レビュー・調査・運用・戦略。
// 実機では vault/Agents/*.md から生成。ここでは代表構成を提示。
const AGENTS: Agent[] = [
  { id: "secretary", name: "秘書AI", role: "統括・調整", model: "gpt-5.5", authority: "approval", status: "idle", mdPath: "Agents/秘書AI.md" },
  { id: "dev", name: "開発AI", role: "実装", model: "gpt-5.4", authority: "solo", status: "running", mdPath: "Agents/開発AI.md", parent: "secretary" },
  { id: "review", name: "レビューAI", role: "コードレビュー", model: "gpt-5.4-mini", authority: "approval", status: "idle", mdPath: "Agents/レビューAI.md", parent: "secretary" },
  { id: "research", name: "調査AI", role: "リサーチ", model: "gpt-5.4-mini", authority: "solo", status: "idle", mdPath: "Agents/調査AI.md", parent: "secretary" },
  { id: "ops", name: "運用AI", role: "定時運用", model: "gpt-5.4-mini", authority: "solo", status: "idle", mdPath: "Agents/運用AI.md", parent: "secretary" },
  { id: "strategy", name: "戦略AI", role: "戦略立案", model: "gpt-5.5", authority: "approval", status: "idle", mdPath: "Agents/戦略AI.md", parent: "secretary" },
];

// Codex サブエージェント（§4.2）。~/.codex/agents/<name>.toml 由来。
const SUBAGENTS = ["reviewer", "code_explorer", "web_researcher", "test_writer"];

export function Agents() {
  const [selected, setSelected] = useState<Agent>(AGENTS[0]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Agents" jp="組織図" />
      <div className="grid flex-1 grid-cols-[1fr_20rem] gap-4 overflow-auto p-6">
        <div className="space-y-4">
          <Card title="AI 組織図">
            {/* 秘書を頂点に配置 */}
            <div className="flex flex-col items-center gap-4">
              <AgentNode agent={AGENTS[0]} onClick={setSelected} active={selected.id === AGENTS[0].id} />
              <div className="h-4 w-px bg-base-600" />
              <div className="flex flex-wrap justify-center gap-3">
                {AGENTS.slice(1).map((a) => (
                  <AgentNode key={a.id} agent={a} onClick={setSelected} active={selected.id === a.id} />
                ))}
              </div>
            </div>
          </Card>

          <Card title="Codex サブエージェント">
            <div className="flex flex-wrap gap-2">
              {SUBAGENTS.map((s) => (
                <span key={s} className="mono rounded border border-base-600 px-2 py-1 text-xs text-muted">
                  {s}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-base-500">
              定義の編集は確認モーダル経由（~/.codex/agents/&lt;name&gt;.toml, §4.2）。
            </p>
          </Card>
        </div>

        {/* 右ペイン詳細 */}
        <Card title="詳細">
          <div className="space-y-3 text-sm">
            <div className="text-lg font-semibold">{selected.name}</div>
            <Row label="役割" value={selected.role} />
            <Row label="割当モデル" value={selected.model ?? "—"} />
            <div className="flex items-center justify-between">
              <span className="text-muted">権限</span>
              <Pill tone={selected.authority === "approval" ? "warn" : "ok"}>
                {selected.authority === "approval" ? "要承認" : "単独可"}
              </Pill>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">状態</span>
              <Pill tone={selected.status === "running" ? "accent" : "muted"}>{selected.status}</Pill>
            </div>
            <Row label="人格定義" value={selected.mdPath} mono />
            <p className="text-[11px] text-base-500">
              人格編集は該当 md を保存時 Obsidian REST PUT（§4.2）。
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function AgentNode({ agent, onClick, active }: { agent: Agent; onClick: (a: Agent) => void; active: boolean }) {
  return (
    <button
      onClick={() => onClick(agent)}
      className={`w-40 rounded-lg border px-3 py-2 text-left transition-colors ${
        active ? "border-accent bg-base-700" : "border-base-600 bg-base-850 hover:border-accent-soft"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{agent.name}</span>
        <span className={`h-2 w-2 rounded-full ${agent.status === "running" ? "bg-accent live-dot" : "bg-base-500"}`} />
      </div>
      <div className="text-xs text-muted">{agent.role}</div>
      <div className="mt-1 text-[10px] text-base-500">{agent.model}</div>
    </button>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={mono ? "mono text-xs" : ""}>{value}</span>
    </div>
  );
}
