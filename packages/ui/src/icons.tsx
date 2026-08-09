import type { ReactNode, SVGProps } from "react";

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
  | "download";

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
  const blade = "M0 0 C52.8-62 217.8-31 330 0 C204.6 11.56 52.8 10.2 0 0Z";
  const sideBlade = "M0 0 C48-58 198-29 300 0 C186 10.88 48 9.6 0 0Z";
  const wing = "M0 0 C30.4-50 125.4-25 190 0 C117.8 13.6 30.4 12 0 0Z";
  const middle = "M0 0 C37.12-44 153.12-22 232 0 C143.84 8.16 37.12 7.2 0 0Z";
  const middleSide =
    "M0 0 C32.64-40 134.64-20 204 0 C126.48 7.48 32.64 6.6 0 0Z";
  const core = "M0 0 C20.48-26 84.48-13 128 0 C79.36 5.1 20.48 4.5 0 0Z";
  const coreSide = "M0 0 C16.64-22 68.64-11 104 0 C64.48 4.42 16.64 3.9 0 0Z";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Cinder">
      <rect width="64" height="64" rx="14" fill="#221309" />
      <g transform="translate(32 39) scale(.078)">
        <g fill="#6E3216">
          <path d={blade} transform="rotate(-90)" />
          <path d={sideBlade} transform="rotate(-122)" />
          <path d={sideBlade} transform="rotate(-58)" />
          <path d={wing} transform="rotate(-158)" />
          <path d={wing} transform="rotate(-22)" />
        </g>
        <g fill="#DD8B36">
          <path d={middle} transform="rotate(-90)" />
          <path d={middleSide} transform="rotate(-117)" />
          <path d={middleSide} transform="rotate(-63)" />
        </g>
        <g fill="#D9631F">
          <path d={core} transform="rotate(-90)" />
          <path d={coreSide} transform="rotate(-110)" />
          <path d={coreSide} transform="rotate(-70)" />
        </g>
        <circle r="17" fill="#6E3216" />
      </g>
    </svg>
  );
}
