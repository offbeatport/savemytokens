import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../web", import.meta.url));
const page = path.join(WEB, "index.html");

function stamp(file) {
  const full = path.join(WEB, file);
  if (!fs.existsSync(full)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex").slice(0, 8);
}

let html = fs.readFileSync(page, "utf8");
const changed = [];

html = html.replace(/(src|href)="([\w.-]+\.(?:svg|png|jpg|css|js))(\?v=[0-9a-f]+)?"/g, (match, attr, file, old) => {
  const version = stamp(file);
  if (!version) return match;
  const next = `${attr}="${file}?v=${version}"`;
  if (old !== `?v=${version}`) changed.push(`${file}  ${old ? old.slice(3) : "unstamped"} -> ${version}`);
  return next;
});

fs.writeFileSync(page, html);
process.stdout.write(
  changed.length === 0
    ? "  every asset already carries its own fingerprint\n"
    : `  ${changed.map((line) => line).join("\n  ")}\n`,
);
