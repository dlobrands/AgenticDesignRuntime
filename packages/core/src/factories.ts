import type {
  FrameDocument,
  ProjectDocument,
  RootGroup,
  Transform,
} from "./model.js";
import {
  DEFAULT_RENDER_PROFILE,
  IDENTITY_TRANSFORM,
  SCHEMA_VERSION,
} from "./model.js";

export const createTransform = (
  overrides: Partial<Transform> = {},
): Transform => ({
  ...IDENTITY_TRANSFORM,
  width: 100,
  height: 100,
  ...overrides,
});

export const createRoot = (): RootGroup => ({
  id: "root",
  type: "group",
  name: "Root",
  visible: true,
  locked: false,
  children: [],
});

export const createFrameDocument = (input: {
  id: string;
  slug: string;
  name: string;
  width: number;
  height: number;
  now: string;
}): FrameDocument => ({
  schemaVersion: SCHEMA_VERSION,
  id: input.id,
  slug: input.slug,
  name: input.name,
  revision: 0,
  createdAt: input.now,
  updatedAt: input.now,
  canvas: {
    width: input.width,
    height: input.height,
    background: { type: "solid", color: "#FFFFFF", opacity: 1 },
    clipContent: true,
  },
  root: createRoot(),
});

export const createProjectDocument = (input: {
  id: string;
  slug: string;
  name: string;
  now: string;
}): ProjectDocument => ({
  schemaVersion: SCHEMA_VERSION,
  id: input.id,
  slug: input.slug,
  name: input.name,
  revision: 0,
  createdAt: input.now,
  updatedAt: input.now,
  frames: [],
  frameOrder: [],
  renderProfile: { ...DEFAULT_RENDER_PROFILE },
  exportPresets: [],
  templates: [],
  designBriefs: [],
  designPlans: [],
});
