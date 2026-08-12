import { randomUUID } from "node:crypto";
import {
  readFile,
  symlink,
  writeFile,
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RuntimeError,
  createTransform,
  semanticFrameHash,
  stableStringify,
  type RectangleNode,
  type TransactionPreviewResult,
} from "@agentic-design/core";
import { RuntimeEventBus } from "../src/events.js";
import { exportDiagnostics } from "../src/diagnostics.js";
import { resolveInside, writeJsonAtomic } from "../src/fs-safe.js";
import {
  recoverJournals,
  persistJournaled,
  type JournalPhase,
  type TransactionJournal,
} from "../src/journal.js";
import { RuntimeLogger, RuntimeMetrics } from "../src/logger.js";
import { importAssetBuffer } from "../src/importer.js";
import { listActiveDescriptors, stopRuntime } from "../src/lifecycle.js";
import {
  TransactionEngine,
  transactionMutationDomain,
} from "../src/transaction-engine.js";
import { WorkspaceWatcher } from "../src/watcher.js";
import {
  closeWorkspace,
  applyRendererCapabilities,
  openWorkspace,
  requireFrame,
  requireProject,
} from "../src/workspace.js";

const roots: string[] = [];

const temporaryDirectory = async (name: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), `${name}-`));
  roots.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const createHarness = async () => {
  const root = await temporaryDirectory("agentic-runtime-test");
  const descriptorDirectory = path.join(root, "descriptors");
  const workspace = await openWorkspace(root, { descriptorDirectory });
  const logger = new RuntimeLogger({
    directory: path.join(root, ".design-runtime", "logs"),
    ...workspace.config.logging,
  });
  const metrics = new RuntimeMetrics(
    path.join(root, ".design-runtime", "metrics"),
    workspace.startedAt,
  );
  const events = new RuntimeEventBus(workspace);
  const engine = new TransactionEngine({ workspace, logger, metrics, events });
  return { root, descriptorDirectory, workspace, engine };
};

const projectId = "11111111-1111-4111-8111-111111111111";
const frameId = "22222222-2222-4222-8222-222222222222";
const nodeId = "33333333-3333-4333-8333-333333333333";

const rectangle = (): RectangleNode => ({
  id: nodeId,
  type: "rectangle",
  name: "Signal",
  visible: true,
  locked: false,
  transform: createTransform({ x: 64, y: 80, width: 320, height: 180 }),
  opacity: 1,
  blendMode: "normal",
  fill: { type: "solid", color: "#315CF5", opacity: 1 },
  cornerRadius: { topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 },
});

const bootstrapProject = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
) => {
  const { workspace, engine } = harness;
  await engine.execute({
    schemaVersion: 1,
    mode: "commit",
    runtimeId: workspace.runtimeId,
    workspaceId: workspace.config.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "http", id: "test" },
    operations: [
      {
        kind: "createProject",
        projectId,
        slug: "release-test",
        name: "Release Test",
      },
    ],
  });
  await engine.execute({
    schemaVersion: 1,
    mode: "commit",
    runtimeId: workspace.runtimeId,
    workspaceId: workspace.config.workspaceId,
    scope: { kind: "project", projectId },
    baseRevision: 0,
    actor: { source: "http", id: "test" },
    operations: [
      {
        kind: "createFrame",
        frameId,
        slug: "portrait",
        name: "Portrait",
        width: 1080,
        height: 1350,
      },
    ],
  });
};

describe("transaction pipeline", () => {
  it("uses one mutation domain for a project and every child frame", () => {
    const otherProjectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(transactionMutationDomain({ kind: "project", projectId })).toBe(
      transactionMutationDomain({ kind: "frame", projectId, frameId }),
    );
    expect(
      transactionMutationDomain({
        kind: "frame",
        projectId,
        frameId: randomUUID(),
      }),
    ).toBe(`project:${projectId}`);
    expect(
      transactionMutationDomain({
        kind: "frame",
        projectId: otherProjectId,
        frameId,
      }),
    ).not.toBe(`project:${projectId}`);
  });

  it("serializes simultaneous project and child-frame commits without losing either", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { engine, workspace } = harness;
    const newFrameId = "44444444-4444-4444-8444-444444444444";
    const project = requireProject(workspace, projectId);
    await Promise.all([
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "project", projectId },
        baseRevision: project.document.revision,
        actor: { source: "http", id: "project-race" },
        operations: [
          {
            kind: "createFrame",
            frameId: newFrameId,
            slug: "square",
            name: "Square",
            width: 1080,
            height: 1080,
          },
        ],
      }),
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "frame", projectId, frameId },
        baseRevision: 0,
        actor: { source: "mcp", id: "frame-race" },
        operations: [
          { kind: "createNode", parentId: "root", node: rectangle() },
        ],
      }),
    ]);
    expect(requireFrame(project, frameId).root.children).toHaveLength(1);
    expect(requireFrame(project, newFrameId).revision).toBe(0);
    expect(project.document.frameOrder).toEqual([frameId, newFrameId]);
    await closeWorkspace(workspace);
  });

  it("serializes simultaneous commits to different frames and rejects same-frame stale work", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { engine, workspace } = harness;
    const secondFrameId = "55555555-5555-4555-8555-555555555555";
    const project = requireProject(workspace, projectId);
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "project", projectId },
      baseRevision: project.document.revision,
      actor: { source: "http", id: "setup" },
      operations: [
        {
          kind: "createFrame",
          frameId: secondFrameId,
          slug: "landscape",
          name: "Landscape",
          width: 1350,
          height: 1080,
        },
      ],
    });
    const secondNode = rectangle();
    secondNode.id = "66666666-6666-4666-8666-666666666666";
    await Promise.all([
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "frame", projectId, frameId },
        baseRevision: 0,
        actor: { source: "studio", id: "first-frame" },
        operations: [
          { kind: "createNode", parentId: "root", node: rectangle() },
        ],
      }),
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "frame", projectId, frameId: secondFrameId },
        baseRevision: 0,
        actor: { source: "studio", id: "second-frame" },
        operations: [
          { kind: "createNode", parentId: "root", node: secondNode },
        ],
      }),
    ]);
    expect(requireFrame(project, frameId).revision).toBe(1);
    expect(requireFrame(project, secondFrameId).revision).toBe(1);

    const staleNode = rectangle();
    staleNode.id = "77777777-7777-4777-8777-777777777777";
    const winnerNode = rectangle();
    winnerNode.id = "99999999-9999-4999-8999-999999999999";
    const sameFrame = await Promise.allSettled([
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "frame", projectId, frameId },
        baseRevision: 1,
        actor: { source: "studio", id: "winner" },
        operations: [
          { kind: "createNode", parentId: "root", node: winnerNode },
        ],
      }),
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "frame", projectId, frameId },
        baseRevision: 1,
        actor: { source: "mcp", id: "stale" },
        operations: [{ kind: "createNode", parentId: "root", node: staleNode }],
      }),
    ]);
    expect(
      sameFrame.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = sameFrame.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: { code: "SEMANTIC_CONFLICT" },
    });
    await closeWorkspace(workspace);
  });

  it("rebases disjoint stale edits only as reviewed previews", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { engine, workspace } = harness;
    const node = rectangle();
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 0,
      actor: { source: "studio", id: "creator" },
      operations: [{ kind: "createNode", parentId: "root", node }],
    });
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 1,
      actor: { source: "mcp", id: "intervening-agent" },
      operations: [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "fill",
          value: {
            fill: { type: "solid", color: "#FF3366", opacity: 1 },
          },
        },
      ],
    });

    const rebased = await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 1,
      actor: { source: "studio", id: "stale-human" },
      operations: [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "transform",
          value: { x: 240 },
        },
      ],
      renderPreview: true,
    });
    expect(rebased).not.toHaveProperty("status");
    expect(rebased).toMatchObject({
      baseRevision: 2,
      rebase: { fromRevision: 1, toRevision: 2 },
    });
    expect(
      requireFrame(requireProject(workspace, projectId), frameId).revision,
    ).toBe(2);

    const committed = await engine.commitPreview(
      (rebased as TransactionPreviewResult).previewId,
    );
    expect(committed.revision).toBe(3);
    const canonical = requireFrame(
      requireProject(workspace, projectId),
      frameId,
    );
    const preserved = canonical.root.children[0] as RectangleNode;
    expect(preserved.id).toBe(node.id);
    expect(preserved.transform.x).toBe(240);
    expect(preserved.fill).toMatchObject({ color: "#FF3366" });
    await closeWorkspace(workspace);
  });

  it("returns structured semantic conflicts for overlapping stale edits", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { engine, workspace } = harness;
    const node = rectangle();
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 0,
      actor: { source: "studio", id: "creator" },
      operations: [{ kind: "createNode", parentId: "root", node }],
    });
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 1,
      actor: { source: "mcp", id: "intervening-agent" },
      operations: [
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "transform",
          value: { x: 80 },
        },
      ],
    });
    const property = `node:${node.id}.transform.x`;
    await expect(
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "frame", projectId, frameId },
        baseRevision: 1,
        actor: { source: "studio", id: "stale-human" },
        operations: [
          {
            kind: "updateNode",
            nodeId: node.id,
            propertyGroup: "transform",
            value: { x: 140 },
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "SEMANTIC_CONFLICT",
      details: {
        baseRevision: 1,
        currentRevision: 2,
        affectedNodeIds: [node.id],
        affectedProperties: [property],
        intendedChanges: expect.arrayContaining([
          expect.objectContaining({ property, before: 64, after: 140 }),
        ]),
        interveningChanges: expect.arrayContaining([
          expect.objectContaining({ property, before: 64, after: 80 }),
        ]),
      },
    });
    expect(
      requireFrame(requireProject(workspace, projectId), frameId).revision,
    ).toBe(2);
    await closeWorkspace(workspace);
  });

  it("rejects caller-supplied manifests and commits only runtime-verified imports", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { engine, workspace } = harness;
    const project = requireProject(workspace, projectId);
    const imported = await importAssetBuffer({
      workspace,
      project,
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#315cf5"/></svg>',
      ),
      declaredMime: "image/svg+xml",
    });
    const rawRequest = {
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "project", projectId },
      baseRevision: project.document.revision,
      actor: { source: "mcp", id: "forged-import" },
      operations: [{ kind: "importAsset", asset: imported.asset }],
    };
    await expect(engine.execute(rawRequest)).rejects.toMatchObject({
      code: "INVALID_OPERATION",
    });
    expect(project.assets.assets).toHaveLength(0);

    await engine.commitVerifiedImport({
      projectId,
      baseRevision: project.document.revision,
      actor: { source: "http", id: "verified-import" },
      operation: { kind: "importAsset", asset: imported.asset },
    });
    expect(project.assets.assets).toEqual([imported.asset]);

    const tampered = {
      ...imported.asset,
      id: randomUUID(),
      hash: `sha256:${"0".repeat(64)}`,
    };
    await expect(
      engine.commitVerifiedImport({
        projectId,
        baseRevision: project.document.revision,
        actor: { source: "http", id: "tampered-import" },
        operation: { kind: "importAsset", asset: tampered },
      }),
    ).rejects.toMatchObject({ code: "ASSET_HASH_MISMATCH" });
    await closeWorkspace(workspace);
  });

  it("previews without mutation and commits exactly one revision", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { engine, workspace } = harness;
    const request = {
      schemaVersion: 1 as const,
      mode: "preview" as const,
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame" as const, projectId, frameId },
      baseRevision: 0,
      actor: { source: "mcp" as const, id: "preview-test" },
      operations: [
        {
          kind: "createNode" as const,
          parentId: "root" as const,
          node: rectangle(),
        },
      ],
      renderPreview: true,
    };
    const preview = (await engine.execute(request)) as TransactionPreviewResult;
    expect(preview.previewImageUrl).toBe(
      `/api/previews/${preview.previewId}/render`,
    );
    expect(
      requireFrame(requireProject(workspace, projectId), frameId).revision,
    ).toBe(0);
    expect(
      engine.getPreviewFrame(preview.previewId).frame.root.children,
    ).toHaveLength(1);

    const committed = await engine.commitPreview(preview.previewId);
    expect(committed.revision).toBe(1);
    expect(committed.affectedNodes).toContain(nodeId);
    const frame = requireFrame(requireProject(workspace, projectId), frameId);
    expect(frame.revision).toBe(1);
    expect(frame.root.children[0]?.id).toBe(nodeId);
    await expect(engine.commitPreview(preview.previewId)).rejects.toMatchObject(
      { code: "STALE_PREVIEW" },
    );
    await closeWorkspace(workspace);
  });

  it("preserves a deleted frame file and latest scene through project undo and reopen", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { engine, workspace, root, descriptorDirectory } = harness;
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 0,
      actor: { source: "studio", id: "test" },
      operations: [{ kind: "createNode", parentId: "root", node: rectangle() }],
    });
    const project = requireProject(workspace, projectId);
    const beforeDelete = structuredClone(requireFrame(project, frameId));
    const beforeHash = await semanticFrameHash(beforeDelete);
    const file = path.join(project.directory, "frames", "portrait.json");

    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "project", projectId },
      baseRevision: project.document.revision,
      actor: { source: "studio", id: "test" },
      operations: [{ kind: "deleteFrame", frameId }],
    });
    expect(await stat(file).then((entry) => entry.isFile())).toBe(true);
    expect(project.document.frames).toHaveLength(0);
    expect(() => requireFrame(project, frameId)).toThrowError(RuntimeError);

    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "project", projectId },
      baseRevision: project.document.revision,
      actor: { source: "studio", id: "test" },
      operations: [{ kind: "undo" }],
    });
    expect(await semanticFrameHash(requireFrame(project, frameId))).toBe(
      beforeHash,
    );
    await closeWorkspace(workspace);

    const reopened = await openWorkspace(root, { descriptorDirectory });
    const reopenedProject = requireProject(reopened, projectId);
    expect(reopenedProject.document.revision).toBe(3);
    expect(requireFrame(reopenedProject, frameId).revision).toBe(1);
    expect(
      await semanticFrameHash(requireFrame(reopenedProject, frameId)),
    ).toBe(beforeHash);
    await closeWorkspace(reopened);
  });

  it("blocks only a frame whose canonical content diverges from its history and preserves recovery evidence", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { engine, workspace, root, descriptorDirectory } = harness;
    const project = requireProject(workspace, projectId);
    const safeFrameId = "88888888-8888-4888-8888-888888888888";
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "project", projectId },
      baseRevision: project.document.revision,
      actor: { source: "http", id: "setup" },
      operations: [
        {
          kind: "createFrame",
          frameId: safeFrameId,
          slug: "safe-frame",
          name: "Safe Frame",
          width: 1080,
          height: 1080,
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
      actor: { source: "studio", id: "canonical" },
      operations: [{ kind: "createNode", parentId: "root", node: rectangle() }],
    });
    const canonicalPath = path.join(
      project.directory,
      "frames",
      "portrait.json",
    );
    const tampered = structuredClone(requireFrame(project, frameId));
    (tampered.root.children[0] as RectangleNode).transform.x = 912;
    await closeWorkspace(workspace);
    await writeFile(canonicalPath, stableStringify(tampered, true));

    const reopened = await openWorkspace(root, { descriptorDirectory });
    const reopenedProject = requireProject(reopened, projectId);
    expect(requireFrame(reopenedProject, safeFrameId).revision).toBe(0);
    let blocked: RuntimeError | undefined;
    try {
      requireFrame(reopenedProject, frameId);
    } catch (error) {
      blocked = error as RuntimeError;
    }
    expect(blocked).toMatchObject({
      code: "HISTORY_RECOVERY_REQUIRED",
      statusCode: 409,
    });
    expect(blocked?.message).toContain(
      "saved content does not match its revision history",
    );
    const recoveryPath = blocked?.details?.recoveryPath;
    expect(typeof recoveryPath).toBe("string");
    const evidence = JSON.parse(
      await readFile(path.join(root, String(recoveryPath)), "utf8"),
    ) as { canonical: RectangleNode; history: unknown[]; code: string };
    expect(evidence.code).toBe("HISTORY_RECOVERY_REQUIRED");
    expect(evidence.history.length).toBeGreaterThan(0);
    expect(
      (
        evidence.canonical as unknown as {
          root: { children: RectangleNode[] };
        }
      ).root.children[0]?.transform.x,
    ).toBe(912);
    await closeWorkspace(reopened);
  });

  it("rejects stale revisions and concurrent workspace ownership", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { root, workspace, engine } = harness;
    await expect(
      openWorkspace(root, {
        descriptorDirectory: path.join(root, "second-descriptors"),
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_IN_USE" });
    await expect(
      engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "frame", projectId, frameId },
        baseRevision: 8,
        actor: { source: "http", id: "test" },
        operations: [
          { kind: "createNode", parentId: "root", node: rectangle() },
        ],
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    await closeWorkspace(workspace);
  });

  it("converts valid external edits and preserves rejected source in recovery", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { workspace, engine } = harness;
    await engine.execute({
      schemaVersion: 1,
      mode: "commit",
      runtimeId: workspace.runtimeId,
      workspaceId: workspace.config.workspaceId,
      scope: { kind: "frame", projectId, frameId },
      baseRevision: 0,
      actor: { source: "studio", id: "test" },
      operations: [{ kind: "createNode", parentId: "root", node: rectangle() }],
    });
    const project = requireProject(workspace, projectId);
    const file = path.join(project.directory, "frames", "portrait.json");
    const watcher = new WorkspaceWatcher(workspace, engine);
    await watcher.start();
    const waitFor = (eventName: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timed out waiting for ${eventName}.`));
        }, 4_000);
        const unsubscribe = engine.events.subscribe((event) => {
          if (event.event !== eventName) return;
          clearTimeout(timer);
          unsubscribe();
          resolve();
        });
      });
    try {
      const proposed = structuredClone(requireFrame(project, frameId));
      const proposedNode = proposed.root.children[0] as RectangleNode;
      proposedNode.transform.x = 512;
      const committed = waitFor("transaction.committed");
      await writeFile(file, stableStringify(proposed, true));
      await committed;
      expect(
        (requireFrame(project, frameId).root.children[0] as RectangleNode)
          .transform.x,
      ).toBe(512);
      expect(project.history.at(-1)?.kind).toBe("externalEdit");

      const rejected = waitFor("frame.external-edit.rejected");
      await writeFile(file, '{"invalid":');
      await rejected;
      const canonical = JSON.parse(await readFile(file, "utf8")) as {
        revision: number;
      };
      expect(canonical.revision).toBe(2);
      const conflict = project.externalConflicts.get(frameId);
      expect(conflict?.code).toBe("EXTERNAL_EDIT_NOT_REPRESENTABLE");
      expect(
        await stat(path.join(workspace.root, conflict!.recoveryPath)).then(
          (entry) => entry.isFile(),
        ),
      ).toBe(true);
    } finally {
      await watcher.close();
      await closeWorkspace(workspace);
    }
  });

  it("does not misclassify rapid canonical persistence as external edits", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const { workspace, engine } = harness;
    const project = requireProject(workspace, projectId);
    const file = path.join(project.directory, "frames", "portrait.json");
    const watcher = new WorkspaceWatcher(workspace, engine);
    const rejected: string[] = [];
    const unsubscribe = engine.events.subscribe((event) => {
      if (event.event === "frame.external-edit.rejected")
        rejected.push(event.event);
    });
    await watcher.start();
    try {
      await engine.execute({
        schemaVersion: 1,
        mode: "commit",
        runtimeId: workspace.runtimeId,
        workspaceId: workspace.config.workspaceId,
        scope: { kind: "frame", projectId, frameId },
        baseRevision: 0,
        actor: { source: "studio", id: "canonical-write-race" },
        operations: [
          { kind: "createNode", parentId: "root", node: rectangle() },
        ],
      });
      const nodeId = requireFrame(project, frameId).root.children[0]!.id;
      for (let revision = 1; revision <= 12; revision += 1)
        await engine.execute({
          schemaVersion: 1,
          mode: "commit",
          runtimeId: workspace.runtimeId,
          workspaceId: workspace.config.workspaceId,
          scope: { kind: "frame", projectId, frameId },
          baseRevision: revision,
          actor: { source: "studio", id: "canonical-write-race" },
          operations: [
            {
              kind: "updateNode",
              nodeId,
              propertyGroup: "transform",
              value: { x: revision },
            },
          ],
        });
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(rejected).toEqual([]);
      expect(project.externalConflicts.size).toBe(0);
      expect(
        (JSON.parse(await readFile(file, "utf8")) as { revision: number })
          .revision,
      ).toBe(13);
    } finally {
      unsubscribe();
      await watcher.close();
      await closeWorkspace(workspace);
    }
  });

  it("exports a redacted local diagnostics directory without project content", async () => {
    const harness = await createHarness();
    await bootstrapProject(harness);
    const result = await exportDiagnostics(harness.root);
    const entries = await readdir(result.directory);
    expect(entries.sort()).toEqual([
      "metrics.json",
      "package-versions.json",
      "recent-logs.jsonl",
      "redaction-report.json",
      "runtime-summary.json",
      "system-profile.json",
    ]);
    const summary = JSON.parse(
      await readFile(
        path.join(result.directory, "runtime-summary.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(summary).toMatchObject({ projectCount: 1 });
    expect(JSON.stringify(summary)).not.toContain("Release Test");
    expect(JSON.stringify(summary)).not.toContain(nodeId);
  });
});

describe("workspace and path security", () => {
  it("clamps adaptive raster limits to the live renderer and rejects strict overflow", async () => {
    const harness = await createHarness();
    try {
      applyRendererCapabilities(harness.workspace, {
        maxTextureSize: 8192,
        maxRenderbufferSize: 4096,
        maxCanvasDimension: 8192,
      });
      expect(harness.workspace.capabilities).toMatchObject({
        maxTextureSize: 8192,
        maxRenderbufferSize: 4096,
        maxCanvasDimension: 4096,
        effectiveRasterLimits: { maxDimension: 4096 },
      });
      harness.workspace.config.rasterLimits.capabilityMode = "strict";
      harness.workspace.config.rasterLimits.maxDimension = 8192;
      expect(() =>
        applyRendererCapabilities(harness.workspace, {
          maxTextureSize: 4096,
          maxRenderbufferSize: 4096,
          maxCanvasDimension: 4096,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "RENDER_CAPABILITY_EXCEEDED" }),
      );
    } finally {
      await closeWorkspace(harness.workspace);
    }
  });

  it("fails safely for missing and non-empty uninitialized paths", async () => {
    const parent = await temporaryDirectory("agentic-init-test");
    await expect(
      openWorkspace(path.join(parent, "missing"), {
        descriptorDirectory: path.join(parent, "descriptors"),
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    const nonEmpty = path.join(parent, "non-empty");
    await mkdir(nonEmpty);
    await writeFile(path.join(nonEmpty, "note.txt"), "do not modify");
    await expect(
      openWorkspace(nonEmpty, {
        descriptorDirectory: path.join(parent, "descriptors"),
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_INITIALIZED" });
    expect(await readFile(path.join(nonEmpty, "note.txt"), "utf8")).toBe(
      "do not modify",
    );
  });

  it("rejects traversal, absolute paths, and symlink escapes", async () => {
    const root = await temporaryDirectory("agentic-path-test");
    const outside = await temporaryDirectory("agentic-outside-test");
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await expect(resolveInside(root, "../secret.txt")).rejects.toMatchObject({
      code: "PATH_TRAVERSAL_REJECTED",
    });
    await expect(
      resolveInside(root, path.join(outside, "secret.txt")),
    ).rejects.toMatchObject({ code: "PATH_TRAVERSAL_REJECTED" });
    await symlink(outside, path.join(root, "escape"));
    await expect(
      resolveInside(root, "escape/secret.txt"),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
  });
});

describe("runtime lifecycle", () => {
  it("ignores malformed owner-only descriptors", async () => {
    const root = await temporaryDirectory("agentic-descriptor-test");
    const descriptors = path.join(root, "descriptors");
    await mkdir(descriptors);
    await writeFile(
      path.join(descriptors, "broken.json"),
      '{"schemaVersion":',
      {
        mode: 0o600,
      },
    );
    const previous = process.env.ADR_DESCRIPTOR_DIRECTORY;
    process.env.ADR_DESCRIPTOR_DIRECTORY = descriptors;
    try {
      await expect(listActiveDescriptors()).resolves.toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.ADR_DESCRIPTOR_DIRECTORY;
      else process.env.ADR_DESCRIPTOR_DIRECTORY = previous;
    }
  });

  it("refuses an unauthenticated shutdown without signaling the recorded process", async () => {
    const root = await temporaryDirectory("agentic-safe-stop-test");
    const descriptors = path.join(root, "descriptors");
    await mkdir(descriptors);
    const canonical = await realpath(root);
    await writeFile(
      path.join(descriptors, `${randomUUID()}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        runtimeId: randomUUID(),
        workspaceId: randomUUID(),
        workspacePath: canonical,
        baseUrl: "http://127.0.0.1:1",
        pid: process.pid,
        startedAt: new Date().toISOString(),
        capabilityToken: "stale-capability",
      })}\n`,
      { mode: 0o600 },
    );
    const previous = process.env.ADR_DESCRIPTOR_DIRECTORY;
    process.env.ADR_DESCRIPTOR_DIRECTORY = descriptors;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unreachable"));
    try {
      await expect(stopRuntime(canonical)).rejects.toThrow(
        "no process signal was sent",
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
      if (previous === undefined) delete process.env.ADR_DESCRIPTOR_DIRECTORY;
      else process.env.ADR_DESCRIPTOR_DIRECTORY = previous;
    }
  });

  it("accepts descriptor removal as clean shutdown even while a parent has not reaped the pid", async () => {
    const root = await temporaryDirectory("agentic-zombie-stop-test");
    const descriptors = path.join(root, "descriptors");
    await mkdir(descriptors);
    const canonical = await realpath(root);
    const runtimeId = randomUUID();
    const descriptorPath = path.join(descriptors, `${runtimeId}.json`);
    await writeFile(
      descriptorPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runtimeId,
        workspaceId: randomUUID(),
        workspacePath: canonical,
        baseUrl: "http://127.0.0.1:4100",
        pid: process.pid,
        startedAt: new Date().toISOString(),
        capabilityToken: "valid-capability",
      })}\n`,
      { mode: 0o600 },
    );
    const previous = process.env.ADR_DESCRIPTOR_DIRECTORY;
    process.env.ADR_DESCRIPTOR_DIRECTORY = descriptors;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await rm(descriptorPath);
      return new Response(JSON.stringify({ status: "stopping" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      await expect(stopRuntime(canonical)).resolves.toMatchObject({
        status: "stopped",
        runtimeId,
      });
      expect(process.kill(process.pid, 0)).toBe(true);
    } finally {
      fetch.mockRestore();
      if (previous === undefined) delete process.env.ADR_DESCRIPTOR_DIRECTORY;
      else process.env.ADR_DESCRIPTOR_DIRECTORY = previous;
    }
  });
});

describe("journal crash recovery", () => {
  it("refuses a conflicting history identity and preserves the recovery journal", async () => {
    const root = await temporaryDirectory("agentic-journal-conflict");
    const targetPath = path.join(root, "project.json");
    const historyPath = path.join(root, "history.jsonl");
    const entry = {
      id: randomUUID(),
      transactionId: randomUUID(),
      scope: "project",
      revision: 1,
    };
    await writeJsonAtomic(targetPath, { revision: 0 });
    await expect(
      persistJournaled({
        root,
        transactionId: entry.transactionId,
        scope: "project",
        previousRevision: 0,
        revision: 1,
        beforeHash: "before",
        afterHash: "after",
        targets: [{ targetPath, after: { revision: 1 } }],
        historyPath,
        historyLines: [entry],
        onHistoryLine: (_index, position) => {
          if (position === "after") throw new Error("simulated crash");
        },
      }),
    ).rejects.toThrow("simulated crash");
    await writeFile(
      historyPath,
      `${stableStringify({ ...entry, revision: 99 })}\n`,
    );
    await expect(recoverJournals(root)).rejects.toMatchObject({
      code: "HISTORY_HASH_MISMATCH",
    });
    const pending = await readdir(
      path.join(root, ".design-runtime", "transactions"),
    );
    expect(pending).toHaveLength(1);
  });

  for (const crash of [
    { index: 0, position: "before" as const },
    { index: 0, position: "after" as const },
    { index: 1, position: "before" as const },
    { index: 1, position: "after" as const },
  ]) {
    it(`recovers exact multi-line history after entry ${crash.index} ${crash.position}`, async () => {
      const root = await temporaryDirectory(
        `agentic-journal-entry-${crash.index}-${crash.position}`,
      );
      const targetPath = path.join(root, "project.json");
      const historyPath = path.join(root, "history.jsonl");
      const before = { revision: 0 };
      const after = { revision: 1 };
      await writeJsonAtomic(targetPath, before);
      const projectEntry = {
        id: randomUUID(),
        transactionId: randomUUID(),
        scope: "project",
        revision: 1,
      };
      const baselineEntry = {
        id: randomUUID(),
        transactionId: randomUUID(),
        scope: "frame",
        kind: "baseline",
        revision: 0,
      };
      await expect(
        persistJournaled({
          root,
          transactionId: projectEntry.transactionId,
          scope: "project",
          previousRevision: 0,
          revision: 1,
          beforeHash: "before",
          afterHash: "after",
          targets: [{ targetPath, after }],
          historyPath,
          historyLines: [projectEntry, baselineEntry],
          onHistoryLine: (index, position) => {
            if (index === crash.index && position === crash.position)
              throw new Error("simulated crash");
          },
        }),
      ).rejects.toThrow("simulated crash");

      expect(await recoverJournals(root)).toBe(1);
      const recovered = (await readFile(historyPath, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { id: string });
      expect(recovered.map((entry) => entry.id)).toEqual([
        projectEntry.id,
        baselineEntry.id,
      ]);
      expect(new Set(recovered.map((entry) => entry.id)).size).toBe(2);
      expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual(after);
      expect(await recoverJournals(root)).toBe(0);
    });
  }

  for (const phase of [
    "created",
    "temporary-written",
    "canonical-renamed",
    "history-appended",
    "complete",
  ] satisfies JournalPhase[]) {
    it(`recovers the ${phase} crash phase idempotently`, async () => {
      const root = await temporaryDirectory(`agentic-journal-${phase}`);
      const transactions = path.join(root, ".design-runtime", "transactions");
      await mkdir(transactions, { recursive: true });
      const targetPath = path.join(root, "document.json");
      const temporaryPath = path.join(root, ".document.tmp");
      const historyPath = path.join(root, "history.jsonl");
      const transactionId = randomUUID();
      const beforeContent = stableStringify({ revision: 0 }, true);
      const afterContent = stableStringify({ revision: 1 }, true);
      const historyLine = { transactionId, revision: 1 };
      const committed = [
        "canonical-renamed",
        "history-appended",
        "complete",
      ].includes(phase);
      await writeFile(targetPath, committed ? afterContent : beforeContent);
      if (phase === "temporary-written")
        await writeFile(temporaryPath, afterContent);
      if (["history-appended", "complete"].includes(phase))
        await writeFile(historyPath, `${stableStringify(historyLine)}\n`);
      const journal: TransactionJournal = {
        schemaVersion: 1,
        transactionId,
        scope: "frame",
        previousRevision: 0,
        revision: 1,
        beforeHash: "before",
        afterHash: "after",
        targets: [{ targetPath, temporaryPath, beforeContent, afterContent }],
        historyPath,
        historyLines: [historyLine],
        phase,
        timestamp: new Date().toISOString(),
      };
      await writeJsonAtomic(
        path.join(transactions, `${transactionId}.json`),
        journal,
      );

      expect(await recoverJournals(root)).toBe(1);
      expect(await readFile(targetPath, "utf8")).toBe(
        committed ? afterContent : beforeContent,
      );
      const history = await readFile(historyPath, "utf8").catch(() => "");
      expect(history.split("\n").filter(Boolean)).toHaveLength(
        committed ? 1 : 0,
      );
      expect(await recoverJournals(root)).toBe(0);
    });
  }
});
