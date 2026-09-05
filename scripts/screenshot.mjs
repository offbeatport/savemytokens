import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTheme } from "../dist/runtime/kernel.mjs";
import { helpOverlay, labelsFor, planRows } from "../dist/report/views.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COLUMNS = 112;
const FONT_SIZE = 12.5;
const CELL = FONT_SIZE * 0.6;
const LINE = FONT_SIZE * 1.5;
const PAD = 20;
const RADIUS = 10;
const FONT = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace";

const START = new Date("2026-09-04T16:58:00Z").getTime();

function project(label, options) {
  return {
    project: `/Users/you/${label}`,
    label,
    settings: {
      project: `/Users/you/${label}`,
      label,
      share: options.pinned || !options.live ? options.target : null,
      priority: options.priority,
      cap: null,
      pinned: Boolean(options.pinned),
      parked: false,
      inPlan: options.member === false ? false : true,
      joinedAt: START,
    },
    sessions: [],
    allocation: { claimantId: label, target: options.target, pinned: options.pinned ? options.target : null, pool: 0, released: !options.live },
    observed: options.observed ?? options.target * 0.8,
    usage: { tokens: options.tokens, weighted: options.tokens * 2, requests: options.requests },
    lastSeen: START - (options.lastSeen ?? 90_000),
    bucket: options.live ? "active" : "recent",
    attributedPercent: Math.round(options.target * 100 * 0.42),
    pressure: { value: options.used, basis: "budget" },
    prompt: options.prompt,
    liveSessions: options.sessions ?? (options.live ? 1 : 0),
  };
}

const PROJECTS = [
  project("webinvoke", {
    target: 0.5,
    used: 0.62,
    tokens: 4_120_000,
    requests: 214,
    priority: "high",
    pinned: true,
    live: true,
    sessions: 2,
    prompt: "Implement the provider fallback chain end to end",
  }),
  project("buydiff", {
    target: 0.3,
    used: 0.41,
    tokens: 1_870_000,
    requests: 96,
    priority: "normal",
    live: true,
    prompt: "Fix the verdict table alignment on mobile",
  }),
  project("obp-ui", {
    target: 0.2,
    used: 0.93,
    tokens: 980_000,
    requests: 61,
    priority: "low",
    live: true,
    prompt: "Try the alternate parser and compare the output",
  }),
  project("reposhine", {
    target: 0.15,
    used: 0,
    observed: 0,
    tokens: 0,
    requests: 0,
    priority: "normal",
    live: false,
    lastSeen: 3 * 3600_000,
    prompt: "Draft the plan for the ingest rewrite",
  }),
  project("picsuper", {
    target: 0,
    used: 0,
    observed: 0,
    tokens: 0,
    requests: 0,
    priority: "normal",
    live: false,
    member: false,
    lastSeen: 9 * 3600_000,
    prompt: "Compare the two upscalers on the same source",
  }),
  project("proto", {
    target: 0,
    used: 0,
    observed: 0,
    tokens: 0,
    requests: 0,
    priority: "normal",
    live: false,
    member: false,
    lastSeen: 3 * 24 * 3600_000,
    prompt: "Sketch the ingest schema",
  }),
];

const CONTROL = {
  provider: { id: "claude-code", label: "Claude Code" },
  installed: true,
  resources: [
    {
      id: "claude-code:five_hour",
      adapter: "claude-code",
      label: "5h",
      unit: "observed_usage",
      window: { kind: "rolling", ms: 18_000_000, resetsAt: Math.floor(START / 1000) + 7020 },
      capacity: { amount: 100, confidence: "published" },
      usedPercent: 42,
    },
    {
      id: "claude-code:seven_day",
      adapter: "claude-code",
      label: "7d",
      unit: "observed_usage",
      window: { kind: "rolling", ms: 604_800_000, resetsAt: Math.floor(START / 1000) + 183_600 },
      capacity: { amount: 100, confidence: "published" },
      usedPercent: 18,
    },
  ],
  enforcement: ["advise"],
  unattributed: 2,
  deferred: [],
  others: [],
  config: {
    columns: ["allocation", "used", "priority", "last prompt"],
    policy: "finish",
    policyFor: {},
    preserveFor: {},
    customAdvice: {},
    theme: { tui: "default", hud: "default" },
    layout: { hud: "default" },
    hud: { segments: [] },
  },
  schedule: {
    now: START,
    key: "five_hour",
    bounds: { from: START - 10_800_000, to: START + 7_200_000 },
    quota: { at: START - 4000, five_hour: { used: 42 }, seven_day: { used: 18 }, history: [] },
    projects: PROJECTS,
    claimants: [],
    unusedPool: 0,
  },
};

function context(theme, columns, extra = {}) {
  return {
    theme,
    color: true,
    columns,
    rows: 40,
    selected: 0,
    interactive: true,
    expanded: false,
    labels: labelsFor(PROJECTS),
    ...extra,
  };
}

function runs(line) {
  const out = [];
  let fill = null;
  let bold = false;
  let text = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] === "") {
      const end = line.indexOf("m", index);
      if (end === -1) break;
      const code = line.slice(index + 2, end);
      if (text) out.push({ text, fill, bold });
      text = "";
      if (code === "0") {
        fill = null;
        bold = false;
      } else {
        const parts = code.split(";");
        bold = parts[0] === "1";
        const at = parts.indexOf("2");
        if (at > 0) fill = `rgb(${parts[at + 1]},${parts[at + 2]},${parts[at + 3]})`;
      }
      index = end + 1;
      continue;
    }
    text += line[index];
    index += 1;
  }
  if (text) out.push({ text, fill, bold });
  return out;
}

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escape(text) {
  return text.replace(/[&<>]/g, (char) => ESCAPE[char] ?? char);
}

function toSvg(lines, theme, { title }) {
  const width = Math.round(COLUMNS * CELL + PAD * 2);
  const chrome = 34;
  const height = Math.round(lines.length * LINE + PAD * 2 + chrome);
  const dots = ["#ff5f56", "#ffbd2e", "#27c93f"]
    .map((color, at) => `<circle cx="${PAD + 5 + at * 16}" cy="17" r="5" fill="${color}"/>`)
    .join("");
  const body = lines
    .map((line, at) => {
      const y = PAD + chrome + at * LINE + FONT_SIZE;
      const spans = runs(line)
        .map((run) => {
          const attrs = [`fill="${run.fill ?? theme.colors.fg}"`];
          if (run.bold) attrs.push('font-weight="600"');
          return `<tspan ${attrs.join(" ")}>${escape(run.text)}</tspan>`;
        })
        .join("");
      return `<text x="${PAD}" y="${y}" xml:space="preserve">${spans}</text>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
  <rect width="${width}" height="${height}" rx="${RADIUS}" fill="#181825"/>
  <rect width="${width}" height="${chrome}" rx="${RADIUS}" fill="#11111b"/>
  <rect y="${chrome - RADIUS}" width="${width}" height="${RADIUS}" fill="#11111b"/>
  ${dots}
  <text x="${width / 2}" y="21" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#6c7086">${escape(title)}</text>
  <g font-family="${FONT}" font-size="${FONT_SIZE}">
  ${body}
  </g>
</svg>
`;
}

function write(name, lines, theme, title) {
  const file = path.join(ROOT, "assets", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toSvg(lines, theme, { title }));
  process.stdout.write(`${path.relative(ROOT, file)}  ${lines.length} lines\n`);
}

const theme = loadTheme("default");
const HEAD_LEFT = " SaveMyTokens · Claude Code · 5h";
const HEAD_RIGHT = "read just now  plan ";
const frame = (body, footer) => [
  ` \u001b[38;2;137;180;250mSaveMyTokens\u001b[0m \u001b[38;2;147;153;178m· Claude Code · 5h\u001b[0m${" ".repeat(Math.max(1, COLUMNS - HEAD_LEFT.length - HEAD_RIGHT.length))}\u001b[38;2;147;153;178mread just now\u001b[0m  \u001b[38;2;137;180;250mplan\u001b[0m `,
  `\u001b[38;2;147;153;178m${"─".repeat(COLUMNS)}\u001b[0m`,
  ...body,
  `\u001b[38;2;147;153;178m${"─".repeat(COLUMNS)}\u001b[0m`,
  footer,
];

write(
  "screenshot.svg",
  frame(
    planRows(CONTROL, context(theme, COLUMNS)),
    `[38;2;147;153;178m  ↑↓ select   ←→ target   a promote   x drop   p priority   ⏎ open   f pin   , settings   ? help   q quit[0m`,
  ),
  theme,
  "savemytokens",
);

write("help.svg", helpOverlay(CONTROL, context(theme, COLUMNS)), theme, "savemytokens · help");
