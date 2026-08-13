# Design notes

Free-form design intent and decisions — the "why" behind the UI, not the
implementation. Visual references live in [references/](references/).

## Layout

- Mobile-first. Desktop should look and behave much like mobile, not a
  separate layout: a centered container with a fixed max width, rather than
  spreading out to fill wide viewports.

## Visual style

- Bold, vibrant, artistic — in the spirit of
  [Persona 5 Tactica](https://persona.atlus.com/p5t/)
  ([screenshot](references/p5t-website.png)): strong shapes, high-contrast
  compositions, graphic/comic-like flair.
- But with plain, flat colors — avoid the ornate red/black/gold treatment of
  [Persona 5 Royal](https://persona.atlus.com/p5r/?lang=en)
  ([screenshot](references/persona-5-golden-website.png)). No gold foil /
  filigree styling.

## Typography

- Bold, condensed, high-contrast display faces — see this
  [P5R font breakdown](references/p5-fonts.png) for the general idea (not a
  literal spec: skip anything paid/licensed, and we don't need the gold/red
  P5R coloring).
- For hand-lettered-style titles (main menu items, headers), mix 3-5 fonts
  and swap between them per letter rather than picking one font for
  everything.
- Concrete candidate: [Earwig Factory](https://www.dafont.com/earwig-factory.font)
  — bold, jagged, comic-lettering style. Free for personal use; check
  licensing before shipping.
- No need or want to replicate the P5 fonts specifically — they're just an
  example of fonts that work well in a high-contrast design. Use them, or
  any other fonts with a similar bold/condensed/high-contrast feel.
