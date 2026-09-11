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
  Microphone,
  MicrophoneSlash,
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
  | "popout"
  | "mic"
  | "mic-off";

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
  mic: Microphone,
  "mic-off": MicrophoneSlash,
};

export function Icon({
  name,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  const Component = components[name];
  return <Component weight="regular" color="currentColor" aria-hidden="true" {...props} />;
}

// Dark scheme (on Ground): Char/Warm/Spark tips, on an opaque Ground plate.
// Light scheme (on Paper): Ash/Ember/Spark tips, no plate — see
// design/brand/cinder-mark-ember-reduced-light.svg, which this mirrors exactly.
const BRAND_MARK_STOPS = {
  dark: {
    outer: ["#A5602E", "#6E3216"],
    mid: ["#F0A15C", "#DD8B36"],
    core: ["#FFC78A", "#D9631F"],
    dot: ["#FFB566", "#6E3216"],
  },
  light: {
    outer: ["#8A3A16", "#2E160A"],
    mid: ["#E8792E", "#B24E17"],
    core: ["#FFB566", "#D9631F"],
    dot: ["#FFA53D", "#2E160A"],
  },
} as const;

export function BrandMark({ size = 34, scheme = "dark" }: { size?: number; scheme?: "light" | "dark" }) {
  const gradientId = useId();
  const outerGradient = `${gradientId}-outer`;
  const midGradient = `${gradientId}-mid`;
  const coreGradient = `${gradientId}-core`;
  const dotGradient = `${gradientId}-dot`;
  const stops = BRAND_MARK_STOPS[scheme];

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
          <stop offset="0" stopColor={stops.outer[0]} />
          <stop offset="1" stopColor={stops.outer[1]} />
        </linearGradient>
        <linearGradient id={midGradient} x1="0" y1="0" x2="26" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={stops.mid[0]} />
          <stop offset="1" stopColor={stops.mid[1]} />
        </linearGradient>
        <linearGradient id={coreGradient} x1="0" y1="0" x2="33" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={stops.core[0]} />
          <stop offset="1" stopColor={stops.core[1]} />
        </linearGradient>
        <radialGradient id={dotGradient} cx="0" cy="-2" r="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={stops.dot[0]} />
          <stop offset="1" stopColor={stops.dot[1]} />
        </radialGradient>
      </defs>
      {scheme === "dark" && <rect width="64" height="64" rx="14" fill="#221309" />}
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
