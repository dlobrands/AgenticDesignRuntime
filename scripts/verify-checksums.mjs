import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
const directory = path.resolve(process.argv[2] ?? process.cwd());
const lines = (await readFile(path.join(directory, "SHA256SUMS"), "utf8"))
  .trim()
  .split(/\r?\n/);
const names = new Set();
for (const line of lines) {
  const match = /^([a-f0-9]{64}) {2}([^/\\:]+)$/.exec(line);
  if (!match || [".", ".."].includes(match[2]) || names.has(match[2]))
    throw new Error("Invalid or duplicate checksum entry.");
  names.add(match[2]);
  if (
    createHash("sha256")
      .update(await readFile(path.join(directory, match[2])))
      .digest("hex") !== match[1]
  )
    throw new Error(`Checksum mismatch: ${match[2]}`);
}
process.stdout.write(
  `${JSON.stringify({ status: "verified", files: names.size })}\n`,
);
