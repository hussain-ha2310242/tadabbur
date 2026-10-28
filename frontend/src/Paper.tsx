/** The shared paper: the filter that roughens a sheet's edge (render once per
 *  page) and the aged sheet itself, drawn behind a page's content. */

export function PaperDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <filter id="deckle" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="9" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

/** The sheet as a manuscript page: an aged SVG paper with faint margin rules.
 *  The filter gives it a rough, hand-torn edge. Decoration only. */
export function PaperSheet() {
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
