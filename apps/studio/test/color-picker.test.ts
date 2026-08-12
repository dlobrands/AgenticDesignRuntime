import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex } from "../src/ColorPicker";

describe("live color conversion", () => {
  it.each(["#000000", "#FFFFFF", "#315BFF", "#B83A4B", "#24C98B"])(
    "round-trips %s without color drift",
    (color) => {
      expect(hsvToHex(hexToHsv(color))).toBe(color);
    },
  );

  it("normalizes hue and clamps saturation and brightness", () => {
    expect(hsvToHex({ hue: 360, saturation: 1, value: 1 })).toBe("#FF0000");
    expect(hsvToHex({ hue: -120, saturation: 1, value: 1 })).toBe("#0000FF");
  });
});
