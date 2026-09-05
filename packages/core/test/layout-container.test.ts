import { describe, expect, it } from "vitest";
import {
  compileLayoutContainer,
  type GroupNode,
  type RectangleNode,
} from "../src/index.js";

const rectangle = (
  id: string,
  width: number,
  height: number,
): RectangleNode => ({
  id,
  type: "rectangle",
  name: id,
  visible: true,
  locked: false,
  transform: {
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    anchorX: 0,
    anchorY: 0,
  },
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#000000", opacity: 1 },
  cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
});

const group = (children: RectangleNode[]): GroupNode => ({
  id: "00000000-0000-4000-8000-000000000001",
  type: "group",
  name: "Layout",
  visible: true,
  locked: false,
  transform: {
    x: 0,
    y: 0,
    width: 300,
    height: 100,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    anchorX: 0,
    anchorY: 0,
  },
  opacity: 1,
  blendMode: "normal",
  children,
});

describe("layout containers", () => {
  it("compiles explicit row spacing into ordinary stable-ID transforms", () => {
    const first = rectangle("00000000-0000-4000-8000-000000000002", 40, 20);
    const second = rectangle("00000000-0000-4000-8000-000000000003", 60, 30);
    const result = compileLayoutContainer(group([first, second]), {
      direction: "row",
      gap: 10,
      padding: { top: 10, right: 20, bottom: 10, left: 20 },
      align: "center",
      distribution: "space-between",
      wrap: false,
    });
    expect(result.warnings).toEqual([]);
    expect(result.operations).toEqual([
      expect.objectContaining({ propertyGroup: "layout" }),
      expect.objectContaining({
        nodeId: first.id,
        value: { x: 20, y: 40 },
      }),
      expect.objectContaining({
        nodeId: second.id,
        value: { x: 220, y: 35 },
      }),
    ]);
  });

  it("leaves locked children unchanged and reports them", () => {
    const locked = rectangle("00000000-0000-4000-8000-000000000004", 40, 20);
    locked.locked = true;
    const result = compileLayoutContainer(group([locked]), {
      direction: "column",
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: "start",
      distribution: "start",
      wrap: false,
    });
    expect(result.operations).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "LAYOUT_LOCKED_CHILD_SKIPPED",
      nodeIds: [locked.id],
    });
  });
});
