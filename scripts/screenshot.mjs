import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_HUD_SEGMENTS, POLICIES, loadTheme, renderSegments, stageText } from "../dist/runtime/kernel.mjs";
import { helpOverlay, labelsFor, planRows } from "../dist/report/views.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COLUMNS = 122;
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
      pinnedAt: options.pinned ? START - (10 - options.pinned) * 1000 : 0,
      parked: false,
      kept: options.member === false ? false : true,
    },
    sessions: [],
    allocation: { claimantId: label, target: options.live ? options.target : 0, pinned: options.pinned ? options.target : null, pool: 0, released: !options.live },
    observed: options.observed ?? options.target * 0.8,
    usage: { tokens: options.tokens, weighted: options.tokens * 2, requests: options.requests },
    lastSeen: START - (options.lastSeen ?? 90_000),
    bucket: options.live ? "active" : "recent",
    consuming: Boolean(options.live),
    attributedPercent: Math.round(options.target * 100 * 0.42),
    pressure: { value: options.used, basis: "budget" },
    prompt: options.prompt,
    liveSessions: options.sessions ?? (options.live ? 1 : 0),
  };
}

const PROJECTS = [
  project("burningdemand", {
    target: 0.2, used: 0.71, tokens: 1_640_000, requests: 88,
    priority: "high", pinned: 1, live: true,
    prompt: "Rewrite the ingest queue so a failed batch retries once",
  }),
  project("autonomykernel", {
    target: 0.18, used: 0.44, tokens: 1_210_000, requests: 64,
    priority: "normal", pinned: 2, live: true,
    prompt: "Add the policy loader and wire it to the scheduler",
  }),
  project("coldverdict", {
    target: 0.12, used: 0.93, tokens: 980_000, requests: 51,
    priority: "low", pinned: 3, live: true,
    prompt: "Compare the two ranking passes on last week's data",
  }),
  project("savemytokens", {
    target: 0.18, used: 0.52, tokens: 1_430_000, requests: 96,
    priority: "normal", live: true, sessions: 2,
    prompt: "Regenerate the screenshots with the new pin order",
  }),
  project("reposhine", {
    target: 0.14, used: 0.31, tokens: 720_000, requests: 40,
    priority: "normal", live: true,
    prompt: "Draft the plan for the ingest rewrite",
  }),
  project("webinvoke", {
    target: 0.11, used: 0.18, tokens: 410_000, requests: 22,
    priority: "normal", live: true,
    prompt: "Implement the provider fallback chain end to end",
  }),
  project("cslopslop", {
    target: 0.07, used: 0.06, tokens: 180_000, requests: 11,
    priority: "low", live: true,
    prompt: "Fix the verdict table alignment on mobile",
  }),
  project("picsuper", {
    target: 0.1, used: 0, observed: 0, tokens: 0, requests: 0,
    priority: "normal", live: false, lastSeen: 40 * 60_000,
    prompt: "Compare the two upscalers on the same source",
  }),
  project("meshaway", {
    target: 0, used: 0, observed: 0, tokens: 0, requests: 0,
    priority: "normal", live: false, member: false,
    lastSeen: 5 * 3600_000, prompt: "Try the alternate parser and compare the output",
  }),
  project("polarbase", {
    target: 0, used: 0, observed: 0, tokens: 0, requests: 0,
    priority: "normal", live: false, member: false,
    lastSeen: 9 * 3600_000, prompt: "Move the migrations into their own package",
  }),
  project("obp-ui", {
    target: 0, used: 0, observed: 0, tokens: 0, requests: 0,
    priority: "normal", live: false, member: false,
    lastSeen: 2 * 24 * 3600_000, prompt: "yes, that's it. commit push",
  }),
  project("proto", {
    target: 0, used: 0, observed: 0, tokens: 0, requests: 0,
    priority: "normal", live: false, member: false,
    lastSeen: 3 * 24 * 3600_000, prompt: "Sketch the ingest schema",
  }),
  project("alphadiff", {
    target: 0, used: 0, observed: 0, tokens: 0, requests: 0,
    priority: "normal", live: false, member: false,
    lastSeen: 4 * 24 * 3600_000, prompt: "Check the diff viewer against the golden files",
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

function toSvg(lines, theme, { title, columns = COLUMNS, bare = false }) {
  const width = Math.round(columns * CELL + PAD * 2);
  const chrome = bare ? 12 : 34;
  const height = Math.round(lines.length * LINE + PAD * 2 + chrome);
  const dots = bare
    ? ""
    : ["#ff5f56", "#ffbd2e", "#27c93f"].map((color, at) => `<circle cx="${PAD + 5 + at * 16}" cy="17" r="5" fill="${color}"/>`).join("");
  const body = lines
    .map((line, at) => {
      const y = PAD + chrome + at * LINE + FONT_SIZE;
      const parts = runs(line);
      const used = parts.reduce((total, run) => total + [...run.text].length, 0);
      if (used < columns) parts.push({ text: " ".repeat(columns - used), fill: null, bold: false });
      const spans = parts
        .map((run) => {
          const attrs = [`fill="${run.fill ?? theme.colors.fg}"`];
          if (run.bold) attrs.push('font-weight="600"');
          return `<tspan ${attrs.join(" ")}>${escape(run.text)}</tspan>`;
        })
        .join("");
      const advance = (Math.max(used, columns) * CELL).toFixed(1);
      return `<text x="${PAD}" y="${y}" xml:space="preserve" textLength="${advance}" lengthAdjust="spacing">${spans}</text>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
  <rect width="${width}" height="${height}" rx="${RADIUS}" fill="#181825"/>
  <rect width="${width}" height="${chrome}" rx="${RADIUS}" fill="#11111b"/>
  ${bare ? "" : `<rect y="${chrome - RADIUS}" width="${width}" height="${RADIUS}" fill="#11111b"/>`}
  ${dots}
  ${bare ? "" : `<text x="${width / 2}" y="21" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#6c7086">${escape(title)}</text>`}
  <g font-family="${FONT}" font-size="${FONT_SIZE}">
  ${body}
  </g>
</svg>
`;
}

function write(name, lines, theme, title, columns, bare = false) {
  const file = path.join(ROOT, "assets", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toSvg(lines, theme, { title, columns, bare }));
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
    `[38;2;147;153;178m  ↑↓ select   ←→ target   space up   x down   p priority   e even   ⏎ open   m all   f pin   s settings   ? help   q quit[0m`,
  ),
  theme,
  "savemytokens",
);

write("help.svg", helpOverlay(CONTROL, context(theme, COLUMNS)), theme, "savemytokens · help");

const hudView = {
  label: "webinvoke",
  project: "/Users/you/webinvoke",
  target: 0.5,
  observed: 0.44,
  used: 21,
  pressure: 0.42,
  priority: "high",
  now: START,
  quota: {
    five_hour: { usedPercent: 42, resetsAt: Math.floor(START / 1000) + 13920 },
    seven_day: { usedPercent: 18 },
  },
};

const STRIP = 64;
const strip = renderSegments(DEFAULT_HUD_SEGMENTS, hudView, theme, true);
write(
  "statusline.svg",
  [
    `\u001b[38;2;137;180;250m>\u001b[0m \u001b[38;2;205;214;244mImplement the provider fallback chain end to end\u001b[0m`,
    "",
    strip,
  ],
  theme,
  "claude",
  STRIP,
);

const EXAMPLE = COLUMNS;
const full = planRows(CONTROL, context(theme, EXAMPLE));
const from = full.findIndex((line) => line.includes("ACTIVE"));
const to = full.findIndex((line, at) => at > from && line.includes("RECENT"));
write("example.svg", full.slice(from, to - 1), theme, "savemytokens", EXAMPLE);

const CARD_W = 1280;
const CARD_H = 640;
const shotLines = frame(planRows(CONTROL, context(theme, COLUMNS)).slice(0, 12), "");
const body = shotLines.slice(0, -2);
const shot = toSvg(body, theme, { title: "savemytokens", columns: COLUMNS });
const inner = shot.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const shotW = Math.round(COLUMNS * CELL + PAD * 2);
const shotH = Math.round(body.length * LINE + PAD * 2 + 34);
const scale = Math.min((CARD_W - 140) / shotW, (CARD_H - 250) / shotH);
const x = (CARD_W - shotW * scale) / 2;

fs.writeFileSync(
  path.join(ROOT, "assets", "social.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="#0d0d14"/>
  <g transform="translate(${(CARD_W - 340) / 2} 62)">
    <g transform="translate(0 -6) scale(1.7)" fill="none" stroke="#89b4fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M16.924 11.132a5 5 0 1 0 -4.056 5.792"/><path d="M3 12a9 9 0 1 0 9 -9"/>
    </g>
    <text x="56" y="30" font-family="${FONT}" font-size="34" font-weight="700" fill="#e9e9f0">SaveMyTokens</text>
  </g>
  <text x="${CARD_W / 2}" y="132" text-anchor="middle" font-family="${FONT}" font-size="19" fill="#9a9aac">Decide which projects get your Claude allowance</text>
  <g transform="translate(${x} 172) scale(${scale})">${inner}</g>
</svg>
`,
);
process.stdout.write("assets/social.svg  " + CARD_W + "x" + CARD_H + "\n");

const COMMANDS = [
  ["", "the control centre"],
  ["status", "one plain-text snapshot · --json for a script"],
  ["share buydiff 40", "pin a project's allocation"],
  ["priority buydiff high", "who gets spare capacity first"],
  ["release buydiff", "hand its unused share back"],
  ["policy strict", "wind down earlier when it gets tight"],
  ["hud", "pick a status line, previewed on your numbers"],
  ["theme", "eighteen themes, or write your own"],
  ["defer", "work a session pushed to next time"],
  ["audit", "what your last 7 days wasted"],
  ["privacy", "every file it reads and writes"],
  ["uninstall", "remove every trace · --purge drops the data too"],
];

const CMD_COL = Math.max(...COMMANDS.map(([name]) => `npx savemytokens ${name}`.trimEnd().length)) + 3;
const CMD_W = COLUMNS;
write(
  "commands.svg",
  COMMANDS.map(([name, what]) => {
    const call = `npx savemytokens ${name}`.trimEnd();
    const pad = " ".repeat(CMD_COL - call.length);
    return `  \u001b[38;2;137;180;250m$\u001b[0m \u001b[38;2;205;214;244m${call}\u001b[0m${pad}\u001b[38;2;147;153;178m${what}\u001b[0m`;
  }),
  theme,
  "savemytokens",
  CMD_W,
);

const FEAT = 74;
const dim = (text) => `\u001b[38;2;147;153;178m${text}\u001b[0m`;
const all = planRows(CONTROL, context(theme, FEAT));
const headerAt = all.findIndex((line) => line.includes("PROJECT"));

write("f-numbers.svg", [all[0]], theme, "", FEAT, true);
write("f-share.svg", [all[headerAt], ...all.slice(headerAt + 1, headerAt + 4)], theme, "", FEAT, true);
const restingAt = all.findIndex((line, at) => at > headerAt && line.includes("idle"));
write("f-resting.svg", [all[headerAt], all[restingAt]], theme, "", FEAT, true);

const advice = stageText(80, {
  target: 0.2,
  observed: 0.16,
  pressure: 0.84,
  basis: "budget",
  preserve: ["tests"],
  policy: POLICIES.finish,
  custom: "",
});
const wrapAt = (text, width) => {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
};
write(
  "f-agent.svg",
  wrapAt(`[savemytokens] 84% of your 20% target share of this Claude window is spent. ${advice}`, FEAT - 4)
    .slice(0, 5)
    .map((line) => `  ${dim(line)}`),
  theme,
  "",
  FEAT,
  true,
);
write(
  "f-defer.svg",
  [
    `  \u001b[38;2;137;180;250mDeferred work\u001b[0m`,
    "",
    `  ${dim("obp-ui")}`,
    `    ${dim("give Codex an injection point, not just metering")}`,
    `    ${dim("a three-session allocation demo for the launch")}`,
  ],
  theme,
  "",
  FEAT,
  true,
);
