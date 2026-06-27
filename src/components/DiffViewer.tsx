// git diff の簡易シンタックス表示（§4.3）。等幅 + 行ごとの追加/削除色分け。
export function DiffViewer({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <div className="p-4 text-sm text-muted">差分はありません。</div>;
  }
  return (
    <div className="mono overflow-auto bg-base-900 p-3 text-xs leading-relaxed">
      {diff.split("\n").map((line, i) => {
        let cls = "text-gray-400";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-ok";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-down";
        else if (line.startsWith("@@")) cls = "text-accent";
        else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-muted";
        return (
          <div key={i} className={`whitespace-pre-wrap ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}
