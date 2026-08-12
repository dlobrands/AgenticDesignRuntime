import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  RuntimeError,
  type Asset,
  type FontRecord,
} from "@tva-agentic-design/core";
import { fileTypeFromBuffer } from "file-type";
import type { Font } from "fontkit";
import { SaxesParser } from "saxes";
import sharp from "sharp";
import { writeFileAtomic } from "./fs-safe.js";
import { editableSvgVector, type EditableSvgVector } from "./editable-svg.js";
import type { ProjectState, WorkspaceState } from "./types.js";

const digest = (data: Uint8Array): string =>
  `sha256:${createHash("sha256").update(data).digest("hex")}`;
const allowedRasterMime = new Set(["image/png", "image/jpeg", "image/webp"]);
const allowedFontMime = new Set([
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/x-font-ttf",
  "application/x-font-opentype",
]);

const svgDimension = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)(?:px)?\s*$/i.exec(value);
  return match ? Number(match[1]) : undefined;
};

const validateSvg = (
  buffer: Buffer,
): {
  width: number;
  height: number;
  embeddedRasters: Buffer[];
  editableVector?: EditableSvgVector;
} => {
  const source = buffer.toString("utf8");
  if (source.length === 0 || source.length > 10 * 1024 * 1024) {
    throw new RuntimeError(
      "UNSAFE_SVG",
      "SVG source is empty or exceeds the 10 MB vector-source limit.",
    );
  }
  const forbiddenElements = new Set([
    "script",
    "foreignobject",
    "animate",
    "animatetransform",
    "animatemotion",
    "set",
    "iframe",
    "object",
    "embed",
  ]);
  let root: Record<string, string> | undefined;
  let failure: RuntimeError | undefined;
  const embeddedRasters: Buffer[] = [];
  const paths: Array<Record<string, string>> = [];
  let editableStructure = true;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    const name = tag.name.toLowerCase();
    if (forbiddenElements.has(name))
      failure = new RuntimeError(
        "UNSAFE_SVG",
        `SVG element <${tag.name}> is not allowed.`,
      );
    if (name === "text" || name === "tspan" || name === "textpath") {
      failure = new RuntimeError(
        "SVG_TEXT_UNSUPPORTED",
        "Live SVG text must be converted to paths before import.",
      );
    }
    const attributes = tag.attributes as Record<string, string>;
    if (name === "svg" && !root) root = attributes;
    else if (name === "path") paths.push(attributes);
    else editableStructure = false;
    for (const [attributeName, rawValue] of Object.entries(attributes)) {
      const normalized = attributeName.toLowerCase();
      const value = rawValue.trim();
      if (normalized.startsWith("on"))
        failure = new RuntimeError(
          "UNSAFE_SVG",
          `SVG event handler ${attributeName} is not allowed.`,
        );
      if (["href", "xlink:href", "src"].includes(normalized)) {
        const localReference = value.startsWith("#");
        const embedded =
          /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
            value,
          );
        const embeddedRaster = Boolean(embedded);
        if (embedded?.[1])
          embeddedRasters.push(Buffer.from(embedded[1], "base64"));
        if (!localReference && !embeddedRaster)
          failure = new RuntimeError(
            "UNSAFE_SVG",
            "External SVG references are not allowed.",
          );
      }
      if (
        /url\(\s*['"]?(?:https?:|file:|\/|\.\.)/i.test(value) ||
        /@import/i.test(value)
      ) {
        failure = new RuntimeError(
          "UNSAFE_SVG",
          "External URLs and stylesheet imports are not allowed in SVG files.",
        );
      }
    }
  });
  parser.on("doctype", () => {
    failure = new RuntimeError("UNSAFE_SVG", "SVG doctypes are not allowed.");
  });
  parser.on("processinginstruction", () => {
    failure = new RuntimeError(
      "UNSAFE_SVG",
      "SVG processing instructions are not allowed.",
    );
  });
  parser.on("error", (error) => {
    failure = new RuntimeError("UNSAFE_SVG", `Malformed SVG: ${error.message}`);
  });
  try {
    parser.write(source).close();
  } catch (error) {
    throw (
      failure ??
      new RuntimeError(
        "UNSAFE_SVG",
        `Malformed SVG: ${error instanceof Error ? error.message : String(error)}`,
      )
    );
  }
  if (failure) throw failure;
  if (!root)
    throw new RuntimeError(
      "UNSAFE_SVG",
      "The file does not contain an SVG root element.",
    );
  let width = svgDimension(root.width);
  let height = svgDimension(root.height);
  const viewBox = root.viewBox ?? root.viewbox;
  let parsedViewBox:
    { x: number; y: number; width: number; height: number } | undefined;
  if ((!width || !height) && viewBox) {
    const values = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      values.length === 4 &&
      values.every(Number.isFinite) &&
      values[2]! > 0 &&
      values[3]! > 0
    ) {
      parsedViewBox = {
        x: values[0]!,
        y: values[1]!,
        width: values[2]!,
        height: values[3]!,
      };
      width ??= values[2];
      height ??= values[3];
    }
  }
  if (!parsedViewBox && viewBox) {
    const values = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      values.length === 4 &&
      values.every(Number.isFinite) &&
      values[2]! > 0 &&
      values[3]! > 0
    )
      parsedViewBox = {
        x: values[0]!,
        y: values[1]!,
        width: values[2]!,
        height: values[3]!,
      };
  }
  if (!width || !height || width <= 0 || height <= 0) {
    throw new RuntimeError(
      "UNSAFE_SVG",
      "SVG files require positive width and height values or a valid viewBox.",
    );
  }
  const editableVector =
    editableStructure && paths.length === 1 && paths[0]?.d
      ? editableSvgVector({
          pathData: paths[0].d,
          pathAttributes: paths[0],
          rootAttributes: root,
          viewBox: parsedViewBox ?? { x: 0, y: 0, width, height },
        })
      : undefined;
  return {
    width,
    height,
    embeddedRasters,
    ...(editableVector ? { editableVector } : {}),
  };
};

const validateRasterLimits = (
  workspace: WorkspaceState,
  sizeBytes: number,
  width: number,
  height: number,
): void => {
  const limits = workspace.capabilities.effectiveRasterLimits;
  const pixels = width * height;
  const memoryMb = (pixels * 4) / 1024 / 1024;
  if (
    sizeBytes > limits.maxFileSizeMb * 1024 * 1024 ||
    width > limits.maxDimension ||
    height > limits.maxDimension ||
    pixels > limits.maxDecodedMegapixels * 1_000_000 ||
    memoryMb > limits.maxDecodedMemoryMb
  ) {
    throw new RuntimeError(
      "RASTER_LIMIT_EXCEEDED",
      "The raster exceeds the effective import limits.",
      {
        sizeBytes,
        width,
        height,
        decodedMegapixels: pixels / 1_000_000,
        estimatedDecodedMemoryMb: memoryMb,
        effectiveLimits: limits,
      },
    );
  }
};

const extensionForMime = (mime: string): string =>
  ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  })[mime] ?? "bin";

export const importAssetBuffer = async (input: {
  workspace: WorkspaceState;
  project: ProjectState;
  buffer: Buffer;
  declaredMime?: string;
}): Promise<{
  asset: Asset;
  createdPaths: string[];
  duplicate: boolean;
  editableVector?: EditableSvgVector;
}> => {
  const hash = digest(input.buffer);
  const detected = await fileTypeFromBuffer(input.buffer);
  const isSvg =
    input.declaredMime === "image/svg+xml" ||
    detected?.mime === "image/svg+xml" ||
    input.buffer.subarray(0, 1024).toString("utf8").includes("<svg");
  const svgValidation = isSvg ? validateSvg(input.buffer) : undefined;
  const duplicate = input.project.assets.assets.find(
    (asset) => asset.hash === hash,
  );
  if (duplicate)
    return {
      asset: duplicate,
      createdPaths: [],
      duplicate: true,
      ...(svgValidation?.editableVector
        ? { editableVector: svgValidation.editableVector }
        : {}),
    };
  const id = randomUUID();
  const createdPaths: string[] = [];
  try {
    if (isSvg) {
      const { embeddedRasters, editableVector, ...dimensions } = svgValidation!;
      for (const embedded of embeddedRasters) {
        const detectedEmbedded = await fileTypeFromBuffer(embedded);
        if (!detectedEmbedded || !allowedRasterMime.has(detectedEmbedded.mime))
          throw new RuntimeError(
            "UNSAFE_SVG",
            "An embedded SVG raster has an invalid signature.",
          );
        const metadata = await sharp(embedded, {
          limitInputPixels: false,
          sequentialRead: true,
        }).metadata();
        if (!metadata.width || !metadata.height)
          throw new RuntimeError(
            "UNSAFE_SVG",
            "An embedded SVG raster has unreadable dimensions.",
          );
        validateRasterLimits(
          input.workspace,
          embedded.byteLength,
          metadata.width,
          metadata.height,
        );
        await sharp(embedded, {
          limitInputPixels:
            input.workspace.capabilities.effectiveRasterLimits
              .maxDecodedMegapixels * 1_000_000,
        }).toBuffer();
      }
      const relativePath = `assets/${id}.svg`;
      const target = path.join(input.project.directory, relativePath);
      await writeFileAtomic(target, input.buffer);
      createdPaths.push(target);
      const thumbnailPath = `assets/${id}.thumbnail.png`;
      const thumbnailTarget = path.join(input.project.directory, thumbnailPath);
      const thumbnail = await sharp(input.buffer, { density: 144 })
        .resize({
          width: 512,
          height: 512,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      await writeFileAtomic(thumbnailTarget, thumbnail);
      createdPaths.push(thumbnailTarget);
      return {
        asset: {
          id,
          type: "svg",
          path: relativePath,
          mimeType: "image/svg+xml",
          hash,
          sizeBytes: input.buffer.byteLength,
          ...dimensions,
          thumbnailPath,
        },
        createdPaths,
        duplicate: false,
        ...(editableVector ? { editableVector } : {}),
      };
    }
    if (!detected || !allowedRasterMime.has(detected.mime))
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Only PNG, JPEG, WebP, and SVG assets are supported.",
      );
    const metadata = await sharp(input.buffer, {
      limitInputPixels: false,
      sequentialRead: true,
    }).metadata();
    if (!metadata.width || !metadata.height)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "The raster dimensions could not be read.",
      );
    validateRasterLimits(
      input.workspace,
      input.buffer.byteLength,
      metadata.width,
      metadata.height,
    );
    await sharp(input.buffer, {
      limitInputPixels:
        input.workspace.capabilities.effectiveRasterLimits
          .maxDecodedMegapixels * 1_000_000,
    })
      .rotate()
      .toBuffer();
    const relativePath = `assets/${id}.${extensionForMime(detected.mime)}`;
    const target = path.join(input.project.directory, relativePath);
    await writeFileAtomic(target, input.buffer);
    createdPaths.push(target);
    return {
      asset: {
        id,
        type: "raster",
        path: relativePath,
        mimeType: detected.mime as "image/png" | "image/jpeg" | "image/webp",
        hash,
        sizeBytes: input.buffer.byteLength,
        width: metadata.width,
        height: metadata.height,
      },
      createdPaths,
      duplicate: false,
    };
  } catch (error) {
    await Promise.all(createdPaths.map((file) => rm(file, { force: true })));
    throw error;
  }
};

const fontFormat = (
  mime: string | undefined,
  filename: string,
): FontRecord["format"] | undefined => {
  const extension = path.extname(filename).slice(1).toLowerCase();
  if (["woff2", "woff", "ttf", "otf"].includes(extension))
    return extension as FontRecord["format"];
  if (mime === "font/woff2") return "woff2";
  if (mime === "font/woff" || mime === "application/font-woff") return "woff";
  if (mime === "font/ttf" || mime === "application/x-font-ttf") return "ttf";
  if (mime === "font/otf" || mime === "application/x-font-opentype")
    return "otf";
  return undefined;
};

export const importFontBuffer = async (input: {
  project: ProjectState;
  buffer: Buffer;
  filename: string;
  declaredMime?: string;
  licenseNotes?: string;
}): Promise<{
  font: FontRecord;
  createdPaths: string[];
  duplicate: boolean;
}> => {
  if (input.buffer.byteLength > 32 * 1024 * 1024)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Font files may not exceed 32 MB.",
    );
  const hash = digest(input.buffer);
  const duplicate = input.project.fonts.fonts.find(
    (font) => font.hash === hash,
  );
  if (duplicate) return { font: duplicate, createdPaths: [], duplicate: true };
  const detected = await fileTypeFromBuffer(input.buffer);
  const format = fontFormat(
    detected?.mime ?? input.declaredMime,
    input.filename,
  );
  if (
    !format ||
    (detected &&
      !allowedFontMime.has(detected.mime) &&
      !["ttf", "otf"].includes(format))
  ) {
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Only WOFF2, WOFF, TTF, and OTF font files are supported.",
    );
  }
  let metadata: Font;
  try {
    const { create } = await import("fontkit");
    metadata = create(input.buffer);
  } catch (error) {
    throw new RuntimeError(
      "INVALID_OPERATION",
      `The font could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const id = randomUUID();
  const relativePath = `fonts/${id}.${format}`;
  const target = path.join(input.project.directory, relativePath);
  await writeFileAtomic(target, input.buffer);
  const family =
    metadata.familyName?.trim() ||
    metadata.postscriptName?.trim() ||
    path.basename(input.filename, path.extname(input.filename));
  const styleText =
    `${metadata.subfamilyName ?? ""} ${metadata.postscriptName ?? ""}`.toLowerCase();
  const openTypeWeight = (
    metadata as Font & { "OS/2"?: { usWeightClass?: number } }
  )["OS/2"]?.usWeightClass;
  return {
    font: {
      id,
      family,
      style:
        (metadata.italicAngle && metadata.italicAngle !== 0) ||
        styleText.includes("italic")
          ? "italic"
          : "normal",
      weight: Math.min(
        1000,
        Math.max(1, openTypeWeight ?? (styleText.includes("bold") ? 700 : 400)),
      ),
      format,
      source: "project",
      path: relativePath,
      hash,
      licenseNotes:
        input.licenseNotes?.trim() ||
        "User-provided font; redistribution rights must be verified by the project owner.",
    },
    createdPaths: [target],
    duplicate: false,
  };
};
