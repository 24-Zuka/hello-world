import { useState } from "react";

import { useCockpit } from "../store/cockpit";

// 承認モーダル（§5, §14.3）。「要承認」操作 or risk_score>=3.0 で必ず表示。
// 操作内容・影響範囲・対象を明示し、Approve / Feedback / Reject を要求。
export function ApprovalModal() {
  const approval = useCockpit((s) => s.approval);
  const close = useCockpit((s) => s.closeApproval);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!approval) return null;

  const high = approval.riskScore >= 3.0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg border border-base-600 bg-base-850 shadow-xl"
      >
        <div className="flex items-center gap-3 border-b border-base-700 px-5 py-3">
          <span className={`text-lg ${high ? "text-down" : "text-warn"}`}>⚠</span>
          <h2 className="text-base font-semibold">要承認: {approval.title}</h2>
          <span
            className={`ml-auto rounded px-2 py-0.5 text-xs ${
              high ? "bg-down/20 text-down" : "bg-warn/20 text-warn"
            }`}
          >
            risk {approval.riskScore.toFixed(1)}
          </span>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-gray-300">{approval.description}</p>
          <div className="rounded-md bg-base-900 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider text-muted">対象</div>
            <div className="mono text-sm text-white">{approval.target}</div>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Feedback（差し戻し時のコメント・任意）"
            className="h-20 w-full resize-none rounded-md border border-base-700 bg-base-900 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-base-700 px-5 py-3">
          <button
            onClick={() => {
              approval.onReject?.();
              close();
            }}
            className="rounded-md px-3 py-1.5 text-sm text-down hover:bg-base-800"
          >
            Reject
          </button>
          <button
            onClick={() => {
              approval.onFeedback?.(note);
              close();
            }}
            className="rounded-md px-3 py-1.5 text-sm text-warn hover:bg-base-800"
          >
            Feedback
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await approval.onApprove();
              } finally {
                setBusy(false);
                close();
              }
            }}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-base-900 hover:bg-accent-soft disabled:opacity-50"
          >
            {busy ? "実行中…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
