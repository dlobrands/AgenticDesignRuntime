import { useMemo, useState } from "react";
import {
  findNodeLocation,
  type AdjustmentNode,
  type SceneNode,
} from "@tva-agentic-design/core";
import { executeStudioCommand } from "./commands";
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
  const [expanded, setExpanded] = useState(true);
  const isContainer = node.type === "group" || node.type === "mask";
  const selected = selection.includes(node.id);
  const derived = adjustments.get(node.id) ?? [];

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
    const previous = location.parent.children[location.index - 1];
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
        className={`layer-row${selected ? " is-selected" : ""}${node.visible ? "" : " is-hidden"}`}
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
        }}
        onDrop={(event) => {
          event.preventDefault();
          const sourceId = event.dataTransfer.getData("application/x-adr-node");
          if (!sourceId || sourceId === node.id) return;
          const targetLocation = findNodeLocation(frame, node.id);
          if (!targetLocation) return;
          const parentId = isContainer ? node.id : targetLocation.parentId;
          const index = isContainer
            ? node.children.length
            : targetLocation.index;
          executeStudioCommand({
            id: "layer.move",
            nodeId: sourceId,
            parentId,
            index,
          });
        }}
        onClick={(event) => select(node.id, event.shiftKey || event.metaKey)}
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
            reorder(-1);
          }
          if (event.key === "ArrowDown" && event.altKey) {
            event.preventDefault();
            reorder(1);
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
          {isContainer ? (expanded ? "−" : "+") : ""}
        </button>
        <span className={`layer-glyph type-${node.type}`} aria-hidden="true">
          {glyph[node.type]}
        </span>
        <span className="layer-name">{node.name}</span>
        <button
          className="layer-toggle"
          aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
          onClick={(event) => {
            event.stopPropagation();
            executeStudioCommand({
              id: "layer.toggle-visibility",
              nodeId: node.id,
            });
          }}
        >
          {node.visible ? "●" : "○"}
        </button>
        <button
          className="layer-toggle"
          aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
          onClick={(event) => {
            event.stopPropagation();
            executeStudioCommand({
              id: "layer.toggle-lock",
              nodeId: node.id,
            });
          }}
        >
          {node.locked ? "◆" : "◇"}
        </button>
      </div>
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
        node.children
          .filter((child) => child.type !== "adjustment")
          .map((child) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              adjustments={adjustments}
              isFirst={false}
            />
          ))}
      {derived.map((adjustment) => (
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
  const roots = frame.root.children.filter(
    (node) =>
      node.type !== "adjustment" &&
      (!query || node.name.toLowerCase().includes(query.toLowerCase())),
  );
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
        {(adjustments.get("root") ?? []).map((adjustment, index) => (
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
