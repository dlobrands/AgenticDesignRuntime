import path from "node:path";
import {
  AssetManifestSchema,
  FontManifestSchema,
  ProjectDocumentSchema,
  RuntimeError,
  ProjectOperationSchema,
  assertNever,
  createBaselineEntry,
  compileBrandRevisionMigration,
  createFrameDocument,
  listNodes,
  resizeFrameDocument,
  simulateFrameOperations,
  stableStringify,
  type AssetManifest,
  type BrandKitRecord,
  type FontManifest,
  type FrameDocument,
  type HistoryEntry,
  type ProjectDocument,
  type ProjectOperation,
  type SceneNode,
  type SemanticOperation,
} from "@tva-agentic-design/core";
import type { ProjectState } from "./types.js";

export type ProjectSimulation = {
  document: ProjectDocument;
  frames: Map<string, FrameDocument>;
  assets: AssetManifest;
  fonts: FontManifest;
  inverseOperations: SemanticOperation[];
  baselineEntries: HistoryEntry[];
  changedFrameIds: Set<string>;
  label: string;
};

const ensureProjectOperation = (
  operation: SemanticOperation,
): ProjectOperation => {
  if (!ProjectOperationSchema.safeParse(operation).success) {
    throw new RuntimeError(
      "INVALID_OPERATION",
      `${operation.kind} is not project-scoped.`,
    );
  }
  return operation as ProjectOperation;
};

const frameReference = (document: ProjectDocument, frameId: string) => {
  const reference = document.frames.find((frame) => frame.id === frameId);
  if (!reference)
    throw new RuntimeError(
      "FRAME_FILE_INVALID",
      `Frame ${frameId} is not active in the project.`,
      { frameId },
      404,
    );
  return reference;
};

const nodeReferencesFont = (
  node: Extract<SemanticOperation, { kind: "createNode" }>["node"],
  fontId: string,
): boolean => {
  if (node.type === "text" && node.typography.fontId === fontId) return true;
  if (node.type === "group")
    return node.children.some((child) => nodeReferencesFont(child, fontId));
  if (node.type === "mask")
    return (
      nodeReferencesFont(node.maskSource, fontId) ||
      node.children.some((child) => nodeReferencesFont(child, fontId))
    );
  return false;
};

const operationReferencesFont = (
  operation: SemanticOperation,
  fontId: string,
): boolean =>
  (operation.kind === "createNode" &&
    nodeReferencesFont(operation.node, fontId)) ||
  (operation.kind === "updateNode" &&
    operation.propertyGroup === "typography" &&
    operation.value.fontId === fontId);

const historyReferencesFont = (entry: HistoryEntry, fontId: string): boolean =>
  Boolean(
    entry.baseline &&
    listNodes(entry.baseline).some(
      (node) => node.type === "text" && node.typography.fontId === fontId,
    ),
  ) ||
  [...entry.operations, ...entry.inverseOperations].some((operation) =>
    operationReferencesFont(operation, fontId),
  );

export const simulateProjectOperations = async (input: {
  project: ProjectState;
  operations: readonly SemanticOperation[];
  now: string;
  historyEntryIds: () => { id: string; transactionId: string };
  brandKits?: readonly BrandKitRecord[];
}): Promise<ProjectSimulation> => {
  const document = structuredClone(input.project.document);
  const frames = new Map(
    [...input.project.frames].map(([id, frame]) => [
      id,
      structuredClone(frame),
    ]),
  );
  const assets = structuredClone(input.project.assets);
  const fonts = structuredClone(input.project.fonts);
  let inverseOperations: SemanticOperation[] = [];
  const baselineEntries: HistoryEntry[] = [];
  const changedFrameIds = new Set<string>();
  let label = "Changed project";

  for (const rawOperation of input.operations) {
    const operation = ensureProjectOperation(rawOperation);
    let inverse: SemanticOperation[];
    switch (operation.kind) {
      case "renameProject":
        inverse = [{ kind: "renameProject", name: document.name }];
        document.name = operation.name;
        label = `Renamed project to “${operation.name}”`;
        break;
      case "setExportPreset": {
        const presets = document.exportPresets ?? [];
        const existing = presets.find(
          (preset) => preset.id === operation.preset.id,
        );
        const duplicateName = presets.find(
          (preset) =>
            preset.id !== operation.preset.id &&
            preset.name.localeCompare(operation.preset.name, undefined, {
              sensitivity: "accent",
            }) === 0,
        );
        if (duplicateName)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `An export preset named “${operation.preset.name}” already exists.`,
          );
        if (!existing && presets.length >= 40)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "A project can contain at most 40 export presets.",
          );
        inverse = existing
          ? [{ kind: "setExportPreset", preset: structuredClone(existing) }]
          : [{ kind: "removeExportPreset", presetId: operation.preset.id }];
        document.exportPresets = existing
          ? presets.map((preset) =>
              preset.id === operation.preset.id
                ? structuredClone(operation.preset)
                : preset,
            )
          : [...presets, structuredClone(operation.preset)];
        label = `${existing ? "Updated" : "Created"} export preset “${operation.preset.name}”`;
        break;
      }
      case "removeExportPreset": {
        const existing = document.exportPresets?.find(
          (preset) => preset.id === operation.presetId,
        );
        if (!existing)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Export preset ${operation.presetId} was not found.`,
          );
        inverse = [
          { kind: "setExportPreset", preset: structuredClone(existing) },
        ];
        document.exportPresets = document.exportPresets?.filter(
          (preset) => preset.id !== operation.presetId,
        );
        label = `Removed export preset “${existing.name}”`;
        break;
      }
      case "setProjectTemplate": {
        const templates = document.templates ?? [];
        const existing = templates.find(
          (template) => template.id === operation.template.id,
        );
        const duplicateName = templates.find(
          (template) =>
            template.id !== operation.template.id &&
            template.name.localeCompare(operation.template.name, undefined, {
              sensitivity: "accent",
            }) === 0,
        );
        if (duplicateName)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `A project template named “${operation.template.name}” already exists.`,
          );
        if (!existing && templates.length >= 100)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "A project can contain at most 100 templates.",
          );
        const referencedAssetIds = new Set<string>();
        const referencedFontIds = new Set<string>();
        const visit = (node: SceneNode): void => {
          if (node.type === "rasterImage" || node.type === "svg")
            referencedAssetIds.add(node.assetId);
          if (node.type === "text") {
            referencedFontIds.add(node.typography.fontId);
            node.spans?.forEach((span) => {
              if (span.style.fontId) referencedFontIds.add(span.style.fontId);
            });
          }
          if (node.type === "group") node.children.forEach(visit);
          if (node.type === "mask") {
            visit(node.maskSource);
            node.children.forEach(visit);
          }
        };
        operation.template.nodes.forEach(visit);
        if (
          [...referencedAssetIds].some(
            (assetId) => !assets.assets.some((asset) => asset.id === assetId),
          )
        )
          throw new RuntimeError(
            "ASSET_NOT_FOUND",
            "Project template references an unavailable asset.",
          );
        if (
          [...referencedFontIds].some(
            (fontId) => !fonts.fonts.some((font) => font.id === fontId),
          )
        )
          throw new RuntimeError(
            "FONT_MISSING",
            "Project template references an unavailable font.",
          );
        inverse = existing
          ? [
              {
                kind: "setProjectTemplate",
                template: structuredClone(existing),
              },
            ]
          : [
              {
                kind: "removeProjectTemplate",
                templateId: operation.template.id,
              },
            ];
        document.templates = existing
          ? templates.map((template) =>
              template.id === operation.template.id
                ? structuredClone(operation.template)
                : template,
            )
          : [...templates, structuredClone(operation.template)];
        label = `${existing ? "Updated" : "Created"} project template “${operation.template.name}”`;
        break;
      }
      case "removeProjectTemplate": {
        const existing = document.templates?.find(
          (template) => template.id === operation.templateId,
        );
        if (!existing)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Project template ${operation.templateId} was not found.`,
          );
        inverse = [
          { kind: "setProjectTemplate", template: structuredClone(existing) },
        ];
        document.templates = document.templates?.filter(
          (template) => template.id !== operation.templateId,
        );
        label = `Removed project template “${existing.name}”`;
        break;
      }
      case "setDesignBrief": {
        const briefs = document.designBriefs ?? [];
        const existing = briefs.find(
          (brief) => brief.id === operation.brief.id,
        );
        const duplicateName = briefs.find(
          (brief) =>
            brief.id !== operation.brief.id &&
            brief.name.localeCompare(operation.brief.name, undefined, {
              sensitivity: "accent",
            }) === 0,
        );
        if (duplicateName)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `A design brief named “${operation.brief.name}” already exists.`,
          );
        if (!existing && briefs.length >= 100)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "A project can contain at most 100 design briefs.",
          );
        const unavailableAsset = operation.brief.assetRequirements.find(
          (requirement) =>
            requirement.assetId &&
            !assets.assets.some((asset) => asset.id === requirement.assetId),
        );
        if (unavailableAsset)
          throw new RuntimeError(
            "ASSET_NOT_FOUND",
            `Design brief asset requirement ${unavailableAsset.id} references an unavailable asset.`,
          );
        const briefKit = operation.brief.brandContext.brandKit;
        if (
          briefKit &&
          !input.brandKits?.some(
            (kit) =>
              kit.id === briefKit.kitId && kit.revision === briefKit.revision,
          )
        )
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Design brief references unavailable Brand Kit ${briefKit.kitId} r${briefKit.revision}.`,
          );
        const copyIds = new Set(
          [
            ...operation.brief.requiredCopy,
            ...operation.brief.optionalCopy,
          ].map((item) => item.id),
        );
        const dependentPlan = document.designPlans?.find(
          (plan) =>
            plan.briefId === operation.brief.id &&
            plan.semanticRoles.some(
              (role) => role.copyItemId && !copyIds.has(role.copyItemId),
            ),
        );
        if (dependentPlan)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Design brief cannot remove copy referenced by design plan “${dependentPlan.name}”.`,
          );
        inverse = existing
          ? [{ kind: "setDesignBrief", brief: structuredClone(existing) }]
          : [{ kind: "removeDesignBrief", briefId: operation.brief.id }];
        document.designBriefs = existing
          ? briefs.map((brief) =>
              brief.id === operation.brief.id
                ? structuredClone(operation.brief)
                : brief,
            )
          : [...briefs, structuredClone(operation.brief)];
        label = `${existing ? "Updated" : "Created"} design brief “${operation.brief.name}”`;
        break;
      }
      case "removeDesignBrief": {
        const existing = document.designBriefs?.find(
          (brief) => brief.id === operation.briefId,
        );
        if (!existing)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Design brief ${operation.briefId} was not found.`,
          );
        const dependentPlan = document.designPlans?.find(
          (plan) => plan.briefId === operation.briefId,
        );
        if (dependentPlan)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Design brief is referenced by design plan “${dependentPlan.name}” and cannot be removed.`,
          );
        inverse = [
          { kind: "setDesignBrief", brief: structuredClone(existing) },
        ];
        document.designBriefs = document.designBriefs?.filter(
          (brief) => brief.id !== operation.briefId,
        );
        label = `Removed design brief “${existing.name}”`;
        break;
      }
      case "setDesignPlan": {
        const plans = document.designPlans ?? [];
        const existing = plans.find((plan) => plan.id === operation.plan.id);
        const duplicateName = plans.find(
          (plan) =>
            plan.id !== operation.plan.id &&
            plan.name.localeCompare(operation.plan.name, undefined, {
              sensitivity: "accent",
            }) === 0,
        );
        if (duplicateName)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `A design plan named “${operation.plan.name}” already exists.`,
          );
        if (!existing && plans.length >= 100)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "A project can contain at most 100 design plans.",
          );
        const brief = operation.plan.briefId
          ? document.designBriefs?.find(
              (candidate) => candidate.id === operation.plan.briefId,
            )
          : undefined;
        if (operation.plan.briefId && !brief)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Design plan references unavailable brief ${operation.plan.briefId}.`,
          );
        const copyIds = new Set(
          brief
            ? [...brief.requiredCopy, ...brief.optionalCopy].map(
                (item) => item.id,
              )
            : [],
        );
        const unavailableCopy = operation.plan.semanticRoles.find(
          (role) => role.copyItemId && !copyIds.has(role.copyItemId),
        );
        if (unavailableCopy)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Design plan role ${unavailableCopy.key} references unavailable brief copy ${unavailableCopy.copyItemId}.`,
          );
        if (operation.plan.targetFrameId)
          frameReference(document, operation.plan.targetFrameId);
        const targetFrame = operation.plan.targetFrameId
          ? frames.get(operation.plan.targetFrameId)
          : undefined;
        if (operation.plan.targetFrameId && !targetFrame)
          throw new RuntimeError(
            "FRAME_FILE_INVALID",
            `Design plan target frame ${operation.plan.targetFrameId} is unavailable.`,
          );
        const nodeIds = new Set(
          targetFrame ? listNodes(targetFrame).map((node) => node.id) : [],
        );
        const referencedNodeIds = [
          ...operation.plan.semanticRoles.map((role) => role.nodeId),
          ...operation.plan.constraints.map((constraint) => constraint.nodeId),
          ...operation.plan.protectedDecisions.map(
            (decision) => decision.nodeId,
          ),
        ].filter((nodeId): nodeId is string => Boolean(nodeId));
        const unavailableNodeId = referencedNodeIds.find(
          (nodeId) => !nodeIds.has(nodeId),
        );
        if (unavailableNodeId)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Design plan references unavailable target-frame node ${unavailableNodeId}.`,
          );
        const unavailableAsset = operation.plan.assetAssignments.find(
          (assignment) =>
            !assets.assets.some((asset) => asset.id === assignment.assetId),
        );
        if (unavailableAsset)
          throw new RuntimeError(
            "ASSET_NOT_FOUND",
            `Design plan asset assignment ${unavailableAsset.id} references unavailable asset ${unavailableAsset.assetId}.`,
          );
        inverse = existing
          ? [{ kind: "setDesignPlan", plan: structuredClone(existing) }]
          : [{ kind: "removeDesignPlan", planId: operation.plan.id }];
        document.designPlans = existing
          ? plans.map((plan) =>
              plan.id === operation.plan.id
                ? structuredClone(operation.plan)
                : plan,
            )
          : [...plans, structuredClone(operation.plan)];
        label = `${existing ? "Updated" : "Created"} design plan “${operation.plan.name}”`;
        break;
      }
      case "removeDesignPlan": {
        const existing = document.designPlans?.find(
          (plan) => plan.id === operation.planId,
        );
        if (!existing)
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Design plan ${operation.planId} was not found.`,
          );
        inverse = [{ kind: "setDesignPlan", plan: structuredClone(existing) }];
        document.designPlans = document.designPlans?.filter(
          (plan) => plan.id !== operation.planId,
        );
        label = `Removed design plan “${existing.name}”`;
        break;
      }
      case "createFrame": {
        if (
          document.frames.some(
            (frame) =>
              frame.slug === operation.slug || frame.id === operation.frameId,
          )
        ) {
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Frame slug or ID is already reserved.",
            { frameId: operation.frameId, slug: operation.slug },
          );
        }
        const retained = frames.get(operation.frameId);
        if (retained && retained.slug !== operation.slug) {
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Frame ${operation.frameId} reserves slug ${retained.slug}.`,
          );
        }
        if (
          !retained &&
          [...frames.values()].some((frame) => frame.slug === operation.slug)
        ) {
          throw new RuntimeError(
            "INVALID_OPERATION",
            `Frame slug ${operation.slug} is reserved by retained history.`,
          );
        }
        const frame =
          retained ??
          createFrameDocument({
            id: operation.frameId,
            slug: operation.slug,
            name: operation.name,
            width: operation.width,
            height: operation.height,
            now: input.now,
          });
        frame.name = operation.name;
        frames.set(frame.id, frame);
        document.frames.push({
          id: frame.id,
          slug: frame.slug,
          name: frame.name,
          path: `frames/${frame.slug}.json`,
        });
        document.frameOrder.push(frame.id);
        inverse = [{ kind: "deleteFrame", frameId: frame.id }];
        changedFrameIds.add(frame.id);
        if (!retained) {
          const ids = input.historyEntryIds();
          baselineEntries.push(
            await createBaselineEntry({
              ...ids,
              projectId: document.id,
              frame,
              timestamp: input.now,
            }),
          );
        }
        label = `Created frame “${frame.name}”`;
        break;
      }
      case "duplicateFrame": {
        const source = frames.get(operation.frameId);
        if (!source)
          throw new RuntimeError(
            "FRAME_FILE_INVALID",
            `Source frame ${operation.frameId} was not found.`,
          );
        if (
          document.frames.some(
            (frame) =>
              frame.slug === operation.slug ||
              frame.id === operation.newFrameId,
          ) ||
          [...frames.values()].some(
            (frame) =>
              frame.slug === operation.slug ||
              frame.id === operation.newFrameId,
          )
        ) {
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Duplicate frame slug or ID is already reserved.",
          );
        }
        const duplicate = operation.resize
          ? resizeFrameDocument({
              frame: source,
              width: operation.resize.width,
              height: operation.resize.height,
              strategy: operation.resize.strategy,
            })
          : structuredClone(source);
        duplicate.id = operation.newFrameId;
        duplicate.slug = operation.slug;
        duplicate.name = operation.name;
        duplicate.revision = 0;
        duplicate.createdAt = input.now;
        duplicate.updatedAt = input.now;
        frames.set(duplicate.id, duplicate);
        document.frames.push({
          id: duplicate.id,
          slug: duplicate.slug,
          name: duplicate.name,
          path: `frames/${duplicate.slug}.json`,
        });
        document.frameOrder.push(duplicate.id);
        inverse = [{ kind: "deleteFrame", frameId: duplicate.id }];
        changedFrameIds.add(duplicate.id);
        const ids = input.historyEntryIds();
        baselineEntries.push(
          await createBaselineEntry({
            ...ids,
            projectId: document.id,
            frame: duplicate,
            timestamp: input.now,
          }),
        );
        label = `Duplicated frame “${source.name}”`;
        break;
      }
      case "renameFrame": {
        const reference = frameReference(document, operation.frameId);
        const frame = frames.get(operation.frameId)!;
        inverse = [
          {
            kind: "renameFrame",
            frameId: operation.frameId,
            name: reference.name,
          },
        ];
        reference.name = operation.name;
        frame.name = operation.name;
        frame.updatedAt = input.now;
        changedFrameIds.add(frame.id);
        label = `Renamed frame to “${operation.name}”`;
        break;
      }
      case "reorderFrame": {
        const ids = new Set(document.frames.map((frame) => frame.id));
        if (
          operation.frameOrder.length !== ids.size ||
          operation.frameOrder.some((id) => !ids.has(id))
        ) {
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Frame order must include each active frame exactly once.",
          );
        }
        inverse = [
          { kind: "reorderFrame", frameOrder: [...document.frameOrder] },
        ];
        document.frameOrder = [...operation.frameOrder];
        label = "Reordered frames";
        break;
      }
      case "deleteFrame": {
        const reference = frameReference(document, operation.frameId);
        const frame = frames.get(operation.frameId)!;
        inverse = [
          {
            kind: "createFrame",
            frameId: frame.id,
            slug: frame.slug,
            name: frame.name,
            width: frame.canvas.width,
            height: frame.canvas.height,
          },
        ];
        document.frames = document.frames.filter(
          (candidate) => candidate.id !== operation.frameId,
        );
        document.frameOrder = document.frameOrder.filter(
          (id) => id !== operation.frameId,
        );
        label = `Deleted frame “${reference.name}”`;
        break;
      }
      case "importAsset": {
        const duplicate = assets.assets.find(
          (asset) => asset.hash === operation.asset.hash,
        );
        if (!duplicate) assets.assets.push(structuredClone(operation.asset));
        inverse = [];
        label = `Imported “${path.basename(operation.asset.path)}”`;
        break;
      }
      case "importFont": {
        const duplicate = fonts.fonts.find(
          (font) => font.hash === operation.font.hash,
        );
        if (!duplicate) fonts.fonts.push(structuredClone(operation.font));
        inverse = duplicate
          ? []
          : [{ kind: "removeFont", fontId: operation.font.id }];
        label = `Imported “${operation.font.family}”`;
        break;
      }
      case "removeFont": {
        const font = fonts.fonts.find(
          (candidate) => candidate.id === operation.fontId,
        );
        if (!font)
          throw new RuntimeError(
            "FONT_MISSING",
            `Font ${operation.fontId} was not found.`,
          );
        const isUsed =
          [...frames.values()].some((frame) =>
            listNodes(frame).some(
              (node) =>
                node.type === "text" &&
                node.typography.fontId === operation.fontId,
            ),
          ) ||
          input.project.history.some((entry) =>
            historyReferencesFont(entry, operation.fontId),
          ) ||
          Object.values(document.brandKitPin?.resourceMap ?? {}).includes(
            operation.fontId,
          );
        if (isUsed)
          throw new RuntimeError(
            "FONT_IN_USE",
            `${font.family} is referenced by current or historical artwork, or by the pinned Brand Kit.`,
          );
        fonts.fonts = fonts.fonts.filter(
          (candidate) => candidate.id !== operation.fontId,
        );
        inverse = [{ kind: "importFont", font }];
        label = `Removed “${font.family}”`;
        break;
      }
      case "pinBrandKit": {
        const kit = input.brandKits?.find(
          (candidate) =>
            candidate.id === operation.pin.kitId &&
            candidate.revision === operation.pin.revision,
        );
        if (!kit || kit.contentHash !== operation.pin.contentHash)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "The requested immutable Brand Kit revision is unavailable or does not match its hash.",
          );
        const resources = [
          ...kit.logos.map((logo) => ({
            id: logo.asset.id,
            hash: logo.asset.hash,
            target: assets.assets.find(
              (asset) => asset.id === operation.pin.resourceMap[logo.asset.id],
            ),
          })),
          ...kit.typeRoles.map((role) => ({
            id: role.font.id,
            hash: role.font.hash,
            target: fonts.fonts.find(
              (font) => font.id === operation.pin.resourceMap[role.font.id],
            ),
          })),
        ];
        if (
          resources.some((resource) => resource.target?.hash !== resource.hash)
        )
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Brand Kit resource mapping was not verified against runtime-owned bytes.",
          );
        inverse = document.brandKitPin
          ? [
              {
                kind: "pinBrandKit",
                pin: structuredClone(document.brandKitPin),
              },
            ]
          : [{ kind: "unpinBrandKit" }];
        document.brandKitPin = structuredClone(operation.pin);
        label = `Pinned Brand Kit “${kit.name}” r${kit.revision}`;
        break;
      }
      case "migrateBrandKit": {
        const currentPin = document.brandKitPin;
        if (!currentPin)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Project must have an exact Brand Kit pin before it can migrate revisions.",
          );
        if (
          currentPin.kitId !== operation.pin.kitId ||
          currentPin.revision === operation.pin.revision
        )
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Brand migration requires a different immutable revision in the same kit lineage.",
          );
        const currentKit = input.brandKits?.find(
          (candidate) =>
            candidate.id === currentPin.kitId &&
            candidate.revision === currentPin.revision &&
            candidate.contentHash === currentPin.contentHash,
        );
        const targetKit = input.brandKits?.find(
          (candidate) =>
            candidate.id === operation.pin.kitId &&
            candidate.revision === operation.pin.revision &&
            candidate.contentHash === operation.pin.contentHash,
        );
        if (!currentKit || !targetKit)
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Current or target immutable Brand Kit revision is unavailable or hash-mismatched.",
          );
        const resources = [
          ...targetKit.logos.map((logo) => ({
            id: logo.asset.id,
            hash: logo.asset.hash,
            target: assets.assets.find(
              (asset) => asset.id === operation.pin.resourceMap[logo.asset.id],
            ),
          })),
          ...targetKit.typeRoles.map((role) => ({
            id: role.font.id,
            hash: role.font.hash,
            target: fonts.fonts.find(
              (font) => font.id === operation.pin.resourceMap[role.font.id],
            ),
          })),
        ];
        if (
          resources.some((resource) => resource.target?.hash !== resource.hash)
        )
          throw new RuntimeError(
            "INVALID_OPERATION",
            "Target Brand Kit resources were not verified against runtime-owned bytes.",
          );
        for (const frameId of document.frameOrder) {
          const frame = frames.get(frameId);
          if (!frame)
            throw new RuntimeError(
              "FRAME_FILE_INVALID",
              `Frame ${frameId} is unavailable for Brand migration.`,
            );
          const plan = compileBrandRevisionMigration({
            frame,
            currentPin,
            currentKit,
            targetPin: operation.pin,
            targetKit,
          });
          if (plan.operations.length === 0) continue;
          const migrated = simulateFrameOperations(frame, plan.operations, {
            nextRevision: frame.revision + 1,
            now: input.now,
          }).frame;
          frames.set(frameId, migrated);
          changedFrameIds.add(frameId);
        }
        inverse = [
          { kind: "migrateBrandKit", pin: structuredClone(currentPin) },
        ];
        document.brandKitPin = structuredClone(operation.pin);
        label = `Migrated Brand Kit “${targetKit.name}” to r${targetKit.revision}`;
        break;
      }
      case "unpinBrandKit":
        inverse = document.brandKitPin
          ? [
              {
                kind: "pinBrandKit",
                pin: structuredClone(document.brandKitPin),
              },
            ]
          : [];
        document.brandKitPin = undefined;
        label = "Detached Brand Kit";
        break;
      case "undo":
      case "redo":
        throw new RuntimeError(
          "INVALID_OPERATION",
          `${operation.kind} must be resolved by the project history service before simulation.`,
        );
      default:
        return assertNever(operation, "project operation simulation switch");
    }
    inverseOperations = [...inverse, ...inverseOperations];
  }

  document.revision += 1;
  document.updatedAt = input.now;
  ProjectDocumentSchema.parse(document);
  AssetManifestSchema.parse(assets);
  FontManifestSchema.parse(fonts);
  return {
    document,
    frames,
    assets,
    fonts,
    inverseOperations,
    baselineEntries,
    changedFrameIds,
    label,
  };
};

export const projectFileTargets = (
  project: ProjectState,
  simulation: ProjectSimulation,
) => {
  const targets: Array<{ targetPath: string; after: unknown }> = [
    {
      targetPath: path.join(project.directory, "project.json"),
      after: simulation.document,
    },
  ];
  if (stableStringify(project.assets) !== stableStringify(simulation.assets)) {
    targets.push({
      targetPath: path.join(project.directory, "assets", "assets.json"),
      after: simulation.assets,
    });
  }
  if (stableStringify(project.fonts) !== stableStringify(simulation.fonts)) {
    targets.push({
      targetPath: path.join(project.directory, "fonts", "fonts.json"),
      after: simulation.fonts,
    });
  }
  for (const frameId of simulation.changedFrameIds) {
    const frame = simulation.frames.get(frameId);
    if (frame)
      targets.push({
        targetPath: path.join(
          project.directory,
          "frames",
          `${frame.slug}.json`,
        ),
        after: frame,
      });
  }
  return targets;
};
