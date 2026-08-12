import {
  assertNever,
  createTransform,
  descendantIds,
  findNode,
  findNodeLocation,
  type FrameOperation,
  type SceneNode,
} from "@tva-agentic-design/core";
import { useStudio, type StudioState } from "./store";

export type AlignmentMode =
  "left" | "center" | "right" | "top" | "middle" | "bottom";

export type StudioCommandInvocation =
  | { id: "tool.select" }
  | { id: "tool.text" }
  | { id: "history.undo" }
  | { id: "history.redo" }
  | { id: "selection.clear" }
  | { id: "selection.delete" }
  | { id: "selection.duplicate" }
  | { id: "selection.group" }
  | { id: "selection.mask" }
  | { id: "selection.edit-text"; nodeId?: string }
  | { id: "selection.edit-crop"; nodeId?: string }
  | { id: "selection.add-adjustment" }
  | { id: "selection.nudge"; dx: number; dy: number }
  | { id: "selection.align"; mode: AlignmentMode }
  | { id: "selection.distribute"; axis: "horizontal" | "vertical" }
  | { id: "layer.create-rectangle" }
  | { id: "layer.create-ellipse" }
  | { id: "layer.create-vector" }
  | { id: "layer.create-text" }
  | { id: "layer.create-image" }
  | { id: "layer.toggle-visibility"; nodeId: string }
  | { id: "layer.toggle-lock"; nodeId: string }
  | { id: "layer.reorder"; nodeId: string; delta: number }
  | { id: "layer.move"; nodeId: string; parentId: string; index: number }
  | { id: "view.zoom"; delta: number };

export type StudioCommandId = StudioCommandInvocation["id"];

export type StudioCommandDefinition = {
  id: StudioCommandId;
  label: string;
  description: string;
};

export const studioCommandRegistry: readonly StudioCommandDefinition[] = [
  {
    id: "tool.select",
    label: "Select tool",
    description: "Select and transform layers on the Canvas.",
  },
  {
    id: "tool.text",
    label: "Text tool",
    description: "Click existing text to edit or empty canvas to create text.",
  },
  {
    id: "history.undo",
    label: "Undo",
    description: "Undo the last canonical revision.",
  },
  {
    id: "history.redo",
    label: "Redo",
    description: "Redo the next canonical revision.",
  },
  {
    id: "selection.clear",
    label: "Clear selection",
    description: "Clear the current layer selection.",
  },
  {
    id: "selection.delete",
    label: "Delete selection",
    description: "Delete top-level selected layers.",
  },
  {
    id: "selection.duplicate",
    label: "Duplicate selection",
    description:
      "Duplicate one selected layer with stable descendant remapping.",
  },
  {
    id: "selection.group",
    label: "Group selection",
    description: "Group selected sibling layers.",
  },
  {
    id: "selection.mask",
    label: "Mask selection",
    description: "Wrap selected layers in an alpha mask.",
  },
  {
    id: "selection.edit-text",
    label: "Edit text on canvas",
    description:
      "Open the selected text layer in the local direct-edit surface.",
  },
  {
    id: "selection.edit-crop",
    label: "Crop image on canvas",
    description:
      "Open the selected raster layer in the local non-destructive crop surface.",
  },
  {
    id: "selection.add-adjustment",
    label: "Add adjustment",
    description: "Add a neutral adjustment for the valid current target.",
  },
  {
    id: "selection.nudge",
    label: "Nudge selection",
    description: "Move unlocked selected layers by an exact delta.",
  },
  {
    id: "selection.align",
    label: "Align selection",
    description: "Align selected sibling layers.",
  },
  {
    id: "selection.distribute",
    label: "Distribute selection",
    description: "Distribute selected sibling layers with equal gaps.",
  },
  {
    id: "layer.create-rectangle",
    label: "Add rectangle",
    description: "Create a centered rectangle layer.",
  },
  {
    id: "layer.create-ellipse",
    label: "Add ellipse",
    description: "Create a centered ellipse layer.",
  },
  {
    id: "layer.create-vector",
    label: "Add vector path",
    description: "Create a centered editable cubic path layer.",
  },
  {
    id: "layer.create-text",
    label: "Add text",
    description: "Create text using the first imported project font.",
  },
  {
    id: "layer.create-image",
    label: "Add image",
    description: "Create an image from the first imported raster asset.",
  },
  {
    id: "layer.toggle-visibility",
    label: "Toggle visibility",
    description: "Toggle one layer's canonical visibility.",
  },
  {
    id: "layer.toggle-lock",
    label: "Toggle lock",
    description: "Toggle one layer's canonical lock state.",
  },
  {
    id: "layer.reorder",
    label: "Reorder layer",
    description: "Move one layer within its current parent.",
  },
  {
    id: "layer.move",
    label: "Move layer",
    description: "Move one layer to an explicit parent and index.",
  },
  {
    id: "view.zoom",
    label: "Change zoom",
    description: "Change the local Canvas zoom without mutating the frame.",
  },
] as const;

const createNode = (state: StudioState, node: SceneNode): void => {
  void state.commit([{ kind: "createNode", parentId: "root", node }]);
};

const nodeBase = (state: StudioState) => {
  const frame = state.activeFrame;
  const center = frame
    ? { x: frame.canvas.width / 2 - 140, y: frame.canvas.height / 2 - 90 }
    : { x: 0, y: 0 };
  return {
    center,
    base: {
      visible: true,
      locked: false,
      transform: createTransform({ ...center, width: 280, height: 180 }),
      opacity: 1,
      blendMode: "normal" as const,
    },
  };
};

const selectedNodes = (state: StudioState) =>
  state.activeFrame
    ? state.selection
        .map((id) => findNode(state.activeFrame!, id))
        .filter((node): node is Exclude<SceneNode, { type: "adjustment" }> =>
          Boolean(node && node.type !== "adjustment"),
        )
    : [];

const commonParent = (state: StudioState, nodes: SceneNode[]): boolean =>
  Boolean(
    state.activeFrame &&
    nodes.length > 1 &&
    new Set(
      nodes.map(
        (node) => findNodeLocation(state.activeFrame!, node.id)?.parentId,
      ),
    ).size === 1,
  );

export const isStudioCommandEnabled = (
  invocation: StudioCommandInvocation,
  state = useStudio.getState(),
): boolean => {
  const frame = state.activeFrame;
  switch (invocation.id) {
    case "tool.select":
      return true;
    case "tool.text":
      return Boolean(frame && state.fonts.fonts.length);
    case "history.undo":
    case "history.redo":
      return Boolean(frame);
    case "selection.clear":
    case "selection.delete":
    case "selection.group":
    case "selection.mask":
    case "selection.nudge":
      return Boolean(frame && state.selection.length);
    case "selection.duplicate":
      return Boolean(frame && state.selection.length === 1);
    case "selection.edit-text": {
      if (!frame) return false;
      const nodeId = invocation.nodeId ?? state.selection[0];
      if (!nodeId || (!invocation.nodeId && state.selection.length !== 1))
        return false;
      const node = findNode(frame, nodeId);
      return Boolean(
        node && node.type === "text" && node.visible && !node.locked,
      );
    }
    case "selection.edit-crop": {
      if (!frame) return false;
      const nodeId = invocation.nodeId ?? state.selection[0];
      if (!nodeId || (!invocation.nodeId && state.selection.length !== 1))
        return false;
      const node = findNode(frame, nodeId);
      return Boolean(
        node && node.type === "rasterImage" && node.visible && !node.locked,
      );
    }
    case "selection.add-adjustment": {
      if (!frame || state.selection.length > 1) return false;
      if (state.selection.length === 0) return true;
      const node = findNode(frame, state.selection[0]!);
      return Boolean(
        node &&
        ["rasterImage", "svg", "vectorPath", "group", "mask"].includes(
          node.type,
        ),
      );
    }
    case "selection.align":
      return commonParent(state, selectedNodes(state));
    case "selection.distribute": {
      const nodes = selectedNodes(state);
      return nodes.length >= 3 && commonParent(state, nodes);
    }
    case "layer.create-rectangle":
    case "layer.create-ellipse":
    case "layer.create-vector":
      return Boolean(frame);
    case "layer.create-text":
      return Boolean(frame && state.fonts.fonts.length);
    case "layer.create-image":
      return Boolean(
        frame && state.assets.assets.some((asset) => asset.type === "raster"),
      );
    case "layer.toggle-visibility":
    case "layer.toggle-lock":
    case "layer.reorder":
    case "layer.move":
      return Boolean(frame && findNode(frame, invocation.nodeId));
    case "view.zoom":
      return true;
    default:
      return assertNever(invocation, "Studio command enablement");
  }
};

export const executeStudioCommand = (
  invocation: StudioCommandInvocation,
): void => {
  const state = useStudio.getState();
  if (!isStudioCommandEnabled(invocation, state)) return;
  const frame = state.activeFrame;
  switch (invocation.id) {
    case "tool.select":
      state.setCanvasTool("select");
      return;
    case "tool.text":
      state.setCanvasTool("text");
      return;
    case "history.undo":
      void state.undo();
      return;
    case "history.redo":
      void state.redo();
      return;
    case "selection.clear":
      state.select();
      return;
    case "selection.delete": {
      if (!frame) return;
      const selected = new Set(state.selection);
      const top = state.selection.filter((id) => {
        let location = findNodeLocation(frame, id);
        while (location && location.parentId !== "root") {
          if (selected.has(location.parentId)) return false;
          location = findNodeLocation(frame, location.parentId);
        }
        return true;
      });
      const operations: FrameOperation[] = [];
      for (const id of top) {
        const node = findNode(frame, id);
        if (!node) continue;
        operations.push(
          node.type === "adjustment"
            ? { kind: "removeAdjustment", adjustmentId: id }
            : { kind: "deleteNode", nodeId: id },
        );
      }
      if (operations.length) void state.commit(operations);
      return;
    }
    case "selection.duplicate": {
      if (!frame) return;
      const node = findNode(frame, state.selection[0]!);
      if (!node) return;
      const idMap = Object.fromEntries(
        [...descendantIds(node)].map((id) => [id, crypto.randomUUID()]),
      );
      void state.commit([
        {
          kind: "duplicateNode",
          nodeId: node.id,
          idMap,
          offset: { x: 24, y: 24 },
        },
      ]);
      return;
    }
    case "selection.edit-text": {
      const nodeId = invocation.nodeId ?? state.selection[0];
      if (!nodeId) return;
      if (!state.selection.includes(nodeId)) state.select(nodeId);
      state.requestTextEdit(nodeId);
      return;
    }
    case "selection.edit-crop": {
      const nodeId = invocation.nodeId ?? state.selection[0];
      if (!nodeId) return;
      if (!state.selection.includes(nodeId)) state.select(nodeId);
      state.requestCropEdit(nodeId);
      return;
    }
    case "selection.group":
      void state.commit([
        {
          kind: "groupNodes",
          nodeIds: state.selection,
          groupId: crypto.randomUUID(),
          name: "Group",
        },
      ]);
      return;
    case "selection.mask": {
      if (!frame) return;
      const node = findNode(frame, state.selection[0]!);
      if (!node || node.type === "adjustment") return;
      void state.commit([
        {
          kind: "applyMask",
          maskId: crypto.randomUUID(),
          name: "Mask",
          mode: "alpha",
          inverted: false,
          maskSource: {
            id: crypto.randomUUID(),
            type: "rectangle",
            name: "Mask shape",
            visible: true,
            locked: false,
            transform: createTransform({
              width: node.transform.width,
              height: node.transform.height,
            }),
            opacity: 1,
            blendMode: "normal",
            fill: { type: "solid", color: "#FFFFFF", opacity: 1 },
            cornerRadius: {
              topLeft: 0,
              topRight: 0,
              bottomRight: 0,
              bottomLeft: 0,
            },
          },
          nodeIds: state.selection,
        },
      ]);
      return;
    }
    case "selection.add-adjustment": {
      if (!frame) return;
      const node =
        state.selection.length === 1
          ? findNode(frame, state.selection[0]!)
          : undefined;
      const targetId = node ? node.id : "root";
      void state.commit([
        {
          kind: "addAdjustment",
          adjustment: {
            id: crypto.randomUUID(),
            type: "adjustment",
            name: "Adjustment",
            visible: true,
            locked: false,
            transform: createTransform({ width: 1, height: 1 }),
            enabled: true,
            targetId,
            values: {
              brightness: 0,
              contrast: 0,
              saturation: 0,
              hue: 0,
              blur: 0,
            },
          },
        },
      ]);
      return;
    }
    case "selection.nudge": {
      if (!frame) return;
      const operations = state.selection.flatMap<FrameOperation>((id) => {
        const node = findNode(frame, id);
        if (!node || node.type === "adjustment" || node.locked) return [];
        return [
          {
            kind: "updateNode",
            nodeId: id,
            propertyGroup: "transform",
            value: {
              x: node.transform.x + invocation.dx,
              y: node.transform.y + invocation.dy,
            },
          },
        ];
      });
      if (operations.length) void state.commit(operations);
      return;
    }
    case "selection.align": {
      const nodes = selectedNodes(state);
      if (!commonParent(state, nodes)) return;
      const left = Math.min(...nodes.map((node) => node.transform.x));
      const right = Math.max(
        ...nodes.map((node) => node.transform.x + node.transform.width),
      );
      const top = Math.min(...nodes.map((node) => node.transform.y));
      const bottom = Math.max(
        ...nodes.map((node) => node.transform.y + node.transform.height),
      );
      void state.commit(
        nodes.map((node) => ({
          kind: "updateNode" as const,
          nodeId: node.id,
          propertyGroup: "transform" as const,
          value:
            invocation.mode === "left"
              ? { x: left }
              : invocation.mode === "center"
                ? { x: (left + right - node.transform.width) / 2 }
                : invocation.mode === "right"
                  ? { x: right - node.transform.width }
                  : invocation.mode === "top"
                    ? { y: top }
                    : invocation.mode === "middle"
                      ? { y: (top + bottom - node.transform.height) / 2 }
                      : { y: bottom - node.transform.height },
        })),
      );
      return;
    }
    case "selection.distribute": {
      const nodes = selectedNodes(state);
      if (nodes.length < 3 || !commonParent(state, nodes)) return;
      const position = invocation.axis === "horizontal" ? "x" : "y";
      const size = invocation.axis === "horizontal" ? "width" : "height";
      const ordered = [...nodes].sort(
        (left, right) => left.transform[position] - right.transform[position],
      );
      const start = ordered[0]!.transform[position];
      const end =
        ordered.at(-1)!.transform[position] + ordered.at(-1)!.transform[size];
      const occupied = ordered.reduce(
        (sum, node) => sum + node.transform[size],
        0,
      );
      const gap = (end - start - occupied) / (ordered.length - 1);
      let cursor = start;
      void state.commit(
        ordered.map((node) => {
          const value = { [position]: cursor };
          cursor += node.transform[size] + gap;
          return {
            kind: "updateNode" as const,
            nodeId: node.id,
            propertyGroup: "transform" as const,
            value,
          };
        }),
      );
      return;
    }
    case "layer.create-rectangle": {
      const { base } = nodeBase(state);
      createNode(state, {
        id: crypto.randomUUID(),
        type: "rectangle",
        name: "Rectangle",
        ...base,
        fill: { type: "solid", color: "#315BFF", opacity: 1 },
        cornerRadius: {
          topLeft: 16,
          topRight: 16,
          bottomRight: 16,
          bottomLeft: 16,
        },
      });
      return;
    }
    case "layer.create-ellipse": {
      const { base } = nodeBase(state);
      createNode(state, {
        id: crypto.randomUUID(),
        type: "ellipse",
        name: "Ellipse",
        ...base,
        fill: { type: "solid", color: "#F0A24A", opacity: 1 },
      });
      return;
    }
    case "layer.create-vector": {
      const { base } = nodeBase(state);
      createNode(state, {
        id: crypto.randomUUID(),
        type: "vectorPath",
        name: "Vector path",
        ...base,
        commands: [
          { id: crypto.randomUUID(), kind: "move", to: { x: 0.05, y: 0.8 } },
          {
            id: crypto.randomUUID(),
            kind: "cubic",
            control1: { x: 0.25, y: 0.05 },
            control2: { x: 0.75, y: 0.05 },
            to: { x: 0.95, y: 0.8 },
          },
          { id: crypto.randomUUID(), kind: "line", to: { x: 0.5, y: 0.95 } },
          { id: crypto.randomUUID(), kind: "close" },
        ],
        fill: { type: "solid", color: "#315BFF", opacity: 1 },
      });
      return;
    }
    case "layer.create-text": {
      const { base, center } = nodeBase(state);
      const font = state.fonts.fonts[0]!;
      createNode(state, {
        id: crypto.randomUUID(),
        type: "text",
        name: "Text",
        ...base,
        text: "Precision, made visible.",
        transform: createTransform({ ...center, width: 480, height: 96 }),
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
          width: 480,
          height: 96,
          wrapping: "word",
          overflow: "clip",
        },
      });
      return;
    }
    case "layer.create-image": {
      const { base } = nodeBase(state);
      const asset = state.assets.assets.find(
        (candidate) => candidate.type === "raster",
      )!;
      createNode(state, {
        id: crypto.randomUUID(),
        type: "rasterImage",
        name: "Image",
        ...base,
        assetId: asset.id,
        fit: "cover",
      });
      return;
    }
    case "layer.toggle-visibility": {
      if (!frame) return;
      const node = findNode(frame, invocation.nodeId);
      if (!node) return;
      void state.commit([
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "visibility",
          value: { visible: !node.visible },
        },
      ]);
      return;
    }
    case "layer.toggle-lock": {
      if (!frame) return;
      const node = findNode(frame, invocation.nodeId);
      if (!node) return;
      void state.commit([
        {
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup: "locking",
          value: { locked: !node.locked },
        },
      ]);
      return;
    }
    case "layer.reorder": {
      if (!frame) return;
      const location = findNodeLocation(frame, invocation.nodeId);
      if (!location || location.locationKind !== "child") return;
      void state.commit([
        {
          kind: "reorderNode",
          nodeId: invocation.nodeId,
          index: Math.max(0, location.index + invocation.delta),
        },
      ]);
      return;
    }
    case "layer.move":
      void state.commit([
        {
          kind: "moveNode",
          nodeId: invocation.nodeId,
          parentId: invocation.parentId,
          index: invocation.index,
        },
      ]);
      return;
    case "view.zoom":
      state.setZoom(state.zoom + invocation.delta);
      return;
    default:
      return assertNever(invocation, "Studio command execution");
  }
};
