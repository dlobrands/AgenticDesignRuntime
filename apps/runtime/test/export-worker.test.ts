import { describe, expect, it } from "vitest";
import { createFrameDocument } from "@tva-agentic-design/core";
import {
  ChromiumExportWorker,
  exportRelativePath,
} from "../src/export-worker.js";
import type { WorkspaceState } from "../src/types.js";

const pathFrame = { slug: "campaign-card", revision: 7 };

describe("export artifact filenames", () => {
  it("preserves the V1 exact PNG path", () => {
    expect(exportRelativePath(pathFrame, { format: "png", scale: 1 })).toBe(
      "exports/campaign-card-r7.png",
    );
  });

  it("separates scaled and lossy encoding variants", () => {
    expect(
      exportRelativePath(pathFrame, {
        format: "webp",
        scale: 2,
        quality: 86,
      }),
    ).toBe("exports/campaign-card-r7-2x-q86.webp");
    expect(
      exportRelativePath(pathFrame, {
        format: "jpeg",
        scale: 1,
        quality: 92,
        matteColor: "#31A0FF",
      }),
    ).toBe("exports/campaign-card-r7-q92-m31a0ff.jpg");
  });

  it("blocks scaled dimensions beyond detected renderer capacity before rendering", () => {
    const worker = new ChromiumExportWorker({
      capabilities: {
        maxCanvasDimension: 4096,
        maxTextureSize: 4096,
        maxRenderbufferSize: 4096,
      },
    } as WorkspaceState);
    const frame = createFrameDocument({
      id: "00000000-0000-4000-8000-000000000001",
      slug: "limit",
      name: "Limit",
      width: 2048,
      height: 2048,
      now: "2026-08-10T12:00:00.000Z",
    });
    expect(() =>
      worker.assertExportSupported(frame, { format: "png", scale: 2 }),
    ).not.toThrow();
    expect(() =>
      worker.assertExportSupported(frame, { format: "png", scale: 3 }),
    ).toThrow(/exceeds the detected 4096px renderer limit/);
  });
});
