import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOME = process.env.SAVEMYTOKENS_HOME || path.join(os.homedir(), ".savemytokens");
export const CACHE_DIR = path.join(HOME, "cache");
export const RUNS_FILE = path.join(HOME, "runs.json");
export const LAST_AUDIT_FILE = path.join(HOME, "last-audit.json");
export const CONFIG_FILE = path.join(HOME, "config.json");

export function ensureHome(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function displayHome(): string {
  const home = os.homedir();
  return HOME.startsWith(home) ? "~" + HOME.slice(home.length) : HOME;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}
