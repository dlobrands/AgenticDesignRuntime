import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(target) : Promise.resolve([target]);
      }),
    )
  ).flat();
};

const roots = [
  path.join(root, "apps", "runtime", "dist"),
  path.join(root, "apps", "runtime", "studio"),
  path.join(root, "apps", "mcp", "dist"),
];
const files = (await Promise.all(roots.map(walk))).flat();
const sourceMaps = files.filter((file) => file.endsWith(".map"));
if (sourceMaps.length)
  throw new Error(
    `Production build contains source maps: ${sourceMaps.map((file) => path.relative(root, file)).join(", ")}`,
  );

const studioRoot = path.join(root, "apps", "runtime", "studio");
const studioFiles = files.filter((file) =>
  file.startsWith(`${studioRoot}${path.sep}`),
);
const fonts = studioFiles.filter((file) => /\.woff2?$/.test(file));
if (fonts.length !== 4 || fonts.some((file) => !file.endsWith(".woff2")))
  throw new Error(
    `Production Studio must contain exactly four WOFF2 interface fonts; found ${fonts.length}.`,
  );

if (
  await stat(path.join(root, "apps", "runtime", "fonts"))
    .then(() => true)
    .catch(() => false)
)
  throw new Error("Legacy duplicate runtime font directory still exists.");

const sizeOf = async (selected) =>
  (
    await Promise.all(
      selected.map((file) => stat(file).then((entry) => entry.size)),
    )
  ).reduce((total, size) => total + size, 0);
const budgets = [
  ["runtime Studio", studioFiles, 4 * 1024 * 1024],
  [
    "MCP bundle",
    files.filter((file) =>
      file.includes(`${path.sep}apps${path.sep}mcp${path.sep}dist${path.sep}`),
    ),
    5 * 1024 * 1024,
  ],
  [
    "runtime bundle",
    files.filter((file) =>
      file.includes(
        `${path.sep}apps${path.sep}runtime${path.sep}dist${path.sep}`,
      ),
    ),
    2 * 1024 * 1024,
  ],
];
for (const [name, selected, budget] of budgets) {
  const size = await sizeOf(selected);
  if (size > budget)
    throw new Error(`${name} is ${size} bytes; budget is ${budget} bytes.`);
}

const mcpPackage = JSON.parse(
  await readFile(path.join(root, "apps", "mcp", "package.json"), "utf8"),
);
if (Object.keys(mcpPackage.dependencies ?? {}).length)
  throw new Error(
    "The fully bundled MCP package must not declare production dependencies.",
  );

process.stdout.write(
  `${JSON.stringify({ files: files.length, fonts: fonts.length, sourceMaps: 0 })}\n`,
);
