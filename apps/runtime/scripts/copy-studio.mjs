import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const runtimeRoot = path.resolve(import.meta.dirname, "..");
const source = path.resolve(runtimeRoot, "../studio/dist");
const target = path.join(runtimeRoot, "studio");
const fontsTarget = path.join(runtimeRoot, "fonts");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true });
await rm(fontsTarget, { recursive: true, force: true });
