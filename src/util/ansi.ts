const ESC = "\u001b[";
const RESET = `${ESC}0m`;

const enabled =
  process.env.NO_COLOR === undefined && process.env.TERM !== "dumb" && Boolean(process.stdout.isTTY);

function wrap(code: string) {
  return (text: string): string => (enabled ? `${ESC}${code}m${text}${RESET}` : text);
}

export const bold = wrap("1");
export const dim = wrap("2");
export const green = wrap("32");
export const yellow = wrap("33");
export const red = wrap("31");
export const colorEnabled = enabled;
