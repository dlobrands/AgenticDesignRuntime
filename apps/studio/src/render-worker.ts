import {
  listNodes,
  type AssetManifest,
  type FontManifest,
  type FrameDocument,
  type TextNode,
} from "@agentic-design/core";
import {
  DesignRenderer,
  loadProjectFonts,
  measureTextNode,
  rendererCapabilities,
} from "@agentic-design/renderer-pixi";

type RenderWarning = { code: string; message: string; nodeIds?: string[] };
type RenderResponse = {
  dataUrl: string;
  width: number;
  height: number;
  warnings: RenderWarning[];
  resourceStats: {
    activeRenderers: number;
    completedRenders: number;
    maxActiveRenderers: number;
  };
};

let activeRenderers = 0;
let completedRenders = 0;
let maxActiveRenderers = 0;

const canvas = document.getElementById("render-target") as HTMLCanvasElement;
const capabilityRenderer = new DesignRenderer();
await capabilityRenderer.initialize(canvas);
const agenticCapabilities = () => rendererCapabilities(capabilityRenderer);

const json = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok)
    throw new Error(
      `Render dependency request failed with HTTP ${response.status}.`,
    );
  return response.json() as Promise<T>;
};

const blobDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), {
      once: true,
    });
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("PNG could not be encoded.")),
      { once: true },
    );
    reader.readAsDataURL(blob);
  });

const agenticMeasureText = async ({
  projectId,
  nodes,
}: {
  projectId: string;
  nodes: TextNode[];
}) => {
  const fonts = await json<FontManifest>(`/api/projects/${projectId}/fonts`);
  await loadProjectFonts(
    fonts.fonts,
    (fontId) => `/api/projects/${projectId}/fonts/${fontId}/content`,
  );
  return nodes.map((node) => ({ nodeId: node.id, ...measureTextNode(node) }));
};

const agenticRender = async ({
  projectId,
  frameId,
  scale = 1,
}: {
  projectId: string;
  frameId: string;
  scale?: number;
}): Promise<RenderResponse> => {
  const [frame, assets, fonts] = await Promise.all([
    json<FrameDocument>(`/api/projects/${projectId}/frames/${frameId}`),
    json<AssetManifest>(`/api/projects/${projectId}/assets`),
    json<FontManifest>(`/api/projects/${projectId}/fonts`),
  ]);
  await loadProjectFonts(
    fonts.fonts,
    (fontId) => `/api/projects/${projectId}/fonts/${fontId}/content`,
  );
  const frameRenderer = new DesignRenderer();
  let rendererCounted = false;
  let response: Omit<RenderResponse, "resourceStats">;
  try {
    await frameRenderer.initialize(
      document.createElement("canvas"),
      1,
      1,
      scale,
    );
    activeRenderers += 1;
    rendererCounted = true;
    maxActiveRenderers = Math.max(maxActiveRenderers, activeRenderers);
    await frameRenderer.setFrame(frame, {
      assetUrl: (assetId) =>
        `/api/projects/${projectId}/assets/${assetId}/content`,
      asset: (assetId) => assets.assets.find((asset) => asset.id === assetId),
      fontFamily: (fontId) => `ADR_${fontId.replaceAll("-", "_")}`,
    });
    const warnings: RenderWarning[] = [];
    for (const node of listNodes(frame)) {
      if (
        node.type !== "text" ||
        node.textBox.mode !== "fixed" ||
        node.textBox.overflowAccepted
      )
        continue;
      const metrics = measureTextNode(node);
      const widthOverflow =
        node.textBox.wrapping === "none" &&
        metrics.width > node.transform.width + 0.5;
      const heightOverflow = metrics.height > node.transform.height + 0.5;
      if (widthOverflow || heightOverflow) {
        warnings.push({
          code: "TEXT_OVERFLOW",
          message: `“${node.name}” overflows its fixed text box. Accept clipping or resize the box before export.`,
          nodeIds: [node.id],
        });
      }
    }
    const blob = await frameRenderer.toPngBlob(scale);
    response = {
      dataUrl: await blobDataUrl(blob),
      width: Math.max(1, Math.round(frame.canvas.width * scale)),
      height: Math.max(1, Math.round(frame.canvas.height * scale)),
      warnings,
    };
  } finally {
    frameRenderer.destroy();
    if (rendererCounted) {
      activeRenderers -= 1;
      completedRenders += 1;
    }
  }
  return {
    ...response,
    resourceStats: {
      activeRenderers,
      completedRenders,
      maxActiveRenderers,
    },
  };
};

Object.assign(window, {
  agenticRender,
  agenticMeasureText,
  agenticCapabilities,
});
document.documentElement.dataset.ready = "true";
