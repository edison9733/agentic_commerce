/**
 * The little state the agents keep on disk: the quotes a merchant co-signed,
 * the deliveries it made, and the arbiter's evidence. Everything else is read
 * from the chain. It lives in TESSERA_DATA_DIR, by default `.data/` in the
 * repo (`/app/.data` in the image), readable by this user only.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '../../../scripts/lib.js';

/** Looked up on each use, so a test can point it somewhere else. */
export function dataDir(): string {
  return process.env.TESSERA_DATA_DIR ? resolve(process.env.TESSERA_DATA_DIR) : resolve(REPO_ROOT, '.data');
}

export const dataFile = (name: string): string => join(dataDir(), name);

function ensureDir(): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
}

/** Write every byte or throw: a short write on a full disk must not pass for success. */
function writeAll(fd: number, text: string): void {
  const buf = Buffer.from(text);
  let off = 0;
  while (off < buf.length) {
    const n = writeSync(fd, buf, off, buf.length - off);
    if (n <= 0) throw new Error('short write');
    off += n;
  }
}

/**
 * Replace a file's contents: write a new file, flush it to the disk, rename it
 * over the old one. A crash leaves the old contents or the new, never half.
 */
export function writeFileDurable(file: string, text: string): void {
  ensureDir();
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeAll(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

/** Append one line and flush it. Throws if it cannot be written. */
export function appendLineDurable(file: string, line: string): void {
  ensureDir();
  const fd = openSync(file, 'a', 0o600);
  try {
    writeAll(fd, line + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** A JSON file, or undefined if there is none. One that exists but is unreadable throws: it is not the same as a fresh start. */
export function readJsonFile<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}
