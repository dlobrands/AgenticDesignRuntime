import { useStudio } from "./store";

export function DesignPlans() {
  const plans = useStudio((state) => state.activeProject?.designPlans ?? []);
  const activeFrameId = useStudio((state) => state.activeFrame?.id);
  const compilation = useStudio((state) => state.designPlanCompilation);
  const roleInspection = useStudio((state) => state.designRoleInspection);
  const roleAssignment = useStudio((state) => state.semanticRoleAssignment);
  const preview = useStudio((state) => state.preview);
  const proposalView = useStudio((state) => state.proposalView);
  const selection = useStudio((state) => state.selection);
  const previewDesignPlan = useStudio((state) => state.previewDesignPlan);
  const applyLayoutSystem = useStudio((state) => state.applyLayoutSystem);
  const reflowContent = useStudio((state) => state.reflowContent);
  const replaceRoleAsset = useStudio((state) => state.replaceRoleAsset);
  const bindBrandTokens = useStudio((state) => state.bindBrandTokens);
  const createDesignVariant = useStudio((state) => state.createDesignVariant);
  const inspectDesignRoles = useStudio((state) => state.inspectDesignRoles);
  const assignSemanticRole = useStudio((state) => state.assignSemanticRole);
  const auditVisualQuality = useStudio((state) => state.auditVisualQuality);
  const commitPreview = useStudio((state) => state.commitPreview);
  const explainProposedChanges = useStudio(
    (state) => state.explainProposedChanges,
  );
  const discardPreview = useStudio((state) => state.discardPreview);
  if (plans.length === 0)
    return (
      <p className="empty-copy">
        No agent-authored design plans yet. Plans are inspectable project intent
        and do not mutate artwork until a separate compiler preview is reviewed.
      </p>
    );
  return (
    <div className="design-brief-list">
      {plans.map((plan) => {
        const roles = new Map(
          plan.semanticRoles.map((role) => [role.id, role.name]),
        );
        const regions = new Map(
          plan.layoutRegions.map((region) => [region.id, region.name]),
        );
        const roleName = (id: string) => roles.get(id) ?? id;
        const regionName = (id: string) => regions.get(id) ?? id;
        const selectedRoleIds = plan.semanticRoles
          .filter((role) => role.nodeId && selection.includes(role.nodeId))
          .map((role) => role.id);
        return (
          <details key={plan.id}>
            <summary>
              <span>
                <strong>{plan.name}</strong>
                <small>
                  {plan.approval.state} · {plan.semanticRoles.length} roles
                </small>
              </span>
              <span>⌄</span>
            </summary>
            <div className="design-brief-content">
              <div>
                <span>Objective</span>
                <p>{plan.objectiveSummary}</p>
                <p>
                  Brief: {plan.briefId ?? "Unbound"} · Target frame:{" "}
                  {plan.targetFrameId ?? "Unbound"}
                </p>
              </div>
              <div>
                <span>Semantic roles</span>
                <ul>
                  {plan.semanticRoles.map((role) => (
                    <li key={role.id}>
                      <code>{role.key}</code> {role.name} · {role.role} ·{" "}
                      {role.required ? "required" : "optional"}
                      {role.nodeId ? ` · Node ${role.nodeId}` : ""}
                      {role.copyItemId ? ` · Copy ${role.copyItemId}` : ""}
                      <div className="button-row">
                        <button
                          type="button"
                          aria-label={`Assign selected node to ${role.name}`}
                          disabled={
                            !selection[0] ||
                            plan.targetFrameId !== activeFrameId ||
                            selection[0] === role.nodeId
                          }
                          onClick={() =>
                            void assignSemanticRole(
                              plan.id,
                              role.id,
                              selection[0]!,
                            )
                          }
                        >
                          Assign selected node
                        </button>
                        {role.nodeId ? (
                          <button
                            type="button"
                            aria-label={`Detach ${role.name} node`}
                            onClick={() =>
                              void assignSemanticRole(plan.id, role.id, null)
                            }
                          >
                            Detach node
                          </button>
                        ) : null}
                        {plan.assetAssignments.some(
                          (assignment) => assignment.roleId === role.id,
                        ) ? (
                          <button
                            type="button"
                            aria-label={`Preview declared asset for ${role.name}`}
                            disabled={
                              !role.nodeId ||
                              plan.targetFrameId !== activeFrameId
                            }
                            onClick={() =>
                              void replaceRoleAsset(plan.id, role.id)
                            }
                          >
                            Preview declared asset
                          </button>
                        ) : null}
                      </div>
                      {roleAssignment?.planId === plan.id &&
                      roleAssignment.roleId === role.id &&
                      preview ? (
                        <div className="design-plan-compilation" role="status">
                          <strong>
                            Review role{" "}
                            {roleAssignment.nodeId ? "assignment" : "detach"}
                          </strong>
                          <p>
                            {preview.diff.length} canonical project diff
                            {preview.diff.length === 1 ? "" : "s"}. Approval
                            returns to draft.
                          </p>
                          <div className="button-row">
                            <button
                              type="button"
                              onClick={() => void commitPreview()}
                            >
                              Commit role assignment
                            </button>
                            <button type="button" onClick={discardPreview}>
                              Discard role assignment
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span>Role binding health</span>
                <button
                  type="button"
                  onClick={() => void inspectDesignRoles(plan.id)}
                >
                  Inspect role bindings
                </button>
                {roleInspection?.planId === plan.id ? (
                  <div className="design-plan-compilation" role="status">
                    <strong>
                      {roleInspection.summary.bound}/
                      {roleInspection.summary.total} bound
                    </strong>
                    <p>
                      {roleInspection.summary.requiredMissing} required missing
                      · {roleInspection.summary.missing} stale binding
                      {roleInspection.summary.missing === 1 ? "" : "s"}
                    </p>
                    <ul>
                      {roleInspection.roles.map((role) => (
                        <li key={role.id}>
                          <code>{role.key}</code> {role.bindingStatus}
                          {role.node
                            ? ` · ${role.node.name} (${role.node.type})`
                            : ""}
                          {role.protectedDecisionIds.length
                            ? ` · Protected ${role.protectedDecisionIds.join(", ")}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <div>
                <span>Content hierarchy</span>
                {plan.contentHierarchy.length ? (
                  <ol>
                    {[...plan.contentHierarchy]
                      .sort((left, right) => left.priority - right.priority)
                      .map((item) => (
                        <li key={item.id}>
                          {roleName(item.roleId)}
                          {item.parentRoleId
                            ? ` · Parent ${roleName(item.parentRoleId)}`
                            : ""}
                        </li>
                      ))}
                  </ol>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Layout regions</span>
                {plan.layoutRegions.length ? (
                  <ul>
                    {plan.layoutRegions.map((region) => (
                      <li key={region.id}>
                        <code>{region.key}</code> {region.name} · x {region.x},
                        y {region.y}, {region.width} × {region.height}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Anchors</span>
                {plan.anchors.length ? (
                  <ul>
                    {plan.anchors.map((anchor) => (
                      <li key={anchor.id}>
                        {roleName(anchor.roleId)} · {anchor.horizontal}/
                        {anchor.vertical}
                        {anchor.regionId
                          ? ` in ${regionName(anchor.regionId)}`
                          : ""}
                        {` · offset ${anchor.offsetX}, ${anchor.offsetY}`}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Constraints</span>
                {plan.constraints.length ? (
                  <ul>
                    {plan.constraints.map((constraint) => (
                      <li key={constraint.id}>
                        <code>{constraint.priority}</code> {constraint.kind} ·{" "}
                        {constraint.description}
                        {constraint.roleId
                          ? ` · ${roleName(constraint.roleId)}`
                          : ""}
                        {constraint.nodeId
                          ? ` · Node ${constraint.nodeId}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Safe areas</span>
                {plan.safeAreas.length ? (
                  <ul>
                    {plan.safeAreas.map((area) => (
                      <li key={area.id}>
                        {area.name} · {area.top}/{area.right}/{area.bottom}/
                        {area.left}
                        {area.regionId ? ` · ${regionName(area.regionId)}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Brand bindings</span>
                {plan.brandBindings.length ? (
                  <button
                    type="button"
                    aria-label={`Preview declared Brand bindings for ${plan.name}`}
                    disabled={plan.targetFrameId !== activeFrameId}
                    onClick={() => void bindBrandTokens(plan.id)}
                  >
                    Preview declared Brand bindings
                  </button>
                ) : null}
                {plan.brandBindings.length ? (
                  <ul>
                    {plan.brandBindings.map((binding) => (
                      <li key={binding.id}>
                        {roleName(binding.roleId)} · {binding.property} →{" "}
                        <code>{binding.tokenKey}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Asset assignments</span>
                {plan.assetAssignments.length ? (
                  <ul>
                    {plan.assetAssignments.map((assignment) => (
                      <li key={assignment.id}>
                        {roleName(assignment.roleId)} · Asset{" "}
                        {assignment.assetId} · {assignment.fit} · crop{" "}
                        {assignment.preserveCrop ? "preserved" : "replaceable"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Effect intentions</span>
                {plan.effectIntentions.length ? (
                  <ul>
                    {plan.effectIntentions.map((effect) => (
                      <li key={effect.id}>
                        {roleName(effect.roleId)} · {effect.effectType} ·{" "}
                        {effect.enabled ? "enabled" : "disabled"} ·{" "}
                        {effect.description}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Variant rules</span>
                {plan.variantRules.length ? (
                  <ul>
                    {plan.variantRules.map((rule) => (
                      <li key={rule.id}>
                        {rule.name} · {rule.description}
                        {rule.format
                          ? ` · ${rule.format.width} × ${rule.format.height} ${rule.format.channel}`
                          : ""}
                        {rule.roleBehaviors.length
                          ? ` · ${rule.roleBehaviors
                              .map(
                                (behavior) =>
                                  `${roleName(behavior.roleId)} ${behavior.behavior}`,
                              )
                              .join(" · ")}`
                          : ""}
                        <button
                          type="button"
                          aria-label={`Preview variant ${rule.name}`}
                          disabled={plan.targetFrameId !== activeFrameId}
                          onClick={() =>
                            void createDesignVariant(plan.id, rule.id)
                          }
                        >
                          Preview variant
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Protected human decisions</span>
                {plan.protectedDecisions.length ? (
                  <ul>
                    {plan.protectedDecisions.map((decision) => (
                      <li key={decision.id}>
                        <code>{decision.kind}</code> {decision.description}
                        {decision.roleId
                          ? ` · ${roleName(decision.roleId)}`
                          : ""}
                        {decision.nodeId ? ` · Node ${decision.nodeId}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>None specified.</p>
                )}
              </div>
              <div>
                <span>Approval</span>
                <p>
                  {plan.approval.state}
                  {plan.approval.decidedBy
                    ? ` · ${plan.approval.decidedBy}`
                    : ""}
                  {plan.approval.decidedAt
                    ? ` · ${plan.approval.decidedAt}`
                    : ""}
                </p>
                {plan.approval.notes.length ? (
                  <ul>
                    {plan.approval.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div>
                <span>Compiler preview</span>
                <p>
                  Compiles only declared actionable intent into ordinary frame
                  operations. Warnings and protected decisions remain visible.
                </p>
                <button
                  type="button"
                  disabled={
                    !activeFrameId || plan.targetFrameId !== activeFrameId
                  }
                  onClick={() => void previewDesignPlan(plan.id)}
                >
                  Preview actionable intent
                </button>
                <button
                  type="button"
                  disabled={
                    !activeFrameId || plan.targetFrameId !== activeFrameId
                  }
                  onClick={() => void applyLayoutSystem(plan.id)}
                >
                  Preview layout system
                </button>
                <button
                  type="button"
                  disabled={
                    !activeFrameId ||
                    plan.targetFrameId !== activeFrameId ||
                    selectedRoleIds.length === 0
                  }
                  onClick={() => void reflowContent(plan.id, selectedRoleIds)}
                >
                  Reflow selected roles
                </button>
                <button
                  type="button"
                  disabled={
                    !activeFrameId || plan.targetFrameId !== activeFrameId
                  }
                  onClick={() => void auditVisualQuality(plan.id)}
                >
                  Run deterministic visual QA
                </button>
                {plan.targetFrameId !== activeFrameId ? (
                  <small>Open the plan's target frame to compile it.</small>
                ) : null}
                {compilation?.planId === plan.id ? (
                  <div className="design-plan-compilation" role="status">
                    <strong>
                      {compilation.operations.length} ordinary operation
                      {compilation.operations.length === 1 ? "" : "s"}
                    </strong>
                    {compilation.changes.length ? (
                      <ol>
                        {compilation.changes.map((change) => (
                          <li key={`${change.operationIndex}-${change.intent}`}>
                            <code>{change.intent}</code> {change.summary}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No actionable changes.</p>
                    )}
                    {compilation.warnings.length ? (
                      <ul>
                        {compilation.warnings.map((warning, index) => (
                          <li key={`${warning.code}-${index}`}>
                            <code>{warning.code}</code> {warning.message}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No compiler warnings.</p>
                    )}
                    {preview ? (
                      <div>
                        <div className="button-row">
                          <button
                            type="button"
                            onClick={() => void explainProposedChanges()}
                          >
                            Explain proposed changes
                          </button>
                          <button
                            type="button"
                            onClick={() => void commitPreview()}
                          >
                            Commit reviewed preview
                          </button>
                          <button type="button" onClick={discardPreview}>
                            Discard preview
                          </button>
                        </div>
                        {proposalView?.previewId === preview.previewId ? (
                          <div role="status">
                            <strong>Canonical proposal review</strong>
                            <p>
                              {proposalView.operations.length} stored operation
                              {proposalView.operations.length === 1 ? "" : "s"}
                              {" · "}
                              {proposalView.author.source}
                            </p>
                            <ol>
                              {proposalView.explanations.map(
                                (explanation, index) => (
                                  <li key={`${index}-${explanation}`}>
                                    {explanation}
                                  </li>
                                ),
                              )}
                            </ol>
                            <small>
                              Expires {proposalView.expiresAt}. Committing uses
                              this exact preview and its revision checks.
                            </small>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <p className="advanced-disclosure">
                Read-only plan. It contains no executable code and cannot alter
                artwork until a separate intent-compiler preview is reviewed.
              </p>
            </div>
          </details>
        );
      })}
    </div>
  );
}
