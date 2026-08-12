import { describe, expect, it } from "vitest";
import type { Transform } from "@tva-agentic-design/core";
import {
  calculateGestureTransforms,
  combinedBounds,
  normalizedBounds,
  transformsEqual,
  type TransformGestureMode,
} from "../src/gesture-controller";

const initial: Transform = {
  x: 20,
  y: 30,
  width: 100,
  height: 50,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  anchorX: 0,
  anchorY: 0,
};

const calculate = (
  mode: TransformGestureMode,
  latest: { x: number; y: number },
  shiftKey = false,
) =>
  calculateGestureTransforms({
    mode,
    start: { x: 100, y: 100 },
    latest,
    center: { x: 100, y: 100 },
    selectionBounds: { x: 20, y: 30, width: 100, height: 50 },
    transforms: { node: initial },
    shiftKey,
    zoom: 1,
    canvas: { width: 400, height: 300 },
    canvasDeltaToParent: (_nodeId, delta) => delta,
  }).node!;

describe("gesture controller", () => {
  it("computes and snaps move transforms outside React lifecycle state", () => {
    expect(calculate("move", { x: 82, y: 70 })).toMatchObject({ x: 0, y: 0 });
    expect(calculate("move", { x: 140, y: 110 }, true)).toMatchObject({
      x: 60,
      y: 30,
    });
  });

  it("computes southeast and northwest resize transforms", () => {
    expect(calculate("resize", { x: 150, y: 125 })).toMatchObject({
      x: 20,
      y: 30,
      scaleX: 1.5,
      scaleY: 1.5,
    });
    expect(calculate("resize-nw", { x: 50, y: 75 })).toMatchObject({
      x: -30,
      y: 5,
      scaleX: 1.5,
      scaleY: 1.5,
    });
  });

  it("snaps shifted rotation to 15 degree increments", () => {
    expect(calculate("rotate", { x: 100, y: 150 }, true).rotation).toBe(90);
  });

  it("normalizes bounds and compares complete transforms", () => {
    expect(
      combinedBounds([
        { x: 10, y: 20, width: 30, height: 40 },
        { x: -5, y: 30, width: 10, height: 20 },
      ]),
    ).toEqual({ x: -5, y: 20, width: 45, height: 40 });
    expect(normalizedBounds(20, 30, 5, 10)).toEqual({
      x: 5,
      y: 10,
      width: 15,
      height: 20,
    });
    expect(transformsEqual(initial, structuredClone(initial))).toBe(true);
    expect(transformsEqual(initial, { ...initial, x: 21 })).toBe(false);
  });
});
