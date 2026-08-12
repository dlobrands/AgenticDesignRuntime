import { useId, useMemo, useState } from "react";
import type {
  ExportFormat,
  ExportPreset,
  ExportSettings,
} from "@tva-agentic-design/core";
import { ModalDialog } from "./ModalDialog";
import { useStudio } from "./store";

const SCALE_OPTIONS = [0.5, 1, 2, 3, 4] as const;

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const project = useStudio((state) => state.activeProject)!;
  const activeFrame = useStudio((state) => state.activeFrame);
  const frames = useStudio((state) => state.frames);
  const exportFrames = useStudio((state) => state.exportFrames);
  const saveExportPreset = useStudio((state) => state.saveExportPreset);
  const removeExportPreset = useStudio((state) => state.removeExportPreset);
  const [selectedFrameIds, setSelectedFrameIds] = useState<string[]>(
    activeFrame ? [activeFrame.id] : [],
  );
  const [format, setFormat] = useState<ExportFormat>("png");
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(90);
  const [matteColor, setMatteColor] = useState("#FFFFFF");
  const [presetId, setPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedFrames = useMemo(
    () => frames.filter((frame) => selectedFrameIds.includes(frame.id)),
    [frames, selectedFrameIds],
  );
  const alphaEligibleCount =
    format === "png" || format === "webp"
      ? selectedFrames.filter(
          (frame) => frame.canvas.background.type === "transparent",
        ).length
      : 0;
  const alphaEligible =
    selectedFrames.length > 0 && alphaEligibleCount === selectedFrames.length;
  const mixedAlpha =
    alphaEligibleCount > 0 && alphaEligibleCount < selectedFrames.length;
  const settings = (): ExportSettings => ({
    format,
    scale,
    ...(format === "png" ? {} : { quality }),
    ...(format === "jpeg" ? { matteColor } : {}),
  });
  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = project.exportPresets?.find(
      (candidate) => candidate.id === id,
    );
    if (!preset) return;
    setFormat(preset.format);
    setScale(preset.scale);
    setQuality(preset.quality ?? 90);
    setMatteColor(preset.matteColor ?? "#FFFFFF");
    setPresetName(preset.name);
  };
  const toggleFrame = (frameId: string) =>
    setSelectedFrameIds((ids) =>
      ids.includes(frameId)
        ? ids.filter((candidate) => candidate !== frameId)
        : [...ids, frameId],
    );
  const run = async () => {
    if (selectedFrameIds.length === 0) return;
    setBusy(true);
    try {
      await exportFrames(selectedFrameIds, settings());
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const savePreset = async () => {
    if (!presetName.trim()) return;
    setBusy(true);
    try {
      const preset: ExportPreset = {
        id: presetId || crypto.randomUUID(),
        name: presetName.trim(),
        ...settings(),
      };
      await saveExportPreset(preset);
      setPresetId(preset.id);
    } finally {
      setBusy(false);
    }
  };
  const removePreset = async () => {
    if (!presetId) return;
    setBusy(true);
    try {
      await removeExportPreset(presetId);
      setPresetId("");
      setPresetName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog className="export-dialog" onClose={onClose} titleId={titleId}>
      <span className="eyebrow">Canonical export</span>
      <h2 id={titleId}>Export campaign frames</h2>
      <p>
        Render committed revisions through the pinned renderer. Export settings
        never modify frame content.
      </p>

      <div className="export-section">
        <div className="export-section-heading">
          <strong>Frames</strong>
          <button
            type="button"
            onClick={() =>
              setSelectedFrameIds(
                selectedFrameIds.length === frames.length
                  ? activeFrame
                    ? [activeFrame.id]
                    : []
                  : frames.map((frame) => frame.id),
              )
            }
          >
            {selectedFrameIds.length === frames.length
              ? "Active only"
              : "Select all"}
          </button>
        </div>
        <div className="export-frame-list" role="group" aria-label="Frames">
          {frames.map((frame) => (
            <label key={frame.id}>
              <input
                type="checkbox"
                checked={selectedFrameIds.includes(frame.id)}
                onChange={() => toggleFrame(frame.id)}
              />
              <span>{frame.name}</span>
              <small>
                {frame.canvas.width}×{frame.canvas.height} · r{frame.revision}
              </small>
            </label>
          ))}
        </div>
      </div>

      <div className="modal-grid">
        <label>
          Format
          <select
            value={format}
            onChange={(event) =>
              setFormat(event.currentTarget.value as ExportFormat)
            }
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        <label>
          Scale
          <select
            value={scale}
            onChange={(event) => setScale(Number(event.currentTarget.value))}
          >
            {SCALE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        {format !== "png" && (
          <label>
            Quality
            <input
              type="number"
              min="1"
              max="100"
              value={quality}
              onChange={(event) =>
                setQuality(Number(event.currentTarget.value))
              }
            />
          </label>
        )}
        {format === "jpeg" && (
          <label>
            Transparency matte
            <input
              type="color"
              value={matteColor}
              onChange={(event) => setMatteColor(event.currentTarget.value)}
            />
          </label>
        )}
      </div>
      <div
        className={`export-alpha-status${alphaEligible ? " is-eligible" : ""}`}
      >
        <strong>
          {alphaEligible
            ? "Alpha retained"
            : mixedAlpha
              ? "Mixed alpha eligibility"
              : "Opaque output"}
        </strong>
        <span>
          {alphaEligible
            ? "Every selected canvas is transparent and the format supports alpha."
            : mixedAlpha
              ? `${alphaEligibleCount} of ${selectedFrames.length} selected frames retain alpha; opaque canvases remain opaque.`
              : format === "jpeg"
                ? `Transparent canvas pixels are flattened to ${matteColor}.`
                : "Alpha requires transparent canvases across every selected frame."}
        </span>
      </div>

      <div className="export-section">
        <strong>Named project preset</strong>
        <div className="export-preset-row">
          <select
            aria-label="Saved export preset"
            value={presetId}
            onChange={(event) => applyPreset(event.currentTarget.value)}
          >
            <option value="">New preset</option>
            {(project.exportPresets ?? []).map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Preset name"
            placeholder="Campaign web"
            value={presetName}
            onChange={(event) => setPresetName(event.currentTarget.value)}
          />
          <button
            type="button"
            disabled={busy || !presetName.trim()}
            onClick={() => void savePreset()}
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy || !presetId}
            onClick={() => void removePreset()}
          >
            Remove
          </button>
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={busy || selectedFrameIds.length === 0}
          onClick={() => void run()}
        >
          {busy
            ? "Exporting…"
            : `Export ${selectedFrameIds.length || ""} ${selectedFrameIds.length === 1 ? "frame" : "frames"}`}
        </button>
      </div>
    </ModalDialog>
  );
}
