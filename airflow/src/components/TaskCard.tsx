"use client";

import type { Task } from "@/types";

export function TaskCard({
  task,
  onClick,
}: {
  task: Task;
  onClick: (t: Task) => void;
}) {
  return (
    <div className="card" onClick={() => onClick(task)}>
      <div className="title">{task.title}</div>
      <div className="meta">
        <span className="pill id">{task.id}</span>
        <span className={`pill pri-${task.priority}`}>{task.priority}</span>
        <span>{task.owner}</span>
        {task.tags.map((t) => (
          <span className="tag" key={t}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
