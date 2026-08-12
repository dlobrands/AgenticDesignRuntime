import type { BrandKitRecord } from "./brand.js";
import { compileBrandComponentMigration } from "./components.js";
import { RuntimeError } from "./errors.js";
import type { FrameDocument, ProjectDocument } from "./model.js";
import type { FrameOperation } from "./operations.js";
import { listNodes } from "./scene.js";
import {
  compileEffectStyleBinding,
  compilePaletteTokenBinding,
  compileRadiusTokenBinding,
  compileSpacingTokenBinding,
  compileTypographyRoleBinding,
  validateFrameBrandBindings,
} from "./live-brand-bindings.js";

type BrandPin = NonNullable<ProjectDocument["brandKitPin"]>;

export type BrandMigrationFramePlan = {
  frameId: string;
  baseRevision: number;
  operations: FrameOperation[];
  bindingCount: number;
  componentInstanceCount: number;
};

export const compileBrandRevisionMigration = (input: {
  frame: FrameDocument;
  currentPin: BrandPin;
  currentKit: BrandKitRecord;
  targetPin: BrandPin;
  targetKit: BrandKitRecord;
}): BrandMigrationFramePlan => {
  validateFrameBrandBindings({
    frame: input.frame,
    pin: input.currentPin,
    kit: input.currentKit,
  });
  if (
    input.currentPin.kitId !== input.targetPin.kitId ||
    input.currentKit.id !== input.targetKit.id
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Brand revision migration must stay within one immutable Brand Kit lineage.",
    );
  if (
    input.targetPin.kitId !== input.targetKit.id ||
    input.targetPin.revision !== input.targetKit.revision ||
    input.targetPin.contentHash !== input.targetKit.contentHash
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Target Brand Kit pin does not match the requested immutable revision.",
    );

  const targetFrame = structuredClone(input.frame);
  const operations: FrameOperation[] = [];
  if (targetFrame.brandMode) {
    if (
      !(input.targetKit.variableModes ?? []).some(
        (mode) => mode.key === targetFrame.brandMode!.modeKey,
      )
    )
      throw new RuntimeError(
        "INVALID_OPERATION",
        `Target revision does not contain variable mode ${targetFrame.brandMode.modeKey}.`,
      );
    targetFrame.brandMode = {
      kitId: input.targetKit.id,
      kitRevision: input.targetKit.revision,
      kitContentHash: input.targetKit.contentHash,
      modeKey: targetFrame.brandMode.modeKey,
    };
    operations.push({ kind: "setFrameBrandMode", mode: targetFrame.brandMode });
  }

  const componentInstanceIds = new Set(
    listNodes(input.frame)
      .map((node) => node.brandComponent?.instanceId)
      .filter((id): id is string => Boolean(id)),
  );
  for (const instanceId of componentInstanceIds)
    operations.push(
      ...compileBrandComponentMigration({
        frame: input.frame,
        pin: input.targetPin,
        kit: input.targetKit,
        instanceId,
      }),
    );

  let bindingCount = 0;
  for (const node of listNodes(input.frame))
    for (const binding of node.brandBindings ?? []) {
      bindingCount += 1;
      if (
        binding.property === "fill" ||
        binding.property === "stroke" ||
        binding.property === "textColor"
      )
        operations.push(
          ...compilePaletteTokenBinding({
            frame: targetFrame,
            pin: input.targetPin,
            kit: input.targetKit,
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
            frame: targetFrame,
            pin: input.targetPin,
            kit: input.targetKit,
            binding: {
              bindingId: binding.id,
              nodeId: node.id,
              roleKey: binding.tokenKey,
            },
          }),
        );
      else if (binding.property === "effects")
        operations.push(
          ...compileEffectStyleBinding({
            frame: targetFrame,
            pin: input.targetPin,
            kit: input.targetKit,
            binding: {
              bindingId: binding.id,
              nodeId: node.id,
              styleKey: binding.tokenKey,
            },
          }),
        );
      else
        operations.push(
          ...compileRadiusTokenBinding({
            frame: targetFrame,
            pin: input.targetPin,
            kit: input.targetKit,
            binding: {
              bindingId: binding.id,
              nodeId: node.id,
              tokenKey: binding.tokenKey,
            },
          }),
        );
    }
  if (input.frame.canvas.spacingBinding) {
    bindingCount += 1;
    operations.push(
      ...compileSpacingTokenBinding({
        frame: targetFrame,
        pin: input.targetPin,
        kit: input.targetKit,
        binding: {
          bindingId: input.frame.canvas.spacingBinding.id,
          tokenKey: input.frame.canvas.spacingBinding.tokenKey,
        },
      }),
    );
  }
  return {
    frameId: input.frame.id,
    baseRevision: input.frame.revision,
    operations,
    bindingCount,
    componentInstanceCount: componentInstanceIds.size,
  };
};
