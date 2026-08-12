import type { DesignRuntimeClient, RuntimeEvent } from "@agentic-design/client";

export type RuntimeSyncSnapshot = {
  sessionId?: string;
  activeProjectId?: string;
  activeFrameId?: string;
  hasDraft: boolean;
};

export type RuntimeSyncActions = {
  snapshot: () => RuntimeSyncSnapshot;
  reloadFrame: (frameId: string, preserveDraft: boolean) => Promise<void>;
  reloadProject: (projectId: string, frameId?: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  setExternalConflict: (payload: unknown) => void;
  refreshBrandKits: () => Promise<void>;
  setWarning: (message: string) => void;
  setConnectionStatus: (status: "open" | "closed" | "error") => void;
};

type TransactionPayload = {
  projectId?: string;
  frameId?: string;
  originSessionId?: string;
};

export const handleRuntimeEvent = async (
  event: RuntimeEvent,
  actions: RuntimeSyncActions,
): Promise<void> => {
  if (event.event === "transaction.committed") {
    const payload = event.payload as TransactionPayload;
    const snapshot = actions.snapshot();
    if (
      payload.originSessionId &&
      payload.originSessionId === snapshot.sessionId
    )
      return;
    if (
      payload.projectId === snapshot.activeProjectId &&
      payload.frameId === snapshot.activeFrameId
    ) {
      await actions.reloadFrame(payload.frameId!, snapshot.hasDraft);
      actions.setWarning("Canonical frame updated externally.");
      return;
    }
    if (
      payload.projectId === snapshot.activeProjectId &&
      !payload.frameId &&
      snapshot.activeProjectId
    ) {
      await actions.reloadProject(
        snapshot.activeProjectId,
        snapshot.activeFrameId,
      );
      return;
    }
    await actions.refreshProjects();
    return;
  }
  if (event.event === "frame.external-edit.rejected") {
    actions.setExternalConflict(event.payload);
    return;
  }
  if (event.event === "brand-kit.created") {
    await actions.refreshBrandKits();
    return;
  }
  if (
    event.event === "diagnostics.warning" ||
    event.event === "export.failed" ||
    event.event === "save.failed"
  ) {
    const payload = event.payload as { message?: string };
    actions.setWarning(payload.message ?? event.event);
  }
};

export const startRuntimeEventSynchronization = (
  client: DesignRuntimeClient,
  actions: RuntimeSyncActions,
): (() => void) =>
  client.subscribe(
    (event) => void handleRuntimeEvent(event, actions),
    actions.setConnectionStatus,
  );
