import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesignRuntimeApiError } from "@tva-agentic-design/client";
import type { DesignRuntimeClient } from "@tva-agentic-design/client";
import {
  createFrameDocument,
  createProjectTemplateDefinition,
  createProjectDocument,
  createTransform,
  type FrameDocument,
  type ProjectDocument,
  type RectangleNode,
} from "@tva-agentic-design/core";
import { createStudioStore } from "../src/store";

const now = "2026-08-08T12:00:00.000Z";
const assets = { schemaVersion: 1 as const, assets: [] };
const fonts = { schemaVersion: 1 as const, fonts: [] };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const project = (id: string, name: string): ProjectDocument =>
  createProjectDocument({ id, slug: name.toLowerCase(), name, now });
const frame = (id: string, name: string): FrameDocument =>
  createFrameDocument({
    id,
    slug: name.toLowerCase(),
    name,
    width: 100,
    height: 100,
    now,
  });

beforeEach(() => {
  vi.stubGlobal("window", { history: { replaceState: vi.fn() } });
  vi.stubGlobal("location", { pathname: "/" });
});

describe("Studio load epochs", () => {
  it("tracks an ordinary unsaved gesture draft and clears it without a revision", () => {
    const store = createStudioStore({} as DesignRuntimeClient);
    const draft = {
      node: {
        x: 24,
        y: 36,
        width: 100,
        height: 100,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        anchorX: 0,
        anchorY: 0,
      },
    };
    store.getState().setDraftTransforms(draft);
    expect(store.getState()).toMatchObject({
      draftTransforms: draft,
      saveState: "unsaved",
    });
    store.getState().setDraftTransforms();
    expect(store.getState()).toMatchObject({
      draftTransforms: {},
      saveState: "saved",
    });
  });

  it("coalesces a live property gesture into one canonical commit", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const operation = {
      kind: "setCanvas" as const,
      value: {
        background: {
          type: "solid" as const,
          color: "#B83A4B",
          opacity: 1,
        },
      },
    };
    const transact = vi.fn().mockResolvedValue({
      status: "committed",
      revision: 1,
      warnings: [],
    });
    const client = {
      transact,
      getFrame: vi.fn().mockResolvedValue({ ...activeFrame, revision: 1 }),
      getHistory: vi.fn().mockResolvedValue([]),
      getExternalConflict: vi.fn().mockResolvedValue({ conflict: null }),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    store.setState({ activeProject, activeFrame, frames: [activeFrame] });

    store.getState().setDraftOperations([operation]);
    expect(store.getState()).toMatchObject({
      draftOperations: [operation],
      saveState: "unsaved",
    });
    await store.getState().commitDraftOperations();

    expect(transact).toHaveBeenCalledTimes(1);
    expect(transact).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: 0,
        operations: [operation],
      }),
    );
    expect(store.getState()).toMatchObject({
      draftOperations: [],
      saveState: "saved",
    });
  });

  it("retains surviving layer selection after a direct Inspector commit", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const card: RectangleNode = {
      id: crypto.randomUUID(),
      type: "rectangle",
      name: "Card",
      visible: true,
      locked: false,
      transform: createTransform(),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      cornerRadius: {
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
      },
    };
    activeFrame.root.children.push(card);
    const canonical = structuredClone(activeFrame);
    canonical.revision = 1;
    canonical.root.children[0]!.resizeConstraints = {
      horizontal: "center",
      vertical: "middle",
    };
    const client = {
      transact: vi.fn().mockResolvedValue({
        status: "committed",
        revision: 1,
        warnings: [],
      }),
      getFrame: vi.fn().mockResolvedValue(canonical),
      getHistory: vi.fn().mockResolvedValue([]),
      getExternalConflict: vi.fn().mockResolvedValue({ conflict: null }),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    store.setState({
      activeProject,
      activeFrame,
      frames: [activeFrame],
      selection: [card.id],
    });
    await store.getState().commit([
      {
        kind: "updateNode",
        nodeId: card.id,
        propertyGroup: "resizeConstraints",
        value: {
          constraints: { horizontal: "center", vertical: "middle" },
        },
      },
    ]);
    expect(store.getState().selection).toEqual([card.id]);
  });

  it("retains the gesture base revision across an external canonical refresh", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const canonical = { ...activeFrame, revision: 1 };
    const operation = {
      kind: "setCanvas" as const,
      value: { clipContent: false },
    };
    const transact = vi.fn().mockResolvedValue({
      status: "committed",
      revision: 2,
      warnings: [],
    });
    const client = {
      transact,
      getFrame: vi
        .fn()
        .mockResolvedValueOnce(canonical)
        .mockResolvedValueOnce({ ...canonical, revision: 2 }),
      getHistory: vi.fn().mockResolvedValue([]),
      getExternalConflict: vi.fn().mockResolvedValue({ conflict: null }),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    store.setState({ activeProject, activeFrame, frames: [activeFrame] });
    store.getState().setDraftOperations([operation]);
    expect(store.getState().draftBaseRevision).toBe(0);

    await store.getState().loadFrame(activeFrame.id, true);
    expect(store.getState()).toMatchObject({
      activeFrame: canonical,
      draftOperations: [operation],
      draftBaseRevision: 0,
      saveState: "unsaved",
    });
    await store.getState().commitDraftOperations();
    expect(transact).toHaveBeenCalledWith(
      expect.objectContaining({ baseRevision: 0, operations: [operation] }),
    );
  });

  it("retains a direct-text session base even when content returns unchanged", () => {
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const store = createStudioStore({} as DesignRuntimeClient);
    store.setState({ activeFrame });
    store.getState().beginDraftSession("text", "headline");
    store.getState().setDraftOperations([
      {
        kind: "setCanvas",
        value: { clipContent: true },
      },
    ]);
    store.getState().setDraftOperations();
    expect(store.getState()).toMatchObject({
      activeDraftSession: {
        kind: "text",
        nodeId: "headline",
        baseRevision: 0,
      },
      draftOperations: [],
      draftBaseRevision: 0,
      saveState: "saved",
    });
    store.getState().endDraftSession();
    expect(store.getState()).toMatchObject({
      activeDraftSession: undefined,
      draftBaseRevision: undefined,
    });
  });

  it("replaces or extends marquee selection deterministically", () => {
    const store = createStudioStore({} as DesignRuntimeClient);
    store.getState().selectMany(["one", "two", "one"]);
    expect(store.getState().selection).toEqual(["one", "two"]);
    store.getState().selectMany(["two", "three"], true);
    expect(store.getState().selection).toEqual(["one", "two", "three"]);
  });

  it("saves and applies project templates through canonical project and frame boundaries", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const source: RectangleNode = {
      id: crypto.randomUUID(),
      type: "rectangle",
      name: "Headline",
      visible: true,
      locked: false,
      transform: createTransform({ width: 400, height: 120 }),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      cornerRadius: {
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
      },
    };
    const template = createProjectTemplateDefinition({
      id: crypto.randomUUID(),
      name: "Campaign system",
      nodes: [source],
      slots: [
        {
          slotId: crypto.randomUUID(),
          key: "headline",
          name: "Headline",
          role: "headline",
          nodeId: source.id,
        },
      ],
      now,
    });
    activeProject.templates = [template];
    const transact = vi.fn().mockResolvedValue({
      status: "committed",
      revision: 1,
      warnings: [],
    });
    const applyProjectTemplate = vi.fn().mockResolvedValue({
      status: "committed",
      revision: 1,
      warnings: [],
    });
    const client = {
      transact,
      applyProjectTemplate,
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    const loadProject = vi.fn().mockResolvedValue(undefined);
    store.setState({
      activeProject,
      activeFrame,
      frames: [activeFrame],
      loadProject,
    });

    await store.getState().saveProjectTemplate(template);
    expect(transact).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "project", projectId: activeProject.id },
        operations: [{ kind: "setProjectTemplate", template }],
      }),
    );
    await store.getState().applyProjectTemplate(template.id);
    expect(applyProjectTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: activeProject.id,
        frameId: activeFrame.id,
        templateId: template.id,
        mode: "commit",
        idMap: { [source.id]: expect.any(String) },
      }),
    );
    const application = applyProjectTemplate.mock.calls[0]![0];
    expect(store.getState().selection).toEqual([application.groupId]);
    expect(loadProject).toHaveBeenCalledTimes(2);
  });

  it("detaches an instance with metadata-only frame operations", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const instanceId = crypto.randomUUID();
    const node: RectangleNode = {
      id: crypto.randomUUID(),
      type: "rectangle",
      name: "CTA",
      visible: true,
      locked: true,
      transform: createTransform({ width: 240, height: 80 }),
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      cornerRadius: {
        topLeft: 8,
        topRight: 8,
        bottomRight: 8,
        bottomLeft: 8,
      },
      templateInstance: {
        templateId: crypto.randomUUID(),
        instanceId,
        sourceNodeId: crypto.randomUUID(),
      },
      templateSlot: {
        slotId: crypto.randomUUID(),
        key: "cta",
        name: "CTA",
        role: "cta",
      },
    };
    activeFrame.root.children.push(node);
    const store = createStudioStore({} as DesignRuntimeClient);
    const commit = vi.fn().mockResolvedValue({
      status: "committed",
      revision: 1,
      warnings: [],
    });
    store.setState({
      activeProject,
      activeFrame,
      frames: [activeFrame],
      commit,
    });
    await store.getState().detachProjectTemplate(instanceId);
    expect(commit).toHaveBeenCalledWith([
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "templateMetadata",
        value: { templateInstance: null, templateSlot: null },
      },
    ]);
  });

  it("compiles a constrained frame resize into one canonical commit", async () => {
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const card: RectangleNode = {
      id: crypto.randomUUID(),
      type: "rectangle",
      name: "Card",
      visible: true,
      locked: false,
      transform: createTransform({ x: 70, y: 40, width: 20, height: 10 }),
      resizeConstraints: { horizontal: "right", vertical: "middle" },
      opacity: 1,
      blendMode: "normal",
      fill: { type: "solid", color: "#315CF5", opacity: 1 },
      cornerRadius: {
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
      },
    };
    activeFrame.root.children.push(card);
    const commit = vi.fn().mockResolvedValue({
      status: "committed",
      revision: 1,
      warnings: [],
    });
    const store = createStudioStore({} as DesignRuntimeClient);
    store.setState({ activeFrame, commit });
    await store.getState().resizeFrame(60, 80, "constraints");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([
      { kind: "setCanvas", value: { width: 60, height: 80 } },
      {
        kind: "updateNode",
        nodeId: card.id,
        propertyGroup: "transform",
        value: { x: 30, y: 30 },
      },
    ]);
  });

  it("duplicates directly into a requested format through one project operation", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Master");
    const transact = vi.fn().mockResolvedValue({
      status: "committed",
      revision: 1,
      warnings: [],
    });
    const loadProject = vi.fn().mockResolvedValue(undefined);
    const store = createStudioStore({
      transact,
    } as unknown as DesignRuntimeClient);
    store.setState({ activeProject, activeFrame, loadProject });
    await store
      .getState()
      .duplicateFrame("Thumbnail variation", 1280, 720, "constraints");
    expect(transact).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "project", projectId: activeProject.id },
        baseRevision: 0,
        operations: [
          expect.objectContaining({
            kind: "duplicateFrame",
            frameId: activeFrame.id,
            name: "Thumbnail variation",
            resize: { width: 1280, height: 720, strategy: "constraints" },
          }),
        ],
      }),
    );
    const newFrameId = transact.mock.calls[0]![0].operations[0].newFrameId;
    expect(loadProject).toHaveBeenCalledWith(activeProject.id, newFrameId);
  });

  it("atomically clears frame state when loading an empty project", async () => {
    const next = project(crypto.randomUUID(), "Empty");
    const client = {
      getProject: vi.fn().mockResolvedValue(next),
      listFrames: vi.fn().mockResolvedValue([]),
      getAssets: vi.fn().mockResolvedValue(assets),
      getFonts: vi.fn().mockResolvedValue(fonts),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    store.setState({
      activeProject: project(crypto.randomUUID(), "Old"),
      activeFrame: frame(crypto.randomUUID(), "Old frame"),
      history: [{}] as never[],
      selection: [crypto.randomUUID()],
      draftTransforms: { stale: { x: 1 } as never },
      preview: {} as never,
      validation: {} as never,
      validationOpen: true,
      conflict: {} as never,
      externalConflict: {} as never,
    });
    const loading = store.getState().loadProject(next.id);
    expect(store.getState()).toMatchObject({
      activeProject: undefined,
      activeFrame: undefined,
      frames: [],
      history: [],
      selection: [],
      draftTransforms: {},
      validationOpen: false,
    });
    await loading;
    expect(store.getState()).toMatchObject({
      activeProject: next,
      activeFrame: undefined,
      frames: [],
      saveState: "saved",
    });
  });

  it("prevents an older project request from winning", async () => {
    const first = project(crypto.randomUUID(), "First");
    const second = project(crypto.randomUUID(), "Second");
    const firstRequest = deferred<ProjectDocument>();
    const client = {
      getProject: vi.fn((id: string) =>
        id === first.id ? firstRequest.promise : Promise.resolve(second),
      ),
      listFrames: vi.fn().mockResolvedValue([]),
      getAssets: vi.fn().mockResolvedValue(assets),
      getFonts: vi.fn().mockResolvedValue(fonts),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    const older = store.getState().loadProject(first.id);
    await store.getState().loadProject(second.id);
    firstRequest.resolve(first);
    await older;
    expect(store.getState().activeProject?.id).toBe(second.id);
  });

  it("prevents an older frame request from winning", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const first = frame(crypto.randomUUID(), "First");
    const second = frame(crypto.randomUUID(), "Second");
    const firstRequest = deferred<FrameDocument>();
    const client = {
      getFrame: vi.fn((_projectId: string, id: string) =>
        id === first.id ? firstRequest.promise : Promise.resolve(second),
      ),
      getHistory: vi.fn().mockResolvedValue([]),
      getExternalConflict: vi.fn().mockResolvedValue({ conflict: null }),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    store.setState({ activeProject, frames: [first, second] });
    const older = store.getState().loadFrame(first.id);
    await store.getState().loadFrame(second.id);
    firstRequest.resolve(first);
    await older;
    expect(store.getState().activeFrame?.id).toBe(second.id);
  });

  it("retains a failed semantic commit for an explicit retry", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const client = {
      transact: vi.fn().mockRejectedValue(new Error("Temporary save failure")),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    store.setState({ activeProject, activeFrame });
    const operations = [
      {
        kind: "updateNode" as const,
        nodeId: crypto.randomUUID(),
        propertyGroup: "transform" as const,
        value: { x: 40 },
      },
    ];
    await store.getState().commit(operations);
    expect(store.getState()).toMatchObject({
      saveState: "error",
      error: "Temporary save failure",
      failedCommit: operations,
    });
  });

  it("requires explicit review before committing a safe rebase preview", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const nodeId = crypto.randomUUID();
    const property = `node:${nodeId}.transform.x`;
    const canonical = { ...activeFrame, revision: 2 };
    const committed = { ...activeFrame, revision: 3 };
    const previewId = crypto.randomUUID();
    const transact = vi.fn().mockResolvedValue({
      previewId,
      workspaceId: crypto.randomUUID(),
      projectId: activeProject.id,
      frameId: activeFrame.id,
      baseRevision: 2,
      operationHash: `sha256:${"a".repeat(64)}`,
      diff: [],
      warnings: [],
      affectedNodes: [nodeId],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      rebase: {
        fromRevision: 0,
        toRevision: 2,
        intendedChanges: [{ property, before: 0, after: 40, nodeId }],
        interveningChanges: [
          {
            property: `node:${nodeId}.fill`,
            before: "#000000",
            after: "#FFFFFF",
            nodeId,
          },
        ],
      },
    });
    const commitPreview = vi.fn().mockResolvedValue({ status: "committed" });
    const getFrame = vi
      .fn()
      .mockResolvedValueOnce(canonical)
      .mockResolvedValueOnce(committed);
    const client = {
      transact,
      commitPreview,
      getFrame,
      getHistory: vi.fn().mockResolvedValue([]),
      getExternalConflict: vi.fn().mockResolvedValue({ conflict: null }),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    store.setState({ activeProject, activeFrame, frames: [activeFrame] });
    const operations = [
      {
        kind: "updateNode" as const,
        nodeId,
        propertyGroup: "transform" as const,
        value: { x: 40 },
      },
    ];

    await store.getState().commit(operations);
    expect(commitPreview).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      saveState: "conflict",
      activeFrame: canonical,
      conflict: {
        kind: "safe-rebase",
        baseRevision: 0,
        canonicalRevision: 2,
        previewId,
        affectedProperties: [property],
      },
    });

    await store.getState().resolveConflict("commit");
    expect(commitPreview).toHaveBeenCalledWith(previewId);
    expect(store.getState()).toMatchObject({
      saveState: "saved",
      activeFrame: committed,
      conflict: undefined,
      preview: undefined,
    });
  });

  it("shows overlapping current and proposed values without blind retry", async () => {
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const canonical = { ...activeFrame, revision: 2 };
    const nodeId = crypto.randomUUID();
    const property = `node:${nodeId}.transform.x`;
    const transact = vi.fn().mockRejectedValue(
      new DesignRuntimeApiError({
        code: "SEMANTIC_CONFLICT",
        message: "The property changed concurrently.",
        status: 409,
        details: {
          affectedNodeIds: [nodeId],
          affectedProperties: [property],
          intendedChanges: [{ property, before: 0, after: 40, nodeId }],
          interveningChanges: [{ property, before: 0, after: 20, nodeId }],
        },
      }),
    );
    const client = {
      transact,
      getFrame: vi.fn().mockResolvedValue(canonical),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    store.setState({ activeProject, activeFrame, frames: [activeFrame] });

    await store.getState().commit([
      {
        kind: "updateNode",
        nodeId,
        propertyGroup: "transform",
        value: { x: 40 },
      },
    ]);
    expect(store.getState()).toMatchObject({
      saveState: "conflict",
      activeFrame: canonical,
      conflict: {
        kind: "overlap",
        affectedNodeIds: [nodeId],
        affectedProperties: [property],
        intendedChanges: [{ property, before: 0, after: 40, nodeId }],
        interveningChanges: [{ property, before: 0, after: 20, nodeId }],
      },
    });
    await store.getState().resolveConflict("discard");
    expect(transact).toHaveBeenCalledTimes(1);
    expect(store.getState().conflict).toBeUndefined();
  });

  it("refreshes external commits while suppressing only its own Studio session", async () => {
    let subscriber: ((event: never) => void) | undefined;
    const activeProject = project(crypto.randomUUID(), "Project");
    const activeFrame = frame(crypto.randomUUID(), "Frame");
    const ownSessionId = crypto.randomUUID();
    const otherStudioSessionId = crypto.randomUUID();
    const listProjects = vi.fn().mockResolvedValue([]);
    const client = {
      identity: {
        clientId: crypto.randomUUID(),
        sessionId: ownSessionId,
        source: "studio",
        label: "Studio",
      },
      getRuntime: vi.fn().mockResolvedValue({}),
      listProjects,
      listBrandKits: vi.fn().mockResolvedValue({ kits: [] }),
      subscribe: vi.fn((listener: (event: never) => void) => {
        subscriber = listener;
        return vi.fn();
      }),
    } as unknown as DesignRuntimeClient;
    const store = createStudioStore(client);
    await store.getState().boot();
    const loadFrame = vi.fn().mockResolvedValue(undefined);
    const loadProject = vi.fn().mockResolvedValue(undefined);
    store.setState({ activeProject, activeFrame, loadFrame, loadProject });

    subscriber!({
      event: "transaction.committed",
      payload: {
        projectId: activeProject.id,
        frameId: activeFrame.id,
        actor: { source: "mcp" },
      },
    } as never);
    await vi.waitFor(() =>
      expect(loadFrame).toHaveBeenCalledWith(activeFrame.id),
    );

    subscriber!({
      event: "transaction.committed",
      payload: {
        projectId: activeProject.id,
        originSessionId: ownSessionId,
        actor: { source: "studio" },
      },
    } as never);
    expect(loadProject).not.toHaveBeenCalled();

    subscriber!({
      event: "transaction.committed",
      payload: {
        projectId: activeProject.id,
        originSessionId: otherStudioSessionId,
        actor: { source: "studio" },
      },
    } as never);
    await vi.waitFor(() =>
      expect(loadProject).toHaveBeenCalledWith(
        activeProject.id,
        activeFrame.id,
      ),
    );

    loadProject.mockClear();
    subscriber!({
      event: "transaction.committed",
      payload: { projectId: activeProject.id, actor: { source: "http" } },
    } as never);
    await vi.waitFor(() =>
      expect(loadProject).toHaveBeenCalledWith(
        activeProject.id,
        activeFrame.id,
      ),
    );

    subscriber!({
      event: "transaction.committed",
      payload: { projectId: crypto.randomUUID(), actor: { source: "mcp" } },
    } as never);
    await vi.waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
  });
});
