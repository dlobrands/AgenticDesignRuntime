import { useId, useState } from "react";
import type { FrameResizeStrategy } from "@tva-agentic-design/core";
import { ContextMenu } from "./ContextMenu";
import { MARKETING_FRAME_PRESETS } from "./frame-presets";
import { Icon } from "./Icon";
import { ModalDialog } from "./ModalDialog";
import { useStudio } from "./store";

function CreateDialog({
  kind,
  onClose,
}: {
  kind?: "project" | "frame" | "duplicate";
  onClose: () => void;
}) {
  const createProject = useStudio((state) => state.createProject);
  const createFrame = useStudio((state) => state.createFrame);
  const duplicateFrame = useStudio((state) => state.duplicateFrame);
  const activeFrame = useStudio((state) => state.activeFrame);
  const [name, setName] = useState(
    kind === "duplicate" && activeFrame ? `${activeFrame.name} variation` : "",
  );
  const [nameError, setNameError] = useState("");
  const [width, setWidth] = useState(
    kind === "duplicate" ? (activeFrame?.canvas.width ?? 1080) : 1080,
  );
  const [height, setHeight] = useState(
    kind === "duplicate" ? (activeFrame?.canvas.height ?? 1350) : 1350,
  );
  const [preset, setPreset] = useState(
    kind === "duplicate" ? "custom" : "instagram-portrait",
  );
  const [strategy, setStrategy] = useState<FrameResizeStrategy>("constraints");
  const titleId = useId();
  const nameErrorId = useId();
  if (!kind) return null;
  return (
    <ModalDialog
      form
      titleId={titleId}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        const normalizedName = name.trim();
        if (!normalizedName) {
          setNameError(`Enter a name for this ${kind}.`);
          (
            event.currentTarget.elements.namedItem("name") as HTMLInputElement
          )?.focus();
          return;
        }
        void (kind === "project"
          ? createProject(normalizedName)
          : kind === "duplicate"
            ? duplicateFrame(normalizedName, width, height, strategy)
            : createFrame(normalizedName, width, height));
        onClose();
      }}
    >
      <span className="eyebrow">
        {kind === "duplicate" ? "Frame variation" : `New ${kind}`}
      </span>
      <h2 id={titleId}>
        {kind === "project"
          ? "Start a structured project"
          : kind === "duplicate"
            ? "Duplicate into a marketing format"
            : "Add an exact-size frame"}
      </h2>
      <label>
        Name
        <input
          data-autofocus
          name="name"
          required
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? nameErrorId : undefined}
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value);
            if (nameError) setNameError("");
          }}
          placeholder={
            kind === "project"
              ? "Campaign system"
              : kind === "duplicate"
                ? "Landscape variation"
                : "Portrait master"
          }
        />
      </label>
      {nameError && (
        <p id={nameErrorId} className="field-error" role="alert">
          {nameError}
        </p>
      )}
      {kind !== "project" && (
        <>
          <label>
            Format preset
            <select
              aria-label="Format preset"
              value={preset}
              onChange={(event) => {
                const id = event.currentTarget.value;
                setPreset(id);
                const selected = MARKETING_FRAME_PRESETS.find(
                  (candidate) => candidate.id === id,
                );
                if (selected) {
                  setWidth(selected.width);
                  setHeight(selected.height);
                }
              }}
            >
              <option value="custom">Custom size</option>
              {MARKETING_FRAME_PRESETS.map((framePreset) => (
                <option key={framePreset.id} value={framePreset.id}>
                  {framePreset.label} · {framePreset.width}×{framePreset.height}
                </option>
              ))}
            </select>
          </label>
          <div className="modal-grid">
            <label>
              Width
              <input
                type="number"
                min={1}
                value={width}
                onChange={(event) => {
                  setPreset("custom");
                  setWidth(Number(event.currentTarget.value));
                }}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min={1}
                value={height}
                onChange={(event) => {
                  setPreset("custom");
                  setHeight(Number(event.currentTarget.value));
                }}
              />
            </label>
          </div>
          {kind === "duplicate" && (
            <label>
              Resize behavior
              <select
                aria-label="Resize behavior"
                value={strategy}
                onChange={(event) =>
                  setStrategy(event.currentTarget.value as FrameResizeStrategy)
                }
              >
                <option value="constraints">Honor layer constraints</option>
                <option value="scale">Scale composition</option>
                <option value="canvasOnly">Resize canvas only</option>
              </select>
            </label>
          )}
        </>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-button" type="submit">
          {kind === "duplicate" ? "Create variation" : "Create"}
        </button>
      </div>
    </ModalDialog>
  );
}

export function ProjectRail() {
  const projects = useStudio((state) => state.projects);
  const activeProject = useStudio((state) => state.activeProject);
  const frames = useStudio((state) => state.frames);
  const activeFrame = useStudio((state) => state.activeFrame);
  const loadProject = useStudio((state) => state.loadProject);
  const loadFrame = useStudio((state) => state.loadFrame);
  const renameProject = useStudio((state) => state.renameProject);
  const trashProject = useStudio((state) => state.trashProject);
  const renameFrame = useStudio((state) => state.renameFrame);
  const deleteFrame = useStudio((state) => state.deleteFrame);
  const duplicateFrame = useStudio((state) => state.duplicateFrame);
  const [dialog, setDialog] = useState<"project" | "frame" | "duplicate">();
  const [menu, setMenu] = useState<
    | { kind: "project"; x: number; y: number }
    | { kind: "frame"; frameId: string; x: number; y: number }
  >();
  const [editing, setEditing] = useState<
    { kind: "project" | "frame"; id: string; name: string } | undefined
  >();
  const commitEditing = () => {
    if (!editing?.name.trim()) {
      setEditing(undefined);
      return;
    }
    if (editing.kind === "project") void renameProject(editing.name);
    else void renameFrame(editing.id, editing.name);
    setEditing(undefined);
  };
  const menuFrame =
    menu?.kind === "frame"
      ? frames.find((frame) => frame.id === menu.frameId)
      : undefined;
  return (
    <section className="project-rail" aria-label="Projects and frames">
      <div className="rail-section">
        <div className="rail-heading">
          <span>Project</span>
          <button aria-label="New project" onClick={() => setDialog("project")}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="project-picker-row">
          {editing?.kind === "project" ? (
            <input
              className="inline-name-input project-name-input"
              aria-label="Rename project"
              autoFocus
              value={editing.name}
              onChange={(event) =>
                setEditing({ ...editing, name: event.currentTarget.value })
              }
              onBlur={commitEditing}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setEditing(undefined);
              }}
            />
          ) : (
            <select
              aria-label="Active project"
              value={activeProject?.id ?? ""}
              onChange={(event) => void loadProject(event.currentTarget.value)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  kind: "project",
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "ContextMenu" ||
                  (event.shiftKey && event.key === "F10")
                ) {
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setMenu({
                    kind: "project",
                    x: bounds.left + 24,
                    y: bounds.bottom,
                  });
                }
              }}
            >
              <option value="" disabled>
                Choose project
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
          <button
            className="icon-button danger-action"
            aria-label="Move project to Trash"
            title={`Move ${activeProject?.name ?? "project"} to Trash`}
            disabled={!activeProject}
            onClick={() => void trashProject()}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <div className="rail-section frame-section">
        <div className="rail-heading">
          <span>Frames</span>
          <button
            aria-label="New frame"
            disabled={!activeProject}
            onClick={() => setDialog("frame")}
          >
            <Icon name="plus" />
          </button>
          <button
            aria-label="Duplicate and resize frame"
            disabled={!activeFrame}
            onClick={() => setDialog("duplicate")}
          >
            <Icon name="copy" />
          </button>
        </div>
        <div className="frame-list">
          {frames.map((frame, index) => (
            <div
              key={frame.id}
              className={`frame-row${frame.id === activeFrame?.id ? " is-active" : ""}`}
              onContextMenu={(event) => {
                event.preventDefault();
                if (frame.id !== activeFrame?.id) void loadFrame(frame.id);
                setMenu({
                  kind: "frame",
                  frameId: frame.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <button
                className="frame-select"
                aria-current={frame.id === activeFrame?.id ? "true" : undefined}
                onClick={() => void loadFrame(frame.id)}
                onDoubleClick={() =>
                  setEditing({ kind: "frame", id: frame.id, name: frame.name })
                }
                onKeyDown={(event) => {
                  if (event.key === "F2") {
                    event.preventDefault();
                    setEditing({
                      kind: "frame",
                      id: frame.id,
                      name: frame.name,
                    });
                  }
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setMenu({
                      kind: "frame",
                      frameId: frame.id,
                      x: bounds.left + 30,
                      y: bounds.bottom,
                    });
                  }
                }}
              >
                <span className="frame-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  {editing?.kind === "frame" && editing.id === frame.id ? (
                    <input
                      className="inline-name-input"
                      aria-label={`Rename ${frame.name}`}
                      autoFocus
                      value={editing.name}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          name: event.currentTarget.value,
                        })
                      }
                      onBlur={commitEditing}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setEditing(undefined);
                      }}
                    />
                  ) : (
                    <strong>{frame.name}</strong>
                  )}
                  <small>
                    {frame.canvas.width}×{frame.canvas.height}
                  </small>
                </span>
                <em>r{frame.revision}</em>
              </button>
              <div className="frame-row-actions">
                <button
                  title={`Duplicate ${frame.name}`}
                  aria-label="Duplicate frame"
                  onClick={() =>
                    void duplicateFrame(
                      `${frame.name} copy`,
                      frame.canvas.width,
                      frame.canvas.height,
                      "constraints",
                      frame.id,
                    )
                  }
                >
                  <Icon name="copy" />
                </button>
                <button
                  className="danger-action"
                  title={`Delete ${frame.name}`}
                  aria-label="Delete frame"
                  onClick={() => void deleteFrame(frame.id)}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {menu?.kind === "project" && activeProject && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            {
              label: "Rename Project",
              icon: "rename",
              movesFocus: true,
              action: () =>
                setEditing({
                  kind: "project",
                  id: activeProject.id,
                  name: activeProject.name,
                }),
            },
            {
              label: "Move to Trash",
              icon: "trash",
              danger: true,
              action: () => void trashProject(),
            },
          ]}
        />
      )}
      {menu?.kind === "frame" && menuFrame && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            {
              label: "Rename",
              icon: "rename",
              shortcut: "F2",
              movesFocus: true,
              action: () =>
                setEditing({
                  kind: "frame",
                  id: menuFrame.id,
                  name: menuFrame.name,
                }),
            },
            {
              label: "Duplicate",
              icon: "copy",
              action: () =>
                void duplicateFrame(
                  `${menuFrame.name} copy`,
                  menuFrame.canvas.width,
                  menuFrame.canvas.height,
                  "constraints",
                  menuFrame.id,
                ),
            },
            {
              label: "Delete",
              icon: "trash",
              danger: true,
              action: () => void deleteFrame(menuFrame.id),
            },
          ]}
        />
      )}
      <CreateDialog kind={dialog} onClose={() => setDialog(undefined)} />
    </section>
  );
}
