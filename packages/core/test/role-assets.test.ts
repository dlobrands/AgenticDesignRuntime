import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileDesignPlan,
  compileRoleAssetReplacement,
  createDesignPlan,
  createFrameDocument,
  createTransform,
  simulateFrameOperations,
  type RasterImageNode,
  type RectangleNode,
} from "../src/index.js";

const now = "2026-08-10T23:00:00.000Z";

const fixture = () => {
  const frame = createFrameDocument({
    id: randomUUID(),
    slug: "role-asset",
    name: "Role asset",
    width: 1_080,
    height: 1_350,
    now,
  });
  const currentAssetId = randomUUID();
  const assignedAssetId = randomUUID();
  const image: RasterImageNode = {
    id: randomUUID(),
    type: "rasterImage",
    name: "Hero",
    visible: true,
    locked: false,
    transform: createTransform({ x: 100, y: 200, width: 800, height: 700 }),
    opacity: 1,
    blendMode: "normal",
    assetId: currentAssetId,
    fit: "contain",
    crop: { x: 0.1, y: 0.15, width: 0.8, height: 0.7 },
  };
  const unrelated: RectangleNode = {
    id: randomUUID(),
    type: "rectangle",
    name: "Unrelated",
    visible: true,
    locked: false,
    transform: createTransform({ x: 20, y: 30, width: 50, height: 60 }),
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color: "#315CF5", opacity: 1 },
    cornerRadius: {
      topLeft: 0,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    },
  };
  frame.root.children.push(image, unrelated);
  const roleId = randomUUID();
  const plan = createDesignPlan({
    id: randomUUID(),
    now,
    name: "Role asset plan",
    targetFrameId: frame.id,
    objectiveSummary: "Replace only the declared role asset.",
    semanticRoles: [
      {
        id: roleId,
        key: "hero",
        name: "Hero subject",
        role: "heroSubject",
        required: true,
        nodeId: image.id,
      },
    ],
    contentHierarchy: [],
    layoutRegions: [],
    anchors: [],
    constraints: [],
    safeAreas: [],
    brandBindings: [],
    assetAssignments: [
      {
        id: randomUUID(),
        roleId,
        assetId: assignedAssetId,
        fit: "cover",
        preserveCrop: false,
      },
    ],
    effectIntentions: [],
    variantRules: [],
    protectedDecisions: [],
    approval: {
      state: "approved",
      notes: ["Approved asset assignment."],
      decidedBy: "human",
      decidedAt: now,
    },
  });
  return { frame, plan, roleId, image, unrelated, assignedAssetId };
};

describe("role asset replacement compiler", () => {
  it("emits only the declared asset and crop operations with general-compiler parity", () => {
    const { frame, plan, roleId, image, unrelated, assignedAssetId } =
      fixture();
    const compilation = compileRoleAssetReplacement({ plan, frame, roleId });
    const general = compileDesignPlan({ plan, frame, roleIds: [roleId] });
    const generalAssetOperations = general.changes
      .filter((change) => change.intent === "asset" || change.intent === "crop")
      .map((change) => general.operations[change.operationIndex]);

    expect(compilation.operations).toEqual(generalAssetOperations);
    expect(compilation.changes.map((change) => change.intent)).toEqual([
      "asset",
      "crop",
    ]);
    const next = simulateFrameOperations(frame, compilation.operations);
    const nextImage = next.frame.root.children.find(
      (node) => node.id === image.id,
    );
    expect(nextImage).toMatchObject({
      id: image.id,
      assetId: assignedAssetId,
      fit: "cover",
    });
    expect(nextImage).not.toHaveProperty("crop");
    expect(
      next.frame.root.children.find((node) => node.id === unrelated.id),
    ).toEqual(unrelated);
    const restored = simulateFrameOperations(
      next.frame,
      next.inverseOperations,
    ).frame;
    expect(restored.root.children).toEqual(frame.root.children);
  });

  it("preserves crop when declared and returns no-op truthfully", () => {
    const { frame, plan, roleId, image, assignedAssetId } = fixture();
    image.assetId = assignedAssetId;
    image.fit = "cover";
    plan.assetAssignments[0]!.preserveCrop = true;
    const compilation = compileRoleAssetReplacement({ plan, frame, roleId });
    expect(compilation.operations).toEqual([]);
    expect(compilation.warnings).toEqual([]);
    expect(image.crop).toBeDefined();
  });

  it("reports missing assignments and enforces node or crop protections", () => {
    const { frame, plan, roleId, image } = fixture();
    plan.assetAssignments = [];
    expect(
      compileRoleAssetReplacement({ plan, frame, roleId }).warnings,
    ).toEqual([
      expect.objectContaining({ code: "ASSET_ASSIGNMENT_NOT_FOUND", roleId }),
    ]);

    const value = fixture();
    const nodeProtectionId = randomUUID();
    const cropProtectionId = randomUUID();
    value.plan.protectedDecisions.push(
      {
        id: nodeProtectionId,
        kind: "node",
        roleId: value.roleId,
        nodeId: value.image.id,
        description: "Preserve the approved asset.",
      },
      {
        id: cropProtectionId,
        kind: "crop",
        roleId: value.roleId,
        nodeId: value.image.id,
        description: "Preserve the approved crop.",
      },
    );
    const protectedCompilation = compileRoleAssetReplacement({
      plan: value.plan,
      frame: value.frame,
      roleId: value.roleId,
    });
    expect(protectedCompilation.operations).toEqual([]);
    expect(new Set(protectedCompilation.protectedDecisionIds)).toEqual(
      new Set([nodeProtectionId, cropProtectionId]),
    );
    expect(image.id).toBeDefined();
  });
});
