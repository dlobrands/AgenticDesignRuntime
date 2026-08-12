import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { DEFAULT_CONFIG, createProjectDocument } from "@agentic-design/core";
import { deriveExternalOperations } from "../src/external-diff.js";
import { importAssetBuffer, importFontBuffer } from "../src/importer.js";
import type { ProjectState, WorkspaceState } from "../src/types.js";
import {
  createFrameDocument,
  createTransform,
  semanticFrameHash,
  simulateFrameOperations,
  type RectangleNode,
  type TextNode,
} from "@agentic-design/core";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const state = async (): Promise<{
  workspace: WorkspaceState;
  project: ProjectState;
}> => {
  const root = await mkdtemp(path.join(tmpdir(), "agentic-import-test-"));
  roots.push(root);
  const projectDirectory = path.join(root, "projects", "test");
  await Promise.all(
    ["assets", "fonts", "frames", "history"].map((name) =>
      mkdir(path.join(projectDirectory, name), { recursive: true }),
    ),
  );
  const workspaceId = randomUUID();
  const config = DEFAULT_CONFIG(workspaceId);
  const workspace: WorkspaceState = {
    root,
    runtimeId: randomUUID(),
    capabilityToken: "test-token",
    config,
    capabilities: {
      maxTextureSize: 16_384,
      maxRenderbufferSize: 16_384,
      maxCanvasDimension: 16_384,
      effectiveRasterLimits: config.rasterLimits,
    },
    projects: new Map(),
    brandKits: new Map(),
    descriptorPath: path.join(root, "descriptor.json"),
    lockPath: path.join(root, "lock"),
    startedAt: new Date().toISOString(),
  };
  const project: ProjectState = {
    directory: projectDirectory,
    document: createProjectDocument({
      id: randomUUID(),
      slug: "test",
      name: "Test",
      now: new Date().toISOString(),
    }),
    frames: new Map(),
    assets: { schemaVersion: 1, assets: [] },
    fonts: { schemaVersion: 1, fonts: [] },
    history: [],
    blockedFrames: new Map(),
    externalConflicts: new Map(),
  };
  workspace.projects.set(project.document.id, project);
  return { workspace, project };
};

describe("asset import boundaries", () => {
  it("accepts PNG bytes and reuses an existing hash without another write", async () => {
    const { workspace, project } = await state();
    const png = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 4,
        background: { r: 220, g: 38, b: 38, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const imported = await importAssetBuffer({
      workspace,
      project,
      buffer: png,
      declaredMime: "image/png",
    });
    expect(imported.asset).toMatchObject({
      type: "raster",
      mimeType: "image/png",
      width: 120,
      height: 80,
    });
    expect(imported.createdPaths).toHaveLength(1);

    project.assets.assets.push(imported.asset);
    const duplicate = await importAssetBuffer({
      workspace,
      project,
      buffer: png,
      declaredMime: "image/png",
    });
    expect(duplicate).toMatchObject({
      asset: { id: imported.asset.id },
      duplicate: true,
      createdPaths: [],
    });
  });

  it("accepts a self-contained SVG and rejects active or external content", async () => {
    const { workspace, project } = await state();
    const safe = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#315cf5"/></svg>',
    );
    const imported = await importAssetBuffer({
      workspace,
      project,
      buffer: safe,
      declaredMime: "image/svg+xml",
    });
    expect(imported.asset).toMatchObject({
      type: "svg",
      width: 100,
      height: 60,
    });
    expect(imported.createdPaths).toHaveLength(2);

    for (const source of [
      '<svg width="10" height="10"><script>alert(1)</script></svg>',
      '<svg width="10" height="10"><image href="file:///etc/passwd"/></svg>',
      '<svg width="10" height="10"><rect onclick="alert(1)"/></svg>',
      '<svg width="10" height="10"><text>live</text></svg>',
      '<!DOCTYPE svg><svg width="10" height="10"/>',
    ]) {
      await expect(
        importAssetBuffer({
          workspace,
          project,
          buffer: Buffer.from(source),
          declaredMime: "image/svg+xml",
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/UNSAFE_SVG|SVG_TEXT_UNSUPPORTED/),
      });
    }
  });

  it("offers compatible single paths as editable canonical vectors", async () => {
    const { workspace, project } = await state();
    const compatible = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50" width="200" height="100"><path d="M 10 70 C 35 20 85 20 110 70 L 60 45 Z" fill="#315cf5" fill-opacity=".8" stroke="#ffffff" stroke-width="2" stroke-dasharray="4 2" stroke-linecap="round"/></svg>',
    );
    const imported = await importAssetBuffer({
      workspace,
      project,
      buffer: compatible,
      declaredMime: "image/svg+xml",
    });
    expect(imported.editableVector).toMatchObject({
      commands: [
        { id: "path-1", kind: "move", to: { x: 0, y: 1 } },
        {
          id: "path-2",
          kind: "cubic",
          control1: { x: 0.25, y: 0 },
          control2: { x: 0.75, y: 0 },
          to: { x: 1, y: 1 },
        },
        { id: "path-3", kind: "line", to: { x: 0.5, y: 0.5 } },
        { id: "path-4", kind: "close" },
      ],
      fill: { type: "solid", color: "#315CF5", opacity: 0.8 },
      stroke: {
        width: 2,
        alignment: "center",
        dash: { values: [4, 2], offset: 0, cap: "round" },
      },
    });
    project.assets.assets.push(imported.asset);
    const duplicate = await importAssetBuffer({
      workspace,
      project,
      buffer: compatible,
      declaredMime: "image/svg+xml",
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.editableVector?.commands).toHaveLength(4);
  });

  it("keeps unsupported safe SVGs as normal assets instead of lossy conversion", async () => {
    const { workspace, project } = await state();
    for (const source of [
      '<svg width="100" height="100"><path d="M0 0 Q 50 100 100 0" fill="#000000"/></svg>',
      '<svg width="100" height="100"><g transform="translate(1 1)"><path d="M0 0 L100 0 L100 100 Z"/></g></svg>',
      '<svg width="100" height="100"><path d="M0 0 L100 0 L100 100 Z" fill="red"/></svg>',
    ]) {
      const imported = await importAssetBuffer({
        workspace,
        project,
        buffer: Buffer.from(source),
        declaredMime: "image/svg+xml",
      });
      expect(imported.asset.type).toBe("svg");
      expect(imported.editableVector).toBeUndefined();
    }
  });

  it("leaves no asset files behind when validation fails", async () => {
    const { workspace, project } = await state();
    await expect(
      importAssetBuffer({
        workspace,
        project,
        buffer: Buffer.from(
          '<svg width="10" height="10"><image href="https://example.com/tracker.png"/></svg>',
        ),
        declaredMime: "image/svg+xml",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_SVG" });
    expect(await readdir(path.join(project.directory, "assets"))).toEqual([]);
  });
});

describe("font import metadata", () => {
  it("preserves the OpenType weight class", async () => {
    const { project } = await state();
    const buffer = await readFile(
      path.join(
        process.cwd(),
        "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
      ),
    );
    const imported = await importFontBuffer({
      project,
      buffer,
      filename: "ibm-plex-sans-latin-600-normal.woff2",
      declaredMime: "font/woff2",
      licenseNotes: "SIL Open Font License test fixture.",
    });
    expect(imported.font).toMatchObject({
      family: "IBM Plex Sans SemiBold",
      style: "normal",
      weight: 600,
      format: "woff2",
    });
  });
});

describe("external semantic conversion", () => {
  it("converts representable properties through the normal operation engine", async () => {
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "frame",
      name: "Frame",
      width: 1080,
      height: 1350,
      now: "2026-08-05T12:00:00.000Z",
    });
    const node: RectangleNode = {
      id: randomUUID(),
      type: "rectangle",
      name: "Panel",
      visible: true,
      locked: false,
      transform: createTransform({ x: 20, y: 30, width: 240, height: 120 }),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#FFFFFF", opacity: 1 },
      cornerRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    };
    frame.root.children.push(node);
    const proposed = structuredClone(frame);
    proposed.canvas.guides = [
      { id: randomUUID(), axis: "vertical", position: 320 },
    ];
    proposed.canvas.safeArea = { top: 80, right: 64, bottom: 80, left: 64 };
    const changed = proposed.root.children[0] as RectangleNode;
    changed.name = "Panel updated";
    changed.resizeConstraints = { horizontal: "right", vertical: "middle" };
    changed.transform.x = 440;
    changed.fill = { type: "solid", color: "#315CF5", opacity: 0.8 };
    const operations = deriveExternalOperations(frame, proposed);
    expect(operations.map((operation) => operation.kind)).toEqual([
      "setCanvas",
      "updateNode",
      "updateNode",
      "updateNode",
      "updateNode",
    ]);
    const simulated = simulateFrameOperations(frame, operations);
    expect(await semanticFrameHash(simulated.frame)).toBe(
      await semanticFrameHash(proposed),
    );
  });

  it("rejects identity and type changes that have no semantic operation", () => {
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "frame",
      name: "Frame",
      width: 100,
      height: 100,
      now: "2026-08-05T12:00:00.000Z",
    });
    const renamed = structuredClone(frame);
    renamed.slug = "not-project-managed";
    expect(() => deriveExternalOperations(frame, renamed)).toThrowError(
      /project-managed/,
    );
  });

  it("converts rich-text span edits as one canonical text operation", async () => {
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "rich-frame",
      name: "Rich frame",
      width: 800,
      height: 600,
      now: "2026-08-10T12:00:00.000Z",
    });
    const node: TextNode = {
      id: randomUUID(),
      type: "text",
      name: "Headline",
      visible: true,
      locked: false,
      transform: createTransform({ width: 500, height: 100 }),
      opacity: 1,
      blendMode: "normal",
      text: "Agent and human",
      typography: {
        fontId: randomUUID(),
        fontSize: 42,
        fontWeight: 500,
        fontStyle: "normal",
        lineHeight: 50,
        letterSpacing: 0,
        alignment: "left",
        verticalAlignment: "top",
        color: "#111111",
        opacity: 1,
      },
      textBox: {
        mode: "fixed",
        width: 500,
        height: 100,
        wrapping: "word",
        overflow: "clip",
      },
    };
    frame.root.children.push(node);
    const proposed = structuredClone(frame);
    (proposed.root.children[0] as TextNode).spans = [
      {
        id: "agent-emphasis",
        start: 0,
        end: 5,
        style: { fontWeight: 800, color: "#315CF5" },
      },
      { id: "remaining-copy", start: 5, end: 15, style: {} },
    ];
    const operations = deriveExternalOperations(frame, proposed);
    expect(operations).toEqual([
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "textContent",
        value: {
          text: node.text,
          spans: (proposed.root.children[0] as TextNode).spans,
        },
      },
    ]);
    expect(
      await semanticFrameHash(simulateFrameOperations(frame, operations).frame),
    ).toBe(await semanticFrameHash(proposed));
  });

  it("converts template detach metadata without altering rendered properties", async () => {
    const frame = createFrameDocument({
      id: randomUUID(),
      slug: "template-frame",
      name: "Template frame",
      width: 800,
      height: 600,
      now: "2026-08-10T12:00:00.000Z",
    });
    const node: RectangleNode = {
      id: randomUUID(),
      type: "rectangle",
      name: "CTA",
      visible: true,
      locked: false,
      transform: createTransform({ width: 240, height: 80 }),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      cornerRadius: {
        topLeft: 12,
        topRight: 12,
        bottomRight: 12,
        bottomLeft: 12,
      },
      templateInstance: {
        templateId: randomUUID(),
        instanceId: randomUUID(),
        sourceNodeId: randomUUID(),
      },
      templateSlot: {
        slotId: randomUUID(),
        key: "cta",
        name: "CTA",
        role: "cta",
      },
    };
    frame.root.children.push(node);
    const proposed = structuredClone(frame);
    delete proposed.root.children[0]!.templateInstance;
    delete proposed.root.children[0]!.templateSlot;
    const operations = deriveExternalOperations(frame, proposed);
    expect(operations).toEqual([
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "templateMetadata",
        value: { templateInstance: null, templateSlot: null },
      },
    ]);
    expect(
      await semanticFrameHash(simulateFrameOperations(frame, operations).frame),
    ).toBe(await semanticFrameHash(proposed));
  });
});
