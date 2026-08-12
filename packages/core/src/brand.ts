import { z } from "zod";
import type { SceneNode } from "./model.js";
import {
  AssetSchema,
  ComponentOverridePropertySchema,
  EffectsSchema,
  FontRecordSchema,
  SceneNodeSchema,
} from "./schema.js";
import { RuntimeError } from "./errors.js";
import { clone, descendantIds } from "./scene.js";

const uuid = z.string().uuid();
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const key = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

export const BrandPaletteTokenSchema = z
  .object({
    key,
    name: z.string().min(1).max(80),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  })
  .strict();

export const BrandTypeRoleSchema = z
  .object({
    key,
    name: z.string().min(1).max(80),
    font: FontRecordSchema,
    fontSize: z.number().finite().positive(),
    lineHeight: z.number().finite().positive(),
    letterSpacing: z.number().finite(),
    colorToken: key.optional(),
  })
  .strict();

export const BrandEffectStyleSchema = z
  .object({
    key,
    name: z.string().min(1).max(80),
    effects: EffectsSchema,
  })
  .strict();

export const BrandRadiusTokenSchema = z
  .object({
    key,
    name: z.string().min(1).max(80),
    value: z.number().finite().min(0).max(10_000),
  })
  .strict();

export const BrandSpacingTokenSchema = z
  .object({
    key,
    name: z.string().min(1).max(80),
    value: z.number().finite().min(0).max(10_000),
  })
  .strict();

export const BrandVariableModeSchema = z
  .object({
    key,
    name: z.string().min(1).max(80),
    palette: z
      .array(
        z
          .object({
            tokenKey: key,
            color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((mode, context) => {
    if (
      new Set(mode.palette.map((item) => item.tokenKey)).size !==
      mode.palette.length
    )
      context.addIssue({
        code: "custom",
        message: "Variable-mode palette token keys must be unique.",
        path: ["palette"],
      });
  });

export const BrandLogoSchema = z
  .object({
    key,
    name: z.string().min(1).max(80),
    asset: AssetSchema,
    licenseNotes: z.string().min(1).max(2_000),
    provenance: z.string().min(1).max(500),
  })
  .strict();

export const BrandReusableDefinitionSchema = z
  .object({
    key,
    kind: z.enum(["component", "template"]),
    name: z.string().min(1).max(120),
    nodes: z.array(SceneNodeSchema).max(100),
    includes: z.array(key).max(20).default([]),
    variant: z
      .object({
        groupKey: key,
        key,
        name: z.string().min(1).max(120),
      })
      .strict()
      .optional(),
    allowedOverrides: z
      .array(
        z
          .object({
            sourceNodeId: uuid,
            properties: z.array(ComponentOverridePropertySchema).min(1).max(13),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export const BrandKitRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: uuid,
    revision: z.number().int().positive(),
    previousRevisionHash: hash.optional(),
    contentHash: hash,
    name: z.string().min(1).max(160),
    description: z.string().max(2_000).optional(),
    createdAt: z.string().datetime(),
    createdBy: z.string().min(1).max(128),
    sourceProjectId: uuid,
    provenance: z.string().min(1).max(1_000),
    licenseNotes: z.string().min(1).max(2_000),
    palette: z.array(BrandPaletteTokenSchema).max(100),
    typeRoles: z.array(BrandTypeRoleSchema).max(32),
    effectStyles: z.array(BrandEffectStyleSchema).max(32).optional(),
    radiusTokens: z.array(BrandRadiusTokenSchema).max(64).optional(),
    spacingTokens: z.array(BrandSpacingTokenSchema).max(64).optional(),
    variableModes: z.array(BrandVariableModeSchema).max(16).optional(),
    logos: z.array(BrandLogoSchema).max(64),
    definitions: z.array(BrandReusableDefinitionSchema).max(100),
  })
  .strict()
  .superRefine((kit, context) => {
    const assertUnique = (values: readonly string[], path: string) => {
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: "custom",
          message: `${path} keys must be unique.`,
          path: [path],
        });
    };
    assertUnique(
      kit.palette.map((item) => item.key),
      "palette",
    );
    assertUnique(
      kit.typeRoles.map((item) => item.key),
      "typeRoles",
    );
    assertUnique(
      (kit.effectStyles ?? []).map((item) => item.key),
      "effectStyles",
    );
    assertUnique(
      (kit.radiusTokens ?? []).map((item) => item.key),
      "radiusTokens",
    );
    assertUnique(
      (kit.spacingTokens ?? []).map((item) => item.key),
      "spacingTokens",
    );
    assertUnique(
      (kit.variableModes ?? []).map((item) => item.key),
      "variableModes",
    );
    assertUnique(
      kit.logos.map((item) => item.key),
      "logos",
    );
    assertUnique(
      kit.definitions.map((item) => item.key),
      "definitions",
    );
    const paletteKeys = new Set(kit.palette.map((item) => item.key));
    for (const mode of kit.variableModes ?? [])
      for (const override of mode.palette)
        if (!paletteKeys.has(override.tokenKey))
          context.addIssue({
            code: "custom",
            message: `Variable mode ${mode.key} references a missing palette token.`,
            path: ["variableModes"],
          });
    for (const role of kit.typeRoles)
      if (role.colorToken && !paletteKeys.has(role.colorToken))
        context.addIssue({
          code: "custom",
          message: `Type role ${role.key} references a missing palette token.`,
          path: ["typeRoles"],
        });
    const definitions = new Map(
      kit.definitions.map((item) => [item.key, item]),
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (definitionKey: string) => {
      if (visiting.has(definitionKey)) {
        context.addIssue({
          code: "custom",
          message: `Reusable definition cycle includes ${definitionKey}.`,
          path: ["definitions"],
        });
        return;
      }
      if (visited.has(definitionKey)) return;
      const definition = definitions.get(definitionKey);
      if (!definition) return;
      visiting.add(definitionKey);
      for (const included of definition.includes) {
        if (!definitions.has(included))
          context.addIssue({
            code: "custom",
            message: `${definitionKey} includes missing definition ${included}.`,
            path: ["definitions"],
          });
        else visit(included);
      }
      visiting.delete(definitionKey);
      visited.add(definitionKey);
    };
    for (const definition of kit.definitions) visit(definition.key);
    for (const definition of kit.definitions) {
      if (definition.kind === "template" && definition.variant)
        context.addIssue({
          code: "custom",
          message: `Template ${definition.key} cannot be a component variant.`,
          path: ["definitions"],
        });
      if (definition.kind === "template" && definition.allowedOverrides?.length)
        context.addIssue({
          code: "custom",
          message: `Template ${definition.key} cannot declare component overrides.`,
          path: ["definitions"],
        });
      const sourceNodeIds = new Set<string>();
      for (const node of definition.nodes)
        walkNode(node, (candidate) => sourceNodeIds.add(candidate.id));
      const overrideSourceIds = new Set<string>();
      for (const override of definition.allowedOverrides ?? []) {
        if (overrideSourceIds.has(override.sourceNodeId))
          context.addIssue({
            code: "custom",
            message: `Definition ${definition.key} repeats override policy for ${override.sourceNodeId}.`,
            path: ["definitions"],
          });
        overrideSourceIds.add(override.sourceNodeId);
        if (!sourceNodeIds.has(override.sourceNodeId))
          context.addIssue({
            code: "custom",
            message: `Definition ${definition.key} declares overrides for a missing source node.`,
            path: ["definitions"],
          });
        if (new Set(override.properties).size !== override.properties.length)
          context.addIssue({
            code: "custom",
            message: `Definition ${definition.key} repeats an override property.`,
            path: ["definitions"],
          });
      }
    }
    const variantGroups = new Map<string, typeof kit.definitions>();
    for (const definition of kit.definitions) {
      if (!definition.variant) continue;
      const group = variantGroups.get(definition.variant.groupKey) ?? [];
      group.push(definition);
      variantGroups.set(definition.variant.groupKey, group);
    }
    for (const [groupKey, group] of variantGroups) {
      assertUnique(
        group.map((definition) => definition.variant!.key),
        `variant group ${groupKey}`,
      );
      const signature = (definition: (typeof group)[number]): string[] => {
        const values: string[] = [];
        const visitStructure = (
          node: SceneNode,
          parentId: string,
          index: number,
        ): void => {
          values.push(`${parentId}:${index}:${node.id}:${node.type}`);
          if (node.type === "mask") {
            visitStructure(node.maskSource, `${node.id}:mask`, 0);
            node.children.forEach((child, offset) =>
              visitStructure(child, node.id, offset),
            );
          } else if (node.type === "group")
            node.children.forEach((child, offset) =>
              visitStructure(child, node.id, offset),
            );
        };
        definition.nodes.forEach((node, index) =>
          visitStructure(node, "root", index),
        );
        return values;
      };
      const baseline = JSON.stringify(signature(group[0]!));
      const includes = JSON.stringify(group[0]!.includes);
      for (const definition of group.slice(1))
        if (
          JSON.stringify(signature(definition)) !== baseline ||
          JSON.stringify(definition.includes) !== includes
        )
          context.addIssue({
            code: "custom",
            message: `Variant group ${groupKey} must preserve source IDs, node types, hierarchy, and includes.`,
            path: ["definitions"],
          });
    }
  });

export type BrandKitRecord = z.infer<typeof BrandKitRecordSchema>;
export type BrandPaletteToken = z.infer<typeof BrandPaletteTokenSchema>;
export type BrandTypeRole = z.infer<typeof BrandTypeRoleSchema>;
export type BrandEffectStyle = z.infer<typeof BrandEffectStyleSchema>;
export type BrandRadiusToken = z.infer<typeof BrandRadiusTokenSchema>;
export type BrandSpacingToken = z.infer<typeof BrandSpacingTokenSchema>;
export type BrandVariableMode = z.infer<typeof BrandVariableModeSchema>;
export type BrandReusableDefinition = z.infer<
  typeof BrandReusableDefinitionSchema
>;

export const BrandKitIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    kits: z
      .array(
        z
          .object({
            id: uuid,
            revisions: z.array(z.number().int().positive()).max(10_000),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
  .superRefine((index, context) => {
    const ids = index.kits.map((kit) => kit.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Brand Kit index IDs must be unique.",
        path: ["kits"],
      });
    for (const [offset, kit] of index.kits.entries())
      if (new Set(kit.revisions).size !== kit.revisions.length)
        context.addIssue({
          code: "custom",
          message: "Brand Kit revisions must be unique.",
          path: ["kits", offset, "revisions"],
        });
  });

export const CreateBrandKitInputSchema = z
  .object({
    kitId: uuid.optional(),
    name: z.string().min(1).max(160),
    description: z.string().max(2_000).optional(),
    sourceProjectId: uuid,
    createdBy: z.string().min(1).max(128),
    provenance: z.string().min(1).max(1_000),
    licenseNotes: z.string().min(1).max(2_000),
    palette: z.array(BrandPaletteTokenSchema).max(100),
    typeRoles: z
      .array(BrandTypeRoleSchema.omit({ font: true }).extend({ fontId: uuid }))
      .max(32),
    effectStyles: z.array(BrandEffectStyleSchema).max(32).optional(),
    radiusTokens: z.array(BrandRadiusTokenSchema).max(64).optional(),
    spacingTokens: z.array(BrandSpacingTokenSchema).max(64).optional(),
    variableModes: z.array(BrandVariableModeSchema).max(16).optional(),
    logos: z
      .array(BrandLogoSchema.omit({ asset: true }).extend({ assetId: uuid }))
      .max(64),
    definitions: z.array(BrandReusableDefinitionSchema).max(100),
  })
  .strict();
export type CreateBrandKitInput = z.infer<typeof CreateBrandKitInputSchema>;

export const ApplyBrandInputSchema = z
  .object({
    palette: z
      .array(
        z
          .object({
            nodeId: uuid,
            token: key,
            property: z.enum(["fill", "textColor"]),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    typeRoles: z
      .array(z.object({ nodeId: uuid, role: key }).strict())
      .max(100)
      .optional(),
    logo: z
      .object({
        key,
        nodeId: uuid,
        parentId: z.union([z.literal("root"), uuid]),
        index: z.number().int().nonnegative().optional(),
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().positive().optional(),
        height: z.number().finite().positive().optional(),
      })
      .strict()
      .optional(),
    definition: z
      .object({
        key,
        parentId: z.union([z.literal("root"), uuid]),
        index: z.number().int().nonnegative().optional(),
        idMap: z.record(uuid, uuid),
        instanceId: uuid.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ApplyBrandInput = z.infer<typeof ApplyBrandInputSchema>;

export const BrandActorSchema = z
  .object({
    source: z.enum(["studio", "http", "mcp"]),
    id: z.string().min(1).max(128),
    clientId: uuid.optional(),
    sessionId: uuid.optional(),
    connectionId: uuid.optional(),
  })
  .strict();
export const BrandMutationEnvelopeSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    mode: z.enum(["preview", "commit"]),
    actor: BrandActorSchema,
  })
  .strict();
export const BrandPinRequestSchema = BrandMutationEnvelopeSchema.extend({
  kitId: uuid,
  revision: z.number().int().positive(),
}).strict();

export const BrandKitPinSchema = z
  .object({
    kitId: uuid,
    revision: z.number().int().positive(),
    contentHash: hash,
    resourceMap: z.record(uuid, uuid),
  })
  .strict();
export type BrandKitPin = z.infer<typeof BrandKitPinSchema>;

const walkNode = (node: SceneNode, visit: (node: SceneNode) => void): void => {
  visit(node);
  if (node.type === "group")
    node.children.forEach((child) => walkNode(child, visit));
  if (node.type === "mask") {
    walkNode(node.maskSource, visit);
    node.children.forEach((child) => walkNode(child, visit));
  }
};

export const validateBrandKitReferences = (kit: BrandKitRecord): void => {
  const assetIds = new Set(kit.logos.map((logo) => logo.asset.id));
  const fontIds = new Set(kit.typeRoles.map((role) => role.font.id));
  for (const definition of kit.definitions)
    for (const root of definition.nodes)
      walkNode(root, (node) => {
        if (
          (node.type === "rasterImage" || node.type === "svg") &&
          !assetIds.has(node.assetId)
        )
          throw new RuntimeError(
            "ASSET_NOT_FOUND",
            `Brand definition ${definition.key} references an unowned asset.`,
            { assetId: node.assetId },
          );
        if (node.type === "text") {
          const referencedFontIds = [
            node.typography.fontId,
            ...(node.spans ?? []).flatMap((span) =>
              span.style.fontId ? [span.style.fontId] : [],
            ),
          ];
          for (const fontId of referencedFontIds)
            if (!fontIds.has(fontId))
              throw new RuntimeError(
                "FONT_MISSING",
                `Brand definition ${definition.key} references an unowned font.`,
                { fontId },
              );
        }
      });
};

export const instantiateBrandDefinition = (input: {
  kit: BrandKitRecord;
  definitionKey: string;
  idMap: Record<string, string>;
  resourceMap: Record<string, string>;
  instanceId?: string;
}): SceneNode[] => {
  const definitions = new Map(
    input.kit.definitions.map((item) => [item.key, item]),
  );
  const roots: SceneNode[] = [];
  const requestedDefinition = definitions.get(input.definitionKey);
  if (!requestedDefinition)
    throw new RuntimeError(
      "INVALID_OPERATION",
      `Brand definition ${input.definitionKey} was not found.`,
    );
  const firstSourceId = requestedDefinition.nodes[0]?.id;
  const instanceId =
    input.instanceId ??
    (firstSourceId ? input.idMap[firstSourceId] : undefined);
  if (requestedDefinition.kind === "component" && !instanceId)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Component instances require a stable instance ID.",
    );
  const allowedOverrides = new Map(
    (requestedDefinition.allowedOverrides ?? []).map((entry) => [
      entry.sourceNodeId,
      entry.properties,
    ]),
  );
  const visiting = new Set<string>();
  let nodeCount = 0;
  const instantiate = (definitionKey: string, depth: number) => {
    if (depth > 8 || visiting.has(definitionKey))
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Brand component graph is cyclic or too deep.",
      );
    const definition = definitions.get(definitionKey);
    if (!definition)
      throw new RuntimeError(
        "INVALID_OPERATION",
        `Brand definition ${definitionKey} was not found.`,
      );
    visiting.add(definitionKey);
    definition.includes.forEach((included) => instantiate(included, depth + 1));
    for (const source of definition.nodes) {
      const node = clone(source);
      nodeCount += descendantIds(node).size;
      if (nodeCount > 500)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Brand definition expands beyond 500 nodes.",
        );
      walkNode(node, (candidate) => {
        const sourceNodeId = candidate.id;
        const replacement = input.idMap[sourceNodeId];
        if (!replacement)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Missing replacement ID for brand node ${candidate.id}.`,
          );
        candidate.id = replacement;
        if (requestedDefinition.kind === "component")
          candidate.brandComponent = {
            instanceId: instanceId!,
            kitId: input.kit.id,
            kitRevision: input.kit.revision,
            kitContentHash: input.kit.contentHash,
            definitionKey: input.definitionKey,
            ...(requestedDefinition.variant
              ? {
                  variantGroupKey: requestedDefinition.variant.groupKey,
                  variantKey: requestedDefinition.variant.key,
                }
              : {}),
            sourceNodeId,
            allowedOverrides: [...(allowedOverrides.get(sourceNodeId) ?? [])],
            overrides: [],
          };
        if (candidate.type === "rasterImage" || candidate.type === "svg") {
          const assetId = input.resourceMap[candidate.assetId];
          if (!assetId)
            throw new RuntimeError(
              "ASSET_NOT_FOUND",
              "Pinned Brand Kit asset is unavailable.",
            );
          candidate.assetId = assetId;
        }
        if (candidate.type === "text") {
          const fontId = input.resourceMap[candidate.typography.fontId];
          if (!fontId)
            throw new RuntimeError(
              "FONT_MISSING",
              "Pinned Brand Kit font is unavailable.",
            );
          candidate.typography.fontId = fontId;
          for (const span of candidate.spans ?? []) {
            if (!span.style.fontId) continue;
            const spanFontId = input.resourceMap[span.style.fontId];
            if (!spanFontId)
              throw new RuntimeError(
                "FONT_MISSING",
                "Pinned Brand Kit rich-text font is unavailable.",
              );
            span.style.fontId = spanFontId;
          }
        }
      });
      roots.push(node);
    }
    visiting.delete(definitionKey);
  };
  instantiate(input.definitionKey, 0);
  return roots;
};
