import type { Transform } from "@agentic-design/core";
import { calculateMoveSnap } from "./snapping-controller";

export type CanvasBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TransformGestureMode = "move" | "resize" | "resize-nw" | "rotate";

type GestureCalculation = {
  mode: TransformGestureMode;
  start: { x: number; y: number };
  latest: { x: number; y: number };
  center: { x: number; y: number };
  selectionBounds: CanvasBounds;
  transforms: Readonly<Record<string, Transform>>;
  shiftKey: boolean;
  zoom: number;
  canvas: { width: number; height: number };
  snapping?: Pick<
    Parameters<typeof calculateMoveSnap>[0],
    "enabled" | "guides" | "otherBounds"
  >;
  canvasDeltaToParent: (
    nodeId: string,
    delta: { x: number; y: number },
  ) => { x: number; y: number };
};

export const combinedBounds = (bounds: CanvasBounds[]): CanvasBounds => {
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const normalizedBounds = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): CanvasBounds => ({
  x: Math.min(startX, endX),
  y: Math.min(startY, endY),
  width: Math.abs(endX - startX),
  height: Math.abs(endY - startY),
});

export const transformsEqual = (left: Transform, right: Transform): boolean =>
  Object.keys(left).every(
    (key) => left[key as keyof Transform] === right[key as keyof Transform],
  );

const resizeFactors = (
  initial: Transform,
  localDelta: { x: number; y: number },
  fromNorthWest: boolean,
  uniform: boolean,
): { factorX: number; factorY: number } => {
  const radians = (-initial.rotation * Math.PI) / 180;
  const nodeDelta = {
    x:
      (localDelta.x * Math.cos(radians) - localDelta.y * Math.sin(radians)) /
      Math.max(0.01, Math.abs(initial.scaleX)),
    y:
      (localDelta.x * Math.sin(radians) + localDelta.y * Math.cos(radians)) /
      Math.max(0.01, Math.abs(initial.scaleY)),
  };
  let factorX = Math.max(
    0.01,
    (initial.width + nodeDelta.x * (fromNorthWest ? -1 : 1)) / initial.width,
  );
  let factorY = Math.max(
    0.01,
    (initial.height + nodeDelta.y * (fromNorthWest ? -1 : 1)) / initial.height,
  );
  if (uniform) {
    const factor =
      Math.abs(nodeDelta.x / initial.width) >=
      Math.abs(nodeDelta.y / initial.height)
        ? factorX
        : factorY;
    factorX = factor;
    factorY = factor;
  }
  return { factorX, factorY };
};

export const calculateGestureTransforms = ({
  mode,
  start,
  latest,
  center,
  selectionBounds,
  transforms,
  shiftKey,
  zoom,
  canvas,
  snapping,
  canvasDeltaToParent,
}: GestureCalculation): Record<string, Transform> => {
  let dx = latest.x - start.x;
  let dy = latest.y - start.y;
  if (shiftKey && mode === "move") {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  if (mode === "move") {
    const result = calculateMoveSnap({
      rawDelta: { x: dx, y: dy },
      selectionBounds,
      canvas,
      threshold: 7 / zoom,
      enabled: snapping?.enabled ?? true,
      guides: snapping?.guides,
      otherBounds: snapping?.otherBounds,
    });
    dx = result.delta.x;
    dy = result.delta.y;
  }

  return Object.fromEntries(
    Object.entries(transforms).map(([nodeId, initial]) => {
      const localDelta = canvasDeltaToParent(nodeId, { x: dx, y: dy });
      if (mode === "move")
        return [
          nodeId,
          {
            ...initial,
            x: initial.x + localDelta.x,
            y: initial.y + localDelta.y,
          },
        ];
      if (mode === "resize" || mode === "resize-nw") {
        const { factorX, factorY } = resizeFactors(
          initial,
          localDelta,
          mode === "resize-nw",
          shiftKey,
        );
        return [
          nodeId,
          {
            ...initial,
            ...(mode === "resize-nw"
              ? {
                  x: initial.x + localDelta.x,
                  y: initial.y + localDelta.y,
                }
              : {}),
            scaleX: initial.scaleX * factorX,
            scaleY: initial.scaleY * factorY,
          },
        ];
      }
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const currentAngle = Math.atan2(latest.y - center.y, latest.x - center.x);
      const rotation =
        initial.rotation + ((currentAngle - startAngle) * 180) / Math.PI;
      return [
        nodeId,
        {
          ...initial,
          rotation: shiftKey ? Math.round(rotation / 15) * 15 : rotation,
        },
      ];
    }),
  );
};
