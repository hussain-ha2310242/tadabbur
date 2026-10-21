"""What counts as a word in a saved text, in one place.

A text is stored as sentences of tokens (see nlp/camel.py). Punctuation and
digits are tokens too, but they are not words to learn.
"""


def is_word(token: dict) -> bool:
    return bool(token.get("lemma_key")) and token.get("pos") not in ("punc", "digit")


def word_keys(sentences: list[dict]) -> set[str]:
    """The distinct words (lemma keys) in a text."""
    return {t["lemma_key"] for s in sentences for t in s["tokens"] if is_word(t)}
