"use client";

import type { Task } from "@/types";

export function TaskDetail({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <h3>{task.title}</h3>
            <div className="meta">
              <span className="pill id">{task.id}</span>
              <span className={`pill pri-${task.priority}`}>{task.priority}</span>
              <span className="muted">
                {task.status} · {task.owner} · {task.action_type}
              </span>
            </div>
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        {task.blocked_reason && (
          <div className="field">
            <div className="label">Blocked reason</div>
            <div className="handoff">{task.blocked_reason}</div>
          </div>
        )}

        <div className="field">
          <div className="label">Handoff note</div>
          <div className="handoff">
            {task.handoff_note || <span className="muted">（なし）</span>}
          </div>
        </div>

        {task.tags.length > 0 && (
          <div className="field">
            <div className="label">Tags</div>
            <div className="meta">
              {task.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <div className="label">Activity</div>
          <ul className="activity">
            {[...task.activity].reverse().map((a, i) => (
              <li key={i}>
                <div>{a.action}</div>
                <span className="ts">{a.timestamp}</span>
                <span className="actor">{a.actor}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="field muted" style={{ fontSize: 11 }}>
          created {task.created_at} · updated {task.updated_at}
        </div>
      </div>
    </>
  );
}
