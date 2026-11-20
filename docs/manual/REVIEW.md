# Pre-release manual review

Before every release, someone who did **not** write the changes reads the manual as a first-time user
and checks it against the app and the feature registry. The automatic checks
(`npm run manual:features`, `apps/web/test/manual-features.test.mjs`) prove that every feature has a
section and that menu paths exist; they cannot tell whether the text is right, complete and
understandable. This review does.

## How to run it

1. Build the release candidate (`npm run build`), take the screenshots again
   (`npm run manual:screenshots`) and build the PDFs (`npm run manual:pdf`).
2. Give the reviewer, a person or a fresh AI session without the history of the changes, the prompt
   below, the two PDFs from `dist/manual/`, `docs/manual/features.json` and the `## Unreleased`
   section of `CHANGELOG.md`. An AI reviewer also gets the repository, so it can open the UI code
   and run the app.
3. Fix every finding marked **must** in `docs/manual/de` and `docs/manual/en` (both languages), build
   again and note the review in the release PR.

## Prompt for the reviewer

> You review the Levuvo Mail user manual before a release. You have never used Levuvo Mail. Read the
> German and the English PDF from start to end as a first-time user who wants to install the app, set
> up an email account and get work done.
>
> Check:
>
> 1. **Completeness:** every entry in the `Unreleased` section of the changelog is explained in the
>    manual section it names, in both languages. Every feature in `features.json` is explained in
>    its sections well enough that you could use it without help.
> 2. **Correctness:** every step, label, menu path, key and screenshot matches the app as it is
>    now. Labels are written exactly as the app shows them in that language.
> 3. **Understandable:** a non-technical reader can follow every step. Technical terms are explained
>    on first use or in the glossary. No step is missing.
> 4. **Consistency:** the German and English editions say the same; the product is always called
>    "Levuvo Mail"; the slogan "Less effort. More impact." is never translated.
> 5. **Layout and accessibility:** no half-empty pages, screenshots next to the text they belong to,
>    tables not split awkwardly, every screenshot has a meaningful caption, the PDF is tagged.
>
> Report each finding with: page and section, language (de/en/both), what is wrong, a proposed fix,
> and **must** (wrong, missing or misleading) or **should** (could be clearer). Finish with the three
> things a first-time user would most likely get stuck on.
