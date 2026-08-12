# Proposal Review Tools

AgenticDesignRuntime presents an unexpired canonical transaction preview as an ephemeral proposal review. The proposal does not own operations, scene state, approval state, or a second commit path: `proposalId` is exactly `previewId`, and the runtime derives the view from the preview record already held by `TransactionEngine`.

## Contract

`explain_proposed_changes` and `preview_proposal` return the same schema-1 view:

- exact scope, base revision, operation hash, trusted author, and stored operations;
- ordered explanations derived from the structured canonical diff;
- the complete structured diff, warnings, and affected node IDs;
- the canonical preview expiry and rendered-preview URL when one was requested.

Both tools are read-only. They create no preview, revision, event, artifact, proposal branch, or duplicate operation list in runtime storage. Returned operations and diffs are defensive copies so client mutation cannot alter the commit candidate.

`commit_proposal` is an explicit compatibility alias for committing that exact preview. It calls the existing `TransactionEngine.commitPreview` path, which verifies expiry, the stored operation hash, and the current canonical revision before running the normal transaction, validation, journal, history, inverse, recovery, and event pipeline. A consumed or expired proposal cannot be explained, previewed, or committed again. Concurrent canonical changes retain the existing stale/conflict behavior; no proposal tool silently rebases or regenerates operations.

## Surfaces

The typed client exposes `explainProposedChanges`, `previewProposal`, and `commitProposal`. Direct MCP and workspace-aware plugin MCP expose `explain_proposed_changes`, `preview_proposal`, and `commit_proposal`. Studio offers **Explain proposed changes** for a current DesignPlan compiler preview and displays the trusted participant type, exact stored operation count, diff explanations, and expiry before the existing reviewed commit or discard action.

## Compatibility and boundary

This slice adds no canonical field, operation kind, product version, runtime API version, workspace schema version, dependency upgrade, or migration. Existing `commit_preview` callers remain supported. Durable proposal records, branches, comments, presence, approval workflows, and semantic merge belong to Phase 6; they may reference this preview contract but must not replace the canonical transaction engine.
