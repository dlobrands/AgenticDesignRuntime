import { useStudio } from "./store";

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
              Read-only intent. An approved DesignPlan may structure this brief;
              only a separate reviewed compiler preview may propose canonical
              operations.
            </p>
          </div>
        </details>
      ))}
    </div>
  );
}
