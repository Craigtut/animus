# Onboarding Navigation -- Design Spec

## Purpose

The onboarding flow has ~13 steps split across two groups (Setup: 5 steps, Persona: 8 steps). Currently, every step renders its own inline Back + Continue buttons at the bottom of its content. This creates two problems: on short or mobile viewports the buttons scroll below the fold, and the duplicated navigation code across 13 files is fragile and inconsistent.

This spec defines a unified `OnboardingNav` component that lives in the `OnboardingLayout` -- a persistent, viewport-anchored navigation bar that stays visible regardless of scroll position while never permanently obscuring content.

## Design Rationale

### Why Sticky, Not Fixed

A `position: fixed` bar would sit outside the document flow entirely, requiring manual padding on every step to avoid content being hidden behind it. A `position: sticky` bar, attached to the bottom of the layout's flex container, scrolls naturally with the page but locks to the viewport edge when it would otherwise leave view. This means:

- On short content (e.g., WelcomeStep), the bar sits naturally at the bottom of the layout -- no awkward gap.
- On tall content (e.g., DimensionsStep with 10 sliders), the bar sticks to the viewport bottom so the user always has access to navigation, and they can scroll freely to see all content -- the bar does not permanently obscure the last item because the content area has bottom padding equal to the bar's height.
- No z-index wars with other fixed elements. The bar participates in the normal stacking context.

The bar is placed as the last child inside the outermost `OnboardingLayout` flex container (after the content `<div>`), not inside the max-width content column. This allows it to span the full viewport width while keeping its internal content aligned to the same column width.

### Why a Fade Gradient, Not a Hard Edge

A hard border or solid background bar would feel like a toolbar bolted onto the bottom of the screen -- clinical, rigid. Instead, the bar uses a gradient fade from transparent at the top to a translucent warm surface at the bottom. This creates a natural "fog" effect that dissolves the boundary between scrolling content and the navigation. The content appears to fade into the controls, as if submerging gently -- consistent with the brand's organic, warm quality.

The gradient uses the same translucent warm surface color as cards and elevated surfaces (`background.paper`), so the bar inherits the warmth of whatever WebGL gradient is beneath it. This is not a frosted-glass blur effect (which would be computationally expensive for a persistent element and visually "techy"). It is a simple alpha gradient -- cheap, elegant, and warm.

### Why an Icon for Back, Not Text

"Back" as a text button competes visually with the Continue button and adds verbal noise. An ArrowLeft icon is universally understood, visually lightweight, and creates clear asymmetry in the nav bar: a quiet, small affordance on the left; a prominent, labeled action on the right. This asymmetry reinforces information hierarchy -- the most important action (Continue) dominates, the secondary action (Back) is available but recessive.

---

## Component: `OnboardingNav`

### Props Interface

```typescript
interface OnboardingNavProps {
  /** Handler for the back action. If omitted, the back button is not rendered (e.g., WelcomeStep). */
  onBack?: () => void;

  /** Handler for the primary forward action. Always required. */
  onContinue: () => void;

  /** Label for the primary button. Defaults to "Continue". */
  continueLabel?: string;

  /** Whether the primary button is disabled (e.g., required field not filled). */
  continueDisabled?: boolean;

  /** Whether the primary button should show a loading state. */
  continueLoading?: boolean;

  /** Handler for the skip action. If provided, a "Skip" link appears to the left of Continue. */
  onSkip?: () => void;

  /** Keyboard shortcut hint shown near Continue. Defaults to showing Enter icon. Set false to suppress. */
  showKeyboardHint?: boolean;
}
```

### Layout

The component renders a `<div>` with `position: sticky; bottom: 0` placed as the last child of the `OnboardingLayout` root container (after the scrolling content area).

```
+-----------------------------------------------------------------------+
|  [gradient fade: transparent -> translucent surface, 48px tall]       |
+-----------------------------------------------------------------------+
|                                                                       |
|   (back icon)              (skip link)    [  Continue  ]              |
|                                                                       |
+-----------------------------------------------------------------------+
|  [bottom safe area padding for mobile notch/gesture bar]              |
+-----------------------------------------------------------------------+
```

**Outer wrapper:**
- `position: sticky`
- `bottom: 0`
- `z-index: theme.zIndex.sticky` (1020)
- `pointer-events: none` on the outer wrapper (the gradient fade area should not block clicks on content beneath it)
- Full viewport width (not constrained by the content column)

**Gradient fade overlay:**
- A pseudo-element or child div positioned above the bar
- `height: 48px`
- `background: linear-gradient(to bottom, transparent, <surface color at ~0.85 opacity>)`
- `pointer-events: none` -- clicks pass through to content beneath
- This sits above the solid bar area, creating the dissolve effect

**Inner bar:**
- `pointer-events: auto` -- re-enables interactivity for the actual buttons
- `padding: theme.spacing[4] theme.spacing[6]` (16px 24px)
- `padding-bottom: max(theme.spacing[4], env(safe-area-inset-bottom))` for notched mobile devices
- `background: <surface color at ~0.85 opacity>` -- slightly translucent warm surface, matching the bottom of the gradient
- `backdrop-filter: blur(12px)` -- subtle blur to soften whatever bleeds through (the WebGL gradient)
- Content is horizontally constrained to `max-width: 640px` (720px on lg breakpoint), centered with `margin: 0 auto` -- matching the content column width exactly
- Internal layout: `display: flex; align-items: center; justify-content: space-between`

### Content Padding

To ensure the navigation bar never permanently obscures the last piece of content, the content area in `OnboardingLayout` needs `padding-bottom` equal to the combined height of the bar + gradient fade (~96-112px). This value should be generous -- err on the side of too much padding rather than too little. Currently the layout already has `padding-bottom: theme.spacing[12]` (48px); this should increase to approximately `theme.spacing[24]` (96px) to account for the sticky bar height.

### Visual Hierarchy

```
1. PRIMARY:   Continue button (high-contrast, right-aligned, largest element)
2. SECONDARY: Skip link (when present, subtle text, left of Continue)
3. TERTIARY:  Back arrow (left side, small, ghost treatment)
```

The eye naturally reads left to right. Placing the back arrow alone on the left creates visual breathing room and makes the right cluster (Skip + Continue) the obvious focal point.

---

## Element: Back Button

### Design

- **Icon:** `ArrowLeft` from Phosphor Icons, weight `regular`, size 20px
- **Container:** A 40x40px (theme.spacing[10]) circle with `border-radius: full`
- **Variant:** Ghost treatment -- transparent background, icon uses `text.secondary` color
- **Hover:** Background shifts to `background.elevated`, icon color shifts to `text.primary`, scale 1.02
- **Active/Tap:** Scale 0.96, 100ms
- **Focus ring:** `border.focus` color, 2px offset (for keyboard users)
- **Aria:** `aria-label="Go back"`
- **Keyboard:** Accessible via Tab. Also triggered by Escape key (already defined in the onboarding spec).

### Why a Circle, Not a Pill

A pill-shaped back button (with text or even just an icon in a rounded rectangle) would visually compete with the Continue button. A circle is compact, familiar (resembles browser/OS back buttons), and reads as "navigation control" rather than "action." It recedes visually while remaining easy to tap (40px is comfortably above minimum touch target size).

### When Not Rendered

On the WelcomeStep (`onBack` is undefined), the back button is not rendered. The Continue/Begin button shifts behavior -- see Edge Cases below.

---

## Element: Continue Button

### Design

- Uses the existing `Button` component with `variant="primary"` and `size="md"`
- Default label: "Continue"
- Override labels per step: "Begin" (WelcomeStep), "Bring to Life" (ReviewStep)
- Minimum width: 120px -- prevents the button from looking too small on short labels
- When disabled: standard 0.5 opacity, `cursor: not-allowed`
- When loading: shows `Spinner` + label text (existing Button behavior)

### Keyboard Hint

A small badge appears to the right of the Continue button (inside the button or just outside), showing the Enter key glyph. This uses `font-size: xs` (12px), `text.hint` color, and a subtle `border.light` border to look like a keycap.

**Behavior:** The hint is visible by default. After the user presses Enter for the first time during the onboarding session, the hint fades out (200ms) and does not reappear for subsequent steps. This is tracked via a simple `boolean` in the onboarding Zustand store (`hasUsedKeyboardShortcut`).

---

## Element: Skip Link

### Design

- Appears only when `onSkip` is provided (AboutYouStep, ChannelsStep)
- Rendered as a text link, not a button -- `<button>` element styled as inline text for accessibility, but visually looks like a link
- Text: "Skip" in `font-size: sm` (14px), `text.hint` color
- Hover: `text.secondary` color
- Position: To the left of the Continue button, separated by `theme.spacing[3]` (12px)
- The skip action and continue action may call the same handler (as they do currently), but keeping them as separate props allows steps to distinguish if needed

### Layout When Skip Is Present

```
[Back circle]                              Skip   [Continue]
```

The right side becomes a horizontal group with `gap: theme.spacing[3]`, containing the Skip link and Continue button. The Skip link is vertically centered with the button.

---

## Responsive Behavior

### Desktop (>1024px)

- Inner content max-width: 720px, centered
- Back circle: 40x40px
- Continue button: `size="md"` (default padding)
- Gradient fade height: 48px
- Bar padding: 16px vertical, 24px horizontal

### Tablet (768-1024px)

- Inner content max-width: 640px, centered
- Same element sizing as desktop
- Bar padding: 16px vertical, 20px horizontal

### Mobile (<768px)

- Inner content: full width with 16px horizontal padding
- Back circle: 40x40px (no change -- already at minimum touch target)
- Continue button: `size="md"` (no change)
- Bar padding: 12px vertical, 16px horizontal
- `padding-bottom` includes `env(safe-area-inset-bottom)` for notched devices
- Gradient fade height: 40px (slightly shorter to conserve space)

### Very Short Viewports (<500px height)

- The sticky behavior still works correctly -- the bar anchors to the viewport bottom
- Content is scrollable behind it
- The gradient fade ensures a smooth transition rather than a jarring cutoff

---

## Edge Cases

### WelcomeStep (No Back, Centered "Begin")

- `onBack` is not provided, so the back circle is not rendered
- `continueLabel` is set to `"Begin"`
- When there is no back button, the layout adjusts: instead of `justify-content: space-between`, the right-side group (which now contains only the Continue/Begin button) can be centered or right-aligned
- **Decision:** Right-align. Even without a back button, the Continue action should stay in the same position the user will find it on every subsequent step. Spatial consistency across steps is more important than centering one step. The user builds muscle memory for "bottom right = forward."

### ReviewStep (Final Step, "Bring to Life")

- `continueLabel` is set to `"Bring to Life"`
- `continueLoading` is set to `true` while the persona save mutation is in flight
- The button may be `size="lg"` to add emphasis to this climactic moment -- this is the one step where elevating the button size is warranted
- No skip option

### Steps With Validation (Continue Disabled)

- Identity step: Continue is disabled until the name field has a non-empty value
- Agent Provider step: Continue is disabled until credentials are validated
- `continueDisabled={true}` dims the button and prevents clicks
- The keyboard shortcut (Enter) is also suppressed when disabled

### About You and Channels (Skip Available)

- Both `onSkip` and `onContinue` are provided
- The Skip link and Continue button appear together on the right
- Currently both call the same handler; the spec preserves separate props for future flexibility

### Persona Interstitial

The brief interstitial screen that appears when transitioning from Setup to Persona ("Now for the important part...") may or may not use OnboardingNav. If it uses navigation, it should show only a Continue button (no back to the Setup steps from the interstitial). If it auto-advances after a delay, no nav bar is shown.

---

## Scroll Behavior

### Content Visibility Guarantee

The critical contract: **no content is ever permanently hidden behind the nav bar.** This is achieved through:

1. **Bottom padding on the content area:** The content container gets `padding-bottom: ~112px` (enough to cover the gradient + bar height). This means even the last element on the longest step has clear space below it before the sticky bar begins.

2. **Sticky, not fixed:** The bar participates in the document flow. On short content (where everything fits without scrolling), the bar simply sits at the bottom of the layout -- no overlap occurs. On tall content, the bar sticks to the viewport bottom, and the padding ensures scrolling all the way down reveals everything.

3. **Gradient pointer-events passthrough:** The gradient fade area has `pointer-events: none`, so users can interact with content elements (like the last slider on the Dimensions step) even when they visually overlap with the gradient fade region.

### Scroll Shadow Hint

An optional enhancement: when the content is scrollable and the user has not yet scrolled to the bottom, a very subtle downward-pointing chevron or a slightly more opaque gradient can hint that there is more content below. This disappears once the user scrolls to the end. **This is a nice-to-have, not a requirement for the initial implementation.**

---

## Micro-Interactions

### Step Transition

When navigating between steps, the nav bar itself does not animate in/out -- it stays put. The content above it transitions (existing horizontal slide + fade). This creates an anchor point: the content changes, but the navigation is stable. This is intentional. The progress dots at the top and the nav bar at the bottom are the "frame" that holds the experience together. The content flows between them.

### Back Button Press

- On click/tap: the circle scales to 0.96 for 100ms (via `whileTap` on Motion), then returns
- The step content performs its exit animation (slide right, since we are going backward)
- The progress indicator updates (dot slides back)

### Continue Button Press

- Existing Button behavior: `whileTap: { scale: 0.98 }`, 100ms
- After a successful continue, the step content exits (slide left) and the next step enters (slide in from right)
- If the continue action involves an async operation (e.g., ReviewStep save), the button shows its loading spinner

### Skip Link

- On hover: color transitions from `text.hint` to `text.secondary` over 150ms
- On click: same behavior as Continue (triggers step transition)
- No scale animation -- it is text, not a button, and should feel lightweight

### Keyboard Hint Fade

- The Enter keycap hint is visible with `opacity: 0.4`
- After first Enter press: fades to `opacity: 0` over 200ms
- Uses CSS transition, not a Motion animation -- it is too small to warrant a spring

---

## Animations & Timing Summary

| Element | Trigger | Property | Duration | Easing |
|---------|---------|----------|----------|--------|
| Back circle hover | mouseenter | background, color | 150ms | ease-out |
| Back circle tap | pointerdown | scale (0.96) | 100ms | ease-out |
| Continue tap | pointerdown | scale (0.98) | 100ms | ease-out |
| Skip hover | mouseenter | color | 150ms | ease-out |
| Keyboard hint fade | first Enter press | opacity (1 -> 0) | 200ms | ease-out |
| Gradient fade | static | -- | -- | -- |

---

## Integration into OnboardingLayout

### Current Structure

```
OnboardingLayout
  +-- FluidBackground
  +-- <nav> (progress indicator: dots + label)
  +-- <div> (content area, flex: 1)
        +-- <div> (max-width column)
              +-- AnimatePresence > motion.div > <Outlet />
```

### Proposed Structure

```
OnboardingLayout
  +-- FluidBackground
  +-- <nav> (progress indicator: dots + label)
  +-- <div> (scrollable content area, flex: 1, overflow-y: auto)
        +-- <div> (max-width column)
              +-- AnimatePresence > motion.div > <Outlet />
  +-- OnboardingNav (sticky, bottom: 0)
```

**Key change:** OnboardingNav is a sibling of the content area, not a child of it. This is essential for the sticky behavior to work correctly -- it sticks to the bottom of the `OnboardingLayout` root, which is a `min-height: 100vh` flex column.

### How Steps Communicate With OnboardingNav

Steps currently import `Button` and render their own navigation. With this spec, steps should instead communicate their navigation intent to the layout. Two approaches:

**Option A: Context/Store (Recommended)**

Create a lightweight Zustand slice or React context that steps use to configure the nav:

```typescript
// In the onboarding store or a dedicated context
interface OnboardingNavConfig {
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  onSkip?: () => void;
}
```

Each step calls a `setNavConfig(config)` hook on mount (in a `useEffect`). OnboardingLayout reads this config and passes it to OnboardingNav. This keeps steps declarative -- they describe what navigation should look like, and the layout renders it.

**Option B: Render Prop / Slot Pattern**

Each step exports or renders a navigation configuration component that OnboardingLayout picks up. This is more complex and harder to type-safe.

**Recommendation:** Option A. A `useOnboardingNav` hook that steps call is simple, composable, and keeps the rendering entirely in the layout.

```typescript
// Example usage in IdentityStep
function IdentityStep() {
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep } = useOnboardingStore();

  useOnboardingNav({
    onBack: () => navigate('/onboarding/agent'),
    onContinue: () => {
      markStepComplete('identity');
      setCurrentStep('about_you');
      navigate('/onboarding/about-you');
    },
    continueDisabled: !fullName.trim(),
  });

  // Step renders ONLY its content -- no nav buttons
  return (
    <div>
      <h2>Tell your Animus who you are</h2>
      {/* ... form fields ... */}
    </div>
  );
}
```

### Removing Inline Navigation From Steps

Once OnboardingNav is integrated into the layout, the bottom `<div>` in every step that renders Back/Continue/Skip buttons should be removed. This is a mechanical cleanup across all 13 step files.

---

## Accessibility

- **Tab order:** Back button is first in tab order within the nav bar, then Skip (if present), then Continue
- **Aria labels:** Back button has `aria-label="Go back"`. Continue button uses its visible label. Skip link uses its visible text.
- **Role:** The nav bar wrapper has `role="navigation"` and `aria-label="Onboarding navigation"`
- **Keyboard:** Enter triggers Continue (existing behavior). Escape triggers Back (existing behavior). Tab cycles through nav elements. Both shortcuts are handled at the layout level, not per-step.
- **Reduced motion:** The gradient fade, button scale animations, and keyboard hint fade all respect `prefers-reduced-motion: reduce`. Under reduced motion, transitions are instant (0ms duration) rather than animated.

---

## Summary of Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Positioning | Sticky to bottom | Natural flow on short content, viewport-locked on tall content |
| Visual treatment | Gradient fade + translucent surface | Warm, organic, consistent with brand. Not a hard toolbar edge. |
| Back button | ArrowLeft icon in 40px ghost circle | Compact, universal, does not compete with Continue |
| Continue button | Labeled primary button, right-aligned | Consistent position builds muscle memory |
| Skip treatment | Text link left of Continue | Visually recessive, clearly optional |
| WelcomeStep (no back) | Right-align Continue/"Begin" | Spatial consistency across all steps |
| ReviewStep | "Bring to Life" at size lg | Adds emphasis to the climactic moment |
| Communication pattern | Zustand/context hook (`useOnboardingNav`) | Keeps steps declarative, rendering in layout |
| Content protection | Bottom padding on content area | Guarantees nothing is hidden behind the bar |

---

## References

- `docs/frontend/onboarding.md` -- Full onboarding flow design
- `docs/frontend/design-principles.md` -- Animation timing, component guidelines, visual system
- `docs/brand-vision.md` -- Warm, organic, alive aesthetic
- `packages/frontend/src/pages/onboarding/OnboardingLayout.tsx` -- Current layout implementation
- `packages/frontend/src/components/ui/Button.tsx` -- Existing button component
