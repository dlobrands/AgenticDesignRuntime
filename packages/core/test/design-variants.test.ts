import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileDesignPlan,
  compileDesignVariant,
  createDesignPlan,
  createFrameDocument,
  createTransform,
  simulateFrameOperations,
  type RectangleNode,
} from "../src/index.js";

const now = "2026-08-11T00:00:00.000Z";

const fixture = () => {
  const frame = createFrameDocument({
    id: randomUUID(),
    slug: "variant-frame",
    name: "Variant frame",
    width: 1_000,
    height: 800,
    now,
  });
  const node = (name: string, x: number, y: number): RectangleNode => ({
    id: randomUUID(),
    type: "rectangle",
    name,
    visible: true,
    locked: false,
    transform: createTransform({ x, y, width: 200, height: 100 }),
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color: "#315CF5", opacity: 1 },
    cornerRadius: {
      topLeft: 0,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    },
  });
  const headline = node("Headline", 10, 20);
  const hero = node("Hero", 300, 160);
  const badge = node("Badge", 700, 600);
  const unrelated = node("Unrelated", 900, 700);
  frame.root.children.push(headline, hero, badge, unrelated);
  const headlineRoleId = randomUUID();
  const heroRoleId = randomUUID();
  const badgeRoleId = randomUUID();
  const variantRuleId = randomUUID();
  const regionId = randomUUID();
  const plan = createDesignPlan({
    id: randomUUID(),
    now,
    name: "Variant plan",
    targetFrameId: frame.id,
    objectiveSummary: "Apply only explicit same-format variant behavior.",
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
      {
        id: heroRoleId,
        key: "hero",
        name: "Hero",
        role: "heroSubject",
        required: true,
        nodeId: hero.id,
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
        width: 0.6,
        height: 0.4,
      },
    ],
    anchors: [
      {
        id: randomUUID(),
        roleId: headlineRoleId,
        regionId,
        horizontal: "center",
        vertical: "center",
        offsetX: 0,
        offsetY: 0,
      },
      {
        id: randomUUID(),
        roleId: badgeRoleId,
        horizontal: "stretch",
        vertical: "end",
        offsetX: 0.1,
        offsetY: -0.05,
      },
    ],
    constraints: [],
    safeAreas: [],
    brandBindings: [],
    assetAssignments: [],
    effectIntentions: [],
    variantRules: [
      {
        id: variantRuleId,
        name: "Compact campaign",
        description: "Reflow the headline, resize the badge, and hide hero.",
        format: {
          width: 1_000,
          height: 800,
          channel: "promotionalCard",
        },
        roleBehaviors: [
          { roleId: headlineRoleId, behavior: "reflow" },
          { roleId: badgeRoleId, behavior: "resize" },
          { roleId: heroRoleId, behavior: "hide" },
        ],
      },
    ],
    protectedDecisions: [],
    approval: {
      state: "approved",
      notes: ["Approved variant."],
      decidedBy: "human",
      decidedAt: now,
    },
  });
  return {
    frame,
    plan,
    variantRuleId,
    headlineRoleId,
    heroRoleId,
    badgeRoleId,
    headline,
    hero,
    badge,
    unrelated,
  };
};

describe("DesignPlan variant compiler", () => {
  it("matches explicit general variant operations and preserves unrelated state", () => {
    const value = fixture();
    const compilation = compileDesignVariant({
      plan: value.plan,
      frame: value.frame,
      variantRuleId: value.variantRuleId,
    });
    const general = compileDesignPlan({
      plan: value.plan,
      frame: value.frame,
      roleIds: [value.headlineRoleId, value.badgeRoleId, value.heroRoleId],
      variantRuleId: value.variantRuleId,
    });
    const generalVariantOperations = general.changes
      .filter(
        (change) => change.intent === "layout" || change.intent === "variant",
      )
      .map((change) => general.operations[change.operationIndex]);
    expect(compilation.operations).toEqual(generalVariantOperations);
    expect(
      compilation.changes.every((change) => change.intent === "variant"),
    ).toBe(true);
    const next = simulateFrameOperations(value.frame, compilation.operations);
    expect(
      next.frame.root.children.find((node) => node.id === value.headline.id)
        ?.transform,
    ).toMatchObject({ x: 300, y: 190 });
    expect(
      next.frame.root.children.find((node) => node.id === value.badge.id)
        ?.transform,
    ).toMatchObject({ x: 100, y: 660, width: 800 });
    expect(
      next.frame.root.children.find((node) => node.id === value.hero.id),
    ).toMatchObject({ id: value.hero.id, visible: false });
    expect(
      next.frame.root.children.find((node) => node.id === value.unrelated.id),
    ).toEqual(value.unrelated);
    expect(
      simulateFrameOperations(next.frame, next.inverseOperations).frame.root
        .children,
    ).toEqual(value.frame.root.children);
  });

  it("rejects format-changing rules without compiling a partial variant", () => {
    const value = fixture();
    value.plan.variantRules[0]!.format = {
      width: 1_080,
      height: 1_350,
      channel: "socialPost",
    };
    const compilation = compileDesignVariant({
      plan: value.plan,
      frame: value.frame,
      variantRuleId: value.variantRuleId,
    });
    expect(compilation.operations).toEqual([]);
    expect(compilation.warnings).toEqual([
      expect.objectContaining({
        code: "UNSUPPORTED_INTENT",
        message: expect.stringContaining("no partial variant"),
      }),
    ]);
  });

  it("requires resize stretch intent and preserves protected visibility", () => {
    const value = fixture();
    const protectionId = randomUUID();
    value.plan.anchors.find(
      (anchor) => anchor.roleId === value.badgeRoleId,
    )!.horizontal = "center";
    value.plan.protectedDecisions.push({
      id: protectionId,
      kind: "node",
      roleId: value.heroRoleId,
      nodeId: value.hero.id,
      description: "Keep the approved hero visible.",
    });
    const compilation = compileDesignVariant({
      plan: value.plan,
      frame: value.frame,
      variantRuleId: value.variantRuleId,
    });
    expect(
      compilation.operations.every(
        (operation) =>
          operation.kind === "updateNode" &&
          operation.nodeId === value.headline.id,
      ),
    ).toBe(true);
    expect(compilation.protectedDecisionIds).toContain(protectionId);
    expect(compilation.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_INTENT" }),
        expect.objectContaining({ code: "PROTECTED_DECISION" }),
      ]),
    );
  });
});
