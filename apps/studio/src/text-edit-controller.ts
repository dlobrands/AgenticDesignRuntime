import {
  applyTextSpanStyle,
  reconcileTextSpans,
  stableStringify,
  type FrameOperation,
  type TextNode,
  type TextSpan,
  type TextSpanStyle,
} from "@agentic-design/core";

export type TextEditSession = {
  mode: "existing" | "new";
  projectId: string;
  frameId: string;
  nodeId: string;
  baseRevision: number;
  originalText: string;
  originalSpans?: TextSpan[];
  text: string;
  spans?: TextSpan[];
  nodeSnapshot: TextNode;
};

export const beginTextEdit = (input: {
  projectId: string;
  frameId: string;
  revision: number;
  node: TextNode;
}): TextEditSession => ({
  mode: "existing",
  projectId: input.projectId,
  frameId: input.frameId,
  nodeId: input.node.id,
  baseRevision: input.revision,
  originalText: input.node.text,
  ...(input.node.spans
    ? { originalSpans: structuredClone(input.node.spans) }
    : {}),
  text: input.node.text,
  ...(input.node.spans ? { spans: structuredClone(input.node.spans) } : {}),
  nodeSnapshot: structuredClone(input.node),
});

export const beginNewTextEdit = (input: {
  projectId: string;
  frameId: string;
  revision: number;
  node: TextNode;
}): TextEditSession => ({
  mode: "new",
  projectId: input.projectId,
  frameId: input.frameId,
  nodeId: input.node.id,
  baseRevision: input.revision,
  originalText: "",
  text: input.node.text,
  nodeSnapshot: structuredClone(input.node),
});

export const updateTextEdit = (
  session: TextEditSession,
  text: string,
): TextEditSession => {
  const next: TextEditSession = { ...session, text };
  if (session.spans) {
    const spans = reconcileTextSpans({
      nodeId: session.nodeId,
      previousText: session.text,
      nextText: text,
      spans: session.spans,
    });
    if (spans) next.spans = spans;
    else delete next.spans;
  }
  return next;
};

export const formatTextEditSelection = (
  session: TextEditSession,
  start: number,
  end: number,
  style: TextSpanStyle,
): TextEditSession => ({
  ...session,
  spans: applyTextSpanStyle({
    node: {
      id: session.nodeId,
      text: session.text,
      ...(session.spans ? { spans: session.spans } : {}),
    },
    start,
    end,
    style,
  }),
});

export const flattenTextEditFormatting = (
  session: TextEditSession,
): TextEditSession => {
  const next = { ...session };
  delete next.spans;
  return next;
};

export const textEditOperation = (
  session: TextEditSession,
): FrameOperation | undefined => {
  if (session.mode === "new") {
    if (session.text.length === 0) return undefined;
    const node: TextNode = {
      ...structuredClone(session.nodeSnapshot),
      text: session.text,
    };
    if (session.spans) node.spans = structuredClone(session.spans);
    else delete node.spans;
    return { kind: "createNode", parentId: "root", node };
  }
  return session.text === session.originalText &&
    stableStringify(session.spans ?? null) ===
      stableStringify(session.originalSpans ?? null)
    ? undefined
    : {
        kind: "updateNode",
        nodeId: session.nodeId,
        propertyGroup: "textContent",
        value: {
          text: session.text,
          spans: session.spans ? structuredClone(session.spans) : null,
        },
      };
};

export const textEditFitsSessionScope = (
  session: TextEditSession,
  projectId: string | undefined,
  frameId: string | undefined,
): boolean => session.projectId === projectId && session.frameId === frameId;
