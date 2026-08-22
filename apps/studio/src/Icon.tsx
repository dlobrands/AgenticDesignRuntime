import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "chevron-down"
  | "chevron-right"
  | "copy"
  | "ellipse"
  | "eye"
  | "eye-off"
  | "group"
  | "image"
  | "lock"
  | "lock-open"
  | "more"
  | "mouse-pointer"
  | "pen"
  | "plus"
  | "rectangle"
  | "redo"
  | "rename"
  | "text"
  | "trash"
  | "undo";

const paths: Record<IconName, ReactElement> = {
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="1.5" />
      <path d="M16 8V5H5v11h3" />
    </>
  ),
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  "eye-off": (
    <>
      <path d="m3 3 18 18" />
      <path d="M10.7 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 3" />
      <path d="M6.6 6.6A16 16 0 0 0 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 2-.2" />
    </>
  ),
  group: (
    <>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <rect x="14" y="14" width="6" height="6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <circle cx="8" cy="9" r="1.5" />
      <path d="m4 18 5-5 3 3 3-3 5 5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  "lock-open": (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  "mouse-pointer": <path d="m5 3 13 9-6 1.5L9 19Z" />,
  pen: (
    <>
      <path d="m4 20 5-2 9-9-3-3-9 9Z" />
      <path d="m13 8 3 3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1" />,
  redo: <path d="M20 7v5h-5M19 12a8 8 0 1 0-2 5" />,
  rename: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16Z" />
      <path d="m13 7 4 4" />
    </>
  ),
  text: <path d="M5 5h14M12 5v14M8 19h8" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  undo: <path d="M4 7v5h5M5 12a8 8 0 1 1 2 5" />,
};

export function Icon({
  name,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
