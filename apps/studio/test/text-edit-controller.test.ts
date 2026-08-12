import { describe, expect, it } from "vitest";
import type { TextNode } from "@agentic-design/core";
import {
  beginNewTextEdit,
  beginTextEdit,
  flattenTextEditFormatting,
  formatTextEditSelection,
  textEditFitsSessionScope,
  textEditOperation,
  updateTextEdit,
} from "../src/text-edit-controller";

const node: TextNode = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "text",
  name: "Headline",
  visible: true,
  locked: false,
  transform: {
    x: 20,
    y: 30,
    width: 300,
    height: 90,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    anchorX: 0,
    anchorY: 0,
  },
  opacity: 1,
  blendMode: "normal",
  text: "Original",
  typography: {
    fontId: "22222222-2222-4222-8222-222222222222",
    fontSize: 32,
    fontWeight: 600,
    fontStyle: "normal",
    lineHeight: 40,
    letterSpacing: 0,
    alignment: "left",
    verticalAlignment: "top",
    color: "#FFFFFF",
    opacity: 1,
  },
  textBox: {
    mode: "fixed",
    width: 300,
    height: 90,
    wrapping: "word",
    overflow: "clip",
    overflowAccepted: false,
  },
};

describe("text edit controller", () => {
  it("keeps an unchanged edit local and produces one semantic operation", () => {
    const session = beginTextEdit({
      projectId: "project",
      frameId: "frame",
      revision: 7,
      node,
    });
    expect(textEditOperation(session)).toBeUndefined();
    expect(textEditOperation(updateTextEdit(session, "Revised"))).toEqual({
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "textContent",
      value: { text: "Revised", spans: null },
    });
    expect(session.nodeSnapshot).not.toBe(node);
  });

  it("formats a selected range and can explicitly flatten it", () => {
    const session = beginTextEdit({
      projectId: "project",
      frameId: "frame",
      revision: 7,
      node,
    });
    const formatted = formatTextEditSelection(session, 0, 4, {
      fontWeight: 800,
      color: "#3366FF",
      baselineShift: 2,
      decoration: "underline",
    });
    expect(formatted.spans?.[0]).toMatchObject({
      start: 0,
      end: 4,
      style: {
        fontWeight: 800,
        color: "#3366FF",
        baselineShift: 2,
        decoration: "underline",
      },
    });
    expect(textEditOperation(formatted)).toMatchObject({
      propertyGroup: "textContent",
      value: { text: "Original", spans: formatted.spans },
    });
    expect(
      textEditOperation(flattenTextEditFormatting(formatted)),
    ).toBeUndefined();
  });

  it("retains edits only inside their project/frame scope", () => {
    const session = beginTextEdit({
      projectId: "project",
      frameId: "frame",
      revision: 7,
      node,
    });
    expect(textEditFitsSessionScope(session, "project", "frame")).toBe(true);
    expect(textEditFitsSessionScope(session, "project", "other")).toBe(false);
  });

  it("keeps a new text layer local until non-empty content is committed", () => {
    const session = beginNewTextEdit({
      projectId: "project",
      frameId: "frame",
      revision: 7,
      node: { ...node, text: "Text" },
    });
    expect(textEditOperation(updateTextEdit(session, ""))).toBeUndefined();
    expect(textEditOperation(updateTextEdit(session, "New headline"))).toEqual({
      kind: "createNode",
      parentId: "root",
      node: expect.objectContaining({
        id: node.id,
        type: "text",
        text: "New headline",
      }),
    });
  });
});
