import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ProjectTemplateDefinitionSchema,
  createFrameDocument,
  createProjectTemplateDefinition,
  createTransform,
  detachTemplateInstanceOperations,
  findNode,
  instantiateProjectTemplate,
  simulateFrameOperations,
  templateSourceNodeIds,
  type RectangleNode,
  type SceneNode,
} from "../src/index.js";

const now = "2026-08-10T16:00:00.000Z";

const rectangle = (name: string): RectangleNode => ({
  id: randomUUID(),
  type: "rectangle",
  name,
  visible: true,
  locked: false,
  transform: createTransform({ x: 24, y: 32, width: 240, height: 120 }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#315CF5", opacity: 1 },
  cornerRadius: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
});

const withoutTemplateMetadata = (node: SceneNode): SceneNode => {
  const copy = structuredClone(node);
  const visit = (current: SceneNode): void => {
    delete current.templateInstance;
    delete current.templateSlot;
    if (current.type === "group") current.children.forEach(visit);
    if (current.type === "mask") {
      visit(current.maskSource);
      current.children.forEach(visit);
    }
  };
  visit(copy);
  return copy;
};

describe("canonical project templates", () => {
  it("captures clean source layers and validates semantic slot references", () => {
    const headline = rectangle("Headline");
    headline.templateInstance = {
      templateId: randomUUID(),
      instanceId: randomUUID(),
      sourceNodeId: randomUUID(),
    };
    headline.templateSlot = {
      slotId: randomUUID(),
      key: "old-headline",
      name: "Old headline",
      role: "headline",
    };
    const slotId = randomUUID();
    const template = createProjectTemplateDefinition({
      id: randomUUID(),
      name: "Campaign card",
      nodes: [headline],
      slots: [
        {
          slotId,
          key: "headline",
          name: "Headline",
          role: "headline",
          nodeId: headline.id,
        },
      ],
      now,
    });
    expect(template.nodes[0]).not.toHaveProperty("templateInstance");
    expect(template.nodes[0]).not.toHaveProperty("templateSlot");
    expect(template.slots).toEqual([
      expect.objectContaining({
        slotId,
        nodeId: headline.id,
        role: "headline",
      }),
    ]);

    expect(() =>
      ProjectTemplateDefinitionSchema.parse({
        ...template,
        slots: [{ ...template.slots[0], nodeId: randomUUID() }],
      }),
    ).toThrow(/source node/);
    expect(() =>
      ProjectTemplateDefinitionSchema.parse({
        ...template,
        slots: [template.slots[0], { ...template.slots[0] }],
      }),
    ).toThrow(/unique|at most one/);
  });

  it("instantiates ordinary stable-ID nodes and remaps internal adjustment targets", () => {
    const hero = rectangle("Hero");
    const adjustmentId = randomUUID();
    const template = createProjectTemplateDefinition({
      id: randomUUID(),
      name: "Hero system",
      nodes: [
        hero,
        {
          id: adjustmentId,
          type: "adjustment",
          name: "Hero tone",
          visible: true,
          locked: false,
          transform: createTransform({ width: 1, height: 1 }),
          enabled: true,
          targetId: hero.id,
          values: {
            brightness: 0.05,
            contrast: 0,
            saturation: 0,
            hue: 0,
            blur: 0,
          },
        },
      ],
      slots: [
        {
          slotId: randomUUID(),
          key: "hero-image",
          name: "Hero image",
          role: "heroImage",
          nodeId: hero.id,
        },
      ],
      now,
    });
    const instanceId = randomUUID();
    const groupId = randomUUID();
    const idMap = Object.fromEntries(
      templateSourceNodeIds(template).map((id) => [id, randomUUID()]),
    );
    const group = instantiateProjectTemplate({
      template,
      instanceId,
      groupId,
      idMap,
    });
    expect(group).toMatchObject({
      id: groupId,
      type: "group",
      blendMode: "pass-through",
      templateInstance: { templateId: template.id, instanceId },
    });
    expect(group.children[0]).toMatchObject({
      id: idMap[hero.id],
      templateInstance: { sourceNodeId: hero.id, instanceId },
      templateSlot: { role: "heroImage", key: "hero-image" },
    });
    expect(group.children[1]).toMatchObject({
      id: idMap[adjustmentId],
      targetId: idMap[hero.id],
    });
    expect(template.nodes[0]?.id).toBe(hero.id);
  });

  it("detaches metadata reversibly without changing visible node content, including locked layers", () => {
    const source = rectangle("Locked CTA");
    source.locked = true;
    const template = createProjectTemplateDefinition({
      id: randomUUID(),
      name: "CTA system",
      nodes: [source],
      slots: [
        {
          slotId: randomUUID(),
          key: "cta",
          name: "CTA",
          role: "cta",
          nodeId: source.id,
        },
      ],
      now,
    });
    const instanceId = randomUUID();
    const idMap = { [source.id]: randomUUID() };
    const group = instantiateProjectTemplate({
      template,
      instanceId,
      groupId: randomUUID(),
      idMap,
    });
    group.locked = true;
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "template-instance",
      name: "Template instance",
      width: 1080,
      height: 1350,
      now,
    });
    frame.root.children.push(group);
    const beforeVisual = withoutTemplateMetadata(group);
    const operations = detachTemplateInstanceOperations(frame, instanceId);
    expect(operations).toHaveLength(2);
    const detached = simulateFrameOperations(frame, operations);
    const detachedGroup = detached.frame.root.children[0]!;
    expect(
      findNode(detached.frame, group.id)?.templateInstance,
    ).toBeUndefined();
    expect(
      findNode(detached.frame, idMap[source.id]!)?.templateSlot,
    ).toBeUndefined();
    expect(withoutTemplateMetadata(detachedGroup)).toEqual(beforeVisual);
    const restored = simulateFrameOperations(
      detached.frame,
      detached.inverseOperations,
    );
    expect(findNode(restored.frame, group.id)?.templateInstance).toEqual(
      group.templateInstance,
    );
    expect(findNode(restored.frame, idMap[source.id]!)?.templateSlot).toEqual(
      group.children[0]?.templateSlot,
    );
  });

  it("rejects incomplete and colliding replacement ID maps", () => {
    const first = rectangle("First");
    const second = rectangle("Second");
    const template = createProjectTemplateDefinition({
      id: randomUUID(),
      name: "Pair",
      nodes: [first, second],
      slots: [],
      now,
    });
    expect(() =>
      instantiateProjectTemplate({
        template,
        instanceId: randomUUID(),
        groupId: randomUUID(),
        idMap: { [first.id]: randomUUID() },
      }),
    ).toThrow(/every source node/);
    const duplicate = randomUUID();
    expect(() =>
      instantiateProjectTemplate({
        template,
        instanceId: randomUUID(),
        groupId: randomUUID(),
        idMap: { [first.id]: duplicate, [second.id]: duplicate },
      }),
    ).toThrow(/unique/);
  });
});
