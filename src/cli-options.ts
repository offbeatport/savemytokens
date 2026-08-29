export interface Options {
  command: string;
  days: number;
  project: string | null;
  json: boolean;
  verbose: boolean;
  save: boolean;
  interval: number;
  help: boolean;
  version: boolean;
}

const COMMANDS = new Set(["audit", "watch", "history", "privacy", "fix", "help"]);

export function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: "audit",
    days: 7,
    project: null,
    json: false,
    verbose: false,
    save: true,
    interval: 60,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("-") && COMMANDS.has(arg)) {
      options.command = arg;
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
        break;
      case "--project": {
        const value = argv[++i];
        if (value) options.project = value;
        break;
      }
      case "--all":
        options.project = null;
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
