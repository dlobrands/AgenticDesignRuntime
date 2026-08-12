import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  DesignRuntimeApiError,
  DesignRuntimeClient,
} from "@agentic-design/client";
import {
  detachTemplateInstanceOperations,
  detachBrandComponentOperations,
  frameResizeOperations,
  templateSourceNodeIds,
} from "@agentic-design/core";
import type {
  Asset,
  AssetManifest,
  BrandKitRecord,
  BrandLintReport,
  DesignPlanCompilation,
  DesignRoleInspectionReport,
  FontManifest,
  ExportPreset,
  ExportSettings,
  FrameOperation,
  FrameDocument,
  FrameResizeStrategy,
  FrameValidationReport,
  HistoryEntry,
  ProjectDocument,
  ProjectTemplateDefinition,
  SceneNode,
  ShapeFill,
  Stroke,
  TransactionCommitResult,
  TransactionPreviewResult,
  TransactionProposalView,
  Transform,
  VectorPathCommand,
  VisualQaReport,
} from "@agentic-design/core";
import { startRuntimeEventSynchronization } from "./runtime-sync";
import {
  safeRebaseConflict,
  semanticConflictFromError,
  type ConflictState,
} from "./conflict-controller";
import {
  retainExistingSelection,
  selectNode,
  selectNodes,
} from "./selection-service";
import {
  transitionDraftOperations,
  transitionDraftTransforms,
  type SaveState,
} from "./draft-controller";
import {
  parseStudioRoute,
  runtimeSyncSnapshot,
  studioFramePath,
} from "./studio-session";
import { clampZoom, DEFAULT_ZOOM } from "./viewport-state";
import { closeProposalReview, openProposalReview } from "./proposal-controller";

export type { SaveState } from "./draft-controller";

type ExternalConflictState = {
  code: string;
  message: string;
  recoveryPath: string;
  diff: unknown[];
  timestamp: string;
};

let textEditRequestSequence = 0;
let cropEditRequestSequence = 0;

export type StudioState = {
  client: DesignRuntimeClient;
  projects: ProjectDocument[];
  frames: FrameDocument[];
  activeProject?: ProjectDocument;
  activeFrame?: FrameDocument;
  assets: AssetManifest;
  fonts: FontManifest;
  brandKits: BrandKitRecord[];
  history: HistoryEntry[];
  selection: string[];
  canvasTool: "select" | "text";
  draftTransforms: Record<string, Transform>;
  draftOperations: FrameOperation[];
  draftBaseRevision?: number;
  activeDraftSession?: {
    kind: "text" | "crop";
    nodeId: string;
    baseRevision: number;
  };
  textEditRequest?: { nodeId: string; requestId: number };
  cropEditRequest?: { nodeId: string; requestId: number };
  zoom: number;
  saveState: SaveState;
  error?: string;
  warning?: string;
  conflict?: ConflictState;
  externalConflict?: ExternalConflictState;
  failedCommit?: FrameOperation[];
  preview?: TransactionPreviewResult;
  proposalView?: TransactionProposalView;
  designPlanCompilation?: DesignPlanCompilation;
  designRoleInspection?: DesignRoleInspectionReport;
  semanticRoleAssignment?: {
    planId: string;
    roleId: string;
    nodeId: string | null;
  };
  validation?: FrameValidationReport;
  visualQa?: VisualQaReport;
  brandLint?: BrandLintReport;
  brandMigrationTarget?: { kitId: string; revision: number };
  validationOpen: boolean;
  inspectorTab: "properties" | "brand" | "history";
  inspectorOpen: boolean;
  boot: () => Promise<void>;
  loadProject: (projectId: string, frameId?: string) => Promise<void>;
  loadFrame: (frameId: string, preserveDraft?: boolean) => Promise<void>;
  commit: (
    operations: FrameOperation[],
    baseRevision?: number,
  ) => Promise<TransactionCommitResult | undefined>;
  previewOperations: (operations: FrameOperation[]) => Promise<void>;
  commitPreview: () => Promise<void>;
  explainProposedChanges: () => Promise<void>;
  discardPreview: () => void;
  previewDesignPlan: (planId: string) => Promise<void>;
  applyLayoutSystem: (planId: string) => Promise<void>;
  reflowContent: (planId: string, roleIds: string[]) => Promise<void>;
  replaceRoleAsset: (planId: string, roleId: string) => Promise<void>;
  bindBrandTokens: (planId: string) => Promise<void>;
  createDesignVariant: (planId: string, variantRuleId: string) => Promise<void>;
  inspectDesignRoles: (planId: string) => Promise<void>;
  assignSemanticRole: (
    planId: string,
    roleId: string,
    nodeId: string | null,
    copyItemId?: string | null,
  ) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  createFrame: (name: string, width?: number, height?: number) => Promise<void>;
  duplicateFrame: (
    name: string,
    width: number,
    height: number,
    strategy: FrameResizeStrategy,
  ) => Promise<void>;
  resizeFrame: (
    width: number,
    height: number,
    strategy: FrameResizeStrategy,
  ) => Promise<void>;
  select: (nodeId?: string, additive?: boolean) => void;
  selectMany: (nodeIds: string[], additive?: boolean) => void;
  setCanvasTool: (tool: "select" | "text") => void;
  setDraftTransform: (nodeId: string, transform?: Transform) => void;
  setDraftTransforms: (transforms?: Record<string, Transform>) => void;
  setDraftOperations: (operations?: FrameOperation[]) => void;
  beginDraftSession: (kind: "text" | "crop", nodeId: string) => void;
  endDraftSession: () => void;
  requestTextEdit: (nodeId: string) => void;
  clearTextEditRequest: () => void;
  requestCropEdit: (nodeId: string) => void;
  clearCropEditRequest: () => void;
  commitDraftOperations: () => Promise<TransactionCommitResult | undefined>;
  setZoom: (zoom: number) => void;
  setInspectorTab: (tab: "properties" | "brand" | "history") => void;
  setInspectorOpen: (open: boolean) => void;
  setValidationOpen: (open: boolean) => void;
  validate: () => Promise<void>;
  auditVisualQuality: (planId?: string) => Promise<void>;
  auditBrandSystem: () => Promise<void>;
  exportFrame: () => Promise<void>;
  exportFrames: (
    frameIds: string[],
    settings: Partial<ExportSettings>,
  ) => Promise<void>;
  saveExportPreset: (preset: ExportPreset) => Promise<void>;
  removeExportPreset: (presetId: string) => Promise<void>;
  saveProjectTemplate: (template: ProjectTemplateDefinition) => Promise<void>;
  removeProjectTemplate: (templateId: string) => Promise<void>;
  applyProjectTemplate: (templateId: string) => Promise<void>;
  detachProjectTemplate: (instanceId: string) => Promise<void>;
  detachBrandComponent: (instanceId: string) => Promise<void>;
  importFile: (kind: "asset" | "font", file: File) => Promise<void>;
  createBrandKit: (
    name: string,
    provenance: string,
    licenseNotes: string,
    kitId?: string,
    organization?: {
      paletteNames?: string[];
      typeRoleNames?: string[];
      logoNames?: string[];
      reusableNames?: string[];
    },
  ) => Promise<void>;
  pinBrandKit: (kitId: string, revision: number) => Promise<void>;
  rollbackBrandMigration: () => Promise<void>;
  unpinBrandKit: () => Promise<void>;
  applyBrand: (
    input: Parameters<DesignRuntimeClient["applyBrand"]>[0],
  ) => Promise<void>;
  bindPaletteToken: (input: {
    nodeId: string;
    property: "fill" | "stroke" | "textColor";
    tokenKey: string;
  }) => Promise<void>;
  unbindPaletteToken: (input: {
    nodeId: string;
    property: "fill" | "stroke" | "textColor";
  }) => Promise<void>;
  bindTypographyRole: (input: {
    nodeId: string;
    roleKey: string;
  }) => Promise<void>;
  unbindTypographyRole: (input: { nodeId: string }) => Promise<void>;
  bindEffectStyle: (input: {
    nodeId: string;
    styleKey: string;
  }) => Promise<void>;
  unbindEffectStyle: (input: { nodeId: string }) => Promise<void>;
  bindRadiusToken: (input: {
    nodeId: string;
    tokenKey: string;
  }) => Promise<void>;
  unbindRadiusToken: (input: { nodeId: string }) => Promise<void>;
  bindSpacingToken: (input: { tokenKey: string }) => Promise<void>;
  unbindSpacingToken: () => Promise<void>;
  applyVariableMode: (modeKey: string | null) => Promise<void>;
  switchBrandComponentVariant: (
    instanceId: string,
    definitionKey: string,
  ) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  restore: (revision: number) => Promise<void>;
  resolveConflict: (choice: "commit" | "discard") => Promise<void>;
  retryFailedCommit: () => Promise<void>;
  revertExternalConflict: () => Promise<void>;
  clearError: () => void;
};

const slugify = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || `untitled-${Date.now()}`;

const emptyAssets: AssetManifest = { schemaVersion: 1, assets: [] };
const emptyFonts: FontManifest = { schemaVersion: 1, fonts: [] };
const mergeBrandKits = (...groups: BrandKitRecord[][]): BrandKitRecord[] => {
  const records = new Map<string, BrandKitRecord>();
  groups.flat().forEach((kit) => records.set(`${kit.id}:${kit.revision}`, kit));
  return [...records.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || right.revision - left.revision,
  );
};

const importedLayerName = (filename: string, asset: Asset): string => {
  const withoutExtension = filename.replace(/\.[^.]+$/, "").trim();
  return (
    withoutExtension || (asset.type === "svg" ? "Vector" : "Image")
  ).slice(0, 160);
};

const importedLayer = (
  asset: Asset,
  frame: FrameDocument,
  filename: string,
  editableVector?: {
    commands: VectorPathCommand[];
    fill?: ShapeFill;
    stroke?: Stroke;
  },
): Extract<SceneNode, { type: "rasterImage" | "svg" | "vectorPath" }> => {
  const maximumWidth = frame.canvas.width * 0.7;
  const maximumHeight = frame.canvas.height * 0.7;
  const scale = Math.min(
    1,
    maximumWidth / asset.width,
    maximumHeight / asset.height,
  );
  const width = asset.width * scale;
  const height = asset.height * scale;
  const common = {
    id: crypto.randomUUID(),
    name: importedLayerName(filename, asset),
    visible: true,
    locked: false,
    transform: {
      x: (frame.canvas.width - width) / 2,
      y: (frame.canvas.height - height) / 2,
      width,
      height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      anchorX: 0,
      anchorY: 0,
    },
    opacity: 1,
    blendMode: "normal" as const,
  };
  if (asset.type === "svg" && editableVector)
    return {
      ...common,
      type: "vectorPath",
      commands: structuredClone(editableVector.commands),
      ...(editableVector.fill
        ? { fill: structuredClone(editableVector.fill) }
        : {}),
      ...(editableVector.stroke
        ? { stroke: structuredClone(editableVector.stroke) }
        : {}),
    };
  return asset.type === "raster"
    ? {
        ...common,
        type: "rasterImage",
        assetId: asset.id,
        fit: "contain",
      }
    : {
        ...common,
        type: "svg",
        assetId: asset.id,
        intrinsicSize: { width: asset.width, height: asset.height },
      };
};

export const createStudioStore = (
  client: DesignRuntimeClient = new DesignRuntimeClient(),
) => {
  let projectRequestEpoch = 0;
  let frameRequestEpoch = 0;
  let stopRuntimeSync: (() => void) | undefined;
  return create<StudioState>()(
    immer((set, get) => ({
      client,
      projects: [],
      frames: [],
      assets: emptyAssets,
      fonts: emptyFonts,
      brandKits: [],
      history: [],
      selection: [],
      canvasTool: "select",
      draftTransforms: {},
      draftOperations: [],
      zoom: DEFAULT_ZOOM,
      saveState: "booting",
      validationOpen: false,
      inspectorTab: "properties",
      inspectorOpen: false,

      boot: async () => {
        try {
          const [, projects, brandLibrary] = await Promise.all([
            get().client.getRuntime(),
            get().client.listProjects(),
            get().client.listBrandKits(),
          ]);
          set((state) => {
            state.projects = projects;
            state.brandKits = brandLibrary.kits;
            state.saveState = "saved";
          });
          const route = parseStudioRoute(location.pathname);
          const project =
            projects.find((candidate) => candidate.id === route.projectId) ??
            projects[0];
          if (project) await get().loadProject(project.id, route.frameId);
          stopRuntimeSync?.();
          stopRuntimeSync = startRuntimeEventSynchronization(get().client, {
            snapshot: () =>
              runtimeSyncSnapshot({
                identity: get().client.identity,
                activeProjectId: get().activeProject?.id,
                activeFrameId: get().activeFrame?.id,
                draftOperationCount: get().draftOperations.length,
                draftTransformCount: Object.keys(get().draftTransforms).length,
                draftSessionActive: Boolean(get().activeDraftSession),
              }),
            reloadFrame: (frameId, preserveDraft) =>
              preserveDraft
                ? get().loadFrame(frameId, true)
                : get().loadFrame(frameId),
            reloadProject: (projectId, frameId) =>
              get().loadProject(projectId, frameId),
            refreshProjects: async () => {
              const refreshed = await get().client.listProjects();
              set((state) => {
                state.projects = refreshed;
              });
            },
            setExternalConflict: (payload) =>
              set((state) => {
                state.externalConflict = payload as ExternalConflictState;
              }),
            refreshBrandKits: async () => {
              const library = await get().client.listBrandKits();
              set((state) => {
                state.brandKits = mergeBrandKits(
                  library.kits,
                  state.brandKits.filter(
                    (kit) =>
                      kit.id === state.activeProject?.brandKitPin?.kitId &&
                      kit.revision ===
                        state.activeProject?.brandKitPin?.revision,
                  ),
                );
              });
            },
            setWarning: (message) =>
              set((state) => {
                state.warning = message;
              }),
            setConnectionStatus: (status) =>
              set((state) => {
                if (status === "closed" || status === "error")
                  state.saveState = "offline";
                if (status === "open" && state.saveState === "offline")
                  state.saveState = "saved";
              }),
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      loadProject: async (projectId, requestedFrameId) => {
        const epoch = ++projectRequestEpoch;
        ++frameRequestEpoch;
        if (get().activeProject?.id !== projectId)
          set((state) => {
            state.activeProject = undefined;
            state.frames = [];
            state.activeFrame = undefined;
            state.assets = emptyAssets;
            state.fonts = emptyFonts;
            state.history = [];
            state.selection = [];
            state.draftTransforms = {};
            state.draftOperations = [];
            state.activeDraftSession = undefined;
            state.textEditRequest = undefined;
            state.cropEditRequest = undefined;
            state.preview = undefined;
            state.designPlanCompilation = undefined;
            state.designRoleInspection = undefined;
            state.semanticRoleAssignment = undefined;
            state.validation = undefined;
            state.visualQa = undefined;
            state.brandLint = undefined;
            state.validationOpen = false;
            state.conflict = undefined;
            state.externalConflict = undefined;
          });
        const client = get().client;
        const [project, frames, assets, fonts] = await Promise.all([
          client.getProject(projectId),
          client.listFrames(projectId),
          client.getAssets(projectId),
          client.getFonts(projectId),
        ]);
        if (epoch !== projectRequestEpoch) return;
        const pinnedKit = project.brandKitPin
          ? await client.getBrandKit(
              project.brandKitPin.kitId,
              project.brandKitPin.revision,
            )
          : undefined;
        if (epoch !== projectRequestEpoch) return;
        set((state) => {
          state.activeProject = project;
          state.frames = frames;
          state.assets = assets;
          state.fonts = fonts;
          if (pinnedKit)
            state.brandKits = mergeBrandKits(state.brandKits, [pinnedKit]);
          state.selection = [];
          state.draftTransforms = {};
          state.draftOperations = [];
          state.activeDraftSession = undefined;
          state.textEditRequest = undefined;
          state.cropEditRequest = undefined;
        });
        const frame =
          frames.find((candidate) => candidate.id === requestedFrameId) ??
          frames.find((candidate) => candidate.id === project.frameOrder[0]);
        if (frame) await get().loadFrame(frame.id);
        else
          set((state) => {
            state.saveState = "saved";
          });
      },

      loadFrame: async (frameId, preserveDraft = false) => {
        const epoch = ++frameRequestEpoch;
        const project = get().activeProject;
        if (!project) return;
        const [frame, historyEntries, externalConflict] = await Promise.all([
          get().client.getFrame(project.id, frameId),
          get().client.getHistory(project.id, frameId),
          get().client.getExternalConflict(project.id, frameId),
        ]);
        if (
          epoch !== frameRequestEpoch ||
          project.id !== get().activeProject?.id
        )
          return;
        window.history.replaceState(
          null,
          "",
          studioFramePath(project.id, frame.id),
        );
        set((state) => {
          state.activeFrame = frame;
          state.frames = state.frames.map((candidate) =>
            candidate.id === frame.id ? frame : candidate,
          );
          state.history = historyEntries;
          if (!preserveDraft) {
            state.selection = [];
            state.draftTransforms = {};
            state.draftOperations = [];
            state.draftBaseRevision = undefined;
            state.activeDraftSession = undefined;
            state.textEditRequest = undefined;
            state.cropEditRequest = undefined;
            state.preview = undefined;
            state.designPlanCompilation = undefined;
            state.designRoleInspection = undefined;
            state.semanticRoleAssignment = undefined;
            state.validation = undefined;
            state.visualQa = undefined;
            state.brandLint = undefined;
            state.validationOpen = false;
          }
          state.externalConflict = externalConflict.conflict ?? undefined;
          state.saveState = preserveDraft ? "unsaved" : "saved";
          state.failedCommit = undefined;
        });
      },

      commit: async (operations, baseRevision) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame || operations.length === 0) return undefined;
        const selectedIds = [...get().selection];
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.failedCommit = undefined;
        });
        try {
          const result = await get().client.transact({
            schemaVersion: 1,
            mode: "commit",
            scope: { kind: "frame", projectId: project.id, frameId: frame.id },
            baseRevision: baseRevision ?? frame.revision,
            actor: { source: "studio", id: "studio" },
            operations,
          });
          if (!("status" in result)) {
            const canonical = await get().client.getFrame(project.id, frame.id);
            set((state) => {
              state.activeFrame = canonical;
              state.frames = state.frames.map((candidate) =>
                candidate.id === canonical.id ? canonical : candidate,
              );
              state.preview = result;
              state.saveState = "conflict";
              state.conflict = safeRebaseConflict(
                result,
                operations,
                frame.revision,
                canonical.revision,
              );
            });
            return undefined;
          }
          await get().loadFrame(frame.id);
          set((state) => {
            if (state.activeFrame)
              state.selection = retainExistingSelection(
                selectedIds,
                state.activeFrame,
              );
            state.saveState = "saved";
            state.warning = result.warnings[0]?.message;
          });
          return result;
        } catch (error) {
          if (
            error instanceof DesignRuntimeApiError &&
            (error.code === "SEMANTIC_CONFLICT" ||
              error.code === "STALE_REVISION")
          ) {
            const canonical = await get().client.getFrame(project.id, frame.id);
            const conflict = semanticConflictFromError(
              error,
              operations,
              frame.revision,
              canonical.revision,
            );
            if (conflict)
              set((state) => {
                state.activeFrame = canonical;
                state.frames = state.frames.map((candidate) =>
                  candidate.id === canonical.id ? canonical : candidate,
                );
                state.saveState = "conflict";
                state.conflict = conflict;
              });
            else
              set((state) => {
                state.saveState = "error";
                state.error = error.message;
                state.failedCommit = operations;
              });
          } else
            set((state) => {
              state.saveState = "error";
              state.error =
                error instanceof Error ? error.message : String(error);
              state.failedCommit = operations;
            });
          return undefined;
        }
      },

      previewOperations: async (operations) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const preview = await get().client.transact({
            schemaVersion: 1,
            mode: "preview",
            scope: { kind: "frame", projectId: project.id, frameId: frame.id },
            baseRevision: frame.revision,
            actor: { source: "studio", id: "studio-preview" },
            operations,
            renderPreview: true,
          });
          if ("previewId" in preview)
            set((state) => {
              const review = openProposalReview(preview);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      commitPreview: async () => {
        const preview = get().preview;
        if (!preview) return;
        try {
          const migration = get().brandMigrationTarget;
          const project = get().activeProject;
          if (migration && project && !preview.frameId)
            await get().client.migrateBrandKit({
              projectId: project.id,
              kitId: migration.kitId,
              revision: migration.revision,
              baseRevision: project.revision,
              mode: "commit",
              actor: { source: "studio", id: "studio" },
            });
          else await get().client.commitProposal(preview.previewId);
          const projectId = get().activeProject?.id;
          const frameId = get().activeFrame?.id;
          if (preview.frameId && frameId) await get().loadFrame(frameId);
          else if (projectId) await get().loadProject(projectId, frameId);
          set((state) => {
            state.preview = undefined;
            state.proposalView = undefined;
            state.designPlanCompilation = undefined;
            state.semanticRoleAssignment = undefined;
            state.brandMigrationTarget = undefined;
            state.saveState = "saved";
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      discardPreview: () =>
        set((state) => {
          state.preview = undefined;
          state.proposalView = undefined;
          state.designPlanCompilation = undefined;
          state.semanticRoleAssignment = undefined;
          state.brandMigrationTarget = undefined;
          state.saveState = "saved";
        }),

      explainProposedChanges: async () => {
        const preview = get().preview;
        if (!preview) return;
        try {
          const proposal = await get().client.explainProposedChanges(
            preview.previewId,
          );
          set((state) => {
            state.proposalView = proposal;
          });
        } catch (error) {
          set((state) => {
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      previewDesignPlan: async (planId) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.preview = undefined;
          state.designPlanCompilation = undefined;
          state.semanticRoleAssignment = undefined;
        });
        try {
          const result = await get().client.previewDesignPlan({
            projectId: project.id,
            frameId: frame.id,
            planId,
            baseRevision: frame.revision,
            actor: { source: "studio", id: "studio-design-plan" },
          });
          set((state) => {
            state.designPlanCompilation = result.compilation;
            if (result.preview) {
              const review = openProposalReview(result.preview);
              state.preview = review.preview;
              state.saveState = review.saveState;
            } else {
              state.saveState = "saved";
              state.warning = "DesignPlan compiled with no actionable changes.";
            }
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      applyLayoutSystem: async (planId) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.warning = undefined;
          state.preview = undefined;
          state.designPlanCompilation = undefined;
          state.semanticRoleAssignment = undefined;
        });
        try {
          const result = await get().client.applyLayoutSystem({
            projectId: project.id,
            frameId: frame.id,
            planId,
            baseRevision: frame.revision,
            actor: { source: "studio", id: "studio-layout-system" },
          });
          set((state) => {
            state.designPlanCompilation = result.compilation;
            if (result.preview) {
              const review = openProposalReview(result.preview);
              state.preview = review.preview;
              state.saveState = review.saveState;
            } else {
              state.saveState = "saved";
              state.warning = "Layout system produced no canonical changes.";
            }
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      reflowContent: async (planId, roleIds) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame || roleIds.length === 0) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.warning = undefined;
          state.preview = undefined;
          state.designPlanCompilation = undefined;
          state.semanticRoleAssignment = undefined;
        });
        try {
          const result = await get().client.reflowContent({
            projectId: project.id,
            frameId: frame.id,
            planId,
            roleIds,
            baseRevision: frame.revision,
            actor: { source: "studio", id: "studio-content-reflow" },
          });
          set((state) => {
            state.designPlanCompilation = result.compilation;
            if (result.preview) {
              const review = openProposalReview(result.preview);
              state.preview = review.preview;
              state.saveState = review.saveState;
            } else {
              state.saveState = "saved";
              state.warning = "Selected roles produced no reflow changes.";
            }
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      replaceRoleAsset: async (planId, roleId) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.warning = undefined;
          state.preview = undefined;
          state.designPlanCompilation = undefined;
          state.semanticRoleAssignment = undefined;
        });
        try {
          const result = await get().client.replaceRoleAsset({
            projectId: project.id,
            frameId: frame.id,
            planId,
            roleId,
            baseRevision: frame.revision,
            actor: { source: "studio", id: "studio-role-asset" },
          });
          set((state) => {
            state.designPlanCompilation = result.compilation;
            if (result.preview) {
              const review = openProposalReview(result.preview);
              state.preview = review.preview;
              state.saveState = review.saveState;
            } else {
              state.saveState = "saved";
              state.warning =
                "Declared role asset produced no canonical changes.";
            }
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      bindBrandTokens: async (planId) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.warning = undefined;
          state.preview = undefined;
          state.designPlanCompilation = undefined;
          state.semanticRoleAssignment = undefined;
        });
        try {
          const result = await get().client.bindBrandTokens({
            projectId: project.id,
            frameId: frame.id,
            planId,
            baseRevision: frame.revision,
            actor: { source: "studio", id: "studio-brand-bindings" },
          });
          set((state) => {
            state.designPlanCompilation = result.compilation;
            if (result.preview) {
              const review = openProposalReview(result.preview);
              state.preview = review.preview;
              state.saveState = review.saveState;
            } else {
              state.saveState = "saved";
              state.warning =
                "Declared Brand bindings produced no canonical changes.";
            }
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      createDesignVariant: async (planId, variantRuleId) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.warning = undefined;
          state.preview = undefined;
          state.designPlanCompilation = undefined;
          state.semanticRoleAssignment = undefined;
        });
        try {
          const result = await get().client.createDesignVariant({
            projectId: project.id,
            frameId: frame.id,
            planId,
            variantRuleId,
            baseRevision: frame.revision,
            actor: { source: "studio", id: "studio-design-variant" },
          });
          set((state) => {
            state.designPlanCompilation = result.compilation;
            if (result.preview) {
              const review = openProposalReview(result.preview);
              state.preview = review.preview;
              state.saveState = review.saveState;
            } else {
              state.saveState = "saved";
              state.warning = "Variant rule produced no canonical changes.";
            }
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      inspectDesignRoles: async (planId) => {
        const project = get().activeProject;
        if (!project) return;
        try {
          const report = await get().client.inspectDesignRoles(
            project.id,
            planId,
          );
          set((state) => {
            state.designRoleInspection = report;
          });
        } catch (error) {
          set((state) => {
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      assignSemanticRole: async (planId, roleId, nodeId, copyItemId) => {
        const project = get().activeProject;
        if (!project) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.preview = undefined;
          state.designPlanCompilation = undefined;
          state.semanticRoleAssignment = undefined;
        });
        try {
          const result = await get().client.assignSemanticRole({
            projectId: project.id,
            planId,
            roleId,
            nodeId,
            ...(copyItemId !== undefined ? { copyItemId } : {}),
            baseRevision: project.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-semantic-role" },
          });
          if (!("previewId" in result.transaction))
            throw new Error(
              "Semantic role assignment did not return a preview.",
            );
          const review = openProposalReview(result.transaction);
          set((state) => {
            state.preview = review.preview;
            state.saveState = review.saveState;
            state.designRoleInspection = result.inspection;
            state.semanticRoleAssignment = { planId, roleId, nodeId };
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },

      createProject: async (name) => {
        const result = await get().client.transact({
          schemaVersion: 1,
          mode: "commit",
          scope: { kind: "workspace" },
          baseRevision: null,
          actor: { source: "studio", id: "studio" },
          operations: [
            {
              kind: "createProject",
              projectId: crypto.randomUUID(),
              slug: slugify(name),
              name,
            },
          ],
        });
        if (!("status" in result)) return;
        const projects = await get().client.listProjects();
        set((state) => {
          state.projects = projects;
        });
        await get().loadProject(result.projectId);
      },

      importFile: async (kind, file) => {
        const project = get().activeProject;
        if (!project) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
          state.warning = undefined;
        });
        let importedAsset: Asset | undefined;
        try {
          const result = await get().client.importFile(
            project.id,
            kind,
            file,
            project.revision,
          );
          if (result.kind === "asset") importedAsset = result.asset;
          const requestedFrameId = get().activeFrame?.id;
          await get().loadProject(project.id, requestedFrameId);
          if (result.kind === "font") {
            set((state) => {
              state.saveState = "saved";
              state.warning = `${file.name} imported.`;
            });
            return;
          }
          const frame = get().activeFrame;
          if (!frame) {
            set((state) => {
              state.saveState = "saved";
              state.warning = `${file.name} imported to the project asset library.`;
            });
            return;
          }
          const node = importedLayer(
            result.asset,
            frame,
            file.name,
            result.editableVector,
          );
          const committed = await get().commit([
            { kind: "createNode", parentId: "root", node },
          ]);
          if (!committed) {
            set((state) => {
              const placementError = state.error ?? "The frame commit failed.";
              state.saveState = "error";
              state.error = `${file.name} was imported to the project asset library, but its layer could not be placed. ${placementError}`;
            });
            return;
          }
          get().select(node.id);
          set((state) => {
            state.saveState = "saved";
            state.warning = result.editableVector
              ? `${file.name} imported and placed as an editable vector path.`
              : `${file.name} imported and placed.`;
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            const message =
              error instanceof Error ? error.message : String(error);
            state.error = importedAsset
              ? `${file.name} was imported to the project asset library, but its layer could not be placed. ${message}`
              : message;
          });
        }
      },

      createFrame: async (name, width = 1080, height = 1350) => {
        const project = get().activeProject;
        if (!project) return;
        const frameId = crypto.randomUUID();
        await get().client.transact({
          schemaVersion: 1,
          mode: "commit",
          scope: { kind: "project", projectId: project.id },
          baseRevision: project.revision,
          actor: { source: "studio", id: "studio" },
          operations: [
            {
              kind: "createFrame",
              frameId,
              slug: slugify(name),
              name,
              width,
              height,
            },
          ],
        });
        await get().loadProject(project.id, frameId);
      },

      duplicateFrame: async (name, width, height, strategy) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        const newFrameId = crypto.randomUUID();
        await get().client.transact({
          schemaVersion: 1,
          mode: "commit",
          scope: { kind: "project", projectId: project.id },
          baseRevision: project.revision,
          actor: { source: "studio", id: "studio" },
          operations: [
            {
              kind: "duplicateFrame",
              frameId: frame.id,
              newFrameId,
              slug: `${slugify(name)}-${newFrameId.slice(0, 8)}`,
              name,
              resize: { width, height, strategy },
            },
          ],
        });
        await get().loadProject(project.id, newFrameId);
      },

      resizeFrame: async (width, height, strategy) => {
        const frame = get().activeFrame;
        if (!frame) return;
        if (width === frame.canvas.width && height === frame.canvas.height) {
          set((state) => {
            state.warning = "The frame already uses that size.";
          });
          return;
        }
        if (
          strategy !== "canvasOnly" &&
          frame.root.children.some(
            (node) => node.type !== "adjustment" && node.locked,
          )
        ) {
          set((state) => {
            state.error =
              "Unlock top-level layers before scaling or constrained reflow. Canvas-only resize remains available.";
          });
          return;
        }
        const result = await get().commit(
          frameResizeOperations({ frame, width, height, strategy }),
        );
        if (result)
          set((state) => {
            state.warning = `Frame resized to ${width}×${height}.`;
          });
      },

      select: (nodeId, additive = false) =>
        set((state) => {
          state.selection = selectNode(state.selection, nodeId, additive);
        }),
      selectMany: (nodeIds, additive = false) =>
        set((state) => {
          state.selection = selectNodes(state.selection, nodeIds, additive);
        }),
      setCanvasTool: (tool) =>
        set((state) => {
          state.canvasTool = tool;
        }),
      setDraftTransform: (nodeId, transform) =>
        set((state) => {
          if (transform) state.draftTransforms[nodeId] = transform;
          else delete state.draftTransforms[nodeId];
        }),
      setDraftTransforms: (transforms) =>
        set((state) => {
          const transition = transitionDraftTransforms(
            {
              draftOperations: state.draftOperations,
              draftBaseRevision: state.draftBaseRevision,
              activeRevision: state.activeFrame?.revision,
              saveState: state.saveState,
            },
            transforms,
          );
          Object.assign(state, transition);
          if (state.activeDraftSession)
            state.draftBaseRevision = state.activeDraftSession.baseRevision;
        }),
      setDraftOperations: (operations) =>
        set((state) => {
          const transition = transitionDraftOperations(
            {
              draftTransforms: state.draftTransforms,
              draftBaseRevision: state.draftBaseRevision,
              activeRevision: state.activeFrame?.revision,
              saveState: state.saveState,
            },
            operations,
          );
          Object.assign(state, transition);
          if (state.activeDraftSession)
            state.draftBaseRevision = state.activeDraftSession.baseRevision;
        }),
      beginDraftSession: (kind, nodeId) =>
        set((state) => {
          const baseRevision = state.activeFrame?.revision;
          if (baseRevision === undefined) return;
          state.activeDraftSession = { kind, nodeId, baseRevision };
          state.draftBaseRevision = baseRevision;
        }),
      endDraftSession: () =>
        set((state) => {
          state.activeDraftSession = undefined;
          if (
            state.draftOperations.length === 0 &&
            Object.keys(state.draftTransforms).length === 0
          ) {
            state.draftBaseRevision = undefined;
            if (state.saveState === "unsaved") state.saveState = "saved";
          }
        }),
      requestTextEdit: (nodeId) =>
        set((state) => {
          state.textEditRequest = {
            nodeId,
            requestId: ++textEditRequestSequence,
          };
        }),
      clearTextEditRequest: () =>
        set((state) => {
          state.textEditRequest = undefined;
        }),
      requestCropEdit: (nodeId) =>
        set((state) => {
          state.cropEditRequest = {
            nodeId,
            requestId: ++cropEditRequestSequence,
          };
        }),
      clearCropEditRequest: () =>
        set((state) => {
          state.cropEditRequest = undefined;
        }),
      commitDraftOperations: async () => {
        const operations = get().draftOperations;
        if (operations.length === 0) return undefined;
        const selectedIds = [...get().selection];
        const baseRevision = get().draftBaseRevision;
        const result = await get().commit(operations, baseRevision);
        set((state) => {
          state.draftOperations = [];
          state.draftBaseRevision = undefined;
          if (result && state.activeFrame)
            state.selection = retainExistingSelection(
              selectedIds,
              state.activeFrame,
            );
          if (!result && state.saveState === "unsaved")
            state.saveState = "saved";
        });
        return result;
      },
      setZoom: (zoom) =>
        set((state) => {
          state.zoom = clampZoom(zoom);
        }),
      setInspectorTab: (tab) =>
        set((state) => {
          state.inspectorTab = tab;
        }),
      setInspectorOpen: (open) =>
        set((state) => {
          state.inspectorOpen = open;
        }),
      setValidationOpen: (open) =>
        set((state) => {
          state.validationOpen = open;
        }),
      validate: async () => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        const [validation, visualQa] = await Promise.all([
          get().client.validateFrame(project.id, frame.id),
          get().client.auditVisualQuality(project.id, frame.id),
        ]);
        set((state) => {
          state.validation = validation;
          state.visualQa = visualQa;
          state.validationOpen = true;
          state.warning =
            validation.errors[0]?.message ??
            visualQa.findings[0]?.message ??
            validation.warnings[0]?.message;
        });
      },
      auditVisualQuality: async (planId) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const visualQa = await get().client.auditVisualQuality(
            project.id,
            frame.id,
            planId,
          );
          set((state) => {
            state.visualQa = visualQa;
            state.validationOpen = true;
            state.warning = visualQa.findings[0]?.message;
          });
        } catch (error) {
          set((state) => {
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      auditBrandSystem: async () => {
        const project = get().activeProject;
        if (!project) return;
        try {
          const report = await get().client.auditBrand(project.id);
          set((state) => {
            state.brandLint = report;
            state.warning = report.findings[0]?.message;
          });
        } catch (error) {
          set((state) => {
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      exportFrame: async () => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        set((state) => {
          state.saveState = "saving";
        });
        try {
          const result = await get().client.exportFrame(project.id, frame.id);
          set((state) => {
            state.saveState = "saved";
            state.warning = `Exported ${result.width}×${result.height} PNG to ${result.path}`;
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      exportFrames: async (frameIds, settings) => {
        const project = get().activeProject;
        if (!project || frameIds.length === 0) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
        });
        try {
          const result = await get().client.exportProject(
            project.id,
            frameIds,
            settings,
          );
          set((state) => {
            state.saveState = "saved";
            state.warning = `Exported ${result.exports.length} ${result.format.toUpperCase()} ${result.exports.length === 1 ? "frame" : "frames"} at ${result.scale}×.`;
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
          throw error;
        }
      },
      saveExportPreset: async (preset) => {
        const project = get().activeProject;
        if (!project) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
        });
        try {
          await get().client.transact({
            schemaVersion: 1,
            mode: "commit",
            scope: { kind: "project", projectId: project.id },
            baseRevision: project.revision,
            actor: { source: "studio", id: "studio" },
            operations: [{ kind: "setExportPreset", preset }],
          });
          await get().loadProject(project.id, get().activeFrame?.id);
          set((state) => {
            state.warning = `Saved export preset “${preset.name}”.`;
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
          throw error;
        }
      },
      removeExportPreset: async (presetId) => {
        const project = get().activeProject;
        if (!project) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
        });
        try {
          await get().client.transact({
            schemaVersion: 1,
            mode: "commit",
            scope: { kind: "project", projectId: project.id },
            baseRevision: project.revision,
            actor: { source: "studio", id: "studio" },
            operations: [{ kind: "removeExportPreset", presetId }],
          });
          await get().loadProject(project.id, get().activeFrame?.id);
          set((state) => {
            state.warning = "Removed export preset.";
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
          throw error;
        }
      },
      saveProjectTemplate: async (template) => {
        const project = get().activeProject;
        if (!project) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
        });
        try {
          await get().client.transact({
            schemaVersion: 1,
            mode: "commit",
            scope: { kind: "project", projectId: project.id },
            baseRevision: project.revision,
            actor: { source: "studio", id: "studio" },
            operations: [{ kind: "setProjectTemplate", template }],
          });
          await get().loadProject(project.id, get().activeFrame?.id);
          set((state) => {
            state.warning = `Saved project template “${template.name}”.`;
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
          throw error;
        }
      },
      removeProjectTemplate: async (templateId) => {
        const project = get().activeProject;
        if (!project) return;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
        });
        try {
          await get().client.transact({
            schemaVersion: 1,
            mode: "commit",
            scope: { kind: "project", projectId: project.id },
            baseRevision: project.revision,
            actor: { source: "studio", id: "studio" },
            operations: [{ kind: "removeProjectTemplate", templateId }],
          });
          await get().loadProject(project.id, get().activeFrame?.id);
          set((state) => {
            state.warning = "Removed project template.";
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
          throw error;
        }
      },
      applyProjectTemplate: async (templateId) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        const template = project?.templates?.find(
          (candidate) => candidate.id === templateId,
        );
        if (!project || !frame || !template) return;
        const groupId = crypto.randomUUID();
        const instanceId = crypto.randomUUID();
        const idMap = Object.fromEntries(
          templateSourceNodeIds(template).map((id) => [
            id,
            crypto.randomUUID(),
          ]),
        );
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
        });
        try {
          await get().client.applyProjectTemplate({
            projectId: project.id,
            frameId: frame.id,
            templateId,
            baseRevision: frame.revision,
            mode: "commit",
            actor: { source: "studio", id: "studio" },
            instanceId,
            groupId,
            idMap,
          });
          await get().loadProject(project.id, frame.id);
          get().select(groupId);
          set((state) => {
            state.warning = `Applied template “${template.name}” with ${template.slots.length} semantic ${template.slots.length === 1 ? "slot" : "slots"}.`;
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
          throw error;
        }
      },
      detachProjectTemplate: async (instanceId) => {
        const frame = get().activeFrame;
        if (!frame) return;
        const operations = detachTemplateInstanceOperations(frame, instanceId);
        const result = await get().commit(operations);
        if (result)
          set((state) => {
            state.warning =
              "Detached template metadata; every layer remains editable.";
          });
      },
      detachBrandComponent: async (instanceId) => {
        const frame = get().activeFrame;
        if (!frame) return;
        const result = await get().commit(
          detachBrandComponentOperations(frame, instanceId),
        );
        if (result)
          set((state) => {
            state.warning =
              "Detached component identity; appearance, layers, and node IDs are unchanged.";
          });
      },
      createBrandKit: async (
        name,
        provenance,
        licenseNotes,
        kitId,
        organization,
      ) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project) return;
        const kit = kitId
          ? [...get().brandKits]
              .filter((candidate) => candidate.id === kitId)
              .sort((left, right) => right.revision - left.revision)[0]
          : undefined;
        const pin =
          project.brandKitPin?.kitId === kitId
            ? project.brandKitPin
            : undefined;
        set((state) => {
          state.saveState = "saving";
          state.error = undefined;
        });
        try {
          const colors = new Map<string, string>();
          const visit = (node: FrameDocument["root"]["children"][number]) => {
            if (
              (node.type === "rectangle" ||
                node.type === "ellipse" ||
                node.type === "vectorPath") &&
              node.fill?.type === "solid"
            )
              colors.set(
                node.fill.color.toLowerCase(),
                node.fill.color.toUpperCase(),
              );
            if (node.type === "text")
              colors.set(
                node.typography.color.toLowerCase(),
                node.typography.color.toUpperCase(),
              );
            if (node.type === "group" || node.type === "mask")
              node.children.forEach(visit);
          };
          frame?.root.children.forEach(visit);
          const definitions = structuredClone(kit?.definitions ?? []).map(
            (definition, index) => ({
              ...definition,
              name:
                organization?.reusableNames?.[index]?.trim() || definition.name,
            }),
          );
          const remapDefinitionNode = (node: SceneNode): void => {
            if (node.type === "rasterImage" || node.type === "svg")
              node.assetId = pin?.resourceMap[node.assetId] ?? node.assetId;
            if (node.type === "text") {
              node.typography.fontId =
                pin?.resourceMap[node.typography.fontId] ??
                node.typography.fontId;
              for (const span of node.spans ?? [])
                if (span.style.fontId)
                  span.style.fontId =
                    pin?.resourceMap[span.style.fontId] ?? span.style.fontId;
            }
            if (node.type === "group")
              node.children.forEach(remapDefinitionNode);
            if (node.type === "mask") {
              remapDefinitionNode(node.maskSource);
              node.children.forEach(remapDefinitionNode);
            }
          };
          definitions.forEach((definition) =>
            definition.nodes.forEach(remapDefinitionNode),
          );
          const usedKeys = new Set<string>();
          const organizedKey = (value: string, fallback: string) => {
            const base =
              value
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 56) || fallback;
            let key = /^[a-z]/.test(base) ? base : `token-${base}`;
            let suffix = 2;
            while (usedKeys.has(key)) key = `${base}-${suffix++}`;
            usedKeys.add(key);
            return key;
          };
          const palette = [...colors.values()]
            .slice(0, 24)
            .map((color, index) => {
              const organizedName = organization?.paletteNames?.[index]?.trim();
              const tokenName =
                organizedName ||
                (index === 0
                  ? "Primary"
                  : index === 1
                    ? "Secondary"
                    : `Accent ${index - 1}`);
              return {
                key: organizedKey(tokenName, `palette-${index + 1}`),
                name: tokenName,
                color,
              };
            });
          const result = await get().client.createBrandKit({
            ...(kitId ? { kitId } : {}),
            name,
            sourceProjectId: project.id,
            provenance,
            licenseNotes,
            palette,
            typeRoles: get()
              .fonts.fonts.slice(0, 8)
              .map((font, index) => {
                const organizedName =
                  organization?.typeRoleNames?.[index]?.trim();
                const roleName =
                  organizedName ||
                  (index === 0
                    ? "Display"
                    : index === 1
                      ? "Body"
                      : `Supporting ${index - 1}`);
                return {
                  key: organizedKey(roleName, `type-role-${index + 1}`),
                  name: roleName,
                  fontId: font.id,
                  fontSize: index === 0 ? 48 : 24,
                  lineHeight: index === 0 ? 56 : 32,
                  letterSpacing: 0,
                  ...(palette[0] ? { colorToken: palette[0].key } : {}),
                };
              }),
            logos: get()
              .assets.assets.filter((asset) => asset.type === "svg")
              .slice(0, 12)
              .map((asset, index) => {
                const logoName =
                  organization?.logoNames?.[index]?.trim() ||
                  asset.path.split("/").at(-1) ||
                  (index === 0 ? "Primary Logo" : `Logo ${index + 1}`);
                return {
                  key: organizedKey(logoName, `logo-${index + 1}`),
                  name: logoName,
                  assetId: asset.id,
                  licenseNotes,
                  provenance,
                };
              }),
            ...(kit?.effectStyles
              ? { effectStyles: structuredClone(kit.effectStyles) }
              : {}),
            ...(kit?.radiusTokens
              ? { radiusTokens: structuredClone(kit.radiusTokens) }
              : {}),
            ...(kit?.spacingTokens
              ? { spacingTokens: structuredClone(kit.spacingTokens) }
              : {}),
            ...(kit?.variableModes
              ? { variableModes: structuredClone(kit.variableModes) }
              : {}),
            definitions,
            actor: { source: "studio", id: "studio" },
          });
          set((state) => {
            state.brandKits = [...mergeBrandKits(state.brandKits, [result])];
            state.saveState = "saved";
            state.warning = `Created Brand Kit “${result.name}” r${result.revision}.`;
          });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      pinBrandKit: async (kitId, revision) => {
        const project = get().activeProject;
        if (!project) return;
        try {
          if (
            project.brandKitPin?.kitId === kitId &&
            project.brandKitPin.revision !== revision
          ) {
            const result = await get().client.migrateBrandKit({
              projectId: project.id,
              kitId,
              revision,
              baseRevision: project.revision,
              mode: "preview",
              actor: { source: "studio", id: "studio" },
            });
            if ("previewId" in result)
              set((state) => {
                const review = openProposalReview(result);
                state.preview = review.preview;
                state.brandMigrationTarget = { kitId, revision };
                state.saveState = review.saveState;
                state.warning = `Review exact Brand migration to r${revision}.`;
              });
            return;
          }
          await get().client.pinBrandKit({
            projectId: project.id,
            kitId,
            revision,
            baseRevision: project.revision,
            mode: "commit",
            actor: { source: "studio", id: "studio" },
          });
          await get().loadProject(project.id, get().activeFrame?.id);
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      rollbackBrandMigration: async () => {
        const project = get().activeProject;
        if (!project) return;
        try {
          const result = await get().client.rollbackBrandMigration({
            projectId: project.id,
            baseRevision: project.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio" },
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
              state.warning = "Review exact Brand migration rollback.";
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      unpinBrandKit: async () => {
        const project = get().activeProject;
        if (!project) return;
        try {
          await get().client.unpinBrandKit({
            projectId: project.id,
            baseRevision: project.revision,
            mode: "commit",
            actor: { source: "studio", id: "studio" },
          });
          await get().loadProject(project.id, get().activeFrame?.id);
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      applyBrand: async (input) => {
        try {
          const result = await get().client.applyBrand(input);
          if ("status" in result && get().activeFrame)
            await get().loadFrame(get().activeFrame!.id);
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      bindPaletteToken: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.bindPaletteToken({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            bindingId: crypto.randomUUID(),
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      unbindPaletteToken: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.unbindPaletteToken({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      bindTypographyRole: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.bindTypographyRole({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            bindingId: crypto.randomUUID(),
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      unbindTypographyRole: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.unbindTypographyRole({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      bindEffectStyle: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.bindEffectStyle({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            bindingId: crypto.randomUUID(),
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      unbindEffectStyle: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.unbindEffectStyle({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      bindRadiusToken: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.bindRadiusToken({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            bindingId: crypto.randomUUID(),
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      unbindRadiusToken: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.unbindRadiusToken({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      bindSpacingToken: async (input) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.bindSpacingToken({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            bindingId: crypto.randomUUID(),
            ...input,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      unbindSpacingToken: async () => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.unbindSpacingToken({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      applyVariableMode: async (modeKey) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.applyVariableMode({
            projectId: project.id,
            frameId: frame.id,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-live-brand" },
            modeKey,
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      switchBrandComponentVariant: async (instanceId, definitionKey) => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        try {
          const result = await get().client.switchBrandComponentVariant({
            projectId: project.id,
            frameId: frame.id,
            instanceId,
            definitionKey,
            baseRevision: frame.revision,
            mode: "preview",
            actor: { source: "studio", id: "studio-brand-component" },
          });
          if ("previewId" in result)
            set((state) => {
              const review = openProposalReview(result);
              state.preview = review.preview;
              state.saveState = review.saveState;
            });
        } catch (error) {
          set((state) => {
            state.saveState = "error";
            state.error =
              error instanceof Error ? error.message : String(error);
          });
        }
      },
      undo: async () => {
        await get().commit([{ kind: "undo" }]);
      },
      redo: async () => {
        await get().commit([{ kind: "redo" }]);
      },
      restore: async (revision) => {
        await get().commit([{ kind: "restoreRevision", revision }]);
      },
      resolveConflict: async (choice) => {
        const conflict = get().conflict;
        if (!conflict) return;
        const review = closeProposalReview(get().preview, choice);
        set((state) => {
          state.conflict = undefined;
          state.preview = review.preview;
          state.saveState = review.saveState;
        });
        if (review.previewIdToCommit) {
          try {
            await get().client.commitPreview(review.previewIdToCommit);
            if (get().activeFrame) await get().loadFrame(get().activeFrame!.id);
          } catch (error) {
            set((state) => {
              state.saveState = "error";
              state.error =
                error instanceof Error ? error.message : String(error);
            });
          }
        }
      },
      retryFailedCommit: async () => {
        const operations = get().failedCommit;
        if (!operations) return;
        const selectedIds = operations.flatMap((operation) =>
          operation.kind === "updateNode" ? [operation.nodeId] : [],
        );
        const result = await get().commit(operations);
        if (result)
          set((state) => {
            state.selection = selectedIds;
          });
      },
      revertExternalConflict: async () => {
        const project = get().activeProject;
        const frame = get().activeFrame;
        if (!project || !frame) return;
        await get().client.revertExternalConflict(project.id, frame.id);
        set((state) => {
          state.externalConflict = undefined;
          state.warning =
            "Rejected edit cleared; the preserved recovery copy remains available.";
        });
      },
      clearError: () =>
        set((state) => {
          state.error = undefined;
          state.warning = undefined;
          state.failedCommit = undefined;
          if (state.saveState === "error") state.saveState = "saved";
        }),
    })),
  );
};

export const useStudio = createStudioStore();
