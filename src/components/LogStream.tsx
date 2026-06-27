import { useEffect, useRef } from "react";

import type { Job } from "../types";

// ストリーミングログのライブ表示（§4.3, §6: ログのみライブ更新を強調）。
export function LogStream({ job }: { job?: Job }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [job?.logs.length]);

  if (!job) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        ジョブ未実行。ビルド/レビューを開始するとログが逐次表示されます。
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-base-700 px-3 py-1.5 text-xs">
        {job.status === "running" && <span className="live-dot text-accent">●</span>}
        <span className="mono text-muted">{job.id}</span>
        <span
          className={`ml-auto rounded px-2 py-0.5 ${
            job.status === "done"
              ? "bg-ok/20 text-ok"
              : job.status === "error"
                ? "bg-down/20 text-down"
                : "bg-accent/20 text-accent"
          }`}
        >
          {job.status}
        </span>
      </div>
      <div className="mono flex-1 overflow-auto bg-base-900 p-3 text-xs leading-relaxed">
        {job.logs.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap text-gray-300">
            {l}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
