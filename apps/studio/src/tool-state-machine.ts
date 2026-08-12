import type { TransformGestureMode } from "./gesture-controller";

export type StudioToolState =
  | { tool: "select"; interaction: "idle" }
  | { tool: "select"; interaction: "marquee" }
  | {
      tool: "select";
      interaction: "transform";
      mode: TransformGestureMode;
    }
  | { tool: "text"; interaction: "editing"; nodeId: string }
  | { tool: "crop"; interaction: "editing"; nodeId: string };

export type StudioToolEvent =
  | { type: "begin-marquee" }
  | { type: "begin-transform"; mode: TransformGestureMode }
  | { type: "begin-text-edit"; nodeId: string }
  | { type: "begin-crop-edit"; nodeId: string }
  | { type: "finish" }
  | { type: "cancel" };

export const INITIAL_TOOL_STATE: StudioToolState = {
  tool: "select",
  interaction: "idle",
};

export const transitionToolState = (
  state: StudioToolState,
  event: StudioToolEvent,
): StudioToolState => {
  switch (event.type) {
    case "begin-marquee":
      return state.interaction === "idle"
        ? { tool: "select", interaction: "marquee" }
        : state;
    case "begin-transform":
      return state.interaction === "idle"
        ? {
            tool: "select",
            interaction: "transform",
            mode: event.mode,
          }
        : state;
    case "begin-text-edit":
      return state.interaction === "idle"
        ? { tool: "text", interaction: "editing", nodeId: event.nodeId }
        : state;
    case "begin-crop-edit":
      return state.interaction === "idle"
        ? { tool: "crop", interaction: "editing", nodeId: event.nodeId }
        : state;
    case "finish":
    case "cancel":
      return INITIAL_TOOL_STATE;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
};

export const toolStateLabel = (state: StudioToolState): string =>
  state.interaction === "transform"
    ? `${state.tool}:${state.interaction}:${state.mode}`
    : `${state.tool}:${state.interaction}`;
