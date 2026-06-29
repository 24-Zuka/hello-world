"use client";

import { useState } from "react";

// The board token is a secret; we keep it in localStorage on the client and send
// it as X-Board-Token. The UI never displays existing tokens, only accepts input.
export function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="notice">
      <h2>ボードトークンを入力</h2>
      <p className="muted">
        AIRFLOW ボードは <code>X-Board-Token</code> 必須です。
        <code>.env.local</code> の <code>TOKEN_HUMAN</code> を貼り付けてください。
        トークンはこのブラウザの localStorage にのみ保存されます。
      </p>
      <div className="row">
        <input
          type="password"
          placeholder="X-Board-Token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
          }}
        />
        <button
          className="primary"
          onClick={() => value.trim() && onSubmit(value.trim())}
        >
          接続
        </button>
      </div>
    </div>
  );
}
