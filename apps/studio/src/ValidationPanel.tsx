import { useState } from "react";
import { useStudio } from "./store";

export function ValidationPanel() {
  const [copied, setCopied] = useState(false);
  const open = useStudio((state) => state.validationOpen);
  const setOpen = useStudio((state) => state.setValidationOpen);
  const validation = useStudio((state) => state.validation);
  const visualQa = useStudio((state) => state.visualQa);
  if (!validation && !visualQa) return null;
  const visualQaValidationCodes = new Set([
    "TEXT_OVERFLOW",
    "LOW_RESOLUTION_ASSET",
    "CONTENT_OUTSIDE_ARTBOARD",
    "FRAME_COMPLEXITY_WARNING",
    "HIGH_COMPLEXITY_SCORE",
  ]);
  const validationWarnings = (validation?.warnings ?? []).filter(
    (warning) => !visualQa || !visualQaValidationCodes.has(warning.code),
  );
  const errorCount =
    (validation?.errors.length ?? 0) + (visualQa?.summary.errors ?? 0);
  const warningCount =
    validationWarnings.length + (visualQa?.summary.warnings ?? 0);
  return (
    <section
      className={`validation-panel${open ? " is-open" : ""}`}
      aria-label="Frame validation"
    >
      <button
        className="validation-handle"
        aria-controls="frame-validation-findings"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>Frame checks</span>
        <em>
          {errorCount
            ? `${errorCount} error${errorCount === 1 ? "" : "s"}`
            : warningCount
              ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
              : `${validation?.nodeCount ?? 0} nodes valid`}
        </em>
        <b aria-hidden="true">{open ? "⌄" : "⌃"}</b>
      </button>
      {open && (
        <div id="frame-validation-findings" className="validation-content">
          {(validation?.errors ?? []).map((issue) => (
            <p
              className="validation-error"
              key={`${issue.code}${issue.nodeId}`}
            >
              {issue.message}
            </p>
          ))}
          {validationWarnings.map((warning) => (
            <p
              className="validation-warning"
              key={`${warning.code}${warning.message}`}
            >
              {warning.message}
            </p>
          ))}
          {visualQa ? (
            <div className="visual-qa-findings">
              <strong>Deterministic visual QA</strong>
              {visualQa.findings.length ? (
                visualQa.findings.map((finding) => (
                  <p
                    className={
                      finding.severity === "error"
                        ? "validation-error"
                        : "validation-warning"
                    }
                    key={finding.id}
                  >
                    <code>{finding.code}</code> {finding.message}
                  </p>
                ))
              ) : (
                <p>No deterministic visual-QA findings.</p>
              )}
              <small>
                Heuristic and model-judged checks are listed as unevaluated and
                are never included in these objective counts.
              </small>
            </div>
          ) : null}
          {validation?.valid &&
            !validationWarnings.length &&
            !visualQa?.findings.length && <p>No validation findings.</p>}
          <button
            className="subtle-button"
            onClick={() => {
              void navigator.clipboard
                .writeText(JSON.stringify({ validation, visualQa }, null, 2))
                .then(() => setCopied(true));
            }}
          >
            {copied ? "Support details copied" : "Copy support details"}
          </button>
        </div>
      )}
    </section>
  );
}
