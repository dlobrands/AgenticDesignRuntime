import type {
  VectorPathCommand,
  VectorPathPoint,
} from "@tva-agentic-design/core";

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

const quadraticPoint = (
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
): { x: number; y: number } => {
  const inverse = 1 - t;
  return {
    x: inverse ** 2 * start.x + 2 * inverse * t * control.x + t ** 2 * end.x,
    y: inverse ** 2 * start.y + 2 * inverse * t * control.y + t ** 2 * end.y,
  };
};

const vectorAngle = (
  left: { x: number; y: number },
  right: { x: number; y: number },
): number => {
  const dot = left.x * right.x + left.y * right.y;
  const length = Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y);
  const unsigned = Math.acos(
    Math.max(-1, Math.min(1, dot / Math.max(length, 1e-12))),
  );
  return left.x * right.y - left.y * right.x < 0 ? -unsigned : unsigned;
};

const arcPoints = (
  start: { x: number; y: number },
  radius: { x: number; y: number },
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  end: { x: number; y: number },
): Array<{ x: number; y: number }> => {
  if (
    Math.hypot(end.x - start.x, end.y - start.y) < 1e-9 ||
    radius.x <= 0 ||
    radius.y <= 0
  )
    return [end];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const xPrime = cos * dx + sin * dy;
  const yPrime = -sin * dx + cos * dy;
  let rx = Math.abs(radius.x);
  let ry = Math.abs(radius.y);
  const scale = xPrime ** 2 / rx ** 2 + yPrime ** 2 / ry ** 2;
  if (scale > 1) {
    const factor = Math.sqrt(scale);
    rx *= factor;
    ry *= factor;
  }
  const numerator = Math.max(
    0,
    rx ** 2 * ry ** 2 - rx ** 2 * yPrime ** 2 - ry ** 2 * xPrime ** 2,
  );
  const denominator = Math.max(
    1e-12,
    rx ** 2 * yPrime ** 2 + ry ** 2 * xPrime ** 2,
  );
  const coefficient =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(numerator / denominator);
  const centerPrime = {
    x: (coefficient * rx * yPrime) / ry,
    y: (-coefficient * ry * xPrime) / rx,
  };
  const center = {
    x: cos * centerPrime.x - sin * centerPrime.y + (start.x + end.x) / 2,
    y: sin * centerPrime.x + cos * centerPrime.y + (start.y + end.y) / 2,
  };
  const startVector = {
    x: (xPrime - centerPrime.x) / rx,
    y: (yPrime - centerPrime.y) / ry,
  };
  const endVector = {
    x: (-xPrime - centerPrime.x) / rx,
    y: (-yPrime - centerPrime.y) / ry,
  };
  const startAngle = vectorAngle({ x: 1, y: 0 }, startVector);
  let delta = vectorAngle(startVector, endVector);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 12)));
  return Array.from({ length: segments }, (_, index) => {
    const angle = startAngle + (delta * (index + 1)) / segments;
    const x = rx * Math.cos(angle);
    const y = ry * Math.sin(angle);
    return {
      x: center.x + cos * x - sin * y,
      y: center.y + sin * x + cos * y,
    };
  });
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
    const end = canvasPoint(command.to, width, height);
    const start = cursor;
    if (command.kind === "quadratic") {
      const control = canvasPoint(command.control, width, height);
      for (let index = 1; index <= cubicSegments; index += 1)
        current.points.push(
          quadraticPoint(start, control, end, index / cubicSegments),
        );
    } else if (command.kind === "cubic") {
      const control1 = canvasPoint(command.control1, width, height);
      const control2 = canvasPoint(command.control2, width, height);
      for (let index = 1; index <= cubicSegments; index += 1)
        current.points.push(
          cubicPoint(start, control1, control2, end, index / cubicSegments),
        );
    } else {
      current.points.push(
        ...arcPoints(
          start,
          { x: command.radius.x * width, y: command.radius.y * height },
          command.rotation,
          command.largeArc,
          command.sweep,
          end,
        ),
      );
    }
    cursor = end;
  }
  finish();
  return result;
};
