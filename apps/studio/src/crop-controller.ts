import type { FrameOperation, RasterImageNode } from "@agentic-design/core";

export type CropRect = NonNullable<RasterImageNode["crop"]>;

export type CropEditSession = {
  projectId: string;
  frameId: string;
  baseRevision: number;
  nodeId: string;
  nodeSnapshot: RasterImageNode;
  initialCrop: CropRect;
  crop: CropRect;
  scale: number;
};

const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const MIN_CROP_SIZE = 0.02;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const sameCrop = (left: CropRect, right: CropRect): boolean =>
  (["x", "y", "width", "height"] as const).every(
    (key) => Math.abs(left[key] - right[key]) < 1e-6,
  );

export const beginCropEdit = (input: {
  projectId: string;
  frameId: string;
  revision: number;
  node: RasterImageNode;
}): CropEditSession => {
  const initialCrop = structuredClone(input.node.crop ?? FULL_CROP);
  return {
    projectId: input.projectId,
    frameId: input.frameId,
    baseRevision: input.revision,
    nodeId: input.node.id,
    nodeSnapshot: structuredClone(input.node),
    initialCrop,
    crop: structuredClone(initialCrop),
    scale: 1,
  };
};

export const panCropSource = (
  session: CropEditSession,
  delta: { x: number; y: number },
  viewport: { width: number; height: number },
): CropEditSession => {
  const x = clamp(
    session.crop.x -
      (delta.x / Math.max(1, viewport.width)) * session.crop.width,
    0,
    1 - session.crop.width,
  );
  const y = clamp(
    session.crop.y -
      (delta.y / Math.max(1, viewport.height)) * session.crop.height,
    0,
    1 - session.crop.height,
  );
  return { ...session, crop: { ...session.crop, x, y } };
};

export const scaleCropSource = (
  session: CropEditSession,
  scale: number,
): CropEditSession => {
  const nextScale = clamp(scale, 0.25, 8);
  const ratio = session.scale / nextScale;
  const width = clamp(session.crop.width * ratio, MIN_CROP_SIZE, 1);
  const height = clamp(session.crop.height * ratio, MIN_CROP_SIZE, 1);
  const centerX = session.crop.x + session.crop.width / 2;
  const centerY = session.crop.y + session.crop.height / 2;
  return {
    ...session,
    scale: nextScale,
    crop: {
      x: clamp(centerX - width / 2, 0, 1 - width),
      y: clamp(centerY - height / 2, 0, 1 - height),
      width,
      height,
    },
  };
};

export const resetCropEdit = (session: CropEditSession): CropEditSession => ({
  ...session,
  crop: structuredClone(FULL_CROP),
  scale: 1,
});

export const cropEditOperation = (
  session: CropEditSession,
): FrameOperation | undefined => {
  if (
    sameCrop(session.crop, session.initialCrop) &&
    session.nodeSnapshot.fit === "cover"
  )
    return undefined;
  return {
    kind: "updateNode",
    nodeId: session.nodeId,
    propertyGroup: "crop",
    value: {
      crop: sameCrop(session.crop, FULL_CROP)
        ? null
        : structuredClone(session.crop),
      fit: "cover",
    },
  };
};

export const cropEditFitsSessionScope = (
  session: CropEditSession,
  projectId?: string,
  frameId?: string,
): boolean => session.projectId === projectId && session.frameId === frameId;

export const cropResolution = (input: {
  node: RasterImageNode;
  asset: { width: number; height: number };
  crop?: CropRect;
}): {
  sourceWidth: number;
  sourceHeight: number;
  displayWidth: number;
  displayHeight: number;
  lowResolution: boolean;
} => {
  const crop = input.crop ?? input.node.crop ?? FULL_CROP;
  const sourceWidth = input.asset.width * crop.width;
  const sourceHeight = input.asset.height * crop.height;
  const displayWidth =
    input.node.transform.width * Math.abs(input.node.transform.scaleX);
  const displayHeight =
    input.node.transform.height * Math.abs(input.node.transform.scaleY);
  return {
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
    lowResolution:
      sourceWidth < displayWidth * 0.75 || sourceHeight < displayHeight * 0.75,
  };
};
