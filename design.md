# Cinder Paper UI design brief

Design a restrained, dependable classroom desktop product for older school computers. It should feel warm and contemporary without looking playful, glossy or promotional: **paper, ink and ember**, with strong structure and very little decoration.

Use [the consolidated app specification](docs/CINDER_APP_SPEC.md) as the feature authority. Teacher, Student and Host must not gain screens or features that are absent from it.

## Brand assets

| Use | Asset |
| --- | --- |
| Primary horizontal logo on Paper | `design/brand/cinder-logo-primary-ember-reduced.png` |
| Standalone mark on a light surface | `design/brand/cinder-mark-ember-reduced-light.svg` |
| Application/installer icon only | `design/brand/cinder-app-icon-ember-reduced.png` |

The adopted mark is **Ember, reduced**: five tapered blades and a base dot with internal gradients. Use the full lockup on sign-in/setup screens and the mark alone in the application shell. Minimum on-screen mark size is 24 px; clear space is half the mark height. Never redraw, recolour, rotate, stretch, glow, shadow or re-typeset the wordmark.

## Colour and type

| Token | Value | Role |
| --- | --- | --- |
| Paper | `#F7F1E7` | App background |
| Surface | `#FFFAF2` | Panels, inputs and sidebar |
| Raised paper | `#EEE4D6` | Selected rows and secondary controls |
| Ash | `#2E160A` | Text, borders and primary ink |
| Soft ash | `#5C4132` | Secondary text |
| Muted ash | `#806B5E` | Metadata and placeholders |
| Ember | `#B24E17` | Primary actions, active navigation, focus |
| Spark | `#D9631F` | Small highlights only |
| Success | `#527A42` | Confirmed/synchronised states |
| Danger | `#B42318` | Destructive/error states |

Use Ubuntu first for UI text: `Ubuntu, "Segoe UI", Cantarell, system-ui, sans-serif`. Use Georgia sparingly for student note titles or document surfaces, and Consolas/system monospace only for join codes, setup PINs, URLs and technical values. Never use the logo's lettering as live type. `#FFA53D` Flare belongs inside the logo artwork only, not the interface.

## Visual system

- Paper theme only. No dark-mode control and no alternate themes.
- Opaque flat surfaces; no glass, blur, transparency, glow, ambient gradients or decorative background art.
- Square or near-square geometry. Use 1 px Ash dividers for structure and 2 px borders on important panels/controls. Keep corner radius at `0` unless a native control requires otherwise.
- Use shadows rarely and deliberately: a crisp `5px 5px 0 #2E160A` offset may mark a focused modal or primary work panel, not every card.
- Prefer lists, tables and split panes over grids of interchangeable cards. Cards must represent real grouped objects such as classrooms or assignments.
- Primary button: Ember fill, light text, strong focus ring. Secondary button: Surface fill, Ash border. Destructive actions stay secondary until confirmation.
- Icons are simple outline symbols with text labels in main navigation. Do not rely on icon-only controls except familiar actions with accessible names.
- Status uses label + icon + colour. Never communicate attendance, grades, connectivity or errors by colour alone.
- Motion is limited to short feedback transitions (about 120–180 ms). No page theatrics.

## Application direction

### Teacher

Use a persistent 222 px left sidebar and a compact top bar. The workspace is information-dense but calm: page title and one primary action first, then filters, tables/lists and details. Classroom management should use a master-detail layout. Assignment grading and the Univer gradebook deserve the widest canvas; avoid wrapping them in multiple decorative containers. Live Classroom sits inside the selected classroom and must be visually prominent while active, with a large code, countdown, participant list and clear End action.

### Student

Use the same shell and proportions as Teacher, with fewer navigation items and more breathing room. Home is a small set of useful widgets, not a motivational dashboard. Classrooms should foreground the next required action and submission state. The Notes editor is a focused document workspace; its optional reference PDF uses a resizable split view. An active Live Classroom remains visible across Student screens without blocking notes or classroom navigation.

### Host

The shipped Host is console-first. Do not design a full dashboard. If a visual launcher is requested, make one compact utility window that answers only: **Is it running? What URL do devices use? Where is the data stored? Is there a setup PIN? How do I copy these values or stop the server?** Use monospace for the URL and PIN, plain warnings, and no classroom content.

## Layout and behaviour

- Optimise for 1024×768; scale comfortably upward. Collapse the sidebar to an icon rail only when space requires it, retaining tooltips and keyboard access.
- Keep the principal action and connection state visible without scrolling. Tables may scroll inside the workspace with sticky headers.
- Minimum interactive target: 40×40 px. Maintain visible `:focus-visible` treatment, correct labels, logical tab order and sufficient contrast.
- Empty states say what is missing and offer the next valid action. Error messages explain what remained saved and how to retry.
- Treat offline as a normal state: show a quiet persistent connection indicator, mark queued work explicitly and never present queued work as synchronised.
- Use plain, specific British English. No exclamation marks, hype, mascot copy or vague labels such as “Magic”.

## Do not design

AI chat, AI grader, spreadsheet assistant, Atlas, a modules section, games, Nightdesk, Ember/dark themes, theme settings, glass styling, cloud-only onboarding, advanced grade-distribution analytics, question-correctness analytics, or a Host administration dashboard. These are outside the current product boundary.

The one exception is Teacher's **Papers** workspace, where AI drafts a question paper and its marking scheme, finds official past papers and locates figures on their pages. Design it as a master-detail workspace: a library rail of saved papers beside the paper being built, then plain labelled sections — the paper, its sources, one primary Create action, and the preview with its question/marking-scheme switch. No chat surface, no assistant persona, and the marking scheme is always marked as the teacher's copy.
