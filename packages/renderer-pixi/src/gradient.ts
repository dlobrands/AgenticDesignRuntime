import { deterministicSeed, type ShapeFill } from "@agentic-design/core";

type Rgba = { r: number; g: number; b: number; a: number };

const hex = (value: string): [number, number, number] => [
  Number.parseInt(value.slice(1, 3), 16) / 255,
  Number.parseInt(value.slice(3, 5), 16) / 255,
  Number.parseInt(value.slice(5, 7), 16) / 255,
];

const toLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const toSrgb = (value: number): number =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

const noise = (x: number, y: number, seed: number): number => {
  let value =
    Math.imul(x + 1, 374_761_393) ^ Math.imul(y + 1, 668_265_263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295 - 0.5;
};

const normalizedPosition = (
  fill: Exclude<ShapeFill, { type: "solid" }>,
  x: number,
  y: number,
  width: number,
  height: number,
): number => {
  const px = (x + 0.5) / width;
  const py = (y + 0.5) / height;
  if (fill.type === "linearGradient") {
    const dx = fill.end.x - fill.start.x;
    const dy = fill.end.y - fill.start.y;
    const length = dx * dx + dy * dy;
    return length <= 1e-12
      ? 0
      : clamp(((px - fill.start.x) * dx + (py - fill.start.y) * dy) / length);
  }
  const rx = Math.max(fill.radius.x, 1e-6);
  const ry = Math.max(fill.radius.y, 1e-6);
  const focal = fill.focalPoint ?? fill.center;
  const fx = (px - focal.x) / rx;
  const fy = (py - focal.y) / ry;
  return clamp(Math.hypot(fx, fy));
};

const sample = (
  fill: Exclude<ShapeFill, { type: "solid" }>,
  t: number,
): Rgba => {
  const stops = fill.stops;
  let left = stops[0]!;
  let right = stops.at(-1)!;
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index]!;
    if (stop.offset <= t) left = stop;
    if (stop.offset >= t) {
      right = stop;
      break;
    }
  }
  const span = right.offset - left.offset;
  const amount =
    span <= 1e-12
      ? t >= right.offset
        ? 1
        : 0
      : clamp((t - left.offset) / span);
  const [lr, lg, lb] = hex(left.color).map(toLinear) as [
    number,
    number,
    number,
  ];
  const [rr, rg, rb] = hex(right.color).map(toLinear) as [
    number,
    number,
    number,
  ];
  const alpha = left.opacity + (right.opacity - left.opacity) * amount;
  const leftPremultiplier = left.opacity;
  const rightPremultiplier = right.opacity;
  const premultiplied = (l: number, r: number): number =>
    l * leftPremultiplier +
    (r * rightPremultiplier - l * leftPremultiplier) * amount;
  if (alpha <= 1e-8) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: toSrgb(premultiplied(lr, rr) / alpha),
    g: toSrgb(premultiplied(lg, rg) / alpha),
    b: toSrgb(premultiplied(lb, rb) / alpha),
    a: alpha,
  };
};

export const gradientCanvas = (
  fill: Exclude<ShapeFill, { type: "solid" }>,
  width: number,
  height: number,
  seedParts: string[],
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("2D canvas context is unavailable.");
  const image = context.createImageData(canvas.width, canvas.height);
  image.data.set(gradientPixels(fill, canvas.width, canvas.height, seedParts));
  context.putImageData(image, 0, 0);
  return canvas;
};

export const gradientPixels = (
  fill: Exclude<ShapeFill, { type: "solid" }>,
  width: number,
  height: number,
  seedParts: string[],
): Uint8ClampedArray => {
  const pixelWidth = Math.max(1, Math.ceil(width));
  const pixelHeight = Math.max(1, Math.ceil(height));
  const pixels = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);
  const seed = deterministicSeed(...seedParts);
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      const value = sample(
        fill,
        normalizedPosition(fill, x, y, pixelWidth, pixelHeight),
      );
      const dither = fill.dither ? noise(x, y, seed) : 0;
      const offset = (y * pixelWidth + x) * 4;
      pixels[offset] = Math.round(clamp(value.r + dither / 255) * 255);
      pixels[offset + 1] = Math.round(clamp(value.g + dither / 255) * 255);
      pixels[offset + 2] = Math.round(clamp(value.b + dither / 255) * 255);
      pixels[offset + 3] = Math.round(clamp(value.a) * 255);
    }
  }
  return pixels;
};

export const solidColorNumber = (color: string): number =>
  Number.parseInt(color.slice(1), 16);
