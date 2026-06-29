// Storage layer — auto-selects Vercel Blob (cloud) or local JSON files (dev).
// When BLOB_READ_WRITE_TOKEN is set, board/archive live in Vercel Blob Storage.
// Otherwise they live in data/board.json and data/archive.json on disk.

import type { Task } from "@/types";

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// ---- Promise-chain mutex (shared by both backends) ----
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---- Vercel Blob backend ----
async function blobRead(name: string): Promise<Task[]> {
  const { list, getDownloadUrl } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: name, limit: 1 });
  if (blobs.length === 0) return [];
  const url = getDownloadUrl(blobs[0].url);
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? (data as Task[]) : [];
}

async function blobWrite(name: string, data: Task[]): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(name, JSON.stringify(data, null, 2), {
    access: "public",
    addRandomSuffix: false,
  });
}

// ---- Local file backend ----
async function fileRead(name: string): Promise<Task[]> {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const file = path.join(process.cwd(), "data", name);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}

async function fileWrite(name: string, data: Task[]): Promise<void> {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "data");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

// ---- Public API ----
const read = useBlob ? blobRead : fileRead;
const write = useBlob ? blobWrite : fileWrite;

export function readBoard(): Promise<Task[]> {
  return read("board.json");
}
export function readArchive(): Promise<Task[]> {
  return read("archive.json");
}
export function writeBoard(tasks: Task[]): Promise<void> {
  return write("board.json", tasks);
}
export function writeArchive(tasks: Task[]): Promise<void> {
  return write("archive.json", tasks);
}

export function transact<T>(
  fn: (state: { board: Task[]; archive: Task[] }) => Promise<{
    board?: Task[];
    archive?: Task[];
    result: T;
  }>,
): Promise<T> {
  return withLock(async () => {
    const board = await readBoard();
    const archive = await readArchive();
    const out = await fn({ board, archive });
    if (out.board) await writeBoard(out.board);
    if (out.archive) await writeArchive(out.archive);
    return out.result;
  });
}
