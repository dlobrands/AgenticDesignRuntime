import type { FrameDocument } from "./model.js";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

export const stableStringify = (value: unknown, pretty = false): string =>
  `${JSON.stringify(canonicalize(value), null, pretty ? 2 : undefined)}${pretty ? "\n" : ""}`;

const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

export const sha256 = async (value: string | Uint8Array): Promise<string> => {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
};

export const semanticFrameValue = (frame: FrameDocument) => ({
  schemaVersion: frame.schemaVersion,
  id: frame.id,
  slug: frame.slug,
  name: frame.name,
  canvas: frame.canvas,
  root: frame.root,
});

export const semanticFrameHash = (frame: FrameDocument): Promise<string> =>
  sha256(stableStringify(semanticFrameValue(frame)));

export const fullDocumentHash = (value: unknown): Promise<string> =>
  sha256(stableStringify(value, true));

export const deterministicSeed = (...parts: string[]): number => {
  let hash = 2_166_136_261;
  for (const character of parts.join("\u0000")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};
