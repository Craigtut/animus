# Animus: Design Principles

## Core Philosophy

Design in Animus serves a single purpose: to make the complex feel simple and the artificial feel alive. Every design decision should be evaluated against these questions:

1. Does this help the user understand what they need to know?
2. Does this contribute to the feeling that Animus is alive?
3. Is this the simplest solution that achieves both?

## Foundational Principles

### Intent-Driven Design

Every screen exists to serve a specific user need. Before designing, answer:
- What does the user need to know right now?
- What action might they need to take?
- What can be removed without losing meaning?

Design around the answer. Strip away everything else.

### Clarity Over Cleverness

When choosing between a clever solution and a clear one, choose clear. Users should never have to decode the interface. Information hierarchy should be immediately apparent. The most important thing should be unmistakably the most important thing.

### Quiet Confidence

The interface should feel assured, not anxious. It doesn't need to prove itself through visual complexity or constant activity. Good design is felt more than noticed. When everything is working well, the interface almost disappears.

### Alive, Not Animated

Animation serves to make the interface feel alive — breathing, present, aware. Animation is never decorative, never attention-seeking, never performative. The goal is subtle signs of life, not spectacle.

## Visual System

### Dark Mode Foundation

Animus uses a dark mode interface with a very dark, nearly black background. This creates:
- Focus on content
- Reduced visual fatigue
- A canvas where light carries meaning
- An intimate, focused feeling

**Background Tones**
Blacks should have a subtle warm undertone. The darkness should feel like a comfortable room at night, not an empty void. Layer slightly lighter dark tones to create depth and hierarchy.

### Monochromatic Restraint

The vast majority of UI elements exist in blacks, whites, and grays.

**Why Restraint Matters:**
- When everything is colorful, nothing stands out
- Color should carry semantic meaning
- Restraint creates elegance
- It allows the inner life visualizations to take center stage

**Grays with Warmth:**
The gray palette should lean warm — never blue or green-shifted. Even neutral colors should feel alive.

### Color with Purpose

Color appears only when it needs to communicate something specific:

**Primary Accent: White**
- Primary buttons and actions
- Key interactive elements
- Maximum emphasis

**Semantic Colors:**
| Color | Usage |
|-------|-------|
| Green | Success, completion, positive states |
| Orange | Warning, caution, needs attention |
| Red | Error, danger, critical issues |
| Indigo | Informational (use sparingly) |

**Emotional State Colors:**
A separate palette exists for representing Animus's inner life. These colors are softer, more gradient-based, and appear in visualizations rather than UI chrome.

### Typography

**Plus Jakarta Sans** — The sole typeface family.

**Hierarchy Through Weight:**
- Display/Hero: Light or Regular, large size
- Headings: Semibold
- Body: Regular
- Secondary/Caption: Regular at smaller size, slightly reduced opacity
- Emphasis: Medium or Semibold

**Sizing Scale:**
Use a consistent type scale with clear jumps between levels. Each step in the scale should be obviously different from adjacent steps.

**Spacing:**
Generous line height for body text. Headlines can be tighter. Let text breathe.

### Spacing & Layout

**Airy & Generous**
The interface should feel spacious. Information needs room to breathe. Generous whitespace (or rather, darkspace) reinforces the feeling of elegance and calm.

**Consistent Rhythm**
Use a spacing scale that creates visual rhythm. Common spacings should repeat throughout the interface, creating unconscious harmony.

**Content-Driven Layout**
Layout should emerge from content needs, not be imposed upon them. Don't force content into rigid grids when it doesn't serve the information.

### Cards & Containers

**Gradient Border Rim Lighting**
Cards and containers feature subtle gradient borders that imply rim lighting — as if soft light is falling across the edge from above.

**Implementation:**
- Gradient runs from warm off-white to transparent
- Positioned to suggest light from a consistent direction (typically top or top-left)
- Very subtle — noticeable but not attention-grabbing
- Creates depth and elevation without traditional shadows

**Why Not Shadows:**
In dark interfaces, traditional drop shadows don't work well. The rim lighting technique creates a sense of elevation and depth that feels natural in the dark environment.

**Container Hierarchy:**
- Primary containers: Full rim lighting
- Secondary containers: Reduced opacity or partial rim lighting
- Tertiary: May use only subtle background color shift

### Corners

**Rounded Throughout**
Use rounded corners consistently across all elements. This contributes to the warm, approachable feel and softens what could otherwise feel harsh or clinical.

**Radius Consistency:**
Establish a small set of corner radius values and use them consistently:
- Small radius for small elements (buttons, inputs, tags)
- Medium radius for cards and containers
- Large radius for modal dialogs and major containers

Nested elements should have coordinated radii that feel harmonious together.

### Depth & Layering

**Layered Transparency**
Create depth through layered, semi-transparent surfaces rather than shadows. Higher elements can be slightly lighter or have reduced transparency, revealing the darkness beneath.

**Rim Lighting as Elevation**
The gradient borders serve as the primary indicator of elevation. More prominent rim lighting suggests higher elevation.

**No Glow Effects**
Avoid sci-fi style glow effects. Light should feel warm and natural, not projected or artificial.

### Iconography

**Phosphor Icons**
Line-based, rounded caps and joins, consistent stroke weight.

**Usage Guidelines:**
- Use icons to support text, not replace it for critical actions
- Maintain consistent sizing throughout the interface
- Icons should feel friendly and clear
- Match icon visual weight to surrounding text weight

## Animation Principles

Animation in Animus serves to make the interface feel alive. It should never feel mechanical, never demand attention, never distract from content.

### The Alive Feeling

**Breathing Over Blinking**
Prefer slow, continuous movements over discrete state changes. Things should ease in and out like breath, not snap on and off.

**Subtle Over Spectacular**
The best animations are barely noticed consciously but deeply felt. A slight shift, a gentle fade, a slow pulse. These create presence without performance.

**Organic Over Mechanical**
Movement should feel natural, like something alive. Avoid linear timing. Avoid robotic precision. Let things flow.

### Types of Animation

**Ambient Animation**
Very slow, very subtle animations that run continuously to suggest life:
- Gradient shifts in backgrounds
- Gentle movement in rim lighting
- Slow drift in particle fields
- Breathing scale changes (1-2% max)

These should be almost imperceptible but contribute to a felt sense of aliveness.

**Transitional Animation**
Movement between states (page transitions, element appearance/disappearance):
- Smooth and unhurried
- Consistent timing across similar transitions
- Elements should feel like they're moving with intention
- Avoid bounce, overshoot, or playful effects in UI transitions

**Micro-Interactions**
Small responses to user interaction (hover, click, focus):
- Immediate response (no delay)
- Subtle scale, opacity, or color shifts
- Should acknowledge the interaction without fanfare
- Can be slightly more noticeable than ambient animation

**Attention Animation**
When something genuinely needs user attention:
- Can be more noticeable than other animations
- Still organic in movement quality
- Should feel like something is gently requesting attention, not demanding it
- Use sparingly — if everything pulses for attention, nothing does

### Animation Timing

**Curves**
Use easing curves that feel organic. Ease-out for elements entering. Ease-in for elements leaving. Ease-in-out for elements transforming. Avoid linear movement except for continuous loops.

**Duration**
- Micro-interactions: 100-200ms
- Standard transitions: 200-400ms
- Ambient animations: 2000ms+ (very slow)
- Attention animations: 1000-2000ms per cycle

**Consistency**
Similar actions should have similar timing. Establish a small set of duration values and reuse them.

### Animation Don'ts

- Don't animate for the sake of animating
- Don't use bounce or spring physics in UI (save organic movement for inner life visualization)
- Don't create loops with obvious repeat points
- Don't distract from content with motion
- Don't make users wait for animations to complete
- Don't use animation to obscure slow performance

## Component Guidelines

### Buttons

**Primary Button**
- White background
- Dark text
- Rounded corners
- Subtle scale on hover
- Used for primary actions only

**Secondary Button**
- Transparent or subtle dark background
- Light border or no border
- White text
- Used for secondary actions

**Hierarchy**
One primary button per view/context. If multiple actions exist, use visual hierarchy to indicate importance.

### Inputs

**Text Inputs**
- Dark background slightly lighter than page
- Subtle border or rim lighting
- Clear focus state with rim lighting emphasis
- Generous padding

**States**
- Default: Subtle, doesn't demand attention
- Focus: Clear but not jarring, rim lighting intensifies
- Error: Red border/indicator, error message below
- Disabled: Reduced opacity

### Cards

**Standard Card**
- Dark background
- Gradient border rim lighting
- Rounded corners
- Generous internal padding
- Clear content hierarchy

**Interactive Card**
- Same as standard with hover state
- Subtle scale or rim lighting shift on hover
- Clear indication of clickability

### Dialogs & Modals

**Appearance**
- Centered or contextually positioned
- Generous radius
- Prominent rim lighting (highest elevation)
- Dark backdrop to focus attention

**Animation**
- Fade and subtle scale on appearance
- Smooth dismissal

### Status Indicators

**Visual Treatment**
- Small, unobtrusive when passive
- Clear semantic color
- Can pulse gently for active states
- Text label for clarity when needed

## Accessibility Notes

*Formal accessibility compliance is not the current focus, but these principles support future accessibility work:*

- Maintain sufficient contrast between text and backgrounds
- Don't rely solely on color to convey information
- Ensure interactive elements are clearly distinguishable
- Support keyboard navigation patterns
- Consider reduced-motion preferences in animation system

## Summary

Good design in Animus is:
- **Simple** — only what's needed
- **Clear** — instantly understandable
- **Warm** — approachable and human
- **Alive** — subtly breathing, always present
- **Restrained** — elegant in its economy

The interface should feel like a calm, warm space where something alive resides. It should never overwhelm, never confuse, never demand. It should simply be — present, capable, and quietly beautiful.

---

*Design is how Animus feels. Make it feel alive.*
