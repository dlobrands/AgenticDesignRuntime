import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  BrandKitRecordSchema,
  BrandKitIndexSchema,
  CreateBrandKitInputSchema,
  RuntimeError,
  createTransform,
  findNode,
  instantiateBrandDefinition,
  sha256,
  stableStringify,
  validateBrandKitReferences,
  type BrandKitRecord,
  type Asset,
  type FontRecord,
  type ApplyBrandInput,
  type CreateBrandKitInput,
  type SemanticOperation,
  type TransactionCommitResult,
  type TransactionPreviewResult,
} from "@agentic-design/core";
import {
  ensureDirectory,
  readJson,
  resolveInside,
  writeJsonAtomic,
} from "./fs-safe.js";
import { resolveRegisteredFile, sha256File } from "./workspace.js";
import type { ProjectState, WorkspaceState } from "./types.js";
import type { TransactionEngine } from "./transaction-engine.js";

const rootFor = (workspace: WorkspaceState): string =>
  path.join(workspace.root, ".design-runtime", "brand-kits");
const revisionDirectory = (
  workspace: WorkspaceState,
  id: string,
  revision: number,
): string => path.join(rootFor(workspace), id, `r${revision}`);
const recordHash = (
  record: Omit<BrandKitRecord, "contentHash">,
): Promise<string> => sha256(stableStringify(record));

export const listBrandKits = (workspace: WorkspaceState): BrandKitRecord[] =>
  [...workspace.brandKits.values()]
    .map((revisions) => revisions.at(-1)!)
    .sort((left, right) => left.name.localeCompare(right.name));

export const requireBrandKit = (
  workspace: WorkspaceState,
  kitId: string,
  revision?: number,
): BrandKitRecord => {
  const revisions = workspace.brandKits.get(kitId);
  const kit = revision
    ? revisions?.find((candidate) => candidate.revision === revision)
    : revisions?.at(-1);
  if (!kit)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Brand Kit revision was not found.",
      { kitId, revision },
      404,
    );
  return kit;
};

export const loadBrandKits = async (
  workspace: WorkspaceState,
): Promise<void> => {
  const root = rootFor(workspace);
  await ensureDirectory(root);
  const indexPath = path.join(root, "index.json");
  const rawIndex = await readJson(indexPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { schemaVersion: 1, kits: [] };
    throw error;
  });
  const index = BrandKitIndexSchema.parse(rawIndex);
  for (const item of index.kits) {
    const revisions: BrandKitRecord[] = [];
    for (const revision of item.revisions) {
      const directory = revisionDirectory(workspace, item.id, revision);
      const record = BrandKitRecordSchema.parse(
        await readJson(path.join(directory, "kit.json")),
      );
      const { contentHash, ...content } = record;
      if ((await recordHash(content)) !== contentHash)
        throw new RuntimeError(
          "HISTORY_HASH_MISMATCH",
          "Brand Kit content hash does not match its immutable record.",
          { kitId: item.id, revision },
        );
      validateBrandKitReferences(record);
      for (const logo of record.logos) {
        const target = await resolveInside(directory, logo.asset.path);
        if ((await sha256File(target)) !== logo.asset.hash)
          throw new RuntimeError(
            "ASSET_HASH_MISMATCH",
            "Brand Kit logo bytes do not match their record.",
            { kitId: item.id, revision },
          );
      }
      for (const role of record.typeRoles) {
        const target = await resolveInside(directory, role.font.path);
        if ((await sha256File(target)) !== role.font.hash)
          throw new RuntimeError(
            "FONT_HASH_MISMATCH",
            "Brand Kit font bytes do not match their record.",
            { kitId: item.id, revision },
          );
      }
      revisions.push(record);
    }
    for (let offset = 0; offset < revisions.length; offset += 1) {
      const record = revisions[offset]!;
      const previous = revisions[offset - 1];
      if (
        record.revision !== offset + 1 ||
        (previous
          ? record.previousRevisionHash !== previous.contentHash
          : record.previousRevisionHash !== undefined)
      )
        throw new RuntimeError(
          "HISTORY_HASH_MISMATCH",
          "Brand Kit revision chain is incomplete or divergent.",
          { kitId: item.id, revision: record.revision },
        );
    }
    workspace.brandKits.set(
      item.id,
      revisions.sort((a, b) => a.revision - b.revision),
    );
  }
};

export const createBrandKitRevision = async (
  workspace: WorkspaceState,
  rawInput: CreateBrandKitInput,
): Promise<BrandKitRecord> => {
  const input = CreateBrandKitInputSchema.parse(rawInput);
  const project = workspace.projects.get(input.sourceProjectId);
  if (!project)
    throw new RuntimeError(
      "PROJECT_FILE_INVALID",
      "Brand Kit source project was not found.",
      undefined,
      404,
    );
  const kitId = input.kitId ?? randomUUID();
  const existing = workspace.brandKits.get(kitId) ?? [];
  const revision = (existing.at(-1)?.revision ?? 0) + 1;
  const previousRevisionHash = existing.at(-1)?.contentHash;
  const directory = revisionDirectory(workspace, kitId, revision);
  if (await stat(directory).catch(() => undefined))
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Brand Kit revision already exists.",
    );
  const temporary = `${directory}.tmp-${randomUUID()}`;
  let promoted = false;
  try {
    await ensureDirectory(path.join(temporary, "assets"));
    await ensureDirectory(path.join(temporary, "fonts"));

    const logos = [];
    for (const requested of input.logos) {
      const asset = project.assets.assets.find(
        (candidate) => candidate.id === requested.assetId,
      );
      if (!asset)
        throw new RuntimeError(
          "ASSET_NOT_FOUND",
          `Source asset ${requested.assetId} was not found.`,
        );
      const source = await resolveRegisteredFile(project, asset, "asset");
      const relative = `assets/${asset.id}${path.extname(asset.path).toLowerCase()}`;
      await copyFile(source, path.join(temporary, relative));
      logos.push({
        ...requested,
        asset: { ...structuredClone(asset), path: relative },
      });
    }
    const typeRoles = [];
    for (const requested of input.typeRoles) {
      const font = project.fonts.fonts.find(
        (candidate) => candidate.id === requested.fontId,
      );
      if (!font)
        throw new RuntimeError(
          "FONT_MISSING",
          `Source font ${requested.fontId} was not found.`,
        );
      const source = await resolveRegisteredFile(project, font, "font");
      const relative = `fonts/${font.id}${path.extname(font.path).toLowerCase()}`;
      await copyFile(source, path.join(temporary, relative));
      typeRoles.push({
        ...requested,
        font: { ...structuredClone(font), path: relative },
        fontId: undefined,
      });
    }
    const createdAt = new Date().toISOString();
    const content = {
      schemaVersion: 1 as const,
      id: kitId,
      revision,
      ...(previousRevisionHash ? { previousRevisionHash } : {}),
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      createdAt,
      createdBy: input.createdBy,
      sourceProjectId: input.sourceProjectId,
      provenance: input.provenance,
      licenseNotes: input.licenseNotes,
      palette: structuredClone(input.palette),
      typeRoles: typeRoles.map(({ fontId: _fontId, ...role }) => role),
      ...(input.effectStyles
        ? { effectStyles: structuredClone(input.effectStyles) }
        : {}),
      ...(input.radiusTokens
        ? { radiusTokens: structuredClone(input.radiusTokens) }
        : {}),
      ...(input.spacingTokens
        ? { spacingTokens: structuredClone(input.spacingTokens) }
        : {}),
      ...(input.variableModes
        ? { variableModes: structuredClone(input.variableModes) }
        : {}),
      logos: logos.map(({ assetId: _assetId, ...logo }) => logo),
      definitions: structuredClone(input.definitions),
    };
    const record = BrandKitRecordSchema.parse({
      ...content,
      contentHash: await recordHash(content),
    });
    validateBrandKitReferences(record);
    await writeJsonAtomic(path.join(temporary, "kit.json"), record);
    await ensureDirectory(path.dirname(directory));
    await rename(temporary, directory);
    promoted = true;

    const indexPath = path.join(rootFor(workspace), "index.json");
    const previousIndex = await readFile(indexPath).catch(() => undefined);
    if (previousIndex)
      await writeJsonAtomic(
        path.join(rootFor(workspace), `index.backup-${Date.now()}.json`),
        JSON.parse(previousIndex.toString("utf8")),
      );
    const next = new Map(workspace.brandKits);
    next.set(kitId, [...existing, record]);
    await writeJsonAtomic(path.join(rootFor(workspace), "index.json"), {
      schemaVersion: 1,
      kits: [...next.entries()].map(([id, revisions]) => ({
        id,
        revisions: revisions.map((item) => item.revision),
      })),
    });
    workspace.brandKits = next;
    return record;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(
      () => undefined,
    );
    if (promoted)
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    throw error;
  }
};

export const brandKitRevisionDirectory = revisionDirectory;

export const pinBrandKitToProject = async (input: {
  workspace: WorkspaceState;
  engine: TransactionEngine;
  project: ProjectState;
  kit: BrandKitRecord;
  baseRevision: number;
  mode: "preview" | "commit";
  actor: { source: "studio" | "http" | "mcp"; id: string };
  migration?: boolean;
}): Promise<TransactionCommitResult | TransactionPreviewResult> => {
  const operations: SemanticOperation[] = [];
  const resourceMap: Record<string, string> = {};
  const createdPaths: string[] = [];
  const directory = revisionDirectory(
    input.workspace,
    input.kit.id,
    input.kit.revision,
  );
  const register = async (
    kind: "asset" | "font",
    sourceRecord:
      | BrandKitRecord["logos"][number]["asset"]
      | BrandKitRecord["typeRoles"][number]["font"],
  ) => {
    const manifest =
      kind === "asset"
        ? input.project.assets.assets
        : input.project.fonts.fonts;
    const duplicate = manifest.find(
      (candidate) => candidate.hash === sourceRecord.hash,
    );
    if (duplicate) {
      resourceMap[sourceRecord.id] = duplicate.id;
      return;
    }
    const digest = (
      await sha256(
        stableStringify({
          projectId: input.project.document.id,
          kitId: input.kit.id,
          resourceId: sourceRecord.id,
          hash: sourceRecord.hash,
        }),
      )
    ).slice("sha256:".length);
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const conflictingId = manifest.find((candidate) => candidate.id === id);
    if (conflictingId)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Brand resource ID collides with different runtime-owned bytes.",
      );
    const relative = `${kind === "asset" ? "assets" : "fonts"}/brand-${input.kit.id}-r${input.kit.revision}-${id}${path.extname(sourceRecord.path)}`;
    const source = await resolveInside(directory, sourceRecord.path);
    const target = await resolveInside(
      input.project.directory,
      relative,
      false,
    );
    await copyFile(source, target, constants.COPYFILE_EXCL);
    if ((await sha256File(target)) !== sourceRecord.hash)
      throw new RuntimeError(
        kind === "asset" ? "ASSET_HASH_MISMATCH" : "FONT_HASH_MISMATCH",
        "Brand Kit resource copy failed verification.",
      );
    createdPaths.push(target);
    resourceMap[sourceRecord.id] = id;
    if (kind === "asset")
      operations.push({
        kind: "importAsset",
        asset: {
          ...structuredClone(sourceRecord as Asset),
          id,
          path: relative,
        },
      });
    else
      operations.push({
        kind: "importFont",
        font: {
          ...structuredClone(sourceRecord as FontRecord),
          id,
          path: relative,
          source: "project",
        },
      });
  };
  try {
    for (const logo of input.kit.logos) await register("asset", logo.asset);
    for (const role of input.kit.typeRoles) await register("font", role.font);
    operations.push({
      kind: input.migration ? "migrateBrandKit" : "pinBrandKit",
      pin: {
        kitId: input.kit.id,
        revision: input.kit.revision,
        contentHash: input.kit.contentHash,
        resourceMap,
      },
    });
    const result = await input.engine.executeVerifiedBrandPin({
      projectId: input.project.document.id,
      baseRevision: input.baseRevision,
      mode: input.mode,
      actor: input.actor,
      operations,
    });
    if (input.mode === "preview")
      await Promise.all(
        createdPaths.map((target) => rm(target, { force: true })),
      );
    return result;
  } catch (error) {
    await Promise.all(
      createdPaths.map((target) => rm(target, { force: true })),
    );
    throw error;
  }
};

export const buildBrandFrameOperations = (
  project: ProjectState,
  frameId: string,
  kit: BrandKitRecord,
  input: ApplyBrandInput,
): SemanticOperation[] => {
  const frame = project.frames.get(frameId);
  const pin = project.document.brandKitPin;
  if (
    !frame ||
    !pin ||
    pin.kitId !== kit.id ||
    pin.revision !== kit.revision ||
    pin.contentHash !== kit.contentHash
  )
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Project is not pinned to this immutable Brand Kit revision.",
    );
  const operations: SemanticOperation[] = [];
  for (const application of input.palette ?? []) {
    const token = kit.palette.find(
      (candidate) => candidate.key === application.token,
    );
    const node = findNode(frame, application.nodeId);
    if (!token || !node)
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Brand palette application target or token was not found.",
      );
    if (
      application.property === "fill" &&
      (node.type === "rectangle" ||
        node.type === "ellipse" ||
        node.type === "vectorPath")
    )
      operations.push({
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "fill",
        value: { fill: { type: "solid", color: token.color, opacity: 1 } },
      });
    else if (application.property === "textColor" && node.type === "text")
      operations.push({
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "typography",
        value: { color: token.color },
      });
    else
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Palette token is incompatible with the selected node.",
      );
  }
  for (const application of input.typeRoles ?? []) {
    const role = kit.typeRoles.find(
      (candidate) => candidate.key === application.role,
    );
    const node = findNode(frame, application.nodeId);
    const fontId = role ? pin.resourceMap[role.font.id] : undefined;
    if (!role || !fontId || node?.type !== "text")
      throw new RuntimeError(
        "INVALID_OPERATION",
        "Brand type role requires a valid text layer and pinned font.",
      );
    const color = role.colorToken
      ? kit.palette.find((candidate) => candidate.key === role.colorToken)
          ?.color
      : undefined;
    operations.push({
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "typography",
      value: {
        fontId,
        fontSize: role.fontSize,
        fontWeight: role.font.weight,
        fontStyle: role.font.style,
        lineHeight: role.lineHeight,
        letterSpacing: role.letterSpacing,
        ...(color ? { color } : {}),
      },
    });
  }
  if (input.logo) {
    const logo = kit.logos.find(
      (candidate) => candidate.key === input.logo!.key,
    );
    const assetId = logo ? pin.resourceMap[logo.asset.id] : undefined;
    if (!logo || !assetId)
      throw new RuntimeError(
        "ASSET_NOT_FOUND",
        "Pinned Brand Kit logo is unavailable.",
      );
    const transform = createTransform({
      x: input.logo.x,
      y: input.logo.y,
      width: input.logo.width ?? logo.asset.width,
      height: input.logo.height ?? logo.asset.height,
    });
    operations.push({
      kind: "createNode",
      parentId: input.logo.parentId,
      ...(input.logo.index === undefined ? {} : { index: input.logo.index }),
      node:
        logo.asset.type === "svg"
          ? {
              id: input.logo.nodeId,
              type: "svg",
              name: logo.name,
              visible: true,
              locked: false,
              transform,
              opacity: 1,
              blendMode: "normal",
              assetId,
              intrinsicSize: {
                width: logo.asset.width,
                height: logo.asset.height,
              },
            }
          : {
              id: input.logo.nodeId,
              type: "rasterImage",
              name: logo.name,
              visible: true,
              locked: false,
              transform,
              opacity: 1,
              blendMode: "normal",
              assetId,
              fit: "contain",
            },
    });
  }
  if (input.definition) {
    const nodes = instantiateBrandDefinition({
      kit,
      definitionKey: input.definition.key,
      idMap: input.definition.idMap,
      resourceMap: pin.resourceMap,
      ...(input.definition.instanceId
        ? { instanceId: input.definition.instanceId }
        : {}),
    });
    nodes.forEach((node, offset) =>
      operations.push({
        kind: "createNode",
        parentId: input.definition!.parentId,
        ...(input.definition!.index === undefined
          ? {}
          : { index: input.definition!.index + offset }),
        node,
      }),
    );
  }
  if (operations.length === 0)
    throw new RuntimeError(
      "INVALID_OPERATION",
      "Brand application contains no changes.",
    );
  return operations;
};
