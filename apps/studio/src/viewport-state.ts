export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
export const DEFAULT_ZOOM = 0.62;

export const clampZoom = (zoom: number): number =>
  Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export const scaledCanvasSize = (
  canvas: { width: number; height: number },
  zoom: number,
): { width: number; height: number } => ({
  width: canvas.width * clampZoom(zoom),
  height: canvas.height * clampZoom(zoom),
});

export const clientPointToCanvas = (
  point: { x: number; y: number },
  bounds: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number },
): { x: number; y: number } => ({
  x: (point.x - bounds.left) * (canvas.width / bounds.width),
  y: (point.y - bounds.top) * (canvas.height / bounds.height),
});
