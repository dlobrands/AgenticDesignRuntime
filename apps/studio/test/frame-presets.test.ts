import { describe, expect, it } from "vitest";
import {
  MARKETING_FRAME_PRESETS,
  marketingFramePreset,
} from "../src/frame-presets";

describe("marketing frame presets", () => {
  it("keeps stable unique IDs and exact positive dimensions", () => {
    expect(new Set(MARKETING_FRAME_PRESETS.map(({ id }) => id)).size).toBe(
      MARKETING_FRAME_PRESETS.length,
    );
    expect(
      MARKETING_FRAME_PRESETS.every(
        ({ width, height }) =>
          Number.isInteger(width) &&
          width > 0 &&
          Number.isInteger(height) &&
          height > 0,
      ),
    ).toBe(true);
    expect(marketingFramePreset("youtube-thumbnail")).toMatchObject({
      width: 1280,
      height: 720,
    });
  });
});
