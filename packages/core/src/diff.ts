import type { StructuredDiffEntry } from "./operations.js";
import { stableStringify } from "./canonical.js";

const equal = (left: unknown, right: unknown): boolean =>
  stableStringify(left) === stableStringify(right);

export const structuredDiff = (
  before: unknown,
  after: unknown,
  basePath = "",
): StructuredDiffEntry[] => {
  if (equal(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const entries: StructuredDiffEntry[] = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const path = `${basePath}/${index}`;
      if (index >= before.length)
        entries.push({ path, kind: "added", after: after[index] });
      else if (index >= after.length)
        entries.push({ path, kind: "removed", before: before[index] });
      else entries.push(...structuredDiff(before[index], after[index], path));
    }
    return entries;
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object"
  ) {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    const keys = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort();
    return keys.flatMap((key) => {
      const path = `${basePath}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (!(key in left))
        return [{ path, kind: "added" as const, after: right[key] }];
      if (!(key in right))
        return [{ path, kind: "removed" as const, before: left[key] }];
      return structuredDiff(left[key], right[key], path);
    });
  }
  return [{ path: basePath || "/", kind: "changed", before, after }];
};
