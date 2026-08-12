import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  GradientStop,
  LinearGradientFill,
  RadialGradientFill,
} from "@tva-agentic-design/core";
import { gradientPixels } from "../src/gradient.js";

const gradient = (dither: boolean): LinearGradientFill => ({
  type: "linearGradient",
  start: { x: 0, y: 0 },
  end: { x: 1, y: 0 },
  stops: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      offset: 0,
      color: "#000000",
      opacity: 1,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      offset: 1,
      color: "#FFFFFF",
      opacity: 1,
    },
  ],
  interpolation: "linear-srgb",
  spread: "pad",
  dither: dither as true,
});

const opacityStops: GradientStop[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    offset: 0,
    color: "#FF0000",
    opacity: 0.25,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    offset: 0.5,
    color: "#00FF00",
    opacity: 0.75,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    offset: 1,
    color: "#0000FF",
    opacity: 1,
  },
];

describe("deterministic visual mappings", () => {
  it("keeps a stable golden raster and never uses time-based dither", () => {
    const fill = gradient(true);
    const first = gradientPixels(fill, 64, 8, ["frame", "node"]);
    const second = gradientPixels(fill, 64, 8, ["frame", "node"]);
    expect(second).toEqual(first);
    expect(createHash("sha256").update(first).digest("hex")).toBe(
      "33f7181a08636572117b279c397b4299c26e7dd5708b1f837d47e4105ac31f78",
    );
  });

  it("interpolates in linear sRGB and constrains dither to one channel step", () => {
    const plain = gradientPixels(gradient(false), 3, 1, ["stable"]);
    expect([...plain.slice(4, 7)]).toEqual([188, 188, 188]);
    const dithered = gradientPixels(gradient(true), 3, 1, ["stable"]);
    for (let index = 0; index < plain.length; index += 1) {
      expect(Math.abs(plain[index]! - dithered[index]!)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps per-stop opacity premultiplication stable", () => {
    const fill: LinearGradientFill = {
      type: "linearGradient",
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
      stops: opacityStops,
      interpolation: "linear-srgb",
      spread: "pad",
      dither: true,
    };
    const pixels = gradientPixels(fill, 32, 32, ["matrix", fill.type]);
    expect(createHash("sha256").update(pixels).digest("hex")).toBe(
      "7622c498760923623cada6a031c6b9149ba20ec2d4ca29c55a2a697633fef3e9",
    );
    expect(pixels[3]).toBeLessThan(pixels.at(-1)!);
  });

  it("keeps radial focal-point mapping stable", () => {
    const fill: RadialGradientFill = {
      type: "radialGradient",
      center: { x: 0.5, y: 0.5 },
      radius: { x: 0.5, y: 0.4 },
      focalPoint: { x: 0.35, y: 0.65 },
      stops: opacityStops,
      interpolation: "linear-srgb",
      spread: "pad",
      dither: true,
    };
    const pixels = gradientPixels(fill, 32, 32, ["matrix", fill.type]);
    expect(createHash("sha256").update(pixels).digest("hex")).toBe(
      "38f8fe18fa187c9cf73c08a6e6a60159bcf37b05b9ed2974b43591135bc15b05",
    );
    const focalOffset = (20 * 32 + 11) * 4;
    expect([...pixels.slice(focalOffset, focalOffset + 4)]).not.toEqual([
      ...pixels.slice(0, 4),
    ]);
  });
});
