import { useId, useMemo, useState } from "react";
import {
  TEMPLATE_SLOT_ROLES,
  createProjectTemplateDefinition,
  findNode,
  type SceneNode,
  type TemplateSlotRole,
} from "@tva-agentic-design/core";
import { ModalDialog } from "./ModalDialog";
import { useStudio } from "./store";

const ROLE_LABELS: Record<TemplateSlotRole, string> = {
  headline: "Headline",
  supportingCopy: "Supporting copy",
  heroImage: "Hero image",
  logo: "Logo",
  cta: "CTA",
  background: "Background",
  badge: "Badge",
  legalCopy: "Legal copy",
};

const slotKey = (name: string, used: Set<string>): string => {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56) || "slot";
  const canonicalBase = /^[a-z]/.test(base) ? base : `slot-${base}`;
  let key = canonicalBase;
  let index = 2;
  while (used.has(key)) key = `${canonicalBase.slice(0, 56)}-${index++}`;
  used.add(key);
  return key;
};

const suggestedRole = (node: SceneNode): TemplateSlotRole | "none" => {
  const name = node.name.toLowerCase();
  if (name.includes("logo")) return "logo";
  if (name.includes("legal")) return "legalCopy";
  if (name.includes("badge")) return "badge";
  if (name.includes("background")) return "background";
  if (name.includes("cta") || name.includes("button")) return "cta";
  if (node.type === "rasterImage" || node.type === "svg") return "heroImage";
  if (node.type === "text") return "headline";
  return "none";
};

const flattenTemplateNodes = (roots: readonly SceneNode[]): SceneNode[] => {
  const result: SceneNode[] = [];
  const visit = (node: SceneNode): void => {
    result.push(node);
    if (node.type === "group") node.children.forEach(visit);
    if (node.type === "mask") {
      visit(node.maskSource);
      node.children.forEach(visit);
    }
  };
  roots.forEach(visit);
  return result;
};

export function ProjectTemplates() {
  const titleId = useId();
  const project = useStudio((state) => state.activeProject);
  const frame = useStudio((state) => state.activeFrame);
  const selection = useStudio((state) => state.selection);
  const saveTemplate = useStudio((state) => state.saveProjectTemplate);
  const removeTemplate = useStudio((state) => state.removeProjectTemplate);
  const applyTemplate = useStudio((state) => state.applyProjectTemplate);
  const detachTemplate = useStudio((state) => state.detachProjectTemplate);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Campaign template");
  const [description, setDescription] = useState("");
  const selectedNodes = useMemo(
    () =>
      frame?.root.children.filter((node) => selection.includes(node.id)) ?? [],
    [frame, selection],
  );
  const templateNodes = useMemo(
    () => flattenTemplateNodes(selectedNodes),
    [selectedNodes],
  );
  const [roles, setRoles] = useState<Record<string, TemplateSlotRole | "none">>(
    {},
  );
  const selectedNode =
    frame && selection.length === 1
      ? findNode(frame, selection[0]!)
      : undefined;
  const instanceId = selectedNode?.templateInstance?.instanceId;
  const beginCapture = () => {
    setRoles(
      Object.fromEntries(
        templateNodes.map((node) => [node.id, suggestedRole(node)]),
      ),
    );
    setName("Campaign template");
    setDescription("");
    setOpen(true);
  };
  const save = async () => {
    if (!project || selectedNodes.length === 0 || !name.trim()) return;
    const used = new Set<string>();
    const slots = templateNodes.flatMap((node) => {
      const role = roles[node.id] ?? "none";
      return role === "none"
        ? []
        : [
            {
              slotId: crypto.randomUUID(),
              key: slotKey(node.name, used),
              name: node.name,
              role,
              nodeId: node.id,
            },
          ];
    });
    const now = new Date().toISOString();
    await saveTemplate(
      createProjectTemplateDefinition({
        id: crypto.randomUUID(),
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        nodes: selectedNodes,
        slots,
        now,
      }),
    );
    setOpen(false);
  };

  return (
    <>
      <div className="project-template-toolbar">
        <button
          className="subtle-button"
          disabled={selectedNodes.length === 0}
          title={
            selectedNodes.length === 0
              ? "Select one or more top-level layers"
              : "Capture selected top-level layers"
          }
          onClick={beginCapture}
        >
          Save selection as template
        </button>
        {instanceId && (
          <button
            className="subtle-button"
            onClick={() => void detachTemplate(instanceId)}
          >
            Detach instance metadata
          </button>
        )}
      </div>
      {(project?.templates ?? []).length === 0 ? (
        <p className="empty-copy">No project templates yet.</p>
      ) : (
        <div className="project-template-list">
          {(project?.templates ?? []).map((template) => (
            <article key={template.id}>
              <div>
                <strong>{template.name}</strong>
                <span>
                  {template.nodes.length} roots · {template.slots.length} slots
                </span>
              </div>
              <button
                disabled={!frame}
                onClick={() => void applyTemplate(template.id)}
              >
                Apply
              </button>
              <button onClick={() => void removeTemplate(template.id)}>
                Remove
              </button>
            </article>
          ))}
        </div>
      )}
      {selectedNode?.templateSlot && (
        <div className="template-slot-readout">
          <span>Semantic slot</span>
          <strong>{selectedNode.templateSlot.name}</strong>
          <code>{ROLE_LABELS[selectedNode.templateSlot.role]}</code>
        </div>
      )}
      {open && (
        <ModalDialog
          className="template-dialog"
          form
          onClose={() => setOpen(false)}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          titleId={titleId}
        >
          <span className="eyebrow">Reusable project system</span>
          <h2 id={titleId}>Create canonical template</h2>
          <p>
            Capture ordinary layers. Slot labels preserve intent for agents and
            humans; applied layers stay directly editable.
          </p>
          <label>
            Template name
            <input
              data-autofocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label>
            Description
            <input
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </label>
          <div className="template-slot-list">
            {templateNodes.map((node) => (
              <label key={node.id}>
                <span>
                  <strong>{node.name}</strong>
                  <small>{node.type}</small>
                </span>
                <select
                  aria-label={`${node.name} semantic slot`}
                  value={roles[node.id] ?? "none"}
                  onChange={(event) => {
                    const role = event.currentTarget.value as
                      TemplateSlotRole | "none";
                    setRoles((current) => ({
                      ...current,
                      [node.id]: role,
                    }));
                  }}
                >
                  <option value="none">Not a slot</option>
                  {TEMPLATE_SLOT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!name.trim() || selectedNodes.length === 0}
            >
              Save template
            </button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
