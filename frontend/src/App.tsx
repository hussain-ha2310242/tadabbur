import { useEffect, useState } from "react";
import { api } from "./api";
import Library from "./views/Read";
import Review from "./views/Review";
import Words from "./views/Words";
import { ProfileChip, ProfilePage } from "./views/Profile";
import { applyCardStyle, applyTextScale, applyTheme } from "./theme";
import { DeskSky } from "./DeskSky";

type View = "library" | "review" | "profile" | "words";

/** The sheet as a manuscript page: an aged SVG paper with faint margin rules.
 *  The filter gives it a rough, hand-torn edge. Decoration only. */
function PaperSheet() {
  return (
    <svg className="paper-svg" aria-hidden="true" viewBox="0 0 1000 1000" preserveAspectRatio="none">
      <defs>
        <filter id="paper-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="2" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.30  0 0 0 0 0.16  0.7 0 0 0 -0.32" />
        </filter>
        <radialGradient id="paper-age" cx="50%" cy="46%" r="72%">
          <stop offset="55%" stopColor="rgb(120 80 40)" stopOpacity="0" />
          <stop offset="100%" stopColor="rgb(120 80 40)" stopOpacity="0.2" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="1000" style={{ fill: "var(--bg)" }} />
      <rect className="paper-age" x="0" y="0" width="1000" height="1000" fill="url(#paper-age)" />
      {/* texture: a fine grain */}
      <rect x="0" y="0" width="1000" height="1000" filter="url(#paper-grain)" />
    </svg>
  );
}

/** A kashida: the calligrapher's stretched stroke. Thick where it meets the name,
 *  tapering out toward the edge, and ending in a nuqta (the dot) by the name. */
function Kashida({ side }: { side: "left" | "right" }) {
  const d =
    side === "left"
      ? "M0 2.9 Q50 2.8 100 2.3 L100 3.7 Q50 3.2 0 3.1 Z"
      : "M100 2.9 Q50 2.8 0 2.3 L0 3.7 Q50 3.2 100 3.1 Z";
  return (
    <span className={`kashida kashida-${side}`} aria-hidden="true">
      <svg viewBox="0 0 100 6" preserveAspectRatio="none">
        <path d={d} />
      </svg>
      <svg className="kashida-star" viewBox="-6.5 -6.5 13 13" aria-hidden="true">
        <path d="M0.00 -6.20 L1.11 -2.68 L4.38 -4.38 L2.68 -1.11 L6.20 0.00 L2.68 1.11 L4.38 4.38 L1.11 2.68 L0.00 6.20 L-1.11 2.68 L-4.38 4.38 L-2.68 1.11 L-6.20 0.00 L-2.68 -1.11 L-4.38 -4.38 L-1.11 -2.68 Z" />
      </svg>
    </span>
  );
}

export default function App() {
  const [view, setView] = useState<View>("library");
  // bumping this remounts the home view, which closes any text open in the reader
  const [homeKey, setHomeKey] = useState(0);
  // the deck opened from a note shows that note's cards only
  const [reviewNote, setReviewNote] = useState<number | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        applyTextScale(s.ar_text_scale || "1");
        applyTheme(s.theme || "light");
        applyCardStyle(s.card_style || "sticky");
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <DeskSky />
      {/* a shared filter that roughens the paper's edge */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <filter id="deckle" x="-3%" y="-3%" width="106%" height="106%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="9" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <main className="sheet paper relative mx-auto my-8 min-h-[calc(100vh-4rem)] max-w-[min(72rem,calc(100vw-28px))] px-6 pb-24 pt-6 sm:px-10" dir="ltr">
        <PaperSheet />
        <ProfileChip onOpen={() => setView("profile")} refresh={view} />
        {/* the top row never changes: the name in the middle goes home, between two fading rules */}
        <div className="flex min-h-[3.5rem] items-center gap-5">
          <Kashida side="left" />
          <button
            onClick={() => {
              setView("library");
              setHomeKey((k) => k + 1);
            }}
            className="brand ar flex-none text-center text-4xl"
            aria-label="Tadabbur, go home"
            title="Home"
            style={{ fontWeight: 400, lineHeight: 1.2, fontFamily: "'Rakkas', var(--font-ar)", color: "var(--fg)" }}
          >
            <span className="hl-under">تدبّر</span>
          </button>
          <Kashida side="right" />
        </div>

        <div className="mt-8">
          {view === "library" && (
            <Library
              key={homeKey}
              onReview={() => {
                setReviewNote(null);
                setView("review");
              }}
              onWords={() => setView("words")}
              onReviewNote={(id) => {
                setReviewNote(id);
                setView("review");
              }}
            />
          )}
          {view === "review" && <Review key={reviewNote ?? "all"} textId={reviewNote ?? undefined} />}
          {view === "profile" && <ProfilePage />}
          {view === "words" && <Words />}
        </div>

      </main>
    </>
  );
}
