export const normalizePersistedPath = (value: string): string =>
  value.replaceAll("\\", "/");

export const assertSafeRelativePath = (value: string): string => {
  const normalized = normalizePersistedPath(value);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new Error("Absolute paths are prohibited.");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new Error("Path traversal is prohibited.");
  }
  return normalized;
};

export const isPathInside = (root: string, candidate: string): boolean => {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  return candidate === root || candidate.startsWith(normalizedRoot);
};
