import type { ControlPlan } from "../scheduler/plan.js";
import { activeViews } from "../scheduler/plan.js";
import { formatReset, meterBar, paint, pressureRole, type ClaimantPlanView, type Theme } from "../runtime/kernel.mjs";
import { padEndVisible, padStartVisible, visibleWidth } from "../util/ansi.js";
import { ago, compactNumber } from "../util/fmt.js";

const BAR_WIDTH = 10;
const STATE_MARK: Record<string, string> = { active: "•", "needs-more": "+", done: "✓", blocked: "!" };

export interface ScheduleRenderOptions {
  theme: Theme;
  selected?: number;
  interactive?: boolean;
  color?: boolean;
  columns?: number;
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function clip(text: string, max: number): string {
  if (max <= 1) return "";
  return visibleWidth(text) <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function capacityLines(control: ControlPlan, options: ScheduleRenderOptions, now: number): string[] {
  const { theme, color = true } = options;
  const out: string[] = [];
  const published = control.resources.filter((resource) => resource.usedPercent !== null);

  const label = `${control.provider.label} capacity`;
  if (published.length === 0) {
    out.push(`  ${paint(theme, "dim", label, color)}  ${paint(theme, "warn", "not published to this machine yet", color)}`);
    out.push(
      `  ${paint(theme, "dim", control.provider.id === "claude-code" ? "Anthropic publishes your 5h and 7d usage to the status line only. Run: npx savemytokens install" : "No session has written a rate limit to disk in this window.", color)}`,
    );
    return out;
  }

  const asOf = control.schedule.quota?.at ?? 0;
  out.push(`  ${paint(theme, "dim", label, color)}  ${paint(theme, "dim", `published · read ${ago(asOf, now)}`, color)}`);
  for (const resource of published) {
    const used = resource.usedPercent ?? 0;
    const key = resource.id.split(":")[1] ?? "";
    const label = key === "five_hour" ? "5h" : key === "seven_day" ? "7d" : "spend";
    const reset = resource.window.resetsAt ? `resets ${formatReset(resource.window.resetsAt, now)}` : "";
    out.push(
      `    ${padEndVisible(label, 5)} ${meterBar(theme, used / 100, BAR_WIDTH, pressureRole(used / 100), color)} ${padStartVisible(percent(used), 4)} ${paint(theme, "dim", `used · ${reset}`, color)}`,
    );
  }
  return out;
}

function rowFor(
  view: ClaimantPlanView,
  index: number,
  widths: { label: number; prompt: number; name: string },
  options: ScheduleRenderOptions,
  attributed: boolean,
): string {
  const { theme, selected, color = true } = options;
  const chosen = selected === index;
  const cursor = chosen ? paint(theme, "accent", "❯ ", color) : "  ";
  const mark = paint(
    theme,
    view.state === "blocked" ? "danger" : view.state === "done" ? "dim" : "ok",
    STATE_MARK[view.state] ?? "•",
    color,
  );
  const label = padEndVisible(clip(widths.name, widths.label), widths.label);
  const pinned = view.allocation.pinned ? paint(theme, "dim", "*", color) : " ";
  const running = view.state === "active" || view.state === "needs-more";
  const role = running ? pressureRole(view.pressure.value) : "dim";
  const target = padStartVisible(percent(view.allocation.target * 100), 6);
  const used = attributed
    ? padStartVisible(paint(theme, role, percent(view.attributedPercent ?? 0), color), 6)
    : "";
  const share = padStartVisible(
    paint(theme, attributed ? "dim" : role, percent(view.observed * 100), color),
    6,
  );
  const priority = padEndVisible(
    paint(theme, view.claimant.priority === "high" ? "accent" : "dim", view.claimant.priority.toUpperCase(), color),
    8,
  );
  const prompt = paint(theme, "dim", clip(view.claimant.prompt || "—", widths.prompt), color);
  return `${cursor}${mark} ${label} ${target}${pinned}${used}  ${share}  ${priority} ${prompt}`;
}

export function renderSchedule(control: ControlPlan, options: ScheduleRenderOptions): string {
  const { theme, color = true, interactive = false } = options;
  const now = control.schedule.now;
  const columns = Math.max(60, Math.min(options.columns ?? 100, 120));
  const views = activeViews(control.schedule);
  const out: string[] = [""];

  const windowLabel = control.schedule.key === "seven_day" ? "7-day window" : "5-hour window";
  out.push(
    `  ${paint(theme, "accent", "SaveMyTokens", color)} ${paint(theme, "dim", `· ${control.provider.label} · ${windowLabel}`, color)}`,
  );
  out.push("");
  out.push(...capacityLines(control, options, now));
  out.push("");

  const attributed = control.schedule.live !== null;
  const seen = new Map<string, number>();
  for (const view of views) seen.set(view.claimant.label, (seen.get(view.claimant.label) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const view of views) {
    const base = view.claimant.label || view.claimant.id.slice(0, 8);
    const started = new Date(view.claimant.startedAt);
    const stamp = `${String(started.getHours()).padStart(2, "0")}:${String(started.getMinutes()).padStart(2, "0")}`;
    labels.set(view.claimant.id, (seen.get(view.claimant.label) ?? 0) > 1 ? `${base} ${stamp}` : base);
  }
  const stamped = new Map<string, number>();
  for (const label of labels.values()) stamped.set(label, (stamped.get(label) ?? 0) + 1);
  for (const [id, label] of labels) {
    if ((stamped.get(label) ?? 0) > 1) labels.set(id, `${label}·${id.slice(0, 4)}`);
  }
  const labelWidth = Math.min(22, Math.max(9, ...[...labels.values()].map((label) => label.length)));
  const promptWidth = Math.max(16, columns - labelWidth - (attributed ? 38 : 30));

  out.push(
    paint(
      theme,
      "dim",
      `    ${padEndVisible("session", labelWidth)} ${padStartVisible("target", 6)}${attributed ? ` ${padStartVisible("used", 6)}` : ""}  ${padStartVisible("share", 6)}  ${padEndVisible("priority", 8)} last prompt`,
      color,
    ),
  );

  if (views.length === 0) {
    out.push("");
    out.push(`    ${paint(theme, "dim", `No ${control.provider.label} sessions in this window.`, color)}`);
  }
  for (const [index, view] of views.entries()) {
    out.push(
      rowFor(
        view,
        index,
        { label: labelWidth, prompt: promptWidth, name: labels.get(view.claimant.id) ?? view.claimant.label },
        options,
        attributed,
      ),
    );
  }

  out.push("");
  out.push(
    `    ${paint(theme, "dim", "spare target capacity", color)}  ${paint(theme, control.schedule.unusedPool > 0.01 ? "warn" : "dim", percent(control.schedule.unusedPool * 100), color)}`,
  );

  const basis = control.schedule.live
    ? `target and used are percentages of the 5h window Anthropic publishes; share is this session's part of ${compactNumber(control.schedule.totalWeighted)} weighted tokens measured on disk, and used is ${percent(control.schedule.live.usedPercent)} × that share`
    : `no published window on this machine, so target and share are portions of the ${compactNumber(control.schedule.totalWeighted)} weighted tokens measured on disk`;
  for (const line of basis.match(/.{1,92}(\s|$)/g) ?? [basis]) {
    out.push(`    ${paint(theme, "dim", line.trim(), color)}`);
  }

  const enforcement =
    control.enforcement.length > 0
      ? `enforcement: ${control.enforcement.join(", ")} only — a hook injects text, nothing here can hold a session to a number`
      : `${control.provider.label} has no hook to inject through, so this view is visibility only`;
  out.push(`    ${paint(theme, "dim", enforcement, color)}`);

  const policy = control.config.policyFor?.[process.cwd()] ?? control.config.policy;
  out.push(
    `    ${paint(theme, "dim", `when a session passes its target: policy ${policy} · npx savemytokens policy`, color)}`,
  );

  if (control.deferred.length > 0) {
    out.push("");
    out.push(`    ${paint(theme, "warn", "deferred to the next session", color)}`);
    for (const group of control.deferred.slice(0, 3)) {
      const name = group.project.split("/").pop() || group.project;
      for (const item of group.items.slice(-2)) {
        out.push(`      ${paint(theme, "dim", `${name} · ${clip(item.text, columns - 20)}`, color)}`);
      }
    }
  }

  for (const other of control.others) {
    const published = other.resources.filter((resource) => resource.usedPercent !== null);
    if (published.length === 0) continue;
    const parts = published.map((resource) => {
      const key = resource.id.split(":")[1] ?? "";
      return `${key === "seven_day" ? "7d" : "5h"} ${percent(resource.usedPercent ?? 0)}`;
    });
    out.push("");
    out.push(
      `    ${paint(theme, "dim", `${other.label}: ${parts.join(" · ")} — npx savemytokens --adapter ${other.id}`, color)}`,
    );
  }

  if (control.unattributed !== null) {
    out.push(
      `    ${paint(theme, "warn", `${percent(control.unattributed)} of the window moved while no local session was running`, color)}`,
    );
  }
  if (control.schedule.lockouts.length > 0) {
    const last = control.schedule.lockouts[control.schedule.lockouts.length - 1] ?? 0;
    out.push(`    ${paint(theme, "danger", `hit the limit ${control.schedule.lockouts.length}× this window, last ${ago(last, now)}`, color)}`);
  }

  out.push("");
  if (interactive) {
    const preserve = control.config.preserveFor[process.cwd()] ?? control.config.preserveFor.default;
    out.push(
      paint(
        theme,
        "dim",
        `    preserving ${preserve && preserve.length > 0 ? preserve.join(", ") : "testing and finalisation (default)"} · P to change`,
        color,
      ),
    );
    out.push(
      paint(
        theme,
        "dim",
        "    ↑↓ select   ←→ target   p priority   e equalize   d done   b blocked   a active   q quit",
        color,
      ),
    );
    out.push("");
  }
  return out.join("\n");
}
