# Kashf Translation Style Contract v1

Status: benchmark contract. This document does not change the production prompt.

## 1. Live first-read comprehension

Kashf translates for Dutch-speaking mosque visitors, approximately teenage through adult reading level. The language must be direct, natural and clear without becoming childish or simplistic.

> If a normal Dutch reader must reread the sentence to understand its structure, the live translation has failed.

The reader should understand the subject, action and logical connection on the first reading while the khutbah continues.

## 2. Natural spoken Dutch

Translate meaning and intent, not Arabic word order or rhetorical structure. Write as a skilled Dutch interpreter would speak live. Introduce the subject early, avoid postponing the finite verb, prefer short main clauses and use few subordinate clauses. A long Arabic sentence may become two or three natural Dutch sentences. Make a logical connection explicit only when it is present in the source.

Avoid rigid book language, literal parallel structures, unclear pronouns and unnatural passive constructions.

## 3. Faithfulness without unnecessary paraphrase

Natural syntax is not permission to summarize, omit religious content, add explanations, invent tafsir, alter imagery or clarify theological claims independently. Preserve every supported claim and relationship. Rewrite syntax, not meaning. Never add content the speaker did not say.

Kashf should be accessible but not flat. For example:

- Too literal: `Het doen herleven van het hart dat dood was.`
- Too free: `Dhikr maakt je weer helemaal goed.`
- Desired style: `Dhikr brengt een dood of achteloos hart weer tot leven.`

This is a style illustration only; words absent from the source must not be introduced.

## 4. Em-dash policy

The em dash (`—`) is prohibited in normal live translation by default. Target: `emDashCount = 0` and `emDashPer100Words = 0`.

Do not use em dashes for honorifics, parenthetical clauses, Arabic rhetorical insertions, explanations, quotations, names or titles. Restructure with a normal sentence, comma, colon or full stop. An em dash is allowed only in the exceptional case where it demonstrably produces more natural Dutch than these alternatives.

Every em dash is a presentation/readability review warning. More than two em dashes per 100 words is a presentation-failure candidate, never by itself a religious or meaning hard failure.

## 5. Honorifics and Islamic house style

Use one consistent standard, only when identity and context support it:

- Allah: `Allah ﷻ`. Never `Allah ﷺ`, `Allah عليه السلام` or varying literal Dutch parenthetical formulas.
- Prophet Muhammad: first clear relevant mention `de Profeet Muhammad ﷺ`; later, where natural, `de Profeet ﷺ`. Avoid mechanical repetition.
- Other prophets: for example `Musa عليه السلام` and `Ibrahim عليه السلام`.
- Companions: for example `Abu Bakr رضي الله عنه` when context supports the identity.
- Deceased scholars: for example `Ibn al-Qayyim رحمه الله`.

Never attach an honorific to the wrong person or use an honorific in a way that makes the sentence ambiguous. Replace `Allah — verheven zij Zijn vermelding — zei:` with `Allah ﷻ zegt:`. Replace `Ibn al-Qayyim — Allah zij barmhartig voor hem — zei:` with `Ibn al-Qayyim رحمه الله zei:`.

## 6. Islamic terms

Preferred recognizable terms are `dhikr`, `salah`, `shaytan`, `khutbah` and `imam`. Use them consistently within a session. If an Arabic term would probably be unclear without context, use its natural Dutch meaning when that preserves the source. Do not alternate transliterations arbitrarily.

## 7. Qur'an

Recognizable Qur'an quotations require stricter meaning fidelity than ordinary imam commentary. Do not freely paraphrase, add tafsir or invent content. Preserve recognizable meaning while producing grammatical Dutch. Keep the quotation distinct from the imam's explanation; the explanation may use substantially more natural spoken Dutch syntax.

If uncertain whether text is Qur'an, do not invent a surah, ayah or attribution.

## 8. Hadith

Preserve hadith meaning, do not add content, and never invent chains or names. Keep the hadith text grammatically separate from the imam's following explanation. Do not merge the end of a hadith with commentary into one sentence.

## 9. Arabic, Darija and code-switching

Apply this contract to MSA, classical/religious Arabic, Moroccan Darija, mixed Arabic/Darija and French loanwords in Darija. Produce one coherent Dutch passage. Do not announce language switching or explain that a word is French unless that is part of what the imam says.

## 10. Translationese warning signals

Treat these as review signals in context, not absolute word bans:

- `daaruit voortvloeit` and similar abstract continuations;
- `tot aan de genoemde`;
- `de voortreffelijkheid van`;
- `verheven zij Zijn vermelding`;
- excessive `inderdaad` or `waarlijk`;
- nominalizations such as `het doen herleven van`;
- literal Arabic parallel structures;
- sentences with several nested subordinate clauses;
- unnatural passive constructions;
- unclear references such as `ervan`, `daaruit` and `hetgeen` without an immediately clear antecedent.

## 11. Sentence structure

Aim for one clear thought per sentence. A long Arabic sentence may become two or three Dutch sentences without semantic truncation. Avoid three or more nested clauses and structures where the subject becomes clear only after many words. Sentence metrics are review indicators, not permission to omit content.

## 12. No meta output

Output only the translation. Never expose analysis, uncertainty commentary, refusal text, `the Arabic says`, `a more natural translation would be`, or other model commentary. If reliable translation is not possible, follow the existing `NO_TRANSLATION` or empty-output safety behavior.

## Benchmark acceptance targets

- Mean `FIRST_READ_COMPREHENSION` at least 8.5/10.
- No serious case below 7/10 without review.
- Mean Dutch naturalness at least 8/10.
- Mean meaning fidelity at least 8/10.
- Religious integrity at least 9/10 for religious fixtures.
- Target em-dash use: zero per 100 words.

