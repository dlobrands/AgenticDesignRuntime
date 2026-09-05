import { useState, type FormEvent } from "react";
import type { DesignBrief } from "@tva-agentic-design/core";
import { useStudio } from "./store";

function BriefCorrectionForm({ brief }: { brief: DesignBrief }) {
  const [draft, setDraft] = useState(() => structuredClone(brief));
  const preview = useStudio((state) => state.preview);
  const correction = useStudio((state) => state.intentCorrection);
  const previewCorrection = useStudio(
    (state) => state.previewDesignBriefCorrection,
  );
  const commitPreview = useStudio((state) => state.commitPreview);
  const discardPreview = useStudio((state) => state.discardPreview);
  const active = correction?.kind === "brief" && correction.id === brief.id;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void previewCorrection({
      ...draft,
      updatedAt: new Date().toISOString(),
    });
  };
  return (
    <form className="intent-correction" onSubmit={submit}>
      <strong>Correct intent</strong>
      <p>
        Correct copy, constraints, or export intent. Saving creates a reviewed
        project preview and never mutates artwork.
      </p>
      <label className="field field-wide">
        <span>Objective</span>
        <textarea
          rows={3}
          value={draft.objective}
          onChange={(event) =>
            setDraft({ ...draft, objective: event.target.value })
          }
        />
      </label>
      {draft.requiredCopy.map((item, index) => (
        <label className="field field-wide" key={item.id}>
          <span>{item.role}</span>
          <textarea
            rows={2}
            value={item.text}
            onChange={(event) => {
              const requiredCopy = structuredClone(draft.requiredCopy);
              requiredCopy[index] = { ...item, text: event.target.value };
              setDraft({ ...draft, requiredCopy });
            }}
          />
        </label>
      ))}
      {draft.constraints.map((constraint, index) => (
        <label className="field field-wide" key={constraint.id}>
          <span>{constraint.priority}</span>
          <textarea
            rows={2}
            value={constraint.description}
            onChange={(event) => {
              const constraints = structuredClone(draft.constraints);
              constraints[index] = {
                ...constraint,
                description: event.target.value,
              };
              setDraft({ ...draft, constraints });
            }}
          />
        </label>
      ))}
      {draft.exportRequirements.map((requirement, index) => (
        <div className="field-grid" key={requirement.id}>
          <label className="field">
            <span>Format</span>
            <select
              value={requirement.format}
              onChange={(event) => {
                const exportRequirements = structuredClone(
                  draft.exportRequirements,
                );
                exportRequirements[index] = {
                  ...requirement,
                  format: event.target.value as typeof requirement.format,
                };
                setDraft({ ...draft, exportRequirements });
              }}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
              <option value="svg">SVG</option>
              <option value="pdf">CMYK PDF</option>
            </select>
          </label>
          <label className="field">
            <span>Scale</span>
            <input
              type="number"
              min="0.25"
              max="4"
              step="0.25"
              value={requirement.scale}
              onChange={(event) => {
                const exportRequirements = structuredClone(
                  draft.exportRequirements,
                );
                exportRequirements[index] = {
                  ...requirement,
                  scale: Number(event.target.value),
                };
                setDraft({ ...draft, exportRequirements });
              }}
            />
          </label>
        </div>
      ))}
      <div className="button-row">
        <button type="submit">Preview corrections</button>
        <button type="button" onClick={() => setDraft(structuredClone(brief))}>
          Reset fields
        </button>
      </div>
      {active && preview ? (
        <div className="design-plan-compilation" role="status">
          <strong>Review brief correction</strong>
          <p>{preview.diff.length} canonical project changes.</p>
          <div className="button-row">
            <button type="button" onClick={() => void commitPreview()}>
              Commit corrections
            </button>
            <button type="button" onClick={discardPreview}>
              Discard corrections
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function DesignBriefs() {
  const briefs = useStudio((state) => state.activeProject?.designBriefs ?? []);
  if (briefs.length === 0)
    return (
      <p className="empty-copy">
        No agent-authored design briefs yet. Briefs are inspectable project
        intent and never mutate artwork by themselves.
      </p>
    );
  return (
    <div className="design-brief-list">
      {briefs.map((brief) => (
        <details key={brief.id}>
          <summary>
            <span>
              <strong>{brief.name}</strong>
              <small>
                {brief.format.width} × {brief.format.height} ·{" "}
                {brief.format.channel}
              </small>
            </span>
            <span>⌄</span>
          </summary>
          <div className="design-brief-content">
            <div>
              <span>Objective</span>
              <p>{brief.objective}</p>
            </div>
            <div>
              <span>Audience</span>
              <p>
                {brief.audience.primary}
                {brief.audience.secondary.length
                  ? ` · Secondary: ${brief.audience.secondary.join(" · ")}`
                  : ""}
                {brief.audience.locale ? ` · ${brief.audience.locale}` : ""}
              </p>
              {brief.audience.context ? <p>{brief.audience.context}</p> : null}
            </div>
            <div>
              <span>Mood</span>
              <p>{brief.mood.keywords.join(" · ")}</p>
              {brief.mood.avoid.length ? (
                <p>Avoid: {brief.mood.avoid.join(" · ")}</p>
              ) : null}
              {brief.mood.notes ? <p>{brief.mood.notes}</p> : null}
            </div>
            <div>
              <span>Optional copy</span>
              {brief.optionalCopy.length ? (
                <ul>
                  {brief.optionalCopy.map((item) => (
                    <li key={item.id}>
                      <code>{item.role}</code> {item.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None specified.</p>
              )}
            </div>
            <div>
              <span>Brand context</span>
              <p>{brief.brandContext.description}</p>
              {brief.brandContext.brandKit ? (
                <p>
                  Pinned intent: {brief.brandContext.brandKit.kitId} r
                  {brief.brandContext.brandKit.revision}
                </p>
              ) : null}
              {brief.brandContext.requiredTokenKeys.length ? (
                <p>
                  Required tokens:{" "}
                  {brief.brandContext.requiredTokenKeys.join(", ")}
                </p>
              ) : null}
              {brief.brandContext.prohibitedUses.length ? (
                <p>
                  Prohibited: {brief.brandContext.prohibitedUses.join(" · ")}
                </p>
              ) : null}
            </div>
            <div>
              <span>Assets</span>
              {brief.assetRequirements.length ? (
                <ul>
                  {brief.assetRequirements.map((requirement) => (
                    <li key={requirement.id}>
                      <code>{requirement.role}</code>{" "}
                      {requirement.required ? "required" : "optional"} ·{" "}
                      {requirement.description}
                      {requirement.assetId
                        ? ` · Asset ${requirement.assetId}`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None specified.</p>
              )}
            </div>
            <div>
              <span>Hierarchy</span>
              {brief.hierarchyRequirements.length ? (
                <ol>
                  {[...brief.hierarchyRequirements]
                    .sort((left, right) => left.priority - right.priority)
                    .map((requirement) => (
                      <li key={requirement.id}>
                        <code>{requirement.role}</code> ·{" "}
                        {requirement.description}
                      </li>
                    ))}
                </ol>
              ) : (
                <p>None specified.</p>
              )}
            </div>
            <div>
              <span>Required copy</span>
              {brief.requiredCopy.length ? (
                <ul>
                  {brief.requiredCopy.map((item) => (
                    <li key={item.id}>
                      <code>{item.role}</code> {item.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None specified.</p>
              )}
            </div>
            <div>
              <span>Constraints</span>
              {brief.constraints.length ? (
                <ul>
                  {brief.constraints.map((constraint) => (
                    <li key={constraint.id}>
                      <code>{constraint.priority}</code>{" "}
                      {constraint.description}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None specified.</p>
              )}
            </div>
            <div>
              <span>Accessibility</span>
              <p>
                Minimum contrast{" "}
                {brief.accessibilityRequirements.minimumContrastRatio}:1
                {brief.accessibilityRequirements.requirements.length
                  ? ` · ${brief.accessibilityRequirements.requirements.join(" · ")}`
                  : ""}
              </p>
              {brief.accessibilityRequirements.readingOrder.length ? (
                <p>
                  Reading order:{" "}
                  {brief.accessibilityRequirements.readingOrder.join(" → ")}
                </p>
              ) : null}
            </div>
            <div>
              <span>Export intent</span>
              <ul>
                {brief.exportRequirements.map((requirement) => (
                  <li key={requirement.id}>
                    {requirement.name}: {requirement.format.toUpperCase()} at{" "}
                    {requirement.scale}× · transparency{" "}
                    {requirement.transparentBackground}
                    {requirement.quality !== undefined
                      ? ` · quality ${requirement.quality}`
                      : ""}
                    {requirement.matteColor
                      ? ` · matte ${requirement.matteColor}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
            <p className="advanced-disclosure">
              Agent-authored intent. Structured corrections update only this
              brief through a reviewed project transaction.
            </p>
            <BriefCorrectionForm brief={brief} />
          </div>
        </details>
      ))}
    </div>
  );
}
