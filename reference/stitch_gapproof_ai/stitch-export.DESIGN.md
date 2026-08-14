---
name: ClearGap Learning
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#434654'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#737685'
  outline-variant: '#c3c6d6'
  surface-tint: '#1956cb'
  primary: '#1454c9'
  on-primary: '#ffffff'
  primary-container: '#3b6ee3'
  on-primary-container: '#fefcff'
  inverse-primary: '#b3c5ff'
  secondary: '#5e5e61'
  on-secondary: '#ffffff'
  secondary-container: '#e3e2e5'
  on-secondary-container: '#646467'
  tertiary: '#426600'
  on-tertiary: '#ffffff'
  tertiary-container: '#558100'
  on-tertiary-container: '#faffe9'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae1ff'
  primary-fixed-dim: '#b3c5ff'
  on-primary-fixed: '#001849'
  on-primary-fixed-variant: '#003fa3'
  secondary-fixed: '#e3e2e5'
  secondary-fixed-dim: '#c7c6c9'
  on-secondary-fixed: '#1b1c1e'
  on-secondary-fixed-variant: '#464749'
  tertiary-fixed: '#abf927'
  tertiary-fixed-dim: '#93db00'
  on-tertiary-fixed: '#111f00'
  on-tertiary-fixed-variant: '#324f00'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
  canvas: '#F5F6F7'
  surface-primary: '#FFFFFF'
  surface-secondary: '#F0F2F4'
  surface-blue-soft: '#EEF3FF'
  surface-lime-soft: '#F1FFD9'
  ink-primary: '#111214'
  ink-secondary: '#5F636B'
  ink-tertiary: '#8B9099'
  border-default: '#DDE0E5'
  border-strong: '#B9BEC7'
  status-success: '#247A4D'
  status-warning: '#9A5B00'
  status-error: '#B3261E'
typography:
  page-hero:
    fontFamily: Manrope
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  page-hero-mobile:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  page-title:
    fontFamily: Manrope
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  section-title:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '650'
    lineHeight: 28px
  card-title:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '650'
    lineHeight: 24px
  body:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '450'
    lineHeight: 26px
  sub-body:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '450'
    lineHeight: 22px
  label:
    fontFamily: Manrope
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  metric-xl:
    fontFamily: Manrope
    fontSize: 44px
    fontWeight: '600'
    lineHeight: 52px
  metric-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 24px
  margin: 32px
---

## Brand & Style

This design system is built for an AI learning coach tailored to middle-school students. The brand personality is **professional, supportive, and transparent**, avoiding the high-anxiety gamification often found in educational apps. It positions the AI as a calm "Learning Coach" rather than a rigid evaluator.

The visual style is **Corporate / Modern** with a **Minimalist** focus on modularity. It emphasizes high contrast for clarity and uses a "low-pressure" aesthetic characterized by soft, expansive white spaces and generous rounded corners. The design prioritizes "Action First, Detail Later," suppressing technical jargon to focus on natural language interactions and clear pedagogical progress.

## Colors

The palette utilizes a high-contrast foundation of neutrals with vibrant functional accents. 

- **Primary Canvas:** Use `#F5F6F7` for the main background to create a soft, non-clinical environment. 
- **Accent Blue:** The primary driver for actions and links. It represents current focus and guidance.
- **Accent Lime:** Reserved strictly for "New Discoveries" and positive progress. It must not be used for semantic "Mastery" to avoid creating false certainty in the student's mind.
- **Accent Black:** Used for high-emphasis primary buttons and specialized dark cards to anchor the layout.
- **Soft Tints:** Use `surface-blue-soft` for explanation components and `surface-lime-soft` for feedback tips.

## Typography

The system uses **Manrope** for Latin characters and numbers, paired with **HarmonyOS Sans SC** for Chinese text. This combination provides a modern, rounded, and highly legible appearance that feels approachable for students.

**Implementation Rules:**
- Enable `tabular-nums` for all metric and data-heavy components to ensure vertical alignment.
- Chinese text should mirror the weights of the Latin counterparts (e.g., 650 weight maps to Medium/Bold in HarmonyOS Sans).
- Maintain a minimum of 16px for body text to ensure readability for young users across various device distances.

## Layout & Spacing

The layout is built on a **12-column fluid grid** with a maximum container width of 1440px. A strict **4px base unit** and **8px rhythm** govern all internal spacing.

- **Learning Containers:** Content specifically for reading or task completion should be constrained to a max-width of 720px–760px to optimize line length and focus.
- **Margins:** 32px page-level padding on desktop, reducing to 16px on mobile.
- **Gutters:** 24px between main layout columns.
- **Gaps:** Use 24px (`space-6`) for the vertical gap between independent cards or between tabs and their content panels.

## Elevation & Depth

This system favors **flat modularity** and **tonal layering** over traditional shadows. Depth is communicated primarily through borders and surface color shifts.

- **Borders:** The primary method for defining hierarchy. Most cards use a 1px `border-default`.
- **Hover States:** Interaction is signaled by darkening the border from `border-default` to `border-strong`. Components do not "lift" or increase shadow on hover.
- **Floating Layers:** Shadows are reserved exclusively for temporary floating elements like dropdowns or popovers. Use a soft, diffused shadow: `0 12px 32px rgba(17,18,20,.12)`.
- **Z-Index Tiers:** 
  1. **Base:** Canvas (`#F5F6F7`)
  2. **Layer 1:** Surface Cards (`#FFFFFF`)
  3. **Layer 2:** Popovers/Navigation Drawers
  4. **Layer 3:** System Dialogs

## Shapes

The shape language is characterized by **large, friendly corner radii** to reduce visual tension and create a supportive atmosphere.

- **Primary Containers:** 24px radius (e.g., main content wrappers).
- **Large Cards:** 20px radius.
- **Standard Cards:** 16px radius.
- **Interactive Elements:** Buttons and Input fields use a 12px radius.
- **Small UI / Tags:** 10px or full Pill-shape.
- **Selection Markers:** Use a 3px vertical accent bar on the left edge of selected sidebar items.

## Components

### Buttons
- **Primary Action:** Solid `accent-blue` with white text.
- **High-Emphasis:** Solid `accent-black` with white text.
- **Secondary:** White background with `border-default`. 
- **Radius:** 12px for standard, Pill for small utility buttons.

### Cards
- **Standard:** White background, 1px `border-default`, 16px radius.
- **Highlight:** `surface-blue-soft` background for instructional content.
- **Discovery:** `surface-lime-soft` background with a subtle lime border to highlight new evidence.

### Tabs & Filters
- **Style:** Capsule (Pill) shaped containers.
- **State:** Selected tabs use a white surface with a subtle shadow or an `accent-blue` outline; unselected tabs use `surface-secondary` or transparent backgrounds.

### Input Fields
- **Surface:** `surface-secondary` background to distinguish from the primary white card surface.
- **Border:** 12px radius, 1px `border-default`. Transitions to `accent-blue` on focus.

### Data Visualization
- **Skill Representation:** Avoid Radar charts. Use **Square Matrices** (grid-based) and **Relationship Graphs** with rounded nodes and 1.75px–2px stroke weights.
- **Icons:** Use Lucide-style linear icons with rounded ends, sized to 20px.

### List Items
- **Interactions:** Subtle background tint on hover; no shadow change. Use 8px spacing between icons and text labels.