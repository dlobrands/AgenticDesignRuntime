import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import {
  RuntimeError,
  exportDimensions,
  exportSupportsTransparency,
  normalizeExportSettings,
  semanticFrameHash,
  type ExportSettings,
  type FrameDocument,
  type TextNode,
} from "@tva-agentic-design/core";
import { writeFileAtomic } from "./fs-safe.js";
import type { ProjectState, WorkspaceState } from "./types.js";
import { PRODUCT_VERSION, REFERENCE_VERSIONS } from "./version.js";

export type RenderResult = {
  bytes: Buffer;
  width: number;
  height: number;
  revision: number;
  sceneHash: string;
  durationMs: number;
  warnings: Array<{ code: string; message: string; nodeIds?: string[] }>;
  versions: { runtime: string; chromium: string; pixi: string };
  resourceStats: {
    activeRenderers: number;
    completedRenders: number;
    maxActiveRenderers: number;
  };
};

export type ExportResult = Omit<RenderResult, "bytes"> & {
  path: string;
  format: ExportSettings["format"];
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  scale: number;
  quality?: number;
  transparent: boolean;
  sizeBytes: number;
};

type WorkerRenderResponse = {
  dataUrl: string;
  width: number;
  height: number;
  warnings: Array<{ code: string; message: string; nodeIds?: string[] }>;
  resourceStats: RenderResult["resourceStats"];
};

export type RendererCapabilityReport = {
  maxTextureSize: number;
  maxRenderbufferSize: number;
  maxCanvasDimension: number;
};

export const exportRelativePath = (
  frame: Pick<FrameDocument, "slug" | "revision">,
  settings: ExportSettings,
): string => {
  const extension = settings.format === "jpeg" ? "jpg" : settings.format;
  const scaleSuffix = settings.scale === 1 ? "" : `-${settings.scale}x`;
  const qualitySuffix =
    settings.format === "png" ? "" : `-q${settings.quality ?? 90}`;
  const matteSuffix =
    settings.format === "jpeg"
      ? `-m${(settings.matteColor ?? "#FFFFFF").slice(1).toLowerCase()}`
      : "";
  return `exports/${frame.slug}-r${frame.revision}${scaleSuffix}${qualitySuffix}${matteSuffix}.${extension}`;
};

export class ChromiumExportWorker {
  readonly workspace: WorkspaceState;
  #browser?: Browser;
  #page?: Page;
  #baseUrl?: string;
  #preparePromise?: Promise<void>;
  #operations: Promise<void> = Promise.resolve();

  constructor(workspace: WorkspaceState) {
    this.workspace = workspace;
  }

  assertExportSupported(
    frame: FrameDocument,
    input?: Partial<ExportSettings>,
  ): ExportSettings {
    const settings = normalizeExportSettings(input);
    const dimensions = exportDimensions(frame, settings);
    const maximumDimension = Math.min(
      this.workspace.capabilities.maxCanvasDimension,
      this.workspace.capabilities.maxTextureSize,
      this.workspace.capabilities.maxRenderbufferSize,
    );
    if (
      dimensions.width > maximumDimension ||
      dimensions.height > maximumDimension
    )
      throw new RuntimeError(
        "EXPORT_BLOCKED",
        `Scaled export ${dimensions.width}x${dimensions.height} exceeds the detected ${maximumDimension}px renderer limit.`,
        { dimensions, maximumDimension, scale: settings.scale },
        409,
      );
    return settings;
  }

  async prepare(baseUrl: string): Promise<void> {
    this.#baseUrl = baseUrl;
    if (this.#page && !this.#page.isClosed()) return;
    if (!this.#preparePromise)
      this.#preparePromise = (async () => {
        try {
          this.#browser ??= await chromium.launch({ headless: true });
          this.#page = await this.#browser.newPage({
            viewport: { width: 1280, height: 800 },
            deviceScaleFactor: 1,
            colorScheme: "dark",
            extraHTTPHeaders: {
              authorization: `Bearer ${this.workspace.capabilityToken}`,
              "x-design-runtime-id": this.workspace.runtimeId,
              "x-design-workspace-id": this.workspace.config.workspaceId,
            },
          });
          await this.#page.goto(`${baseUrl}/render-worker.html`, {
            waitUntil: "networkidle",
          });
          await this.#page.waitForFunction(
            () =>
              typeof (window as unknown as { agenticRender?: unknown })
                .agenticRender === "function",
          );
        } catch (error) {
          await this.close();
          throw new RuntimeError(
            "EXPORT_FAILED",
            `Pinned Chromium export worker could not start: ${error instanceof Error ? error.message : String(error)}`,
            undefined,
            503,
          );
        }
      })().finally(() => {
        this.#preparePromise = undefined;
      });
    await this.#preparePromise;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operations.then(operation, operation);
    this.#operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async render(
    project: ProjectState,
    frame: FrameDocument,
    scale = 1,
  ): Promise<RenderResult> {
    if (!this.#baseUrl)
      throw new RuntimeError(
        "EXPORT_FAILED",
        "Export worker has not been prepared.",
        undefined,
        503,
      );
    const started = performance.now();
    return this.#enqueue(async () => {
      await this.prepare(this.#baseUrl!);
      try {
        const response = await this.#page!.evaluate(
          async ({ projectId, frameId, scale: requestedScale }) => {
            const runtimeWindow = window as unknown as {
              agenticRender: (input: {
                projectId: string;
                frameId: string;
                scale?: number;
              }) => Promise<WorkerRenderResponse>;
            };
            return runtimeWindow.agenticRender({
              projectId,
              frameId,
              scale: requestedScale,
            });
          },
          { projectId: project.document.id, frameId: frame.id, scale },
        );
        const match = /^data:image\/png;base64,(.+)$/.exec(response.dataUrl);
        if (!match)
          throw new Error("Renderer returned an invalid PNG data URL.");
        const bytes = Buffer.from(match[1]!, "base64");
        const metadata = await sharp(bytes).metadata();
        if (
          metadata.format !== "png" ||
          metadata.width !== response.width ||
          metadata.height !== response.height
        ) {
          throw new Error(
            `Expected ${response.width}x${response.height} PNG, received ${metadata.width ?? 0}x${metadata.height ?? 0}.`,
          );
        }
        return {
          bytes,
          width: response.width,
          height: response.height,
          revision: frame.revision,
          sceneHash: await semanticFrameHash(frame),
          durationMs: performance.now() - started,
          warnings: response.warnings,
          resourceStats: response.resourceStats,
          versions: {
            runtime: PRODUCT_VERSION,
            chromium: this.#browser!.version(),
            pixi: REFERENCE_VERSIONS.pixi,
          },
        };
      } catch (error) {
        await this.#page?.close().catch(() => undefined);
        this.#page = undefined;
        throw new RuntimeError(
          "EXPORT_FAILED",
          `Frame render failed: ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          500,
        );
      }
    });
  }

  async capabilities(): Promise<RendererCapabilityReport> {
    if (!this.#baseUrl)
      throw new RuntimeError(
        "EXPORT_FAILED",
        "Export worker has not been prepared.",
        undefined,
        503,
      );
    return this.#enqueue(async () => {
      await this.prepare(this.#baseUrl!);
      try {
        return await this.#page!.evaluate(() => {
          const runtimeWindow = window as unknown as {
            agenticCapabilities: () => RendererCapabilityReport;
          };
          return runtimeWindow.agenticCapabilities();
        });
      } catch (error) {
        throw new RuntimeError(
          "EXPORT_FAILED",
          `Renderer capability detection failed: ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          503,
        );
      }
    });
  }

  async measureText(
    projectId: string,
    nodes: readonly TextNode[],
  ): Promise<
    Array<{ nodeId: string; width: number; height: number; lines: number }>
  > {
    if (!this.#baseUrl)
      throw new RuntimeError(
        "EXPORT_FAILED",
        "Export worker has not been prepared.",
        undefined,
        503,
      );
    return this.#enqueue(async () => {
      await this.prepare(this.#baseUrl!);
      try {
        return await this.#page!.evaluate(
          async ({ projectId: requestedProjectId, nodes: requestedNodes }) => {
            const runtimeWindow = window as unknown as {
              agenticMeasureText: (input: {
                projectId: string;
                nodes: TextNode[];
              }) => Promise<
                Array<{
                  nodeId: string;
                  width: number;
                  height: number;
                  lines: number;
                }>
              >;
            };
            return runtimeWindow.agenticMeasureText({
              projectId: requestedProjectId,
              nodes: requestedNodes,
            });
          },
          { projectId, nodes: structuredClone([...nodes]) },
        );
      } catch (error) {
        await this.#page?.close().catch(() => undefined);
        this.#page = undefined;
        throw new RuntimeError(
          "EXPORT_FAILED",
          `Text measurement failed: ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          500,
        );
      }
    });
  }

  async export(
    project: ProjectState,
    frame: FrameDocument,
    input?: Partial<ExportSettings>,
  ): Promise<ExportResult> {
    const started = performance.now();
    const settings = this.assertExportSupported(frame, input);
    const dimensions = exportDimensions(frame, settings);
    const result = await this.render(project, frame, settings.scale);
    const blockingOverflow = result.warnings.find(
      (warning) => warning.code === "TEXT_OVERFLOW",
    );
    if (blockingOverflow)
      throw new RuntimeError(
        "EXPORT_BLOCKED",
        blockingOverflow.message,
        { nodeIds: blockingOverflow.nodeIds },
        409,
      );
    let bytes = result.bytes;
    if (settings.format !== "png") {
      let pipeline = sharp(result.bytes);
      if (settings.format === "jpeg")
        pipeline = pipeline
          .flatten({ background: settings.matteColor ?? "#FFFFFF" })
          .jpeg({ quality: settings.quality });
      else if (settings.format === "webp")
        pipeline = pipeline.webp({ quality: settings.quality });
      else pipeline = pipeline.png();
      bytes = await pipeline.toBuffer();
    }
    const metadata = await sharp(bytes).metadata();
    const expectedFormat =
      settings.format === "jpeg" ? "jpeg" : settings.format;
    const transparent = exportSupportsTransparency(frame, settings);
    if (
      metadata.format !== expectedFormat ||
      metadata.width !== dimensions.width ||
      metadata.height !== dimensions.height ||
      (settings.format === "jpeg" && metadata.hasAlpha) ||
      (transparent && !metadata.hasAlpha)
    )
      throw new RuntimeError(
        "EXPORT_FAILED",
        `Encoded ${settings.format.toUpperCase()} did not satisfy the requested ${dimensions.width}x${dimensions.height} output contract.`,
        {
          expected: {
            format: expectedFormat,
            width: dimensions.width,
            height: dimensions.height,
            transparent,
          },
          actual: {
            format: metadata.format,
            width: metadata.width,
            height: metadata.height,
            hasAlpha: metadata.hasAlpha,
          },
        },
        500,
      );
    const relativePath = exportRelativePath(frame, settings);
    await writeFileAtomic(path.join(project.directory, relativePath), bytes, {
      mode: 0o600,
    });
    const mimeType =
      settings.format === "jpeg"
        ? "image/jpeg"
        : settings.format === "webp"
          ? "image/webp"
          : "image/png";
    return {
      path: relativePath,
      width: dimensions.width,
      height: dimensions.height,
      revision: result.revision,
      sceneHash: result.sceneHash,
      durationMs: performance.now() - started,
      warnings: result.warnings,
      resourceStats: result.resourceStats,
      versions: result.versions,
      format: settings.format,
      mimeType,
      scale: settings.scale,
      quality: settings.quality,
      transparent,
      sizeBytes: bytes.byteLength,
    };
  }

  async close(): Promise<void> {
    await this.#page?.close().catch(() => undefined);
    await this.#browser?.close().catch(() => undefined);
    this.#page = undefined;
    this.#browser = undefined;
  }
}
