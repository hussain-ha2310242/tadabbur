# Content authoring guide

This directory is the source of truth for all learning content. The app never
generates content at runtime - files here are loaded into SQLite by
`python -m app.seed` (idempotent; rerun after every edit).

**Workflow:** edit files here (usually via Claude Code) → review the diff →
commit → reseed. Every generated item gets git review.

## Ground rules

- **Terminology:** use Qatar University / classical nahw terms exactly:
  نائب الفاعل، المبتدأ، الخبر، الحال، التمييز، التوابع، المنصوبات - never
  translated or paraphrased grammar labels inside Arabic text.
- **Vocalization:** all Arabic lesson text and examples fully vocalized
  (tashkeel). Vocalization correctness is the #1 review criterion.
- **IDs:** kebab-case, stable forever once committed (they key SQLite rows,
  FSRS state, and attempt logs). Never rename an id; add a new one.
- **Difficulty:** 1–5. 1 = recognition, 3 = production with support,
  5 = unprompted production.
- **Vocab discipline:** exercises for lesson N may only use lemmas from
  lessons 1..N (cumulative). The seed validator re-analyzes exercise text
  with CAMeL Tools and flags out-of-vocab lemmas - fix flagged items.

## Schema: rules (`rules/*.yaml`, one file per rule)

```yaml
id: hal                     # kebab-case, matches filename
name_ar: الحال
group: المنصوبات            # rule family, drives the progress heatmap
definition_ar: اسم منصوب يبين هيئة الفاعل أو المفعول به حين وقوع الفعل
examples:
  - ar: أَقْبَلَ المَظْلُومُ باكِيًا
    target: باكِيًا          # the word the rule applies to
confusions: [tamyiz, maful-liajlih]   # rule ids; drives distractor generation
sources: [qu100, madina-b2-l19]       # provenance in sources/
```

## Schema: lessons (`lessons/<series>/<book>/lessonNN.yaml`)

```yaml
title_ar: ...
text_ar: |          # full lesson text, fully vocalized
  ...
vocab:
  - lemma: بَيْت     # vocalized lemma (CAMeL lex form)
    root: بيت
    gloss: house
grammar_points: [mubtada, khabar]   # rule ids introduced here
audio: madina/b1-l04.mp3            # official MP3 if present, else TTS fallback
```

## Schema: exercises (`exercises/<lesson-or-rule-id>.json`)

One JSON array per file. Each item has `type`, `difficulty` (1–5), and
type-specific fields. All feedback text (`why_ar`) in Arabic.

```json
[
  {"type": "mcq", "rule": "mubtada", "q_ar": "...", "options": ["الفاعل", "المبتدأ", "الخبر"], "answer": 1, "why_ar": "...", "difficulty": 2},
  {"type": "gap_connector", "text_ar": "... ___ ...", "options": ["لكنّ", "لأنّ"], "answer": 0, "difficulty": 2},
  {"type": "tashkeel", "sentence_ar": "فتح الولد الباب", "target_word": "الباب", "answer": "َ", "difficulty": 3},
  {"type": "transform", "prompt_ar": "أدخل إنّ على الجملة", "given": "البيتُ نظيفٌ", "answer": "إنّ البيتَ نظيفٌ", "difficulty": 4},
  {"type": "self_assess", "prompt_ar": "اكتب تعليقًا...", "rubric_ar": ["..."], "model_answer_ar": "...", "difficulty": 5}
]
```

- `answer` is a 0-based index for option types; a string for exact-match types.
- All types except `self_assess` are graded deterministically by the backend.
- **Distractors:** for rule MCQs, pull wrong options from the rule's
  `confusions` list first - those are the confusions worth training.

## Directories

- `rules/` - ~40 grammar rule files (schema above)
- `lessons/` - Madina series lesson files
- `exercises/` - one JSON file per lesson or rule
- `vocab/` - glossary, connector/phrase lists
- `sources/` - reference PDFs (gitignored, read-only provenance)
