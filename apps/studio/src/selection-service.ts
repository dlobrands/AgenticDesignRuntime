import { findNode, type FrameDocument } from "@tva-agentic-design/core";

const unique = (nodeIds: readonly string[]): string[] => [...new Set(nodeIds)];

export const selectNode = (
  current: readonly string[],
  nodeId?: string,
  additive = false,
): string[] => {
  if (!nodeId) return [];
  if (!additive) return [nodeId];
  return current.includes(nodeId)
    ? current.filter((id) => id !== nodeId)
    : [...current, nodeId];
};

export const selectNodes = (
  current: readonly string[],
  nodeIds: readonly string[],
  additive = false,
): string[] => {
  const requested = unique(nodeIds);
  return additive ? unique([...current, ...requested]) : requested;
};

export const retainExistingSelection = (
  selection: readonly string[],
  frame?: FrameDocument,
): string[] =>
  frame ? selection.filter((nodeId) => Boolean(findNode(frame, nodeId))) : [];

export const resolveCanvasTarget = (input: {
  hitCandidates: readonly string[];
  selection: readonly string[];
  selectedBoundsFallback?: string;
  cycle?: boolean;
}): string | undefined => {
  if (input.hitCandidates.length === 0) return input.selectedBoundsFallback;
  if (!input.cycle) return input.hitCandidates[0];
  const currentIndex = input.hitCandidates.findIndex((id) =>
    input.selection.includes(id),
  );
  return input.hitCandidates[(currentIndex + 1) % input.hitCandidates.length];
};
