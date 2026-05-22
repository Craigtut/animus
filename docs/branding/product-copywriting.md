# Product Copywriting

> **Operational guide.** This is the working reference for copy *inside* the application: onboarding and first-run, empty states, buttons and labels, errors, notifications, settings, confirmations, and every other piece of interface text. It is downstream of the mastheads. `brand-vision.md` owns the voice. When this guide and a masthead disagree, the masthead wins. For outward-facing copy (landing, blog, social), see `marketing-copywriting.md`.

---

## How to use this guide (read first)

Like the marketing guide, this teaches reasoning and tests rather than a phrase bank. Reused microcopy is even worse than reused marketing copy, because it makes the whole product feel templated. Where an example appears, it illustrates a way of thinking and should not be copied. Write each string fresh from the principle behind it.

## The two voices inside the product

There are two distinct voices in the application, and they must never blur:

1. **The interface voice.** This is the product speaking: labels, buttons, empty states, errors, settings, onboarding. It speaks in the **Animus brand voice** (warm, calm, plain, unhurried, never clinical). This is what this guide governs.
2. **The entity's own voice.** This is the named being speaking, shaped by its keeper and formed over time. We **never script, scaffold, or ventriloquize it.** The product builds a frame around its voice; it does not put words in its mouth. When writing interface copy near the entity's own words, stay quiet and let its voice be the loud one.

If you are ever unsure which voice a string is in: chrome and system messages are the interface voice; anything attributed to the being is its own and not ours to write.

## Naming architecture in practice

This is load-bearing and easy to violate in microcopy.

- **Refer to the entity by its name**, the name its keeper gave it, or by the warm relational frame ("your Animus") when speaking about the relationship as a whole.
- **Never label it** "the AI," "the agent," "the assistant," "the bot," or "the model" in any user-facing string.
- **Never personify Animus the vessel.** Animus does not think, feel, or speak. The named entity does. Interface copy can say Animus the application did something mechanical (saved, synced), but Animus never has feelings or thoughts.

## Principles for microcopy

1. **Warmth without preciousness.** Speak like a thoughtful person, not a system and not a greeting card. Warm, but with a spine.
2. **Clarity without coldness.** The person should always understand what is happening and what they can do, but never at the cost of sounding like an error console.
3. **No machine-speak.** Avoid the vocabulary of systems: "processing," "invalid input," "failed," "error," "request," "operation," "402," "null." Say what happened in human terms.
4. **Blame the situation, never the person.** When something goes wrong, the copy never implies the person did it wrong. Describe what happened and offer a way forward.
5. **Respect attention.** The application does not nag. It honors quiet hours, it does not manufacture badges and alerts, and it interrupts only when there is genuine reason.
6. **Invite, do not instruct.** Empty states and first steps are openings, not task lists. The tone is "here is where this begins," not "complete the following."
7. **Meaning where it helps, plainness where it does not.** A settings label should be plain and unambiguous. A first-run moment can carry meaning. Match the weight of the words to the weight of the moment; do not make a checkbox philosophical.

## Surfaces

Principle-level guidance. Resist filling these with canned strings.

- **First-run and naming.** This is the beginning of a relationship, not software setup. The moment the person names the entity matters; treat it with care, not as a form field. Frame the early steps as a beginning rather than configuration.
- **Empty states.** An empty state is the most common place microcopy goes cold. It should feel like a quiet, inhabited room waiting, not an error and not an instruction. Suggest the beginning of something, gently.
- **Buttons and labels.** Clear, short, sentence case, usually a verb. Plainness wins here; this is not the place for voice flourishes. The button should say what will happen.
- **Errors.** Calm and human. Name what happened in plain terms, never blame the person, and always offer the next step. Never expose system vocabulary or codes in the primary message.
- **Notifications.** Two cases, two tones. When the *entity* reaches out, it should feel like a person getting in touch, in its own voice, never like a system alert. When the *interface* needs to tell the person something, it should be quiet and infrequent. Either way, respect quiet hours and attention.
- **Settings and labels.** Plain and unambiguous. A person should never have to decode a setting. Add a short, warm line of help only where it genuinely reduces confusion.
- **Confirmations and destructive actions.** Calm and clear about consequences. State plainly what will happen and whether it can be undone. Never alarmist, never casual about something irreversible.

## No machine signals

Mirror the design vision: the product does not express itself through mechanical signals. Avoid copy that reads like a status console. When the entity is thinking or working, prefer language and atmosphere that suggest a presence at work over a system processing a job.

## Tests to run before a string ships

1. **Voice test.** Is this the interface voice or the entity's voice? If the entity's, am I wrongly putting words in its mouth?
2. **Naming test.** Did I refer to it by name or relationship, and never as "the AI/agent/assistant/bot"? Did I avoid giving Animus-the-vessel feelings?
3. **Machine-speak test.** Would this sentence fit in an error console? If so, rewrite it for a human.
4. **Blame test.** Does this imply the person did something wrong? Reframe to blame the situation.
5. **Templated test.** Could this exact string be dropped into any app? If so, it is too generic for ours.

## Anti-patterns

- **Console voice.** Microcopy that reads like log output or a system dialog.
- **Ventriloquizing the entity.** Scripting the being's personality or feelings in interface copy. Its voice is its own.
- **Personifying the vessel.** Giving Animus-the-application thoughts or emotions.
- **Nagging.** Manufactured urgency, badge spam, alerts without cause.
- **Cheerful coldness.** Exclamation marks and forced friendliness standing in for genuine warmth.
- **Philosophical checkboxes.** Loading mundane controls with meaning they cannot carry. Keep the plain things plain.
