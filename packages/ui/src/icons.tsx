import { useId, type SVGProps } from "react";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  CalendarCheck,
  Calendar,
  CaretRight,
  Check,
  ChalkboardTeacher,
  Chats,
  Clock,
  ClipboardText,
  DownloadSimple,
  FileText,
  GearSix,
  House,
  MagnifyingGlass,
  Moon,
  Note,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Robot,
  SignOut,
  SquaresFour,
  Sun,
  Table,
  Trash,
  Users,
  WifiHigh,
  WifiSlash,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

// Phosphor Icons (regular weight), https://phosphoricons.com - MIT licensed.
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
  | "sun"
  | "popout";

const components: Record<IconName, PhosphorIcon> = {
  dashboard: SquaresFour,
  students: Users,
  classrooms: ChalkboardTeacher,
  assignments: ClipboardText,
  attendance: CalendarCheck,
  assistant: Robot,
  settings: GearSix,
  home: House,
  notes: Note,
  feedback: Chats,
  search: MagnifyingGlass,
  plus: Plus,
  logout: SignOut,
  chevron: CaretRight,
  calendar: Calendar,
  check: Check,
  clock: Clock,
  document: FileText,
  wifi: WifiHigh,
  offline: WifiSlash,
  send: PaperPlaneTilt,
  close: X,
  refresh: ArrowsClockwise,
  edit: PencilSimple,
  trash: Trash,
  spreadsheet: Table,
  download: DownloadSimple,
  moon: Moon,
  sun: Sun,
  popout: ArrowSquareOut,
};

export function Icon({
  name,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  const Component = components[name];
  return <Component weight="regular" color="currentColor" aria-hidden="true" {...props} />;
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
