---
name: Romer Tactical
colors:
  surface: '#131314'
  surface-dim: '#131314'
  surface-bright: '#3a393a'
  surface-container-lowest: '#0e0e0f'
  surface-container-low: '#1c1b1d'
  surface-container: '#201f21'
  surface-container-high: '#2a2a2b'
  surface-container-highest: '#353436'
  on-surface: '#e5e2e3'
  on-surface-variant: '#c6c5d8'
  inverse-surface: '#e5e2e3'
  inverse-on-surface: '#313031'
  outline: '#8f8fa1'
  outline-variant: '#454655'
  surface-tint: '#bec2ff'
  primary: '#bec2ff'
  on-primary: '#000ba6'
  primary-container: '#7a85ff'
  on-primary-container: '#000992'
  inverse-primary: '#3d4ae0'
  secondary: '#50d8e9'
  on-secondary: '#00363c'
  secondary-container: '#00b1c1'
  on-secondary-container: '#003e44'
  tertiary: '#ffb68a'
  on-tertiary: '#502403'
  tertiary-container: '#c28259'
  on-tertiary-container: '#471e00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e0e0ff'
  primary-fixed-dim: '#bec2ff'
  on-primary-fixed: '#000469'
  on-primary-fixed-variant: '#1f2bc8'
  secondary-fixed: '#91f1ff'
  secondary-fixed-dim: '#50d8e9'
  on-secondary-fixed: '#001f23'
  on-secondary-fixed-variant: '#004f57'
  tertiary-fixed: '#ffdbc8'
  tertiary-fixed-dim: '#ffb68a'
  on-tertiary-fixed: '#321300'
  on-tertiary-fixed-variant: '#6c3a17'
  background: '#131314'
  on-background: '#e5e2e3'
  surface-variant: '#353436'
  surface-deep: '#050505'
  surface-panel: '#111214'
  border-muted: '#232426'
  text-muted: '#9A9DA3'
  accent-lemon: '#C4FF44'
  accent-teal: '#D1EBEB'
typography:
  hero-headline:
    fontFamily: Manrope
    fontSize: 76px
    fontWeight: '520'
    lineHeight: '1.1'
    letterSpacing: -0.055em
  h1:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '520'
    lineHeight: '1.1'
    letterSpacing: -0.05em
  h2:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '520'
    lineHeight: '1.2'
    letterSpacing: -0.05em
  h3:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '520'
    lineHeight: '1.2'
    letterSpacing: -0.04em
  body-lg:
    fontFamily: Inter
    fontSize: 19px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.02em
  mono-data:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.0'
    letterSpacing: -0.01em
  mono-telemetry:
    fontFamily: Inter
    fontSize: 9px
    fontWeight: '600'
    lineHeight: '1.0'
    letterSpacing: 0.2em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 20px
  margin-safe: 32px
---

## Brand & Style

Romer Tactical is an intelligence-driven design system built for high-stakes leadership environments. The brand personality is clinical, precise, and authoritative, evoking the feeling of a "command center" rather than a traditional SaaS dashboard. 

The aesthetic sits at the intersection of **Minimalism** and **Technical Brutalism**. It prioritizes information density and clarity through an ultra-fine grid system, monospaced data visualization, and a "low-noise" interface. The emotional response is one of calm control—turning chaotic data into structured, actionable signals. Visual motifs include fine-line schematics, SVG telemetry streams, and dot-pattern backgrounds that reinforce the feeling of a live operating layer.

## Colors

The system utilizes a **High-Contrast Dark** palette designed for long-term monitoring. 

- **Primary (#5E6BFF):** An electric indigo used for system-critical actions and primary data threads.
- **Secondary (#50D8E9):** A cyan highlight reserved for "optimal" states and active telemetry.
- **Tertiary (#FFB689):** A soft apricot used sparingly for warnings or "pending" states.
- **Neutral/Background:** The core interface rests on `#070708` (Obsidian) and `#050505` (Deep Black) to ensure maximum contrast for data visualization.
- **Semantic Accents:** High-saturation tones like `#C4FF44` (Lemon) are reserved for marketing-critical sections and high-impact quotes to break the technical monotony.

## Typography

The typographic strategy balances human-centric readability with machine-like precision.

- **Headlines:** Uses **Manrope** at a specific 520 weight. It provides a modern, balanced look that remains legible even at massive scales. Hero headlines use aggressive negative letter spacing to create a compact, impactful visual block.
- **Body & UI:** Uses **Inter** for its neutral, systematic utility. It is the workhorse for all interface labels and descriptive text.
- **Data Layers:** A specialized application of Inter is used for "Mono-Telemetry" roles—all-caps, small font sizes (8px-10px), and wide letter-spacing (0.2em) to mimic technical instrument readouts.
- **Mobile Scaling:** Headlines above 32px should scale down to 1.2x of the H3 size on mobile devices to maintain layout integrity.

## Layout & Spacing

Romer uses a **Fixed Grid** philosophy for its primary marketing containers (max-width 1728px) and a **Pane-Based Fluid Grid** for the dashboard mockups.

- **Dashboard Panes:** Layouts are split into functional zones (Telemetry Left, Analytical Center, Decision Right). Borders are 1px and consistent throughout, creating a "blueprint" feel.
- **Rhythm:** An 8px base unit drives the spacing system. Larger sections use 120px to 160px vertical padding to create significant breathing room between technical data blocks.
- **Responsive Behavior:** On mobile, the 3-pane dashboard reflows into a single-column vertical stack. The 4-column "Insights" grid collapses into a 1-column list with center-aligned telemetry markers.

## Elevation & Depth

Depth is achieved through **Tonal Layering** and **Glassmorphism** rather than traditional drop shadows.

- **Surface Tiers:** Backgrounds transition from `#050505` (Base) to `#0a0a0b` (Card/Panel) to `#111214` (Floating Elements).
- **Glass Effects:** Floating command cards and headers use `backdrop-blur(20px)` with a semi-transparent background (`rgba(16, 17, 18, 0.8)`).
- **Inner Glows:** To emphasize the "screen" aesthetic, active panels use an `inset 0 1px 0 0 rgba(255, 255, 255, 0.1)` glow to simulate light catching the edge of an instrument.
- **Borders:** Low-opacity white borders (`white/[0.05]`) are used to define shapes without creating visual noise.

## Shapes

The shape language is strictly **Soft (1)**. 

- **Containers:** Dashboard frames and standard cards use a `0.75rem` (12px) radius.
- **Buttons/Inputs:** Smaller UI components like buttons and tags use a `0.25rem` (4px) radius to maintain a professional, sharp-edged appearance.
- **Specialty Shapes:** The "R" logo and status indicators use full circular rounding to provide a soft counterpoint to the rigid grid.

## Components

- **Buttons:** 
  - *Primary:* Solid white background with black text, bold weight.
  - *Secondary:* Transparent background with `#232426` border and white text.
  - *Tactical:* Indigo-tinted borders with monospaced all-caps labels for "Execute" actions.
- **Cards:** Background `#0a0a0b` with a `1px` border of `#232426`. Dashboard-style cards often include a "Dot Pattern" background at 5% opacity to reinforce the technical theme.
- **Telemetry Streams:** Small SVG sparklines using Primary or Secondary colors, paired with 9px monospaced labels for live data visualization.
- **Status Indicators:** Small 6px-8px circles with a "glow" box-shadow of 8px-15px using the color of the status (e.g., Cyan for OK).
- **Grid Lines:** 0.5px borders used for axis lines in charts and panel dividers to maintain a high-fidelity instrument look.