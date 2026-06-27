import { useEffect, useState } from "react";

import { useCockpit } from "../store/cockpit";
import type { ScreenId } from "../types";

interface Command {
  label: string;
  hint: string;
  run: (nav: (s: ScreenId) => void) => void;
}

const COMMANDS: Command[] = [
  { label: "Dashboard へ", hint: "司令室", run: (n) => n("dashboard") },
  { label: "Build へ", hint: "開発パイプライン", run: (n) => n("build") },
  { label: "Memory へ", hint: "記憶 / Vault", run: (n) => n("memory") },
  { label: "Schedule へ", hint: "定時運用", run: (n) => n("schedule") },
  { label: "Research へ", hint: "調査", run: (n) => n("research") },
  { label: "Quota & Cost へ", hint: "コスト管制", run: (n) => n("quota") },
  { label: "Agents へ", hint: "組織図", run: (n) => n("agents") },
  { label: "Settings へ", hint: "設定", run: (n) => n("settings") },
];

// コマンドパレット（§5, ⌘K）: 主要操作への素早いアクセス。
export function CommandPalette() {
  const open = useCockpit((s) => s.paletteOpen);
  const toggle = useCockpit((s) => s.togglePalette);
  const setScreen = useCockpit((s) => s.setScreen);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") toggle(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  if (!open) return null;
  const filtered = COMMANDS.filter((c) => c.label.includes(q) || c.hint.includes(q));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-32" onClick={() => toggle(false)}>
      <div
        className="w-full max-w-md overflow-hidden rounded-lg border border-base-600 bg-base-850 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="コマンドを検索…"
          className="w-full border-b border-base-700 bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-72 overflow-auto py-1">
          {filtered.map((c) => (
            <li key={c.label}>
              <button
                onClick={() => {
                  c.run(setScreen);
                  toggle(false);
                  setQ("");
                }}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-base-700"
              >
                <span>{c.label}</span>
                <span className="text-xs text-muted">{c.hint}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-muted">該当なし</li>}
        </ul>
      </div>
    </div>
  );
}
