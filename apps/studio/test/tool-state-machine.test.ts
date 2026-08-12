import { describe, expect, it } from "vitest";
import {
  INITIAL_TOOL_STATE,
  toolStateLabel,
  transitionToolState,
} from "../src/tool-state-machine";

describe("Studio tool-state machine", () => {
  it("models the current selection interactions explicitly", () => {
    const marquee = transitionToolState(INITIAL_TOOL_STATE, {
      type: "begin-marquee",
    });
    expect(toolStateLabel(marquee)).toBe("select:marquee");
    expect(transitionToolState(marquee, { type: "finish" })).toEqual(
      INITIAL_TOOL_STATE,
    );

    const transform = transitionToolState(INITIAL_TOOL_STATE, {
      type: "begin-transform",
      mode: "rotate",
    });
    expect(toolStateLabel(transform)).toBe("select:transform:rotate");
    expect(transitionToolState(transform, { type: "cancel" })).toEqual(
      INITIAL_TOOL_STATE,
    );
  });

  it("rejects a second interaction until the current one terminates", () => {
    const moving = transitionToolState(INITIAL_TOOL_STATE, {
      type: "begin-transform",
      mode: "move",
    });
    expect(transitionToolState(moving, { type: "begin-marquee" })).toBe(moving);
  });

  it("models direct text editing without creating a mutation authority", () => {
    const editing = transitionToolState(INITIAL_TOOL_STATE, {
      type: "begin-text-edit",
      nodeId: "headline",
    });
    expect(editing).toEqual({
      tool: "text",
      interaction: "editing",
      nodeId: "headline",
    });
    expect(toolStateLabel(editing)).toBe("text:editing");
    expect(transitionToolState(editing, { type: "finish" })).toEqual(
      INITIAL_TOOL_STATE,
    );
  });

  it("models crop editing as an exclusive tool state", () => {
    const editing = transitionToolState(INITIAL_TOOL_STATE, {
      type: "begin-crop-edit",
      nodeId: "photo",
    });
    expect(editing).toEqual({
      tool: "crop",
      interaction: "editing",
      nodeId: "photo",
    });
    expect(toolStateLabel(editing)).toBe("crop:editing");
    expect(
      transitionToolState(editing, {
        type: "begin-transform",
        mode: "move",
      }),
    ).toBe(editing);
    expect(transitionToolState(editing, { type: "cancel" })).toEqual(
      INITIAL_TOOL_STATE,
    );
  });
});
