import { describe, expect, it } from "vitest";
import { createFrameDocument } from "@tva-agentic-design/core";
import {
  retainExistingSelection,
  selectNode,
  selectNodes,
} from "../src/selection-service";

describe("selection service", () => {
  it("replaces, toggles, and clears one selection deterministically", () => {
    expect(selectNode(["one"], "two")).toEqual(["two"]);
    expect(selectNode(["one", "two"], "two", true)).toEqual(["one"]);
    expect(selectNode(["one"], "two", true)).toEqual(["one", "two"]);
    expect(selectNode(["one"])).toEqual([]);
  });

  it("deduplicates replacement and additive marquee selections", () => {
    expect(selectNodes(["one"], ["two", "two", "three"])).toEqual([
      "two",
      "three",
    ]);
    expect(
      selectNodes(["one", "two"], ["two", "three", "three"], true),
    ).toEqual(["one", "two", "three"]);
  });

  it("retains only IDs that still exist after a canonical commit", () => {
    const frame = createFrameDocument({
      id: crypto.randomUUID(),
      slug: "selection",
      name: "Selection",
      width: 100,
      height: 100,
      now: "2026-08-10T12:00:00.000Z",
    });
    frame.root.children.push({
      id: "11111111-1111-4111-8111-111111111111",
      type: "rectangle",
      name: "Existing",
      visible: true,
      locked: false,
      transform: {
        x: 0,
        y: 0,
        width: 20,
        height: 20,
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
      fill: { type: "solid", color: "#000000", opacity: 1 },
      cornerRadius: {
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
      },
    });
    expect(
      retainExistingSelection(
        [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
        frame,
      ),
    ).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });
});
