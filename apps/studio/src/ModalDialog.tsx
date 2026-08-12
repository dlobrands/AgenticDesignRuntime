import {
  useEffect,
  useRef,
  type FormEventHandler,
  type ReactNode,
} from "react";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ModalDialog({
  children,
  className = "",
  form = false,
  onClose,
  onSubmit,
  role = "dialog",
  titleId,
}: {
  children: ReactNode;
  className?: string;
  form?: boolean;
  onClose: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  role?: "dialog" | "alertdialog";
  titleId: string;
}) {
  const card = useRef<HTMLDivElement | HTMLFormElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = card.current;
    const initial =
      root?.querySelector<HTMLElement>("[data-autofocus]") ??
      root?.querySelector<HTMLElement>(focusableSelector) ??
      root;
    initial?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      if (!focusable.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const common = {
    "aria-labelledby": titleId,
    "aria-modal": true,
    className: `modal-card${className ? ` ${className}` : ""}`,
    role,
    tabIndex: -1,
  } as const;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {form ? (
        <form
          ref={(element) => {
            card.current = element;
          }}
          {...common}
          onSubmit={onSubmit}
        >
          {children}
        </form>
      ) : (
        <div
          ref={(element) => {
            card.current = element;
          }}
          {...common}
        >
          {children}
        </div>
      )}
    </div>
  );
}
