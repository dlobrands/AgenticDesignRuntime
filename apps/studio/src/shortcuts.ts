import type { StudioCommandInvocation } from "./commands";

export type StudioShortcut = {
  id: string;
  label: string;
  keys: string;
  when: "canvas";
  matches: (event: KeyboardEvent) => boolean;
  command: (event: KeyboardEvent) => StudioCommandInvocation;
};

const primary = (event: KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey;
const plain = (event: KeyboardEvent): boolean =>
  !event.metaKey && !event.ctrlKey && !event.altKey;

export const studioShortcutRegistry: readonly StudioShortcut[] = [
  {
    id: "select-tool",
    label: "Select tool",
    keys: "V",
    when: "canvas",
    matches: (event) => plain(event) && event.key.toLowerCase() === "v",
    command: () => ({ id: "tool.select" }),
  },
  {
    id: "text-tool",
    label: "Text tool",
    keys: "T",
    when: "canvas",
    matches: (event) => plain(event) && event.key.toLowerCase() === "t",
    command: () => ({ id: "tool.text" }),
  },
  {
    id: "undo",
    label: "Undo",
    keys: "Mod+Z",
    when: "canvas",
    matches: (event) =>
      primary(event) && !event.shiftKey && event.key.toLowerCase() === "z",
    command: () => ({ id: "history.undo" }),
  },
  {
    id: "redo",
    label: "Redo",
    keys: "Mod+Shift+Z",
    when: "canvas",
    matches: (event) =>
      primary(event) && event.shiftKey && event.key.toLowerCase() === "z",
    command: () => ({ id: "history.redo" }),
  },
  {
    id: "duplicate",
    label: "Duplicate selection",
    keys: "Mod+D",
    when: "canvas",
    matches: (event) => primary(event) && event.key.toLowerCase() === "d",
    command: () => ({ id: "selection.duplicate" }),
  },
  {
    id: "group",
    label: "Group selection",
    keys: "Mod+G",
    when: "canvas",
    matches: (event) => primary(event) && event.key.toLowerCase() === "g",
    command: () => ({ id: "selection.group" }),
  },
  {
    id: "zoom-in",
    label: "Zoom in",
    keys: "Mod++",
    when: "canvas",
    matches: (event) => primary(event) && ["+", "="].includes(event.key),
    command: () => ({ id: "view.zoom", delta: 0.1 }),
  },
  {
    id: "zoom-out",
    label: "Zoom out",
    keys: "Mod+-",
    when: "canvas",
    matches: (event) => primary(event) && event.key === "-",
    command: () => ({ id: "view.zoom", delta: -0.1 }),
  },
  {
    id: "delete",
    label: "Delete selection",
    keys: "Delete",
    when: "canvas",
    matches: (event) =>
      plain(event) && ["Delete", "Backspace"].includes(event.key),
    command: () => ({ id: "selection.delete" }),
  },
  {
    id: "clear-selection",
    label: "Clear selection",
    keys: "Escape",
    when: "canvas",
    matches: (event) => plain(event) && event.key === "Escape",
    command: () => ({ id: "selection.clear" }),
  },
  {
    id: "edit-text",
    label: "Edit selected text on canvas",
    keys: "F2",
    when: "canvas",
    matches: (event) => plain(event) && event.key === "F2",
    command: () => ({ id: "selection.edit-text" }),
  },
  ...(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const).map(
    (key): StudioShortcut => ({
      id: `nudge-${key.toLowerCase()}`,
      label: `Nudge ${key.replace("Arrow", "").toLowerCase()}`,
      keys: key,
      when: "canvas",
      matches: (event) => plain(event) && event.key === key,
      command: (event) => {
        const amount = event.shiftKey ? 10 : 1;
        return {
          id: "selection.nudge",
          dx: key === "ArrowLeft" ? -amount : key === "ArrowRight" ? amount : 0,
          dy: key === "ArrowUp" ? -amount : key === "ArrowDown" ? amount : 0,
        };
      },
    }),
  ),
];

export const assertNoShortcutConflicts = (
  shortcuts: readonly StudioShortcut[] = studioShortcutRegistry,
): void => {
  const seen = new Map<string, string>();
  for (const shortcut of shortcuts) {
    const key = `${shortcut.when}:${shortcut.keys}`;
    const existing = seen.get(key);
    if (existing)
      throw new Error(
        `Shortcut conflict for ${shortcut.keys} in ${shortcut.when}: ${existing} and ${shortcut.id}`,
      );
    seen.set(key, shortcut.id);
  }
};

assertNoShortcutConflicts();

export const isEditableShortcutTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(
    target.closest(
      "input,textarea,select,button,[role=treeitem],[contenteditable=true],[data-studio-shortcuts=local]",
    ),
  );

export const resolveStudioShortcut = (
  event: KeyboardEvent,
): StudioCommandInvocation | undefined => {
  if (isEditableShortcutTarget(event.target)) return undefined;
  return studioShortcutRegistry
    .find((shortcut) => shortcut.matches(event))
    ?.command(event);
};
