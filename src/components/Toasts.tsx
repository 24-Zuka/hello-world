import { useCockpit } from "../store/cockpit";

// 通知（§5）: ジョブ完了/失敗・Plus上限接近・dcg 遮断などを画面右下に表示。
const COLOR: Record<string, string> = {
  error: "border-down/50 text-down",
  warn: "border-warn/50 text-warn",
  info: "border-accent/50 text-accent",
};

export function Toasts() {
  const toasts = useCockpit((s) => s.toasts);
  const dismiss = useCockpit((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-md border bg-base-850 px-4 py-3 shadow-lg ${
            COLOR[t.level] ?? COLOR.info
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{t.title}</span>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-white">
              ×
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-300">{t.body}</p>
        </div>
      ))}
    </div>
  );
}
