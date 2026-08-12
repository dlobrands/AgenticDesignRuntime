import { useRef, useState, type KeyboardEvent } from "react";
import {
  GROUP_BLEND_MODES,
  SUPPORTED_BLEND_MODES,
  effectItems,
  findNode,
  descendantIds,
  listNodes,
  reconcileTextSpans,
  type GradientStop,
  type Effect,
  type SceneNode,
  type FrameOperation,
  type FrameDocument,
  type FrameResizeStrategy,
  type ResizeConstraints,
  type ShapeFill,
  type Stroke,
  type VectorPathCommand,
  type VectorPathNode,
} from "@tva-agentic-design/core";
import { LiveColorPicker } from "./ColorPicker";
import { cropResolution } from "./crop-controller";
import { MARKETING_FRAME_PRESETS } from "./frame-presets";
import { useStudio } from "./store";
import { ProjectTemplates } from "./ProjectTemplates";
import { DesignBriefs } from "./DesignBriefs";
import { DesignPlans } from "./DesignPlans";

function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        key={value}
        type="number"
        defaultValue={Number(value.toFixed(3))}
        step={step}
        min={min}
        max={max}
        onBlur={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next) && next !== value) onCommit(next);
        }}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <input
        key={value}
        defaultValue={value}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (next && next !== value) onCommit(next);
        }}
      />
    </label>
  );
}

function LiveTextContentField({
  node,
}: {
  node: Extract<SceneNode, { type: "text" }>;
}) {
  const [value, setValue] = useState(node.text);
  const previousValue = useRef(node.text);
  const previousSpans = useRef(
    node.spans ? structuredClone(node.spans) : undefined,
  );
  const cancelling = useRef(false);
  const setDraftOperations = useStudio((state) => state.setDraftOperations);
  const beginDraftSession = useStudio((state) => state.beginDraftSession);
  const endDraftSession = useStudio((state) => state.endDraftSession);
  const commitDraftOperations = useStudio(
    (state) => state.commitDraftOperations,
  );
  const draftFor = (text: string): FrameOperation => {
    const spans = previousSpans.current
      ? reconcileTextSpans({
          nodeId: node.id,
          previousText: previousValue.current,
          nextText: text,
          spans: previousSpans.current,
        })
      : undefined;
    previousValue.current = text;
    previousSpans.current = spans;
    return {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "textContent",
      value: { text, spans: spans ?? null },
    };
  };
  return (
    <label className="field field-wide">
      <span>Content</span>
      <textarea
        value={value}
        rows={5}
        onFocus={() => beginDraftSession("text", node.id)}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setValue(text);
          setDraftOperations([draftFor(text)]);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          cancelling.current = true;
          previousValue.current = node.text;
          previousSpans.current = node.spans
            ? structuredClone(node.spans)
            : undefined;
          setValue(node.text);
          setDraftOperations();
          endDraftSession();
          event.currentTarget.blur();
        }}
        onBlur={() => {
          if (cancelling.current) {
            cancelling.current = false;
            return;
          }
          if (value === node.text) {
            setDraftOperations();
            endDraftSession();
            return;
          }
          void commitDraftOperations().finally(endDraftSession);
        }}
      />
      <small>
        Changes preview live. Click away to save once; Escape cancels.
      </small>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string;
  options: readonly string[] | Array<{ value: string; label: string }>;
  onCommit: (value: string) => void;
}) {
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onCommit(event.currentTarget.value)}
      >
        {normalized.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: boolean;
  onCommit: (value: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onCommit(event.currentTarget.checked)}
      />
    </label>
  );
}

function DashEditor({
  dash,
  onCommit,
}: {
  dash?: NonNullable<Stroke["dash"]>;
  onCommit: (dash?: NonNullable<Stroke["dash"]>) => void;
}) {
  const [error, setError] = useState<string>();
  return (
    <div className="dash-editor">
      <Toggle
        label="Dashed"
        value={Boolean(dash)}
        onCommit={(enabled) =>
          onCommit(
            enabled ? { values: [8, 4], offset: 0, cap: "butt" } : undefined,
          )
        }
      />
      {dash && (
        <>
          <label className="field field-wide">
            <span>Dash values</span>
            <input
              key={dash.values.join(",")}
              defaultValue={dash.values.join(", ")}
              aria-describedby={error ? "dash-values-error" : undefined}
              onBlur={(event) => {
                const values = event.currentTarget.value
                  .split(/[\s,]+/)
                  .filter(Boolean)
                  .map(Number);
                if (
                  values.length < 2 ||
                  values.length % 2 !== 0 ||
                  values.some((value) => !Number.isFinite(value) || value <= 0)
                ) {
                  setError(
                    "Enter an even number of positive dash and gap values.",
                  );
                  return;
                }
                setError(undefined);
                onCommit({ ...dash, values });
              }}
            />
          </label>
          {error && (
            <p id="dash-values-error" className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="field-grid">
            <NumberField
              label="Dash offset"
              value={dash.offset}
              onCommit={(offset) => onCommit({ ...dash, offset })}
            />
            <SelectField
              label="Dash cap"
              value={dash.cap}
              options={["butt", "round", "square"]}
              onCommit={(cap) =>
                onCommit({
                  ...dash,
                  cap: cap as NonNullable<Stroke["dash"]>["cap"],
                })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="inspector-section" open={open}>
      <summary>
        {title}
        <span>⌄</span>
      </summary>
      <div className="section-fields">{children}</div>
    </details>
  );
}

function CanonicalDetails({ node }: { node: SceneNode }) {
  const details = structuredClone(node) as SceneNode;
  if (details.type === "group")
    (details as unknown as { children: unknown }).children =
      details.children.map((child) => ({
        id: child.id,
        type: child.type,
        name: child.name,
      }));
  if (details.type === "mask")
    (details as unknown as { children: unknown }).children =
      details.children.map((child) => ({
        id: child.id,
        type: child.type,
        name: child.name,
      }));
  return (
    <Section title="Canonical details · read-only">
      <p className="advanced-disclosure">
        Exact stable properties remain visible here even when a dedicated Studio
        control is intentionally read-only.
      </p>
      <pre className="canonical-details">
        {JSON.stringify(details, null, 2)}
      </pre>
    </Section>
  );
}

const defaultGradient = (
  type: "linearGradient" | "radialGradient",
): ShapeFill => {
  const stops: GradientStop[] = [
    { id: crypto.randomUUID(), offset: 0, color: "#315BFF", opacity: 1 },
    { id: crypto.randomUUID(), offset: 1, color: "#0A1024", opacity: 1 },
  ];
  return type === "linearGradient"
    ? {
        type,
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        stops,
        interpolation: "linear-srgb",
        spread: "pad",
        dither: true,
      }
    : {
        type,
        center: { x: 0.5, y: 0.5 },
        radius: { x: 0.5, y: 0.5 },
        stops,
        interpolation: "linear-srgb",
        spread: "pad",
        dither: true,
      };
};

function PaintEditor({
  label,
  paint,
  commit,
  preview,
  cancel,
  allowedTypes = ["solid", "linearGradient", "radialGradient"],
}: {
  label: string;
  paint: ShapeFill;
  commit: (paint: ShapeFill) => void;
  preview: (paint: ShapeFill) => void;
  cancel: () => void;
  allowedTypes?: ShapeFill["type"][];
}) {
  const updateStop = (id: string, changes: Partial<GradientStop>) => {
    if (paint.type === "solid") return;
    commit({
      ...paint,
      stops: paint.stops.map((stop) =>
        stop.id === id ? { ...stop, ...changes } : stop,
      ),
    });
  };
  return (
    <div className="paint-editor">
      <SelectField
        label={label}
        value={paint.type}
        options={[
          { value: "solid", label: "Solid" },
          { value: "linearGradient", label: "Linear gradient" },
          { value: "radialGradient", label: "Radial gradient" },
        ].filter((option) =>
          allowedTypes.includes(option.value as ShapeFill["type"]),
        )}
        onCommit={(type) =>
          commit(
            type === "solid"
              ? { type: "solid", color: "#315BFF", opacity: 1 }
              : defaultGradient(type as "linearGradient" | "radialGradient"),
          )
        }
      />
      {paint.type === "solid" ? (
        <div className="color-row">
          <LiveColorPicker
            label={`${label} color`}
            value={paint.color}
            onPreview={(color) => preview({ ...paint, color })}
            onCommit={(color) => commit({ ...paint, color })}
            onCancel={cancel}
          />
          <NumberField
            label="Alpha"
            value={paint.opacity}
            min={0}
            max={1}
            step={0.05}
            onCommit={(opacity) => commit({ ...paint, opacity })}
          />
        </div>
      ) : (
        <>
          <div
            className="gradient-strip"
            style={{
              background: `linear-gradient(90deg, ${paint.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(",")})`,
            }}
          />
          <div className="gradient-stops">
            {paint.stops.map((stop) => (
              <div className="gradient-stop" key={stop.id}>
                <LiveColorPicker
                  label="Stop color"
                  value={stop.color}
                  onPreview={(color) =>
                    preview({
                      ...paint,
                      stops: paint.stops.map((candidate) =>
                        candidate.id === stop.id
                          ? { ...candidate, color }
                          : candidate,
                      ),
                    })
                  }
                  onCommit={(color) => updateStop(stop.id, { color })}
                  onCancel={cancel}
                />
                <input
                  aria-label="Stop position"
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(stop.offset * 100)}
                  onChange={(event) =>
                    updateStop(stop.id, {
                      offset: Number(event.currentTarget.value) / 100,
                    })
                  }
                />
                <NumberField
                  label="Stop alpha"
                  value={stop.opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  onCommit={(opacity) => updateStop(stop.id, { opacity })}
                />
                <button
                  disabled={paint.stops.length <= 2}
                  aria-label="Remove gradient stop"
                  onClick={() =>
                    commit({
                      ...paint,
                      stops: paint.stops.filter(
                        (candidate) => candidate.id !== stop.id,
                      ),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="subtle-button"
              disabled={paint.stops.length >= 16}
              onClick={() =>
                commit({
                  ...paint,
                  stops: [
                    ...paint.stops,
                    {
                      id: crypto.randomUUID(),
                      offset: 0.5,
                      color: "#FFFFFF",
                      opacity: 1,
                    },
                  ].sort((a, b) => a.offset - b.offset),
                })
              }
            >
              Add stop
            </button>
          </div>
          {paint.type === "linearGradient" ? (
            <div className="field-grid">
              <NumberField
                label="Start X"
                value={paint.start.x}
                step={0.05}
                onCommit={(x) =>
                  commit({ ...paint, start: { ...paint.start, x } })
                }
              />
              <NumberField
                label="Start Y"
                value={paint.start.y}
                step={0.05}
                onCommit={(y) =>
                  commit({ ...paint, start: { ...paint.start, y } })
                }
              />
              <NumberField
                label="End X"
                value={paint.end.x}
                step={0.05}
                onCommit={(x) => commit({ ...paint, end: { ...paint.end, x } })}
              />
              <NumberField
                label="End Y"
                value={paint.end.y}
                step={0.05}
                onCommit={(y) => commit({ ...paint, end: { ...paint.end, y } })}
              />
            </div>
          ) : (
            <>
              <div className="field-grid">
                <NumberField
                  label="Center X"
                  value={paint.center.x}
                  step={0.05}
                  onCommit={(x) =>
                    commit({ ...paint, center: { ...paint.center, x } })
                  }
                />
                <NumberField
                  label="Center Y"
                  value={paint.center.y}
                  step={0.05}
                  onCommit={(y) =>
                    commit({ ...paint, center: { ...paint.center, y } })
                  }
                />
                <NumberField
                  label="Radius X"
                  value={paint.radius.x}
                  min={0.01}
                  step={0.05}
                  onCommit={(x) =>
                    commit({ ...paint, radius: { ...paint.radius, x } })
                  }
                />
                <NumberField
                  label="Radius Y"
                  value={paint.radius.y}
                  min={0.01}
                  step={0.05}
                  onCommit={(y) =>
                    commit({ ...paint, radius: { ...paint.radius, y } })
                  }
                />
              </div>
              <Toggle
                label="Use focal point"
                value={Boolean(paint.focalPoint)}
                onCommit={(enabled) => {
                  if (enabled)
                    commit({ ...paint, focalPoint: { ...paint.center } });
                  else {
                    const withoutFocalPoint = structuredClone(paint);
                    delete withoutFocalPoint.focalPoint;
                    commit(withoutFocalPoint);
                  }
                }}
              />
              {paint.focalPoint && (
                <div className="field-grid">
                  <NumberField
                    label="Focal X"
                    value={paint.focalPoint.x}
                    step={0.05}
                    onCommit={(x) =>
                      commit({
                        ...paint,
                        focalPoint: { ...paint.focalPoint!, x },
                      })
                    }
                  />
                  <NumberField
                    label="Focal Y"
                    value={paint.focalPoint.y}
                    step={0.05}
                    onCommit={(y) =>
                      commit({
                        ...paint,
                        focalPoint: { ...paint.focalPoint!, y },
                      })
                    }
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Properties({ node }: { node?: SceneNode }) {
  const frame = useStudio((state) => state.activeFrame)!;
  const assets = useStudio((state) => state.assets.assets);
  const fonts = useStudio((state) => state.fonts.fonts);
  const commit = useStudio((state) => state.commit);
  const requestCropEdit = useStudio((state) => state.requestCropEdit);
  const setDraftOperations = useStudio((state) => state.setDraftOperations);
  const commitDraftOperations = useStudio(
    (state) => state.commitDraftOperations,
  );
  const update = (
    propertyGroup: Extract<
      FrameOperation,
      { kind: "updateNode" }
    >["propertyGroup"],
    value: Record<string, unknown>,
  ) => {
    if (!node) return;
    void commit([
      {
        kind: "updateNode",
        nodeId: node.id,
        propertyGroup,
        value,
      } as FrameOperation,
    ]);
  };
  const operation = (
    propertyGroup: Extract<
      FrameOperation,
      { kind: "updateNode" }
    >["propertyGroup"],
    value: Record<string, unknown>,
  ): FrameOperation | undefined =>
    node
      ? ({
          kind: "updateNode",
          nodeId: node.id,
          propertyGroup,
          value,
        } as FrameOperation)
      : undefined;
  const preview = (
    propertyGroup: Extract<
      FrameOperation,
      { kind: "updateNode" }
    >["propertyGroup"],
    value: Record<string, unknown>,
  ) => {
    const next = operation(propertyGroup, value);
    if (next) setDraftOperations([next]);
  };
  const commitLive = (
    propertyGroup: Extract<
      FrameOperation,
      { kind: "updateNode" }
    >["propertyGroup"],
    value: Record<string, unknown>,
  ) => {
    const next = operation(propertyGroup, value);
    if (!next) return;
    setDraftOperations([next]);
    void commitDraftOperations();
  };
  const cancelLive = () => setDraftOperations();
  if (!node) return <CanvasProperties />;
  return (
    <div className="inspector-scroll">
      <Section title="Layer" open>
        <TextField
          label="Name"
          value={node.name}
          onCommit={(name) => update("common", { name })}
        />
        <div className="field-grid">
          <Toggle
            label="Visible"
            value={node.visible}
            onCommit={(visible) => update("visibility", { visible })}
          />
          <Toggle
            label="Locked"
            value={node.locked}
            onCommit={(locked) => update("locking", { locked })}
          />
        </div>
        <div className="identity-line">
          <span>{node.type}</span>
          <code>{node.id.slice(0, 8)}</code>
        </div>
      </Section>
      {node.type !== "adjustment" && (
        <>
          <Section title="Transform" open>
            <div className="field-grid">
              {(["x", "y", "width", "height", "rotation"] as const).map(
                (key) => (
                  <NumberField
                    key={key}
                    label={key}
                    value={node.transform[key]}
                    step={
                      key.startsWith("scale") || key.startsWith("anchor")
                        ? 0.05
                        : 1
                    }
                    onCommit={(value) => update("transform", { [key]: value })}
                  />
                ),
              )}
            </div>
            <details className="advanced-group">
              <summary>Advanced transform</summary>
              <div className="field-grid">
                {(
                  [
                    "scaleX",
                    "scaleY",
                    "skewX",
                    "skewY",
                    "anchorX",
                    "anchorY",
                  ] as const
                ).map((key) => (
                  <NumberField
                    key={key}
                    label={key}
                    value={node.transform[key]}
                    step={
                      key.startsWith("scale") || key.startsWith("anchor")
                        ? 0.05
                        : 1
                    }
                    onCommit={(value) => update("transform", { [key]: value })}
                  />
                ))}
              </div>
            </details>
          </Section>
          <Section title="Resize constraints">
            <div className="field-grid">
              <SelectField
                label="Horizontal"
                value={node.resizeConstraints?.horizontal ?? "left"}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                  { value: "stretch", label: "Left + right" },
                  { value: "scale", label: "Scale" },
                ]}
                onCommit={(horizontal) =>
                  update("resizeConstraints", {
                    constraints: {
                      horizontal: horizontal as ResizeConstraints["horizontal"],
                      vertical: node.resizeConstraints?.vertical ?? "top",
                    } satisfies ResizeConstraints,
                  })
                }
              />
              <SelectField
                label="Vertical"
                value={node.resizeConstraints?.vertical ?? "top"}
                options={[
                  { value: "top", label: "Top" },
                  { value: "middle", label: "Middle" },
                  { value: "bottom", label: "Bottom" },
                  { value: "stretch", label: "Top + bottom" },
                  { value: "scale", label: "Scale" },
                ]}
                onCommit={(vertical) =>
                  update("resizeConstraints", {
                    constraints: {
                      horizontal: node.resizeConstraints?.horizontal ?? "left",
                      vertical: vertical as ResizeConstraints["vertical"],
                    } satisfies ResizeConstraints,
                  })
                }
              />
            </div>
            {node.resizeConstraints && (
              <button
                className="subtle-button"
                onClick={() =>
                  update("resizeConstraints", { constraints: null })
                }
              >
                Use left / top defaults
              </button>
            )}
            <p className="advanced-disclosure">
              Frame reflow applies constraints to top-level layers. Nested
              constraints are retained for future container reflow.
            </p>
          </Section>
        </>
      )}
      {"opacity" in node && "blendMode" in node && (
        <Section title="Compositing">
          <NumberField
            label="Opacity"
            value={node.opacity}
            min={0}
            max={1}
            step={0.05}
            onCommit={(opacity) => update("compositing", { opacity })}
          />
          <SelectField
            label="Blend"
            value={node.blendMode}
            options={
              node.type === "group" ? GROUP_BLEND_MODES : SUPPORTED_BLEND_MODES
            }
            onCommit={(blendMode) => update("compositing", { blendMode })}
          />
        </Section>
      )}
      {node.type === "text" && (
        <>
          <Section title="Text" open>
            <LiveTextContentField key={`${node.id}:${node.text}`} node={node} />
            {node.spans?.length ? (
              <div className="rich-text-summary">
                <div>
                  <strong>{node.spans.length} rich text spans</strong>
                  <span>
                    Select a range in the on-canvas editor to change its font,
                    size, weight, style, color, opacity, tracking, baseline, or
                    decoration.
                  </span>
                </div>
                <ol>
                  {node.spans.map((span) => (
                    <li key={span.id}>
                      <code>
                        {span.start}–{span.end}
                      </code>
                      <span>{node.text.slice(span.start, span.end)}</span>
                      <code>{JSON.stringify(span.style)}</code>
                    </li>
                  ))}
                </ol>
                <button
                  className="subtle-button"
                  onClick={() =>
                    update("textContent", { text: node.text, spans: null })
                  }
                >
                  Flatten to paragraph style
                </button>
              </div>
            ) : (
              <p className="advanced-disclosure">
                Plain text uses the paragraph typography below. Rich spans are
                optional and begin only when a selected range is formatted in
                the on-canvas editor.
              </p>
            )}
          </Section>
          <Section title="Typography" open>
            <SelectField
              label="Font"
              value={node.typography.fontId}
              options={fonts.map((font) => ({
                value: font.id,
                label: `${font.family} · ${font.weight}${font.style === "italic" ? " Italic" : ""}`,
              }))}
              onCommit={(fontId) => update("typography", { fontId })}
            />
            <div className="field-grid">
              <NumberField
                label="Size"
                value={node.typography.fontSize}
                min={1}
                onCommit={(fontSize) => update("typography", { fontSize })}
              />
              <NumberField
                label="Weight"
                value={node.typography.fontWeight}
                min={1}
                max={1000}
                onCommit={(fontWeight) => update("typography", { fontWeight })}
              />
              <NumberField
                label="Line height"
                value={node.typography.lineHeight}
                min={1}
                onCommit={(lineHeight) => update("typography", { lineHeight })}
              />
              <NumberField
                label="Tracking"
                value={node.typography.letterSpacing}
                onCommit={(letterSpacing) =>
                  update("typography", { letterSpacing })
                }
              />
              <NumberField
                label="Text opacity"
                value={node.typography.opacity}
                min={0}
                max={1}
                step={0.05}
                onCommit={(opacity) => update("typography", { opacity })}
              />
            </div>
            <SelectField
              label="Style"
              value={node.typography.fontStyle}
              options={["normal", "italic"]}
              onCommit={(fontStyle) => update("typography", { fontStyle })}
            />
            <SelectField
              label="Align"
              value={node.typography.alignment}
              options={["left", "center", "right", "justify"]}
              onCommit={(alignment) => update("typography", { alignment })}
            />
            <SelectField
              label="Vertical align"
              value={node.typography.verticalAlignment}
              options={["top", "middle", "bottom"]}
              onCommit={(verticalAlignment) =>
                update("typography", { verticalAlignment })
              }
            />
            <div className="color-row">
              <LiveColorPicker
                label="Text color"
                value={node.typography.color}
                onPreview={(color) => preview("typography", { color })}
                onCommit={(color) => commitLive("typography", { color })}
                onCancel={cancelLive}
              />
            </div>
          </Section>
          <Section title="Text box">
            <SelectField
              label="Mode"
              value={node.textBox.mode}
              options={["autoWidth", "autoHeight", "fixed"]}
              onCommit={(mode) => update("textBox", { mode })}
            />
            <SelectField
              label="Wrap"
              value={node.textBox.wrapping}
              options={["word", "character", "none"]}
              onCommit={(wrapping) => update("textBox", { wrapping })}
            />
            <SelectField
              label="Overflow"
              value={node.textBox.overflow}
              options={["visible", "clip"]}
              onCommit={(overflow) => update("textBox", { overflow })}
            />
            <Toggle
              label="Accept overflow"
              value={Boolean(node.textBox.overflowAccepted)}
              onCommit={(overflowAccepted) =>
                update("textBox", { overflowAccepted })
              }
            />
          </Section>
        </>
      )}
      {(node.type === "rectangle" || node.type === "ellipse") && (
        <>
          <Section title="Fill" open>
            <PaintEditor
              label="Paint"
              paint={node.fill}
              preview={(fill) => preview("fill", { fill })}
              commit={(fill) => commitLive("fill", { fill })}
              cancel={cancelLive}
            />
          </Section>
          <StrokeSection node={node} update={update} />
          {node.type === "rectangle" && (
            <Section title="Corners">
              <div className="field-grid">
                {(
                  Object.keys(node.cornerRadius) as Array<
                    keyof typeof node.cornerRadius
                  >
                ).map((key) => (
                  <NumberField
                    key={key}
                    label={key}
                    min={0}
                    value={node.cornerRadius[key]}
                    onCommit={(radius) =>
                      update("shape", {
                        cornerRadius: { ...node.cornerRadius, [key]: radius },
                      })
                    }
                  />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
      {node.type === "vectorPath" && (
        <VectorPathSection
          node={node}
          update={update}
          preview={preview}
          commitLive={commitLive}
          cancelLive={cancelLive}
        />
      )}
      {node.type === "rasterImage" && (
        <Section title="Image" open>
          {(() => {
            const asset = assets.find(
              (candidate) =>
                candidate.id === node.assetId && candidate.type === "raster",
            );
            const resolution = asset
              ? cropResolution({ node, asset })
              : undefined;
            return (
              <>
                <button
                  className="primary-inline-button"
                  disabled={node.locked || !node.visible}
                  onClick={() => requestCropEdit(node.id)}
                >
                  Crop on canvas
                </button>
                {resolution?.lowResolution && (
                  <p className="field-warning" role="status">
                    Low resolution: {Math.round(resolution.sourceWidth)} ×{" "}
                    {Math.round(resolution.sourceHeight)} source pixels for a{" "}
                    {Math.round(resolution.displayWidth)} ×{" "}
                    {Math.round(resolution.displayHeight)} display.
                  </p>
                )}
              </>
            );
          })()}
          <SelectField
            label="Asset"
            value={node.assetId}
            options={assets
              .filter((asset) => asset.type === "raster")
              .map((asset) => ({
                value: asset.id,
                label: asset.path.split("/").at(-1) ?? asset.id,
              }))}
            onCommit={(assetId) =>
              void commit([{ kind: "replaceAsset", nodeId: node.id, assetId }])
            }
          />
          <SelectField
            label="Fit"
            value={node.fit}
            options={["fill", "contain", "cover", "none"]}
            onCommit={(fit) => update("crop", { fit })}
          />
          <div className="field-grid">
            {(["x", "y", "width", "height"] as const).map((key) => (
              <NumberField
                key={key}
                label={`Crop ${key}`}
                value={
                  node.crop?.[key] ??
                  (key === "width" || key === "height" ? 1 : 0)
                }
                min={0}
                max={1}
                step={0.01}
                onCommit={(value) =>
                  update("crop", {
                    crop: {
                      ...(node.crop ?? { x: 0, y: 0, width: 1, height: 1 }),
                      [key]: value,
                    },
                  })
                }
              />
            ))}
          </div>
          <button
            className="subtle-button"
            onClick={() => update("crop", { crop: null })}
          >
            Reset crop
          </button>
        </Section>
      )}
      {node.type === "svg" && (
        <Section title="Vector asset" open>
          <SelectField
            label="Asset"
            value={node.assetId}
            options={assets
              .filter((asset) => asset.type === "svg")
              .map((asset) => ({
                value: asset.id,
                label: asset.path.split("/").at(-1) ?? asset.id,
              }))}
            onCommit={(assetId) =>
              void commit([{ kind: "replaceAsset", nodeId: node.id, assetId }])
            }
          />
          <div className="identity-line">
            <span>Intrinsic</span>
            <code>
              {node.intrinsicSize.width}×{node.intrinsicSize.height}
            </code>
          </div>
        </Section>
      )}
      {node.type === "mask" && (
        <Section title="Mask" open>
          <SelectField
            label="Mode"
            value={node.mode}
            options={["alpha", "luminance"]}
            onCommit={(mode) =>
              void commit([
                {
                  kind: "updateMask",
                  maskId: node.id,
                  value: { mode: mode as "alpha" | "luminance" },
                },
              ])
            }
          />
          <Toggle
            label="Invert"
            value={node.inverted}
            onCommit={(inverted) =>
              void commit([
                { kind: "updateMask", maskId: node.id, value: { inverted } },
              ])
            }
          />
          <div className="identity-line">
            <span>Source</span>
            <code>{node.maskSource.name}</code>
          </div>
        </Section>
      )}
      {node.type === "adjustment" && (
        <Section title="Adjustment" open>
          <SelectField
            label="Target"
            value={node.targetId}
            options={[
              { value: "root", label: "Frame" },
              ...listNodes(frame)
                .filter((candidate) =>
                  [
                    "rasterImage",
                    "svg",
                    "vectorPath",
                    "group",
                    "mask",
                  ].includes(candidate.type),
                )
                .map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name,
                })),
            ]}
            onCommit={(targetId) =>
              void commit([
                {
                  kind: "setAdjustment",
                  adjustmentId: node.id,
                  values: {},
                  targetId,
                },
              ])
            }
          />
          <Toggle
            label="Enabled"
            value={node.enabled}
            onCommit={(enabled) =>
              void commit([
                { kind: "toggleAdjustment", adjustmentId: node.id, enabled },
              ])
            }
          />
          <div className="field-grid">
            {(Object.keys(node.values) as Array<keyof typeof node.values>).map(
              (key) => (
                <NumberField
                  key={key}
                  label={key}
                  value={node.values[key]}
                  min={key === "blur" ? 0 : key === "hue" ? -180 : -100}
                  max={key === "blur" ? 64 : key === "hue" ? 180 : 100}
                  onCommit={(value) =>
                    void commit([
                      {
                        kind: "setAdjustment",
                        adjustmentId: node.id,
                        values: { [key]: value },
                      },
                    ])
                  }
                />
              ),
            )}
          </div>
        </Section>
      )}
      {node.type !== "adjustment" && (
        <EffectsSection node={node} update={update} />
      )}
      <CanonicalDetails node={node} />
    </div>
  );
}

const vectorPoint = (x: number, y: number) => ({
  x: Math.max(0, Math.min(1, x)),
  y: Math.max(0, Math.min(1, y)),
});

function VectorPathSection({
  node,
  update,
  preview,
  commitLive,
  cancelLive,
}: {
  node: VectorPathNode;
  update: (
    group: Extract<FrameOperation, { kind: "updateNode" }>["propertyGroup"],
    value: Record<string, unknown>,
  ) => void;
  preview: (
    group: Extract<FrameOperation, { kind: "updateNode" }>["propertyGroup"],
    value: Record<string, unknown>,
  ) => void;
  commitLive: (
    group: Extract<FrameOperation, { kind: "updateNode" }>["propertyGroup"],
    value: Record<string, unknown>,
  ) => void;
  cancelLive: () => void;
}) {
  const setCommands = (commands: VectorPathCommand[]) =>
    update("vectorPath", { commands });
  const replaceCommand = (commandId: string, replacement: VectorPathCommand) =>
    setCommands(
      node.commands.map((command) =>
        command.id === commandId ? replacement : command,
      ),
    );
  const lastEndpoint = [...node.commands]
    .reverse()
    .find(
      (
        command,
      ): command is Extract<
        VectorPathCommand,
        { kind: "move" | "line" | "cubic" }
      > => command.kind !== "close",
    )?.to ?? { x: 0.5, y: 0.5 };
  const drawableCount = node.commands.filter(
    (command) => command.kind === "line" || command.kind === "cubic",
  ).length;
  const insertBeforeClose = (command: VectorPathCommand) => {
    const commands = structuredClone(node.commands);
    const index =
      commands.at(-1)?.kind === "close" ? commands.length - 1 : commands.length;
    commands.splice(index, 0, command);
    setCommands(commands);
  };
  return (
    <>
      <Section title="Path points" open>
        <p className="advanced-disclosure">
          Coordinates are normalized to this layer’s bounds. Point IDs remain
          stable across edits and agent revisions.
        </p>
        <ol className="vector-command-list">
          {node.commands.map((command, index) => (
            <li key={command.id} className="vector-command">
              <div className="vector-command-heading">
                <code>
                  {index + 1}. {command.kind}
                </code>
                <button
                  className="subtle-button"
                  aria-label={`Remove ${command.kind} point ${index + 1}`}
                  disabled={
                    index === 0 ||
                    (command.kind !== "close" && drawableCount <= 1)
                  }
                  onClick={() =>
                    setCommands(
                      node.commands.filter(
                        (candidate) => candidate.id !== command.id,
                      ),
                    )
                  }
                >
                  Remove
                </button>
              </div>
              {command.kind !== "close" && (
                <div className="field-grid">
                  <NumberField
                    label="X"
                    value={command.to.x}
                    min={0}
                    max={1}
                    step={0.01}
                    onCommit={(x) =>
                      replaceCommand(command.id, {
                        ...command,
                        to: vectorPoint(x, command.to.y),
                      })
                    }
                  />
                  <NumberField
                    label="Y"
                    value={command.to.y}
                    min={0}
                    max={1}
                    step={0.01}
                    onCommit={(y) =>
                      replaceCommand(command.id, {
                        ...command,
                        to: vectorPoint(command.to.x, y),
                      })
                    }
                  />
                  {command.kind === "cubic" && (
                    <>
                      {(["control1", "control2"] as const).flatMap((key) => [
                        <NumberField
                          key={`${key}-x`}
                          label={`${key === "control1" ? "C1" : "C2"} X`}
                          value={command[key].x}
                          min={0}
                          max={1}
                          step={0.01}
                          onCommit={(x) =>
                            replaceCommand(command.id, {
                              ...command,
                              [key]: vectorPoint(x, command[key].y),
                            })
                          }
                        />,
                        <NumberField
                          key={`${key}-y`}
                          label={`${key === "control1" ? "C1" : "C2"} Y`}
                          value={command[key].y}
                          min={0}
                          max={1}
                          step={0.01}
                          onCommit={(y) =>
                            replaceCommand(command.id, {
                              ...command,
                              [key]: vectorPoint(command[key].x, y),
                            })
                          }
                        />,
                      ])}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="vector-command-actions">
          <button
            className="subtle-button"
            onClick={() =>
              insertBeforeClose({
                id: crypto.randomUUID(),
                kind: "line",
                to: vectorPoint(lastEndpoint.x + 0.1, lastEndpoint.y + 0.1),
              })
            }
          >
            Add line point
          </button>
          <button
            className="subtle-button"
            onClick={() =>
              insertBeforeClose({
                id: crypto.randomUUID(),
                kind: "cubic",
                control1: vectorPoint(lastEndpoint.x + 0.03, lastEndpoint.y),
                control2: vectorPoint(
                  lastEndpoint.x + 0.07,
                  lastEndpoint.y + 0.1,
                ),
                to: vectorPoint(lastEndpoint.x + 0.1, lastEndpoint.y + 0.1),
              })
            }
          >
            Add curve point
          </button>
          <button
            className="subtle-button"
            disabled={node.commands.at(-1)?.kind === "close"}
            onClick={() =>
              setCommands([
                ...node.commands,
                { id: crypto.randomUUID(), kind: "close" },
              ])
            }
          >
            Close path
          </button>
        </div>
      </Section>
      <Section title="Fill" open>
        <Toggle
          label="Enabled"
          value={Boolean(node.fill)}
          onCommit={(enabled) =>
            update("fill", {
              fill: enabled
                ? (node.fill ?? { type: "solid", color: "#315BFF", opacity: 1 })
                : null,
            })
          }
        />
        {node.fill && (
          <PaintEditor
            label="Paint"
            paint={node.fill}
            preview={(fill) => preview("fill", { fill })}
            commit={(fill) => commitLive("fill", { fill })}
            cancel={cancelLive}
          />
        )}
      </Section>
      <StrokeSection node={node} update={update} />
    </>
  );
}

function StrokeSection({
  node,
  update,
}: {
  node: Extract<SceneNode, { type: "rectangle" | "ellipse" | "vectorPath" }>;
  update: (
    group: Extract<FrameOperation, { kind: "updateNode" }>["propertyGroup"],
    value: Record<string, unknown>,
  ) => void;
}) {
  const setDraftOperations = useStudio((state) => state.setDraftOperations);
  const commitDraftOperations = useStudio(
    (state) => state.commitDraftOperations,
  );
  const defaultStroke: Stroke = {
    enabled: true,
    width: 2,
    alignment: node.type === "vectorPath" ? "center" : "inside",
    opacity: 1,
    paint: { type: "solid", color: "#FFFFFF", opacity: 1 },
  };
  const stroke = node.stroke;
  return (
    <Section title="Stroke">
      <Toggle
        label="Enabled"
        value={Boolean(stroke?.enabled)}
        onCommit={(enabled) =>
          update("stroke", {
            stroke: enabled ? { ...(stroke ?? defaultStroke), enabled } : null,
          })
        }
      />
      {stroke && (
        <>
          <NumberField
            label="Width"
            value={stroke.width}
            min={0}
            onCommit={(width) =>
              update("stroke", { stroke: { ...stroke, width } })
            }
          />
          <SelectField
            label="Alignment"
            value={stroke.alignment}
            options={["inside", "center", "outside"]}
            onCommit={(alignment) =>
              update("stroke", { stroke: { ...stroke, alignment } })
            }
          />
          <NumberField
            label="Stroke opacity"
            value={stroke.opacity}
            min={0}
            max={1}
            step={0.05}
            onCommit={(opacity) =>
              update("stroke", { stroke: { ...stroke, opacity } })
            }
          />
          <DashEditor
            dash={stroke.dash}
            onCommit={(dash) =>
              update("stroke", {
                stroke: {
                  ...stroke,
                  ...(dash ? { dash } : { dash: undefined }),
                },
              })
            }
          />
          <PaintEditor
            label="Paint"
            paint={stroke.paint}
            preview={(paint) =>
              setDraftOperations([
                {
                  kind: "updateNode",
                  nodeId: node.id,
                  propertyGroup: "stroke",
                  value: { stroke: { ...stroke, paint } },
                },
              ])
            }
            commit={(paint) => {
              setDraftOperations([
                {
                  kind: "updateNode",
                  nodeId: node.id,
                  propertyGroup: "stroke",
                  value: { stroke: { ...stroke, paint } },
                },
              ]);
              void commitDraftOperations();
            }}
            cancel={() => setDraftOperations()}
          />
        </>
      )}
    </Section>
  );
}

const effectLabel = (type: Effect["type"]): string =>
  ({
    outerShadow: "Outer shadow",
    innerShadow: "Inner shadow",
    blur: "Blur",
    innerGlow: "Inner glow",
    outerGlow: "Outer glow",
    colorOverlay: "Color overlay",
    gradientOverlay: "Gradient overlay",
  })[type];

const newEffect = (type: Effect["type"]): Effect => {
  const base = { id: crypto.randomUUID(), enabled: true };
  switch (type) {
    case "outerShadow":
    case "innerShadow":
      return {
        ...base,
        type,
        offsetX: 0,
        offsetY: type === "outerShadow" ? 12 : 4,
        blur: type === "outerShadow" ? 24 : 10,
        spread: 0,
        color: "#000000",
        opacity: type === "outerShadow" ? 0.35 : 0.45,
      };
    case "blur":
      return { ...base, type, radius: 8 };
    case "innerGlow":
    case "outerGlow":
      return {
        ...base,
        type,
        blur: type === "outerGlow" ? 20 : 10,
        spread: 0,
        color: type === "outerGlow" ? "#315BFF" : "#FFFFFF",
        opacity: 0.45,
      };
    case "colorOverlay":
      return {
        ...base,
        type,
        paint: { type: "solid", color: "#315BFF", opacity: 1 },
        opacity: 0.5,
      };
    case "gradientOverlay":
      return {
        ...base,
        type,
        paint: defaultGradient("linearGradient") as Extract<
          ShapeFill,
          { type: "linearGradient" | "radialGradient" }
        >,
        opacity: 0.5,
      };
  }
};

function EffectsSection({
  node,
  update,
}: {
  node: Exclude<SceneNode, { type: "adjustment" }>;
  update: (
    group: Extract<FrameOperation, { kind: "updateNode" }>["propertyGroup"],
    value: Record<string, unknown>,
  ) => void;
}) {
  const setDraftOperations = useStudio((state) => state.setDraftOperations);
  const commitDraftOperations = useStudio(
    (state) => state.commitDraftOperations,
  );
  const items = effectItems(node.effects);
  const commitItems = (next: Effect[]) =>
    update("effects", { effects: next.length ? { items: next } : null });
  const operation = (next: Effect[]): FrameOperation => ({
    kind: "updateNode",
    nodeId: node.id,
    propertyGroup: "effects",
    value: { effects: next.length ? { items: next } : null },
  });
  const replace = (id: string, transform: (effect: Effect) => Effect) =>
    commitItems(
      items.map((effect) => (effect.id === id ? transform(effect) : effect)),
    );
  const previewReplace = (id: string, transform: (effect: Effect) => Effect) =>
    setDraftOperations([
      operation(
        items.map((effect) => (effect.id === id ? transform(effect) : effect)),
      ),
    ]);
  const commitPreviewReplace = (
    id: string,
    transform: (effect: Effect) => Effect,
  ) => {
    previewReplace(id, transform);
    void commitDraftOperations();
  };
  return (
    <Section title="Effects" open={items.length > 0}>
      <label className="field field-wide">
        <span>Add effect</span>
        <select
          aria-label="Add effect"
          value=""
          disabled={items.length >= 16}
          onChange={(event) => {
            const type = event.currentTarget.value as Effect["type"];
            if (type) commitItems([...items, newEffect(type)]);
          }}
        >
          <option value="">Choose…</option>
          {(
            [
              "outerShadow",
              "innerShadow",
              "blur",
              "innerGlow",
              "outerGlow",
              "colorOverlay",
              "gradientOverlay",
            ] as const
          ).map((type) => (
            <option key={type} value={type}>
              {effectLabel(type)}
            </option>
          ))}
        </select>
      </label>
      {node.effects && "outerShadow" in node.effects && (
        <p className="advanced-disclosure">
          Legacy outer shadow. The first edit upgrades it to a stable ordered
          stack; normal history provides rollback.
        </p>
      )}
      <ol className="effect-stack">
        {items.map((effect, index) => (
          <li className="effect-card" key={effect.id}>
            <div className="effect-heading">
              <strong>{effectLabel(effect.type)}</strong>
              <code>{effect.id}</code>
            </div>
            <Toggle
              label="Enabled"
              value={effect.enabled}
              onCommit={(enabled) =>
                replace(effect.id, (candidate) => ({
                  ...candidate,
                  enabled,
                }))
              }
            />
            <div className="effect-actions">
              <button
                className="subtle-button"
                disabled={index === 0}
                aria-label={`Move ${effectLabel(effect.type)} up`}
                onClick={() => {
                  const next = [...items];
                  [next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ];
                  commitItems(next);
                }}
              >
                Up
              </button>
              <button
                className="subtle-button"
                disabled={index === items.length - 1}
                aria-label={`Move ${effectLabel(effect.type)} down`}
                onClick={() => {
                  const next = [...items];
                  [next[index], next[index + 1]] = [
                    next[index + 1]!,
                    next[index]!,
                  ];
                  commitItems(next);
                }}
              >
                Down
              </button>
              <button
                className="subtle-button"
                disabled={items.length >= 16}
                aria-label={`Duplicate ${effectLabel(effect.type)}`}
                onClick={() => {
                  const next = [...items];
                  next.splice(index + 1, 0, {
                    ...structuredClone(effect),
                    id: crypto.randomUUID(),
                  });
                  commitItems(next);
                }}
              >
                Duplicate
              </button>
              <button
                className="subtle-button"
                aria-label={`Remove ${effectLabel(effect.type)}`}
                onClick={() =>
                  commitItems(
                    items.filter((candidate) => candidate.id !== effect.id),
                  )
                }
              >
                Remove
              </button>
            </div>
            {(effect.type === "outerShadow" ||
              effect.type === "innerShadow") && (
              <>
                <div className="color-row">
                  <LiveColorPicker
                    label={`${effectLabel(effect.type)} color`}
                    value={effect.color}
                    onPreview={(color) =>
                      previewReplace(
                        effect.id,
                        (candidate) =>
                          ({
                            ...candidate,
                            color,
                          }) as Effect,
                      )
                    }
                    onCommit={(color) =>
                      commitPreviewReplace(
                        effect.id,
                        (candidate) =>
                          ({
                            ...candidate,
                            color,
                          }) as Effect,
                      )
                    }
                    onCancel={() => setDraftOperations()}
                  />
                  <NumberField
                    label={
                      effect.type === "outerShadow"
                        ? "Shadow opacity"
                        : "Inner shadow opacity"
                    }
                    value={effect.opacity}
                    min={0}
                    max={1}
                    step={0.05}
                    onCommit={(opacity) =>
                      replace(
                        effect.id,
                        (candidate) => ({ ...candidate, opacity }) as Effect,
                      )
                    }
                  />
                </div>
                <div className="field-grid">
                  {(["offsetX", "offsetY", "blur", "spread"] as const).map(
                    (key) => (
                      <NumberField
                        key={key}
                        label={key}
                        value={effect[key]}
                        min={key === "blur" ? 0 : key === "spread" ? -64 : -500}
                        max={key === "blur" || key === "spread" ? 128 : 500}
                        onCommit={(value) =>
                          replace(
                            effect.id,
                            (candidate) =>
                              ({ ...candidate, [key]: value }) as Effect,
                          )
                        }
                      />
                    ),
                  )}
                </div>
              </>
            )}
            {(effect.type === "innerGlow" || effect.type === "outerGlow") && (
              <>
                <div className="color-row">
                  <LiveColorPicker
                    label={`${effectLabel(effect.type)} color`}
                    value={effect.color}
                    onPreview={(color) =>
                      previewReplace(
                        effect.id,
                        (candidate) => ({ ...candidate, color }) as Effect,
                      )
                    }
                    onCommit={(color) =>
                      commitPreviewReplace(
                        effect.id,
                        (candidate) => ({ ...candidate, color }) as Effect,
                      )
                    }
                    onCancel={() => setDraftOperations()}
                  />
                  <NumberField
                    label="Opacity"
                    value={effect.opacity}
                    min={0}
                    max={1}
                    step={0.05}
                    onCommit={(opacity) =>
                      replace(
                        effect.id,
                        (candidate) => ({ ...candidate, opacity }) as Effect,
                      )
                    }
                  />
                </div>
                <div className="field-grid">
                  <NumberField
                    label="Blur"
                    value={effect.blur}
                    min={0}
                    max={128}
                    onCommit={(blur) =>
                      replace(
                        effect.id,
                        (candidate) => ({ ...candidate, blur }) as Effect,
                      )
                    }
                  />
                  <NumberField
                    label="Spread"
                    value={effect.spread}
                    min={-64}
                    max={128}
                    onCommit={(spread) =>
                      replace(
                        effect.id,
                        (candidate) => ({ ...candidate, spread }) as Effect,
                      )
                    }
                  />
                </div>
              </>
            )}
            {effect.type === "blur" && (
              <NumberField
                label="Radius"
                value={effect.radius}
                min={0}
                max={128}
                onCommit={(radius) =>
                  replace(
                    effect.id,
                    (candidate) => ({ ...candidate, radius }) as Effect,
                  )
                }
              />
            )}
            {(effect.type === "colorOverlay" ||
              effect.type === "gradientOverlay") && (
              <>
                <PaintEditor
                  label="Paint"
                  paint={effect.paint}
                  allowedTypes={
                    effect.type === "gradientOverlay"
                      ? ["linearGradient", "radialGradient"]
                      : ["solid"]
                  }
                  preview={(paint) => {
                    if (
                      (effect.type === "gradientOverlay" &&
                        paint.type === "solid") ||
                      (effect.type === "colorOverlay" && paint.type !== "solid")
                    )
                      return;
                    previewReplace(
                      effect.id,
                      (candidate) => ({ ...candidate, paint }) as Effect,
                    );
                  }}
                  commit={(paint) => {
                    if (
                      (effect.type === "gradientOverlay" &&
                        paint.type === "solid") ||
                      (effect.type === "colorOverlay" && paint.type !== "solid")
                    )
                      return;
                    commitPreviewReplace(
                      effect.id,
                      (candidate) => ({ ...candidate, paint }) as Effect,
                    );
                  }}
                  cancel={() => setDraftOperations()}
                />
                <NumberField
                  label="Effect opacity"
                  value={effect.opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  onCommit={(opacity) =>
                    replace(
                      effect.id,
                      (candidate) => ({ ...candidate, opacity }) as Effect,
                    )
                  }
                />
              </>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function CanvasResizePanel({ frame }: { frame: FrameDocument }) {
  const resizeFrame = useStudio((state) => state.resizeFrame);
  const [width, setWidth] = useState(frame.canvas.width);
  const [height, setHeight] = useState(frame.canvas.height);
  const [preset, setPreset] = useState("custom");
  const [strategy, setStrategy] = useState<FrameResizeStrategy>("constraints");
  const lockedLayers = frame.root.children.filter(
    (node) => node.type !== "adjustment" && node.locked,
  ).length;
  const valid =
    Number.isInteger(width) &&
    width > 0 &&
    Number.isInteger(height) &&
    height > 0;
  return (
    <div className="canvas-resize-panel">
      <label className="field field-wide">
        <span>Marketing format</span>
        <select
          aria-label="Canvas format preset"
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
      <div className="field-grid">
        <NumberField
          label="Width"
          value={width}
          min={1}
          onCommit={(value) => {
            setPreset("custom");
            setWidth(value);
          }}
        />
        <NumberField
          label="Height"
          value={height}
          min={1}
          onCommit={(value) => {
            setPreset("custom");
            setHeight(value);
          }}
        />
      </div>
      <SelectField
        label="Resize behavior"
        value={strategy}
        options={[
          { value: "constraints", label: "Honor layer constraints" },
          { value: "scale", label: "Scale composition" },
          { value: "canvasOnly", label: "Resize canvas only" },
        ]}
        onCommit={(value) => setStrategy(value as FrameResizeStrategy)}
      />
      {lockedLayers > 0 && strategy !== "canvasOnly" && (
        <p className="field-error" role="status">
          Unlock {lockedLayers} top-level layer{lockedLayers === 1 ? "" : "s"}
          or choose canvas-only resize.
        </p>
      )}
      <button
        className="primary-button"
        disabled={
          !valid ||
          (width === frame.canvas.width && height === frame.canvas.height) ||
          (lockedLayers > 0 && strategy !== "canvasOnly")
        }
        onClick={() => void resizeFrame(width, height, strategy)}
      >
        Resize frame
      </button>
      <p className="advanced-disclosure">
        One canonical revision updates the canvas, bounded guides and safe area,
        and any affected top-level transforms.
      </p>
    </div>
  );
}

function CanvasProperties() {
  const frame = useStudio((state) => state.activeFrame)!;
  const commit = useStudio((state) => state.commit);
  const setDraftOperations = useStudio((state) => state.setDraftOperations);
  const commitDraftOperations = useStudio(
    (state) => state.commitDraftOperations,
  );
  const guides = frame.canvas.guides ?? [];
  const setGuides = (next: typeof guides) =>
    void commit([{ kind: "setCanvas", value: { guides: next } }]);
  const defaultSafeArea = {
    top: Math.round(frame.canvas.height * 0.05),
    right: Math.round(frame.canvas.width * 0.05),
    bottom: Math.round(frame.canvas.height * 0.05),
    left: Math.round(frame.canvas.width * 0.05),
  };
  const safeArea = frame.canvas.safeArea ?? defaultSafeArea;
  return (
    <div className="inspector-scroll">
      <Section title="Canvas" open>
        <CanvasResizePanel key={frame.id} frame={frame} />
        <div
          className={`clip-contract ${frame.canvas.clipContent ? "" : "is-legacy"}`}
          role="note"
          aria-label="Canvas clipping contract"
        >
          <div>
            <span>Canvas clipping</span>
            <strong>Exact canvas in Studio and export</strong>
          </div>
          <p>
            Content beyond {frame.canvas.width}×{frame.canvas.height} is not
            rendered. Export dimensions never expand.
          </p>
          {!frame.canvas.clipContent && (
            <>
              <p>
                This frame stores the deprecated <code>false</code> value. V1
                treats it as clipped for compatibility.
              </p>
              <button
                className="subtle-button"
                onClick={() =>
                  void commit([
                    { kind: "setCanvas", value: { clipContent: true } },
                  ])
                }
              >
                Normalize clipping
              </button>
            </>
          )}
        </div>
        <PaintEditor
          label="Background"
          paint={
            frame.canvas.background.type === "transparent"
              ? { type: "solid", color: "#FFFFFF", opacity: 1 }
              : frame.canvas.background
          }
          preview={(background) =>
            setDraftOperations([{ kind: "setCanvas", value: { background } }])
          }
          commit={(background) => {
            setDraftOperations([{ kind: "setCanvas", value: { background } }]);
            void commitDraftOperations();
          }}
          cancel={() => setDraftOperations()}
        />
        <button
          className="subtle-button"
          onClick={() =>
            void commit([
              {
                kind: "setCanvas",
                value: { background: { type: "transparent" } },
              },
            ])
          }
        >
          Set transparent
        </button>
      </Section>
      <Section title="Guides and safe area" open>
        <div className="guide-actions" role="group" aria-label="Add guide">
          <button
            className="subtle-button"
            onClick={() =>
              setGuides([
                ...guides,
                {
                  id: crypto.randomUUID(),
                  axis: "vertical",
                  position: frame.canvas.width / 2,
                },
              ])
            }
          >
            Add vertical
          </button>
          <button
            className="subtle-button"
            onClick={() =>
              setGuides([
                ...guides,
                {
                  id: crypto.randomUUID(),
                  axis: "horizontal",
                  position: frame.canvas.height / 2,
                },
              ])
            }
          >
            Add horizontal
          </button>
        </div>
        {guides.length === 0 ? (
          <p className="advanced-disclosure">
            Drag from a Canvas ruler or add a guide here. Guides are shared
            frame metadata and never export.
          </p>
        ) : (
          <ol className="guide-list">
            {guides.map((guide, index) => (
              <li key={guide.id}>
                <span>
                  {guide.axis === "vertical" ? "Vertical" : "Horizontal"}
                </span>
                <NumberField
                  label="Position"
                  value={guide.position}
                  min={0}
                  max={
                    guide.axis === "vertical"
                      ? frame.canvas.width
                      : frame.canvas.height
                  }
                  onCommit={(position) =>
                    setGuides(
                      guides.map((candidate) =>
                        candidate.id === guide.id
                          ? { ...candidate, position }
                          : candidate,
                      ),
                    )
                  }
                />
                <button
                  className="subtle-button"
                  aria-label={`Remove ${guide.axis} guide ${index + 1}`}
                  onClick={() =>
                    setGuides(
                      guides.filter((candidate) => candidate.id !== guide.id),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="safe-area-heading">
          <strong>Safe area</strong>
          {frame.canvas.safeArea ? (
            <button
              className="subtle-button"
              onClick={() =>
                void commit([{ kind: "setCanvas", value: { safeArea: null } }])
              }
            >
              Remove safe area
            </button>
          ) : (
            <button
              className="primary-button"
              onClick={() =>
                void commit([
                  {
                    kind: "setCanvas",
                    value: { safeArea: defaultSafeArea },
                  },
                ])
              }
            >
              Add 5% safe area
            </button>
          )}
        </div>
        {frame.canvas.safeArea && (
          <div className="field-grid safe-area-grid">
            {(["top", "right", "bottom", "left"] as const).map((side) => (
              <NumberField
                key={side}
                label={side}
                value={safeArea[side]}
                min={0}
                max={
                  side === "left"
                    ? frame.canvas.width - safeArea.right - 1
                    : side === "right"
                      ? frame.canvas.width - safeArea.left - 1
                      : side === "top"
                        ? frame.canvas.height - safeArea.bottom - 1
                        : frame.canvas.height - safeArea.top - 1
                }
                onCommit={(value) =>
                  void commit([
                    {
                      kind: "setCanvas",
                      value: {
                        safeArea: { ...safeArea, [side]: value },
                      },
                    },
                  ])
                }
              />
            ))}
          </div>
        )}
        <p className="advanced-disclosure">
          Safe areas guide composition and never clip or export.
        </p>
      </Section>
    </div>
  );
}

function HistoryPanel() {
  const entries = useStudio((state) => state.history);
  const frame = useStudio((state) => state.activeFrame);
  const project = useStudio((state) => state.activeProject);
  const client = useStudio((state) => state.client);
  const restore = useStudio((state) => state.restore);
  const [selected, setSelected] = useState<string>();
  const [comparison, setComparison] = useState<unknown>();
  const [copied, setCopied] = useState(false);
  const entry = entries.find((candidate) => candidate.id === selected);
  return (
    <div className="history-pane">
      <div className="history-ledger">
        {[...entries].reverse().map((item) => (
          <button
            key={item.id}
            className={item.id === selected ? "is-selected" : ""}
            aria-pressed={item.id === selected}
            onClick={() => {
              setSelected(item.id);
              setComparison(undefined);
            }}
          >
            <span className={`revision-dot kind-${item.kind}`} />
            <strong>r{item.revision}</strong>
            <span>{item.label}</span>
            <time>
              {new Date(item.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </button>
        ))}
      </div>
      {entry && (
        <div className="history-detail">
          <p>
            Revision {entry.revision} · {entry.label}
          </p>
          {project && frame && entry.revision < frame.revision && (
            <button
              className="subtle-button"
              onClick={() =>
                void client
                  .compareRevisions(
                    project.id,
                    frame.id,
                    entry.revision,
                    frame.revision,
                  )
                  .then(setComparison)
              }
            >
              Compare to current
            </button>
          )}
          {comparison !== undefined && (
            <p>
              {Array.isArray(comparison) ? comparison.length : 1} structured
              difference
              {Array.isArray(comparison) && comparison.length === 1
                ? ""
                : "s"}{" "}
              found.
            </p>
          )}
          <button
            className="subtle-button"
            onClick={() => {
              void navigator.clipboard
                .writeText(JSON.stringify({ entry, comparison }, null, 2))
                .then(() => setCopied(true));
            }}
          >
            {copied ? "Support details copied" : "Copy support details"}
          </button>
          {frame && entry.revision < frame.revision && (
            <button
              className="primary-button"
              onClick={() => void restore(entry.revision)}
            >
              Restore as r{frame.revision + 1}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BrandPanel() {
  const project = useStudio((state) => state.activeProject);
  const frame = useStudio((state) => state.activeFrame);
  const selection = useStudio((state) => state.selection);
  const kits = useStudio((state) => state.brandKits);
  const createKit = useStudio((state) => state.createBrandKit);
  const pinKit = useStudio((state) => state.pinBrandKit);
  const rollbackBrandMigration = useStudio(
    (state) => state.rollbackBrandMigration,
  );
  const unpinKit = useStudio((state) => state.unpinBrandKit);
  const applyBrand = useStudio((state) => state.applyBrand);
  const detachBrandComponent = useStudio((state) => state.detachBrandComponent);
  const switchBrandComponentVariant = useStudio(
    (state) => state.switchBrandComponentVariant,
  );
  const bindPaletteToken = useStudio((state) => state.bindPaletteToken);
  const unbindPaletteToken = useStudio((state) => state.unbindPaletteToken);
  const bindTypographyRole = useStudio((state) => state.bindTypographyRole);
  const unbindTypographyRole = useStudio((state) => state.unbindTypographyRole);
  const bindEffectStyle = useStudio((state) => state.bindEffectStyle);
  const unbindEffectStyle = useStudio((state) => state.unbindEffectStyle);
  const bindRadiusToken = useStudio((state) => state.bindRadiusToken);
  const unbindRadiusToken = useStudio((state) => state.unbindRadiusToken);
  const bindSpacingToken = useStudio((state) => state.bindSpacingToken);
  const unbindSpacingToken = useStudio((state) => state.unbindSpacingToken);
  const applyVariableMode = useStudio((state) => state.applyVariableMode);
  const brandLint = useStudio((state) => state.brandLint);
  const auditBrandSystem = useStudio((state) => state.auditBrandSystem);
  const preview = useStudio((state) => state.preview);
  const commitPreview = useStudio((state) => state.commitPreview);
  const discardPreview = useStudio((state) => state.discardPreview);
  const [name, setName] = useState(
    project ? `${project.name} Brand` : "Brand Kit",
  );
  const [provenance, setProvenance] = useState("");
  const [licenseNotes, setLicenseNotes] = useState("");
  const [paletteNames, setPaletteNames] = useState(
    "Primary, Secondary, Accent 1, Accent 2",
  );
  const [typeRoleNames, setTypeRoleNames] = useState(
    "Display, Body, Supporting 1, Supporting 2",
  );
  const [logoNames, setLogoNames] = useState(
    "Primary Logo, Secondary Logo, Campaign Mark",
  );
  const [reusableNames, setReusableNames] = useState("");
  if (!project) return <p className="empty-copy">Choose a project.</p>;
  const pin = project.brandKitPin;
  const kit = pin
    ? kits.find(
        (candidate) =>
          candidate.id === pin.kitId && candidate.revision === pin.revision,
      )
    : undefined;
  const node =
    frame && selection.length === 1
      ? findNode(frame, selection[0]!)
      : undefined;
  const apply = (
    change: Omit<
      Parameters<typeof applyBrand>[0],
      "projectId" | "frameId" | "baseRevision" | "mode" | "actor"
    >,
  ) => {
    if (!frame) return;
    void applyBrand({
      projectId: project.id,
      frameId: frame.id,
      baseRevision: frame.revision,
      mode: "commit",
      actor: { source: "studio", id: "studio" },
      ...change,
    });
  };
  const definitionIdMap = (definitionKey: string): Record<string, string> => {
    if (!kit) return {};
    const definitions = new Map(
      kit.definitions.map((item) => [item.key, item]),
    );
    const ids = new Set<string>();
    const collect = (key: string) => {
      const definition = definitions.get(key);
      if (!definition) return;
      definition.includes.forEach(collect);
      definition.nodes.forEach((root) =>
        descendantIds(root).forEach((id) => ids.add(id)),
      );
    };
    collect(definitionKey);
    return Object.fromEntries([...ids].map((id) => [id, crypto.randomUUID()]));
  };
  return (
    <div className="brand-pane">
      <Section title="Design plans" open>
        <DesignPlans />
      </Section>
      <Section title="Design briefs" open>
        <DesignBriefs />
      </Section>
      <Section title="Project templates" open>
        <ProjectTemplates />
      </Section>
      <Section title="Library" open>
        {kits.length === 0 ? (
          <p className="empty-copy">No Brand Kits yet.</p>
        ) : (
          <div className="brand-kit-list">
            {kits.map((candidate) => (
              <button
                key={`${candidate.id}:${candidate.revision}`}
                className={
                  candidate.id === pin?.kitId &&
                  candidate.revision === pin.revision
                    ? "is-selected"
                    : ""
                }
                onClick={() => void pinKit(candidate.id, candidate.revision)}
              >
                <strong>{candidate.name}</strong>
                <span>r{candidate.revision}</span>
              </button>
            ))}
          </div>
        )}
        {pin && (
          <>
            <p className="empty-copy">
              Choosing another revision in this kit creates a reviewed atomic
              migration preview; it never follows latest automatically.
            </p>
            <button
              className="subtle-button"
              onClick={() => void rollbackBrandMigration()}
            >
              Preview last migration rollback
            </button>
            <button className="subtle-button" onClick={() => void unpinKit()}>
              Detach from project
            </button>
          </>
        )}
        {preview && !preview.frameId ? (
          <div className="button-row">
            <button type="button" onClick={() => void commitPreview()}>
              Commit Brand migration
            </button>
            <button type="button" onClick={discardPreview}>
              Discard Brand migration
            </button>
          </div>
        ) : null}
      </Section>
      <Section title={kit ? "New immutable revision" : "Create from project"}>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={160}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>Provenance</span>
          <textarea
            value={provenance}
            maxLength={1000}
            onChange={(event) => setProvenance(event.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>License notes</span>
          <textarea
            value={licenseNotes}
            maxLength={2000}
            onChange={(event) => setLicenseNotes(event.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>Palette names · detected-order</span>
          <textarea
            value={paletteNames}
            maxLength={1000}
            onChange={(event) => setPaletteNames(event.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>Type role names · font-order</span>
          <textarea
            value={typeRoleNames}
            maxLength={1000}
            onChange={(event) => setTypeRoleNames(event.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>Logo names · SVG-order</span>
          <textarea
            value={logoNames}
            maxLength={1000}
            onChange={(event) => setLogoNames(event.currentTarget.value)}
          />
        </label>
        <label className="field">
          <span>Reusable names · definition-order</span>
          <textarea
            value={reusableNames}
            placeholder="Hero Card, Campaign Template"
            maxLength={1000}
            onChange={(event) => setReusableNames(event.currentTarget.value)}
          />
        </label>
        <button
          className="primary-button"
          disabled={!name.trim() || !provenance.trim() || !licenseNotes.trim()}
          onClick={() =>
            void createKit(
              name.trim(),
              provenance.trim(),
              licenseNotes.trim(),
              kit?.id,
              {
                paletteNames: paletteNames
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
                typeRoleNames: typeRoleNames
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
                logoNames: logoNames
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
                reusableNames: reusableNames
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
            )
          }
        >
          {kit ? "Create next revision" : "Create Brand Kit"}
        </button>
      </Section>
      {kit && (
        <>
          <Section title="Brand lint" open>
            <button
              type="button"
              className="subtle-button"
              onClick={() => void auditBrandSystem()}
            >
              Audit exact Brand system
            </button>
            {brandLint ? (
              <div className="advanced-list" aria-live="polite">
                <p>
                  {brandLint.summary.errors} errors ·{" "}
                  {brandLint.summary.warnings} warnings ·{" "}
                  {brandLint.summary.info} notes
                </p>
                {brandLint.findings.length ? (
                  <ul>
                    {brandLint.findings.map((finding, index) => (
                      <li
                        key={`${finding.code}:${finding.frameId ?? "kit"}:${finding.nodeId ?? finding.key ?? index}`}
                      >
                        <strong>{finding.severity}</strong> · {finding.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No deterministic Brand lint findings.</p>
                )}
              </div>
            ) : (
              <p className="empty-copy">
                Checks exact-pin integrity, intentional naming, duplicate
                labels, and unbound values that match palette tokens.
              </p>
            )}
          </Section>
          <Section title="Palette">
            {node?.brandBindings?.length ? (
              <ul className="advanced-list">
                {node.brandBindings
                  .filter((binding) =>
                    ["fill", "stroke", "textColor"].includes(binding.property),
                  )
                  .map((binding) => (
                    <li key={binding.id}>
                      <code>{binding.property}</code> → {binding.tokenKey} · kit
                      r{binding.kitRevision}{" "}
                      <button
                        type="button"
                        className="subtle-button"
                        onClick={() => {
                          if (
                            binding.property === "typography" ||
                            binding.property === "effects" ||
                            binding.property === "radius"
                          )
                            return;
                          void unbindPaletteToken({
                            nodeId: node.id,
                            property: binding.property,
                          });
                        }}
                      >
                        Detach {binding.property} binding
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="empty-copy">
                Selected layer has no live palette bindings.
              </p>
            )}
            <div className="brand-swatches">
              {kit.palette.map((token) => (
                <button
                  key={token.key}
                  disabled={
                    !node ||
                    !["rectangle", "ellipse", "vectorPath", "text"].includes(
                      node.type,
                    )
                  }
                  title={`Bind ${token.name}`}
                  onClick={() => {
                    if (!node) return;
                    void bindPaletteToken({
                      nodeId: node.id,
                      tokenKey: token.key,
                      property: node.type === "text" ? "textColor" : "fill",
                    });
                  }}
                >
                  <i style={{ background: token.color }} />
                  <span>{token.name}</span>
                </button>
              ))}
            </div>
            {preview ? (
              <div className="button-row">
                <button type="button" onClick={() => void commitPreview()}>
                  Commit live Brand binding
                </button>
                <button type="button" onClick={discardPreview}>
                  Discard Brand binding
                </button>
              </div>
            ) : null}
          </Section>
          <Section title="Type roles">
            {node?.brandBindings?.find(
              (binding) => binding.property === "typography",
            ) ? (
              <div className="advanced-list">
                <p>
                  Bound type role:{" "}
                  {
                    node.brandBindings.find(
                      (binding) => binding.property === "typography",
                    )?.tokenKey
                  }{" "}
                  · kit r
                  {
                    node.brandBindings.find(
                      (binding) => binding.property === "typography",
                    )?.kitRevision
                  }
                </p>
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() =>
                    node && void unbindTypographyRole({ nodeId: node.id })
                  }
                >
                  Detach typography binding
                </button>
              </div>
            ) : (
              <p className="empty-copy">
                Selected text layer has no live typography binding.
              </p>
            )}
            {kit.typeRoles.map((role) => (
              <button
                key={role.key}
                className="brand-choice"
                disabled={node?.type !== "text"}
                onClick={() =>
                  node &&
                  void bindTypographyRole({
                    nodeId: node.id,
                    roleKey: role.key,
                  })
                }
              >
                <strong>{role.name}</strong>
                <span>
                  {role.font.family} · {role.fontSize}px
                </span>
              </button>
            ))}
            {preview ? (
              <div className="button-row">
                <button type="button" onClick={() => void commitPreview()}>
                  Commit live typography binding
                </button>
                <button type="button" onClick={discardPreview}>
                  Discard typography binding
                </button>
              </div>
            ) : null}
          </Section>
          <Section title="Effect styles">
            {node?.brandBindings?.find(
              (binding) => binding.property === "effects",
            ) ? (
              <div className="advanced-list">
                <p>
                  Bound effect style:{" "}
                  {
                    node.brandBindings.find(
                      (binding) => binding.property === "effects",
                    )?.tokenKey
                  }{" "}
                  · kit r
                  {
                    node.brandBindings.find(
                      (binding) => binding.property === "effects",
                    )?.kitRevision
                  }
                </p>
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() =>
                    node && void unbindEffectStyle({ nodeId: node.id })
                  }
                >
                  Detach effect-style binding
                </button>
              </div>
            ) : (
              <p className="empty-copy">
                Selected layer has no live effect-style binding.
              </p>
            )}
            {(kit.effectStyles ?? []).map((style) => (
              <button
                key={style.key}
                className="brand-choice"
                disabled={!node || node.type === "adjustment"}
                onClick={() =>
                  node &&
                  void bindEffectStyle({ nodeId: node.id, styleKey: style.key })
                }
              >
                <strong>{style.name}</strong>
                <span>
                  {"items" in style.effects
                    ? `${style.effects.items?.length ?? 0} effects`
                    : "Legacy outer shadow"}
                </span>
              </button>
            ))}
            {(kit.effectStyles ?? []).length === 0 ? (
              <p className="empty-copy">This kit has no effect styles.</p>
            ) : null}
            {preview ? (
              <div className="button-row">
                <button type="button" onClick={() => void commitPreview()}>
                  Commit live effect-style binding
                </button>
                <button type="button" onClick={discardPreview}>
                  Discard effect-style binding
                </button>
              </div>
            ) : null}
          </Section>
          <Section title="Radius tokens">
            {node?.brandBindings?.find(
              (binding) => binding.property === "radius",
            ) ? (
              <div className="advanced-list">
                <p>
                  Bound radius token:{" "}
                  {
                    node.brandBindings.find(
                      (binding) => binding.property === "radius",
                    )?.tokenKey
                  }{" "}
                  · kit r
                  {
                    node.brandBindings.find(
                      (binding) => binding.property === "radius",
                    )?.kitRevision
                  }
                </p>
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() =>
                    node && void unbindRadiusToken({ nodeId: node.id })
                  }
                >
                  Detach radius binding
                </button>
              </div>
            ) : (
              <p className="empty-copy">
                Selected rectangle has no live radius binding.
              </p>
            )}
            {(kit.radiusTokens ?? []).map((token) => (
              <button
                key={token.key}
                className="brand-choice"
                disabled={node?.type !== "rectangle"}
                onClick={() =>
                  node &&
                  void bindRadiusToken({
                    nodeId: node.id,
                    tokenKey: token.key,
                  })
                }
              >
                <strong>{token.name}</strong>
                <span>{token.value}px</span>
              </button>
            ))}
            {(kit.radiusTokens ?? []).length === 0 ? (
              <p className="empty-copy">This kit has no radius tokens.</p>
            ) : null}
            {preview ? (
              <div className="button-row">
                <button type="button" onClick={() => void commitPreview()}>
                  Commit live radius binding
                </button>
                <button type="button" onClick={discardPreview}>
                  Discard radius binding
                </button>
              </div>
            ) : null}
          </Section>
          <Section title="Spacing tokens">
            {frame?.canvas.spacingBinding ? (
              <div className="advanced-list">
                <p>
                  Bound safe-area token: {frame.canvas.spacingBinding.tokenKey}{" "}
                  · kit r{frame.canvas.spacingBinding.kitRevision}
                </p>
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() => void unbindSpacingToken()}
                >
                  Detach safe-area spacing binding
                </button>
              </div>
            ) : (
              <p className="empty-copy">
                Canvas safe area has no live spacing binding.
              </p>
            )}
            {(kit.spacingTokens ?? []).map((token) => (
              <button
                key={token.key}
                className="brand-choice"
                disabled={
                  !frame ||
                  token.value * 2 >= frame.canvas.width ||
                  token.value * 2 >= frame.canvas.height
                }
                onClick={() => void bindSpacingToken({ tokenKey: token.key })}
              >
                <strong>{token.name}</strong>
                <span>{token.value}px uniform safe area</span>
              </button>
            ))}
            {(kit.spacingTokens ?? []).length === 0 ? (
              <p className="empty-copy">This kit has no spacing tokens.</p>
            ) : null}
            {preview ? (
              <div className="button-row">
                <button type="button" onClick={() => void commitPreview()}>
                  Commit live spacing binding
                </button>
                <button type="button" onClick={discardPreview}>
                  Discard spacing binding
                </button>
              </div>
            ) : null}
          </Section>
          <Section title="Variable modes">
            <p className="empty-copy">
              Active palette mode: {frame?.brandMode?.modeKey ?? "Base"}
            </p>
            <button
              type="button"
              className="brand-choice"
              disabled={!frame || !frame.brandMode}
              onClick={() => void applyVariableMode(null)}
            >
              <strong>Base</strong>
              <span>Restore immutable base palette values</span>
            </button>
            {(kit.variableModes ?? []).map((mode) => (
              <button
                key={mode.key}
                className="brand-choice"
                disabled={!frame || frame.brandMode?.modeKey === mode.key}
                onClick={() => void applyVariableMode(mode.key)}
              >
                <strong>{mode.name}</strong>
                <span>{mode.palette.length} palette overrides</span>
              </button>
            ))}
            {(kit.variableModes ?? []).length === 0 ? (
              <p className="empty-copy">This kit has no variable modes.</p>
            ) : null}
            {preview ? (
              <div className="button-row">
                <button type="button" onClick={() => void commitPreview()}>
                  Commit variable mode
                </button>
                <button type="button" onClick={discardPreview}>
                  Discard variable mode
                </button>
              </div>
            ) : null}
          </Section>
          <Section title="Logos">
            {kit.logos.map((logo) => (
              <button
                key={logo.key}
                className="brand-choice"
                disabled={!frame}
                onClick={() =>
                  frame &&
                  apply({
                    logo: {
                      key: logo.key,
                      nodeId: crypto.randomUUID(),
                      parentId: "root",
                      x: frame.canvas.width / 2 - logo.asset.width / 2,
                      y: frame.canvas.height / 2 - logo.asset.height / 2,
                    },
                  })
                }
              >
                {logo.name}
              </button>
            ))}
          </Section>
          <Section title="Reusable">
            {kit.definitions.map((definition) => (
              <button
                key={definition.key}
                className="brand-choice"
                disabled={!frame}
                onClick={() =>
                  apply({
                    definition: {
                      key: definition.key,
                      parentId: "root",
                      idMap: definitionIdMap(definition.key),
                      ...(definition.kind === "component"
                        ? { instanceId: crypto.randomUUID() }
                        : {}),
                    },
                  })
                }
              >
                <strong>{definition.name}</strong>
                <span>{definition.kind}</span>
              </button>
            ))}
            {node?.brandComponent ? (
              <div className="advanced-list">
                <p>
                  Component {node.brandComponent.definitionKey} · kit r
                  {node.brandComponent.kitRevision}
                </p>
                <p>
                  Overrides:{" "}
                  {node.brandComponent.overrides.join(", ") || "none"}
                </p>
                {node.brandComponent.variantGroupKey ? (
                  <div className="button-row">
                    {kit.definitions
                      .filter(
                        (definition) =>
                          definition.variant?.groupKey ===
                          node.brandComponent?.variantGroupKey,
                      )
                      .map((definition) => (
                        <button
                          key={definition.key}
                          type="button"
                          disabled={
                            definition.key ===
                            node.brandComponent?.definitionKey
                          }
                          onClick={() =>
                            void switchBrandComponentVariant(
                              node.brandComponent!.instanceId,
                              definition.key,
                            )
                          }
                        >
                          {definition.variant!.name}
                        </button>
                      ))}
                  </div>
                ) : null}
                {preview ? (
                  <div className="button-row">
                    <button type="button" onClick={() => void commitPreview()}>
                      Commit component variant
                    </button>
                    <button type="button" onClick={discardPreview}>
                      Discard component variant
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() =>
                    void detachBrandComponent(node.brandComponent!.instanceId)
                  }
                >
                  Detach component
                </button>
              </div>
            ) : null}
          </Section>
        </>
      )}
    </div>
  );
}

export function InspectorPanel() {
  const frame = useStudio((state) => state.activeFrame);
  const selection = useStudio((state) => state.selection);
  const tab = useStudio((state) => state.inspectorTab);
  const setTab = useStudio((state) => state.setInspectorTab);
  const inspectorOpen = useStudio((state) => state.inspectorOpen);
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = ["properties", "history", "brand"] as const;
    const current = tabs.indexOf(tab);
    const next =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs[2]
          : event.key === "ArrowLeft"
            ? tabs[(current - 1 + tabs.length) % tabs.length]!
            : tabs[(current + 1) % tabs.length]!;
    setTab(next);
    document.getElementById(`inspector-${next}-tab`)?.focus();
  };
  const node =
    frame && selection.length === 1
      ? findNode(frame, selection[0]!)
      : undefined;
  return (
    <section
      id="inspector-panel"
      className={`panel inspector-panel${inspectorOpen ? " is-open" : ""}`}
      aria-label="Inspector"
    >
      <div className="inspector-tabs" role="tablist">
        <button
          id="inspector-properties-tab"
          role="tab"
          aria-controls="inspector-properties-panel"
          aria-selected={tab === "properties"}
          tabIndex={tab === "properties" ? 0 : -1}
          onClick={() => setTab("properties")}
          onKeyDown={handleTabKey}
        >
          Properties
        </button>
        <button
          id="inspector-history-tab"
          role="tab"
          aria-controls="inspector-history-panel"
          aria-selected={tab === "history"}
          tabIndex={tab === "history" ? 0 : -1}
          onClick={() => setTab("history")}
          onKeyDown={handleTabKey}
        >
          History
        </button>
        <button
          id="inspector-brand-tab"
          role="tab"
          aria-controls="inspector-brand-panel"
          aria-selected={tab === "brand"}
          tabIndex={tab === "brand" ? 0 : -1}
          onClick={() => setTab("brand")}
          onKeyDown={handleTabKey}
        >
          Brand
        </button>
      </div>
      {tab === "properties" ? (
        <div
          id="inspector-properties-panel"
          className="inspector-tabpanel"
          role="tabpanel"
          aria-labelledby="inspector-properties-tab"
        >
          {frame ? (
            <Properties node={node} />
          ) : (
            <p className="empty-copy">Choose a frame.</p>
          )}
        </div>
      ) : tab === "brand" ? (
        <div
          id="inspector-brand-panel"
          className="inspector-tabpanel"
          role="tabpanel"
          aria-labelledby="inspector-brand-tab"
        >
          <BrandPanel />
        </div>
      ) : (
        <div
          id="inspector-history-panel"
          className="inspector-tabpanel"
          role="tabpanel"
          aria-labelledby="inspector-history-tab"
        >
          <HistoryPanel />
        </div>
      )}
    </section>
  );
}
