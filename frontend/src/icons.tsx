import type { ReactNode } from "react";

export type IconName =
  | "not_known"
  | "hard"
  | "easy"
  | "known"
  | "eye"
  | "pencil"
  | "info"
  | "check"
  | "prev"
  | "next"
  | "smaller"
  | "larger"
  | "sentence"
  | "more"
  | "menu"
  | "library"
  | "review"
  | "today"
  | "tutor"
  | "profile"
  | "settings"
  | "play"
  | "pause"
  | "close"
  | "cards"
  | "tap"
  | "speaker"
  | "keys";

// hand-drawn-feel line icons; each one reads without a label
const SHAPES: Record<IconName, ReactNode> = {
  // a question mark: "I don't know this yet"
  not_known: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.6a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.4" />
      <circle cx="12" cy="16.6" r="0.4" />
    </>
  ),
  // a flame: "hard, it keeps coming back"
  hard: (
    <path d="M12 3c.6 3.2 4.7 5.2 4.7 9.7a4.7 4.7 0 0 1-9.4 0c0-2.1 1-3.6 2.2-4.8.2 1.7.8 2.7 1.8 3.2-.3-2.6.2-4.6.7-8Z" />
  ),
  // a sprout: "easy, growing"
  easy: (
    <>
      <path d="M12 21v-8" />
      <path d="M12 13c0-4 2.6-6.6 7-7 0 4-2.6 7-7 7Z" />
      <path d="M12 16c0-3-2-5-6-5.4 0 3.1 2 5.4 6 5.4Z" />
    </>
  ),
  // a tick: "known"
  known: <path d="M5 12.5l4.2 4L19 7.5" />,
  eye: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  pencil: <path d="M4 20l1-4.2L15.5 5.3a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.2 19 4 20Z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2" />
      <circle cx="12" cy="7.9" r="0.4" />
    </>
  ),
  check: <path d="M5 12.5l4.2 4L19 7.5" />,
  prev: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  smaller: <path d="M6 12h12" />,
  larger: (
    <>
      <path d="M6 12h12" />
      <path d="M12 6v12" />
    </>
  ),
  sentence: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2.5" />
      <path d="M7.5 12h9" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  // an open book: library
  library: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15.5H5.5A1.5 1.5 0 0 0 4 21Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15.5h5.5a1.5 1.5 0 0 1 1.5 1.5Z" />
    </>
  ),
  // a card stack: review
  review: (
    <>
      <rect x="4" y="7" width="12" height="13" rx="2" />
      <path d="M8 4h10a2 2 0 0 1 2 2v10" />
    </>
  ),
  // a sun: today
  today: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" />
    </>
  ),
  // a speech bubble: tutor
  tutor: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5Z" />,
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  pause: <path d="M9 6v12M15 6v12" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  // two stacked cards: the deck
  cards: (
    <>
      <rect x="4" y="7.5" width="13" height="12" rx="2" />
      <path d="M8 4.5h10a2 2 0 0 1 2 2V16" />
    </>
  ),
  // a finger tapping: "tap a word"
  tap: (
    <>
      <path d="M9.5 11.5V5.2a1.6 1.6 0 0 1 3.2 0v5.3l4.4.9a2 2 0 0 1 1.6 2.2l-.6 4.4a2.6 2.6 0 0 1-2.6 2.2h-4.3a2.6 2.6 0 0 1-2-1l-3-3.9a1.5 1.5 0 0 1 2.3-1.9Z" />
      <path d="M6.2 4.6 5 3.4M5.6 8H4M15.8 4.6 17 3.4" />
    </>
  ),
  // a keyboard: "the keys"
  keys: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <path d="M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M7 13.6h.01M17 13.6h.01M9.8 13.6h4.4" />
    </>
  ),
  // a speaker with sound coming out: "hear it"
  speaker: (
    <>
      <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3Z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[name]}
    </svg>
  );
}
