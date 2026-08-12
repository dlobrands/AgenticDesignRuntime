import type { RuntimeClientIdentity } from "@agentic-design/client";
import type { RuntimeSyncSnapshot } from "./runtime-sync";

export type StudioRoute = { projectId?: string; frameId?: string };

export const parseStudioRoute = (pathname: string): StudioRoute => {
  const match = /^\/project\/([^/]+)\/frame\/([^/]+)/.exec(pathname);
  return match ? { projectId: match[1], frameId: match[2] } : {};
};

export const studioFramePath = (projectId: string, frameId: string): string =>
  `/project/${projectId}/frame/${frameId}`;

export const runtimeSyncSnapshot = (input: {
  identity?: RuntimeClientIdentity;
  activeProjectId?: string;
  activeFrameId?: string;
  draftOperationCount: number;
  draftTransformCount: number;
  draftSessionActive?: boolean;
}): RuntimeSyncSnapshot => ({
  sessionId: input.identity?.sessionId,
  activeProjectId: input.activeProjectId,
  activeFrameId: input.activeFrameId,
  hasDraft:
    Boolean(input.draftSessionActive) ||
    input.draftOperationCount > 0 ||
    input.draftTransformCount > 0,
});
