import { describe, expect, it } from "vitest";
import {
  clampZoom,
  clientPointToCanvas,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  scaledCanvasSize,
} from "../src/viewport-state";

describe("Canvas viewport state", () => {
  it("clamps zoom and derives the visible artboard size", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(3)).toBe(MAX_ZOOM);
    expect(clampZoom(DEFAULT_ZOOM)).toBe(DEFAULT_ZOOM);
    expect(scaledCanvasSize({ width: 1080, height: 1350 }, 0.5)).toEqual({
      width: 540,
      height: 675,
    });
  });

  it("maps browser pointer coordinates into exact canvas coordinates", () => {
    expect(
      clientPointToCanvas(
        { x: 370, y: 440 },
        { left: 100, top: 102.5, width: 540, height: 675 },
        { width: 1080, height: 1350 },
      ),
    ).toEqual({ x: 540, y: 675 });
  });
});
