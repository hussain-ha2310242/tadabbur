import type { WordInfo } from "./api";

const POS: Record<string, string> = {
  noun: "noun", verb: "verb", adj: "adjective", adjective: "adjective", adv: "adverb", prep: "preposition",
  conj: "conjunction", pron: "pronoun", part: "particle", det: "determiner", abbrev: "abbreviation",
  noun_prop: "name", pron_dem: "demonstrative", verb_pseudo: "verb",
};

/** The sentence, with the word as written marked in it. */
function Marked({ sentence, word }: { sentence: string; word?: string | null }) {
  const i = word ? sentence.indexOf(word) : -1;
  if (!word || i < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, i)}
      <mark>{word}</mark>
      {sentence.slice(i + word.length)}
    </>
  );
}

/** A word's details, the same in the reader and the deck: what it means here
 *  (and the set phrase it forms), then its family, forms and two examples in
 *  that same sense. */
export function WordDetails({
  info,
  pos,
  loading,
  error,
  sentence,
  word,
}: {
  info: WordInfo | null;
  pos?: string | null;
  loading?: boolean;
  error?: string | null;
  sentence?: string | null; // shown when the reader cannot already see it (the deck)
  word?: string | null;
}) {
  const type = pos ? POS[pos] ?? pos : null;
  const examples = info?.examples?.length ? info.examples : info?.example ? [info.example] : [];
  const here = info?.in_context?.trim();
  const showHere = !!here && here.toLowerCase() !== (info?.meaning ?? "").trim().toLowerCase();
  return (
    <div className="wd">
      {sentence && (
        <p className="wd-sentence ar" dir="rtl">
          <Marked sentence={sentence} word={word} />
        </p>
      )}
      {(showHere || info?.expression) && (
        <div className="wd-here">
          <span className="wd-lbl">here</span>
          <span className="wd-here-body">
            {info?.expression ? (
              <>
                <span className="ar wd-expr" dir="rtl">{info.expression.ar}</span>
                <span className="hand">{info.expression.en}</span>
              </>
            ) : (
              <span className="hand">{here}</span>
            )}
          </span>
        </div>
      )}
      {info?.meaning && (showHere || info?.expression) && (
        <div className="wd-row">
          <span className="wd-lbl">usually</span>
          <span className="hand">{info.meaning}</span>
        </div>
      )}
      {type && (
        <div className="wd-row">
          <span className="wd-lbl">type</span>
          <span>{type}</span>
        </div>
      )}
      {loading && !info && <p className="wd-dim">looking it up…</p>}
      {error && !info && <p className="wd-dim">{error}</p>}
      {examples.length > 0 && (
        <div>
          <div className="wd-lbl">examples</div>
          <ul className="wd-examples">
            {examples.map((x, i) => (
              <li key={i}>
                <span className="ar" dir="rtl">{x.ar}</span>
                <span className="hand">{x.en}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {info?.similar && info.similar.length > 0 && (
        <div>
          <div className="wd-lbl">similar</div>
          <ul className="wd-list">
            {info.similar.map((x, i) => (
              <li key={i}>
                <span className="ar">{x.word}</span>
                <span className="hand">{x.meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {info?.conjugation && Object.keys(info.conjugation).length > 0 && (
        <div>
          <div className="wd-lbl">forms</div>
          <ul className="wd-list">
            {Object.entries(info.conjugation).map(([k, v]) => (
              <li key={k}>
                <span className="ar wd-gold">{v}</span>
                <span className="ar wd-form-name">{k}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
