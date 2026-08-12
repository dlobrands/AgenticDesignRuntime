import { describe, expect, it } from "vitest";
import type { FrameOperation, Transform } from "@tva-agentic-design/core";
import {
  transitionDraftOperations,
  transitionDraftTransforms,
} from "../src/draft-controller";

const transform: Transform = {
  x: 1,
  y: 2,
  width: 10,
  height: 20,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  anchorX: 0,
  anchorY: 0,
};
const operation: FrameOperation = {
  kind: "setCanvas",
  value: { width: 200 },
};

describe("draft controller", () => {
  it("captures the canonical base once and preserves it across updates", () => {
    const started = transitionDraftTransforms(
      {
        draftOperations: [],
        activeRevision: 4,
        saveState: "saved",
      },
      { node: transform },
    );
    expect(started).toMatchObject({
      draftBaseRevision: 4,
      saveState: "unsaved",
    });
    expect(
      transitionDraftTransforms(
        {
          draftOperations: [],
          draftBaseRevision: started.draftBaseRevision,
          activeRevision: 5,
          saveState: started.saveState,
        },
        { node: { ...transform, x: 40 } },
      ),
    ).toMatchObject({ draftBaseRevision: 4, saveState: "unsaved" });
  });

  it("keeps the base while either transform or property operations remain", () => {
    expect(
      transitionDraftTransforms(
        {
          draftOperations: [operation],
          draftBaseRevision: 2,
          activeRevision: 3,
          saveState: "unsaved",
        },
        undefined,
      ),
    ).toMatchObject({ draftBaseRevision: 2, saveState: "unsaved" });
    expect(
      transitionDraftOperations(
        {
          draftTransforms: { node: transform },
          draftBaseRevision: 2,
          activeRevision: 3,
          saveState: "unsaved",
        },
        undefined,
      ),
    ).toMatchObject({ draftBaseRevision: 2, saveState: "unsaved" });
  });

  it("returns to saved only when the final draft surface clears", () => {
    expect(
      transitionDraftOperations(
        {
          draftTransforms: {},
          draftBaseRevision: 2,
          activeRevision: 3,
          saveState: "unsaved",
        },
        undefined,
      ),
    ).toEqual({
      draftOperations: [],
      draftBaseRevision: undefined,
      saveState: "saved",
    });
    expect(
      transitionDraftTransforms(
        {
          draftOperations: [],
          draftBaseRevision: 2,
          activeRevision: 3,
          saveState: "conflict",
        },
        undefined,
      ).saveState,
    ).toBe("conflict");
  });
});
