import type { CanvasGuide } from "@tva-agentic-design/core";
import type { CanvasBounds } from "./gesture-controller";

export type SnapLineFeedback = {
  axis: "horizontal" | "vertical";
  position: number;
  kind: "canvas" | "guide" | "object" | "spacing";
};

export type SpacingFeedback = {
  axis: "horizontal" | "vertical";
  start: number;
  end: number;
  crossPosition: number;
  gap: number;
};

export type MoveSnapResult = {
  delta: { x: number; y: number };
  lines: SnapLineFeedback[];
  spacing: SpacingFeedback[];
};

type AxisCandidate = {
  correction: number;
  target: number;
  kind: SnapLineFeedback["kind"];
  spacing?: SpacingFeedback;
};

const anchors = (start: number, size: number): number[] => [
  start,
  start + size / 2,
  start + size,
];

const overlaps = (
  firstStart: number,
  firstSize: number,
  secondStart: number,
  secondSize: number,
): boolean =>
  firstStart < secondStart + secondSize && secondStart < firstStart + firstSize;

const closest = (
  candidates: AxisCandidate[],
  threshold: number,
): AxisCandidate | undefined => {
  const priority: Record<AxisCandidate["kind"], number> = {
    guide: 0,
    spacing: 1,
    object: 2,
    canvas: 3,
  };
  return candidates
    .filter((candidate) => Math.abs(candidate.correction) <= threshold)
    .sort(
      (left, right) =>
        Math.abs(left.correction) - Math.abs(right.correction) ||
        priority[left.kind] - priority[right.kind],
    )[0];
};

export const calculateMoveSnap = (input: {
  rawDelta: { x: number; y: number };
  selectionBounds: CanvasBounds;
  canvas: { width: number; height: number };
  guides?: readonly CanvasGuide[];
  otherBounds?: readonly CanvasBounds[];
  threshold: number;
  enabled: boolean;
}): MoveSnapResult => {
  if (!input.enabled) return { delta: input.rawDelta, lines: [], spacing: [] };
  const moved = {
    ...input.selectionBounds,
    x: input.selectionBounds.x + input.rawDelta.x,
    y: input.selectionBounds.y + input.rawDelta.y,
  };
  const verticalTargets = [
    ...anchors(0, input.canvas.width).map((position) => ({
      position,
      kind: "canvas" as const,
    })),
    ...(input.guides ?? [])
      .filter((guide) => guide.axis === "vertical")
      .map((guide) => ({ position: guide.position, kind: "guide" as const })),
    ...(input.otherBounds ?? []).flatMap((bounds) =>
      anchors(bounds.x, bounds.width).map((position) => ({
        position,
        kind: "object" as const,
      })),
    ),
  ];
  const horizontalTargets = [
    ...anchors(0, input.canvas.height).map((position) => ({
      position,
      kind: "canvas" as const,
    })),
    ...(input.guides ?? [])
      .filter((guide) => guide.axis === "horizontal")
      .map((guide) => ({ position: guide.position, kind: "guide" as const })),
    ...(input.otherBounds ?? []).flatMap((bounds) =>
      anchors(bounds.y, bounds.height).map((position) => ({
        position,
        kind: "object" as const,
      })),
    ),
  ];
  const xCandidates = anchors(moved.x, moved.width).flatMap((source) =>
    verticalTargets.map((target): AxisCandidate => ({
      correction: target.position - source,
      target: target.position,
      kind: target.kind,
    })),
  );
  const yCandidates = anchors(moved.y, moved.height).flatMap((source) =>
    horizontalTargets.map((target): AxisCandidate => ({
      correction: target.position - source,
      target: target.position,
      kind: target.kind,
    })),
  );

  const horizontalPeers = (input.otherBounds ?? []).filter((bounds) =>
    overlaps(moved.y, moved.height, bounds.y, bounds.height),
  );
  const left = horizontalPeers
    .filter((bounds) => bounds.x + bounds.width <= moved.x)
    .sort((a, b) => b.x + b.width - (a.x + a.width))[0];
  const right = horizontalPeers
    .filter((bounds) => bounds.x >= moved.x + moved.width)
    .sort((a, b) => a.x - b.x)[0];
  if (left && right) {
    const desired = (left.x + left.width + right.x - moved.width) / 2;
    const gap = desired - (left.x + left.width);
    if (gap >= 0)
      xCandidates.push({
        correction: desired - moved.x,
        target: desired + moved.width / 2,
        kind: "spacing",
        spacing: {
          axis: "horizontal",
          start: left.x + left.width,
          end: right.x,
          crossPosition: moved.y + moved.height / 2,
          gap,
        },
      });
  }

  const verticalPeers = (input.otherBounds ?? []).filter((bounds) =>
    overlaps(moved.x, moved.width, bounds.x, bounds.width),
  );
  const above = verticalPeers
    .filter((bounds) => bounds.y + bounds.height <= moved.y)
    .sort((a, b) => b.y + b.height - (a.y + a.height))[0];
  const below = verticalPeers
    .filter((bounds) => bounds.y >= moved.y + moved.height)
    .sort((a, b) => a.y - b.y)[0];
  if (above && below) {
    const desired = (above.y + above.height + below.y - moved.height) / 2;
    const gap = desired - (above.y + above.height);
    if (gap >= 0)
      yCandidates.push({
        correction: desired - moved.y,
        target: desired + moved.height / 2,
        kind: "spacing",
        spacing: {
          axis: "vertical",
          start: above.y + above.height,
          end: below.y,
          crossPosition: moved.x + moved.width / 2,
          gap,
        },
      });
  }

  const x = closest(xCandidates, input.threshold);
  const y = closest(yCandidates, input.threshold);
  const lines: SnapLineFeedback[] = [];
  const spacing: SpacingFeedback[] = [];
  if (x) {
    lines.push({ axis: "vertical", position: x.target, kind: x.kind });
    if (x.spacing) spacing.push(x.spacing);
  }
  if (y) {
    lines.push({ axis: "horizontal", position: y.target, kind: y.kind });
    if (y.spacing) spacing.push(y.spacing);
  }
  return {
    delta: {
      x: input.rawDelta.x + (x?.correction ?? 0),
      y: input.rawDelta.y + (y?.correction ?? 0),
    },
    lines,
    spacing,
  };
};
