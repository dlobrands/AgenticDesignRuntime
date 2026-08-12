import { describe, expect, it } from "vitest";
import { studioCommandRegistry } from "../src/commands";
import {
  assertNoShortcutConflicts,
  studioShortcutRegistry,
  type StudioShortcut,
} from "../src/shortcuts";

const keyboardEvent = (
  key: string,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent =>
  ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }) as KeyboardEvent;

describe("Studio command and shortcut registries", () => {
  it("keeps command IDs and shortcut declarations unique", () => {
    expect(new Set(studioCommandRegistry.map(({ id }) => id)).size).toBe(
      studioCommandRegistry.length,
    );
    expect(() => assertNoShortcutConflicts()).not.toThrow();
  });

  it("fails fast when two shortcuts claim the same keys in one context", () => {
    const duplicate: StudioShortcut = {
      ...studioShortcutRegistry[0]!,
      id: "duplicate-binding",
    };
    expect(() =>
      assertNoShortcutConflicts([studioShortcutRegistry[0]!, duplicate]),
    ).toThrow(/Shortcut conflict/);
  });

  it("maps declared shortcuts only to registered commands", () => {
    const commandIds = new Set(studioCommandRegistry.map(({ id }) => id));
    const representativeEvents = new Map<string, KeyboardEvent>([
      ["select-tool", keyboardEvent("v")],
      ["text-tool", keyboardEvent("t")],
      ["undo", keyboardEvent("z", { metaKey: true })],
      ["redo", keyboardEvent("z", { metaKey: true, shiftKey: true })],
      ["duplicate", keyboardEvent("d", { metaKey: true })],
      ["group", keyboardEvent("g", { metaKey: true })],
      ["zoom-in", keyboardEvent("+", { metaKey: true })],
      ["zoom-out", keyboardEvent("-", { metaKey: true })],
      ["delete", keyboardEvent("Delete")],
      ["clear-selection", keyboardEvent("Escape")],
      ["edit-text", keyboardEvent("F2")],
      ["nudge-arrowleft", keyboardEvent("ArrowLeft")],
      ["nudge-arrowright", keyboardEvent("ArrowRight")],
      ["nudge-arrowup", keyboardEvent("ArrowUp")],
      ["nudge-arrowdown", keyboardEvent("ArrowDown")],
    ]);
    for (const shortcut of studioShortcutRegistry) {
      const event = representativeEvents.get(shortcut.id);
      expect(event, shortcut.id).toBeDefined();
      expect(shortcut.matches(event!), shortcut.id).toBe(true);
      expect(commandIds.has(shortcut.command(event!).id), shortcut.id).toBe(
        true,
      );
    }
  });
});
