import type { FrameDocument, SceneNode, Transform } from "./model.js";

export type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};
export type Point = { x: number; y: number };

export const IDENTITY_MATRIX: Matrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

const radians = (degrees: number): number => (degrees * Math.PI) / 180;
const degrees = (value: number): number => (value * 180) / Math.PI;

export const matrixFromTransform = (transform: Transform): Matrix2D => {
  const rotation = radians(transform.rotation);
  const skewX = radians(transform.skewX);
  const skewY = radians(transform.skewY);
  const a = Math.cos(rotation + skewY) * transform.scaleX;
  const b = Math.sin(rotation + skewY) * transform.scaleX;
  const c = -Math.sin(rotation - skewX) * transform.scaleY;
  const d = Math.cos(rotation - skewX) * transform.scaleY;
  const pivotX = transform.anchorX * transform.width;
  const pivotY = transform.anchorY * transform.height;
  return {
    a,
    b,
    c,
    d,
    tx: transform.x - (pivotX * a + pivotY * c),
    ty: transform.y - (pivotX * b + pivotY * d),
  };
};

export const multiplyMatrices = (
  left: Matrix2D,
  right: Matrix2D,
): Matrix2D => ({
  a: left.a * right.a + left.c * right.b,
  b: left.b * right.a + left.d * right.b,
  c: left.a * right.c + left.c * right.d,
  d: left.b * right.c + left.d * right.d,
  tx: left.a * right.tx + left.c * right.ty + left.tx,
  ty: left.b * right.tx + left.d * right.ty + left.ty,
});

export const invertMatrix = (matrix: Matrix2D): Matrix2D => {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-12)
    throw new Error("Cannot invert a singular transform.");
  const inverse = 1 / determinant;
  return {
    a: matrix.d * inverse,
    b: -matrix.b * inverse,
    c: -matrix.c * inverse,
    d: matrix.a * inverse,
    tx: (matrix.c * matrix.ty - matrix.d * matrix.tx) * inverse,
    ty: (matrix.b * matrix.tx - matrix.a * matrix.ty) * inverse,
  };
};

export const transformPoint = (matrix: Matrix2D, point: Point): Point => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
  y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
});

export const transformFromMatrix = (
  matrix: Matrix2D,
  template: Pick<Transform, "width" | "height" | "anchorX" | "anchorY">,
): Transform => {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  const rotation = Math.atan2(matrix.b, matrix.a);
  const secondAxis = Math.atan2(-matrix.c, matrix.d);
  const skewX = rotation - secondAxis;
  const pivotX = template.anchorX * template.width;
  const pivotY = template.anchorY * template.height;

  return {
    x: matrix.tx + pivotX * matrix.a + pivotY * matrix.c,
    y: matrix.ty + pivotX * matrix.b + pivotY * matrix.d,
    width: template.width,
    height: template.height,
    rotation: degrees(rotation),
    scaleX,
    scaleY: matrix.a * matrix.d - matrix.b * matrix.c < 0 ? -scaleY : scaleY,
    skewX: degrees(skewX),
    skewY: 0,
    anchorX: template.anchorX,
    anchorY: template.anchorY,
  };
};

export const matrixBounds = (
  matrix: Matrix2D,
  width: number,
  height: number,
) => {
  const points = [
    transformPoint(matrix, { x: 0, y: 0 }),
    transformPoint(matrix, { x: width, y: 0 }),
    transformPoint(matrix, { x: width, y: height }),
    transformPoint(matrix, { x: 0, y: height }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const localNodeBounds = (node: SceneNode) =>
  matrixBounds(
    matrixFromTransform(node.transform),
    node.transform.width,
    node.transform.height,
  );

export const approximatelyEqual = (
  left: number,
  right: number,
  epsilon = 1e-6,
): boolean => Math.abs(left - right) <= epsilon;

export const frameBounds = (frame: FrameDocument) => ({
  x: 0,
  y: 0,
  width: frame.canvas.width,
  height: frame.canvas.height,
});
