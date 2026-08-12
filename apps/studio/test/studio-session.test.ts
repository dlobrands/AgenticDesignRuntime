import { describe, expect, it } from "vitest";
import {
  parseStudioRoute,
  runtimeSyncSnapshot,
  studioFramePath,
} from "../src/studio-session";

describe("Studio session and navigation state", () => {
  it("parses and formats canonical project/frame routes", () => {
    expect(parseStudioRoute("/project/project-id/frame/frame-id")).toEqual({
      projectId: "project-id",
      frameId: "frame-id",
    });
    expect(parseStudioRoute("/settings")).toEqual({});
    expect(studioFramePath("project-id", "frame-id")).toBe(
      "/project/project-id/frame/frame-id",
    );
  });

  it("derives exact-session synchronization state without actor labels", () => {
    expect(
      runtimeSyncSnapshot({
        identity: {
          clientId: "11111111-1111-4111-8111-111111111111",
          sessionId: "22222222-2222-4222-8222-222222222222",
          source: "studio",
          label: "Studio",
        },
        activeProjectId: "project",
        activeFrameId: "frame",
        draftOperationCount: 0,
        draftTransformCount: 1,
      }),
    ).toEqual({
      sessionId: "22222222-2222-4222-8222-222222222222",
      activeProjectId: "project",
      activeFrameId: "frame",
      hasDraft: true,
    });
  });

  it("treats an unchanged active text edit as draft-bearing", () => {
    expect(
      runtimeSyncSnapshot({
        activeProjectId: "project",
        activeFrameId: "frame",
        draftOperationCount: 0,
        draftTransformCount: 0,
        draftSessionActive: true,
      }).hasDraft,
    ).toBe(true);
  });
});
