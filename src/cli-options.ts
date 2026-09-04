export interface Options {
  command: string;
  args: string[];
  days: number;
  project: string | null;
  projectExplicit: boolean;
  json: boolean;
  verbose: boolean;
  save: boolean;
  interval: number;
  dryRun: boolean;
  force: boolean;
  window: "five_hour" | "seven_day";
  adapter: string;
  view: string;
  rules: boolean;
  purge: boolean;
  help: boolean;
  version: boolean;
}

const COMMANDS = new Set([
  "control",
  "status",
  "share",
  "priority",
  "release",
  "pin",
  "park",
  "policy",
  "defer",
  "hud",
  "audit",
  "install",
  "uninstall",
  "watch",
  "history",
  "privacy",
  "theme",
  "help",
]);

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: "control",
    args: [],
    days: 7,
    project: null,
    projectExplicit: false,
    json: false,
    verbose: false,
    save: true,
    interval: 60,
    dryRun: false,
    force: false,
    window: "five_hour",
    adapter: "claude-code",
    view: "",
    rules: false,
    purge: false,
    help: false,
    version: false,
  };
  let commandSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("-")) {
      if (!commandSeen && COMMANDS.has(arg)) {
        options.command = arg;
        commandSeen = true;
      } else {
        options.args.push(arg);
      }
      continue;
    }
    switch (arg) {
      case "--days":
      case "-d": {
        const value = Number(argv[++i]);
        if (Number.isFinite(value) && value > 0) options.days = Math.min(365, Math.round(value));
        break;
      }
      case "--here":
        options.project = process.cwd();
        options.projectExplicit = true;
        break;
      case "--project": {
        const value = argv[++i];
        if (value) {
          options.project = value;
          options.projectExplicit = true;
        }
        break;
      }
      case "--all":
        options.project = null;
        options.projectExplicit = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      case "--no-save":
        options.save = false;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--window": {
        const value = String(argv[++i] ?? "");
        if (/^(7d|week|seven|seven_day)$/i.test(value)) options.window = "seven_day";
        else options.window = "five_hour";
        break;
      }
      case "--7d":
        options.window = "seven_day";
        break;
      case "--adapter": {
        const value = argv[++i];
        if (value) options.adapter = value;
        break;
      }
      case "--view": {
        const value = argv[++i];
        if (value) options.view = value;
        break;
      }
      case "--codex":
        options.adapter = "codex";
        break;
      case "--claude":
      case "--claude-code":
        options.adapter = "claude-code";
        break;
      case "--rules":
        options.rules = true;
        break;
      case "--purge":
        options.purge = true;
        break;
      case "--interval": {
        const value = Number(argv[++i]);
        if (Number.isFinite(value) && value >= 5) options.interval = Math.round(value);
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
        options.version = true;
        break;
      default:
        break;
    }
  }

  return options;
}
