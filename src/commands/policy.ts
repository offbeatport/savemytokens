import type { Options } from "../cli-options.js";
import { POLICIES, deferredProjects, loadConfig, policyFor, policyNames } from "../runtime/kernel.mjs";
import { forgetDeferred, savePreference, setPolicy } from "../scheduler/plan.js";
import { bold, dim, green } from "../util/ansi.js";

const PRESERVE_KINDS = ["implementation", "tests", "end-to-end checks", "documentation", "exploration"];

function show(project: string): void {
  const config = loadConfig();
  const active = policyFor(config, project);
  const preserve = config.preserveFor[project] ?? config.preserveFor.default ?? [];
  const out = ["", bold("When the window gets tight"), ""];
  out.push(`  policy    ${bold(active.name)} ${dim(`· ${active.summary}`)}`);
  out.push(`  preserve  ${preserve.length > 0 ? preserve.join(", ") : dim("testing and finalisation (default)")}`);
  out.push("");
  for (const name of policyNames()) {
    const policy = POLICIES[name];
    if (!policy) continue;
    const marker = name === active.name ? green("→") : " ";
    const stages =
      policy.stages.length > 0
        ? policy.stages.map((stage) => `${stage.at}% ${stage.actions.join("+")}`).join("   ")
        : "nothing is ever injected";
    out.push(`  ${marker} ${bold(name.padEnd(8))} ${dim(stages)}`);
  }
  out.push("");
  out.push(dim("  focus  stay on completion, batch tool calls, stop wide reading"));
  out.push(dim("  narrow cut scope to the smallest done version, start nothing new"));
  out.push(dim("  defer  write what is dropped as SMT: DEFER, and get it back next session"));
  out.push(dim("  verify finish what is open, run the tests, leave the tree clean"));
  out.push(dim("  handoff say where it stopped, then DONE / NEEDS_MORE / BLOCKED"));
  out.push("");
  out.push(dim("  npx savemytokens policy strict          set it everywhere"));
  out.push(dim("  npx savemytokens policy strict --here   set it for this project only"));
  out.push(dim("  npx savemytokens policy preserve tests documentation"));
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

export function runPolicy(options: Options): void {
  const project = options.project ?? process.cwd();
  const [first, ...rest] = options.args;

  if (!first) {
    show(project);
    return;
  }

  if (first === "preserve") {
    const kinds = rest
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map((value) => PRESERVE_KINDS.find((kind) => kind.startsWith(value)) ?? value);
    if (kinds.length === 0) {
      process.stdout.write(`\nWhat should be preserved? ${dim(PRESERVE_KINDS.join(", "))}\n\n`);
      process.exitCode = 1;
      return;
    }
    savePreference(options.projectExplicit ? project : "default", kinds);
    process.stdout.write(`\n${green("Will preserve")} ${bold(kinds.join(", "))}\n\n`);
    return;
  }

  if (!setPolicy(first, options.projectExplicit ? project : null)) {
    process.stdout.write(`\nNo policy called ${bold(first)}. Known: ${policyNames().join(", ")}\n\n`);
    process.exitCode = 1;
    return;
  }
  const scope = options.projectExplicit ? `for ${project.split("/").pop()}` : "everywhere";
  process.stdout.write(`\n${green("Policy")} ${bold(first)} ${dim(scope)}\n\n`);
}

export function runDefer(options: Options): void {
  const project = options.project ?? process.cwd();
  const [action] = options.args;
  const adapter = options.adapter;

  if (action === "clear") {
    const groups = deferredProjects(adapter);
    const targets = options.args[1] === "all" ? groups.map((group) => group.project) : [project];
    for (const target of targets) forgetDeferred(target, adapter);
    process.stdout.write(
      `\n${green("Cleared")} deferred work for ${bold(targets.map((value) => value.split("/").pop()).join(", "))}\n\n`,
    );
    return;
  }

  const groups = deferredProjects(adapter);
  const out = ["", bold("Deferred work"), ""];
  if (groups.length === 0) {
    out.push(dim("  Nothing yet. Sessions add to this when they report SMT: DEFER <one line>."));
  }
  for (const group of groups) {
    out.push(`  ${bold(group.project.split("/").pop() ?? group.project)}`);
    for (const item of group.items) out.push(`    · ${item.text}`);
    out.push("");
  }
  out.push(dim("  It is injected at the start of the next session in that project."));
  out.push(dim("  npx savemytokens defer clear --here"));
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}
