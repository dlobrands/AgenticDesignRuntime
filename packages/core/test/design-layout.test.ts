import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileDesignLayout,
  compileDesignPlan,
  createDesignPlan,
  createFrameDocument,
  createTransform,
  ReflowContentOptionsSchema,
  simulateFrameOperations,
  type RectangleNode,
} from "../src/index.js";

const now = "2026-08-10T22:00:00.000Z";

const fixture = () => {
  const frame = createFrameDocument({
    id: randomUUID(),
    slug: "layout-frame",
    name: "Layout frame",
    width: 1_000,
    height: 800,
    now,
  });
  const headline: RectangleNode = {
    id: randomUUID(),
    type: "rectangle",
    name: "Headline block",
    visible: true,
    locked: false,
    transform: createTransform({ x: 10, y: 20, width: 200, height: 100 }),
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color: "#111111", opacity: 1 },
    cornerRadius: {
      topLeft: 0,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    },
  };
  const badge: RectangleNode = {
    ...structuredClone(headline),
    id: randomUUID(),
    name: "Badge",
    transform: createTransform({ x: 700, y: 600, width: 80, height: 40 }),
  };
  const unrelated: RectangleNode = {
    ...structuredClone(headline),
    id: randomUUID(),
    name: "Unrelated",
    transform: createTransform({ x: 900, y: 700, width: 20, height: 20 }),
  };
  frame.root.children.push(headline, badge, unrelated);

  const headlineRoleId = randomUUID();
  const badgeRoleId = randomUUID();
  const regionId = randomUUID();
  const plan = createDesignPlan({
    id: randomUUID(),
    now,
    name: "Layout plan",
    targetFrameId: frame.id,
    objectiveSummary: "Apply only explicit normalized layout intent.",
    semanticRoles: [
      {
        id: headlineRoleId,
        key: "headline",
        name: "Headline",
        role: "headline",
        required: true,
        nodeId: headline.id,
      },
      {
        id: badgeRoleId,
        key: "badge",
        name: "Badge",
        role: "badge",
        required: false,
        nodeId: badge.id,
      },
    ],
    contentHierarchy: [],
    layoutRegions: [
      {
        id: regionId,
        key: "primary",
        name: "Primary",
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.25,
      },
    ],
    anchors: [
      {
        id: randomUUID(),
        roleId: headlineRoleId,
        regionId,
        horizontal: "center",
        vertical: "center",
        offsetX: 0.01,
        offsetY: -0.0125,
      },
      {
        id: randomUUID(),
        roleId: badgeRoleId,
        horizontal: "end",
        vertical: "end",
        offsetX: -0.05,
        offsetY: -0.05,
      },
    ],
    constraints: [],
    safeAreas: [
      {
        id: randomUUID(),
        name: "Campaign safe area",
        top: 0.05,
        right: 0.05,
        bottom: 0.05,
        left: 0.05,
      },
    ],
    brandBindings: [],
    assetAssignments: [],
    effectIntentions: [],
    variantRules: [],
    protectedDecisions: [],
    approval: {
      state: "approved",
      notes: ["Approved layout."],
      decidedBy: "human",
      decidedAt: now,
    },
  });
  return {
    frame,
    plan,
    headline,
    badge,
    unrelated,
    headlineRoleId,
    badgeRoleId,
  };
};

describe("design layout compiler", () => {
  it("applies the declared layout system with the same canonical layout operations as the general compiler", () => {
    const { frame, plan, headline, badge, unrelated } = fixture();
    const compilation = compileDesignLayout({
      plan,
      frame,
      includeSafeArea: true,
    });
    const general = compileDesignPlan({ plan, frame });
    const generalLayoutOperations = general.changes
      .filter(
        (change) => change.intent === "layout" || change.intent === "safeArea",
      )
      .map((change) => general.operations[change.operationIndex]);

    expect(compilation.operations).toEqual(generalLayoutOperations);
    expect(compilation.changes.map((change) => change.intent)).toEqual([
      "safeArea",
      "layout",
      "layout",
    ]);
    const next = simulateFrameOperations(frame, compilation.operations);
    expect(next.frame.canvas.safeArea).toEqual({
      top: 40,
      right: 50,
      bottom: 40,
      left: 50,
    });
    expect(
      next.frame.root.children.find((node) => node.id === headline.id)
        ?.transform,
    ).toMatchObject({ x: 210, y: 120, width: 200, height: 100 });
    expect(
      next.frame.root.children.find((node) => node.id === badge.id)?.transform,
    ).toMatchObject({ x: 870, y: 720, width: 80, height: 40 });
    expect(
      next.frame.root.children.find((node) => node.id === unrelated.id),
    ).toEqual(unrelated);
  });

  it("reflows only explicitly selected roles without changing the canvas", () => {
    const { frame, plan, badgeRoleId, headline, badge, unrelated } = fixture();
    const compilation = compileDesignLayout({
      plan,
      frame,
      roleIds: [badgeRoleId],
      includeSafeArea: false,
    });
    expect(compilation.selectedRoleIds).toEqual([badgeRoleId]);
    expect(compilation.operations).toHaveLength(1);
    expect(compilation.operations[0]).toMatchObject({
      kind: "updateNode",
      nodeId: badge.id,
      propertyGroup: "transform",
    });
    const next = simulateFrameOperations(frame, compilation.operations);
    expect(next.frame.canvas).toEqual(frame.canvas);
    expect(
      next.frame.root.children.find((node) => node.id === headline.id),
    ).toEqual(headline);
    expect(
      next.frame.root.children.find((node) => node.id === unrelated.id),
    ).toEqual(unrelated);
  });

  it("preserves protected positions and rejects ambiguous reflow inputs", () => {
    const { frame, plan, headlineRoleId, badgeRoleId, headline } = fixture();
    const roleProtectionId = randomUUID();
    const canvasProtectionId = randomUUID();
    plan.protectedDecisions.push(
      {
        id: roleProtectionId,
        kind: "position",
        description: "Keep the approved headline position.",
        roleId: headlineRoleId,
        nodeId: headline.id,
      },
      {
        id: canvasProtectionId,
        kind: "position",
        description: "Keep the approved canvas safe area.",
      },
    );
    plan.anchors = plan.anchors.filter(
      (anchor) => anchor.roleId !== badgeRoleId,
    );

    const compilation = compileDesignLayout({
      plan,
      frame,
      roleIds: [headlineRoleId, badgeRoleId],
      includeSafeArea: true,
    });
    expect(compilation.operations).toEqual([]);
    expect(new Set(compilation.protectedDecisionIds)).toEqual(
      new Set([roleProtectionId, canvasProtectionId]),
    );
    expect(compilation.warnings.map((warning) => warning.code)).toEqual([
      "PROTECTED_DECISION",
      "PROTECTED_DECISION",
      "UNSUPPORTED_INTENT",
    ]);

    expect(() =>
      ReflowContentOptionsSchema.parse({
        roleIds: [headlineRoleId, headlineRoleId],
      }),
    ).toThrow(/unique/);
  });
});
