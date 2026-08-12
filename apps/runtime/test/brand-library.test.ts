import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTransform, semanticFrameHash } from "@tva-agentic-design/core";
import {
  buildBrandFrameOperations,
  brandKitRevisionDirectory,
  createBrandKitRevision,
  loadBrandKits,
  pinBrandKitToProject,
} from "../src/brand-library.js";
import { RuntimeEventBus } from "../src/events.js";
import { RuntimeLogger, RuntimeMetrics } from "../src/logger.js";
import { importAssetBuffer } from "../src/importer.js";
import { TransactionEngine } from "../src/transaction-engine.js";
import {
  closeWorkspace,
  openWorkspace,
  requireProject,
} from "../src/workspace.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const harness = async (root: string) => {
  const workspace = await openWorkspace(root, {
    descriptorDirectory: path.join(root, "descriptors"),
  });
  const logger = new RuntimeLogger({
    directory: path.join(root, ".design-runtime", "logs"),
    ...workspace.config.logging,
  });
  const metrics = new RuntimeMetrics(
    path.join(root, ".design-runtime", "metrics"),
    workspace.startedAt,
  );
  const engine = new TransactionEngine({
    workspace,
    logger,
    metrics,
    events: new RuntimeEventBus(workspace),
  });
  return { workspace, engine };
};

describe("workspace Brand Library", () => {
  it("versions, pins, previews, applies, detaches, and reopens deterministically", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "adr-brand-library-"));
    roots.push(root);
    const { workspace, engine } = await harness(root);
    const projectId = randomUUID();
    const frameId = randomUUID();
    const nodeId = randomUUID();
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "workspace" },
      baseRevision: null,
      actor: { source: "system", id: "test" },
      operations: [
        { kind: "createProject", projectId, slug: "brand", name: "Brand" },
      ],
    });
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "project", projectId },
      baseRevision: 0,
      actor: { source: "system", id: "test" },
      operations: [
        {
          kind: "createFrame",
          frameId,
          slug: "hero",
          name: "Hero",
          width: 1080,
          height: 1350,
        },
      ],
    });
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 0,
      actor: { source: "system", id: "test" },
      operations: [
        {
          kind: "createNode",
          parentId: "root",
          node: {
            id: nodeId,
            type: "rectangle",
            name: "Signal",
            visible: true,
            locked: false,
            transform: createTransform({ width: 300, height: 200 }),
            opacity: 1,
            blendMode: "normal",
            fill: { type: "solid", color: "#000000", opacity: 1 },
            cornerRadius: {
              topLeft: 0,
              topRight: 0,
              bottomRight: 0,
              bottomLeft: 0,
            },
          },
        },
      ],
    });
    const first = await createBrandKitRevision(workspace, {
      name: "Signal System",
      sourceProjectId: projectId,
      createdBy: "test",
      provenance: "Verified source project",
      licenseNotes: "Internal",
      palette: [{ key: "signal", name: "Signal", color: "#315BFF" }],
      typeRoles: [],
      logos: [],
      definitions: [],
    });
    const second = await createBrandKitRevision(workspace, {
      kitId: first.id,
      name: "Signal System",
      sourceProjectId: projectId,
      createdBy: "test",
      provenance: "Verified source project",
      licenseNotes: "Internal",
      palette: [{ key: "signal", name: "Signal", color: "#4F72FF" }],
      typeRoles: [],
      logos: [],
      definitions: [],
    });
    expect(second).toMatchObject({
      revision: 2,
      previousRevisionHash: first.contentHash,
    });
    expect(
      (await readdir(path.join(root, ".design-runtime", "brand-kits"))).some(
        (name) => name.startsWith("index.backup-"),
      ),
    ).toBe(true);

    const project = requireProject(workspace, projectId);
    const pinPreview = await pinBrandKitToProject({
      workspace,
      engine,
      project,
      kit: second,
      baseRevision: project.document.revision,
      mode: "preview",
      actor: { source: "http", id: "test" },
    });
    expect("previewId" in pinPreview).toBe(true);
    expect(project.document.brandKitPin).toBeUndefined();
    await pinBrandKitToProject({
      workspace,
      engine,
      project,
      kit: second,
      baseRevision: project.document.revision,
      mode: "commit",
      actor: { source: "http", id: "test" },
    });
    expect(project.document.brandKitPin).toMatchObject({ revision: 2 });
    const beforeApply = await semanticFrameHash(project.frames.get(frameId)!);
    const operations = buildBrandFrameOperations(project, frameId, second, {
      palette: [{ nodeId, token: "signal", property: "fill" }],
    });
    const preview = await engine.execute({
      schemaVersion: 1,
      mode: "preview",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 1,
      actor: { source: "http", id: "test" },
      operations,
    });
    expect("previewId" in preview).toBe(true);
    expect(await semanticFrameHash(project.frames.get(frameId)!)).toBe(
      beforeApply,
    );
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 1,
      actor: { source: "http", id: "test" },
      operations,
    });
    expect(project.frames.get(frameId)?.root.children[0]).toMatchObject({
      fill: { color: "#4F72FF" },
    });
    const expectedHash = await semanticFrameHash(project.frames.get(frameId)!);
    await closeWorkspace(workspace);

    const reopened = await openWorkspace(root, {
      descriptorDirectory: path.join(root, "reopened-descriptors"),
    });
    await loadBrandKits(reopened);
    expect(reopened.brandKits.get(first.id)).toHaveLength(2);
    expect(
      reopened.projects.get(projectId)?.document.brandKitPin,
    ).toMatchObject({
      kitId: first.id,
      revision: 2,
    });
    expect(
      await semanticFrameHash(
        reopened.projects.get(projectId)!.frames.get(frameId)!,
      ),
    ).toBe(expectedHash);
    await closeWorkspace(reopened);
  });

  it("copies only verified project bytes and rejects tampered immutable resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "adr-brand-bytes-"));
    roots.push(root);
    const { workspace, engine } = await harness(root);
    const projectId = randomUUID();
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "workspace" },
      baseRevision: null,
      actor: { source: "system", id: "test" },
      operations: [
        { kind: "createProject", projectId, slug: "bytes", name: "Bytes" },
      ],
    });
    const project = requireProject(workspace, projectId);
    const imported = await importAssetBuffer({
      workspace,
      project,
      declaredMime: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><path d="M0 0h120v40H0z" fill="#315BFF"/></svg>',
      ),
    });
    await engine.commitVerifiedImport({
      projectId,
      baseRevision: project.document.revision,
      actor: { source: "http", id: "test" },
      operation: { kind: "importAsset", asset: imported.asset },
    });
    const kit = await createBrandKitRevision(workspace, {
      name: "Verified Bytes",
      sourceProjectId: projectId,
      createdBy: "test",
      provenance: "Runtime import receipt",
      licenseNotes: "Internal",
      palette: [],
      typeRoles: [],
      logos: [
        {
          key: "logo",
          name: "Logo",
          assetId: imported.asset.id,
          provenance: "Runtime import receipt",
          licenseNotes: "Internal",
        },
      ],
      definitions: [],
    });
    const targetProjectId = randomUUID();
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "workspace" },
      baseRevision: null,
      actor: { source: "system", id: "test" },
      operations: [
        {
          kind: "createProject",
          projectId: targetProjectId,
          slug: "target",
          name: "Target",
        },
      ],
    });
    const targetProject = requireProject(workspace, targetProjectId);
    const preview = await pinBrandKitToProject({
      workspace,
      engine,
      project: targetProject,
      kit,
      baseRevision: targetProject.document.revision,
      mode: "preview",
      actor: { source: "http", id: "test" },
    });
    expect("previewId" in preview).toBe(true);
    const previewRequest = engine.getPreviewProposal(
      "previewId" in preview ? preview.previewId : "",
    ).request;
    const previewPin = previewRequest.operations.find(
      (operation) => operation.kind === "pinBrandKit",
    );
    expect(previewPin?.kind).toBe("pinBrandKit");
    await pinBrandKitToProject({
      workspace,
      engine,
      project: targetProject,
      kit,
      baseRevision: targetProject.document.revision,
      mode: "commit",
      actor: { source: "http", id: "test" },
    });
    const mappedId =
      targetProject.document.brandKitPin?.resourceMap[imported.asset.id];
    expect(mappedId).toBeTruthy();
    expect(mappedId).not.toBe(imported.asset.id);
    if (previewPin?.kind === "pinBrandKit")
      expect(previewPin.pin.resourceMap[imported.asset.id]).toBe(mappedId);
    expect(
      targetProject.assets.assets.find((asset) => asset.id === mappedId)?.path,
    ).toMatch(/^assets\/brand-/);
    expect(project.assets.assets).toHaveLength(1);
    const resource = path.join(
      brandKitRevisionDirectory(workspace, kit.id, kit.revision),
      kit.logos[0]!.asset.path,
    );
    await writeFile(resource, "tampered");
    workspace.brandKits.clear();
    await expect(loadBrandKits(workspace)).rejects.toMatchObject({
      code: "ASSET_HASH_MISMATCH",
    });
  });
});
