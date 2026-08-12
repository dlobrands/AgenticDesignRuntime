import type { VectorPathCommand, VectorPathPoint } from "@agentic-design/core";

export type VectorPathSubpath = {
  points: Array<{ x: number; y: number }>;
  closed: boolean;
};

const canvasPoint = (
  point: VectorPathPoint,
  width: number,
  height: number,
): { x: number; y: number } => ({ x: point.x * width, y: point.y * height });

const cubicPoint = (
  start: { x: number; y: number },
  control1: { x: number; y: number },
  control2: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
): { x: number; y: number } => {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * control1.x +
      3 * inverse * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * control1.y +
      3 * inverse * t ** 2 * control2.y +
      t ** 3 * end.y,
  };
};

export const vectorPathSubpaths = (
  commands: readonly VectorPathCommand[],
  width: number,
  height: number,
  cubicSegments = 24,
): VectorPathSubpath[] => {
  const result: VectorPathSubpath[] = [];
  let current: VectorPathSubpath | undefined;
  let cursor = { x: 0, y: 0 };
  const finish = () => {
    if (current?.points.length) result.push(current);
    current = undefined;
  };
  for (const command of commands) {
    if (command.kind === "move") {
      finish();
      cursor = canvasPoint(command.to, width, height);
      current = { points: [cursor], closed: false };
      continue;
    }
    if (command.kind === "close") {
      if (current) current.closed = true;
      finish();
      continue;
    }
    if (!current) continue;
    if (command.kind === "line") {
      cursor = canvasPoint(command.to, width, height);
      current.points.push(cursor);
      continue;
    }
    const control1 = canvasPoint(command.control1, width, height);
    const control2 = canvasPoint(command.control2, width, height);
    const end = canvasPoint(command.to, width, height);
    const start = cursor;
    for (let index = 1; index <= cubicSegments; index += 1)
      current.points.push(
        cubicPoint(start, control1, control2, end, index / cubicSegments),
      );
    cursor = end;
  }
  finish();
  return result;
};
