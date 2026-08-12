import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  createTransform,
  descendantIds,
  findNode,
  simulateFrameOperations,
  walkScene,
  type CanvasGuide,
  type RasterImageNode,
  type TextNode,
  type TextSpanStyle,
  type Transform,
} from "@agentic-design/core";
import {
  DesignRenderer,
  loadProjectFonts,
  measureTextNode,
} from "@agentic-design/renderer-pixi";
import { executeStudioCommand } from "./commands";
import {
  calculateGestureTransforms,
  combinedBounds,
  normalizedBounds,
  transformsEqual,
  type CanvasBounds,
  type TransformGestureMode,
} from "./gesture-controller";
import { useStudio } from "./store";
import {
  beginCropEdit,
  cropEditFitsSessionScope,
  cropEditOperation,
  cropResolution,
  panCropSource,
  resetCropEdit,
  scaleCropSource,
  type CropEditSession,
} from "./crop-controller";
import { calculateMoveSnap, type MoveSnapResult } from "./snapping-controller";
import {
  beginNewTextEdit,
  beginTextEdit,
  flattenTextEditFormatting,
  formatTextEditSelection,
  textEditFitsSessionScope,
  textEditOperation,
  updateTextEdit,
  type TextEditSession,
} from "./text-edit-controller";
import {
  INITIAL_TOOL_STATE,
  toolStateLabel,
  transitionToolState,
} from "./tool-state-machine";
import { clientPointToCanvas, scaledCanvasSize } from "./viewport-state";

type Gesture = {
  mode: TransformGestureMode;
  pointerId: number;
  captureTarget: Element;
  frameRevision: number;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  shiftKey: boolean;
  centerX: number;
  centerY: number;
  selectionBounds: CanvasBounds;
  selectedIds: string[];
  transforms: Record<string, Transform>;
  currentTransforms: Record<string, Transform>;
  snapOtherBounds: CanvasBounds[];
  animationFrame?: number;
};
type MarqueeGesture = {
  pointerId: number;
  captureTarget: Element;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  additive: boolean;
  initialSelection: string[];
  animationFrame?: number;
};
type CropPanGesture = {
  pointerId: number;
  captureTarget: Element;
  startClientX: number;
  startClientY: number;
  session: CropEditSession;
};
type GuideGesture = {
  pointerId: number;
  captureTarget: Element;
  guide: CanvasGuide;
  isNew: boolean;
};

export function CanvasSurface() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DesignRenderer | undefined>(undefined);
  const gestureRef = useRef<Gesture | undefined>(undefined);
  const marqueeRef = useRef<MarqueeGesture | undefined>(undefined);
  const cropPanRef = useRef<CropPanGesture | undefined>(undefined);
  const guideGestureRef = useRef<GuideGesture | undefined>(undefined);
  const commitInFlightRef = useRef(false);
  const renderEpochRef = useRef(0);
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const textEditSessionRef = useRef<TextEditSession | undefined>(undefined);
  const textSelectionRef = useRef({ start: 0, end: 0 });
  const initialTextSelectionRef = useRef<
    { start: number; end: number } | undefined
  >(undefined);
  const lastDirectTextPointerRef = useRef<
    | { frameId: string; nodeId: string; at: number; x: number; y: number }
    | undefined
  >(undefined);
  const frame = useStudio((state) => state.activeFrame);
  const project = useStudio((state) => state.activeProject);
  const assets = useStudio((state) => state.assets);
  const fonts = useStudio((state) => state.fonts);
  const selection = useStudio((state) => state.selection);
  const canvasTool = useStudio((state) => state.canvasTool);
  const draftOperations = useStudio((state) => state.draftOperations);
  const zoom = useStudio((state) => state.zoom);
  const setZoom = useStudio((state) => state.setZoom);
  const select = useStudio((state) => state.select);
  const selectMany = useStudio((state) => state.selectMany);
  const commit = useStudio((state) => state.commit);
  const setDraftTransforms = useStudio((state) => state.setDraftTransforms);
  const setDraftOperations = useStudio((state) => state.setDraftOperations);
  const commitDraftOperations = useStudio(
    (state) => state.commitDraftOperations,
  );
  const beginDraftSession = useStudio((state) => state.beginDraftSession);
  const endDraftSession = useStudio((state) => state.endDraftSession);
  const textEditRequest = useStudio((state) => state.textEditRequest);
  const clearTextEditRequest = useStudio((state) => state.clearTextEditRequest);
  const cropEditRequest = useStudio((state) => state.cropEditRequest);
  const clearCropEditRequest = useStudio((state) => state.clearCropEditRequest);
  const client = useStudio((state) => state.client);
  const [overlay, setOverlay] = useState<CanvasBounds>();
  const [marquee, setMarquee] = useState<CanvasBounds>();
  const [renderError, setRenderError] = useState<string>();
  const [rendererReady, setRendererReady] = useState(false);
  const [toolState, setToolState] = useState(INITIAL_TOOL_STATE);
  const [textEditSession, setTextEditSession] = useState<TextEditSession>();
  const [cropEditSession, setCropEditSession] = useState<CropEditSession>();
  const [guideDraft, setGuideDraft] = useState<CanvasGuide>();
  const [snapFeedback, setSnapFeedback] = useState<MoveSnapResult>({
    delta: { x: 0, y: 0 },
    lines: [],
    spacing: [],
  });
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [safeAreaVisible, setSafeAreaVisible] = useState(true);
  const [textSelection, setTextSelection] = useState({ start: 0, end: 0 });
  const hasFrame = frame !== undefined;
  const selectedNode =
    frame && selection.length === 1
      ? findNode(frame, selection[0]!)
      : undefined;
  const currentTextNode =
    textEditSession && frame
      ? findNode(frame, textEditSession.nodeId)
      : undefined;
  const editingTextNode: TextNode | undefined =
    currentTextNode?.type === "text"
      ? currentTextNode
      : textEditSession?.nodeSnapshot;
  const currentCropNode =
    cropEditSession && frame
      ? findNode(frame, cropEditSession.nodeId)
      : undefined;
  const editingCropNode: RasterImageNode | undefined =
    currentCropNode?.type === "rasterImage"
      ? currentCropNode
      : cropEditSession?.nodeSnapshot;

  const updateTextSelection = (start: number, end: number) => {
    const selection = { start, end };
    textSelectionRef.current = selection;
    setTextSelection(selection);
  };

  const captureTextSelection = () => {
    const editor = textAreaRef.current;
    if (
      !editor ||
      document.activeElement !== editor ||
      editor.selectionStart >= editor.selectionEnd
    )
      return;
    updateTextSelection(editor.selectionStart, editor.selectionEnd);
  };

  const openTextEdit = (nodeId: string, caretIndex?: number) => {
    if (
      !frame ||
      !project ||
      textEditSession ||
      commitInFlightRef.current ||
      draftOperations.length > 0
    )
      return;
    const node = findNode(frame, nodeId);
    if (!node || node.type !== "text" || node.locked || !node.visible) return;
    const session = beginTextEdit({
      projectId: project.id,
      frameId: frame.id,
      revision: frame.revision,
      node,
    });
    initialTextSelectionRef.current =
      caretIndex === undefined
        ? { start: 0, end: node.text.length }
        : { start: caretIndex, end: caretIndex };
    select(node.id);
    beginDraftSession("text", node.id);
    textEditSessionRef.current = session;
    setTextEditSession(session);
    updateTextSelection(0, node.text.length);
    setToolState((state) =>
      transitionToolState(state, {
        type: "begin-text-edit",
        nodeId: node.id,
      }),
    );
  };

  const openNewTextEdit = (position: { x: number; y: number }) => {
    if (
      !frame ||
      !project ||
      textEditSession ||
      commitInFlightRef.current ||
      draftOperations.length > 0
    )
      return;
    const font = fonts.fonts[0];
    if (!font) return;
    const width = Math.max(120, Math.min(480, frame.canvas.width - position.x));
    const height = 96;
    const node: TextNode = {
      id: crypto.randomUUID(),
      type: "text",
      name: "Text",
      visible: true,
      locked: false,
      transform: createTransform({
        x: Math.max(0, Math.min(position.x, frame.canvas.width - width)),
        y: Math.max(0, Math.min(position.y, frame.canvas.height - height)),
        width,
        height,
      }),
      opacity: 1,
      blendMode: "normal",
      text: "Text",
      typography: {
        fontId: font.id,
        fontSize: 54,
        fontWeight: font.weight,
        fontStyle: font.style,
        lineHeight: 64,
        letterSpacing: -1,
        alignment: "left",
        verticalAlignment: "top",
        color: "#F5F5F0",
        opacity: 1,
      },
      textBox: {
        mode: "fixed",
        width,
        height,
        wrapping: "word",
        overflow: "clip",
      },
    };
    const session = beginNewTextEdit({
      projectId: project.id,
      frameId: frame.id,
      revision: frame.revision,
      node,
    });
    initialTextSelectionRef.current = { start: 0, end: node.text.length };
    select(node.id);
    beginDraftSession("text", node.id);
    applyTextEditSession(session);
    updateTextSelection(0, node.text.length);
    setToolState((state) =>
      transitionToolState(state, { type: "begin-text-edit", nodeId: node.id }),
    );
  };

  const updateTextDraft = (text: string) => {
    const session = textEditSessionRef.current;
    if (!session) return;
    const next = updateTextEdit(session, text);
    applyTextEditSession(next);
  };

  const applyTextEditSession = (next: TextEditSession) => {
    textEditSessionRef.current = next;
    setTextEditSession(next);
    const operation = textEditOperation(next);
    setDraftOperations(operation ? [operation] : undefined);
  };

  const formatTextSelection = (style: TextSpanStyle) => {
    const selection = textSelectionRef.current;
    const session = textEditSessionRef.current;
    if (!session || selection.start >= selection.end) return;
    applyTextEditSession(
      formatTextEditSelection(session, selection.start, selection.end, style),
    );
  };

  const flattenTextFormatting = () => {
    const session = textEditSessionRef.current;
    if (!session) return;
    applyTextEditSession(flattenTextEditFormatting(session));
  };

  const cancelTextEdit = () => {
    if (!textEditSessionRef.current) return;
    setDraftOperations();
    endDraftSession();
    textEditSessionRef.current = undefined;
    setTextEditSession(undefined);
    setToolState((state) => transitionToolState(state, { type: "cancel" }));
    canvasRef.current?.focus({ preventScroll: true });
  };

  const commitTextEdit = async () => {
    const session = textEditSessionRef.current;
    if (!session) return;
    const operation = textEditOperation(session);
    if (!operation) {
      cancelTextEdit();
      return;
    }
    setDraftOperations([operation]);
    await commitDraftOperations();
    endDraftSession();
    textEditSessionRef.current = undefined;
    setTextEditSession(undefined);
    setToolState((state) => transitionToolState(state, { type: "finish" }));
    canvasRef.current?.focus({ preventScroll: true });
  };

  const applyCropEditSession = (next: CropEditSession) => {
    setCropEditSession(next);
    const operation = cropEditOperation(next);
    setDraftOperations(operation ? [operation] : undefined);
  };

  const openCropEdit = (nodeId: string) => {
    if (
      !frame ||
      !project ||
      textEditSession ||
      cropEditSession ||
      commitInFlightRef.current ||
      draftOperations.length > 0
    )
      return;
    const node = findNode(frame, nodeId);
    if (!node || node.type !== "rasterImage" || node.locked || !node.visible)
      return;
    const session = beginCropEdit({
      projectId: project.id,
      frameId: frame.id,
      revision: frame.revision,
      node,
    });
    select(node.id);
    beginDraftSession("crop", node.id);
    applyCropEditSession(session);
    setToolState((state) =>
      transitionToolState(state, {
        type: "begin-crop-edit",
        nodeId: node.id,
      }),
    );
  };

  const cancelCropEdit = () => {
    if (!cropEditSession) return;
    const pan = cropPanRef.current;
    if (pan) releaseCapture(pan);
    cropPanRef.current = undefined;
    setDraftOperations();
    endDraftSession();
    setCropEditSession(undefined);
    setToolState((state) => transitionToolState(state, { type: "cancel" }));
    canvasRef.current?.focus({ preventScroll: true });
  };

  const commitCropEdit = async () => {
    if (!cropEditSession) return;
    const operation = cropEditOperation(cropEditSession);
    if (!operation) {
      cancelCropEdit();
      return;
    }
    setDraftOperations([operation]);
    await commitDraftOperations();
    endDraftSession();
    setCropEditSession(undefined);
    setToolState((state) => transitionToolState(state, { type: "finish" }));
    canvasRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!textEditRequest) return;
    openTextEdit(textEditRequest.nodeId);
    clearTextEditRequest();
  }, [textEditRequest?.requestId]);

  useEffect(() => {
    if (!cropEditRequest) return;
    openCropEdit(cropEditRequest.nodeId);
    clearCropEditRequest();
  }, [cropEditRequest?.requestId]);

  useEffect(() => {
    if (!textEditSession) return;
    if (!textEditFitsSessionScope(textEditSession, project?.id, frame?.id))
      cancelTextEdit();
  }, [project?.id, frame?.id]);

  useEffect(() => {
    if (!cropEditSession) return;
    if (!cropEditFitsSessionScope(cropEditSession, project?.id, frame?.id))
      cancelCropEdit();
  }, [project?.id, frame?.id]);

  useEffect(() => {
    if (!textEditSession) return;
    const animationFrame = requestAnimationFrame(() => {
      const editor = textAreaRef.current;
      if (!editor) return;
      const initial = initialTextSelectionRef.current ?? {
        start: 0,
        end: editor.value.length,
      };
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(initial.start, initial.end);
      updateTextSelection(initial.start, initial.end);
      initialTextSelectionRef.current = undefined;
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [textEditSession?.nodeId]);

  const caretIndexAt = (
    node: TextNode,
    position: { x: number; y: number },
  ): number => {
    const bounds = rendererRef.current?.getNodeBounds(node.id);
    if (!bounds || node.text.length === 0) return 0;
    const lines = node.text.split("\n");
    const lineIndex = Math.max(
      0,
      Math.min(
        lines.length - 1,
        Math.floor((position.y - bounds.y) / node.typography.lineHeight),
      ),
    );
    const line = lines[lineIndex] ?? "";
    const before = lines
      .slice(0, lineIndex)
      .reduce((sum, value) => sum + value.length + 1, 0);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return before + line.length;
    context.font = `${node.typography.fontStyle} ${node.typography.fontWeight} ${node.typography.fontSize}px ADR_${node.typography.fontId.replaceAll("-", "_")}`;
    const localX = Math.max(0, position.x - bounds.x);
    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= line.length; index += 1) {
      const width = context.measureText(line.slice(0, index)).width;
      const nextDistance = Math.abs(width - localX);
      if (nextDistance < distance) {
        distance = nextDistance;
        best = index;
      }
    }
    return before + best;
  };

  const commitHandleTransform = (
    mode: "resize" | "resize-nw" | "rotate",
    direction: 1 | -1,
  ) => {
    if (!frame || selection.length !== 1) return;
    const node = findNode(frame, selection[0]!);
    if (!node || node.type === "adjustment") return;
    const value =
      mode === "rotate"
        ? { rotation: node.transform.rotation + direction * 15 }
        : mode === "resize-nw"
          ? {
              x: node.transform.x - direction * 10,
              y: node.transform.y - direction * 10,
              width: Math.max(1, node.transform.width + direction * 10),
              height: Math.max(1, node.transform.height + direction * 10),
            }
          : {
              width: Math.max(1, node.transform.width + direction * 10),
              height: Math.max(1, node.transform.height + direction * 10),
            };
    void commit([
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup: "transform",
        value,
      },
    ]);
  };

  const handleTransformKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    mode: "resize" | "resize-nw" | "rotate",
  ) => {
    if (
      ![
        "Enter",
        " ",
        "ArrowUp",
        "ArrowRight",
        "ArrowDown",
        "ArrowLeft",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const reverse =
      event.shiftKey || event.key === "ArrowDown" || event.key === "ArrowLeft";
    commitHandleTransform(mode, reverse ? -1 : 1);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const renderer = new DesignRenderer();
    rendererRef.current = renderer;
    void renderer
      .initialize(canvas)
      .then(() => {
        if (!cancelled) setRendererReady(true);
      })
      .catch((error) => {
        if (!cancelled)
          setRenderError(
            error instanceof Error ? error.message : String(error),
          );
      });
    return () => {
      cancelled = true;
      renderer.destroy();
      if (rendererRef.current === renderer) rendererRef.current = undefined;
      setRendererReady(false);
    };
  }, [hasFrame]);

  const refreshOverlay = (nodeIds = useStudio.getState().selection) => {
    const renderer = rendererRef.current;
    if (!renderer || nodeIds.length === 0) {
      setOverlay(undefined);
      return;
    }
    const bounds = nodeIds.flatMap((nodeId) => {
      const value = renderer.getNodeBounds(nodeId);
      return value ? [value] : [];
    });
    if (bounds.length === 0) {
      setOverlay(undefined);
      return;
    }
    setOverlay(combinedBounds(bounds));
  };

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !rendererReady || !frame || !project) return;
    if (
      gestureRef.current &&
      gestureRef.current.frameRevision !== frame.revision
    )
      cancelGesture();
    const epoch = ++renderEpochRef.current;
    renderQueueRef.current = renderQueueRef.current.then(async () => {
      try {
        if (epoch !== renderEpochRef.current) return;
        await loadProjectFonts(fonts.fonts, (fontId) =>
          client.fontUrl(project.id, fontId),
        );
        if (epoch !== renderEpochRef.current) return;
        const renderFrame =
          draftOperations.length > 0
            ? simulateFrameOperations(frame, draftOperations).frame
            : frame;
        await renderer.setFrame(renderFrame, {
          assetUrl: (assetId) => client.assetUrl(project.id, assetId),
          asset: (assetId) =>
            assets.assets.find((asset) => asset.id === assetId),
          fontFamily: (fontId) => `ADR_${fontId.replaceAll("-", "_")}`,
        });
        const metrics = renderer.getLastReconciliationMetrics();
        if (canvasRef.current) {
          canvasRef.current.dataset.reconciliationMode = metrics.mode;
          canvasRef.current.dataset.reconciliationReason = metrics.reason ?? "";
          canvasRef.current.dataset.reconciliationDirty =
            metrics.dirty.join(",");
          canvasRef.current.dataset.nodesRebuilt = String(metrics.nodesRebuilt);
          canvasRef.current.dataset.nodesUpdatedInPlace = String(
            metrics.nodesUpdatedInPlace,
          );
          canvasRef.current.dataset.textureAllocations = String(
            metrics.textureAllocations,
          );
          canvasRef.current.dataset.activeGeneratedTextures = String(
            metrics.activeGeneratedTextures,
          );
          canvasRef.current.dataset.activeAssetTextures = String(
            metrics.activeAssetTextures,
          );
          canvasRef.current.dataset.cacheInvalidations = String(
            metrics.cacheInvalidations,
          );
          canvasRef.current.dataset.reconciliationDurationMs =
            metrics.reconciliationDurationMs.toFixed(3);
          canvasRef.current.dataset.renderDurationMs =
            metrics.renderDurationMs.toFixed(3);
        }
        if (epoch === renderEpochRef.current) {
          setRenderError(undefined);
          refreshOverlay();
        }
      } catch (error) {
        if (epoch === renderEpochRef.current)
          setRenderError(
            error instanceof Error ? error.message : String(error),
          );
      }
    });
    return () => {
      if (renderEpochRef.current === epoch) ++renderEpochRef.current;
    };
  }, [frame, project, assets, fonts, client, rendererReady, draftOperations]);

  useEffect(() => {
    refreshOverlay();
  }, [selection, frame, zoom]);

  const point = (event: React.PointerEvent): { x: number; y: number } => {
    return pointFromClient(event.clientX, event.clientY);
  };

  const pointFromClient = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return clientPointToCanvas({ x: clientX, y: clientY }, rect, frame!.canvas);
  };

  const releaseCapture = (gesture: {
    captureTarget: Element;
    pointerId: number;
  }) => {
    if (gesture.captureTarget.hasPointerCapture(gesture.pointerId))
      gesture.captureTarget.releasePointerCapture(gesture.pointerId);
  };

  const applyGesture = (gesture: Gesture) => {
    const renderer = rendererRef.current;
    if (!renderer || !frame || gesture.frameRevision !== frame.revision) return;
    let rawDelta = {
      x: gesture.latestX - gesture.startX,
      y: gesture.latestY - gesture.startY,
    };
    if (gesture.shiftKey && gesture.mode === "move")
      rawDelta =
        Math.abs(rawDelta.x) > Math.abs(rawDelta.y)
          ? { x: rawDelta.x, y: 0 }
          : { x: 0, y: rawDelta.y };
    const nextSnapFeedback =
      gesture.mode === "move"
        ? calculateMoveSnap({
            rawDelta,
            selectionBounds: gesture.selectionBounds,
            canvas: frame.canvas,
            guides: frame.canvas.guides,
            otherBounds: gesture.snapOtherBounds,
            threshold: 7 / zoom,
            enabled: snappingEnabled,
          })
        : { delta: rawDelta, lines: [], spacing: [] };
    setSnapFeedback(nextSnapFeedback);
    gesture.currentTransforms = calculateGestureTransforms({
      mode: gesture.mode,
      start: { x: gesture.startX, y: gesture.startY },
      latest: { x: gesture.latestX, y: gesture.latestY },
      center: { x: gesture.centerX, y: gesture.centerY },
      selectionBounds: gesture.selectionBounds,
      transforms: gesture.transforms,
      shiftKey: gesture.shiftKey,
      zoom,
      canvas: frame.canvas,
      snapping: {
        enabled: snappingEnabled,
        guides: frame.canvas.guides,
        otherBounds: gesture.snapOtherBounds,
      },
      canvasDeltaToParent: (nodeId, delta) =>
        renderer.canvasDeltaToParent(nodeId, delta),
    });
    const previews = Object.entries(gesture.currentTransforms).map(
      ([nodeId, transform]) => ({ nodeId, transform }),
    );
    renderer.previewTransforms(previews);
    setDraftTransforms(structuredClone(gesture.currentTransforms));
    refreshOverlay(gesture.selectedIds);
  };

  const scheduleGesture = (gesture: Gesture) => {
    if (gesture.animationFrame !== undefined) return;
    gesture.animationFrame = requestAnimationFrame(() => {
      gesture.animationFrame = undefined;
      if (gestureRef.current === gesture) applyGesture(gesture);
    });
  };

  const flushGesture = (gesture: Gesture) => {
    if (gesture.animationFrame !== undefined) {
      cancelAnimationFrame(gesture.animationFrame);
      gesture.animationFrame = undefined;
    }
    applyGesture(gesture);
  };

  const cancelGesture = () => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = undefined;
    if (gesture.animationFrame !== undefined)
      cancelAnimationFrame(gesture.animationFrame);
    rendererRef.current?.previewTransforms(
      Object.entries(gesture.transforms).map(([nodeId, transform]) => ({
        nodeId,
        transform,
      })),
    );
    setDraftTransforms();
    setSnapFeedback({ delta: { x: 0, y: 0 }, lines: [], spacing: [] });
    releaseCapture(gesture);
    refreshOverlay(gesture.selectedIds);
    setToolState((state) => transitionToolState(state, { type: "cancel" }));
  };

  const applyMarquee = (gesture: MarqueeGesture) => {
    setMarquee(
      normalizedBounds(
        gesture.startX,
        gesture.startY,
        gesture.latestX,
        gesture.latestY,
      ),
    );
  };

  const captureDirectTextPointer = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      event.target instanceof Element &&
      event.target.closest("[data-canvas-control]")
    )
      return;
    if (!frame || !rendererRef.current || textEditSession) return;
    const position = pointFromClient(event.clientX, event.clientY);
    const selectedBoundsHit = Boolean(
      selectedNode &&
      overlay &&
      position.x >= overlay.x &&
      position.x <= overlay.x + overlay.width &&
      position.y >= overlay.y &&
      position.y <= overlay.y + overlay.height,
    );
    const hitNodeId = rendererRef.current.hitTestNode(position);
    const nodeId =
      hitNodeId ?? (selectedBoundsHit ? selectedNode!.id : undefined);
    const node = nodeId ? findNode(frame, nodeId) : undefined;
    if (canvasTool === "text") {
      event.preventDefault();
      event.stopPropagation();
      if (node?.type === "text" && nodeId)
        openTextEdit(nodeId, caretIndexAt(node, position));
      else openNewTextEdit(position);
      return;
    }
    const previous = lastDirectTextPointerRef.current;
    const repeatsPrevious = previous
      ? previous.frameId === frame.id &&
        previous.nodeId === nodeId &&
        event.timeStamp - previous.at <= 450 &&
        Math.hypot(position.x - previous.x, position.y - previous.y) <= 6 / zoom
      : false;
    const matches = Boolean(node?.type === "text" && repeatsPrevious);
    lastDirectTextPointerRef.current =
      node?.type === "text" && !matches
        ? {
            frameId: frame.id,
            nodeId: node.id,
            at: event.timeStamp,
            x: position.x,
            y: position.y,
          }
        : undefined;
    if (!matches || !nodeId) return;
    event.preventDefault();
    event.stopPropagation();
    openTextEdit(
      nodeId,
      node?.type === "text" ? caretIndexAt(node, position) : undefined,
    );
  };

  const captureDirectTextDoubleClick = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (
      canvasTool !== "select" ||
      !frame ||
      !rendererRef.current ||
      textEditSession
    )
      return;
    const position = pointFromClient(event.clientX, event.clientY);
    const selectedBoundsHit = Boolean(
      selectedNode?.type === "text" &&
      overlay &&
      position.x >= overlay.x &&
      position.x <= overlay.x + overlay.width &&
      position.y >= overlay.y &&
      position.y <= overlay.y + overlay.height,
    );
    const hitNodeId = rendererRef.current.hitTestNode(position);
    const nodeId =
      hitNodeId ?? (selectedBoundsHit ? selectedNode!.id : undefined);
    const node = nodeId ? findNode(frame, nodeId) : undefined;
    if (!nodeId || node?.type !== "text") return;
    event.preventDefault();
    event.stopPropagation();
    openTextEdit(nodeId, caretIndexAt(node, position));
  };

  const scheduleMarquee = (gesture: MarqueeGesture) => {
    if (gesture.animationFrame !== undefined) return;
    gesture.animationFrame = requestAnimationFrame(() => {
      gesture.animationFrame = undefined;
      if (marqueeRef.current === gesture) applyMarquee(gesture);
    });
  };

  const flushMarquee = (gesture: MarqueeGesture) => {
    if (gesture.animationFrame !== undefined) {
      cancelAnimationFrame(gesture.animationFrame);
      gesture.animationFrame = undefined;
    }
    applyMarquee(gesture);
  };

  const cancelMarquee = () => {
    const gesture = marqueeRef.current;
    if (!gesture) return;
    marqueeRef.current = undefined;
    if (gesture.animationFrame !== undefined)
      cancelAnimationFrame(gesture.animationFrame);
    releaseCapture(gesture);
    setMarquee(undefined);
    selectMany(gesture.initialSelection);
    setToolState((state) => transitionToolState(state, { type: "cancel" }));
  };

  const beginCropPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!cropEditSession || !overlay) return;
    cropPanRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      session: cropEditSession,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveCropPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = cropPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId || !overlay) return;
    applyCropEditSession(
      panCropSource(
        pan.session,
        {
          x: event.clientX - pan.startClientX,
          y: event.clientY - pan.startClientY,
        },
        {
          width: overlay.width * zoom,
          height: overlay.height * zoom,
        },
      ),
    );
  };

  const endCropPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = cropPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    moveCropPan(event);
    cropPanRef.current = undefined;
    releaseCapture(pan);
  };

  const nudgeCrop = (x: number, y: number) => {
    if (!cropEditSession || !overlay) return;
    applyCropEditSession(
      panCropSource(
        cropEditSession,
        { x, y },
        { width: overlay.width * zoom, height: overlay.height * zoom },
      ),
    );
  };

  const guidePositionFromPointer = (
    axis: CanvasGuide["axis"],
    clientX: number,
    clientY: number,
  ): number => {
    const position = pointFromClient(clientX, clientY);
    return Math.max(
      0,
      Math.min(
        axis === "vertical" ? frame!.canvas.width : frame!.canvas.height,
        axis === "vertical" ? position.x : position.y,
      ),
    );
  };

  const beginGuideDrag = (
    event: React.PointerEvent<HTMLElement>,
    axis: CanvasGuide["axis"],
    guide?: CanvasGuide,
  ) => {
    if (!frame || commitInFlightRef.current) return;
    const next = guide
      ? structuredClone(guide)
      : {
          id: crypto.randomUUID(),
          axis,
          position: guidePositionFromPointer(
            axis,
            event.clientX,
            event.clientY,
          ),
        };
    guideGestureRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      guide: next,
      isNew: !guide,
    };
    setGuideDraft(structuredClone(next));
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const moveGuideDrag = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = guideGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.guide.position = guidePositionFromPointer(
      gesture.guide.axis,
      event.clientX,
      event.clientY,
    );
    setGuideDraft(structuredClone(gesture.guide));
  };

  const cancelGuideDrag = () => {
    const gesture = guideGestureRef.current;
    if (!gesture) return;
    guideGestureRef.current = undefined;
    releaseCapture(gesture);
    setGuideDraft(undefined);
  };

  const endGuideDrag = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = guideGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !frame) return;
    moveGuideDrag(event);
    guideGestureRef.current = undefined;
    releaseCapture(gesture);
    setGuideDraft(undefined);
    const guides = frame.canvas.guides ?? [];
    void commit([
      {
        kind: "setCanvas",
        value: {
          guides: gesture.isNew
            ? [...guides, gesture.guide]
            : guides.map((guide) =>
                guide.id === gesture.guide.id ? gesture.guide : guide,
              ),
        },
      },
    ]);
  };

  const addCenteredGuide = (axis: CanvasGuide["axis"]) => {
    if (!frame) return;
    void commit([
      {
        kind: "setCanvas",
        value: {
          guides: [
            ...(frame.canvas.guides ?? []),
            {
              id: crypto.randomUUID(),
              axis,
              position:
                axis === "vertical"
                  ? frame.canvas.width / 2
                  : frame.canvas.height / 2,
            },
          ],
        },
      },
    ]);
  };

  const updateGuideFromKeyboard = (
    guide: CanvasGuide,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!frame) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void commit([
        {
          kind: "setCanvas",
          value: {
            guides: (frame.canvas.guides ?? []).filter(
              (candidate) => candidate.id !== guide.id,
            ),
          },
        },
      ]);
      return;
    }
    const previous =
      guide.axis === "vertical"
        ? event.key === "ArrowLeft"
        : event.key === "ArrowUp";
    const next =
      guide.axis === "vertical"
        ? event.key === "ArrowRight"
        : event.key === "ArrowDown";
    if (!previous && !next) return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const limit =
      guide.axis === "vertical" ? frame.canvas.width : frame.canvas.height;
    const position = Math.max(
      0,
      Math.min(limit, guide.position + (previous ? -amount : amount)),
    );
    void commit([
      {
        kind: "setCanvas",
        value: {
          guides: (frame.canvas.guides ?? []).map((candidate) =>
            candidate.id === guide.id ? { ...candidate, position } : candidate,
          ),
        },
      },
    ]);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        !gestureRef.current &&
        !marqueeRef.current &&
        !cropEditSession &&
        !guideGestureRef.current
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelGesture();
      cancelMarquee();
      cancelCropEdit();
      cancelGuideDrag();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const begin = (
    event: React.PointerEvent,
    mode: Gesture["mode"],
    forcedId?: string,
  ) => {
    if (
      !frame ||
      !rendererRef.current ||
      commitInFlightRef.current ||
      textEditSession ||
      cropEditSession
    )
      return;
    const position = point(event);
    const selectedBoundsHit = Boolean(
      selectedNode &&
      overlay &&
      position.x >= overlay.x &&
      position.x <= overlay.x + overlay.width &&
      position.y >= overlay.y &&
      position.y <= overlay.y + overlay.height,
    );
    const targetId =
      forcedId ??
      (selectedBoundsHit
        ? selectedNode!.id
        : rendererRef.current.hitTestNode(position));
    if (!targetId) {
      const additive = event.shiftKey || event.metaKey;
      marqueeRef.current = {
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        startX: position.x,
        startY: position.y,
        latestX: position.x,
        latestY: position.y,
        additive,
        initialSelection: [...selection],
      };
      if (!additive) selectMany([]);
      setMarquee({ x: position.x, y: position.y, width: 0, height: 0 });
      event.currentTarget.setPointerCapture(event.pointerId);
      setToolState((state) =>
        transitionToolState(state, { type: "begin-marquee" }),
      );
      canvasRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      return;
    }
    if (!selection.includes(targetId))
      select(targetId, event.shiftKey || event.metaKey);
    const activeIds = selection.includes(targetId) ? selection : [targetId];
    const transforms: Record<string, Transform> = {};
    const bounds: CanvasBounds[] = [];
    for (const id of activeIds) {
      const state = rendererRef.current.getNodeState(id);
      const nodeBounds = rendererRef.current.getNodeBounds(id);
      if (state && !state.locked) {
        transforms[id] = state.transform;
        if (nodeBounds) bounds.push(nodeBounds);
      }
    }
    const targetBounds = rendererRef.current.getNodeBounds(targetId);
    if (
      !targetBounds ||
      bounds.length === 0 ||
      Object.keys(transforms).length === 0
    )
      return;
    const excluded = new Set(
      activeIds.flatMap((id) => {
        const node = findNode(frame, id);
        return node ? [id, ...descendantIds(node)] : [id];
      }),
    );
    const snapOtherBounds = [...walkScene(frame)].flatMap(({ node }) => {
      if (excluded.has(node.id) || !node.visible) return [];
      const nodeBounds = rendererRef.current?.getNodeBounds(node.id);
      return nodeBounds ? [nodeBounds] : [];
    });
    gestureRef.current = {
      mode,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      frameRevision: frame.revision,
      startX: position.x,
      startY: position.y,
      latestX: position.x,
      latestY: position.y,
      shiftKey: event.shiftKey,
      centerX: targetBounds.x + targetBounds.width / 2,
      centerY: targetBounds.y + targetBounds.height / 2,
      selectionBounds: combinedBounds(bounds),
      selectedIds: activeIds,
      transforms,
      currentTransforms: structuredClone(transforms),
      snapOtherBounds,
    };
    setToolState((state) =>
      transitionToolState(state, { type: "begin-transform", mode }),
    );
    setDraftTransforms(structuredClone(transforms));
    event.currentTarget.setPointerCapture(event.pointerId);
    canvasRef.current?.focus({ preventScroll: true });
    event.preventDefault();
  };

  const move = (event: React.PointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      const marqueeGesture = marqueeRef.current;
      if (!marqueeGesture || marqueeGesture.pointerId !== event.pointerId)
        return;
      const position = point(event);
      marqueeGesture.latestX = position.x;
      marqueeGesture.latestY = position.y;
      scheduleMarquee(marqueeGesture);
      return;
    }
    const position = point(event);
    gesture.latestX = position.x;
    gesture.latestY = position.y;
    gesture.shiftKey = event.shiftKey;
    scheduleGesture(gesture);
  };

  const end = async (event: React.PointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      const marqueeGesture = marqueeRef.current;
      if (!marqueeGesture || marqueeGesture.pointerId !== event.pointerId)
        return;
      const position = point(event);
      marqueeGesture.latestX = position.x;
      marqueeGesture.latestY = position.y;
      flushMarquee(marqueeGesture);
      marqueeRef.current = undefined;
      releaseCapture(marqueeGesture);
      const bounds = normalizedBounds(
        marqueeGesture.startX,
        marqueeGesture.startY,
        marqueeGesture.latestX,
        marqueeGesture.latestY,
      );
      setMarquee(undefined);
      setToolState((state) => transitionToolState(state, { type: "finish" }));
      const selected =
        bounds.width < 3 / zoom || bounds.height < 3 / zoom
          ? []
          : (rendererRef.current?.getNodeIdsInBounds(bounds) ?? []);
      selectMany(selected, marqueeGesture.additive);
      return;
    }
    const position = point(event);
    gesture.latestX = position.x;
    gesture.latestY = position.y;
    gesture.shiftKey = event.shiftKey;
    const moved = Math.hypot(
      gesture.latestX - gesture.startX,
      gesture.latestY - gesture.startY,
    );
    if (moved < 3 / zoom) {
      if (gesture.animationFrame !== undefined) {
        cancelAnimationFrame(gesture.animationFrame);
        gesture.animationFrame = undefined;
      }
      gesture.currentTransforms = structuredClone(gesture.transforms);
      rendererRef.current?.previewTransforms(
        Object.entries(gesture.transforms).map(([nodeId, transform]) => ({
          nodeId,
          transform,
        })),
      );
      refreshOverlay(gesture.selectedIds);
    } else {
      flushGesture(gesture);
    }
    gestureRef.current = undefined;
    setToolState((state) => transitionToolState(state, { type: "finish" }));
    releaseCapture(gesture);
    setDraftTransforms();
    setSnapFeedback({ delta: { x: 0, y: 0 }, lines: [], spacing: [] });
    const operations = Object.entries(gesture.currentTransforms).flatMap(
      ([id, transform]) =>
        !transformsEqual(gesture.transforms[id]!, transform)
          ? [
              {
                kind: "updateNode",
                nodeId: id,
                propertyGroup: "transform",
                value: transform,
              } as const,
            ]
          : [],
    );
    if (operations.length === 0) return;
    commitInFlightRef.current = true;
    let result: Awaited<ReturnType<typeof commit>>;
    try {
      result = await commit(operations, gesture.frameRevision);
    } finally {
      commitInFlightRef.current = false;
    }
    if (!result) {
      rendererRef.current?.previewTransforms(
        Object.entries(gesture.transforms).map(([nodeId, transform]) => ({
          nodeId,
          transform,
        })),
      );
      refreshOverlay(gesture.selectedIds);
      return;
    }
    gesture.selectedIds.forEach((id, index) => select(id, index > 0));
  };

  if (!frame)
    return (
      <div className="canvas-empty">
        <span>No frame selected</span>
      </div>
    );
  const canvasSize = scaledCanvasSize(frame.canvas, zoom);
  const displayGuides = (() => {
    const canonical = frame.canvas.guides ?? [];
    if (!guideDraft) return canonical;
    const exists = canonical.some((guide) => guide.id === guideDraft.id);
    return exists
      ? canonical.map((guide) =>
          guide.id === guideDraft.id ? guideDraft : guide,
        )
      : [...canonical, guideDraft];
  })();
  const editingPreviewNode = (() => {
    if (!editingTextNode || !textEditSession) return undefined;
    const next: TextNode = {
      ...editingTextNode,
      text: textEditSession.text,
    };
    if (textEditSession.spans) next.spans = textEditSession.spans;
    else delete next.spans;
    return next;
  })();
  const selectedTextSpan = textEditSession?.spans?.find(
    (span) =>
      textSelection.start >= span.start && textSelection.start < span.end,
  );
  const selectedTextStyle = selectedTextSpan?.style ?? {};
  const canFormatText = textSelection.start < textSelection.end;
  const editingMetrics = editingPreviewNode
    ? measureTextNode(
        editingPreviewNode,
        `ADR_${editingPreviewNode.typography.fontId.replaceAll("-", "_")}`,
      )
    : undefined;
  const textOverflows = Boolean(
    editingPreviewNode &&
    editingMetrics &&
    editingPreviewNode.textBox.mode === "fixed" &&
    ((editingPreviewNode.textBox.wrapping === "none" &&
      editingMetrics.width > editingPreviewNode.transform.width + 0.5) ||
      editingMetrics.height > editingPreviewNode.transform.height + 0.5),
  );
  const textLayoutStatus =
    !currentTextNode && textEditSession
      ? "This layer changed or was removed canonically. Saving will open conflict review."
      : editingPreviewNode?.textBox.mode === "fixed"
        ? textOverflows
          ? "Text exceeds the fixed box and will be clipped unless the box is resized or overflow is accepted."
          : "Text fits within the fixed box."
        : editingMetrics
          ? `Auto size will resolve to ${Math.ceil(editingMetrics.width)} × ${Math.ceil(editingMetrics.height)} on save.`
          : "Auto size will resolve on save.";
  const cropAsset = editingCropNode
    ? assets.assets.find(
        (asset) =>
          asset.id === editingCropNode.assetId && asset.type === "raster",
      )
    : undefined;
  const cropResolutionStatus =
    editingCropNode && cropEditSession && cropAsset
      ? cropResolution({
          node: editingCropNode,
          asset: cropAsset,
          crop: cropEditSession.crop,
        })
      : undefined;
  return (
    <div className="canvas-viewport" aria-label="Design canvas" role="region">
      <p id="design-canvas-help" className="sr-only">
        Select layers from the Layers panel. Use arrow keys to nudge a selected
        layer. Transform handles support arrow keys; hold Shift to reverse an
        Enter or Space action.
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {selection.length === 0
          ? "No layer selected."
          : selection.length === 1
            ? `${selectedNode?.name ?? "Layer"} selected.`
            : `${selection.length} layers selected.`}
      </p>
      <div className="canvas-rulers">
        <span
          aria-label={`Canvas size ${frame.canvas.width} by ${frame.canvas.height}`}
        >
          {frame.canvas.width} × {frame.canvas.height}
        </span>
        <div
          className="canvas-layout-toggles"
          role="group"
          aria-label="Canvas layout aids"
        >
          <button
            aria-pressed={snappingEnabled}
            onClick={() => {
              setSnappingEnabled((value) => !value);
              setSnapFeedback({
                delta: { x: 0, y: 0 },
                lines: [],
                spacing: [],
              });
            }}
          >
            Snap {snappingEnabled ? "on" : "off"}
          </button>
          <button
            aria-pressed={guidesVisible}
            onClick={() => setGuidesVisible((value) => !value)}
          >
            Guides {guidesVisible ? "on" : "off"}
          </button>
          <button
            aria-pressed={safeAreaVisible}
            disabled={!frame.canvas.safeArea}
            onClick={() => setSafeAreaVisible((value) => !value)}
          >
            Safe area {safeAreaVisible ? "on" : "off"}
          </button>
        </div>
        <div className="canvas-zoom" role="group" aria-label="Canvas zoom">
          <button aria-label="Zoom out" onClick={() => setZoom(zoom - 0.1)}>
            −
          </button>
          <output aria-label="Zoom level" aria-live="polite">
            {Math.round(zoom * 100)}%
          </output>
          <button aria-label="Zoom in" onClick={() => setZoom(zoom + 0.1)}>
            +
          </button>
        </div>
      </div>
      <div className="canvas-centering">
        <div
          className="artboard-shell"
          style={{ width: canvasSize.width, height: canvasSize.height }}
          onPointerDownCapture={captureDirectTextPointer}
          onDoubleClickCapture={captureDirectTextDoubleClick}
        >
          <div
            className="artboard-ruler ruler-horizontal"
            data-canvas-control
            role="button"
            tabIndex={0}
            aria-label="Horizontal ruler. Drag to add a vertical guide, or press Enter to add one at canvas center."
            onPointerDown={(event) => beginGuideDrag(event, "vertical")}
            onPointerMove={moveGuideDrag}
            onPointerUp={endGuideDrag}
            onPointerCancel={cancelGuideDrag}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              addCenteredGuide("vertical");
            }}
          >
            <span>0</span>
            <span>{Math.round(frame.canvas.width / 2)}</span>
            <span>{frame.canvas.width}</span>
          </div>
          <div
            className="artboard-ruler ruler-vertical"
            data-canvas-control
            role="button"
            tabIndex={0}
            aria-label="Vertical ruler. Drag to add a horizontal guide, or press Enter to add one at canvas center."
            onPointerDown={(event) => beginGuideDrag(event, "horizontal")}
            onPointerMove={moveGuideDrag}
            onPointerUp={endGuideDrag}
            onPointerCancel={cancelGuideDrag}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              addCenteredGuide("horizontal");
            }}
          >
            <span>0</span>
            <span>{Math.round(frame.canvas.height / 2)}</span>
            <span>{frame.canvas.height}</span>
          </div>
          <canvas
            ref={canvasRef}
            className="design-canvas"
            tabIndex={0}
            aria-label="Editable design canvas"
            aria-describedby="design-canvas-help"
            aria-busy={!rendererReady}
            data-tool-state={
              toolState.interaction === "idle"
                ? `${canvasTool}:idle`
                : toolStateLabel(toolState)
            }
            data-active-tool={canvasTool}
            data-renderer-state={
              renderError ? "error" : rendererReady ? "ready" : "starting"
            }
            style={{ width: canvasSize.width, height: canvasSize.height }}
            onPointerDown={(event) => begin(event, "move")}
            onPointerMove={move}
            onPointerUp={(event) => void end(event)}
            onPointerCancel={() => {
              cancelGesture();
              cancelMarquee();
            }}
            onLostPointerCapture={() => {
              cancelGesture();
              cancelMarquee();
            }}
          />
          {snappingEnabled && (
            <div className="canvas-center-guides" aria-hidden="true">
              <span className="center-guide-vertical" />
              <span className="center-guide-horizontal" />
            </div>
          )}
          {safeAreaVisible && frame.canvas.safeArea && (
            <div
              className="safe-area-overlay"
              aria-label={`Safe area: top ${frame.canvas.safeArea.top}, right ${frame.canvas.safeArea.right}, bottom ${frame.canvas.safeArea.bottom}, left ${frame.canvas.safeArea.left}`}
              role="img"
              style={{
                top: frame.canvas.safeArea.top * zoom,
                right: frame.canvas.safeArea.right * zoom,
                bottom: frame.canvas.safeArea.bottom * zoom,
                left: frame.canvas.safeArea.left * zoom,
              }}
            />
          )}
          {guidesVisible &&
            displayGuides.map((guide, index) => (
              <button
                key={guide.id}
                className={`canvas-guide guide-${guide.axis} ${guide.id === guideDraft?.id ? "is-dragging" : ""}`}
                data-canvas-control
                role="slider"
                aria-orientation={
                  guide.axis === "vertical" ? "horizontal" : "vertical"
                }
                aria-label={`${guide.axis === "vertical" ? "Vertical" : "Horizontal"} guide ${index + 1}`}
                aria-valuemin={0}
                aria-valuemax={
                  guide.axis === "vertical"
                    ? frame.canvas.width
                    : frame.canvas.height
                }
                aria-valuenow={Math.round(guide.position)}
                aria-valuetext={`${Math.round(guide.position)} pixels`}
                title="Drag to move. Arrow keys move 1px; Shift moves 10px; Delete removes."
                style={
                  guide.axis === "vertical"
                    ? { left: guide.position * zoom }
                    : { top: guide.position * zoom }
                }
                onPointerDown={(event) =>
                  beginGuideDrag(event, guide.axis, guide)
                }
                onPointerMove={moveGuideDrag}
                onPointerUp={endGuideDrag}
                onPointerCancel={cancelGuideDrag}
                onKeyDown={(event) => updateGuideFromKeyboard(guide, event)}
              />
            ))}
          {snapFeedback.lines.map((line, index) => (
            <span
              key={`${line.axis}-${line.position}-${index}`}
              className={`snap-line snap-${line.axis} kind-${line.kind}`}
              aria-hidden="true"
              style={
                line.axis === "vertical"
                  ? { left: line.position * zoom }
                  : { top: line.position * zoom }
              }
            />
          ))}
          {snapFeedback.spacing.map((spacing, index) => (
            <span
              key={`${spacing.axis}-${index}`}
              className={`spacing-indicator spacing-${spacing.axis}`}
              aria-hidden="true"
              style={
                spacing.axis === "horizontal"
                  ? {
                      left: spacing.start * zoom,
                      top: spacing.crossPosition * zoom,
                      width: (spacing.end - spacing.start) * zoom,
                    }
                  : {
                      left: spacing.crossPosition * zoom,
                      top: spacing.start * zoom,
                      height: (spacing.end - spacing.start) * zoom,
                    }
              }
            >
              <i>{Math.round(spacing.gap)} px</i>
            </span>
          ))}
          {cropEditSession && editingCropNode && overlay && (
            <form
              className="crop-edit-shell"
              aria-label={`Crop ${editingCropNode.name} on canvas`}
              style={{
                left: overlay.x * zoom,
                top: overlay.y * zoom,
                width: Math.max(overlay.width * zoom, 1),
                height: Math.max(overlay.height * zoom, 1),
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void commitCropEdit();
              }}
            >
              <div
                className="crop-pan-surface"
                role="application"
                data-studio-shortcuts="local"
                tabIndex={0}
                aria-label="Move image within crop bounds"
                aria-describedby="crop-edit-help crop-resolution-status"
                onPointerDown={beginCropPan}
                onPointerMove={moveCropPan}
                onPointerUp={endCropPan}
                onPointerCancel={() => {
                  const pan = cropPanRef.current;
                  if (pan) releaseCapture(pan);
                  cropPanRef.current = undefined;
                }}
                onKeyDown={(event) => {
                  const amount = event.shiftKey ? 24 : 8;
                  const delta =
                    event.key === "ArrowLeft"
                      ? { x: -amount, y: 0 }
                      : event.key === "ArrowRight"
                        ? { x: amount, y: 0 }
                        : event.key === "ArrowUp"
                          ? { x: 0, y: -amount }
                          : event.key === "ArrowDown"
                            ? { x: 0, y: amount }
                            : undefined;
                  if (!delta) return;
                  event.preventDefault();
                  nudgeCrop(delta.x, delta.y);
                }}
              >
                <span className="crop-crosshair" aria-hidden="true" />
              </div>
              <div className="crop-controls">
                <p id="crop-edit-help">
                  Drag or use arrow keys to move the source. Adjust zoom to
                  scale it inside the fixed crop bounds.
                </p>
                <label>
                  <span>Crop zoom</span>
                  <input
                    type="range"
                    aria-label="Crop zoom"
                    min="0.25"
                    max="8"
                    step="0.05"
                    value={cropEditSession.scale}
                    onChange={(event) =>
                      applyCropEditSession(
                        scaleCropSource(
                          cropEditSession,
                          Number(event.currentTarget.value),
                        ),
                      )
                    }
                  />
                  <output>{cropEditSession.scale.toFixed(2)}×</output>
                </label>
                <p
                  id="crop-resolution-status"
                  className={
                    cropResolutionStatus?.lowResolution
                      ? "crop-resolution is-warning"
                      : "crop-resolution"
                  }
                  role="status"
                >
                  {!currentCropNode
                    ? "This layer changed or was removed canonically. Saving will open conflict review."
                    : cropResolutionStatus
                      ? `${Math.round(cropResolutionStatus.sourceWidth)} × ${Math.round(cropResolutionStatus.sourceHeight)} effective source pixels${cropResolutionStatus.lowResolution ? " · low resolution" : ""}.`
                      : "Source resolution unavailable."}
                </p>
                <div className="crop-actions">
                  <button
                    type="button"
                    onClick={() =>
                      applyCropEditSession(resetCropEdit(cropEditSession))
                    }
                  >
                    Reset
                  </button>
                  <button type="button" onClick={cancelCropEdit}>
                    Cancel
                  </button>
                  <button type="submit">Apply crop</button>
                </div>
              </div>
            </form>
          )}
          {textEditSession && editingTextNode && overlay && (
            <form
              className="text-edit-shell"
              aria-label={`Edit ${editingTextNode.name} on canvas`}
              style={{
                left: overlay.x * zoom,
                top: overlay.y * zoom,
                width: Math.max(overlay.width * zoom, 1),
                minHeight: Math.max(overlay.height * zoom, 32),
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void commitTextEdit();
              }}
            >
              <label className="sr-only" htmlFor="direct-text-editor">
                Text content
              </label>
              <textarea
                id="direct-text-editor"
                ref={textAreaRef}
                value={textEditSession.text}
                aria-describedby="direct-text-layout-status direct-text-help"
                aria-invalid={textOverflows || undefined}
                spellCheck
                style={{
                  minHeight: Math.max(overlay.height * zoom, 32),
                  fontFamily: `ADR_${editingTextNode.typography.fontId.replaceAll("-", "_")}`,
                  fontSize: Math.max(
                    12,
                    editingTextNode.typography.fontSize * zoom,
                  ),
                  fontWeight: editingTextNode.typography.fontWeight,
                  fontStyle: editingTextNode.typography.fontStyle,
                  lineHeight: `${editingTextNode.typography.lineHeight * zoom}px`,
                  letterSpacing: `${editingTextNode.typography.letterSpacing * zoom}px`,
                  textAlign:
                    editingTextNode.typography.alignment === "justify"
                      ? "justify"
                      : editingTextNode.typography.alignment,
                  color: editingTextNode.typography.color,
                }}
                onChange={(event) => updateTextDraft(event.currentTarget.value)}
                onSelect={(event) => {
                  if (document.activeElement !== event.currentTarget) return;
                  updateTextSelection(
                    event.currentTarget.selectionStart,
                    event.currentTarget.selectionEnd,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelTextEdit();
                  } else if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    void commitTextEdit();
                  }
                }}
              />
              <div
                className="rich-text-toolbar"
                role="toolbar"
                aria-label="Rich text formatting"
                onPointerDownCapture={captureTextSelection}
              >
                <span className="rich-text-range" aria-live="polite">
                  {canFormatText
                    ? `Selection ${textSelection.start}–${textSelection.end}`
                    : "Select text to format"}
                </span>
                <label>
                  <span>Font</span>
                  <select
                    aria-label="Selection font"
                    value={
                      selectedTextStyle.fontId ??
                      editingTextNode.typography.fontId
                    }
                    disabled={!canFormatText}
                    onChange={(event) =>
                      formatTextSelection({ fontId: event.currentTarget.value })
                    }
                  >
                    {fonts.fonts.map((font) => (
                      <option key={font.id} value={font.id}>
                        {font.family} · {font.weight}
                        {font.style === "italic" ? " Italic" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Size</span>
                  <input
                    key={
                      selectedTextStyle.fontSize ??
                      editingTextNode.typography.fontSize
                    }
                    aria-label="Selection font size"
                    type="number"
                    min="1"
                    defaultValue={
                      selectedTextStyle.fontSize ??
                      editingTextNode.typography.fontSize
                    }
                    disabled={!canFormatText}
                    onBlur={(event) => {
                      const fontSize = Number(event.currentTarget.value);
                      if (fontSize > 0) formatTextSelection({ fontSize });
                    }}
                  />
                </label>
                <button
                  type="button"
                  aria-label="Bold selection"
                  disabled={!canFormatText}
                  onClick={() => formatTextSelection({ fontWeight: 700 })}
                >
                  B
                </button>
                <button
                  type="button"
                  aria-label="Italic selection"
                  disabled={!canFormatText}
                  onClick={() => formatTextSelection({ fontStyle: "italic" })}
                >
                  I
                </button>
                <label>
                  <span>Decoration</span>
                  <select
                    aria-label="Selection decoration"
                    value={selectedTextStyle.decoration ?? "none"}
                    disabled={!canFormatText}
                    onChange={(event) =>
                      formatTextSelection({
                        decoration: event.currentTarget.value as
                          "none" | "underline" | "lineThrough",
                      })
                    }
                  >
                    <option value="none">None</option>
                    <option value="underline">Underline</option>
                    <option value="lineThrough">Strike</option>
                  </select>
                </label>
                <label>
                  <span>Color</span>
                  <input
                    aria-label="Selection color"
                    type="color"
                    value={
                      selectedTextStyle.color ??
                      editingTextNode.typography.color
                    }
                    disabled={!canFormatText}
                    onChange={(event) =>
                      formatTextSelection({ color: event.currentTarget.value })
                    }
                  />
                </label>
                {(
                  [
                    [
                      "Selection opacity",
                      "Opacity",
                      selectedTextStyle.opacity ??
                        editingTextNode.typography.opacity,
                      0.05,
                    ],
                    [
                      "Selection tracking",
                      "Tracking",
                      selectedTextStyle.letterSpacing ??
                        editingTextNode.typography.letterSpacing,
                      0.5,
                    ],
                    [
                      "Selection baseline shift",
                      "Baseline",
                      selectedTextStyle.baselineShift ?? 0,
                      1,
                    ],
                  ] as const
                ).map(([ariaLabel, label, value, step]) => (
                  <label key={ariaLabel}>
                    <span>{label}</span>
                    <input
                      key={value}
                      aria-label={ariaLabel}
                      type="number"
                      min={ariaLabel === "Selection opacity" ? 0 : undefined}
                      max={ariaLabel === "Selection opacity" ? 1 : undefined}
                      step={step}
                      defaultValue={value}
                      disabled={!canFormatText}
                      onBlur={(event) => {
                        const next = Number(event.currentTarget.value);
                        if (!Number.isFinite(next)) return;
                        if (ariaLabel === "Selection opacity")
                          formatTextSelection({ opacity: next });
                        else if (ariaLabel === "Selection tracking")
                          formatTextSelection({ letterSpacing: next });
                        else formatTextSelection({ baselineShift: next });
                      }}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  disabled={!textEditSession.spans}
                  onClick={flattenTextFormatting}
                >
                  Use paragraph style
                </button>
              </div>
              <div className="text-edit-toolbar">
                <div>
                  <strong>{editingTextNode.name}</strong>
                  <span
                    id="direct-text-layout-status"
                    role={textOverflows ? "alert" : "status"}
                  >
                    {textLayoutStatus}
                  </span>
                  <span id="direct-text-help" className="sr-only">
                    Press Command or Control and Enter to save. Press Escape to
                    cancel without changing the frame.
                  </span>
                </div>
                <button type="button" onClick={cancelTextEdit}>
                  Cancel
                </button>
                <button className="primary" type="submit">
                  Save text
                </button>
              </div>
            </form>
          )}
          {marquee && (
            <div
              className="marquee-box"
              aria-hidden="true"
              style={{
                left: marquee.x * zoom,
                top: marquee.y * zoom,
                width: marquee.width * zoom,
                height: marquee.height * zoom,
              }}
            />
          )}
          {overlay &&
            selection.length > 0 &&
            !textEditSession &&
            !cropEditSession && (
              <div
                className="selection-box"
                aria-label={`${selection.length} selected layer${selection.length === 1 ? "" : "s"} transform bounds`}
                style={{
                  left: overlay.x * zoom,
                  top: overlay.y * zoom,
                  width: overlay.width * zoom,
                  height: overlay.height * zoom,
                }}
                onPointerMove={move}
                onPointerUp={(event) => void end(event)}
                onPointerCancel={cancelGesture}
                onLostPointerCapture={cancelGesture}
              >
                {selection.length === 1 && (
                  <>
                    {selectedNode?.type === "text" && (
                      <button
                        className="direct-text-trigger"
                        aria-label="Edit text on canvas"
                        title="Edit text on canvas (F2)"
                        disabled={selectedNode.locked || !selectedNode.visible}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() =>
                          executeStudioCommand({ id: "selection.edit-text" })
                        }
                      >
                        Edit text
                      </button>
                    )}
                    {selectedNode?.type === "rasterImage" && (
                      <button
                        className="direct-crop-trigger"
                        aria-label="Crop image on canvas"
                        title="Crop image on canvas"
                        disabled={selectedNode.locked || !selectedNode.visible}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() =>
                          executeStudioCommand({ id: "selection.edit-crop" })
                        }
                      >
                        Crop
                      </button>
                    )}
                    {(["nw", "ne", "se", "sw"] as const).map((corner) => (
                      <button
                        key={corner}
                        className={`corner-rotate rotate-${corner}`}
                        aria-label={`Rotate selected layer from ${corner.toUpperCase()} corner`}
                        onPointerDown={(event) =>
                          begin(event, "rotate", selection[0])
                        }
                        onKeyDown={(event) =>
                          handleTransformKey(event, "rotate")
                        }
                      />
                    ))}
                    <button
                      className="resize-handle resize-nw"
                      aria-label="Resize from top left"
                      onPointerDown={(event) =>
                        begin(event, "resize-nw", selection[0])
                      }
                      onKeyDown={(event) =>
                        handleTransformKey(event, "resize-nw")
                      }
                    />
                    <button
                      className="resize-handle resize-se"
                      aria-label="Scale selected layer"
                      onPointerDown={(event) =>
                        begin(event, "resize", selection[0])
                      }
                      onKeyDown={(event) => handleTransformKey(event, "resize")}
                    />
                  </>
                )}
              </div>
            )}
        </div>
      </div>
      {renderError && (
        <div className="canvas-error" role="alert">
          Renderer blocked: {renderError}
        </div>
      )}
    </div>
  );
}
