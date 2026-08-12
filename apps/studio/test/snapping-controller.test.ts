import { describe, expect, it } from "vitest";
import { calculateMoveSnap } from "../src/snapping-controller";

const base = {
  selectionBounds: { x: 100, y: 100, width: 40, height: 40 },
  canvas: { width: 400, height: 300 },
  threshold: 7,
  enabled: true,
};

describe("move snapping controller", () => {
  it("snaps selected edges and centers to persistent guides and objects", () => {
    const guide = calculateMoveSnap({
      ...base,
      rawDelta: { x: 17, y: 0 },
      guides: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          axis: "vertical",
          position: 160,
        },
      ],
    });
    expect(guide.delta.x).toBe(20);
    expect(guide.lines).toContainEqual({
      axis: "vertical",
      position: 160,
      kind: "guide",
    });

    const object = calculateMoveSnap({
      ...base,
      rawDelta: { x: 57, y: 0 },
      otherBounds: [{ x: 200, y: 80, width: 50, height: 80 }],
    });
    expect(object.delta.x).toBe(60);
    expect(object.lines).toContainEqual({
      axis: "vertical",
      position: 200,
      kind: "object",
    });
  });

  it("snaps between peers at equal spacing and reports the exact gap", () => {
    const result = calculateMoveSnap({
      ...base,
      selectionBounds: { x: 0, y: 100, width: 40, height: 40 },
      rawDelta: { x: 78, y: 0 },
      otherBounds: [
        { x: 0, y: 100, width: 50, height: 40 },
        { x: 150, y: 100, width: 50, height: 40 },
      ],
    });
    expect(result.delta.x).toBe(80);
    expect(result.spacing).toContainEqual({
      axis: "horizontal",
      start: 50,
      end: 150,
      crossPosition: 120,
      gap: 30,
    });
  });

  it("returns raw movement and no feedback when snapping is disabled", () => {
    expect(
      calculateMoveSnap({
        ...base,
        rawDelta: { x: 17, y: 11 },
        enabled: false,
        guides: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            axis: "vertical",
            position: 160,
          },
        ],
      }),
    ).toEqual({ delta: { x: 17, y: 11 }, lines: [], spacing: [] });
  });
});
