// 空状態/エラー状態（§5）: 依存未接続時に「何をすれば直るか」を一文で提示。
export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-sm font-medium text-gray-300">{title}</div>
      <div className="max-w-md text-xs text-muted">{hint}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
