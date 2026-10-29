/** The sample article for the demo (and the product video): an original short
 *  text, with every word already analysed and every sentence translated. */

import { splitSentences, tokenize, type Sentence, type Token } from "./arabic";

export const TITLE = "صَباحٌ في المَكْتَبَة";
export const BODY =
  "ذهبت صباح اليوم إلى المكتبة القريبة من بيتي.\n" +
  "جلست بجانب النافذة وفتحت كتابا عن تاريخ العلوم.\n" +
  "كان المكان هادئا، والشمس تدخل من النوافذ الكبيرة.\n" +
  "قرأت ثلاثة فصول، وكتبت الكلمات الجديدة في دفتري.\n" +
  "قبل الظهر رجعت إلى البيت، وأنا أشعر بالسعادة.";

export const SENTENCES_EN: Record<string, string> = {
  "0": "This morning I went to the library near my house.",
  "1": "I sat beside the window and opened a book about the history of science.",
  "2": "The place was quiet, and the sun came in through the big windows.",
  "3": "I read three chapters and wrote the new words in my notebook.",
  "4": "Before noon I went back home, feeling happy.",
};

// each word as written: [vowelled, dictionary form, root, part of speech, meaning]
const WORDS: Record<string, [string, string, string | null, string, string]> = {
  ذهبت: ["ذَهَبْتُ", "ذَهَبَ", "ذ ه ب", "verb", "went"],
  صباح: ["صَبَاحَ", "صَبَاح", "ص ب ح", "noun", "morning"],
  اليوم: ["اليَوْمِ", "يَوْم", "ي و م", "noun", "day (today)"],
  إلى: ["إِلَى", "إِلَى", null, "prep", "to"],
  المكتبة: ["المَكْتَبَةِ", "مَكْتَبَة", "ك ت ب", "noun", "library"],
  القريبة: ["القَرِيبَةِ", "قَرِيب", "ق ر ب", "adj", "near"],
  من: ["مِنْ", "مِن", null, "prep", "from"],
  بيتي: ["بَيْتِي", "بَيْت", "ب ي ت", "noun", "house, home"],
  جلست: ["جَلَسْتُ", "جَلَسَ", "ج ل س", "verb", "sat"],
  بجانب: ["بِجَانِبِ", "جَانِب", "ج ن ب", "noun", "side; beside"],
  النافذة: ["النَّافِذَةِ", "نَافِذَة", "ن ف ذ", "noun", "window"],
  وفتحت: ["وَفَتَحْتُ", "فَتَحَ", "ف ت ح", "verb", "opened"],
  كتابا: ["كِتَابًا", "كِتَاب", "ك ت ب", "noun", "book"],
  عن: ["عَنْ", "عَن", null, "prep", "about"],
  تاريخ: ["تَارِيخِ", "تَارِيخ", "أ ر خ", "noun", "history"],
  العلوم: ["العُلُومِ", "عِلْم", "ع ل م", "noun", "science"],
  كان: ["كَانَ", "كَانَ", "ك و ن", "verb", "was"],
  المكان: ["المَكَانُ", "مَكَان", "ك و ن", "noun", "place"],
  هادئا: ["هَادِئًا", "هَادِئ", "ه د أ", "adj", "quiet"],
  والشمس: ["وَالشَّمْسُ", "شَمْس", "ش م س", "noun", "sun"],
  تدخل: ["تَدْخُلُ", "دَخَلَ", "د خ ل", "verb", "enter"],
  النوافذ: ["النَّوَافِذِ", "نَافِذَة", "ن ف ذ", "noun", "window"],
  الكبيرة: ["الكَبِيرَةِ", "كَبِير", "ك ب ر", "adj", "big"],
  قرأت: ["قَرَأْتُ", "قَرَأَ", "ق ر أ", "verb", "read"],
  ثلاثة: ["ثَلَاثَةَ", "ثَلَاثَة", "ث ل ث", "noun", "three"],
  فصول: ["فُصُولٍ", "فَصْل", "ف ص ل", "noun", "chapter"],
  وكتبت: ["وَكَتَبْتُ", "كَتَبَ", "ك ت ب", "verb", "wrote"],
  الكلمات: ["الكَلِمَاتِ", "كَلِمَة", "ك ل م", "noun", "word"],
  الجديدة: ["الجَدِيدَةَ", "جَدِيد", "ج د د", "adj", "new"],
  في: ["فِي", "فِي", null, "prep", "in"],
  دفتري: ["دَفْتَرِي", "دَفْتَر", "د ف ت ر", "noun", "notebook"],
  قبل: ["قَبْلَ", "قَبْل", "ق ب ل", "adv", "before"],
  الظهر: ["الظُّهْرِ", "ظُهْر", "ظ ه ر", "noun", "noon"],
  رجعت: ["رَجَعْتُ", "رَجَعَ", "ر ج ع", "verb", "returned"],
  البيت: ["البَيْتِ", "بَيْت", "ب ي ت", "noun", "house, home"],
  وأنا: ["وَأَنَا", "أَنَا", null, "pron", "(and) I"],
  أشعر: ["أَشْعُرُ", "شَعَرَ", "ش ع ر", "verb", "feel"],
  بالسعادة: ["بِالسَّعَادَةِ", "سَعَادَة", "س ع د", "noun", "happiness"],
};

const dediac = (s: string) => s.replace(/[ً-ْٰـ]/g, "");

export function article(): Sentence[] {
  return splitSentences(BODY).map((text) => ({
    text,
    tokens: tokenize(text).map((t): Token => {
      const w = WORDS[t.word];
      if (!w) return t;
      const [diac, lemma, root, pos, gloss] = w;
      return { word: t.word, diac, lemma, lemma_key: dediac(lemma), root, pos, gloss };
    }),
  }));
}
