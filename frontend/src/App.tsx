import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import Library from "./views/Read";
import Review from "./views/Review";
import Words from "./views/Words";
import { ProfileChip, ProfilePage, StreakStar, useStats } from "./views/Profile";
import { Icon, type IconName } from "./icons";
import { useDockHeight, usePhone } from "./usePhone";
import { applyCardStyle, applyTextScale, applyTheme } from "./theme";
import { DeskSky } from "./DeskSky";
import { PaperDefs, PaperSheet } from "./Paper";
import { ClaudeHandoff } from "./Handoff";

type View = "library" | "review" | "profile" | "words";

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

/** The phone's tab bar: the four places of the app, always in thumb reach.
 *  Hidden while reading or reviewing, where the screen's foot holds those
 *  controls instead. */
function PhoneTabs({ view, go }: { view: View; go: (v: View) => void }) {
  const ref = useRef<HTMLElement>(null);
  useDockHeight(ref, true);
  const stats = useStats(view);
  const tab = (v: View, label: string, icon: IconName | null, extra?: React.ReactNode) => (
    <button
      className={`tab ${view === v ? "on" : ""}`}
      aria-current={view === v ? "page" : undefined}
      onClick={() => go(v)}
    >
      <span className="tab-icon">
        {icon ? <Icon name={icon} size={22} /> : extra}
        {v === "review" && stats && stats.due > 0 && <span className="tab-badge">{stats.due > 99 ? "99+" : stats.due}</span>}
      </span>
      <span className="tab-label">{label}</span>
    </button>
  );
  return (
    <nav ref={ref} className="tabbar" aria-label="Sections" dir="ltr">
      {tab("library", "Read", "library")}
      {tab("review", "Deck", "cards")}
      {tab("words", "Words", "words")}
      {tab(
        "profile",
        stats?.streak.current ? `${stats.streak.current}-day` : "Me",
        null,
        <StreakStar lit={!!stats?.streak.today} size={21} />,
      )}
    </nav>
  );
}

export default function App() {
  const [view, setView] = useState<View>("library");
  // bumping this remounts the home view, which closes any text open in the reader
  const [homeKey, setHomeKey] = useState(0);
  // the deck opened from a note shows that note's cards only
  const [reviewNote, setReviewNote] = useState<number | null>(null);
  // a phone: tabs at the foot on the main pages, a back arrow while reading or reviewing
  const phone = usePhone();
  const [reading, setReading] = useState(false);
  const inside = (view === "library" && reading) || view === "review";
  const goHome = () => {
    setView("library");
    setHomeKey((k) => k + 1);
  };
  const go = (v: View) => {
    if (v === "library") goHome();
    else {
      if (v === "review") setReviewNote(null);
      setView(v);
    }
    window.scrollTo({ top: 0 });
  };

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
      <PaperDefs />
      <main className="sheet paper relative mx-auto my-2 min-h-[calc(100vh-1rem)] max-w-[min(72rem,calc(100vw-16px))] px-4 pb-24 pt-2 sm:my-8 sm:min-h-[calc(100vh-4rem)] sm:max-w-[min(72rem,calc(100vw-28px))] sm:px-10 sm:pt-6" dir="ltr">
        <PaperSheet />
        <ProfileChip onOpen={() => setView("profile")} refresh={view} />
        {/* the top row never changes: the name in the middle goes home, between two fading rules */}
        {phone && inside && (
          <button className="phone-back" onClick={goHome} aria-label="Back">
            <Icon name="prev" size={22} />
          </button>
        )}
        <div className="brand-row flex min-h-[3.5rem] items-center gap-5">
          <Kashida side="left" />
          <button
            onClick={goHome}
            className="brand ar flex-none text-center text-3xl sm:text-4xl"
            aria-label="Tadabbur, go home"
            title="Home"
            style={{ fontWeight: 400, lineHeight: 1.2, fontFamily: "'Rakkas', var(--font-ar)", color: "var(--fg)" }}
          >
            <span className="hl-under">تدبّر</span>
          </button>
          <Kashida side="right" />
        </div>

        <div className="mt-3 sm:mt-8">
          {view === "library" && (
            <Library
              key={homeKey}
              onReading={setReading}
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
      {phone && !inside && <PhoneTabs view={view} go={go} />}
      <ClaudeHandoff />
    </>
  );
}
