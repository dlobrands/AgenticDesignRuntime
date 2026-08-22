import { useMemo, useState } from "react";
import {
  findNodeLocation,
  type AdjustmentNode,
  type SceneNode,
} from "@tva-agentic-design/core";
import { executeStudioCommand } from "./commands";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { useStudio } from "./store";

const glyph: Record<SceneNode["type"], string> = {
  group: "G",
  rasterImage: "I",
  text: "T",
  rectangle: "R",
  ellipse: "O",
  vectorPath: "P",
  svg: "V",
  mask: "M",
  adjustment: "A",
};

function LayerRow({
  node,
  depth,
  adjustments,
  isFirst = false,
}: {
  node: SceneNode;
  depth: number;
  adjustments: Map<string, AdjustmentNode[]>;
  isFirst?: boolean;
}) {
  const frame = useStudio((state) => state.activeFrame)!;
  const selection = useStudio((state) => state.selection);
  const select = useStudio((state) => state.select);
  const renameLayer = useStudio((state) => state.renameLayer);
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(node.name);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [dropMode, setDropMode] = useState<"before" | "after" | "inside">();
  const isContainer = node.type === "group" || node.type === "mask";
  const selected = selection.includes(node.id);
  const derived = adjustments.get(node.id) ?? [];
  const nodeLocation = findNodeLocation(frame, node.id);
  const siblingCount =
    nodeLocation?.locationKind === "child"
      ? nodeLocation.parent.children.length
      : 0;

  const reorder = (delta: number) => {
    const location = findNodeLocation(frame, node.id);
    if (!location || location.locationKind !== "child") return;
    executeStudioCommand({ id: "layer.reorder", nodeId: node.id, delta });
  };

  const moveHierarchy = (direction: "out" | "in") => {
    const location = findNodeLocation(frame, node.id);
    if (
      !location ||
      location.locationKind !== "child" ||
      node.type === "adjustment"
    )
      return;
    if (direction === "out") {
      if (location.parentId === "root") return;
      const parentLocation = findNodeLocation(frame, location.parentId);
      if (!parentLocation || parentLocation.locationKind !== "child") return;
      executeStudioCommand({
        id: "layer.move",
        nodeId: node.id,
        parentId: parentLocation.parentId,
        index: parentLocation.index + 1,
      });
      return;
    }
    const previous = location.parent.children[location.index + 1];
    if (!previous || (previous.type !== "group" && previous.type !== "mask"))
      return;
    executeStudioCommand({
      id: "layer.move",
      nodeId: node.id,
      parentId: previous.id,
      index: previous.children.length,
    });
  };

  return (
    <>
      <div
        className={`layer-row${selected ? " is-selected" : ""}${node.visible ? "" : " is-hidden"}${dropMode ? ` drop-${dropMode}` : ""}`}
        style={{ paddingInlineStart: 8 + depth * 14 }}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selected}
        aria-expanded={isContainer ? expanded : undefined}
        tabIndex={selected || (isFirst && selection.length === 0) ? 0 : -1}
        draggable={!node.locked && node.type !== "adjustment"}
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-adr-node", node.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const bounds = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientY - bounds.top) / bounds.height;
          setDropMode(
            isContainer && ratio >= 0.25 && ratio <= 0.75
              ? "inside"
              : ratio < 0.5
                ? "before"
                : "after",
          );
        }}
        onDragLeave={() => setDropMode(undefined)}
        onDrop={(event) => {
          event.preventDefault();
          const sourceId = event.dataTransfer.getData("application/x-adr-node");
          if (!sourceId || sourceId === node.id) return;
          const targetLocation = findNodeLocation(frame, node.id);
          if (!targetLocation) return;
          const mode = dropMode ?? "before";
          setDropMode(undefined);
          const parentId =
            mode === "inside" ? node.id : targetLocation.parentId;
          const index =
            mode === "inside"
              ? "children" in node
                ? node.children.length
                : 0
              : targetLocation.index + (mode === "before" ? 1 : 0);
          executeStudioCommand({
            id: "layer.move",
            nodeId: sourceId,
            parentId,
            index,
          });
        }}
        onClick={(event) => select(node.id, event.shiftKey || event.metaKey)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!selected) select(node.id);
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (event.altKey && event.key === "ArrowLeft") {
            event.preventDefault();
            moveHierarchy("out");
            return;
          }
          if (event.altKey && event.key === "ArrowRight") {
            event.preventDefault();
            moveHierarchy("in");
            return;
          }
          if (event.key === "ArrowUp" && event.altKey) {
            event.preventDefault();
            reorder(1);
          }
          if (event.key === "ArrowDown" && event.altKey) {
            event.preventDefault();
            reorder(-1);
          }
          if (event.key === "F2") {
            event.preventDefault();
            setDraftName(node.name);
            setEditing(true);
          }
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            setMenu({ x: bounds.left + 32, y: bounds.top + 24 });
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select(node.id, event.shiftKey);
          }
          if (event.key === "ArrowRight" && isContainer) setExpanded(true);
          if (event.key === "ArrowLeft" && isContainer) setExpanded(false);
        }}
      >
        <button
          className="layer-disclosure"
          aria-label={expanded ? "Collapse layer" : "Expand layer"}
          disabled={!isContainer}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {isContainer && (
            <Icon name={expanded ? "chevron-down" : "chevron-right"} />
          )}
        </button>
        <span className={`layer-glyph type-${node.type}`} aria-hidden="true">
          {glyph[node.type]}
        </span>
        {editing ? (
          <input
            className="inline-name-input"
            value={draftName}
            autoFocus
            aria-label={`Rename ${node.name}`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraftName(event.currentTarget.value)}
            onBlur={() => {
              if (draftName.trim()) void renameLayer(node.id, draftName);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraftName(node.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            className="layer-name"
            onDoubleClick={(event) => {
              event.stopPropagation();
              setDraftName(node.name);
              setEditing(true);
            }}
          >
            {node.name}
          </span>
        )}
        <button
          className="layer-toggle"
          title={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
          aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
          onClick={(event) => {
            event.stopPropagation();
            executeStudioCommand({
              id: "layer.toggle-visibility",
              nodeId: node.id,
            });
          }}
        >
          <Icon name={node.visible ? "eye" : "eye-off"} />
        </button>
        <button
          className="layer-toggle"
          title={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
          aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
          onClick={(event) => {
            event.stopPropagation();
            executeStudioCommand({
              id: "layer.toggle-lock",
              nodeId: node.id,
            });
          }}
        >
          <Icon name={node.locked ? "lock" : "lock-open"} />
        </button>
        <button
          className="layer-action layer-delete"
          title={`Delete ${node.name}`}
          aria-label={`Delete ${node.name}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!selected) select(node.id);
            executeStudioCommand({ id: "selection.delete" });
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
      {menu && (
        <ContextMenu
          {...menu}
          onClose={() => setMenu(undefined)}
          items={[
            {
              label: "Rename",
              icon: "rename",
              shortcut: "F2",
              movesFocus: true,
              action: () => {
                setDraftName(node.name);
                setEditing(true);
              },
            },
            {
              label: "Duplicate",
              icon: "copy",
              shortcut: "⌘D",
              disabled: selection.length !== 1 || node.type === "adjustment",
              action: () => executeStudioCommand({ id: "selection.duplicate" }),
            },
            {
              label: node.visible ? "Hide" : "Show",
              icon: node.visible ? "eye-off" : "eye",
              action: () =>
                executeStudioCommand({
                  id: "layer.toggle-visibility",
                  nodeId: node.id,
                }),
            },
            {
              label: node.locked ? "Unlock" : "Lock",
              icon: node.locked ? "lock-open" : "lock",
              action: () =>
                executeStudioCommand({
                  id: "layer.toggle-lock",
                  nodeId: node.id,
                }),
            },
            {
              label: "Bring Forward",
              disabled:
                nodeLocation?.locationKind !== "child" ||
                nodeLocation.index >= siblingCount - 1,
              action: () => reorder(1),
            },
            {
              label: "Send Backward",
              disabled:
                nodeLocation?.locationKind !== "child" ||
                nodeLocation.index <= 0,
              action: () => reorder(-1),
            },
            {
              label: "Delete",
              icon: "trash",
              shortcut: "⌫",
              danger: true,
              action: () => executeStudioCommand({ id: "selection.delete" }),
            },
          ]}
        />
      )}
      {node.type === "mask" && expanded && (
        <div
          className="layer-row layer-derived"
          style={{ paddingInlineStart: 8 + (depth + 1) * 14 }}
          role="treeitem"
          aria-disabled="true"
          aria-level={depth + 2}
          aria-label={`Mask source ${node.maskSource.name}`}
          tabIndex={-1}
        >
          <span className="layer-disclosure" />
          <span className="layer-glyph type-mask">S</span>
          <span className="layer-name">{node.maskSource.name}</span>
          <span className="derived-tag">source</span>
        </div>
      )}
      {isContainer &&
        expanded &&
        [...node.children]
          .filter((child) => child.type !== "adjustment")
          .reverse()
          .map((child) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              adjustments={adjustments}
              isFirst={false}
            />
          ))}
      {[...derived].reverse().map((adjustment) => (
        <LayerRow
          key={adjustment.id}
          node={adjustment}
          depth={depth + 1}
          adjustments={adjustments}
          isFirst={false}
        />
      ))}
    </>
  );
}

export function LayersPanel() {
  const frame = useStudio((state) => state.activeFrame);
  const [query, setQuery] = useState("");
  const adjustments = useMemo(() => {
    const map = new Map<string, AdjustmentNode[]>();
    for (const node of frame?.root.children ?? []) {
      if (node.type !== "adjustment") continue;
      const list = map.get(node.targetId) ?? [];
      list.push(node);
      map.set(node.targetId, list);
    }
    return map;
  }, [frame]);
  if (!frame)
    return (
      <section className="panel layers-panel">
        <div className="panel-heading">
          <h2>Layers</h2>
        </div>
        <p className="empty-copy">Choose a frame.</p>
      </section>
    );
  const roots = frame.root.children
    .filter(
      (node) =>
        node.type !== "adjustment" &&
        (!query || node.name.toLowerCase().includes(query.toLowerCase())),
    )
    .reverse();
  const showFilter = frame.root.children.length > 8 || query.length > 0;
  return (
    <section className="panel layers-panel" aria-label="Layers panel">
      <div className="panel-heading">
        <h2>Layers</h2>
        <span>{frame.root.children.length}</span>
      </div>
      {showFilter && (
        <label className="compact-search">
          <span className="sr-only">Filter layers</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter layers"
          />
        </label>
      )}
      <p id="layer-tree-help" className="sr-only">
        Use arrow keys to navigate. Hold Option with up or down to reorder, or
        Option with left or right to move a layer out of or into a group.
      </p>
      <div
        className="layer-tree"
        role="tree"
        aria-label="Frame layers"
        aria-describedby="layer-tree-help"
        aria-multiselectable="true"
        onKeyDown={(event) => {
          if (
            event.altKey ||
            !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
          )
            return;
          const item = (event.target as HTMLElement).closest<HTMLElement>(
            "[role=treeitem]",
          );
          if (!item) return;
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              '[role=treeitem]:not([aria-disabled="true"])',
            ),
          ];
          const index = items.indexOf(item);
          if (index < 0) return;
          event.preventDefault();
          const nextIndex =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : event.key === "ArrowDown"
                  ? Math.min(items.length - 1, index + 1)
                  : Math.max(0, index - 1);
          for (const candidate of items) candidate.tabIndex = -1;
          items[nextIndex]!.tabIndex = 0;
          items[nextIndex]!.focus();
        }}
      >
        {roots.length ? (
          roots.map((node, index) => (
            <LayerRow
              key={node.id}
              node={node}
              depth={0}
              adjustments={adjustments}
              isFirst={index === 0}
            />
          ))
        ) : (
          <p className="empty-copy">No matching layers.</p>
        )}
        {[...(adjustments.get("root") ?? [])]
          .reverse()
          .map((adjustment, index) => (
            <LayerRow
              key={adjustment.id}
              node={adjustment}
              depth={0}
              adjustments={adjustments}
              isFirst={roots.length === 0 && index === 0}
            />
          ))}
      </div>
    </section>
  );
}
