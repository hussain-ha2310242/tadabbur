"""Thin wrapper around CAMeL Tools: contextual lemma/root/POS per token."""

from functools import lru_cache

from camel_tools.disambig.mle import MLEDisambiguator
from camel_tools.tokenizers.word import simple_word_tokenize
from camel_tools.utils.dediac import dediac_ar


@lru_cache(maxsize=1)
def _disambiguator() -> MLEDisambiguator:
    # ~few seconds to load; cached for the process lifetime
    return MLEDisambiguator.pretrained()


def analyze_text(text: str) -> list[dict]:
    tokens = simple_word_tokenize(text)
    if not tokens:
        return []

    result = []
    for da in _disambiguator().disambiguate(tokens):
        a = da.analyses[0].analysis if da.analyses else {}
        lemma = a.get("lex") or da.word
        # CAMeL writes roots dot-separated; learners see space-separated
        root = a.get("root")
        # '#' marks a weak/hamza radical: keep the root, show the radical as a
        # tatweel gap so the root is still usable (was dropped before)
        root = root.replace("#", "\u0640").replace(".", " ").strip() if root else None
        root = root or None
        result.append(
            {
                "word": da.word,
                "diac": a.get("diac") or da.word,
                "lemma": lemma,
                # dediacritized lemma - the stable key for wallet/word-state lookups
                "lemma_key": dediac_ar(lemma),
                "root": root,
                "pos": a.get("pos"),
                "gloss": a.get("gloss"),
            }
        )
    return result
