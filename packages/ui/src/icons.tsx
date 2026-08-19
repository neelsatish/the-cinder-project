import { useId, type ReactNode, type SVGProps } from "react";

export type IconName =
  | "dashboard"
  | "students"
  | "classrooms"
  | "assignments"
  | "attendance"
  | "assistant"
  | "settings"
  | "home"
  | "notes"
  | "feedback"
  | "search"
  | "plus"
  | "logout"
  | "chevron"
  | "calendar"
  | "check"
  | "clock"
  | "document"
  | "wifi"
  | "offline"
  | "send"
  | "close"
  | "refresh"
  | "edit"
  | "trash"
  | "spreadsheet"
  | "download"
  | "moon"
  | "sun";

const paths: Record<IconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  students: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  classrooms: (
    <>
      <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" />
    </>
  ),
  assignments: (
    <>
      <path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </>
  ),
  attendance: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M8 15l2 2 5-5" />
    </>
  ),
  assistant: (
    <>
      <path d="M12 2a7 7 0 0 0-4 12.74V20l4-2 4 2v-5.26A7 7 0 0 0 12 2Z" />
      <path d="M9 9h.01M15 9h.01M9.5 12.5c1.5 1 3.5 1 5 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3a1.7 1.7 0 0 0 1.1 1.6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.35.73.6 1 .28.26.63.4 1 .4h.1v4H21a1.7 1.7 0 0 0-1.6.6Z" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v11h14V10M9 21v-7h6v7" />
    </>
  ),
  notes: (
    <>
      <path d="M4 3h16v18H4z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </>
  ),
  feedback: (
    <>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      <path d="m8 11 2 2 5-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  logout: (
    <>
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  document: (
    <>
      <path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M14 2v6h6" />
    </>
  ),
  wifi: (
    <>
      <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  offline: (
    <>
      <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M3 3l18 18" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  refresh: (
    <>
      <path d="M20 6v5h-5" />
      <path d="M18.5 15a7 7 0 1 1-.8-7.8L20 11" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" />
    </>
  ),
  spreadsheet: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v18M15 3v18M3 15h18" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  moon: <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </>
  ),
};

export function Icon({
  name,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function BrandMark({ size = 34 }: { size?: number }) {
  const gradientId = useId();
  const outerGradient = `${gradientId}-outer`;
  const midGradient = `${gradientId}-mid`;
  const coreGradient = `${gradientId}-core`;
  const dotGradient = `${gradientId}-dot`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Cinder"
    >
      <defs>
        <linearGradient id={outerGradient} x1="0" y1="0" x2="20" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A5602E" />
          <stop offset="1" stopColor="#6E3216" />
        </linearGradient>
        <linearGradient id={midGradient} x1="0" y1="0" x2="26" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F0A15C" />
          <stop offset="1" stopColor="#DD8B36" />
        </linearGradient>
        <linearGradient id={coreGradient} x1="0" y1="0" x2="33" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC78A" />
          <stop offset="1" stopColor="#D9631F" />
        </linearGradient>
        <radialGradient id={dotGradient} cx="0" cy="-2" r="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFB566" />
          <stop offset="1" stopColor="#6E3216" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#221309" />
      <g transform="translate(32 49)">
        <g fill={`url(#${outerGradient})`}>
          <path d="M0 0 Q6.4 -6.9 20 0 Q10 3 0 0 Z" transform="rotate(-161)" />
          <path d="M0 0 Q6.4 -6.9 20 0 Q10 3 0 0 Z" transform="rotate(-19)" />
        </g>
        <g fill={`url(#${midGradient})`}>
          <path d="M0 0 Q8.3 -8.8 26 0 Q13 3.9 0 0 Z" transform="rotate(-126)" />
          <path d="M0 0 Q8.3 -8.8 26 0 Q13 3.9 0 0 Z" transform="rotate(-54)" />
        </g>
        <path
          d="M0 0 Q10.6 -10.6 33 0 Q16.5 4.7 0 0 Z"
          transform="rotate(-90)"
          fill={`url(#${coreGradient})`}
        />
        <circle r="4" fill={`url(#${dotGradient})`} />
      </g>
    </svg>
  );
}
