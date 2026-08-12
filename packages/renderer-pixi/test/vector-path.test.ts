import { describe, expect, it } from "vitest";
import { vectorPathSubpaths } from "../src/vector-path.js";

describe("vector path rendering geometry", () => {
  it("maps normalized line and closed subpaths into node-local pixels", () => {
    expect(
      vectorPathSubpaths(
        [
          { id: "m1", kind: "move", to: { x: 0.1, y: 0.2 } },
          { id: "l1", kind: "line", to: { x: 0.9, y: 0.8 } },
          { id: "z1", kind: "close" },
        ],
        200,
        100,
      ),
    ).toEqual([
      {
        points: [
          { x: 20, y: 20 },
          { x: 180, y: 80 },
        ],
        closed: true,
      },
    ]);
  });

  it("samples cubic curves deterministically for dashed strokes", () => {
    const result = vectorPathSubpaths(
      [
        { id: "m1", kind: "move", to: { x: 0, y: 1 } },
        {
          id: "c1",
          kind: "cubic",
          control1: { x: 0.25, y: 0 },
          control2: { x: 0.75, y: 0 },
          to: { x: 1, y: 1 },
        },
      ],
      100,
      50,
      4,
    );
    expect(result[0]?.points).toHaveLength(5);
    expect(result[0]?.points[2]).toEqual({ x: 50, y: 12.5 });
    expect(result[0]?.points.at(-1)).toEqual({ x: 100, y: 50 });
  });
});
