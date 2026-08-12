import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DesignPlanSchema,
  ProjectDocumentSchema,
  createDesignPlan,
  createProjectDocument,
} from "../src/index.js";

const now = "2026-08-10T21:00:00.000Z";

const plan = () => {
  const headlineRoleId = randomUUID();
  const heroRoleId = randomUUID();
  const regionId = randomUUID();
  return createDesignPlan({
    id: randomUUID(),
    now,
    name: "Campaign launch plan",
    briefId: randomUUID(),
    targetFrameId: randomUUID(),
    objectiveSummary: "Turn approved campaign intent into a structured layout.",
    semanticRoles: [
      {
        id: headlineRoleId,
        key: "headline",
        name: "Primary headline",
        role: "headline",
        required: true,
        nodeId: randomUUID(),
        copyItemId: randomUUID(),
      },
      {
        id: heroRoleId,
        key: "heroSubject",
        name: "Hero subject",
        role: "heroSubject",
        required: true,
      },
    ],
    contentHierarchy: [
      { id: randomUUID(), roleId: headlineRoleId, priority: 1 },
      {
        id: randomUUID(),
        roleId: heroRoleId,
        parentRoleId: headlineRoleId,
        priority: 2,
      },
    ],
    layoutRegions: [
      {
        id: regionId,
        key: "primary",
        name: "Primary content",
        x: 0.08,
        y: 0.08,
        width: 0.84,
        height: 0.84,
      },
    ],
    anchors: [
      {
        id: randomUUID(),
        roleId: headlineRoleId,
        regionId,
        horizontal: "start",
        vertical: "end",
        offsetX: 0,
        offsetY: -0.04,
      },
    ],
    constraints: [
      {
        id: randomUUID(),
        kind: "preserve",
        priority: "must",
        description: "Preserve approved headline copy exactly.",
        roleId: headlineRoleId,
      },
    ],
    safeAreas: [
      {
        id: randomUUID(),
        name: "Platform safety",
        top: 0.05,
        right: 0.05,
        bottom: 0.05,
        left: 0.05,
        regionId,
      },
    ],
    brandBindings: [
      {
        id: randomUUID(),
        roleId: headlineRoleId,
        property: "textColor",
        tokenKey: "brand.cobalt",
      },
    ],
    assetAssignments: [
      {
        id: randomUUID(),
        roleId: heroRoleId,
        assetId: randomUUID(),
        fit: "cover",
        preserveCrop: true,
      },
    ],
    effectIntentions: [
      {
        id: randomUUID(),
        roleId: headlineRoleId,
        effectType: "outerShadow",
        enabled: true,
        description: "Use a restrained depth cue.",
      },
    ],
    variantRules: [
      {
        id: randomUUID(),
        name: "YouTube thumbnail",
        description: "Preserve hierarchy while adapting to 16:9.",
        format: {
          width: 1280,
          height: 720,
          channel: "youtubeThumbnail",
        },
        roleBehaviors: [
          { roleId: headlineRoleId, behavior: "reflow" },
          { roleId: heroRoleId, behavior: "resize" },
        ],
      },
    ],
    protectedDecisions: [
      {
        id: randomUUID(),
        kind: "copy",
        description: "Human-approved headline cannot be rewritten.",
        roleId: headlineRoleId,
      },
    ],
    approval: {
      state: "approved",
      notes: ["Approved for intent compilation."],
      decidedBy: "human:campaign-owner",
      decidedAt: now,
    },
  });
};

describe("DesignPlan", () => {
  it("captures bounded non-executable semantic planning intent", () => {
    const value = plan();
    expect(value).toMatchObject({
      createdAt: now,
      updatedAt: now,
      approval: { state: "approved" },
      semanticRoles: [
        expect.objectContaining({ role: "headline" }),
        expect.objectContaining({ role: "heroSubject" }),
      ],
    });
    expect(DesignPlanSchema.parse(value)).toEqual(value);
    expect(() =>
      DesignPlanSchema.parse({ ...value, script: "deleteAllNodes()" }),
    ).toThrow(/Unrecognized key/);
  });

  it("rejects missing references, cycles, invalid regions, and fake approval", () => {
    const value = plan();
    expect(() =>
      DesignPlanSchema.parse({
        ...value,
        anchors: [{ ...value.anchors[0]!, roleId: randomUUID() }],
      }),
    ).toThrow(/missing semantic role/);
    const [first, second] = value.semanticRoles;
    expect(() =>
      DesignPlanSchema.parse({
        ...value,
        contentHierarchy: [
          {
            id: randomUUID(),
            roleId: first!.id,
            parentRoleId: second!.id,
            priority: 1,
          },
          {
            id: randomUUID(),
            roleId: second!.id,
            parentRoleId: first!.id,
            priority: 2,
          },
        ],
      }),
    ).toThrow(/cycle/);
    expect(() =>
      DesignPlanSchema.parse({
        ...value,
        contentHierarchy: [
          value.contentHierarchy[0]!,
          {
            ...value.contentHierarchy[0]!,
            id: randomUUID(),
            priority: 2,
          },
        ],
      }),
    ).toThrow(/only once/);
    expect(() =>
      DesignPlanSchema.parse({
        ...value,
        layoutRegions: [{ ...value.layoutRegions[0]!, x: 0.5, width: 0.6 }],
      }),
    ).toThrow(/normalized width/);
    expect(() =>
      DesignPlanSchema.parse({
        ...value,
        approval: { state: "approved", notes: [] },
      }),
    ).toThrow(/decision author/);
    expect(() =>
      DesignPlanSchema.parse({
        ...value,
        protectedDecisions: [
          {
            id: randomUUID(),
            kind: "node",
            description: "Missing protected node target.",
          },
        ],
      }),
    ).toThrow(/requires a node ID/);
    expect(() =>
      DesignPlanSchema.parse({
        ...value,
        protectedDecisions: [
          {
            id: randomUUID(),
            kind: "role",
            description: "Missing protected role target.",
          },
        ],
      }),
    ).toThrow(/requires a semantic role ID/);
  });

  it("remains optional in legacy projects and validates unique plan names", () => {
    const project = createProjectDocument({
      id: randomUUID(),
      slug: "plan-project",
      name: "Plan project",
      now,
    });
    delete project.designPlans;
    expect(ProjectDocumentSchema.parse(project).designPlans).toBeUndefined();
    const first = plan();
    expect(() =>
      ProjectDocumentSchema.parse({
        ...project,
        designPlans: [first, { ...first, id: randomUUID() }],
      }),
    ).toThrow(/names must be unique/);
  });
});
