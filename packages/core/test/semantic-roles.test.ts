import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assignSemanticRole,
  createFrameDocument,
  createTransform,
  inspectDesignRoles,
  type DesignPlan,
  type RectangleNode,
} from "../src/index.js";

const createdAt = "2026-08-10T22:10:00.000Z";
const updatedAt = "2026-08-10T22:11:00.000Z";

const rectangle = (id: string, name: string): RectangleNode => ({
  id,
  type: "rectangle",
  name,
  visible: true,
  locked: false,
  transform: createTransform({ x: 40, y: 50, width: 200, height: 100 }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#315CF5", opacity: 1 },
  cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
});

const planFixture = (input: {
  frameId: string;
  headlineRoleId: string;
  heroRoleId: string;
  headlineNodeId?: string;
}): DesignPlan => ({
  id: randomUUID(),
  name: "Semantic campaign",
  targetFrameId: input.frameId,
  objectiveSummary: "Bind stable roles to canonical nodes.",
  semanticRoles: [
    {
      id: input.headlineRoleId,
      key: "headline",
      name: "Headline",
      role: "headline",
      required: true,
      ...(input.headlineNodeId ? { nodeId: input.headlineNodeId } : {}),
    },
    {
      id: input.heroRoleId,
      key: "hero",
      name: "Hero",
      role: "heroSubject",
      required: false,
    },
  ],
  contentHierarchy: [],
  layoutRegions: [],
  anchors: [],
  constraints: [],
  safeAreas: [],
  brandBindings: [],
  assetAssignments: [],
  effectIntentions: [],
  variantRules: [],
  protectedDecisions: [],
  approval: {
    state: "approved",
    notes: ["Approved before assignment."],
    decidedBy: "Human reviewer",
    decidedAt: createdAt,
  },
  createdAt,
  updatedAt: createdAt,
});

describe("semantic role assignment and inspection", () => {
  it("reports stable binding health and effective visibility without mutation", () => {
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "roles",
      name: "Roles",
      width: 800,
      height: 600,
      now: createdAt,
    });
    frame.revision = 7;
    const nodeId = randomUUID();
    frame.root.children.push(rectangle(nodeId, "Headline panel"));
    const headlineRoleId = randomUUID();
    const heroRoleId = randomUUID();
    const plan = planFixture({
      frameId: frame.id,
      headlineRoleId,
      heroRoleId,
      headlineNodeId: nodeId,
    });
    const before = structuredClone(plan);

    expect(inspectDesignRoles(plan, frame)).toMatchObject({
      schemaVersion: 1,
      planId: plan.id,
      targetFrameId: frame.id,
      targetFrameRevision: 7,
      summary: {
        total: 2,
        bound: 1,
        unbound: 1,
        missing: 0,
        requiredMissing: 0,
      },
      roles: [
        {
          id: headlineRoleId,
          bindingStatus: "bound",
          node: { id: nodeId, name: "Headline panel", visible: true },
        },
        { id: heroRoleId, bindingStatus: "unbound" },
      ],
    });
    expect(plan).toEqual(before);

    frame.root.children = [];
    expect(inspectDesignRoles(plan, frame)).toMatchObject({
      summary: { missing: 1, requiredMissing: 1 },
      roles: [
        { id: headlineRoleId, bindingStatus: "missingNode" },
        { id: heroRoleId, bindingStatus: "unbound" },
      ],
    });
  });

  it("changes only the selected role, preserves IDs, and invalidates approval", () => {
    const frameId = randomUUID();
    const headlineRoleId = randomUUID();
    const heroRoleId = randomUUID();
    const nodeId = randomUUID();
    const copyItemId = randomUUID();
    const plan = planFixture({ frameId, headlineRoleId, heroRoleId });
    const untouchedRole = structuredClone(plan.semanticRoles[0]);

    const next = assignSemanticRole({
      plan,
      roleId: heroRoleId,
      assignment: { nodeId, copyItemId },
      now: updatedAt,
    });

    expect(next.id).toBe(plan.id);
    expect(next.createdAt).toBe(plan.createdAt);
    expect(next.updatedAt).toBe(updatedAt);
    expect(next.semanticRoles).toEqual([
      untouchedRole,
      expect.objectContaining({ id: heroRoleId, nodeId, copyItemId }),
    ]);
    expect(next.approval).toEqual({
      state: "draft",
      notes: [
        "Approved before assignment.",
        "Role assignment for “Hero” changed after the prior plan state.",
      ],
    });
    expect(plan.semanticRoles[1]).not.toHaveProperty("nodeId");
    expect(plan.approval.state).toBe("approved");

    const detached = assignSemanticRole({
      plan: next,
      roleId: heroRoleId,
      assignment: { nodeId: null, copyItemId: null },
      now: "2026-08-10T22:12:00.000Z",
    });
    expect(detached.semanticRoles[1]).not.toHaveProperty("nodeId");
    expect(detached.semanticRoles[1]).not.toHaveProperty("copyItemId");
  });

  it("rejects missing, protected, and no-op assignments", () => {
    const frameId = randomUUID();
    const headlineRoleId = randomUUID();
    const heroRoleId = randomUUID();
    const nodeId = randomUUID();
    const plan = planFixture({
      frameId,
      headlineRoleId,
      heroRoleId,
      headlineNodeId: nodeId,
    });
    expect(() =>
      assignSemanticRole({
        plan,
        roleId: randomUUID(),
        assignment: { nodeId: null },
        now: updatedAt,
      }),
    ).toThrow(/was not found/);
    expect(() =>
      assignSemanticRole({
        plan,
        roleId: headlineRoleId,
        assignment: { nodeId },
        now: updatedAt,
      }),
    ).toThrow(/already has the requested assignment/);

    plan.protectedDecisions.push({
      id: randomUUID(),
      kind: "role",
      roleId: headlineRoleId,
      description: "Keep the human role binding.",
    });
    expect(() =>
      assignSemanticRole({
        plan,
        roleId: headlineRoleId,
        assignment: { nodeId: null },
        now: updatedAt,
      }),
    ).toThrow(/is protected/);
  });
});
