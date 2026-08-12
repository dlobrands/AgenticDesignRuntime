import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "@agentic-design/client";
import {
  handleRuntimeEvent,
  type RuntimeSyncActions,
  type RuntimeSyncSnapshot,
} from "../src/runtime-sync";

const event = (name: string, payload: unknown): RuntimeEvent => ({
  event: name,
  eventId: "event-1",
  runtimeId: "runtime-1",
  workspaceId: "workspace-1",
  timestamp: "2026-08-10T12:00:00.000Z",
  payload,
});

const actions = (snapshot: RuntimeSyncSnapshot) => {
  const value: RuntimeSyncActions = {
    snapshot: () => snapshot,
    reloadFrame: vi.fn(async () => undefined),
    reloadProject: vi.fn(async () => undefined),
    refreshProjects: vi.fn(async () => undefined),
    setExternalConflict: vi.fn(),
    refreshBrandKits: vi.fn(async () => undefined),
    setWarning: vi.fn(),
    setConnectionStatus: vi.fn(),
  };
  return value;
};

describe("runtime event synchronization", () => {
  it("suppresses only the exact originating Studio session", async () => {
    const sync = actions({
      sessionId: "self-session",
      activeProjectId: "project-1",
      activeFrameId: "frame-1",
      hasDraft: false,
    });
    await handleRuntimeEvent(
      event("transaction.committed", {
        projectId: "project-1",
        frameId: "frame-1",
        originSessionId: "self-session",
      }),
      sync,
    );
    expect(sync.reloadFrame).not.toHaveBeenCalled();
    await handleRuntimeEvent(
      event("transaction.committed", {
        projectId: "project-1",
        frameId: "frame-1",
        originSessionId: "peer-session",
      }),
      sync,
    );
    expect(sync.reloadFrame).toHaveBeenCalledWith("frame-1", false);
    expect(sync.setWarning).toHaveBeenCalledWith(
      "Canonical frame updated externally.",
    );
  });

  it("preserves a draft while reloading the active frame", async () => {
    const sync = actions({
      activeProjectId: "project-1",
      activeFrameId: "frame-1",
      hasDraft: true,
    });
    await handleRuntimeEvent(
      event("transaction.committed", {
        projectId: "project-1",
        frameId: "frame-1",
      }),
      sync,
    );
    expect(sync.reloadFrame).toHaveBeenCalledWith("frame-1", true);
  });

  it("routes project, workspace, conflict, brand, and warning events", async () => {
    const sync = actions({
      activeProjectId: "project-1",
      activeFrameId: "frame-1",
      hasDraft: false,
    });
    await handleRuntimeEvent(
      event("transaction.committed", { projectId: "project-1" }),
      sync,
    );
    expect(sync.reloadProject).toHaveBeenCalledWith("project-1", "frame-1");
    await handleRuntimeEvent(
      event("transaction.committed", { projectId: "project-2" }),
      sync,
    );
    expect(sync.refreshProjects).toHaveBeenCalledOnce();
    const conflict = { message: "External edit rejected" };
    await handleRuntimeEvent(
      event("frame.external-edit.rejected", conflict),
      sync,
    );
    expect(sync.setExternalConflict).toHaveBeenCalledWith(conflict);
    await handleRuntimeEvent(event("brand-kit.created", {}), sync);
    expect(sync.refreshBrandKits).toHaveBeenCalledOnce();
    await handleRuntimeEvent(
      event("save.failed", { message: "Disk unavailable" }),
      sync,
    );
    expect(sync.setWarning).toHaveBeenCalledWith("Disk unavailable");
  });
});
