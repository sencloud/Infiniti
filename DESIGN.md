---
name: 无限连接 INFINITI · 关系式学习助手
description: Ink on warm rice paper with one vermilion seal; every relation leads back to the original passage.
colors:
  vermilion: "#b23a26"
  vermilion-soft: "rgba(178, 58, 38, 0.07)"
  vermilion-wash: "rgba(178, 58, 38, 0.14)"
  vermilion-line: "rgba(178, 58, 38, 0.35)"
  on-vermilion: "#ffffff"
  indigo: "#3c5a78"
  indigo-wash: "rgba(60, 90, 120, 0.1)"
  gold: "#a87614"
  pine: "#2f7d5d"
  rice-paper: "#f4f2ec"
  paper: "#fdfcf9"
  paper-2: "#f9f7f1"
  panel: "rgba(253, 252, 249, 0.96)"
  ink: "#272c34"
  ink-2: "#5b6472"
  ink-3: "#8d95a2"
  rule: "rgba(39, 44, 52, 0.13)"
  rule-2: "rgba(39, 44, 52, 0.07)"
  well: "rgba(39, 44, 52, 0.045)"
  mark: "rgba(214, 170, 60, 0.28)"
  mark-strong: "rgba(214, 150, 40, 0.5)"
  cloth-literature: "#3c5a78"
  cloth-classics: "#6b4a2b"
  cloth-subject: "#2f6d5a"
  cloth-people: "#8a2f20"
typography:
  display:
    fontFamily: "Georgia, 'Songti SC', 'STSong', 'SimSun', serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: 1.28
    letterSpacing: "0.04em"
  headline:
    fontFamily: "Georgia, 'Songti SC', 'STSong', 'SimSun', serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
  title:
    fontFamily: "Georgia, 'Songti SC', 'STSong', 'SimSun', serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.06em"
  reading:
    fontFamily: "Georgia, 'Songti SC', 'STSong', 'SimSun', serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 2
  body:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  numeric:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    fontFeature: "'tnum'"
rounded:
  tag: "4px"
  control: "8px"
  tile: "10px"
  card: "12px"
  sheet: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.on-vermilion}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-ghost:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  button-evidence:
    backgroundColor: "{colors.vermilion-soft}"
    textColor: "{colors.vermilion}"
    rounded: "{rounded.control}"
    padding: "7px 8px 7px 11px"
  icon-button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.tile}"
    size: "44px"
  search-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    height: "50px"
    padding: "0 14px"
  segmented:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.card}"
    height: "36px"
  segmented-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.vermilion}"
    rounded: "{rounded.control}"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
  relation-tag:
    backgroundColor: "{colors.vermilion-soft}"
    textColor: "{colors.vermilion}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "12px"
  bottom-sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
  reader-page:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.reading}"
    rounded: "{rounded.card}"
    padding: "16px 16px 28px"
---

# Design System: 无限连接 INFINITI

## Overview

**Creative North Star: "The Annotated Classic"**

The interface is a well-kept study copy of a classic text: warm rice paper, ink-gray type, and one vermilion seal colour that marks what you act on or what is currently selected. Structure comes first (shelf, graph, star map), and every relation in it opens a page of the original text where the passage is highlighted as if marked with a gold highlighter. Book covers are drawn as thread-bound cloth with a vertical title slip. The brand mark is a pair of interlocking rings.

Density is calm on mobile and moderate on desktop panels. Surfaces are translucent paper over a softly mottled background (`.paper-nebula`, three faint radial washes in indigo, vermilion and gold). Depth is quiet. Serif type carries everything a reader reads (titles, entity names, quoted evidence, chapter text), and sans carries everything a user operates (controls, meta, counts).

The light and dark themes are a single system. Every value is a CSS variable on `<html data-theme>` in `web/src/theme/theme.css`, mirrored for canvases in `web/src/theme/palette.ts` and for antd in `ThemeProvider.tsx`. The graph module aliases these as `--kg-*` in `KnowledgeGraph/tokens.css` and never introduces new hues.

**Key Characteristics:**
- Warm paper neutrals with one vermilion accent; indigo and gold are supporting roles, not decoration.
- Serif for reading and naming, sans for operating.
- Hairline borders (1px `rule`) and soft two-layer shadows; no heavy chrome.
- Mobile is first-class: bottom sheets, a full-screen reader, 44px targets, 16px+ reading text.
- Evidence is visual: gold highlight marks, an indigo underline for the focused entity, and relation tags in vermilion.

## Colors

The palette is restrained: paper and ink neutrals carry about 90% of every screen, and vermilion appears only where the user should act or where they are now.

### Primary
- **Seal Vermilion** (`vermilion`): primary buttons (搜索, 看知识网, 下一处), active tab and segment text, the active underline, the vermilion character in the wordmark and hero, focus borders on search. Its tints have fixed jobs. **Vermilion Soft** is the hover/pressed fill and the relation-tag fill. **Vermilion Wash** is a focus halo. **Vermilion Line** is the border of the "看原文" evidence button and of hovered cards. Dark theme lifts it to `#d96a4f`, with ink-dark text on it.

### Secondary
- **Study Indigo** (`indigo`): the second brand ring, the focused-entity underline in the reader (`inset 0 -2px 0` plus `indigo-wash`), antd `colorInfo`, and the literature book cloth. Never used for a call to action.

### Tertiary
- **Highlighter Gold** (`gold`, `mark`, `mark-strong`): evidence highlights in the original text. `mark` for every passage that supports the relation, `mark-strong` for the passage currently being stepped to. Gold also marks rank/importance in the graph (`--kg-rank`).
- **Pine** (`pine`): a node colour in the brand mark, plus the live-status dot. Not a UI colour.

### Neutral
- **Rice Paper** (`rice-paper`): page background and the browser `theme-color`.
- **Paper / Paper 2** (`paper`, `paper-2`): solid surfaces (sheets, drawers, reader page) and the desktop reading well.
- **Panel** (`panel`): translucent paper for cards, top bars and controls that sit over the mottled background or the graph canvas.
- **Ink** (`ink`): headings, names, reading text.
- **Ink 2** (`ink-2`): meta text, counts, secondary labels, inactive tabs. About 5.3:1 on rice paper.
- **Ink 3** (`ink-3`): placeholders, disabled states and decorative icons only. About 2.7:1 on rice paper, so it fails as text.
- **Rule / Rule 2 / Well** (`rule`, `rule-2`, `well`): 1px borders, in-list dividers, and recessed fills (segmented track, pressed state).
- **Book Cloth** (`cloth-*`): cover fills for typeset covers, one per material category (literature, classics, subject, people). Dimmed with `brightness(0.82)` in dark theme.

The graph cluster palette (15 ink-pigment hues: vermilion, indigo, pine, ochre-gold, rosewood, stone-blue…) lives in `clusterPalette()` and is only for nodes and clusters.

### Named Rules
**The Single Seal Rule.** Vermilion is for the primary action and the active state. One filled vermilion button per view. Everything else that is clickable is ghost, soft-tinted, or plain text.

**The Ink-2 Floor Rule.** Any text a user must read is `ink-2` or darker (≥4.5:1). `ink-3` is for placeholders, disabled controls and decorative glyph strokes only.

**The No New Hues Rule.** New surfaces use the theme variables (or `--kg-*` aliases). Hard-coded hex or slate `rgba(15, 23, 42, …)` values are legacy, not precedent.

## Typography

**Display Font:** Georgia with Songti SC / STSong / SimSun (system serif stack)
**Body Font:** PingFang SC / Microsoft YaHei / system-ui
**Label/Mono Font:** Consolas / SF Mono (only the desktop brand subline)

**Character:** A printed-book serif for anything you read or name, beside a neutral UI sans for anything you tap. Chinese headings get generous tracking (0.04–0.12em) instead of size jumps.

### Hierarchy
- **Display** (700, 44px desktop / 34px mobile, 1.28): home hero only. Left-aligned on mobile with one vermilion phrase.
- **Headline** (700, 21–24px, 1.2): section heads (读一本书 / 学一门课), the entity name in the bottom sheet (24px), mobile top-bar material title (19px).
- **Title** (700, 16–18px, 1.3): card and shelf titles, the relation context pair in the reader (18px), drawer titles (17px).
- **Reading** (400, 17px / 2.0 mobile; 15px / 1.95 desktop): original-text pages. Quoted evidence in cards and sheets is serif 15–16px at 1.75–1.8.
- **Body** (400, 15px, 1.65): taglines, import prompts, list names (16px, 600 in sheet rows). Inputs are 16px on mobile so iOS does not zoom.
- **Label** (400, 12–13px, `ink-2`): meta lines, counts, confidence, chapter hints. Numbers use tabular figures with the count in `ink` and 600 weight (`1,590 条原文依据`).

### Named Rules
**The Reader's Serif Rule.** Headings, entity names, quoted evidence and chapter text are serif. Controls, tabs, buttons and meta are sans. A serif button or a sans chapter page is wrong.

**The No Eyebrow Rule.** No small uppercase or tracked kicker labels above headings. A heading stands alone; context goes in a meta line under it or in the heading's own baseline row.

## Layout

Breakpoint: mobile is `≤768px` (`useIsMobile`, CSS `@media (max-width: 768px)`), with a secondary `≤420px` step that collapses top-bar tab labels to icons and a `≤1100px` step that trims desktop app-bar stats.

- **Home, desktop:** centered hero (max 760px), card grid in a 1180px container, `repeat(auto-fill, minmax(340px, 1fr))`, 18px gaps, 28px gutters.
- **Home, mobile:** single column with 16px gutters. Order: brand row, left-aligned hero, 50px search, the three-step strip (numbered pills), a horizontally scroll-snapped bookshelf (128px books, the next book half-visible), course rows, free-explore rows, and a dashed import card. Sections are 30px apart.
- **Graph shell:** full-height (`100dvh`) column with a 54px desktop app bar (brand, underline tabs, stats). Mobile replaces it with a 52px row (back 44px · centered title dropdown · theme toggle) above a full-width three-part segmented control (关系 / 星图 / 线索), honouring `safe-area-inset-top`.
- **Explore canvas:** the canvas fills the shell. Search and actions float at the top (10px inset on mobile). Desktop detail cards float right (264px). On mobile, every detail, analysis or locate panel becomes a bottom sheet (56–62% height, expandable to 92%). While a sheet is open the canvas shrinks to the upper half and auto-focuses a star view of the selected entity's neighbours.
- **Reader:** a desktop drawer with text and claims side by side (60/40). On mobile it is full-screen: header, relation context card, a single scrolling text page, and a footer stepper. Only the text page scrolls.
- **Spacing rhythm:** 4 / 8 / 12 / 16 / 28. Cards pad 12px on mobile and 16px on desktop. List rows are at least 62px tall with 18px leading inset.

### Named Rules
**The Thumb Rule.** On mobile every tappable target is at least 44×44px (back, close, icon buttons, sheet tabs, stepper at 48px). Primary navigation sits within thumb reach: segmented control at top, actions in sheets and footers.

## Elevation & Depth

The system uses a hybrid: hairline borders define every surface, and soft ambient shadows lift only floating things (cards over the background, search over the canvas, sheets over the graph). The background itself is never flat. A faint three-colour nebula wash gives the paper its warmth.

### Shadow Vocabulary
- **Rest** (`--shadow-1`): cards, search box, shelf books, chips on desktop.
- **Raised** (`--shadow-2`): hovered cards, focused search, dropdowns.
- **Sheet** (upward two-layer shadow): mobile bottom sheets.
- **Segment lift** (`0 1px 3px`): the active item in a segmented control.
- **Hairline** (`0 1px 2px`, 5% ink): the reader's relation context card.

### Named Rules
**The Lift Means Float Rule.** A shadow means the surface floats above something else. In-flow rows, list items and inline tags never get shadows. Pending/unavailable cards drop their shadow entirely.

## Shapes

Gently rounded and consistent. Each radius has a job: 4px for inline tags, book covers and the desktop text well; 8px for buttons and antd controls (`borderRadius: 8`); 10px for tiles, icon buttons and shelf books (`--kg-radius`); 12px for cards, search, the reader page and stepper buttons; 18px on the top corners of bottom sheets; full pills for chips and step pills. Every border is 1px `rule`, except the import card's 1.5px dashed vermilion line, which marks "this is where your own material goes."

Book covers have one fixed silhouette: a cloth block with an inset 6px darker spine on the left and a white vertical title slip (`writing-mode: vertical-rl`) at top right. That spine is book binding drawn in shadow, not a status stripe.

## Components

### Buttons
- **Shape:** control radius (8px); stepper and mobile action buttons use 12px at 48px height.
- **Primary:** vermilion fill, white text, letter-spaced on short CTAs (搜索). Hover drops to 0.88 opacity with a 1px lift; press scales to 0.98.
- **Ghost:** panel fill, 1px rule border, `ink-2` text. Hover turns border and text vermilion.
- **Evidence ("看原文 >"):** vermilion-soft fill, vermilion-line border, vermilion text, trailing antd `RightOutlined`. This is the one tinted secondary and always means "open the source."
- **Icon button:** 34px desktop / 40–44px mobile, 1px rule border, panel fill, inline SVG or antd icon.

### Chips & Tags
- **Filter chip:** pill, panel fill, rule border, `ink-2`. The active chip is filled vermilion.
- **Relation tag (亲属 / 主仆 / 归属):** 4px radius, vermilion-soft fill, vermilion text, 12–13px. Sits on the name's baseline.
- **Fact chip (人物 / 怡红公子):** 6px radius, well fill, rule-2 border, `ink-2`.
- **Step pill:** pill with an 18px vermilion-soft numbered disc. Used only for the home 3-step strip.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** `panel` over the page; `paper` (solid) inside sheets and the reader.
- **Shadow Strategy:** Rest; Raised on hover (desktop only, with a `translateY(-2px)` lift); none when pending.
- **Border:** 1px rule; turns vermilion-line on hover/press.
- **Internal Padding:** 12px mobile, 16px desktop.

### Inputs / Fields
- **Style:** panel fill, 1px rule, 12px radius, Rest shadow, leading antd/SVG search icon in `ink-3`. Mobile height is 50px (home) or 44px (canvas), with 16px text.
- **Focus:** border turns vermilion and the shadow steps up to Raised. No glow ring.
- **Dropdown:** solid paper, 12px radius, Raised shadow; rows highlight with vermilion-soft.

### Navigation
- **Desktop app bar:** serif brand, underline tabs (2px vermilion bottom border plus vermilion text when active), tabular stats on the right.
- **Mobile top bar:** back · serif title dropdown · theme toggle, then a full-width segmented control: well track, 36px items, active item on solid paper with vermilion 600 text and Segment lift.
- **Sheet tabs (关系 / 出场 / 资料):** 3-column, 44px, inactive `ink-2`; the active tab gets vermilion 600 text and a centered 28×2px vermilion underline.

### Bottom Sheet (signature)
A grip bar (38×4px, rule colour) sits above a serif 24px entity name, a meta row (fact chips plus tabular evidence count), icon tools (locate, close; active tool is vermilion-soft), tabs, and a scrolling list of 62px rows: type dot · name with relation tag · `ink-2` evidence count · evidence button. It enters with `translateY(40%)` → 0 and opacity 0.6 → 1 over 0.32s `cubic-bezier(0.22, 1, 0.36, 1)`. Analysis, locate and galaxy panels reuse the same sheet language.

### Evidence Reader (signature)
On mobile it is full-screen. The header has a close button, a centered chapter (`ink-2` small over a serif 16px title), and 出处 (source). Below that come a 原文 / 本回关系 segmented control and the relation context card (serif names, relation tag, `ink-2` meta line with method · confidence). The text page is serif 17px / 2.0 on solid paper. Supporting passages are `mark` gold, the current passage is `mark-strong`, and the focused entity has an indigo underline. The footer stepper is 上一处 (ghost) · tabular `n / total` · 下一处 (primary), and it walks the selected relation's evidence across chapters.

## Do's and Don'ts

### Do:
- **Do** use theme variables (`--ink`, `--accent`, `--rule`, `--panel`…) or their `--kg-*` aliases. Add a new graph page's root class to the selector list in `tokens.css`, or every `--kg-*` var on that page goes unresolved.
- **Do** keep vermilion for the single primary action and the active state; use vermilion-soft for hover, press and relation tags.
- **Do** set meta and secondary text in `ink-2`, and pair counts as `ink` 600 tabular number + `ink-2` unit.
- **Do** use serif for headings, entity names, quoted evidence and chapter text.
- **Do** make every mobile target at least 44px and keep mobile reading/input text at 16px or larger.
- **Do** use `@ant-design/icons` or inline SVG (`stroke="currentColor"`) for every icon.
- **Do** animate only `transform` and `opacity` (sheet entry, press `scale(0.97–0.98)`, hover `translateY(-1/-2px)`); colour and border transitions run at 0.15s.
- **Do** turn mobile detail panels into bottom sheets with a grip, 18px top corners and `safe-area-inset-bottom` padding.

### Don't:
- **Don't** add eyebrow or kicker labels (small tracked/uppercase text above a heading).
- **Don't** put colored side-stripe borders wider than 1px on cards, rows, callouts or panels. The reader's active-passage tick (in the approved evidence comp) and the book-cloth spine are the only left-edge marks, and neither is a container border.
- **Don't** use unicode glyphs (→ ▸ ▾ ◀ ▶ × ★) as icons or button content.
- **Don't** animate `width`, `height`, `top`, `left`, `right`, `margin` or `padding`.
- **Don't** use `ink-3` for any text the user must read.
- **Don't** introduce new hues, slate shadows or hard-coded hex outside the cluster palette and book cloth.
- **Don't** set controls, tabs or buttons in serif, or set chapter text in sans.
