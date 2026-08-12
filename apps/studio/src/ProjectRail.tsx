import { useId, useState } from "react";
import type { FrameResizeStrategy } from "@tva-agentic-design/core";
import { MARKETING_FRAME_PRESETS } from "./frame-presets";
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
  const [dialog, setDialog] = useState<"project" | "frame" | "duplicate">();
  return (
    <section className="project-rail" aria-label="Projects and frames">
      <div className="rail-section">
        <div className="rail-heading">
          <span>Project</span>
          <button aria-label="New project" onClick={() => setDialog("project")}>
            +
          </button>
        </div>
        <select
          aria-label="Active project"
          value={activeProject?.id ?? ""}
          onChange={(event) => void loadProject(event.currentTarget.value)}
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
      </div>
      <div className="rail-section frame-section">
        <div className="rail-heading">
          <span>Frames</span>
          <button
            aria-label="New frame"
            disabled={!activeProject}
            onClick={() => setDialog("frame")}
          >
            +
          </button>
          <button
            aria-label="Duplicate and resize frame"
            disabled={!activeFrame}
            onClick={() => setDialog("duplicate")}
          >
            ⧉
          </button>
        </div>
        <div className="frame-list">
          {frames.map((frame, index) => (
            <button
              key={frame.id}
              className={frame.id === activeFrame?.id ? "is-active" : ""}
              aria-current={frame.id === activeFrame?.id ? "true" : undefined}
              onClick={() => void loadFrame(frame.id)}
            >
              <span className="frame-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{frame.name}</strong>
                <small>
                  {frame.canvas.width}×{frame.canvas.height}
                </small>
              </span>
              <em>r{frame.revision}</em>
            </button>
          ))}
        </div>
      </div>
      <CreateDialog kind={dialog} onClose={() => setDialog(undefined)} />
    </section>
  );
}
