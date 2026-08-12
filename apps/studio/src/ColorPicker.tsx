import { useEffect, useRef, useState } from "react";

export type HsvColor = { hue: number; saturation: number; value: number };

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.min(maximum, Math.max(minimum, value));

export const hexToHsv = (hex: string): HsvColor => {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  };
};

export const hsvToHex = ({ hue, saturation, value }: HsvColor): string => {
  const chroma = value * saturation;
  const section = (((hue % 360) + 360) % 360) / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = value - chroma;
  const channel = (component: number) =>
    Math.round((component + match) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
};

type LiveColorPickerProps = {
  label: string;
  value: string;
  disabled?: boolean;
  onPreview: (color: string) => void;
  onCommit: (color: string) => void;
  onCancel: () => void;
};

export function LiveColorPicker({
  label,
  value,
  disabled = false,
  onPreview,
  onCommit,
  onCancel,
}: LiveColorPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | undefined>(undefined);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<HsvColor | undefined>(undefined);
  const openRef = useRef(false);
  const draftRef = useRef(value.toUpperCase());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value.toUpperCase());
  const [hsv, setHsv] = useState(() => hexToHsv(value));

  useEffect(() => {
    if (open) return;
    const next = value.toUpperCase();
    draftRef.current = next;
    setDraft(next);
    setHsv(hexToHsv(next));
  }, [value, open]);

  const preview = (next: HsvColor) => {
    const normalized = {
      hue: ((next.hue % 360) + 360) % 360,
      saturation: clamp(next.saturation),
      value: clamp(next.value),
    };
    const color = hsvToHex(normalized);
    draftRef.current = color;
    setDraft(color);
    setHsv(normalized);
    onPreview(color);
  };

  const schedulePreview = (next: HsvColor) => {
    pendingRef.current = next;
    if (animationFrameRef.current !== undefined) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = undefined;
      if (pendingRef.current) preview(pendingRef.current);
      pendingRef.current = undefined;
    });
  };

  const flushPreview = () => {
    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    if (pendingRef.current) preview(pendingRef.current);
    pendingRef.current = undefined;
  };

  const close = (commit: boolean) => {
    if (!openRef.current) return;
    openRef.current = false;
    if (commit) flushPreview();
    else {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      pendingRef.current = undefined;
    }
    if (commit && draftRef.current !== value.toUpperCase())
      onCommit(draftRef.current);
    else onCancel();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      draftRef.current = value.toUpperCase();
      setDraft(value.toUpperCase());
      setHsv(hexToHsv(value));
      close(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  });

  useEffect(
    () => () => {
      if (animationFrameRef.current !== undefined)
        cancelAnimationFrame(animationFrameRef.current);
    },
    [],
  );

  const colorFromPointer = (
    event: React.PointerEvent<HTMLDivElement>,
  ): HsvColor => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      hue: hsv.hue,
      saturation: clamp((event.clientX - bounds.left) / bounds.width),
      value: 1 - clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  return (
    <div
      className="live-color-picker"
      ref={rootRef}
      onBlur={(event) => {
        if (
          openRef.current &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          close(true);
      }}
    >
      <button
        type="button"
        className="color-swatch-button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          if (open) close(true);
          else {
            const next = value.toUpperCase();
            draftRef.current = next;
            setDraft(next);
            setHsv(hexToHsv(next));
            openRef.current = true;
            setOpen(true);
          }
        }}
      >
        <span style={{ background: draft }} />
      </button>
      <code aria-live="polite">{draft}</code>
      {open && (
        <div
          className="color-popover"
          role="dialog"
          aria-label={`${label} picker`}
        >
          <div
            className="saturation-value-field"
            aria-label="Saturation and brightness"
            role="slider"
            aria-valuetext={`${Math.round(hsv.saturation * 100)}% saturation, ${Math.round(hsv.value * 100)}% brightness`}
            tabIndex={0}
            style={{
              backgroundColor: hsvToHex({
                hue: hsv.hue,
                saturation: 1,
                value: 1,
              }),
            }}
            onPointerDown={(event) => {
              activePointerRef.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              preview(colorFromPointer(event));
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              if (activePointerRef.current !== event.pointerId) return;
              schedulePreview(colorFromPointer(event));
            }}
            onPointerUp={(event) => {
              if (activePointerRef.current !== event.pointerId) return;
              schedulePreview(colorFromPointer(event));
              flushPreview();
              activePointerRef.current = undefined;
              close(true);
            }}
            onPointerCancel={() => {
              activePointerRef.current = undefined;
              close(false);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.1 : 0.01;
              if (event.key === "ArrowLeft")
                preview({ ...hsv, saturation: hsv.saturation - step });
              else if (event.key === "ArrowRight")
                preview({ ...hsv, saturation: hsv.saturation + step });
              else if (event.key === "ArrowUp")
                preview({ ...hsv, value: hsv.value + step });
              else if (event.key === "ArrowDown")
                preview({ ...hsv, value: hsv.value - step });
              else return;
              event.preventDefault();
            }}
          >
            <i
              aria-hidden="true"
              style={{
                left: `${hsv.saturation * 100}%`,
                top: `${(1 - hsv.value) * 100}%`,
              }}
            />
          </div>
          <label className="hue-field">
            <span>Hue</span>
            <input
              aria-label="Hue"
              type="range"
              min={0}
              max={359}
              value={Math.round(hsv.hue)}
              onInput={(event) =>
                schedulePreview({
                  ...hsv,
                  hue: Number(event.currentTarget.value),
                })
              }
              onPointerUp={() => close(true)}
            />
          </label>
          <label className="hex-color-field">
            <span>Hex</span>
            <input
              value={draft}
              maxLength={7}
              spellCheck={false}
              onChange={(event) => {
                const next = event.currentTarget.value.toUpperCase();
                setDraft(next);
                if (/^#[0-9A-F]{6}$/.test(next)) {
                  draftRef.current = next;
                  const nextHsv = hexToHsv(next);
                  setHsv(nextHsv);
                  onPreview(next);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && /^#[0-9A-F]{6}$/.test(draft))
                  close(true);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
