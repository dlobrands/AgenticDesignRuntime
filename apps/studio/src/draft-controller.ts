import type { FrameOperation, Transform } from "@tva-agentic-design/core";

export type SaveState =
  | "booting"
  | "saved"
  | "unsaved"
  | "saving"
  | "preview"
  | "conflict"
  | "error"
  | "offline";

type DraftContext = {
  draftBaseRevision?: number;
  activeRevision?: number;
  saveState: SaveState;
};

const saveStateForDraft = (
  current: SaveState,
  hasDraft: boolean,
): SaveState => {
  if (hasDraft) return "unsaved";
  return current === "unsaved" ? "saved" : current;
};

export const transitionDraftTransforms = (
  context: DraftContext & { draftOperations: readonly FrameOperation[] },
  transforms?: Record<string, Transform>,
): {
  draftTransforms: Record<string, Transform>;
  draftBaseRevision?: number;
  saveState: SaveState;
} => {
  const draftTransforms = transforms ?? {};
  const hasTransforms = Object.keys(draftTransforms).length > 0;
  const hasOperations = context.draftOperations.length > 0;
  return {
    draftTransforms,
    draftBaseRevision:
      hasTransforms || hasOperations
        ? (context.draftBaseRevision ?? context.activeRevision)
        : undefined,
    saveState: saveStateForDraft(
      context.saveState,
      hasTransforms || hasOperations,
    ),
  };
};

export const transitionDraftOperations = (
  context: DraftContext & {
    draftTransforms: Readonly<Record<string, Transform>>;
  },
  operations?: FrameOperation[],
): {
  draftOperations: FrameOperation[];
  draftBaseRevision?: number;
  saveState: SaveState;
} => {
  const draftOperations = operations ?? [];
  const hasOperations = draftOperations.length > 0;
  const hasTransforms = Object.keys(context.draftTransforms).length > 0;
  return {
    draftOperations,
    draftBaseRevision:
      hasOperations || hasTransforms
        ? (context.draftBaseRevision ?? context.activeRevision)
        : undefined,
    saveState: saveStateForDraft(
      context.saveState,
      hasOperations || hasTransforms,
    ),
  };
};
