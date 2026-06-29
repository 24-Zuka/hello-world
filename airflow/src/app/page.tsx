"use client";

import { useCallback, useEffect, useState } from "react";
import type { Status, Task } from "@/types";
import { STATUSES } from "@/types";
import { Column } from "@/components/Column";
import { TaskDetail } from "@/components/TaskDetail";
import { TokenGate } from "@/components/TokenGate";

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const TOKEN_KEY = "airflow.token";

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/board", {
        headers: { "X-Board-Token": token },
        cache: "no-store",
      });
      if (res.status === 403) {
        setError("トークンが無効です（403）。");
        setToken(null);
        localStorage.removeItem(TOKEN_KEY);
        return;
      }
      if (!res.ok) {
        setError(`読み込み失敗: ${res.status}`);
        return;
      }
      setTasks((await res.json()) as Task[]);
    } catch (e) {
      setError("ネットワークエラー：API に接続できません。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const onToken = (t: string) => {
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  };

  const disconnect = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setTasks([]);
  };

  if (!token) return <TokenGate onSubmit={onToken} />;

  const byStatus = (s: Status) =>
    tasks
      .filter((t) => t.status === s)
      .sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
      );

  return (
    <>
      <div className="header">
        <div>
          <h1>AIRFLOW</h1>
          <span className="sub">
            {tasks.length} active {loading ? "· 読み込み中…" : ""}
          </span>
        </div>
        <div className="toolbar">
          {error && <span style={{ color: "var(--down)" }}>{error}</span>}
          <button onClick={() => void load()}>再読み込み</button>
          <button onClick={disconnect}>切断</button>
        </div>
      </div>

      <div className="board">
        {STATUSES.map((s) => (
          <Column key={s} status={s} tasks={byStatus(s)} onSelect={setSelected} />
        ))}
      </div>

      {selected && (
        <TaskDetail task={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
