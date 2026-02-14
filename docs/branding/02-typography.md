# Animus: Typography

## Type System

### Primary Sans-Serif — Outfit

The primary typeface for all UI, body copy, headings, navigation, and product communications. Outfit is a geometric sans-serif with rounded, open forms that carry inherent warmth. Its single-story 'a', soft shoulders, and generous letterwidth give it an approachable quality that aligns with the Animus brand — alive, warm, never clinical.

**Source:** Google Fonts (free, open source)
**Weights:** 200 (ExtraLight) through 700 (Bold)
**Fallback stack:** `'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

#### Weight usage

| Weight | Name | Usage |
|--------|------|-------|
| 200 | ExtraLight | Reserved — large decorative display only |
| 300 | Light | Display headlines, hero text |
| 400 | Regular | Body copy, default text |
| 500 | Medium | Emphasis, subheadings, UI labels |
| 600 | SemiBold | Headings, card titles, primary UI elements |
| 700 | Bold | Sparingly — maximum emphasis only |

#### Sizing scale

| Token | Size | Usage |
|-------|------|-------|
| xs | 12px / 0.75rem | Fine print, timestamps, metadata |
| sm | 14px / 0.875rem | Captions, secondary UI text |
| base | 16px / 1rem | Body copy, default |
| lg | 18px / 1.125rem | Lead paragraphs, emphasized body |
| xl | 20px / 1.25rem | Section headings (H3) |
| 2xl | 24px / 1.5rem | Page headings (H2) |
| 3xl | 30px / 1.875rem | Major headings (H1) |
| 4xl | 36px / 2.25rem | Display text |
| 5xl | 48px / 3rem | Hero headlines |

---

### Display Serif — Crimson Pro

The secondary typeface, reserved for editorial and display contexts. Crimson Pro is a refined serif with higher contrast than traditional book faces, giving it a modern quality while retaining deep warmth. It creates beautiful tension against Outfit — sophistication meeting approachability.

**Source:** Google Fonts (free, open source)
**Weights:** 300 through 700 (variable)
**Italic:** Full italic range available
**Fallback stack:** `'Crimson Pro', Georgia, 'Times New Roman', serif`

#### Usage contexts

- Hero headlines on marketing pages
- Editorial/long-form content headers
- Pull quotes and callouts
- Display moments where the brand needs gravitas
- **Not used in:** product UI, navigation, buttons, form labels

#### Sizing

Crimson Pro should generally be set 10–15% larger than equivalent Outfit text at the same hierarchy level, as its narrower letterforms and higher contrast benefit from additional size.

---

### Monospace — JetBrains Mono

For code blocks, terminal output, technical contexts, and data displays.

**Source:** Google Fonts / JetBrains
**Fallback stack:** `'JetBrains Mono', 'Fira Code', Consolas, monospace`
**Weights:** 400 (Regular), 700 (Bold)

---

## Wordmark

The Animus wordmark is set in **lowercase Outfit** at regular (400) or light (300) weight. The lowercase treatment communicates approachability and quiet confidence — it doesn't need to shout.

- Always lowercase: `animus`
- Never capitalized: ~~Animus~~, ~~ANIMUS~~
- Letter-spacing: -0.02em (slight tightening at display size)
- The wordmark may appear alongside the symbol or independently

---

## Pairing Rules

### Outfit + Crimson Pro

The primary pairing. Crimson Pro handles display/headline moments; Outfit carries everything else.

**How they work together:**
- Crimson Pro at display scale creates the emotional hook — it draws you in
- Outfit at heading/body/UI scale delivers with warmth and clarity
- The contrast between serif elegance and sans openness creates visual interest
- Both share warmth as a foundational quality, so they never feel disconnected

**Do:**
- Use Crimson Pro for the first thing someone reads on a page (hero headline)
- Transition to Outfit for subheadings and body
- Let the two faces create a clear hierarchy through contrast

**Don't:**
- Mix Crimson Pro and Outfit at the same size/weight in adjacent elements
- Use Crimson Pro for UI elements (buttons, labels, navigation)
- Set Crimson Pro below 18px — it loses its beauty at small sizes

---

## Line Height & Spacing

| Context | Line height |
|---------|-------------|
| Display / Hero | 1.1–1.15 |
| Headings | 1.25–1.3 |
| Body copy | 1.6–1.7 |
| UI text | 1.4–1.5 |
| Captions | 1.4 |

Body text should breathe. Generous line height reinforces the brand's feeling of spaciousness and calm.

---

## Implementation Notes

### Google Fonts import
```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500;600;700&family=Crimson+Pro:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### CSS custom properties
```css
:root {
  --font-sans: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-serif: 'Crimson Pro', Georgia, 'Times New Roman', serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
}
```
