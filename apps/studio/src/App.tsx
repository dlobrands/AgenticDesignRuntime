import { useEffect, useId, useRef, useState } from "react";
import { CanvasSurface } from "./Canvas";
import { ExportDialog } from "./ExportDialog";
import {
  executeStudioCommand,
  isStudioCommandEnabled,
  type StudioCommandInvocation,
} from "./commands";
import { InspectorPanel } from "./Inspector";
import { LayersPanel } from "./Layers";
import { ModalDialog } from "./ModalDialog";
import { ProjectRail } from "./ProjectRail";
import { useStudio } from "./store";
import { resolveStudioShortcut } from "./shortcuts";
import { ValidationPanel } from "./ValidationPanel";

const statusCopy = {
  booting: "Starting",
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving",
  preview: "Preview",
  conflict: "Conflict",
  error: "Needs attention",
  offline: "Offline",
} as const;

function Toolbar({
  navigationOpen,
  onToggleNavigation,
  onOpenExport,
}: {
  navigationOpen: boolean;
  onToggleNavigation: () => void;
  onOpenExport: () => void;
}) {
  const frame = useStudio((state) => state.activeFrame);
  const canvasTool = useStudio((state) => state.canvasTool);
  const selection = useStudio((state) => state.selection);
  const fonts = useStudio((state) => state.fonts.fonts);
  const assets = useStudio((state) => state.assets.assets);
  const validate = useStudio((state) => state.validate);
  const exportFrame = useStudio((state) => state.exportFrame);
  const importFile = useStudio((state) => state.importFile);
  const inspectorOpen = useStudio((state) => state.inspectorOpen);
  const setInspectorOpen = useStudio((state) => state.setInspectorOpen);
  const assetInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);

  const run = (command: StudioCommandInvocation) =>
    executeStudioCommand(command);
  const canAlign = isStudioCommandEnabled({
    id: "selection.align",
    mode: "left",
  });

  return (
    <header className="toolbar">
      <div className="brand-lockup" aria-label="Agentic Design Runtime">
        <span className="brand-mark">AD</span>
        <div>
          <strong>Design Runtime</strong>
          <small>Precision studio</small>
        </div>
      </div>
      <button
        className="navigator-toggle"
        title="Projects, frames, and layers"
        aria-controls="navigator-panel"
        aria-expanded={navigationOpen}
        onClick={onToggleNavigation}
      >
        Navigate
      </button>
      <div className="tool-cluster" role="group" aria-label="Canvas tools">
        <button
          className={canvasTool === "select" ? "is-active" : undefined}
          aria-pressed={canvasTool === "select"}
          title="Select tool (V)"
          onClick={() => run({ id: "tool.select" })}
        >
          <span aria-hidden="true">↖</span>
          <span className="sr-only">Select tool</span>
        </button>
        <button
          className={canvasTool === "text" ? "is-active" : undefined}
          aria-pressed={canvasTool === "text"}
          disabled={!frame || fonts.length === 0}
          title={fonts.length ? "Text tool (T)" : "Import a font to use Text"}
          onClick={() => run({ id: "tool.text" })}
        >
          <span aria-hidden="true">T</span>
          <span className="sr-only">Text tool</span>
        </button>
      </div>
      <div className="tool-cluster" role="group" aria-label="History">
        <button title="Undo (⌘Z)" onClick={() => run({ id: "history.undo" })}>
          <span aria-hidden="true">↶</span>
          <span className="sr-only">Undo</span>
        </button>
        <button title="Redo (⇧⌘Z)" onClick={() => run({ id: "history.redo" })}>
          <span aria-hidden="true">↷</span>
          <span className="sr-only">Redo</span>
        </button>
      </div>
      <div className="tool-cluster" role="group" aria-label="Create layers">
        <button
          disabled={!frame}
          title="Rectangle"
          onClick={() => run({ id: "layer.create-rectangle" })}
        >
          <span aria-hidden="true">▭</span>
          <span className="sr-only">Add rectangle</span>
        </button>
        <button
          disabled={!frame}
          title="Ellipse"
          onClick={() => run({ id: "layer.create-ellipse" })}
        >
          <span aria-hidden="true">○</span>
          <span className="sr-only">Add ellipse</span>
        </button>
        <button
          disabled={!frame}
          title="Editable vector path"
          onClick={() => run({ id: "layer.create-vector" })}
        >
          <span aria-hidden="true">P</span>
          <span className="sr-only">Add vector path</span>
        </button>
        <button
          className="centered-text-button"
          disabled={!frame || fonts.length === 0}
          title={
            fonts.length
              ? "Add centered text layer"
              : "Import a project font before creating text"
          }
          onClick={() => run({ id: "layer.create-text" })}
        >
          <span aria-hidden="true">T</span>
          <span className="sr-only">Add text</span>
        </button>
        <button
          disabled={!frame || !assets.some((asset) => asset.type === "raster")}
          title="Image layer"
          onClick={() => run({ id: "layer.create-image" })}
        >
          <span aria-hidden="true">▧</span>
          <span className="sr-only">Add image</span>
        </button>
      </div>
      {selection.length > 0 && (
        <div className="tool-cluster" role="group" aria-label="Selection">
          <button
            disabled={selection.length !== 1}
            title="Duplicate"
            onClick={() => run({ id: "selection.duplicate" })}
          >
            ⧉<span className="sr-only">Duplicate layer</span>
          </button>
          <button title="Group" onClick={() => run({ id: "selection.group" })}>
            ⌗<span className="sr-only">Group selected layers</span>
          </button>
          <button title="Mask" onClick={() => run({ id: "selection.mask" })}>
            ◩<span className="sr-only">Mask selected layers</span>
          </button>
          <button
            disabled={
              !isStudioCommandEnabled({ id: "selection.add-adjustment" })
            }
            title="Add adjustment to selection or frame"
            onClick={() => run({ id: "selection.add-adjustment" })}
          >
            ◐<span className="sr-only">Add adjustment to valid target</span>
          </button>
        </div>
      )}
      {canAlign && (
        <div
          className="tool-cluster arrange-tools"
          role="group"
          aria-label="Align and distribute"
        >
          <button
            title="Align left"
            onClick={() => run({ id: "selection.align", mode: "left" })}
          >
            ⫷<span className="sr-only">Align left</span>
          </button>
          <button
            title="Align centers"
            onClick={() => run({ id: "selection.align", mode: "center" })}
          >
            ↔<span className="sr-only">Align horizontal centers</span>
          </button>
          <button
            title="Align top"
            onClick={() => run({ id: "selection.align", mode: "top" })}
          >
            ⫯<span className="sr-only">Align top</span>
          </button>
          <button
            disabled={
              !isStudioCommandEnabled({
                id: "selection.distribute",
                axis: "horizontal",
              })
            }
            title="Distribute horizontally"
            onClick={() =>
              run({ id: "selection.distribute", axis: "horizontal" })
            }
          >
            ⇥<span className="sr-only">Distribute horizontally</span>
          </button>
          <button
            disabled={
              !isStudioCommandEnabled({
                id: "selection.distribute",
                axis: "vertical",
              })
            }
            title="Distribute vertically"
            onClick={() =>
              run({ id: "selection.distribute", axis: "vertical" })
            }
          >
            ⇟<span className="sr-only">Distribute vertically</span>
          </button>
        </div>
      )}
      <div className="tool-spacer" />
      <input
        ref={assetInput}
        className="sr-only"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile("asset", file);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={fontInput}
        className="sr-only"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        accept=".woff2,.woff,.ttf,.otf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile("font", file);
          event.currentTarget.value = "";
        }}
      />
      <details
        className="import-menu"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.removeAttribute("open");
          event.currentTarget.querySelector("summary")?.focus();
        }}
      >
        <summary title="Import assets and fonts">Import</summary>
        <div className="import-popover">
          <button
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              assetInput.current?.click();
            }}
          >
            Import asset
          </button>
          <button
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              fontInput.current?.click();
            }}
          >
            Import font
          </button>
        </div>
      </details>
      <button
        className="inspector-toggle"
        title="Inspector"
        aria-controls="inspector-panel"
        aria-expanded={inspectorOpen}
        onClick={() => setInspectorOpen(!inspectorOpen)}
      >
        Inspector
      </button>
      <button
        className="validate-button"
        title="Validate frame"
        disabled={!frame}
        onClick={() => void validate()}
      >
        Validate
      </button>
      <button
        className="export-button"
        title="Export PNG"
        disabled={!frame}
        onClick={() => void exportFrame()}
      >
        Export PNG
      </button>
      <button
        className="export-options-button"
        title="Export options"
        aria-label="Export options"
        disabled={!frame}
        onClick={onOpenExport}
      >
        Options
      </button>
    </header>
  );
}

function Feedback() {
  const error = useStudio((state) => state.error);
  const warning = useStudio((state) => state.warning);
  const conflict = useStudio((state) => state.conflict);
  const externalConflict = useStudio((state) => state.externalConflict);
  const clear = useStudio((state) => state.clearError);
  const failedCommit = useStudio((state) => state.failedCommit);
  const retryFailedCommit = useStudio((state) => state.retryFailedCommit);
  const resolve = useStudio((state) => state.resolveConflict);
  const revertExternal = useStudio((state) => state.revertExternalConflict);
  const revisionTitleId = useId();
  const externalTitleId = useId();
  const [recoveryRevealed, setRecoveryRevealed] = useState(false);
  const [supportCopied, setSupportCopied] = useState(false);
  const summarizeValue = (value: unknown): string => {
    if (value === undefined) return "not present";
    const serialized =
      typeof value === "string"
        ? value
        : (JSON.stringify(value) ?? String(value));
    return serialized.length > 120
      ? `${serialized.slice(0, 117)}…`
      : serialized;
  };
  const copySupportDetails = async (details: unknown) => {
    await navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    setSupportCopied(true);
  };
  return (
    <>
      {(error || warning) && (
        <div
          className={`feedback-toast ${error ? "is-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{error ?? warning}</span>
          {error && failedCommit && (
            <button onClick={() => void retryFailedCommit()}>
              Retry change
            </button>
          )}
          <button aria-label="Dismiss message" onClick={clear}>
            ×
          </button>
        </div>
      )}
      {conflict && (
        <ModalDialog
          className="conflict-card"
          onClose={() => void resolve("discard")}
          role="alertdialog"
          titleId={revisionTitleId}
        >
          <span className="eyebrow">Revision conflict</span>
          <h2 id={revisionTitleId}>
            {conflict.kind === "safe-rebase"
              ? `Rebased preview ready at r${conflict.canonicalRevision}`
              : `Canonical state moved to r${conflict.canonicalRevision}`}
          </h2>
          <p>{conflict.message}</p>
          <p>
            Intended base r{conflict.baseRevision}; current canonical r
            {conflict.canonicalRevision}. No rebased change has been committed.
          </p>
          {conflict.affectedNodeIds.length > 0 && (
            <p>
              <strong>Affected nodes:</strong>{" "}
              {conflict.affectedNodeIds.join(", ")}
            </p>
          )}
          {conflict.affectedProperties.length > 0 && (
            <details open>
              <summary>Affected properties</summary>
              <ul>
                {conflict.affectedProperties.map((property) => (
                  <li key={property}>
                    <code>{property}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {conflict.interveningChanges.length > 0 && (
            <details open={conflict.kind === "overlap"}>
              <summary>Intervening canonical changes</summary>
              <ul>
                {conflict.interveningChanges.map((change) => (
                  <li key={`canonical-${change.property}`}>
                    <code>{change.property}</code>:{" "}
                    {summarizeValue(change.before)} →{" "}
                    {summarizeValue(change.after)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {conflict.intendedChanges.length > 0 && (
            <details open>
              <summary>Intended changes</summary>
              <ul>
                {conflict.intendedChanges.map((change) => (
                  <li key={`intended-${change.property}`}>
                    <code>{change.property}</code>:{" "}
                    {summarizeValue(change.before)} →{" "}
                    {summarizeValue(change.after)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="modal-actions">
            <button onClick={() => void resolve("discard")}>
              Discard draft
            </button>
            {conflict.kind === "safe-rebase" && conflict.previewId && (
              <button
                className="primary-button"
                onClick={() => void resolve("commit")}
              >
                Commit reviewed rebase
              </button>
            )}
          </div>
        </ModalDialog>
      )}
      {externalConflict && (
        <ModalDialog
          className="conflict-card"
          onClose={() => void revertExternal()}
          role="alertdialog"
          titleId={externalTitleId}
        >
          <span className="eyebrow">External edit preserved</span>
          <h2 id={externalTitleId}>The canonical frame stayed intact</h2>
          <p>{externalConflict.message}</p>
          <p>
            A recovery copy is available if support needs to inspect the
            rejected edit.
          </p>
          {recoveryRevealed && (
            <div className="identity-line">
              <span>Recovery copy</span>
              <code>{externalConflict.recoveryPath}</code>
            </div>
          )}
          <div className="modal-actions">
            <button onClick={() => setRecoveryRevealed((value) => !value)}>
              {recoveryRevealed ? "Hide recovery copy" : "Reveal recovery copy"}
            </button>
            <button onClick={() => void copySupportDetails(externalConflict)}>
              {supportCopied
                ? "Support details copied"
                : "Copy support details"}
            </button>
            <button
              className="primary-button"
              onClick={() => void revertExternal()}
            >
              Revert to canonical
            </button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}

function EmptyWorkspace() {
  const createProject = useStudio((state) => state.createProject);
  const [name, setName] = useState("Campaign System");
  return (
    <main className="welcome-screen">
      <div className="welcome-grid" aria-hidden="true" />
      <div className="welcome-card">
        <span className="brand-mark large">AD</span>
        <span className="eyebrow">Local structured design</span>
        <h1>
          One composition.
          <br />
          Two kinds of hands.
        </h1>
        <p>
          Agents and designers edit the same layered scene through typed,
          reversible transactions.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createProject(name);
          }}
        >
          <label>
            First project
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <button className="primary-button">Create workspace project</button>
        </form>
        <div className="welcome-facts">
          <span>Offline</span>
          <span>Append-only history</span>
          <span>Exact PNG</span>
        </div>
      </div>
    </main>
  );
}

export function App() {
  const boot = useStudio((state) => state.boot);
  const saveState = useStudio((state) => state.saveState);
  const activeProject = useStudio((state) => state.activeProject);
  const activeFrame = useStudio((state) => state.activeFrame);
  const inspectorOpen = useStudio((state) => state.inspectorOpen);
  const setInspectorOpen = useStudio((state) => state.setInspectorOpen);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && navigationOpen) {
        setNavigationOpen(false);
        return;
      }
      if (
        event.key === "Escape" &&
        inspectorOpen &&
        window.matchMedia("(max-width: 1120px)").matches
      ) {
        setInspectorOpen(false);
        return;
      }
      const command = resolveStudioShortcut(event);
      if (!command || !isStudioCommandEnabled(command)) return;
      event.preventDefault();
      executeStudioCommand(command);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigationOpen, inspectorOpen, setInspectorOpen]);

  if (saveState === "booting")
    return (
      <main className="boot-screen">
        <span className="brand-mark large">AD</span>
        <div className="boot-line">
          <i />
        </div>
        <p>Opening local design runtime</p>
      </main>
    );
  if (!activeProject)
    return (
      <>
        <EmptyWorkspace />
        <Feedback />
      </>
    );
  return (
    <div className="studio-shell">
      <Toolbar
        navigationOpen={navigationOpen}
        onToggleNavigation={() => setNavigationOpen((open) => !open)}
        onOpenExport={() => setExportOpen(true)}
      />
      <div className="workspace-grid">
        <button
          className={`navigator-scrim${navigationOpen ? " is-open" : ""}`}
          aria-label="Close navigation"
          aria-hidden={!navigationOpen}
          tabIndex={navigationOpen ? 0 : -1}
          onClick={() => setNavigationOpen(false)}
        />
        <div
          id="navigator-panel"
          className={`navigator-sidebar${navigationOpen ? " is-open" : ""}`}
        >
          <ProjectRail />
          <LayersPanel />
        </div>
        <CanvasSurface />
        <InspectorPanel />
      </div>
      <footer className="statusbar">
        <div
          className={`save-state state-${saveState}`}
          role="status"
          aria-live="polite"
        >
          <i />
          {statusCopy[saveState]}
        </div>
        <div className="document-context">
          <span>{activeProject.name}</span>
          <i aria-hidden="true">/</i>
          <span>
            {activeFrame
              ? `${activeFrame.name} · r${activeFrame.revision}`
              : "No frame"}
          </span>
        </div>
        <span className="status-spacer" />
      </footer>
      <ValidationPanel />
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      <Feedback />
    </div>
  );
}
