# Cron Schedule Editor -- Design Spec

## Purpose

The Cron Schedule Editor replaces the raw cron expression text input in the EditTaskModal with a human-friendly visual schedule builder. Most users do not know cron syntax. The editor lets them describe *when* something should happen using familiar concepts -- time of day, days of the week, monthly dates -- and generates the cron expression behind the scenes.

This component serves the user who is editing a recurring task and needs to set or change its schedule. They should never need to think about five-field cron notation. The interface should feel like answering a simple question: "When should this happen?"

**User need:** "I want this task to run every weekday at 9am" or "I need this on the 1st and 15th of every month at noon."

---

## Design Philosophy

The schedule editor lives inside a modal that already contains other form fields (title, description, instructions, priority). It replaces a single text input. The design must be compact and focused -- it cannot dominate the modal or feel like its own page. The schedule editor should feel like a well-crafted form section, not a separate tool.

**Guiding Principles:**
- **Human-readable first** -- The user describes their schedule in human terms. The cron expression is an implementation detail.
- **Progressive complexity** -- Common patterns (daily, weekly, monthly) are trivially easy. Uncommon patterns (specific months, day-of-month lists, intervals) are available but don't clutter the common path.
- **Always preview** -- The user always sees a plain-English description of what they have configured. This is the primary feedback mechanism.
- **Familiar vocabulary** -- Use time-related language everyone knows: "Daily", "Weekly", "Monthly", days of the week, AM/PM time.

---

## Research: How Others Solve This

Before designing, I surveyed how established tools handle cron/schedule configuration:

**GitHub Actions:** Uses a raw cron input with documentation links. No visual builder. Not user-friendly.

**Netlify / Vercel:** Similar raw cron inputs with examples dropdown. Slightly better but still requires cron literacy.

**cron-job.org:** Offers a tabbed interface with "Simple" and "Advanced" modes. Simple mode has dropdowns for frequency (hourly, daily, weekly, monthly) that reveal relevant sub-fields. Advanced mode shows five individual field inputs. The simple mode is well-designed but tries to cover every case in a single form, making it visually dense.

**Google Cloud Scheduler:** Dropdown for frequency type, then contextual fields. Clean but corporate-feeling.

**macOS Calendar (recurring events):** The best consumer-facing model. A single "Repeat" dropdown (Daily, Weekly, Monthly, Custom) with contextual controls. "Custom" opens a compact dialog with interval + day selectors. Familiar to millions of users.

**Common patterns across all good implementations:**
1. A primary frequency selector (how often)
2. Contextual controls that change based on frequency
3. A preview/summary of what was configured
4. An escape hatch to raw editing for power users

**The Animus approach:** We adopt the frequency-first pattern (inspired by macOS Calendar and cron-job.org's simple mode) but with Animus's warm, spacious aesthetic. A segmented frequency selector at the top drives which sub-controls appear below. An advanced toggle reveals the raw cron input for power users.

---

## Interaction Model

### Primary Flow

```
User opens EditTaskModal for a recurring task
    |
    v
Schedule section shows current schedule as a
human-readable summary with a frequency selector
    |
    | User selects frequency: Minutes / Hourly / Daily / Weekly / Monthly
    v
Contextual controls appear below the selector:
  - Minutes:  "Every [N] minutes" interval picker
  - Hourly:   "Every [N] hours" interval picker + optional minute offset
  - Daily:    Time picker
  - Weekly:   Day-of-week toggles + time picker
  - Monthly:  Day-of-month selector + time picker
    |
    | Live preview updates with every change
    v
User saves the task (existing Save button in the modal)
```

### Advanced Flow

```
User clicks "Edit as expression" link
    |
    v
Switches to raw cron input with humanized preview
(same as current implementation, but accessible via toggle)
    |
    | User can switch back to visual mode
    | (if the expression maps to a supported pattern)
    v
Visual editor re-parses the expression and shows
the appropriate frequency + controls
```

---

## Component Architecture

```
CronScheduleEditor (root)
  |
  +-- SchedulePreview          (human-readable summary, always visible)
  |
  +-- FrequencySelector        (segmented control: Minutes / Hourly / Daily / Weekly / Monthly)
  |
  +-- FrequencyPanel           (contextual controls, one of:)
  |     +-- MinutesPanel       (interval stepper)
  |     +-- HourlyPanel        (interval stepper + minute offset)
  |     +-- DailyPanel         (time picker)
  |     +-- WeeklyPanel        (day toggles + time picker)
  |     +-- MonthlyPanel       (day-of-month selector + time picker)
  |
  +-- MonthFilter              (optional: "Only in these months" collapsible)
  |
  +-- AdvancedToggle           (text link to switch to raw cron input)
  |
  +-- RawCronInput             (only visible in advanced mode)
```

### Props

```typescript
interface CronScheduleEditorProps {
  value: string;             // Current cron expression (e.g., "0 9 * * 1-5")
  onChange: (cron: string) => void;  // Called whenever the expression changes
}
```

### Internal State

```typescript
interface EditorState {
  mode: 'visual' | 'raw';

  // Visual mode state
  frequency: 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly';
  minuteInterval: number;        // For "every N minutes" (1-59)
  hourInterval: number;          // For "every N hours" (1-23)
  minuteOffset: number;          // For hourly: which minute of the hour (0-59)
  time: { hour: number; minute: number };  // 24h format for daily/weekly/monthly
  weekdays: boolean[];           // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  monthDays: number[];           // Selected days of month (1-31)
  months: number[];              // Selected months (1-12), empty = all months

  // Raw mode state
  rawExpression: string;
}
```

### Cron Expression Mapping

The visual editor maps its state to cron fields as follows:

| Frequency | minute | hour | day-of-month | month | day-of-week | Example |
|-----------|--------|------|--------------|-------|-------------|---------|
| Minutes   | `*/N`  | `*`  | `*`          | `*`/filtered | `*` | `*/15 * * * *` |
| Hourly    | `M`    | `*/N`| `*`          | `*`/filtered | `*` | `30 */2 * * *` |
| Daily     | `M`    | `H`  | `*`          | `*`/filtered | `*` | `0 9 * * *` |
| Weekly    | `M`    | `H`  | `*`          | `*`/filtered | `D,D,D` | `0 9 * * 1,3,5` |
| Monthly   | `M`    | `H`  | `D,D`        | `*`/filtered | `*` | `0 12 * * 1,15` |

When months are filtered, the month field changes from `*` to the selected months (e.g., `1,3,5` for Jan, Mar, May).

### Parsing Existing Expressions

When the editor receives an existing cron expression (via `value` prop), it attempts to parse it back into visual editor state:

1. Split into 5 fields
2. Detect which frequency pattern it matches:
   - `*/N * * * *` --> Minutes, interval N
   - `M */N * * *` --> Hourly, interval N, offset M
   - `M H * * *` --> Daily at H:M
   - `M H * * D,D,...` --> Weekly on days D at H:M
   - `M H D,D,... * *` --> Monthly on days D at H:M
3. Check for month filtering (field 4 is not `*`)
4. If the expression does not match any visual pattern, default to raw mode

Expressions that use ranges (`1-5`), step patterns on specific ranges (`10-20/2`), or simultaneous day-of-month and day-of-week are not representable in visual mode and fall through to raw mode.

---

## Screen: CronScheduleEditor

### Layout

The editor replaces the current "Cron Expression" text input in the EditTaskModal. It occupies the same vertical position in the form. Total height varies by frequency but remains compact -- approximately 120-200px depending on the selected frequency.

**Vertical stack:**
1. **Schedule Preview** -- Top of section. The most prominent element.
2. **Frequency Selector** -- Segmented control, full width of the form column.
3. **Frequency Panel** -- Contextual controls specific to the selected frequency.
4. **Month Filter** -- Collapsible, hidden by default.
5. **Advanced Toggle** -- Small text link at the bottom right.

### Content

**Section label:** "Schedule" (matches the existing form label style: 14px Medium, secondary text color)

**Schedule Preview copy examples:**
- "Every 15 minutes"
- "Every 2 hours at :30"
- "Daily at 9:00 AM"
- "Mondays, Wednesdays, Fridays at 3:00 PM"
- "1st and 15th of each month at 12:00 PM"
- "Every weekday at 8:00 AM (Jan, Mar, May only)"

**Frequency selector labels:** "Minutes" | "Hourly" | "Daily" | "Weekly" | "Monthly"

**Advanced toggle:** "Edit as expression" / "Use visual editor" (text link, hint color)

### Information Hierarchy

1. **Primary:** Schedule Preview -- the human-readable summary is the most important element. The user should always see what their schedule means in plain English. Displayed in serif font (Crimson Pro) at body size, slightly above the controls.
2. **Secondary:** Frequency controls -- the interactive elements that build the schedule.
3. **Tertiary:** Month filter and advanced toggle -- available but not prominent.

---

## Sub-Component: SchedulePreview

### Layout

A single line (or two lines for complex schedules) of text displayed above the frequency selector. Uses Crimson Pro (serif) to visually distinguish it from the form chrome around it. This gives it the quality of something the system is "saying" -- a statement of what the schedule means.

### Visual Treatment

- Font: Crimson Pro, body size (16px), regular weight, primary text color
- A subtle CalendarBlank icon (14px, hint color) to the left of the text
- If the expression is invalid: the preview shows "Invalid schedule" in error color (red)
- If no expression is set yet: the preview shows "Choose when this should run" in hint color

### Next Occurrence Line

For **interval-based schedules** (Minutes and Hourly frequencies), the preview includes a second line showing the next concrete fire time. This answers the question "but when exactly will it run next?" which is ambiguous for intervals but obvious for specific-time schedules.

**When to show it:**
- `*/N * * * *` (every N minutes) — show next occurrence
- `M */N * * *` (every N hours) — show next occurrence
- Daily/Weekly/Monthly at a specific time — **do not show**. The schedule itself already makes the next time obvious ("Mondays at 9:00 AM" needs no clarification).

**Display:**
```
Every 15 minutes
Next: 2:45 PM today
```

The second line uses `Typography.Caption` at hint color, slightly indented or with a subtle "Next:" prefix. If the next occurrence is today, show "3:45 PM today". If tomorrow, show "9:00 AM tomorrow". Beyond that, show the date: "Wed at 3:00 PM" or "Feb 20 at 10:00 AM" (reuse the existing `formatScheduleTime()` helper from TasksSection).

**Computation:** The next occurrence is computed client-side from the cron expression and the current time. For `*/N` minute intervals, it's `Math.ceil(currentMinute / N) * N` in the current hour (or the next hour if past :59). For `*/N` hour intervals with minute offset M, it's the next hour divisible by N where minute >= M. This is lightweight math — no cron parsing library needed.

**Live updates:** The "Next:" line re-computes every 30 seconds via a `setInterval` inside the component, so it stays accurate while the modal is open. The timer is cleaned up on unmount.

### Micro-interaction

When the schedule changes, the preview text cross-fades: the old text fades out (100ms) while the new text fades in (150ms) with a 2px upward drift. This subtle movement signals that the value has updated without being distracting. Timing: 200ms total, ease-out.

---

## Sub-Component: FrequencySelector

### Layout

A segmented control (pill-shaped container with five options). Each segment is an equal-width button. The container sits at the full width of the form column.

### Visual Treatment

- Container: `background.elevated` with a 1px border at `border.default`. `borderRadius.default` (8px). Height: 36px.
- Inactive segments: transparent background. Text in `text.secondary` color, 13px Outfit Medium.
- Active segment: `accent` background with `accentForeground` text. Rounded to match the container's inner radius. A subtle shadow to lift it slightly above its siblings.
- Hover on inactive: `background.elevated` slightly intensified (0.12 opacity lift).

### Micro-interaction

When switching frequency, the active indicator slides horizontally from the previous position to the new one (200ms, ease-out). The sliding motion is achieved with a positioned background div that animates its `left` property. This creates a satisfying physical feel -- the selector "moves" rather than "swaps."

Simultaneously, the frequency panel below cross-fades: the outgoing panel fades out and collapses in height (150ms) while the incoming panel expands and fades in (200ms). These overlap slightly so the transition feels continuous, not sequential.

### Keyboard

- Tab to focus the selector group
- Arrow Left/Right to switch between frequencies
- The focused option has a focus ring at `border.focus`

---

## Sub-Component: MinutesPanel

### Purpose

Configure "every N minutes" schedules.

### Layout

A single row with an interval stepper:

```
Every [ 15 ] minutes
```

### Controls

- **Interval stepper:** A compact number input flanked by minus and plus buttons. Value range: 1-59. Common presets shown below as small clickable chips: 5, 10, 15, 20, 30.
- The word "minutes" is static text.
- "Every" is static text in secondary color.

### Generated Expression

`*/N * * * *` where N is the selected interval.

If N is 1, the expression is `* * * * *` (every minute).

---

## Sub-Component: HourlyPanel

### Purpose

Configure "every N hours" schedules, optionally at a specific minute within the hour.

### Layout

Two rows:

```
Every [ 2 ] hours
at :[ 00 ] past the hour
```

### Controls

- **Hour interval stepper:** Same style as MinutesPanel. Value range: 1-23. Common presets: 2, 3, 4, 6, 8, 12.
- **Minute offset:** A compact two-digit number input (0-59) with a ":" prefix character displayed outside the input, creating a clock-like feel. Defaults to 0 (top of the hour). The "past the hour" text is secondary color.

### Generated Expression

`M */N * * *` where M is the minute offset and N is the hour interval.

---

## Sub-Component: DailyPanel

### Purpose

Configure "every day at a specific time."

### Layout

A single row with a time picker:

```
Every day at [ 9 ] : [ 00 ] [ AM ]
```

### Controls

- **Time picker:** Three inline inputs:
  - Hour: number input, 1-12 (displayed in 12-hour format)
  - Minute: two-digit number input, 00-59
  - AM/PM toggle: a compact segmented control (two options, same style as the frequency selector but smaller)
- A colon character sits between the hour and minute inputs, styled as primary text.
- The "Every day at" text is secondary color.

### Visual Treatment

The three time inputs are grouped tightly with minimal spacing (4px gaps), visually forming a single "time" cluster. Each input has a subtle bottom border rather than a full border, keeping the cluster feeling unified. Width: hour = 32px, minute = 32px, AM/PM toggle = 56px.

### Generated Expression

`M H * * *` where H is the 24-hour converted hour and M is the minute.

---

## Sub-Component: WeeklyPanel

### Purpose

Configure schedules that run on specific days of the week at a specific time.

### Layout

Two rows:

```
[S] [M] [T] [W] [T] [F] [S]       <-- day toggles

at [ 9 ] : [ 00 ] [ AM ]           <-- time picker
```

### Controls

- **Day-of-week toggles:** Seven circular buttons, each 36px diameter, labeled with single-letter abbreviations: S, M, T, W, T, F, S. Full day names shown on hover via tooltip.
  - Unselected: transparent background, `text.hint` color, 1px border at `border.default`
  - Selected: `accent` background, `accentForeground` text, no border
  - At least one day must be selected. If the user deselects the last remaining day, it stays selected (no empty state).

- **Time picker:** Same component as DailyPanel's time picker.

- **Shortcut chips** (below the day toggles, optional): Small text links "Weekdays" and "Every day" that quickly select Mon-Fri or all seven days. These appear when fewer than 5 days are selected, providing a fast path for common patterns.

### Micro-interaction

Toggling a day on: the circle fills from center outward (100ms, ease-out) with a subtle scale pulse (1.05x, 80ms). Toggling off: fill recedes to center (100ms).

### Generated Expression

`M H * * D` where D is a comma-separated list of selected day numbers (0=Sun, 1=Mon, ... 6=Sat), and H:M is the time.

If all seven days are selected, the expression uses `*` for day-of-week (equivalent to Daily, but shown in weekly mode because the user explicitly selected all days).

Consecutive day ranges are compressed: Mon-Fri becomes `1-5` rather than `1,2,3,4,5`.

---

## Sub-Component: MonthlyPanel

### Purpose

Configure schedules that run on specific days of the month at a specific time.

### Layout

Two sections:

```
On day(s):
  [ 1 ] [ 15 ]                     <-- selected day chips
  + Add day                         <-- button to add more

at [ 12 ] : [ 00 ] [ PM ]          <-- time picker
```

### Controls

- **Day-of-month selector:** Selected days appear as removable chips (similar to tag inputs). Each chip shows the day number with ordinal suffix (1st, 2nd, 3rd, 15th). Clicking the "x" on a chip removes it.
  - **Add day:** A small "+ Add day" button opens a compact number grid popover showing days 1-31 in a 7-column layout. Days already selected are highlighted. Clicking a day adds it and the popover stays open for multi-selection. Clicking outside or pressing Escape closes the popover. At least one day must be selected.

- **Time picker:** Same component as DailyPanel's time picker.

### Day Grid Popover

- Layout: 7 columns x 5 rows (31 days + empty cells)
- Cell size: 32px square, centered text
- Unselected: transparent, `text.secondary`
- Selected: `accent` background, `accentForeground` text, `borderRadius.sm`
- Hover: `background.elevated`
- The popover has `borderRadius.md`, rim lighting, and appears directly below the "+ Add day" button with a 4px gap
- Enter/exit: fade + 4px upward drift (150ms, ease-out)

### Generated Expression

`M H D * *` where D is a comma-separated sorted list of selected days, and H:M is the time.

---

## Sub-Component: MonthFilter

### Purpose

Restrict the schedule to specific months. This is an optional refinement available across all frequency types. Most users will never need it, so it is collapsed by default.

### Layout

A collapsible section below the frequency panel:

```
[v] Only run in specific months
    [Jan] [Feb] [Mar] [Apr] [May] [Jun]
    [Jul] [Aug] [Sep] [Oct] [Nov] [Dec]
```

### Controls

- **Collapse toggle:** A checkbox with label "Only run in specific months." When unchecked, the month grid is hidden and the cron month field is `*`. When checked, the month grid appears.
- **Month toggles:** Twelve rectangular buttons arranged in two rows of six. Each shows the three-letter month abbreviation.
  - Unselected: transparent background, `text.hint` color, subtle border
  - Selected: `accent` background, `accentForeground` text
  - Same toggle micro-interaction as the weekday buttons (but rectangular, `borderRadius.sm`)
  - At least one month must be selected when the filter is active.

### Generated Expression

When active, the month field changes from `*` to a comma-separated list of selected month numbers (1=Jan, ... 12=Dec). Consecutive ranges are compressed (e.g., `1-6` for Jan through Jun).

When inactive, the month field is `*`.

---

## Sub-Component: AdvancedToggle and RawCronInput

### Purpose

Power users may want to write cron expressions directly, or the existing expression may not be representable in visual mode.

### Layout

A text link at the bottom-right of the editor section:

- In visual mode: "Edit as expression" (hint color, 12px)
- In raw mode: "Use visual editor" (hint color, 12px)

### Raw Mode Layout

When in raw mode, the entire visual editor (frequency selector, panels, month filter) is replaced by:

```
Cron Expression
[ 0 9 * * 1-5                    ]
Weekdays at 9:00 AM
```

This is the current implementation's text input with humanized preview. The input uses the standard Input component. The preview uses the existing `humanizeCron()` function.

### Switching Between Modes

**Visual to Raw:** Immediate switch. The current generated expression appears in the raw input.

**Raw to Visual:** The editor attempts to parse the raw expression into visual state:
- If parseable: switches to visual mode with the appropriate frequency and controls pre-filled.
- If not parseable (complex expression): shows a brief inline warning "This expression is too complex for the visual editor" and stays in raw mode. The warning uses `text.hint` color and fades in (150ms).

---

## States

### Default (New Task / Empty)

When no cron expression exists yet:
- Frequency selector defaults to "Daily"
- Time defaults to 9:00 AM
- Preview shows "Daily at 9:00 AM"
- The editor is immediately usable -- no blank/empty state

### Populated (Editing Existing Task)

The editor parses the existing expression and pre-fills all controls. If the expression maps to a visual pattern, visual mode is active. If not, raw mode is shown automatically.

### Error

If the raw mode input contains an invalid expression:
- Preview shows "Invalid schedule" in `error.main` color
- A small error icon (WarningCircle, 14px) appears next to the preview text
- The modal's Save button should remain enabled (validation happens on the backend) but the user has a clear signal that something is wrong

### Disabled

If the task is not a recurring type, this component is not rendered at all (handled by the parent modal).

---

## Responsive Behavior

The editor lives inside a modal, which already handles responsive behavior.

### Desktop (>1024px)

Full layout as described. The frequency selector shows all five options comfortably. Day-of-week toggles are a single row. Month toggles are two rows of six.

### Tablet (768-1024px)

Same layout. The modal may be slightly narrower but the editor's controls are compact enough to fit.

### Mobile (<768px)

- Frequency selector: text size may decrease slightly (12px) to fit five options. If space is still tight, the selector could wrap to a 3+2 layout, but the current five options at 12px should fit at 320px minimum width.
- Day-of-week toggles: remain a single row at 32px diameter (224px total, fits in 320px with padding).
- Month toggles: may stack to three rows of four if the modal is very narrow.
- Time picker inputs: same sizing, adequate at any width.

---

## Shared Time Picker Component

The time picker is reused across DailyPanel, WeeklyPanel, and MonthlyPanel. It should be extracted as a shared sub-component.

### TimePicker Props

```typescript
interface TimePickerProps {
  hour: number;       // 0-23 (internal, 24h)
  minute: number;     // 0-59
  onChange: (hour: number, minute: number) => void;
}
```

### TimePicker Layout

```
[ 9 ] : [ 00 ] [ AM | PM ]
```

- Hour input: `type="number"`, min 1, max 12, displayed in 12h format, width 36px
- Separator: ":" character in primary text, 14px
- Minute input: `type="number"`, min 0, max 59, zero-padded display, width 36px
- AM/PM toggle: compact segmented control, height 32px, total width 60px

### TimePicker Interactions

- Clicking the hour or minute input selects all text for easy replacement
- Arrow Up/Down increment/decrement the focused field
- Typing past the max value wraps (typing "13" in hour becomes "1" and shifts to PM, typing "60" in minutes wraps to "00")
- Tab moves between hour, minute, and AM/PM
- The inputs have minimal chrome -- subtle bottom border only, no full box border. This keeps the time picker feeling like a single cohesive element.

---

## Implementation Notes

### Cron Generation

The component maintains internal state and generates the cron expression on every change, calling `onChange(expression)` immediately. The parent component receives a valid cron string and does not need to understand the visual state.

### Expression Parsing

A `parseCronToVisualState()` utility function handles the reverse mapping. This function is called once when the component mounts (or when `value` changes externally) to determine whether visual mode can represent the expression.

### Reuse of humanizeCron

The existing `humanizeCron()` function in TasksSection.tsx should be extracted to a shared utility (e.g., `packages/frontend/src/utils/cron.ts`) and reused by both the SchedulePreview component and the task card display.

### No External Dependencies

The cron parsing and generation logic should be implemented inline -- no need for a cron parsing library. The five-field standard cron format is well-defined and the patterns we support in visual mode are a small, manageable subset.

---

## Micro-Interaction Summary

| Element | Interaction | Animation | Timing |
|---------|-------------|-----------|--------|
| Schedule Preview | Text changes | Cross-fade with 2px upward drift | 200ms ease-out |
| Frequency Selector | Switch frequency | Active indicator slides horizontally | 200ms ease-out |
| Frequency Panel | Panel changes | Cross-fade with height animation | 150-200ms ease-out |
| Day-of-week toggle | Toggle on | Fill from center + 1.05x scale pulse | 100ms ease-out |
| Day-of-week toggle | Toggle off | Fill recedes to center | 100ms ease-out |
| Month toggle | Toggle on/off | Same as day-of-week | 100ms ease-out |
| Day grid popover | Open | Fade in + 4px upward drift | 150ms ease-out |
| Day grid popover | Close | Fade out | 100ms ease-out |
| Mode switch | Visual <-> Raw | Cross-fade of entire editor content | 200ms ease-out |
| Error state | Invalid expression | Preview text color transitions to red | 150ms ease-out |

All animations use ease-out curves. No bounce, no spring, no overshoot in the form controls. The only exception is the day-of-week toggle's scale pulse, which adds a subtle physical quality to the toggle interaction.

---

## Full Example: Building "Weekdays at 9am"

1. User opens EditTaskModal for a recurring task
2. The schedule section shows the current schedule (or defaults to "Daily at 9:00 AM")
3. User clicks "Weekly" in the frequency selector
4. The active indicator slides from "Daily" to "Weekly"
5. The daily time picker fades out; the weekly panel fades in showing all seven day toggles (none selected) and a time picker
6. User clicks M, T, W, T, F toggles -- each fills with a satisfying micro-animation
7. The "Weekdays" shortcut chip disappears (all weekdays now selected manually)
8. Time is already set to 9:00 AM from the previous Daily state
9. Preview updates: "Weekdays at 9:00 AM"
10. User clicks Save -- the expression `0 9 * * 1-5` is saved to the task

---

## Full Example: Building "1st and 15th at noon, only in Q1"

1. User clicks "Monthly" in the frequency selector
2. Monthly panel appears with an empty day list and time picker
3. User clicks "+ Add day" -- a grid popover appears showing days 1-31
4. User clicks "1" (it highlights) then "15" (it highlights)
5. User clicks outside the popover -- it closes
6. Two chips appear: "1st" and "15th"
7. User sets time to 12:00 PM
8. Preview: "1st and 15th of each month at 12:00 PM"
9. User checks "Only run in specific months"
10. Month grid appears. User selects Jan, Feb, Mar
11. Preview updates: "1st and 15th of each month at 12:00 PM (Jan, Feb, Mar)"
12. Generated expression: `0 12 1,15 1-3 *`

---

## Edge Cases

### Expression with both day-of-month and day-of-week

Standard cron allows setting both fields simultaneously (e.g., `0 9 15 * 1` = "9am on the 15th AND every Monday"). This creates OR semantics that are confusing. The visual editor does not support this -- such expressions fall through to raw mode.

### Day 29, 30, 31 in monthly

The editor allows selecting days 29-31 even though not all months have them. This is standard cron behavior -- the day is simply skipped in months that are shorter. No special handling needed, but a subtle hint could appear: "Some months have fewer than 31 days. The schedule will skip months where the selected day doesn't exist." This hint appears in `text.hint` color only when day 29, 30, or 31 is selected.

### Minute intervals that don't divide evenly into 60

Intervals like 7, 11, 13 are valid cron but produce non-intuitive fire times (e.g., `*/7` fires at :00, :07, :14, :21, :28, :35, :42, :49, :56). The editor allows any value 1-59 without restriction. The preview shows the interval faithfully: "Every 7 minutes."

### Timezone

All times displayed and configured in the editor are in the user's configured timezone (stored in `system.db`). The cron expression itself is timezone-agnostic -- timezone conversion happens at evaluation time in the task scheduler. No timezone indicator is needed in the editor UI since the entire Animus instance operates in a single timezone.

---

## References

- `docs/architecture/tasks-system.md` -- Task types, cron validation, timezone handling
- `docs/frontend/design-principles.md` -- Component guidelines, animation principles, visual system
- `docs/brand-vision.md` -- Warm, practical, approachable
- `packages/frontend/src/components/mind/TasksSection.tsx` -- Current implementation, `humanizeCron()` function, `EditTaskModal`
- `packages/frontend/src/styles/theme.ts` -- Theme tokens (colors, spacing, typography, transitions)
- `packages/frontend/src/components/ui/` -- Existing UI components (Input, Toggle, Button, Badge, SelectionCard, Slider)
