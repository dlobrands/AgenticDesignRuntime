import { z } from "zod";
import type { ActorSource, MutationMode } from "./model.js";
import type { SemanticChange } from "./footprints.js";
import {
  AdjustmentNodeSchema,
  AdjustmentValuesSchema,
  AssetSchema,
  BrandStyleBindingSchema,
  BrandComponentInstanceMetadataSchema,
  CanvasGuideSchema,
  CanvasSpacingBindingSchema,
  DesignBriefSchema,
  DesignPlanSchema,
  EffectsSchema,
  ExportPresetSchema,
  FrameBrandModeSchema,
  FontRecordSchema,
  MaskSourceNodeSchema,
  ResizeConstraintsSchema,
  ProjectTemplateDefinitionSchema,
  SceneNodeSchema,
  ShapeFillSchema,
  StrokeSchema,
  SafeAreaInsetsSchema,
  TextSpanSchema,
  TemplateInstanceMetadataSchema,
  TemplateSlotMetadataSchema,
  TransformSchema,
  VectorPathCommandSchema,
} from "./schema.js";

const uuid = z.string().uuid();
const nodeId = z.union([uuid, z.literal("root")]);
const index = z.number().int().min(0);
const finite = z.number().finite();
const opacity = finite.min(0).max(1);

export const CreateProjectOperationSchema = z
  .object({
    kind: z.literal("createProject"),
    projectId: uuid,
    slug: z.string(),
    name: z.string().min(1),
  })
  .strict();
export const RenameProjectOperationSchema = z
  .object({
    kind: z.literal("renameProject"),
    name: z.string().min(1).max(160),
  })
  .strict();
export const SetExportPresetOperationSchema = z
  .object({
    kind: z.literal("setExportPreset"),
    preset: ExportPresetSchema,
  })
  .strict();
export const RemoveExportPresetOperationSchema = z
  .object({
    kind: z.literal("removeExportPreset"),
    presetId: uuid,
  })
  .strict();
export const SetProjectTemplateOperationSchema = z
  .object({
    kind: z.literal("setProjectTemplate"),
    template: ProjectTemplateDefinitionSchema,
  })
  .strict();
export const RemoveProjectTemplateOperationSchema = z
  .object({
    kind: z.literal("removeProjectTemplate"),
    templateId: uuid,
  })
  .strict();
export const SetDesignBriefOperationSchema = z
  .object({
    kind: z.literal("setDesignBrief"),
    brief: DesignBriefSchema,
  })
  .strict();
export const RemoveDesignBriefOperationSchema = z
  .object({
    kind: z.literal("removeDesignBrief"),
    briefId: uuid,
  })
  .strict();
export const SetDesignPlanOperationSchema = z
  .object({
    kind: z.literal("setDesignPlan"),
    plan: DesignPlanSchema,
  })
  .strict();
export const RemoveDesignPlanOperationSchema = z
  .object({
    kind: z.literal("removeDesignPlan"),
    planId: uuid,
  })
  .strict();
export const CreateFrameOperationSchema = z
  .object({
    kind: z.literal("createFrame"),
    frameId: uuid,
    slug: z.string(),
    name: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export const DuplicateFrameOperationSchema = z
  .object({
    kind: z.literal("duplicateFrame"),
    frameId: uuid,
    newFrameId: uuid,
    slug: z.string(),
    name: z.string().min(1),
    resize: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        strategy: z.enum(["canvasOnly", "scale", "constraints"]),
      })
      .strict()
      .optional(),
  })
  .strict();
export const RenameFrameOperationSchema = z
  .object({
    kind: z.literal("renameFrame"),
    frameId: uuid,
    name: z.string().min(1).max(160),
  })
  .strict();
export const ReorderFrameOperationSchema = z
  .object({ kind: z.literal("reorderFrame"), frameOrder: z.array(uuid).min(1) })
  .strict();
export const DeleteFrameOperationSchema = z
  .object({ kind: z.literal("deleteFrame"), frameId: uuid })
  .strict();
export const SetCanvasOperationSchema = z
  .object({
    kind: z.literal("setCanvas"),
    value: z
      .object({
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        background: z
          .union([
            z.object({ type: z.literal("transparent") }).strict(),
            ShapeFillSchema,
          ])
          .optional(),
        clipContent: z.boolean().optional(),
        guides: z.array(CanvasGuideSchema).max(128).nullable().optional(),
        safeArea: SafeAreaInsetsSchema.nullable().optional(),
        spacingBinding: CanvasSpacingBindingSchema.nullable().optional(),
      })
      .strict(),
  })
  .strict();
export const SetFrameBrandModeOperationSchema = z
  .object({
    kind: z.literal("setFrameBrandMode"),
    mode: FrameBrandModeSchema.nullable(),
  })
  .strict();

export const CreateNodeOperationSchema = z
  .object({
    kind: z.literal("createNode"),
    parentId: nodeId,
    index: index.optional(),
    node: SceneNodeSchema,
  })
  .strict();
export const DeleteNodeOperationSchema = z
  .object({ kind: z.literal("deleteNode"), nodeId: uuid })
  .strict();
export const DuplicateNodeOperationSchema = z
  .object({
    kind: z.literal("duplicateNode"),
    nodeId: uuid,
    idMap: z.record(z.string(), uuid),
    offset: z.object({ x: finite, y: finite }).strict().optional(),
  })
  .strict();
export const MoveNodeOperationSchema = z
  .object({
    kind: z.literal("moveNode"),
    nodeId: uuid,
    parentId: nodeId,
    index,
  })
  .strict();
export const ReorderNodeOperationSchema = z
  .object({ kind: z.literal("reorderNode"), nodeId: uuid, index })
  .strict();
export const GroupNodesOperationSchema = z
  .object({
    kind: z.literal("groupNodes"),
    nodeIds: z.array(uuid).min(1),
    groupId: uuid,
    name: z.string().min(1).max(160),
  })
  .strict();
export const UngroupNodesOperationSchema = z
  .object({ kind: z.literal("ungroupNodes"), groupId: uuid })
  .strict();

const updateBase = { kind: z.literal("updateNode"), nodeId: uuid } as const;
export const UpdateNodeOperationSchema = z.discriminatedUnion("propertyGroup", [
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("common"),
      value: z.object({ name: z.string().min(1).max(160) }).strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("resizeConstraints"),
      value: z
        .object({ constraints: ResizeConstraintsSchema.nullable() })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("templateMetadata"),
      value: z
        .object({
          templateInstance: TemplateInstanceMetadataSchema.nullable(),
          templateSlot: TemplateSlotMetadataSchema.nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("brandComponentMetadata"),
      value: z
        .object({
          brandComponent: BrandComponentInstanceMetadataSchema.nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("brandBinding"),
      value: z
        .object({
          property: z.enum([
            "fill",
            "stroke",
            "textColor",
            "typography",
            "effects",
            "radius",
          ]),
          binding: BrandStyleBindingSchema.nullable(),
        })
        .strict()
        .refine(
          (value) =>
            value.binding === null || value.binding.property === value.property,
          { message: "Brand binding property must match its target." },
        ),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("transform"),
      value: TransformSchema.partial().strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("visibility"),
      value: z.object({ visible: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("locking"),
      value: z.object({ locked: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("compositing"),
      value: z
        .object({
          opacity: opacity.optional(),
          blendMode: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("textContent"),
      value: z
        .object({
          text: z.string(),
          spans: z.array(TextSpanSchema).min(1).max(256).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("typography"),
      value: z
        .object({
          fontId: uuid.optional(),
          fontSize: finite.positive().optional(),
          fontWeight: z.number().int().min(1).max(1000).optional(),
          fontStyle: z.enum(["normal", "italic"]).optional(),
          lineHeight: finite.positive().optional(),
          letterSpacing: finite.optional(),
          alignment: z.enum(["left", "center", "right", "justify"]).optional(),
          verticalAlignment: z.enum(["top", "middle", "bottom"]).optional(),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          opacity: opacity.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("textBox"),
      value: z
        .object({
          mode: z.enum(["autoWidth", "autoHeight", "fixed"]).optional(),
          width: finite.positive().optional(),
          height: finite.positive().nullable().optional(),
          wrapping: z.enum(["word", "character", "none"]).optional(),
          overflow: z.enum(["visible", "clip"]).optional(),
          overflowAccepted: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("fill"),
      value: z.object({ fill: ShapeFillSchema.nullable() }).strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("stroke"),
      value: z.object({ stroke: StrokeSchema.nullable() }).strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("vectorPath"),
      value: z
        .object({
          commands: z
            .array(VectorPathCommandSchema)
            .min(2)
            .max(1024)
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("shape"),
      value: z
        .object({
          cornerRadius: z
            .object({
              topLeft: finite.min(0),
              topRight: finite.min(0),
              bottomRight: finite.min(0),
              bottomLeft: finite.min(0),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("crop"),
      value: z
        .object({
          crop: z
            .object({
              x: finite.min(0).max(1),
              y: finite.min(0).max(1),
              width: finite.positive().max(1),
              height: finite.positive().max(1),
            })
            .strict()
            .nullable()
            .optional(),
          fit: z.enum(["fill", "contain", "cover", "none"]).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      propertyGroup: z.literal("effects"),
      value: z.object({ effects: EffectsSchema.nullable() }).strict(),
    })
    .strict(),
]);

export const ImportAssetOperationSchema = z
  .object({ kind: z.literal("importAsset"), asset: AssetSchema })
  .strict();
export const ReplaceAssetOperationSchema = z
  .object({
    kind: z.literal("replaceAsset"),
    nodeId: uuid,
    assetId: uuid,
    fit: z.enum(["fill", "contain", "cover", "none"]).optional(),
  })
  .strict();
export const ImportFontOperationSchema = z
  .object({ kind: z.literal("importFont"), font: FontRecordSchema })
  .strict();
export const RemoveFontOperationSchema = z
  .object({ kind: z.literal("removeFont"), fontId: uuid })
  .strict();
export const PinBrandKitOperationSchema = z
  .object({
    kind: z.literal("pinBrandKit"),
    pin: z
      .object({
        kitId: uuid,
        revision: z.number().int().positive(),
        contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        resourceMap: z.record(uuid, uuid),
      })
      .strict(),
  })
  .strict();
export const MigrateBrandKitOperationSchema = z
  .object({
    kind: z.literal("migrateBrandKit"),
    pin: PinBrandKitOperationSchema.shape.pin,
  })
  .strict();
export const UnpinBrandKitOperationSchema = z
  .object({ kind: z.literal("unpinBrandKit") })
  .strict();

export const ApplyMaskOperationSchema = z
  .object({
    kind: z.literal("applyMask"),
    maskId: uuid,
    name: z.string().min(1),
    mode: z.enum(["alpha", "luminance"]),
    inverted: z.boolean(),
    maskSource: MaskSourceNodeSchema,
    nodeIds: z.array(uuid).min(1),
  })
  .strict();
export const UpdateMaskOperationSchema = z
  .object({
    kind: z.literal("updateMask"),
    maskId: uuid,
    value: z
      .object({
        mode: z.enum(["alpha", "luminance"]).optional(),
        inverted: z.boolean().optional(),
        maskSource: MaskSourceNodeSchema.optional(),
      })
      .strict(),
  })
  .strict();
export const RemoveMaskOperationSchema = z
  .object({ kind: z.literal("removeMask"), maskId: uuid })
  .strict();
export const AddAdjustmentOperationSchema = z
  .object({
    kind: z.literal("addAdjustment"),
    adjustment: AdjustmentNodeSchema,
  })
  .strict();
export const SetAdjustmentOperationSchema = z
  .object({
    kind: z.literal("setAdjustment"),
    adjustmentId: uuid,
    values: AdjustmentValuesSchema.partial().strict(),
    targetId: nodeId.optional(),
  })
  .strict();
export const ToggleAdjustmentOperationSchema = z
  .object({
    kind: z.literal("toggleAdjustment"),
    adjustmentId: uuid,
    enabled: z.boolean(),
  })
  .strict();
export const RemoveAdjustmentOperationSchema = z
  .object({ kind: z.literal("removeAdjustment"), adjustmentId: uuid })
  .strict();

export const UndoOperationSchema = z
  .object({ kind: z.literal("undo") })
  .strict();
export const RedoOperationSchema = z
  .object({ kind: z.literal("redo") })
  .strict();
export const RestoreRevisionOperationSchema = z
  .object({
    kind: z.literal("restoreRevision"),
    revision: z.number().int().min(0),
  })
  .strict();

export const WorkspaceOperationSchema = CreateProjectOperationSchema;

export const ProjectOperationSchema = z.union([
  RenameProjectOperationSchema,
  SetExportPresetOperationSchema,
  RemoveExportPresetOperationSchema,
  SetProjectTemplateOperationSchema,
  RemoveProjectTemplateOperationSchema,
  SetDesignBriefOperationSchema,
  RemoveDesignBriefOperationSchema,
  SetDesignPlanOperationSchema,
  RemoveDesignPlanOperationSchema,
  CreateFrameOperationSchema,
  DuplicateFrameOperationSchema,
  RenameFrameOperationSchema,
  ReorderFrameOperationSchema,
  DeleteFrameOperationSchema,
  ImportAssetOperationSchema,
  ImportFontOperationSchema,
  RemoveFontOperationSchema,
  PinBrandKitOperationSchema,
  MigrateBrandKitOperationSchema,
  UnpinBrandKitOperationSchema,
  UndoOperationSchema,
  RedoOperationSchema,
]);

export const FrameOperationSchema = z.union([
  SetCanvasOperationSchema,
  SetFrameBrandModeOperationSchema,
  CreateNodeOperationSchema,
  UpdateNodeOperationSchema,
  DeleteNodeOperationSchema,
  DuplicateNodeOperationSchema,
  MoveNodeOperationSchema,
  ReorderNodeOperationSchema,
  GroupNodesOperationSchema,
  UngroupNodesOperationSchema,
  ReplaceAssetOperationSchema,
  ApplyMaskOperationSchema,
  UpdateMaskOperationSchema,
  RemoveMaskOperationSchema,
  AddAdjustmentOperationSchema,
  SetAdjustmentOperationSchema,
  ToggleAdjustmentOperationSchema,
  RemoveAdjustmentOperationSchema,
  UndoOperationSchema,
  RedoOperationSchema,
  RestoreRevisionOperationSchema,
]);

export const SemanticOperationSchema = z.union([
  WorkspaceOperationSchema,
  ProjectOperationSchema,
  FrameOperationSchema,
]);

export const WORKSPACE_OPERATION_KINDS = ["createProject"] as const;
export const PROJECT_OPERATION_KINDS = [
  "renameProject",
  "setExportPreset",
  "removeExportPreset",
  "setProjectTemplate",
  "removeProjectTemplate",
  "setDesignBrief",
  "removeDesignBrief",
  "setDesignPlan",
  "removeDesignPlan",
  "createFrame",
  "duplicateFrame",
  "renameFrame",
  "reorderFrame",
  "deleteFrame",
  "importAsset",
  "importFont",
  "removeFont",
  "pinBrandKit",
  "migrateBrandKit",
  "unpinBrandKit",
  "undo",
  "redo",
] as const;
export const FRAME_OPERATION_KINDS = [
  "setCanvas",
  "setFrameBrandMode",
  "createNode",
  "updateNode",
  "deleteNode",
  "duplicateNode",
  "moveNode",
  "reorderNode",
  "groupNodes",
  "ungroupNodes",
  "replaceAsset",
  "applyMask",
  "updateMask",
  "removeMask",
  "addAdjustment",
  "setAdjustment",
  "toggleAdjustment",
  "removeAdjustment",
  "undo",
  "redo",
  "restoreRevision",
] as const;

export type SemanticOperation = z.infer<typeof SemanticOperationSchema>;
export type WorkspaceOperation = z.infer<typeof WorkspaceOperationSchema>;
export type ProjectOperation = z.infer<typeof ProjectOperationSchema>;
export type FrameOperation = z.infer<typeof FrameOperationSchema>;

export const assertNever = (value: never, context: string): never => {
  const kind = (value as { kind?: unknown }).kind;
  throw new Error(
    `${context} does not handle ${typeof kind === "string" ? kind : "an unknown variant"}.`,
  );
};

export const ActorSchema = z
  .object({
    source: z.enum([
      "studio",
      "http",
      "mcp",
      "filesystem",
      "system",
      "recovery",
    ]),
    id: z.string().min(1).max(128),
    clientId: uuid.optional(),
    sessionId: uuid.optional(),
    connectionId: uuid.optional(),
  })
  .strict();

export type Actor = {
  source: ActorSource;
  id: string;
  clientId?: string;
  sessionId?: string;
  connectionId?: string;
};

export const WorkspaceTransactionScopeSchema = z
  .object({ kind: z.literal("workspace") })
  .strict();
export const ProjectTransactionScopeSchema = z
  .object({ kind: z.literal("project"), projectId: uuid })
  .strict();
export const FrameTransactionScopeSchema = z
  .object({ kind: z.literal("frame"), projectId: uuid, frameId: uuid })
  .strict();
export const TransactionScopeSchema = z.discriminatedUnion("kind", [
  WorkspaceTransactionScopeSchema,
  ProjectTransactionScopeSchema,
  FrameTransactionScopeSchema,
]);

const transactionBase = {
  schemaVersion: z.literal(1),
  mode: z.enum(["preview", "commit"]),
  runtimeId: uuid,
  workspaceId: uuid,
  actor: ActorSchema,
  renderPreview: z.boolean().optional(),
} as const;

export const WorkspaceTransactionRequestSchema = z
  .object({
    ...transactionBase,
    scope: WorkspaceTransactionScopeSchema,
    baseRevision: z.null(),
    operations: z.array(WorkspaceOperationSchema).length(1),
  })
  .strict();
export const ProjectTransactionRequestSchema = z
  .object({
    ...transactionBase,
    scope: ProjectTransactionScopeSchema,
    baseRevision: z.number().int().min(0),
    operations: z.array(ProjectOperationSchema).min(1),
  })
  .strict();
export const FrameTransactionRequestSchema = z
  .object({
    ...transactionBase,
    scope: FrameTransactionScopeSchema,
    baseRevision: z.number().int().min(0),
    operations: z.array(FrameOperationSchema).min(1),
  })
  .strict();

export const TransactionRequestSchema = z.union([
  WorkspaceTransactionRequestSchema,
  ProjectTransactionRequestSchema,
  FrameTransactionRequestSchema,
]);

export type TransactionScope = z.infer<typeof TransactionScopeSchema>;
export type WorkspaceTransactionRequest = z.infer<
  typeof WorkspaceTransactionRequestSchema
>;
export type ProjectTransactionRequest = z.infer<
  typeof ProjectTransactionRequestSchema
>;
export type FrameTransactionRequest = z.infer<
  typeof FrameTransactionRequestSchema
>;
export type TransactionRequest = z.infer<typeof TransactionRequestSchema> & {
  mode: MutationMode;
};

export type StructuredDiffEntry = {
  path: string;
  kind: "added" | "removed" | "changed" | "moved";
  before?: unknown;
  after?: unknown;
};

export type TransactionCommitResult = {
  transactionId: string;
  projectId: string;
  frameId?: string;
  previousRevision: number;
  revision: number;
  status: "committed";
  actor: Actor;
  originSessionId?: string;
  affectedNodes: string[];
  warnings: Array<{ code: string; message: string; nodeIds?: string[] }>;
  historyEntryId: string;
  stateHash: string;
};

export type TransactionPreviewResult = {
  previewId: string;
  workspaceId: string;
  projectId: string;
  frameId?: string;
  baseRevision: number;
  operationHash: string;
  diff: StructuredDiffEntry[];
  warnings: Array<{ code: string; message: string; nodeIds?: string[] }>;
  affectedNodes: string[];
  originSessionId?: string;
  rebase?: {
    fromRevision: number;
    toRevision: number;
    intendedChanges: SemanticChange[];
    interveningChanges: SemanticChange[];
  };
  expiresAt: string;
  previewImageUrl?: string;
};

export type TransactionProposalView = {
  schemaVersion: 1;
  proposalId: string;
  previewId: string;
  state: "open";
  scope: TransactionScope;
  baseRevision: number | null;
  operationHash: string;
  author: Actor;
  operations: SemanticOperation[];
  explanations: string[];
  diff: StructuredDiffEntry[];
  warnings: Array<{ code: string; message: string; nodeIds?: string[] }>;
  affectedNodes: string[];
  expiresAt: string;
  previewImageUrl?: string;
};
