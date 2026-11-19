// Levuvo Mail manual: page design. Colours and radii follow the light theme in
// apps/web/src/styles/tokens.css; screenshots show the app in its default dark theme.
#let ink = rgb("#141414")
#let ink-2 = rgb("#3b3b3b")
#let muted = rgb("#5f5f5f")
#let border = rgb("#e3e3e3")
#let border-strong = rgb("#cfcfcf")
#let surface = rgb("#fafafa")
#let surface-2 = rgb("#f2f2f2")
#let warn-bg = rgb("#fff6df")
#let warn-text = rgb("#6b4a00")
#let warn = rgb("#855c00")

#let key(k) = box(
  fill: surface-2,
  stroke: 0.6pt + border-strong,
  radius: 3pt,
  inset: (x: 3.5pt, y: 0pt),
  outset: (y: 2.2pt),
  text(size: 0.86em, weight: "medium", fill: ink, k),
)
#let mono(t) = box(
  fill: surface-2,
  radius: 3pt,
  inset: (x: 3pt, y: 0pt),
  outset: (y: 2pt),
  text(font: ("DejaVu Sans Mono",), size: 0.8em, fill: ink-2, t),
)

// Screenshots float to the top or bottom of the page (placement: auto), so a tall image never
// leaves half a page empty, and they never split across pages.
// On the first page of a chapter a screenshot may only go to the bottom, never above the title:
// `opening` marks screenshots in a chapter's first section, the page check catches the rest.
#let shot(path, alt, caption, opening: false) = context figure(
  placement: if opening or query(heading.where(level: 1)).any(h => h.location().page() == here().page()) {
    bottom
  } else { auto },
  block(
    width: 88%,
    radius: 7pt,
    clip: true,
    stroke: 0.75pt + border-strong,
    image(path, width: 100%, alt: alt),
  ),
  caption: caption,
  kind: image,
  supplement: none,
  numbering: none,
)

#let callout(kind, label, body) = {
  let (bg, bar, fg) = if kind == "warn" { (warn-bg, warn, warn-text) } else { (surface-2, ink, ink) }
  block(
    width: 100%,
    fill: bg,
    radius: 6pt,
    inset: (left: 14pt, right: 12pt, y: 10pt),
    stroke: (left: 2.5pt + bar),
    breakable: false,
    text(fill: fg)[#strong(label) #body],
  )
}

// The logo as in the app's sidebar: the wordmark image followed by "mail." in heavy Inter.
#let logo(height: 10mm) = box(
  baseline: 0pt,
  {
    box(image("../assets/wordmark-dark.png", height: height, alt: "Levuvo Mail"))
    h(height * 0.1)
    box(text(size: height * 0.92, weight: 800, tracking: -0.02em, fill: ink, [mail#text(fill: muted)[.]]))
  },
)

#let chapter-title(it) = {
  pagebreak(weak: true)
  v(18mm)
  if it.numbering != none {
    text(size: 13pt, weight: "semibold", fill: muted, counter(heading).display("1"))
    v(2mm)
  }
  block(text(size: 28pt, weight: "bold", tracking: -0.4pt, hyphenate: false, it.body + "."))
  v(7mm)
}

#let manual(
  lang: "de",
  title: "",
  subtitle: "",
  version: "",
  date: "",
  toc-title: "",
  running: "",
  motto: "Less effort. More impact.",
  cover-shot: none,
  cover-alt: "",
  body,
) = {
  set document(title: "Levuvo Mail – " + title, author: "Levuvo Mail", keywords: ("Levuvo Mail", title))
  set text(font: ("Inter",), size: 10.2pt, lang: lang, fill: ink, hyphenate: true, number-type: "lining")
  set par(leading: 0.68em, spacing: 1.05em, justify: false)
  set page(
    paper: "a4",
    margin: (top: 26mm, bottom: 24mm, inside: 24mm, outside: 22mm),
    header: context {
      let p = here().page()
      if p <= 2 { return }
      let starts = query(heading.where(level: 1)).filter(h => h.location().page() == p)
      if starts.len() > 0 { return }
      let before = query(heading.where(level: 1)).filter(h => h.location().page() < p)
      let current = if before.len() > 0 { before.last() } else { none }
      set text(size: 8pt, fill: muted)
      grid(
        columns: (1fr, auto),
        [Levuvo Mail · #running],
        if current != none { current.body },
      )
      v(-1.5mm)
      line(length: 100%, stroke: 0.5pt + border)
    },
    footer: context {
      let p = here().page()
      if p <= 1 { return }
      set text(size: 8pt, fill: muted)
      align(center, counter(page).display("1"))
    },
  )
  // Chapters and sections are numbered ("2.3"); the unnumbered welcome chapter keeps its
  // sections unnumbered too.
  set heading(numbering: (..n) => {
    let n = n.pos()
    if n.len() <= 2 and n.first() > 0 { numbering("1.1", ..n) }
  })
  show heading.where(level: 1): chapter-title
  show heading.where(level: 2): it => {
    v(5mm, weak: true)
    block(sticky: true, below: 3.2mm, text(size: 15pt, weight: "bold", tracking: -0.2pt, context {
      if it.numbering != none and counter(heading).get().first() > 0 {
        text(fill: muted, counter(heading).display("1.1")) + h(7pt)
      }
      it.body
    }))
  }
  show heading.where(level: 3): it => {
    v(5mm, weak: true)
    block(sticky: true, below: 2.6mm, text(size: 11.2pt, weight: "semibold", it.body))
  }
  show heading: set text(hyphenate: false)
  show strong: set text(weight: "semibold")
  show link: it => underline(stroke: 0.5pt + border-strong, offset: 2pt, it)
  set list(indent: 2pt, body-indent: 7pt, spacing: 0.75em, marker: text(fill: muted, sym.bullet))
  set enum(indent: 2pt, body-indent: 7pt, spacing: 0.75em, numbering: n => text(weight: "semibold", str(n) + "."))
  show figure: set block(breakable: false)
  set place(clearance: 7mm)
  show figure.caption: it => {
    v(1mm)
    text(size: 8.6pt, fill: muted, it.body)
  }
  set table(
    stroke: (x, y) => (
      top: if y == 0 { none } else if y == 1 { 0.9pt + ink } else { 0.5pt + border },
    ),
    inset: (x: 6pt, y: 6.5pt),
    align: left + top,
  )
  show table.cell.where(y: 0): set text(weight: "semibold", size: 9pt)
  show table: set text(size: 9.4pt)
  show table: it => block(width: 100%, above: 4mm, below: 5mm, it)

  // ---- Cover ----
  page(margin: (x: 22mm, top: 24mm, bottom: 20mm), header: none, footer: none, {
    logo(height: 11mm)
    v(1fr)
    text(size: 38pt, weight: "bold", tracking: -0.8pt, title + ".")
    v(3mm)
    block(width: 85%, text(size: 13pt, fill: muted, hyphenate: false, subtitle))
    v(10mm)
    if cover-shot != none {
      block(radius: 9pt, clip: true, stroke: 0.75pt + border-strong, image(cover-shot, width: 100%, alt: cover-alt))
    }
    v(1fr)
    grid(
      columns: (1fr, auto),
      text(size: 9pt, fill: muted)[#version · #date],
      text(size: 9pt, weight: "semibold", motto),
    )
  })

  // ---- Contents ----
  page(header: none, {
    v(18mm)
    block(text(size: 28pt, weight: "bold", tracking: -0.4pt, toc-title + "."))
    v(6mm)
    set text(size: 9.6pt)
    set par(leading: 0.55em)
    show outline.entry: set block(spacing: 0.62em)
    show outline.entry.where(level: 1): it => {
      v(3.2mm, weak: true)
      text(weight: "semibold", it)
    }
    outline(title: none, depth: 2, indent: 1.4em)
  })

  body
}
