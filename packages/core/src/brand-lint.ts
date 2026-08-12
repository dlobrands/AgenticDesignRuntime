import type { BrandKitRecord } from "./brand.js";
import { RuntimeError } from "./errors.js";
import type { FrameDocument, ProjectDocument, SceneNode } from "./model.js";
import { listNodes } from "./scene.js";
import { validateFrameBrandBindings } from "./live-brand-bindings.js";

export type BrandLintFinding = {
  code:
    | "BRAND_STATE_INVALID"
    | "GENERIC_TOKEN_NAME"
    | "DUPLICATE_DISPLAY_NAME"
    | "UNBOUND_TOKEN_VALUE";
  severity: "error" | "warning" | "info";
  message: string;
  frameId?: string;
  nodeId?: string;
  collection?:
    | "palette"
    | "typeRoles"
    | "effectStyles"
    | "radiusTokens"
    | "spacingTokens"
    | "variableModes"
    | "logos"
    | "definitions";
  key?: string;
  property?: "fill" | "stroke" | "textColor";
};

export type BrandLintReport = {
  kitId: string;
  kitRevision: number;
  deterministic: true;
  findings: BrandLintFinding[];
  summary: { errors: number; warnings: number; info: number };
};

type BrandPin = NonNullable<ProjectDocument["brandKitPin"]>;

const genericName =
  /^(color|type|style|radius|spacing|mode|logo|component|template)\s*\d+$/i;

const collectionEntries = (kit: BrandKitRecord) =>
  [
    ["palette", kit.palette],
    ["typeRoles", kit.typeRoles],
    ["effectStyles", kit.effectStyles ?? []],
    ["radiusTokens", kit.radiusTokens ?? []],
    ["spacingTokens", kit.spacingTokens ?? []],
    ["variableModes", kit.variableModes ?? []],
    ["logos", kit.logos],
    ["definitions", kit.definitions],
  ] as const;

const bindingFor = (
  node: SceneNode,
  property: "fill" | "stroke" | "textColor",
): boolean =>
  node.brandBindings?.some((binding) => binding.property === property) ?? false;

export const auditBrandFrame = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  includeKitOrganization?: boolean;
}): BrandLintReport => {
  const findings: BrandLintFinding[] = [];
  if (input.includeKitOrganization !== false)
    for (const [collection, entries] of collectionEntries(input.kit)) {
      const names = new Map<string, string>();
      for (const entry of entries) {
        if (genericName.test(entry.name.trim()))
          findings.push({
            code: "GENERIC_TOKEN_NAME",
            severity: "warning",
            message: `${entry.name} should be replaced with an intentional design-system name.`,
            collection,
            key: entry.key,
          });
        const normalized = entry.name.trim().toLocaleLowerCase();
        const previous = names.get(normalized);
        if (previous)
          findings.push({
            code: "DUPLICATE_DISPLAY_NAME",
            severity: "warning",
            message: `${entry.name} is used by both ${previous} and ${entry.key}.`,
            collection,
            key: entry.key,
          });
        else names.set(normalized, entry.key);
      }
    }
  try {
    validateFrameBrandBindings({
      frame: input.frame,
      pin: input.pin,
      kit: input.kit,
    });
  } catch (error) {
    const runtime =
      error instanceof RuntimeError
        ? error
        : new RuntimeError("INVALID_OPERATION", String(error));
    findings.push({
      code: "BRAND_STATE_INVALID",
      severity: "error",
      message: runtime.message,
      frameId: input.frame.id,
    });
  }
  const paletteByColor = new Map(
    input.kit.palette.map((token) => [token.color.toUpperCase(), token]),
  );
  for (const node of listNodes(input.frame)) {
    if (
      (node.type === "rectangle" ||
        node.type === "ellipse" ||
        node.type === "vectorPath") &&
      node.fill?.type === "solid" &&
      !bindingFor(node, "fill")
    ) {
      const token = paletteByColor.get(node.fill.color.toUpperCase());
      if (token)
        findings.push({
          code: "UNBOUND_TOKEN_VALUE",
          severity: "info",
          message: `${node.name} fill matches ${token.name} but is not live-bound.`,
          frameId: input.frame.id,
          nodeId: node.id,
          collection: "palette",
          key: token.key,
          property: "fill",
        });
    }
    if (node.type === "text" && !bindingFor(node, "textColor")) {
      const token = paletteByColor.get(node.typography.color.toUpperCase());
      if (token)
        findings.push({
          code: "UNBOUND_TOKEN_VALUE",
          severity: "info",
          message: `${node.name} text color matches ${token.name} but is not live-bound.`,
          frameId: input.frame.id,
          nodeId: node.id,
          collection: "palette",
          key: token.key,
          property: "textColor",
        });
    }
  }
  return {
    kitId: input.kit.id,
    kitRevision: input.kit.revision,
    deterministic: true,
    findings,
    summary: {
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning")
        .length,
      info: findings.filter((finding) => finding.severity === "info").length,
    },
  };
};
