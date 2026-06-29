// Smoke test for the AIRFLOW API — asserts the §17 acceptance criteria against a
// running dev server. Usage:
//   TOKEN_HUMAN=... npm run dev        (in one terminal)
//   TOKEN_HUMAN=... node scripts/smoke.mjs
//
// Exits non-zero on the first failed assertion.

const BASE = process.env.BOARD_BASE_URL || "http://localhost:3000";
const TOKEN = process.env.TOKEN_HUMAN || process.env.DISPATCHER_TOKEN;

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { "X-Board-Token": token } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

async function main() {
  if (!TOKEN) {
    console.error("Set TOKEN_HUMAN in env (must match the server's .env.local).");
    process.exit(2);
  }
  const stamp = Date.now();

  // §17 — wrong/missing token → 403
  ok((await req("GET", "/api/board", {})).status === 403, "missing token → 403");
  ok(
    (await req("GET", "/api/board", { token: "nope" })).status === 403,
    "wrong token → 403",
  );

  // §17 — POST auto-numbers T#### uniquely
  const create = await req("POST", "/api/board", {
    token: TOKEN,
    body: { title: `smoke ${stamp}`, owner: "ai-batch", priority: "P1" },
  });
  ok(create.status === 201, "POST creates task (201)");
  ok(/^T\d{4}$/.test(create.json.id), `id is T#### (${create.json?.id})`);
  const id = create.json.id;
  ok(create.json.activity.length === 1, "new task has 1 activity entry");

  // §11.5 — duplicate title rejected
  const dup = await req("POST", "/api/board", {
    token: TOKEN,
    body: { title: `smoke ${stamp}` },
  });
  ok(dup.status === 409, "duplicate title → 409");

  // §17 — PATCH updates updated_at + appends exactly one activity entry
  const before = create.json;
  await new Promise((r) => setTimeout(r, 5));
  const patch = await req("PATCH", `/api/board/${id}`, {
    token: TOKEN,
    body: { status: "in-progress", action: "smoke patch" },
  });
  ok(patch.status === 200, "PATCH ok (200)");
  ok(patch.json.updated_at !== before.updated_at, "PATCH bumps updated_at");
  ok(
    patch.json.activity.length === before.activity.length + 1,
    "PATCH appends exactly one activity entry",
  );

  // §17 — GET missing id → 404
  ok((await req("GET", "/api/board/T9999", { token: TOKEN })).status === 404, "missing id → 404");

  // §17 — complete moves task to archive, removes from board
  const done = await req("POST", `/api/board/${id}/complete`, { token: TOKEN });
  ok(done.status === 200, "complete ok (200)");
  const board = await req("GET", "/api/board", { token: TOKEN });
  ok(!board.json.some((t) => t.id === id), "completed task left the board");
  const archive = await req("GET", "/api/archive", { token: TOKEN });
  ok(archive.json.some((t) => t.id === id), "completed task is in archive");

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
