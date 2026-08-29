export function compactNumber(value: number): string {
  const n = Math.round(value);
  if (n < 1_000) return String(n);
  if (n < 999_500) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 999_500_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function bytes(chars: number): string {
  if (chars < 1_024) return `${chars} B`;
  if (chars < 1_024 * 1_024) return `${(chars / 1_024).toFixed(0)} KB`;
  return `${(chars / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function money(value: number): string {
  if (value >= 1000) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (value >= 10) return `$${Math.round(value)}`;
  if (value >= 1) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

export function percent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function shortPath(value: string, max = 44): string {
  if (value.length <= max) return value;
  const parts = value.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("/");
  return tail.length <= max ? `…/${tail}` : `…/${parts[parts.length - 1] ?? value}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

export function ago(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function shortDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
