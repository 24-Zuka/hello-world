"use client";

import type { Status, Task } from "@/types";
import { TaskCard } from "./TaskCard";

const LABELS: Record<Status, string> = {
  "needs-ai": "Needs AI",
  "in-progress": "In Progress",
  "needs-human": "Needs Human",
  blocked: "Blocked",
  done: "Done",
};

export function Column({
  status,
  tasks,
  onSelect,
}: {
  status: Status;
  tasks: Task[];
  onSelect: (t: Task) => void;
}) {
  return (
    <div className="column">
      <h2>
        <span>{LABELS[status]}</span>
        <span>{tasks.length}</span>
      </h2>
      {tasks.length === 0 ? (
        <div className="empty">—</div>
      ) : (
        tasks.map((t) => <TaskCard key={t.id} task={t} onClick={onSelect} />)
      )}
    </div>
  );
}
