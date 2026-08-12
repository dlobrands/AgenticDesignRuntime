import { z } from "zod";
import { instantiateBrandDefinition, type BrandKitRecord } from "./brand.js";
import { stableStringify } from "./canonical.js";
import { RuntimeError } from "./errors.js";
import type {
  BrandBindableProperty,
  ComponentOverrideProperty,
  FrameDocument,
  ProjectDocument,
  SceneNode,
} from "./model.js";
import type { FrameOperation } from "./operations.js";
import { findNode, listNodes } from "./scene.js";

const uuid = z.string().uuid();
const tokenKey = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const equal = (left: unknown, right: unknown): boolean =>
  stableStringify(left) === stableStringify(right);

const componentProperties: ComponentOverrideProperty[] = [
  "visibility",
  "transform",
  "compositing",
  "textContent",
  "typography",
  "textBox",
  "fill",
  "stroke",
  "vectorPath",
  "effects",
  "radius",
  "crop",
  "asset",
];

const componentPropertyValue = (
  node: SceneNode,
  property: ComponentOverrideProperty,
): { supported: boolean; value?: unknown } => {
  switch (property) {
    case "visibility":
      return { supported: true, value: node.visible };
    case "transform":
      return { supported: true, value: node.transform };
    case "compositing":
      return "opacity" in node
        ? {
            supported: true,
            value: { opacity: node.opacity, blendMode: node.blendMode },
          }
        : { supported: false };
    case "textContent":
      return node.type === "text"
        ? {
            supported: true,
            value: { text: node.text, spans: node.spans ?? null },
          }
        : { supported: false };
    case "typography":
      return node.type === "text"
        ? { supported: true, value: node.typography }
        : { supported: false };
    case "textBox":
      return node.type === "text"
        ? { supported: true, value: node.textBox }
        : { supported: false };
    case "fill":
      return node.type === "rectangle" ||
        node.type === "ellipse" ||
        node.type === "vectorPath"
        ? { supported: true, value: node.fill ?? null }
        : { supported: false };
    case "stroke":
      return node.type === "rectangle" ||
        node.type === "ellipse" ||
        node.type === "vectorPath"
        ? { supported: true, value: node.stroke ?? null }
        : { supported: false };
    case "vectorPath":
      return node.type === "vectorPath"
        ? { supported: true, value: node.commands }
        : { supported: false };
    case "effects":
      return node.type !== "adjustment"
        ? { supported: true, value: node.effects ?? null }
        : { supported: false };
    case "radius":
      return node.type === "rectangle"
        ? { supported: true, value: node.cornerRadius }
        : { supported: false };
    case "crop":
      return node.type === "rasterImage"
        ? { supported: true, value: { fit: node.fit, crop: node.crop ?? null } }
        : { supported: false };
    case "asset":
      return node.type === "rasterImage" || node.type === "svg"
        ? { supported: true, value: node.assetId }
        : { supported: false };
  }
};

export const BindPaletteTokenInputSchema = z
  .object({
    bindingId: uuid,
    nodeId: uuid,
    property: z.enum(["fill", "stroke", "textColor"]),
    tokenKey,
  })
  .strict();

export type BindPaletteTokenInput = z.infer<typeof BindPaletteTokenInputSchema>;

export const UnbindPaletteTokenInputSchema = z
  .object({
    nodeId: uuid,
    property: z.enum(["fill", "stroke", "textColor"]),
  })
  .strict();

export type UnbindPaletteTokenInput = z.infer<
  typeof UnbindPaletteTokenInputSchema
>;

export const BindTypographyRoleInputSchema = z
  .object({
    bindingId: uuid,
    nodeId: uuid,
    roleKey: tokenKey,
  })
  .strict();

export type BindTypographyRoleInput = z.infer<
  typeof BindTypographyRoleInputSchema
>;

export const UnbindTypographyRoleInputSchema = z
  .object({ nodeId: uuid })
  .strict();

export type UnbindTypographyRoleInput = z.infer<
  typeof UnbindTypographyRoleInputSchema
>;

export const BindEffectStyleInputSchema = z
  .object({
    bindingId: uuid,
    nodeId: uuid,
    styleKey: tokenKey,
  })
  .strict();

export type BindEffectStyleInput = z.infer<typeof BindEffectStyleInputSchema>;

export const UnbindEffectStyleInputSchema = z.object({ nodeId: uuid }).strict();

export type UnbindEffectStyleInput = z.infer<
  typeof UnbindEffectStyleInputSchema
>;

export const BindRadiusTokenInputSchema = z
  .object({
    bindingId: uuid,
    nodeId: uuid,
    tokenKey,
  })
  .strict();

export type BindRadiusTokenInput = z.infer<typeof BindRadiusTokenInputSchema>;

export const UnbindRadiusTokenInputSchema = z.object({ nodeId: uuid }).strict();

export type UnbindRadiusTokenInput = z.infer<
  typeof UnbindRadiusTokenInputSchema
>;

export const BindSpacingTokenInputSchema = z
  .object({
    bindingId: uuid,
    tokenKey,
  })
  .strict();

export type BindSpacingTokenInput = z.infer<typeof BindSpacingTokenInputSchema>;

export const UnbindSpacingTokenInputSchema = z.object({}).strict();

export type UnbindSpacingTokenInput = z.infer<
  typeof UnbindSpacingTokenInputSchema
>;

export const ApplyVariableModeInputSchema = z
  .object({ modeKey: tokenKey.nullable() })
  .strict();

export type ApplyVariableModeInput = z.infer<
  typeof ApplyVariableModeInputSchema
>;

type BrandPin = NonNullable<ProjectDocument["brandKitPin"]>;

const assertExactKit = (pin: BrandPin, kit: BrandKitRecord): void => {
  if (
    pin.kitId !== kit.id ||
    pin.revision !== kit.revision ||
    pin.contentHash !== kit.contentHash
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Live Brand bindings require the project's exact immutable Brand Kit pin.",
    );
};

const paletteColor = (
  kit: BrandKitRecord,
  tokenKeyValue: string,
  modeKey?: string,
): string | undefined => {
  const base = kit.palette.find((token) => token.key === tokenKeyValue)?.color;
  if (!modeKey) return base;
  const mode = (kit.variableModes ?? []).find((item) => item.key === modeKey);
  return (
    mode?.palette.find((item) => item.tokenKey === tokenKeyValue)?.color ?? base
  );
};

const bindingValue = (
  node: SceneNode,
  property: BrandBindableProperty,
): string | undefined => {
  if (property === "textColor")
    return node.type === "text" ? node.typography.color : undefined;
  if (
    node.type !== "rectangle" &&
    node.type !== "ellipse" &&
    node.type !== "vectorPath"
  )
    return undefined;
  if (property === "fill")
    return node.fill?.type === "solid" ? node.fill.color : undefined;
  return node.stroke?.paint.type === "solid"
    ? node.stroke.paint.color
    : undefined;
};

export const compilePaletteTokenBinding = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  binding: BindPaletteTokenInput;
}): FrameOperation[] => {
  assertExactKit(input.pin, input.kit);
  const parsed = BindPaletteTokenInputSchema.parse(input.binding);
  const node = findNode(input.frame, parsed.nodeId);
  const token = input.kit.palette.find(
    (candidate) => candidate.key === parsed.tokenKey,
  );
  if (!node || !token)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Live Brand binding target or palette token was not found.",
    );
  const resolvedColor = paletteColor(
    input.kit,
    token.key,
    input.frame.brandMode?.modeKey,
  )!;
  if (node.locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      "Locked nodes cannot receive live Brand bindings.",
    );
  if (bindingValue(node, parsed.property) === undefined)
    throw new RuntimeError(
      "INVALID_PROPERTY_GROUP",
      "Palette token is incompatible with the selected bound property.",
    );
  const boundStroke =
    parsed.property === "stroke" &&
    (node.type === "rectangle" ||
      node.type === "ellipse" ||
      node.type === "vectorPath") &&
    node.stroke?.paint.type === "solid"
      ? {
          ...node.stroke,
          paint: {
            type: "solid" as const,
            color: resolvedColor,
            opacity: node.stroke.paint.opacity,
          },
        }
      : undefined;

  const valueOperation: FrameOperation =
    parsed.property === "fill"
      ? {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "fill",
          value: {
            fill: {
              type: "solid",
              color: resolvedColor,
              opacity:
                node.type === "rectangle" ||
                node.type === "ellipse" ||
                node.type === "vectorPath"
                  ? node.fill?.type === "solid"
                    ? node.fill.opacity
                    : 1
                  : 1,
            },
          },
        }
      : parsed.property === "stroke"
        ? {
            kind: "updateNode",
            nodeId: node.id,
            propertyGroup: "stroke",
            value: { stroke: boundStroke ?? null },
          }
        : {
            kind: "updateNode",
            nodeId: node.id,
            propertyGroup: "typography",
            value: { color: resolvedColor },
          };
  return [
    valueOperation,
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "brandBinding",
      value: {
        property: parsed.property,
        binding: {
          id: parsed.bindingId,
          property: parsed.property,
          kitId: input.kit.id,
          kitRevision: input.kit.revision,
          kitContentHash: input.kit.contentHash,
          tokenKey: token.key,
        },
      },
    },
  ];
};

export const compilePaletteTokenUnbind = (input: {
  frame: FrameDocument;
  unbind: UnbindPaletteTokenInput;
}): FrameOperation[] => {
  const parsed = UnbindPaletteTokenInputSchema.parse(input.unbind);
  const node = findNode(input.frame, parsed.nodeId);
  if (!node)
    throw new RuntimeError("NODE_NOT_FOUND", "Bound node was not found.");
  if (node.locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      "Locked nodes cannot detach live Brand bindings.",
    );
  if (
    !node.brandBindings?.some((binding) => binding.property === parsed.property)
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Selected node property has no live Brand binding.",
    );
  return [
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "brandBinding",
      value: { property: parsed.property, binding: null },
    },
  ];
};

export const compileTypographyRoleBinding = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  binding: BindTypographyRoleInput;
}): FrameOperation[] => {
  assertExactKit(input.pin, input.kit);
  const parsed = BindTypographyRoleInputSchema.parse(input.binding);
  const node = findNode(input.frame, parsed.nodeId);
  const role = input.kit.typeRoles.find(
    (candidate) => candidate.key === parsed.roleKey,
  );
  if (!node || !role)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Live Brand binding target or typography role was not found.",
    );
  if (node.locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      "Locked nodes cannot receive live Brand bindings.",
    );
  if (node.type !== "text")
    throw new RuntimeError(
      "INVALID_PROPERTY_GROUP",
      "Typography roles can bind only to text nodes.",
    );
  const fontId = input.pin.resourceMap[role.font.id];
  if (!fontId)
    throw new RuntimeError(
      "FONT_MISSING",
      "Typography role has no font in the project's exact pinned resource map.",
    );
  const color = role.colorToken
    ? paletteColor(input.kit, role.colorToken, input.frame.brandMode?.modeKey)
    : undefined;
  if (role.colorToken && !color)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Typography role references a missing palette token.",
    );
  return [
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "typography",
      value: {
        fontId,
        fontSize: role.fontSize,
        fontWeight: role.font.weight,
        fontStyle: role.font.style,
        lineHeight: role.lineHeight,
        letterSpacing: role.letterSpacing,
        ...(color ? { color } : {}),
      },
    },
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "brandBinding",
      value: {
        property: "typography",
        binding: {
          id: parsed.bindingId,
          property: "typography",
          kitId: input.kit.id,
          kitRevision: input.kit.revision,
          kitContentHash: input.kit.contentHash,
          tokenKey: role.key,
        },
      },
    },
  ];
};

export const compileTypographyRoleUnbind = (input: {
  frame: FrameDocument;
  unbind: UnbindTypographyRoleInput;
}): FrameOperation[] => {
  const parsed = UnbindTypographyRoleInputSchema.parse(input.unbind);
  const node = findNode(input.frame, parsed.nodeId);
  if (!node)
    throw new RuntimeError("NODE_NOT_FOUND", "Bound text node was not found.");
  if (node.locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      "Locked nodes cannot detach live Brand bindings.",
    );
  if (!node.brandBindings?.some((binding) => binding.property === "typography"))
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Selected text node has no live typography binding.",
    );
  return [
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "brandBinding",
      value: { property: "typography", binding: null },
    },
  ];
};

export const compileEffectStyleBinding = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  binding: BindEffectStyleInput;
}): FrameOperation[] => {
  assertExactKit(input.pin, input.kit);
  const parsed = BindEffectStyleInputSchema.parse(input.binding);
  const node = findNode(input.frame, parsed.nodeId);
  const style = (input.kit.effectStyles ?? []).find(
    (candidate) => candidate.key === parsed.styleKey,
  );
  if (!node || !style)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Live Brand binding target or effect style was not found.",
    );
  if (node.locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      "Locked nodes cannot receive live Brand bindings.",
    );
  if (node.type === "adjustment")
    throw new RuntimeError(
      "INVALID_PROPERTY_GROUP",
      "Adjustment nodes cannot receive effect styles.",
    );
  return [
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "effects",
      value: { effects: structuredClone(style.effects) },
    },
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "brandBinding",
      value: {
        property: "effects",
        binding: {
          id: parsed.bindingId,
          property: "effects",
          kitId: input.kit.id,
          kitRevision: input.kit.revision,
          kitContentHash: input.kit.contentHash,
          tokenKey: style.key,
        },
      },
    },
  ];
};

export const compileEffectStyleUnbind = (input: {
  frame: FrameDocument;
  unbind: UnbindEffectStyleInput;
}): FrameOperation[] => {
  const parsed = UnbindEffectStyleInputSchema.parse(input.unbind);
  const node = findNode(input.frame, parsed.nodeId);
  if (!node)
    throw new RuntimeError("NODE_NOT_FOUND", "Bound node was not found.");
  if (node.locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      "Locked nodes cannot detach live Brand bindings.",
    );
  if (!node.brandBindings?.some((binding) => binding.property === "effects"))
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Selected node has no live effect-style binding.",
    );
  return [
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "brandBinding",
      value: { property: "effects", binding: null },
    },
  ];
};

export const compileRadiusTokenBinding = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  binding: BindRadiusTokenInput;
}): FrameOperation[] => {
  assertExactKit(input.pin, input.kit);
  const parsed = BindRadiusTokenInputSchema.parse(input.binding);
  const node = findNode(input.frame, parsed.nodeId);
  const token = (input.kit.radiusTokens ?? []).find(
    (candidate) => candidate.key === parsed.tokenKey,
  );
  if (!node || !token)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Live Brand binding target or radius token was not found.",
    );
  if (node.locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      "Locked nodes cannot receive live Brand bindings.",
    );
  if (node.type !== "rectangle")
    throw new RuntimeError(
      "INVALID_PROPERTY_GROUP",
      "Radius tokens can bind only to rectangle corner radii.",
    );
  const cornerRadius = {
    topLeft: token.value,
    topRight: token.value,
    bottomRight: token.value,
    bottomLeft: token.value,
  };
  return [
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "shape",
      value: { cornerRadius },
    },
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "brandBinding",
      value: {
        property: "radius",
        binding: {
          id: parsed.bindingId,
          property: "radius",
          kitId: input.kit.id,
          kitRevision: input.kit.revision,
          kitContentHash: input.kit.contentHash,
          tokenKey: token.key,
        },
      },
    },
  ];
};

export const compileRadiusTokenUnbind = (input: {
  frame: FrameDocument;
  unbind: UnbindRadiusTokenInput;
}): FrameOperation[] => {
  const parsed = UnbindRadiusTokenInputSchema.parse(input.unbind);
  const node = findNode(input.frame, parsed.nodeId);
  if (!node)
    throw new RuntimeError("NODE_NOT_FOUND", "Bound node was not found.");
  if (node.locked)
    throw new RuntimeError(
      "NODE_LOCKED",
      "Locked nodes cannot detach live Brand bindings.",
    );
  if (!node.brandBindings?.some((binding) => binding.property === "radius"))
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Selected node has no live radius-token binding.",
    );
  return [
    {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "brandBinding",
      value: { property: "radius", binding: null },
    },
  ];
};

export const compileSpacingTokenBinding = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  binding: BindSpacingTokenInput;
}): FrameOperation[] => {
  assertExactKit(input.pin, input.kit);
  const parsed = BindSpacingTokenInputSchema.parse(input.binding);
  const token = (input.kit.spacingTokens ?? []).find(
    (candidate) => candidate.key === parsed.tokenKey,
  );
  if (!token)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Live Brand spacing token was not found.",
    );
  if (
    token.value * 2 >= input.frame.canvas.width ||
    token.value * 2 >= input.frame.canvas.height
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Spacing token must leave a positive canvas safe-area interior.",
    );
  return [
    {
      kind: "setCanvas",
      value: {
        safeArea: {
          top: token.value,
          right: token.value,
          bottom: token.value,
          left: token.value,
        },
        spacingBinding: {
          id: parsed.bindingId,
          property: "safeArea",
          kitId: input.kit.id,
          kitRevision: input.kit.revision,
          kitContentHash: input.kit.contentHash,
          tokenKey: token.key,
        },
      },
    },
  ];
};

export const compileSpacingTokenUnbind = (input: {
  frame: FrameDocument;
  unbind: UnbindSpacingTokenInput;
}): FrameOperation[] => {
  UnbindSpacingTokenInputSchema.parse(input.unbind);
  if (!input.frame.canvas.spacingBinding)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Canvas has no live safe-area spacing binding.",
    );
  return [{ kind: "setCanvas", value: { spacingBinding: null } }];
};

export const compileVariableMode = (input: {
  frame: FrameDocument;
  pin: BrandPin;
  kit: BrandKitRecord;
  mode: ApplyVariableModeInput;
}): FrameOperation[] => {
  assertExactKit(input.pin, input.kit);
  const parsed = ApplyVariableModeInputSchema.parse(input.mode);
  if (
    parsed.modeKey !== null &&
    !(input.kit.variableModes ?? []).some(
      (candidate) => candidate.key === parsed.modeKey,
    )
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Brand variable mode was not found in the exact pinned kit.",
    );
  const nextFrame = structuredClone(input.frame);
  if (parsed.modeKey)
    nextFrame.brandMode = {
      kitId: input.kit.id,
      kitRevision: input.kit.revision,
      kitContentHash: input.kit.contentHash,
      modeKey: parsed.modeKey,
    };
  else delete nextFrame.brandMode;
  const operations: FrameOperation[] = [
    {
      kind: "setFrameBrandMode",
      mode: nextFrame.brandMode ?? null,
    },
  ];
  for (const node of listNodes(input.frame))
    for (const binding of node.brandBindings ?? []) {
      if (
        binding.property === "fill" ||
        binding.property === "stroke" ||
        binding.property === "textColor"
      )
        operations.push(
          ...compilePaletteTokenBinding({
            frame: nextFrame,
            pin: input.pin,
            kit: input.kit,
            binding: {
              bindingId: binding.id,
              nodeId: node.id,
              property: binding.property,
              tokenKey: binding.tokenKey,
            },
          }),
        );
      else if (binding.property === "typography")
        operations.push(
          ...compileTypographyRoleBinding({
            frame: nextFrame,
            pin: input.pin,
            kit: input.kit,
            binding: {
              bindingId: binding.id,
              nodeId: node.id,
              roleKey: binding.tokenKey,
            },
          }),
        );
    }
  return operations;
};

export const validateFrameBrandBindings = (input: {
  frame: FrameDocument;
  pin?: BrandPin;
  kit?: BrandKitRecord;
}): void => {
  const bound = listNodes(input.frame).filter(
    (node) => (node.brandBindings?.length ?? 0) > 0,
  );
  const canvasBinding = input.frame.canvas.spacingBinding;
  const frameMode = input.frame.brandMode;
  const componentNodes = listNodes(input.frame).filter(
    (node) => node.brandComponent !== undefined,
  );
  if (
    bound.length === 0 &&
    componentNodes.length === 0 &&
    !canvasBinding &&
    !frameMode
  )
    return;
  if (!input.pin || !input.kit)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Frames with live Brand bindings require an exact project Brand Kit pin.",
    );
  assertExactKit(input.pin, input.kit);
  const componentInstances = new Map<string, SceneNode[]>();
  for (const node of componentNodes) {
    const metadata = node.brandComponent!;
    if (
      metadata.kitId !== input.pin.kitId ||
      metadata.kitRevision !== input.pin.revision ||
      metadata.kitContentHash !== input.pin.contentHash
    )
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Component instance does not match the project's exact Brand Kit pin.",
        { nodeId: node.id, instanceId: metadata.instanceId },
      );
    const nodes = componentInstances.get(metadata.instanceId) ?? [];
    nodes.push(node);
    componentInstances.set(metadata.instanceId, nodes);
  }
  for (const [instanceId, nodes] of componentInstances) {
    const metadata = nodes[0]!.brandComponent!;
    const definition = input.kit.definitions.find(
      (candidate) => candidate.key === metadata.definitionKey,
    );
    if (
      !definition ||
      definition.kind !== "component" ||
      definition.variant?.groupKey !== metadata.variantGroupKey ||
      definition.variant?.key !== metadata.variantKey
    )
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Component identity does not match its exact immutable definition.",
        { instanceId },
      );
    const idMap = Object.fromEntries(
      nodes.map((node) => [node.brandComponent!.sourceNodeId, node.id]),
    );
    const expectedRoots = instantiateBrandDefinition({
      kit: input.kit,
      definitionKey: definition.key,
      idMap,
      resourceMap: input.pin.resourceMap,
      instanceId,
    });
    const expectedNodes: SceneNode[] = [];
    const collect = (node: SceneNode): void => {
      expectedNodes.push(node);
      if (node.type === "mask") {
        collect(node.maskSource);
        node.children.forEach(collect);
      } else if (node.type === "group") node.children.forEach(collect);
    };
    expectedRoots.forEach(collect);
    const expectedBySource = new Map(
      expectedNodes.map((node) => [node.brandComponent!.sourceNodeId, node]),
    );
    if (expectedBySource.size !== nodes.length)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Component instance structure diverges from its immutable definition.",
        { instanceId },
      );
    for (const node of nodes) {
      const currentMetadata = node.brandComponent!;
      const expected = expectedBySource.get(currentMetadata.sourceNodeId);
      if (
        !expected?.brandComponent ||
        !equal(
          currentMetadata.allowedOverrides,
          expected.brandComponent.allowedOverrides,
        )
      )
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Component override policy diverges from its immutable definition.",
          { nodeId: node.id, instanceId },
        );
      for (const property of componentProperties) {
        if (currentMetadata.overrides.includes(property)) continue;
        const currentValue = componentPropertyValue(node, property);
        const expectedValue = componentPropertyValue(expected, property);
        if (
          currentValue.supported !== expectedValue.supported ||
          (currentValue.supported &&
            !equal(currentValue.value, expectedValue.value))
        )
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Component ${property} diverges without a declared active override.`,
            { nodeId: node.id, instanceId, property },
          );
      }
    }
  }
  if (frameMode) {
    if (
      frameMode.kitId !== input.pin.kitId ||
      frameMode.kitRevision !== input.pin.revision ||
      frameMode.kitContentHash !== input.pin.contentHash ||
      !(input.kit.variableModes ?? []).some(
        (candidate) => candidate.key === frameMode.modeKey,
      )
    )
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Frame Brand mode does not match the exact pinned kit.",
      );
  }
  if (canvasBinding) {
    if (
      canvasBinding.kitId !== input.pin.kitId ||
      canvasBinding.kitRevision !== input.pin.revision ||
      canvasBinding.kitContentHash !== input.pin.contentHash
    )
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Live canvas spacing binding does not match the project's exact pin.",
        { bindingId: canvasBinding.id },
      );
    const token = (input.kit.spacingTokens ?? []).find(
      (candidate) => candidate.key === canvasBinding.tokenKey,
    );
    const safeArea = input.frame.canvas.safeArea;
    if (
      !token ||
      !safeArea ||
      Object.values(safeArea).some((value) => value !== token.value)
    )
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Bound canvas safe area diverges from its exact spacing token.",
        { bindingId: canvasBinding.id },
      );
  }
  for (const node of bound)
    for (const binding of node.brandBindings ?? []) {
      if (
        binding.kitId !== input.pin.kitId ||
        binding.kitRevision !== input.pin.revision ||
        binding.kitContentHash !== input.pin.contentHash
      )
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Live Brand binding does not match the project's exact pin.",
          { nodeId: node.id, bindingId: binding.id },
        );
      if (binding.property === "typography") {
        const role = input.kit.typeRoles.find(
          (candidate) => candidate.key === binding.tokenKey,
        );
        const fontId = role ? input.pin.resourceMap[role.font.id] : undefined;
        const color = role?.colorToken
          ? paletteColor(input.kit, role.colorToken, frameMode?.modeKey)
          : undefined;
        if (
          !role ||
          !fontId ||
          (role.colorToken !== undefined && color === undefined) ||
          node.type !== "text" ||
          node.typography.fontId !== fontId ||
          node.typography.fontSize !== role.fontSize ||
          node.typography.fontWeight !== role.font.weight ||
          node.typography.fontStyle !== role.font.style ||
          node.typography.lineHeight !== role.lineHeight ||
          node.typography.letterSpacing !== role.letterSpacing ||
          (color !== undefined && node.typography.color !== color)
        )
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Bound text typography diverges from its exact type role.",
            { nodeId: node.id, bindingId: binding.id },
          );
        continue;
      }
      if (binding.property === "effects") {
        const style = (input.kit.effectStyles ?? []).find(
          (candidate) => candidate.key === binding.tokenKey,
        );
        const current =
          node.type !== "adjustment" && "effects" in node
            ? node.effects
            : undefined;
        if (
          !style ||
          node.type === "adjustment" ||
          stableStringify(current ?? null) !== stableStringify(style.effects)
        )
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Bound node effects diverge from its exact effect style.",
            { nodeId: node.id, bindingId: binding.id },
          );
        continue;
      }
      if (binding.property === "radius") {
        const token = (input.kit.radiusTokens ?? []).find(
          (candidate) => candidate.key === binding.tokenKey,
        );
        if (
          !token ||
          node.type !== "rectangle" ||
          Object.values(node.cornerRadius).some(
            (value) => value !== token.value,
          )
        )
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Bound rectangle radii diverge from its exact radius token.",
            { nodeId: node.id, bindingId: binding.id },
          );
        continue;
      }
      const token = input.kit.palette.find(
        (candidate) => candidate.key === binding.tokenKey,
      );
      const color = token
        ? paletteColor(input.kit, token.key, frameMode?.modeKey)
        : undefined;
      if (!token || !color || bindingValue(node, binding.property) !== color)
        throw new RuntimeError(
          "INVALID_OPERATION",
          "Bound node value diverges from its exact palette token.",
          { nodeId: node.id, bindingId: binding.id },
        );
    }
};
