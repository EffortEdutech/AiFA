/**
 * In-house inline SVG icon set (UI polish owner decision, 2026-10-05: no
 * icon library, no new dependency). 24px grid, 1.8 stroke, `currentColor`
 * so an icon takes the colour of the text around it. Decorative by
 * default (`aria-hidden`); pass `label` when an icon stands alone.
 */
const PATHS = {
  menu: "M4 6h16M4 12h16M4 18h16",
  bell: "M6 8a6 6 0 0112 0c0 7 3 7 3 9H3c0-2 3-2 3-9M10 21h4",
  sparkles:
    "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  home: "M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6",
  zap: "M13 2L4 14h7l-1 8 9-12h-7z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  users:
    "M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8M21 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  user: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01",
  file: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M8 13h8M8 17h8",
  receipt:
    "M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3zM9 8h6M9 12h6",
  wallet: "M20 12V8H6a2 2 0 010-4h12v4M4 6v12a2 2 0 002 2h14v-4M18 12a2 2 0 000 4h4v-4z",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12",
  truck:
    "M1 3h13v13H1zM14 8h4l3 3v5h-7M5.5 21a2 2 0 100-4 2 2 0 000 4M17.5 21a2 2 0 100-4 2 2 0 000 4",
  book: "M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5zM4 19.5A2.5 2.5 0 006.5 22H20v-5",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  briefcase: "M3 7h18v13H3zM8 7V4h8v3M3 13h18",
  calendar: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18",
  scale: "M12 3v18M5 21h14M5 7h14M5 7l-3 7a3 3 0 006 0zM19 7l-3 7a3 3 0 006 0z",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  laptop: "M4 5h16v11H4zM2 20h20",
  clipboard:
    "M9 3h6v4H9zM7 5H5a1 1 0 00-1 1v15a1 1 0 001 1h14a1 1 0 001-1V6a1 1 0 00-1-1h-2M9 14l2 2 4-4",
  chart: "M3 3v18h18M7 15l4-4 3 3 5-6",
  check: "M5 12l5 5L20 7",
  x: "M6 6l12 12M18 6L6 18",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  alert:
    "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  info: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z",
  eyeOff:
    "M17.9 17.9A10.9 10.9 0 0112 20C5 20 1 12 1 12a18.5 18.5 0 015.1-5.9M9.9 4.2A9.1 9.1 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.2 3.2M14.1 14.1a3 3 0 11-4.2-4.2M1 1l22 22",
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

interface IconProps {
  name: IconName;
  size?: number;
  /** Accessible name for an icon that stands alone; omit when decorative. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 18, label, className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
