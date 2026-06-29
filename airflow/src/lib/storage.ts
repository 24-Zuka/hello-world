// JSON file storage (§3). board.json (active) + archive.json (completed).
// No database. Writes are atomic (temp file + rename) and serialized through a
// single in-process mutex so concurrent PATCH/POST requests can't corrupt a file.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Task } from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");
const BOARD_PATH = path.join(DATA_DIR, "board.json");
const ARCHIVE_PATH = path.join(DATA_DIR, "archive.json");

// Promise-chain mutex: every mutating section awaits the previous one.
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  // keep the chain alive but swallow rejection so one failure doesn't poison it
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readFile(file: string): Promise<Task[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}

async function writeFileAtomic(file: string, data: Task[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

export function readBoard(): Promise<Task[]> {
  return readFile(BOARD_PATH);
}

export function readArchive(): Promise<Task[]> {
  return readFile(ARCHIVE_PATH);
}

export function writeBoard(tasks: Task[]): Promise<void> {
  return writeFileAtomic(BOARD_PATH, tasks);
}

export function writeArchive(tasks: Task[]): Promise<void> {
  return writeFileAtomic(ARCHIVE_PATH, tasks);
}

/**
 * Run a read-modify-write transaction against board + archive under the mutex.
 * The mutator receives current arrays and returns the arrays to persist.
 */
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
