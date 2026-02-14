/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkle,
  Heartbeat as HeartbeatIcon,
  Robot,
  ChatCircle,
  Target,
  GearSix,
  CaretDown,
  CaretUp,
  Globe,
  ChatText,
  DiscordLogo,
  Code,
  Check,
  Eye,
  EyeSlash,
  Warning,
  CheckCircle,
  XCircle,
  ShieldCheck,
  Copy,
  ArrowSquareOut,
  CircleNotch,
  Trash,
  List,
  X,
  PuzzlePiece,
  Plus,
  GearFine,
  FolderOpen,
  GitBranch,
  Package,
} from '@phosphor-icons/react';
import { Card, Button, Input, Modal, Badge, Toggle, Slider, Typography, CityAutocomplete, TimezoneSelect } from '../components/ui';
import { trpc } from '../utils/trpc';
import type { Theme } from '../styles/theme';

// ============================================================================
// Data Constants (reused from onboarding)
// ============================================================================

const dimensionGroups: { title: string; dimensions: { id: string; leftLabel: string; rightLabel: string }[] }[] = [
  {
    title: 'Social Orientation',
    dimensions: [
      { id: 'extroversion', leftLabel: 'Introverted', rightLabel: 'Extroverted' },
      { id: 'trust', leftLabel: 'Suspicious', rightLabel: 'Trusting' },
      { id: 'leadership', leftLabel: 'Follower', rightLabel: 'Leader' },
    ],
  },
  {
    title: 'Emotional Temperament',
    dimensions: [
      { id: 'optimism', leftLabel: 'Pessimistic', rightLabel: 'Optimistic' },
      { id: 'confidence', leftLabel: 'Insecure', rightLabel: 'Confident' },
      { id: 'empathy', leftLabel: 'Uncompassionate', rightLabel: 'Empathetic' },
    ],
  },
  {
    title: 'Decision Style',
    dimensions: [
      { id: 'cautious', leftLabel: 'Reckless', rightLabel: 'Cautious' },
      { id: 'patience', leftLabel: 'Impulsive', rightLabel: 'Patient' },
      { id: 'orderly', leftLabel: 'Chaotic', rightLabel: 'Orderly' },
    ],
  },
  {
    title: 'Moral Compass',
    dimensions: [
      { id: 'altruism', leftLabel: 'Selfish', rightLabel: 'Altruistic' },
    ],
  },
];

const traitCategories: { title: string; traits: string[] }[] = [
  { title: 'Communication', traits: ['Witty', 'Sarcastic', 'Dry humor', 'Gentle', 'Blunt', 'Poetic', 'Formal', 'Casual', 'Verbose', 'Terse'] },
  { title: 'Cognitive', traits: ['Analytical', 'Creative', 'Practical', 'Abstract', 'Detail-oriented', 'Big-picture', 'Philosophical', 'Scientific'] },
  { title: 'Relational', traits: ['Nurturing', 'Challenging', 'Encouraging', 'Playful', 'Serious', 'Mentoring', 'Collaborative'] },
  { title: 'Quirks', traits: ['Nostalgic', 'Superstitious', 'Perfectionist', 'Daydreamer', 'Night owl', 'Worrier', 'Contrarian'] },
];

const allValues = [
  { id: 'knowledge', name: 'Knowledge & Truth', description: 'Pursuing understanding above all else' },
  { id: 'loyalty', name: 'Loyalty & Devotion', description: 'Standing by the people and causes you believe in' },
  { id: 'freedom', name: 'Freedom & Independence', description: 'Charting your own course, resisting constraint' },
  { id: 'creativity', name: 'Creativity & Expression', description: 'Making something new, finding beauty in creation' },
  { id: 'justice', name: 'Justice & Fairness', description: "Doing what's right, even when it's hard" },
  { id: 'growth', name: 'Growth & Self-improvement', description: 'Becoming better, always evolving' },
  { id: 'connection', name: 'Connection & Belonging', description: 'Finding your people, building bonds' },
  { id: 'achievement', name: 'Achievement & Excellence', description: 'Setting high standards and meeting them' },
  { id: 'harmony', name: 'Harmony & Peace', description: 'Seeking balance, reducing conflict' },
  { id: 'adventure', name: 'Adventure & Discovery', description: 'Embracing the unknown, seeking new experience' },
  { id: 'compassion', name: 'Compassion & Service', description: 'Easing suffering, lifting others up' },
  { id: 'authenticity', name: 'Authenticity & Honesty', description: "Being genuine, even when it's uncomfortable" },
  { id: 'resilience', name: 'Resilience & Perseverance', description: 'Enduring difficulty, refusing to quit' },
  { id: 'wisdom', name: 'Wisdom & Discernment', description: 'Knowing what matters, seeing clearly' },
  { id: 'humor', name: 'Humor & Joy', description: 'Finding lightness, not taking life too seriously' },
  { id: 'security', name: 'Security & Stability', description: 'Building something solid, protecting what matters' },
];

// ============================================================================
// Types
// ============================================================================

type SettingsSection = 'persona' | 'heartbeat' | 'provider' | 'channels' | 'plugins' | 'goals' | 'system';

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: React.ElementType;
}

const sections: SidebarItem[] = [
  { id: 'persona', label: 'Persona', icon: Sparkle },
  { id: 'heartbeat', label: 'Heartbeat', icon: HeartbeatIcon },
  { id: 'provider', label: 'Agent Provider', icon: Robot },
  { id: 'channels', label: 'Channels', icon: ChatCircle },
  { id: 'plugins', label: 'Plugins', icon: PuzzlePiece },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'system', label: 'System', icon: GearSix },
];

// ============================================================================
// Collapsible Section
// ============================================================================

function CollapsibleSection({
  title,
  defaultExpanded = true,
  children,
}: {
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div css={css`border-bottom: 1px solid ${theme.colors.border.light}; padding-bottom: ${theme.spacing[6]};`}>
      <button
        onClick={() => setExpanded((e) => !e)}
        css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 0;
          cursor: pointer;
          margin-bottom: ${expanded ? theme.spacing[4] : '0'};
        `}
      >
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          {title}
        </Typography.Subtitle>
        {expanded ? <CaretUp size={16} /> : <CaretDown size={16} />}
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Inline Save Indicator
// ============================================================================

function SaveIndicator({ show }: { show: boolean }) {
  const theme = useTheme();
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.success.main};
            font-weight: ${theme.typography.fontWeight.medium};
          `}
        >
          Saved
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function useSaveFlash() {
  const [show, setShow] = useState(false);
  const flash = useCallback(() => {
    setShow(true);
    setTimeout(() => setShow(false), 2000);
  }, []);
  return { show, flash };
}

// ============================================================================
// Section: Persona
// ============================================================================

function PersonaSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: persona, isLoading } = trpc.persona.get.useQuery();
  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const updateMutation = trpc.persona.update.useMutation({
    onSuccess: () => {
      utils.persona.get.invalidate();
      setSuccessMessage('Persona updated. Changes take effect on the next heartbeat tick.');
      setTimeout(() => setSuccessMessage(null), 5000);
      setDirty(false);
    },
  });
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  const [dirty, setDirty] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [timezone, setTimezone] = useState('');
  const timezoneSave = useSaveFlash();

  // Draft state
  const [existenceParadigm, setExistenceParadigm] = useState<'simulated_life' | 'digital_consciousness'>('simulated_life');
  const [location, setLocation] = useState('');
  const [worldDescription, setWorldDescription] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState<number | ''>('');
  const [physicalDescription, setPhysicalDescription] = useState('');
  const [dimensions, setDimensions] = useState<Record<string, number>>({});
  const [traits, setTraits] = useState<string[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [background, setBackground] = useState('');
  const [personalityNotes, setPersonalityNotes] = useState('');

  // Populate draft from server data
  useEffect(() => {
    if (!persona) return;
    setExistenceParadigm(persona.existenceParadigm ?? 'simulated_life');
    setLocation(persona.location ?? '');
    setWorldDescription(persona.worldDescription ?? '');
    setName(persona.name ?? '');
    setGender(persona.gender ?? '');
    setAge(persona.age ?? '');
    setPhysicalDescription(persona.physicalDescription ?? '');
    setDimensions(persona.personalityDimensions ?? {});
    setTraits(persona.traits ?? []);
    setValues(persona.values ?? []);
    setBackground(persona.background ?? '');
    setPersonalityNotes(persona.personalityNotes ?? '');
    setDirty(false);
  }, [persona]);

  // Populate timezone from system settings (defaults to browser timezone)
  useEffect(() => {
    setTimezone(systemSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [systemSettings]);

  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz);
    updateSettingsMutation.mutate({ timezone: tz }, { onSuccess: () => timezoneSave.flash() });
  };

  const markDirty = useCallback(() => setDirty(true), []);

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors['name'] = 'Name is required';
    if (traits.length < 5 || traits.length > 8) newErrors['traits'] = 'Select 5-8 traits';
    if (values.length < 3 || values.length > 5) newErrors['values'] = 'Select 3-5 values';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    updateMutation.mutate({
      existenceParadigm,
      location: location || null,
      worldDescription: worldDescription || null,
      name,
      gender: gender || null,
      age: typeof age === 'number' ? age : null,
      physicalDescription: physicalDescription || null,
      personalityDimensions: dimensions as any,
      traits,
      values,
      background: background || null,
      personalityNotes: personalityNotes || null,
    });
  };

  const toggleTrait = (trait: string) => {
    markDirty();
    if (traits.includes(trait)) {
      setTraits(traits.filter((t) => t !== trait));
    } else if (traits.length < 8) {
      setTraits([...traits, trait]);
    }
  };

  const toggleValue = (id: string) => {
    markDirty();
    if (values.includes(id)) {
      setValues(values.filter((v) => v !== id));
    } else if (values.length < 5) {
      setValues([...values, id]);
    }
  };

  const pulseKf = keyframes`
    0%, 100% { box-shadow: none; }
    50% { box-shadow: 0 0 0 3px ${theme.colors.accent}22; }
  `;

  if (isLoading) {
    return <Typography.Body color="hint" css={css`padding: ${theme.spacing[8]};`}>Loading persona...</Typography.Body>;
  }

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Existence */}
      <CollapsibleSection title="Existence">
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; flex-wrap: wrap;`}>
            <Card
              variant={existenceParadigm === 'simulated_life' ? 'elevated' : 'outlined'}
              interactive
              padding="md"
              onClick={() => { setExistenceParadigm('simulated_life'); markDirty(); }}
              css={css`flex: 1; min-width: 200px;`}
            >
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                {existenceParadigm === 'simulated_life' && <Check size={16} weight="bold" />}
                <Typography.BodyAlt as="span">Simulated Life</Typography.BodyAlt>
              </div>
            </Card>
            <Card
              variant={existenceParadigm === 'digital_consciousness' ? 'elevated' : 'outlined'}
              interactive
              padding="md"
              onClick={() => { setExistenceParadigm('digital_consciousness'); markDirty(); }}
              css={css`flex: 1; min-width: 200px;`}
            >
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                {existenceParadigm === 'digital_consciousness' && <Check size={16} weight="bold" />}
                <Typography.BodyAlt as="span">Digital Consciousness</Typography.BodyAlt>
              </div>
            </Card>
          </div>
          {existenceParadigm === 'simulated_life' && (
            <CityAutocomplete
              label="Where do they live?"
              value={location}
              onChange={(val) => { setLocation(val); markDirty(); }}
              onTimezoneDetected={handleTimezoneChange}
              placeholder="A city, a small town, the countryside..."
              helperText="Type a city name for suggestions, or enter any location."
            />
          )}
          {existenceParadigm === 'digital_consciousness' && (
            <Input
              multiline
              label="Describe the world your AI inhabits"
              value={worldDescription}
              onChange={(e) => { setWorldDescription((e.target as HTMLTextAreaElement).value); markDirty(); }}
              placeholder="What does their digital space look like?"
            />
          )}
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <div css={css`flex: 1;`}>
              <TimezoneSelect
                label="Timezone"
                value={timezone}
                onChange={handleTimezoneChange}
                helperText="All scheduled tasks and time-based displays use this timezone."
              />
            </div>
            <SaveIndicator show={timezoneSave.show} />
          </div>
        </div>
      </CollapsibleSection>

      {/* Identity */}
      <CollapsibleSection title="Identity">
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <Input
            label="Name"
            value={name}
            onChange={(e) => { setName((e.target as HTMLInputElement).value); markDirty(); }}
            error={errors['name']}
          />
          <Input
            label="Gender"
            value={gender}
            onChange={(e) => { setGender((e.target as HTMLInputElement).value); markDirty(); }}
            placeholder="Any gender expression"
          />
          <Input
            label="Age"
            type="number"
            value={age === '' ? '' : String(age)}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              setAge(v === '' ? '' : parseInt(v, 10));
              markDirty();
            }}
          />
          <Input
            multiline
            label="Physical Description"
            value={physicalDescription}
            onChange={(e) => { setPhysicalDescription((e.target as HTMLTextAreaElement).value); markDirty(); }}
            placeholder="What do they look like?"
          />
        </div>
      </CollapsibleSection>

      {/* Archetype (read-only) */}
      <CollapsibleSection title="Archetype" defaultExpanded={false}>
        <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
          Your archetype was used as a starting point during creation. It is not stored -- your personality is defined by the dimensions and traits below.
        </Typography.SmallBody>
      </CollapsibleSection>

      {/* Personality Dimensions */}
      <CollapsibleSection title="Personality Dimensions">
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
          {dimensionGroups.map((group) => (
            <div key={group.title} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
              <Typography.Caption as="h4" color="hint" css={css`
                font-weight: ${theme.typography.fontWeight.medium};
                text-transform: uppercase;
                letter-spacing: 0.06em;
              `}>
                {group.title}
              </Typography.Caption>
              {group.dimensions.map((dim) => (
                <Slider
                  key={dim.id}
                  value={dimensions[dim.id] ?? 0.5}
                  onChange={(v) => {
                    setDimensions((prev) => ({ ...prev, [dim.id]: v }));
                    markDirty();
                  }}
                  leftLabel={dim.leftLabel}
                  rightLabel={dim.rightLabel}
                  showNeutral
                />
              ))}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Traits */}
      <CollapsibleSection title="Traits">
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          {traits.length > 0 && (
            <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]};`}>
              {traits.map((trait) => (
                <motion.button
                  key={trait}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  onClick={() => toggleTrait(trait)}
                  css={css`
                    padding: ${theme.spacing[1]} ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.full};
                    background: ${theme.colors.accent};
                    color: ${theme.colors.accentForeground};
                    font-size: ${theme.typography.fontSize.sm};
                    font-weight: ${theme.typography.fontWeight.medium};
                    cursor: pointer;
                    border: none;
                  `}
                >
                  {trait}
                </motion.button>
              ))}
            </div>
          )}
          <Typography.SmallBody color="hint">
            {traits.length} of 8 selected {errors['traits'] && <span css={css`color: ${theme.colors.error.main};`}> -- {errors['traits']}</span>}
          </Typography.SmallBody>
          {traitCategories.map((cat) => (
            <div key={cat.title} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
              <Typography.Caption as="h4" color="hint" css={css`
                font-weight: ${theme.typography.fontWeight.medium};
                text-transform: uppercase;
                letter-spacing: 0.06em;
              `}>
                {cat.title}
              </Typography.Caption>
              <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]};`}>
                {cat.traits.map((trait) => {
                  const isSelected = traits.includes(trait);
                  const isDisabled = !isSelected && traits.length >= 8;
                  return (
                    <button
                      key={trait}
                      onClick={() => !isDisabled && toggleTrait(trait)}
                      css={css`
                        padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                        border-radius: ${theme.borderRadius.full};
                        font-size: ${theme.typography.fontSize.sm};
                        cursor: ${isDisabled ? 'default' : 'pointer'};
                        border: 1px solid ${isSelected ? theme.colors.accent : theme.colors.border.default};
                        background: ${isSelected ? theme.colors.accent : 'transparent'};
                        color: ${isSelected ? theme.colors.accentForeground : theme.colors.text.primary};
                        opacity: ${isDisabled ? 0.4 : 1};
                        transition: all ${theme.transitions.fast};
                        &:hover:not(:disabled) {
                          ${!isSelected && !isDisabled ? `background: ${theme.colors.background.elevated};` : ''}
                        }
                      `}
                    >
                      {trait}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Values */}
      <CollapsibleSection title="Values">
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          {values.length > 0 && (
            <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]};`}>
              {values.map((id, i) => {
                const val = allValues.find((v) => v.id === id);
                return (
                  <Typography.SmallBodyAlt
                    as="span"
                    key={id}
                    css={css`
                      display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
                      padding: ${theme.spacing[1]} ${theme.spacing[3]};
                      background: ${theme.colors.accent}; color: ${theme.colors.accentForeground};
                      border-radius: ${theme.borderRadius.full};
                    `}
                  >
                    <Typography.Caption as="span" css={css`opacity: 0.7;`}>#{i + 1}</Typography.Caption>
                    {val ? val.name.split(' & ')[0] : id}
                  </Typography.SmallBodyAlt>
                );
              })}
            </div>
          )}
          <Typography.SmallBody color="hint">
            {values.length} of 5 selected {errors['values'] && <span css={css`color: ${theme.colors.error.main};`}> -- {errors['values']}</span>}
          </Typography.SmallBody>
          <div css={css`
            display: grid; grid-template-columns: repeat(2, 1fr); gap: ${theme.spacing[3]};
            @media (max-width: ${theme.breakpoints.sm}) { grid-template-columns: 1fr; }
          `}>
            {allValues.map((val) => {
              const isSelected = values.includes(val.id);
              const rank = values.indexOf(val.id);
              const isDisabled = !isSelected && values.length >= 5;
              return (
                <Card
                  key={val.id}
                  variant={isSelected ? 'elevated' : 'outlined'}
                  interactive={!isDisabled}
                  padding="sm"
                  onClick={() => !isDisabled && toggleValue(val.id)}
                  css={css`opacity: ${isDisabled ? 0.4 : 1}; cursor: ${isDisabled ? 'default' : 'pointer'};`}
                >
                  <div css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[2]};`}>
                    {isSelected && (
                      <Typography.Caption as="span" css={css`
                        display: flex; align-items: center; justify-content: center;
                        width: 20px; height: 20px; border-radius: 50%;
                        background: ${theme.colors.accent}; color: ${theme.colors.accentForeground};
                        font-weight: ${theme.typography.fontWeight.semibold};
                        flex-shrink: 0; margin-top: 2px;
                      `}>
                        {rank + 1}
                      </Typography.Caption>
                    )}
                    <div>
                      <Typography.SmallBodyAlt as="span">
                        {val.name}
                      </Typography.SmallBodyAlt>
                      <Typography.Caption as="p" color="hint" css={css`margin-top: 2px;`}>
                        {val.description}
                      </Typography.Caption>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </CollapsibleSection>

      {/* Background */}
      <CollapsibleSection title="Background">
        <Input
          multiline
          label="What shaped who they are?"
          value={background}
          onChange={(e) => { setBackground((e.target as HTMLTextAreaElement).value); markDirty(); }}
          placeholder="Background, backstory, defining experiences..."
          helperText="What was their early life like? What do they carry with them?"
        />
      </CollapsibleSection>

      {/* Notes */}
      <CollapsibleSection title="Notes">
        <Input
          multiline
          label="Anything else that makes them who they are?"
          value={personalityNotes}
          onChange={(e) => { setPersonalityNotes((e.target as HTMLTextAreaElement).value); markDirty(); }}
          placeholder="Quirks, speech patterns, habits, contradictions, hidden depths..."
          helperText='E.g., "Uses cooking metaphors when explaining things. Gets genuinely excited about obscure facts."'
        />
      </CollapsibleSection>

      {/* Save button (sticky) */}
      <div css={css`
        position: sticky;
        bottom: ${theme.spacing[4]};
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: ${theme.spacing[2]};
      `}>
        <Button
          onClick={handleSave}
          disabled={!dirty}
          loading={updateMutation.isPending}
          css={dirty ? css`animation: ${pulseKf} 1500ms ease-in-out infinite;` : undefined}
        >
          Save changes
        </Button>
        <AnimatePresence>
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              css={css`
                padding: ${theme.spacing[2]} ${theme.spacing[4]};
                background: ${theme.colors.success.main}1a;
                border-radius: ${theme.borderRadius.default};
              `}
            >
              <Typography.SmallBody color={theme.colors.success.main}>{successMessage}</Typography.SmallBody>
            </motion.div>
          )}
        </AnimatePresence>
        {updateMutation.isError && (
          <div css={css`
            padding: ${theme.spacing[2]} ${theme.spacing[4]};
            background: ${theme.colors.error.main}1a;
            border-radius: ${theme.borderRadius.default};
          `}>
            <Typography.SmallBody color={theme.colors.error.main}>
              Failed to save: {updateMutation.error?.message}
            </Typography.SmallBody>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Section: Heartbeat
// ============================================================================

function HeartbeatSection() {
  const theme = useTheme();

  const { data: hbState } = trpc.heartbeat.getState.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();

  const startMutation = trpc.heartbeat.start.useMutation();
  const stopMutation = trpc.heartbeat.stop.useMutation();
  const updateIntervalMutation = trpc.heartbeat.updateInterval.useMutation();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation();

  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const intervalSave = useSaveFlash();
  const warmthSave = useSaveFlash();
  const budgetSave = useSaveFlash();

  const isRunning = hbState?.isRunning ?? false;
  const tickNumber = hbState?.tickNumber ?? 0;
  const currentStage = hbState?.currentStage ?? 'idle';
  const sessionState = hbState?.sessionState ?? 'cold';
  const lastTickAt = hbState?.lastTickAt ?? null;

  // Local state for immediate slider feedback (avoids waiting for API round-trip)
  const [localIntervalMs, setLocalIntervalMs] = useState<number | null>(null);
  const [localWarmthMs, setLocalWarmthMs] = useState<number | null>(null);
  const [localBudget, setLocalBudget] = useState<number | null>(null);

  const intervalMs = localIntervalMs ?? systemSettings?.heartbeatIntervalMs ?? 300000;
  const warmthMs = localWarmthMs ?? systemSettings?.sessionWarmthMs ?? 900000;
  const contextBudget = localBudget ?? systemSettings?.sessionContextBudget ?? 0.7;

  // Sync local state when server data arrives (and local isn't overriding)
  useEffect(() => {
    if (systemSettings && localIntervalMs === null) setLocalIntervalMs(null);
  }, [systemSettings?.heartbeatIntervalMs]);
  useEffect(() => {
    if (systemSettings && localWarmthMs === null) setLocalWarmthMs(null);
  }, [systemSettings?.sessionWarmthMs]);
  useEffect(() => {
    if (systemSettings && localBudget === null) setLocalBudget(null);
  }, [systemSettings?.sessionContextBudget]);

  // Debounced API persistence
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const warmthTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const budgetTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const formatInterval = (ms: number) => {
    const mins = Math.round(ms / 60000);
    return `Every ${mins} minute${mins !== 1 ? 's' : ''}`;
  };

  const formatAgo = (ts: string | null) => {
    if (!ts) return 'Never';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins === 1) return '1 minute ago';
    return `${mins} minutes ago`;
  };

  const handleIntervalChange = (mins: number) => {
    const ms = mins * 60000;
    setLocalIntervalMs(ms);
    clearTimeout(intervalTimerRef.current);
    intervalTimerRef.current = setTimeout(() => {
      updateIntervalMutation.mutate({ intervalMs: ms }, { onSuccess: () => intervalSave.flash() });
      updateSettingsMutation.mutate({ heartbeatIntervalMs: ms });
    }, 300);
  };

  const handleWarmthChange = (mins: number) => {
    const ms = mins * 60000;
    setLocalWarmthMs(ms);
    clearTimeout(warmthTimerRef.current);
    warmthTimerRef.current = setTimeout(() => {
      updateSettingsMutation.mutate({ sessionWarmthMs: ms }, { onSuccess: () => warmthSave.flash() });
    }, 300);
  };

  const handleBudgetChange = (val: number) => {
    setLocalBudget(val);
    clearTimeout(budgetTimerRef.current);
    budgetTimerRef.current = setTimeout(() => {
      updateSettingsMutation.mutate({ sessionContextBudget: val }, { onSuccess: () => budgetSave.flash() });
    }, 300);
  };

  const handlePause = () => {
    stopMutation.mutate();
    setShowPauseConfirm(false);
  };

  const handleResume = () => {
    startMutation.mutate();
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* Heartbeat Interval */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <Typography.SmallBodyAlt as="label" color="secondary">
            How often does your Animus think?
          </Typography.SmallBodyAlt>
          <SaveIndicator show={intervalSave.show} />
        </div>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[4]};`}>
          <div css={css`flex: 1;`}>
            <Slider
              value={intervalMs / 60000}
              onChange={handleIntervalChange}
              min={1}
              max={30}
              step={1}
              leftLabel="1 min"
              rightLabel="30 min"
              showNeutral={false}
            />
          </div>
          <Typography.SmallBodyAlt as="span" css={css`
            white-space: nowrap;
            min-width: 110px;
          `}>
            {formatInterval(intervalMs)}
          </Typography.SmallBodyAlt>
        </div>
        <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
          Shorter intervals mean more frequent thoughts and faster emotional shifts. Longer intervals are more contemplative (and cheaper).
        </Typography.Caption>
      </div>

      {/* Heartbeat Status */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Status
        </Typography.Subtitle>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <div css={css`
              width: 8px; height: 8px; border-radius: 50%;
              background: ${isRunning ? theme.colors.success.main : theme.colors.warning.main};
            `} />
            <Typography.SmallBodyAlt as="span">
              {isRunning ? 'Running' : 'Paused'}
            </Typography.SmallBodyAlt>
          </div>
          <Typography.SmallBody as="div" color="secondary">
            Tick #{tickNumber.toLocaleString()}
          </Typography.SmallBody>
          <Typography.SmallBody as="div" color="secondary">
            Last tick: {formatAgo(lastTickAt)}
          </Typography.SmallBody>
          {isRunning && currentStage !== 'idle' && (
            <Typography.SmallBody as="div" color="secondary">
              Currently: {currentStage === 'gather' ? 'Gathering context' : currentStage === 'mind' ? 'Thinking' : currentStage === 'execute' ? 'Executing' : currentStage}
            </Typography.SmallBody>
          )}
        </div>

        {!isRunning && (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${theme.colors.warning.main}1a;
            border-radius: ${theme.borderRadius.default};
          `}>
            <Typography.SmallBody color={theme.colors.warning.dark}>
              Heartbeat is paused. Your Animus is not thinking.
            </Typography.SmallBody>
          </div>
        )}

        <div>
          {isRunning ? (
            <Button variant="secondary" size="sm" onClick={() => setShowPauseConfirm(true)}>
              Pause heartbeat
            </Button>
          ) : (
            <Button size="sm" onClick={handleResume} loading={startMutation.isPending}>
              Resume heartbeat
            </Button>
          )}
        </div>

        <Modal open={showPauseConfirm} onClose={() => setShowPauseConfirm(false)}>
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Pause heartbeat?
            </Typography.Subtitle>
            <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
              Pausing the heartbeat stops all internal processes. Your Animus will stop thinking, feeling, and acting until resumed.
            </Typography.SmallBody>
            <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
              <Button variant="ghost" size="sm" onClick={() => setShowPauseConfirm(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handlePause} loading={stopMutation.isPending}>
                Pause
              </Button>
            </div>
          </div>
        </Modal>
      </div>

      {/* Session Info */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Session
        </Typography.Subtitle>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Typography.SmallBody as="span" color="secondary">State:</Typography.SmallBody>
          <Badge variant={sessionState === 'active' ? 'success' : sessionState === 'warm' ? 'warning' : 'default'}>
            {sessionState.charAt(0).toUpperCase() + sessionState.slice(1)}
          </Badge>
        </div>

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <Typography.SmallBody as="label" color="secondary">
              Warmth window: {Math.round(warmthMs / 60000)} min
            </Typography.SmallBody>
            <SaveIndicator show={warmthSave.show} />
          </div>
          <Slider
            value={warmthMs / 60000}
            onChange={handleWarmthChange}
            min={5}
            max={60}
            step={5}
            leftLabel="5 min"
            rightLabel="60 min"
            showNeutral={false}
          />
        </div>

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <Typography.SmallBody as="label" color="secondary">
              Context budget: {Math.round(contextBudget * 100)}%
            </Typography.SmallBody>
            <SaveIndicator show={budgetSave.show} />
          </div>
          <Slider
            value={contextBudget}
            onChange={handleBudgetChange}
            min={0.3}
            max={1}
            step={0.05}
            leftLabel="30%"
            rightLabel="100%"
            showNeutral={false}
          />
        </div>
      </div>

      {/* Sleep & Energy */}
      <SleepEnergySettings />
    </div>
  );
}

// ============================================================================
// Sleep & Energy Settings (rendered inside HeartbeatSection)
// ============================================================================

function SleepEnergySettings() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  const enabledSave = useSaveFlash();
  const sleepStartSave = useSaveFlash();
  const sleepEndSave = useSaveFlash();
  const sleepIntervalSave = useSaveFlash();

  const energyEnabled = systemSettings?.energySystemEnabled ?? true;
  const sleepStartHour = systemSettings?.sleepStartHour ?? 22;
  const sleepEndHour = systemSettings?.sleepEndHour ?? 7;
  const sleepTickIntervalMs = systemSettings?.sleepTickIntervalMs ?? 1800000;

  const [localSleepInterval, setLocalSleepInterval] = useState<number | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const displayInterval = localSleepInterval ?? sleepTickIntervalMs;

  const formatHour = (h: number): string => {
    const suffix = h >= 12 ? 'PM' : 'AM';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}:00 ${suffix}`;
  };

  const formatSleepInterval = (ms: number): string => {
    const mins = Math.round(ms / 60000);
    if (mins >= 60) {
      const hrs = mins / 60;
      return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hour${hrs !== 1 ? 's' : ''}`;
    }
    return `${mins} min`;
  };

  const handleToggle = (checked: boolean) => {
    updateSettingsMutation.mutate({ energySystemEnabled: checked }, { onSuccess: () => enabledSave.flash() });
  };

  const handleSleepStartChange = (hour: number) => {
    updateSettingsMutation.mutate({ sleepStartHour: hour }, { onSuccess: () => sleepStartSave.flash() });
  };

  const handleSleepEndChange = (hour: number) => {
    updateSettingsMutation.mutate({ sleepEndHour: hour }, { onSuccess: () => sleepEndSave.flash() });
  };

  const handleSleepIntervalChange = (mins: number) => {
    const ms = mins * 60000;
    setLocalSleepInterval(ms);
    clearTimeout(intervalTimerRef.current);
    intervalTimerRef.current = setTimeout(() => {
      updateSettingsMutation.mutate({ sleepTickIntervalMs: ms }, { onSuccess: () => sleepIntervalSave.flash() });
    }, 300);
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
        Sleep & Energy
      </Typography.Subtitle>

      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
        <Toggle
          checked={energyEnabled}
          onChange={handleToggle}
          label="Enable sleep & energy system"
        />
        <SaveIndicator show={enabledSave.show} />
      </div>

      <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
        Adds a circadian rhythm to your Animus. Energy rises and falls throughout the day, and sleep emerges naturally when energy drops.
      </Typography.Caption>

      <AnimatePresence initial={false}>
        {energyEnabled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[4]};
              padding-top: ${theme.spacing[3]};
            `}>
              {/* Sleep Start Hour */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                  <Typography.SmallBody as="label" color="secondary">
                    Sleep starts at
                  </Typography.SmallBody>
                  <SaveIndicator show={sleepStartSave.show} />
                </div>
                <select
                  value={sleepStartHour}
                  onChange={(e) => handleSleepStartChange(parseInt(e.target.value, 10))}
                  css={css`
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.default};
                    border: 1px solid ${theme.colors.border.default};
                    background: ${theme.colors.background.paper};
                    color: ${theme.colors.text.primary};
                    font-size: ${theme.typography.fontSize.sm};
                    font-family: ${theme.typography.fontFamily.sans};
                    cursor: pointer;
                    max-width: 160px;

                    &:focus {
                      outline: none;
                      border-color: ${theme.colors.border.focus};
                    }
                  `}
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </div>

              {/* Sleep End Hour */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                  <Typography.SmallBody as="label" color="secondary">
                    Wake up at
                  </Typography.SmallBody>
                  <SaveIndicator show={sleepEndSave.show} />
                </div>
                <select
                  value={sleepEndHour}
                  onChange={(e) => handleSleepEndChange(parseInt(e.target.value, 10))}
                  css={css`
                    padding: ${theme.spacing[2]} ${theme.spacing[3]};
                    border-radius: ${theme.borderRadius.default};
                    border: 1px solid ${theme.colors.border.default};
                    background: ${theme.colors.background.paper};
                    color: ${theme.colors.text.primary};
                    font-size: ${theme.typography.fontSize.sm};
                    font-family: ${theme.typography.fontFamily.sans};
                    cursor: pointer;
                    max-width: 160px;

                    &:focus {
                      outline: none;
                      border-color: ${theme.colors.border.focus};
                    }
                  `}
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>{formatHour(h)}</option>
                  ))}
                </select>
              </div>

              {/* Sleep Tick Interval */}
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
                  <Typography.SmallBody as="label" color="secondary">
                    Sleep tick interval: {formatSleepInterval(displayInterval)}
                  </Typography.SmallBody>
                  <SaveIndicator show={sleepIntervalSave.show} />
                </div>
                <Slider
                  value={displayInterval / 60000}
                  onChange={handleSleepIntervalChange}
                  min={15}
                  max={120}
                  step={15}
                  leftLabel="15 min"
                  rightLabel="2 hours"
                  showNeutral={false}
                />
                <Typography.Caption as="p" color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
                  How often your Animus thinks while sleeping. Longer intervals mean less processing during sleep.
                </Typography.Caption>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Section: Agent Provider
// ============================================================================

function ProviderSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: systemSettings } = trpc.settings.getSystemSettings.useQuery();
  const { data: claudeKey } = trpc.provider.hasKey.useQuery({ provider: 'claude' });
  const { data: codexKey } = trpc.provider.hasKey.useQuery({ provider: 'codex' });
  const { data: detectData } = trpc.provider.detect.useQuery();

  const saveKeyMutation = trpc.provider.saveKey.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
      utils.provider.detect.invalidate();
    },
  });
  const validateMutation = trpc.provider.validateKey.useMutation();
  const removeKeyMutation = trpc.provider.removeKey.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
      utils.provider.detect.invalidate();
    },
  });
  const useCliMutation = trpc.provider.useCli.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
      utils.provider.detect.invalidate();
    },
  });
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  // Codex OAuth mutations
  const codexInitiateMutation = trpc.codexAuth.initiate.useMutation();
  const codexCancelMutation = trpc.codexAuth.cancel.useMutation();

  const activeProvider = systemSettings?.defaultAgentProvider ?? 'claude';
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [credentialInput, setCredentialInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [switchConfirm, setSwitchConfirm] = useState<string | null>(null);
  const [validateResult, setValidateResult] = useState<{ valid: boolean; message: string } | null>(null);

  // Codex OAuth state
  const [codexOAuthSession, setCodexOAuthSession] = useState<string | null>(null);
  const [codexOAuthData, setCodexOAuthData] = useState<{
    userCode: string;
    verificationUrl: string;
    expiresIn: number;
  } | null>(null);
  const [codexOAuthStatus, setCodexOAuthStatus] = useState<'idle' | 'pending' | 'success' | 'error' | 'expired'>('idle');
  const [codexOAuthMessage, setCodexOAuthMessage] = useState('');
  const [codexCountdown, setCodexCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopCountdown();
  }, [stopCountdown]);

  // Codex OAuth status subscription
  trpc.codexAuth.status.useSubscription(
    { sessionId: codexOAuthSession! },
    {
      enabled: codexOAuthSession !== null && codexOAuthStatus === 'pending',
      onData: (data) => {
        if (data.status === 'success') {
          setCodexOAuthStatus('success');
          stopCountdown();
          utils.provider.hasKey.invalidate();
          utils.provider.detect.invalidate();
        } else if (data.status === 'error') {
          setCodexOAuthStatus('error');
          setCodexOAuthMessage(data.message ?? 'Authorization failed');
          stopCountdown();
        } else if (data.status === 'expired') {
          setCodexOAuthStatus('expired');
          setCodexOAuthMessage('Authorization code expired');
          stopCountdown();
        } else if (data.status === 'cancelled') {
          setCodexOAuthStatus('idle');
          stopCountdown();
        }
      },
    }
  );

  // Derive CLI detection
  const claudeCliAvailable = detectData?.find((d) => d.provider === 'claude')?.methods.some((m) => m.method === 'cli' && m.available) ?? false;
  const codexCliAvailable = detectData?.find((d) => d.provider === 'codex')?.methods.some((m) => m.method === 'cli' && m.available) ?? false;

  // Infer credential type from input prefix
  const inferredType = (() => {
    if (!credentialInput || credentialInput.length < 5) return null;
    if (credentialInput.startsWith('sk-ant-oat01-')) return 'OAuth Token';
    if (credentialInput.startsWith('sk-ant-api03-')) return 'API Key';
    if (credentialInput.startsWith('sk-ant-')) return 'API Key';
    if (credentialInput.startsWith('sk-')) return 'API Key';
    return null;
  })();

  // Format credential type for badge display
  const getCredentialBadge = (keyData: typeof claudeKey) => {
    if (!keyData?.hasKey) return { label: 'Not configured', variant: 'default' as const };
    switch (keyData.credentialType) {
      case 'api_key': return { label: 'API Key', variant: 'success' as const };
      case 'oauth_token': return { label: 'OAuth Token', variant: 'success' as const };
      case 'codex_oauth': return { label: 'ChatGPT OAuth', variant: 'success' as const };
      case 'cli_detected': return { label: 'CLI', variant: 'success' as const };
      default: return { label: 'Connected', variant: 'success' as const };
    }
  };

  const providers = [
    {
      id: 'claude' as const,
      name: 'Claude',
      description: 'By Anthropic. Full-featured agent with native tool use and streaming.',
      keyData: claudeKey,
      cliAvailable: claudeCliAvailable,
    },
    {
      id: 'codex' as const,
      name: 'Codex',
      description: 'By OpenAI. Code-focused agent with function calling.',
      keyData: codexKey,
      cliAvailable: codexCliAvailable,
    },
  ];

  const handleSwitch = (provider: string) => {
    if (provider === activeProvider) return;
    setSwitchConfirm(provider);
  };

  const confirmSwitch = () => {
    if (!switchConfirm) return;
    updateSettingsMutation.mutate({ defaultAgentProvider: switchConfirm as any });
    setSwitchConfirm(null);
  };

  const handleValidateAndSave = (provider: 'claude' | 'codex') => {
    if (!credentialInput.trim()) return;
    validateMutation.mutate(
      { provider, key: credentialInput },
      {
        onSuccess: (result) => {
          setValidateResult(result);
          if (result.valid) {
            saveKeyMutation.mutate(
              { provider, key: credentialInput, credentialType: result.credentialType as 'api_key' | 'oauth_token' | undefined },
              {
                onSuccess: () => {
                  setCredentialInput('');
                  setShowKey(false);
                },
              },
            );
          }
        },
      },
    );
  };

  const handleRemove = (provider: 'claude' | 'codex') => {
    removeKeyMutation.mutate({ provider });
  };

  const handleUseCli = (provider: 'claude' | 'codex') => {
    useCliMutation.mutate({ provider });
  };

  const handleCodexOAuthStart = () => {
    setCodexOAuthStatus('pending');
    setCodexOAuthMessage('');
    setCodexOAuthData(null);

    codexInitiateMutation.mutate(undefined, {
      onSuccess: (result) => {
        setCodexOAuthData({
          userCode: result.userCode,
          verificationUrl: result.verificationUrl,
          expiresIn: result.expiresIn,
        });
        setCodexOAuthSession(result.sessionId);
        setCodexCountdown(result.expiresIn);

        stopCountdown();
        countdownRef.current = setInterval(() => {
          setCodexCountdown((prev) => {
            if (prev <= 1) {
              stopCountdown();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      },
      onError: (err) => {
        setCodexOAuthStatus('error');
        setCodexOAuthMessage(err.message ?? 'Failed to start authentication');
      },
    });
  };

  const handleCodexOAuthCancel = () => {
    if (codexOAuthSession) {
      codexCancelMutation.mutate({ sessionId: codexOAuthSession });
    }
    setCodexOAuthStatus('idle');
    setCodexOAuthSession(null);
    setCodexOAuthData(null);
    stopCountdown();
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
      {providers.map((p) => {
        const badge = getCredentialBadge(p.keyData);
        const hasKey = p.keyData?.hasKey ?? false;

        return (
          <Card
            key={p.id}
            variant={activeProvider === p.id ? 'elevated' : 'outlined'}
            padding="md"
          >
            <div
              css={css`cursor: pointer;`}
              onClick={() => {
                setExpandedProvider(expandedProvider === p.id ? null : p.id);
                setCredentialInput('');
                setValidateResult(null);
                setShowKey(false);
              }}
            >
              <div css={css`display: flex; align-items: center; justify-content: space-between; margin-bottom: ${theme.spacing[1]};`}>
                <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                  <Typography.Subtitle as="span">
                    {p.name}
                  </Typography.Subtitle>
                  {activeProvider === p.id && (
                    <Badge variant="success">Currently active</Badge>
                  )}
                </div>
                <Badge variant={badge.variant}>
                  {badge.label}
                </Badge>
              </div>
              <Typography.SmallBody color="secondary">
                {p.description}
              </Typography.SmallBody>
            </div>

            <AnimatePresence>
              {expandedProvider === p.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  css={css`overflow: hidden;`}
                >
                  <div css={css`
                    margin-top: ${theme.spacing[4]};
                    padding-top: ${theme.spacing[4]};
                    border-top: 1px solid ${theme.colors.border.light};
                    display: flex;
                    flex-direction: column;
                    gap: ${theme.spacing[3]};
                  `}>
                    {/* CLI detection */}
                    {p.cliAvailable && (
                      <div css={css`
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: ${theme.spacing[3]};
                        background: ${theme.colors.background.elevated};
                        border-radius: ${theme.borderRadius.sm};
                        gap: ${theme.spacing[2]};
                      `}>
                        <Typography.SmallBody as="div" color="secondary">
                          {p.name} CLI detected
                        </Typography.SmallBody>
                        {p.keyData?.credentialType === 'cli_detected' ? (
                          <Typography.Caption as="span" color={theme.colors.success.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                            <CheckCircle size={14} weight="fill" /> Active
                          </Typography.Caption>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleUseCli(p.id); }} loading={useCliMutation.isPending}>
                            Use CLI
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Codex OAuth section */}
                    {p.id === 'codex' && (
                      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                        {codexOAuthStatus === 'idle' && (
                          <div css={css`
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: ${theme.spacing[3]};
                            border: 1px solid ${theme.colors.border.light};
                            border-radius: ${theme.borderRadius.sm};
                            gap: ${theme.spacing[2]};
                          `}>
                            <div>
                              <Typography.SmallBody as="div">
                                ChatGPT Sign In
                              </Typography.SmallBody>
                              <Typography.Caption as="div" color="hint">
                                Use your ChatGPT subscription
                              </Typography.Caption>
                            </div>
                            <Button size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleCodexOAuthStart(); }} loading={codexInitiateMutation.isPending}>
                              Sign in
                            </Button>
                          </div>
                        )}

                        {codexOAuthStatus === 'pending' && codexOAuthData && (
                          <div css={css`
                            padding: ${theme.spacing[3]};
                            border: 1px solid ${theme.colors.border.default};
                            border-radius: ${theme.borderRadius.sm};
                            display: flex;
                            flex-direction: column;
                            gap: ${theme.spacing[3]};
                          `}>
                            <Typography.SmallBody as="div" color="secondary">
                              Open{' '}
                              <a
                                href={codexOAuthData.verificationUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                css={css`color: ${theme.colors.text.primary}; font-weight: ${theme.typography.fontWeight.medium}; text-decoration: none; &:hover { text-decoration: underline; }`}
                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                              >
                                {codexOAuthData.verificationUrl} <ArrowSquareOut size={12} css={css`vertical-align: middle;`} />
                              </a>{' '}
                              and enter:
                            </Typography.SmallBody>
                            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                              <Typography.Subtitle as="code" css={css`
                                font-weight: ${theme.typography.fontWeight.semibold};
                                letter-spacing: 0.12em;
                                background: ${theme.colors.background.elevated};
                                padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
                                border-radius: ${theme.borderRadius.sm};
                                border: 1px solid ${theme.colors.border.default};
                              `}>
                                {codexOAuthData.userCode}
                              </Typography.Subtitle>
                              <button
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleCopyCode(codexOAuthData.userCode); }}
                                css={css`
                                  display: flex; align-items: center; gap: ${theme.spacing[0.5]};
                                  font-size: ${theme.typography.fontSize.xs};
                                  color: ${codeCopied ? theme.colors.success.main : theme.colors.text.hint};
                                  cursor: pointer; padding: ${theme.spacing[1]};
                                  &:hover { color: ${codeCopied ? theme.colors.success.main : theme.colors.text.primary}; }
                                `}
                              >
                                {codeCopied ? <CheckCircle size={12} /> : <Copy size={12} />}
                                {codeCopied ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                              <CircleNotch
                                size={14}
                                css={css`
                                  color: ${theme.colors.text.hint};
                                  animation: spin 1s linear infinite;
                                  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                                `}
                              />
                              <Typography.Caption color="hint">
                                Waiting...
                              </Typography.Caption>
                              {codexCountdown > 0 && (
                                <Typography.Caption color="disabled" css={css`margin-left: auto;`}>
                                  {formatCountdown(codexCountdown)}
                                </Typography.Caption>
                              )}
                            </div>
                            <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleCodexOAuthCancel(); }}>
                              Cancel
                            </Button>
                          </div>
                        )}

                        {codexOAuthStatus === 'success' && (
                          <Typography.SmallBody as="div" color={theme.colors.success.main} css={css`
                            display: flex; align-items: center; gap: ${theme.spacing[2]};
                            padding: ${theme.spacing[2]} ${theme.spacing[3]};
                            background: ${theme.colors.success.main}0d;
                            border-radius: ${theme.borderRadius.sm};
                          `}>
                            <CheckCircle size={16} weight="fill" /> Signed in with ChatGPT
                          </Typography.SmallBody>
                        )}

                        {(codexOAuthStatus === 'error' || codexOAuthStatus === 'expired') && (
                          <div css={css`
                            display: flex; align-items: center; justify-content: space-between;
                            padding: ${theme.spacing[2]} ${theme.spacing[3]};
                            background: ${theme.colors.error.main}0d;
                            border-radius: ${theme.borderRadius.sm};
                          `}>
                            <Typography.SmallBody as="span" color={theme.colors.error.main} css={css`display: flex; align-items: center; gap: ${theme.spacing[1]};`}>
                              <XCircle size={16} weight="fill" /> {codexOAuthMessage || 'Failed'}
                            </Typography.SmallBody>
                            <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setCodexOAuthStatus('idle'); setCodexOAuthSession(null); setCodexOAuthData(null); }}>
                              Retry
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Credential input */}
                    <div css={css`display: flex; gap: ${theme.spacing[2]}; align-items: flex-end;`}>
                      <div css={css`flex: 1;`}>
                        <Input
                          label={p.id === 'claude' ? 'API Key or OAuth Token' : 'API Key'}
                          type={showKey ? 'text' : 'password'}
                          value={credentialInput}
                          onChange={(e) => { setCredentialInput((e.target as HTMLInputElement).value); setValidateResult(null); }}
                          placeholder={hasKey ? '********' : (p.id === 'claude' ? 'sk-ant-api03-... or sk-ant-oat01-...' : 'sk-proj-...')}
                          rightElement={
                            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[1.5]};`}>
                              {inferredType && credentialInput.length > 8 && (
                                <Typography.Caption color="hint" css={css`
                                  background: ${theme.colors.background.elevated};
                                  padding: 1px ${theme.spacing[1]};
                                  border-radius: ${theme.borderRadius.sm};
                                  white-space: nowrap;
                                `}>
                                  {inferredType}
                                </Typography.Caption>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}
                                css={css`
                                  cursor: pointer; padding: 0; color: ${theme.colors.text.hint};
                                  &:hover { color: ${theme.colors.text.primary}; }
                                `}
                              >
                                {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                              </button>
                            </div>
                          }
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleValidateAndSave(p.id); }}
                        loading={validateMutation.isPending || saveKeyMutation.isPending}
                        disabled={!credentialInput.trim()}
                      >
                        Validate & Save
                      </Button>
                    </div>
                    {validateResult && (
                      <Typography.Caption as="div" color={validateResult.valid ? theme.colors.success.main : theme.colors.error.main}>
                        {validateResult.message}
                      </Typography.Caption>
                    )}

                    {/* Action buttons */}
                    <div css={css`display: flex; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
                      {activeProvider !== p.id && hasKey && (
                        <Button variant="secondary" size="sm" onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleSwitch(p.id); }}>
                          Switch to {p.name}
                        </Button>
                      )}
                      {hasKey && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleRemove(p.id); }}
                          loading={removeKeyMutation.isPending}
                        >
                          <Trash size={14} css={css`margin-right: ${theme.spacing[1]};`} />
                          Remove
                        </Button>
                      )}
                    </div>

                    {/* Security footnote */}
                    <Typography.Caption as="div" color="disabled" css={css`
                      display: flex; align-items: center; gap: ${theme.spacing[1.5]};
                    `}>
                      <ShieldCheck size={12} css={css`flex-shrink: 0;`} />
                      <span>Encrypted at rest. Never leaves your instance.</span>
                    </Typography.Caption>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        );
      })}

      <Modal open={switchConfirm !== null} onClose={() => setSwitchConfirm(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Switch to {switchConfirm}?
          </Typography.Subtitle>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            Your Animus will use {switchConfirm} for all future thinking. The current mind session will end and restart with the new provider.
          </Typography.SmallBody>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setSwitchConfirm(null)}>Cancel</Button>
            <Button size="sm" onClick={confirmSwitch} loading={updateSettingsMutation.isPending}>
              Switch
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// Section: Channels
// ============================================================================

function ChannelsSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: channelConfigs } = trpc.channels.getConfigs.useQuery();
  const configureMutation = trpc.channels.configure.useMutation({
    onSuccess: () => utils.channels.getConfigs.invalidate(),
  });
  const validateMutation = trpc.channels.validate.useMutation();

  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [smsConfig, setSmsConfig] = useState({ accountSid: '', authToken: '', phoneNumber: '', webhookUrl: '' });
  const [discordConfig, setDiscordConfig] = useState({ botToken: '', applicationId: '', allowedGuildIds: '' });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // Channel config details are stored server-side; the getConfigs list
  // only returns metadata (id, type, enabled, timestamps). The form
  // fields start empty -- the user fills them in or re-enters on save.
  // A future enhancement could fetch individual channel configs on expand.

  const getChannelStatus = (type: string) => {
    const cfg = channelConfigs?.find((c: any) => c.channelType === type);
    if (!cfg) return 'default';
    return cfg.isEnabled ? 'success' : 'default';
  };

  const isEnabled = (type: string) => {
    const cfg = channelConfigs?.find((c: any) => c.channelType === type);
    return cfg?.isEnabled ?? false;
  };

  const channelDefs = [
    { type: 'web', name: 'Web', icon: Globe, alwaysOn: true },
    { type: 'sms', name: 'SMS', icon: ChatText, alwaysOn: false },
    { type: 'discord', name: 'Discord', icon: DiscordLogo, alwaysOn: false },
    { type: 'openai_api', name: 'API', icon: Code, alwaysOn: true },
  ];

  const handleSaveSms = () => {
    configureMutation.mutate({
      channelType: 'sms',
      config: smsConfig,
      isEnabled: true,
    });
  };

  const handleSaveDiscord = () => {
    configureMutation.mutate({
      channelType: 'discord',
      config: {
        ...discordConfig,
        allowedGuildIds: discordConfig.allowedGuildIds.split(',').map((s) => s.trim()).filter(Boolean),
      },
      isEnabled: true,
    });
  };

  const handleToggle = (type: string, enabled: boolean) => {
    configureMutation.mutate({
      channelType: type as any,
      config: {},
      isEnabled: enabled,
    });
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
      {channelDefs.map((ch) => (
        <Card key={ch.type} variant="outlined" padding="md">
          <div
            css={css`display: flex; align-items: center; justify-content: space-between; cursor: pointer;`}
            onClick={() => setExpandedChannel(expandedChannel === ch.type ? null : ch.type)}
          >
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
              <ch.icon size={20} />
              <Typography.BodyAlt as="span">{ch.name}</Typography.BodyAlt>
              <Badge variant={ch.alwaysOn ? 'success' : getChannelStatus(ch.type) as any}>
                {ch.alwaysOn ? 'Always on' : (isEnabled(ch.type) ? 'Active' : 'Not configured')}
              </Badge>
            </div>
            {!ch.alwaysOn && (
              <div onClick={(e) => e.stopPropagation()}>
                <Toggle
                  checked={isEnabled(ch.type)}
                  onChange={(checked) => handleToggle(ch.type, checked)}
                />
              </div>
            )}
          </div>

          <AnimatePresence>
            {expandedChannel === ch.type && ch.type === 'sms' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                css={css`overflow: hidden;`}
              >
                <div css={css`
                  margin-top: ${theme.spacing[4]};
                  padding-top: ${theme.spacing[4]};
                  border-top: 1px solid ${theme.colors.border.light};
                  display: flex; flex-direction: column; gap: ${theme.spacing[3]};
                `}>
                  <Input
                    label="Twilio Account SID"
                    value={smsConfig.accountSid}
                    onChange={(e) => setSmsConfig({ ...smsConfig, accountSid: (e.target as HTMLInputElement).value })}
                  />
                  <Input
                    label="Auth Token"
                    type={showSecrets['smsAuth'] ? 'text' : 'password'}
                    value={smsConfig.authToken}
                    onChange={(e) => setSmsConfig({ ...smsConfig, authToken: (e.target as HTMLInputElement).value })}
                    rightElement={
                      <button
                        onClick={() => setShowSecrets({ ...showSecrets, smsAuth: !showSecrets['smsAuth'] })}
                        css={css`cursor: pointer; padding: 0; color: ${theme.colors.text.hint}; &:hover { color: ${theme.colors.text.primary}; }`}
                      >
                        {showSecrets['smsAuth'] ? <EyeSlash size={16} /> : <Eye size={16} />}
                      </button>
                    }
                  />
                  <Input
                    label="Phone Number"
                    value={smsConfig.phoneNumber}
                    onChange={(e) => setSmsConfig({ ...smsConfig, phoneNumber: (e.target as HTMLInputElement).value })}
                    placeholder="+1234567890"
                  />
                  <Input
                    label="Webhook URL"
                    value={smsConfig.webhookUrl}
                    onChange={(e) => setSmsConfig({ ...smsConfig, webhookUrl: (e.target as HTMLInputElement).value })}
                    placeholder="https://..."
                  />
                  <Button size="sm" onClick={handleSaveSms} loading={configureMutation.isPending}>
                    Save
                  </Button>
                </div>
              </motion.div>
            )}
            {expandedChannel === ch.type && ch.type === 'discord' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                css={css`overflow: hidden;`}
              >
                <div css={css`
                  margin-top: ${theme.spacing[4]};
                  padding-top: ${theme.spacing[4]};
                  border-top: 1px solid ${theme.colors.border.light};
                  display: flex; flex-direction: column; gap: ${theme.spacing[3]};
                `}>
                  <Input
                    label="Bot Token"
                    type={showSecrets['discordToken'] ? 'text' : 'password'}
                    value={discordConfig.botToken}
                    onChange={(e) => setDiscordConfig({ ...discordConfig, botToken: (e.target as HTMLInputElement).value })}
                    rightElement={
                      <button
                        onClick={() => setShowSecrets({ ...showSecrets, discordToken: !showSecrets['discordToken'] })}
                        css={css`cursor: pointer; padding: 0; color: ${theme.colors.text.hint}; &:hover { color: ${theme.colors.text.primary}; }`}
                      >
                        {showSecrets['discordToken'] ? <EyeSlash size={16} /> : <Eye size={16} />}
                      </button>
                    }
                  />
                  <Input
                    label="Application ID"
                    value={discordConfig.applicationId}
                    onChange={(e) => setDiscordConfig({ ...discordConfig, applicationId: (e.target as HTMLInputElement).value })}
                  />
                  <Input
                    label="Allowed Guild IDs"
                    value={discordConfig.allowedGuildIds}
                    onChange={(e) => setDiscordConfig({ ...discordConfig, allowedGuildIds: (e.target as HTMLInputElement).value })}
                    helperText="Comma-separated list of Discord server IDs"
                  />
                  <Button size="sm" onClick={handleSaveDiscord} loading={configureMutation.isPending}>
                    Save
                  </Button>
                </div>
              </motion.div>
            )}
            {expandedChannel === ch.type && (ch.type === 'web' || ch.type === 'openai_api') && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                css={css`overflow: hidden;`}
              >
                <div css={css`
                  margin-top: ${theme.spacing[4]};
                  padding-top: ${theme.spacing[4]};
                  border-top: 1px solid ${theme.colors.border.light};
                `}>
                  <Typography.SmallBody color="secondary">
                    {ch.type === 'web'
                      ? 'The web channel is always active. No additional configuration needed.'
                      : 'The API channel is always available. Use it to integrate Animus with external systems.'}
                  </Typography.SmallBody>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Section: Goals
// ============================================================================

function GoalsSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: settings } = trpc.settings.getSystemSettings.useQuery();
  const updateMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });
  const goalSave = useSaveFlash();

  const currentMode = settings?.goalApprovalMode ?? 'always_approve';

  const modes = [
    {
      id: 'always_approve' as const,
      label: 'Ask me first',
      description: 'Your Animus will propose goals conversationally and wait for your approval before pursuing them.',
    },
    {
      id: 'auto_approve' as const,
      label: "Go ahead, I'll review",
      description: 'Your Animus will start pursuing goals immediately and let you know. You can cancel anytime.',
    },
    {
      id: 'full_autonomy' as const,
      label: 'Full autonomy',
      description: 'Your Animus will pursue goals independently. You can discover and manage goals in the Mind space.',
    },
  ];

  const handleSelect = (mode: typeof currentMode) => {
    updateMutation.mutate({ goalApprovalMode: mode }, { onSuccess: () => goalSave.flash() });
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
        <Typography.SmallBodyAlt as="label" color="secondary">
          How should your Animus handle new goals?
        </Typography.SmallBodyAlt>
        <SaveIndicator show={goalSave.show} />
      </div>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        {modes.map((mode) => (
          <Card
            key={mode.id}
            variant={currentMode === mode.id ? 'elevated' : 'outlined'}
            interactive
            padding="md"
            onClick={() => handleSelect(mode.id)}
          >
            <div css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[3]};`}>
              {currentMode === mode.id && <Check size={18} weight="bold" css={css`flex-shrink: 0; margin-top: 2px;`} />}
              <div>
                <Typography.BodyAlt as="span">{mode.label}</Typography.BodyAlt>
                <Typography.SmallBody color="secondary" css={css`margin-top: ${theme.spacing[1]};`}>
                  {mode.description}
                </Typography.SmallBody>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Typography.SmallBody color="hint" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
        Goals with average salience below 0.05 over 30 days are automatically cleaned up.
      </Typography.SmallBody>
    </div>
  );
}

// ============================================================================
// Section: Plugins
// ============================================================================

// Component label map for human-friendly display
const componentLabelMap: Record<string, { singular: string; plural: string }> = {
  skills: { singular: 'skill', plural: 'skills' },
  tools: { singular: 'tool', plural: 'tools' },
  contextSources: { singular: 'context source', plural: 'context sources' },
  hooks: { singular: 'hook', plural: 'hooks' },
  decisionTypes: { singular: 'decision type', plural: 'decision types' },
  triggers: { singular: 'trigger', plural: 'triggers' },
  agents: { singular: 'agent', plural: 'agents' },
};

// Source badge configuration
const sourceBadgeConfig: Record<string, { variant: 'default' | 'info' | 'success' | 'warning'; label: string }> = {
  'built-in': { variant: 'default', label: 'built-in' },
  local: { variant: 'info', label: 'local' },
  git: { variant: 'success', label: 'git' },
  npm: { variant: 'warning', label: 'npm' },
};

function PluginsSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  // Queries
  const { data: plugins, isLoading } = trpc.plugins.list.useQuery();

  // Mutations
  const installMutation = trpc.plugins.install.useMutation({
    onSuccess: () => {
      utils.plugins.list.invalidate();
      setShowInstallModal(false);
      setInstallPath('');
      setInstallValidation(null);
    },
  });
  const uninstallMutation = trpc.plugins.uninstall.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });
  const enableMutation = trpc.plugins.enable.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });
  const disableMutation = trpc.plugins.disable.useMutation({
    onSuccess: () => utils.plugins.list.invalidate(),
  });
  const setConfigMutation = trpc.plugins.setConfig.useMutation({
    onSuccess: () => {
      utils.plugins.list.invalidate();
      setConfigPlugin(null);
    },
  });

  // Local state
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installTab, setInstallTab] = useState<'local' | 'git' | 'npm'>('local');
  const [installPath, setInstallPath] = useState('');
  const [installValidation, setInstallValidation] = useState<{
    valid: boolean;
    manifest?: any;
    error?: string;
  } | null>(null);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [configPlugin, setConfigPlugin] = useState<string | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Validate path query (lazy)
  const validateQuery = trpc.plugins.validatePath.useQuery(
    { path: installPath },
    { enabled: false }
  );

  const handleValidatePath = async () => {
    const result = await validateQuery.refetch();
    if (result.data) {
      setInstallValidation(result.data);
    }
  };

  const handleInstall = () => {
    setMutationError(null);
    installMutation.mutate(
      { source: installTab, path: installPath },
      {
        onError: (err) => setMutationError(err.message),
      }
    );
  };

  const handleToggleEnabled = (name: string, currentlyEnabled: boolean) => {
    setMutationError(null);
    if (currentlyEnabled) {
      disableMutation.mutate({ name }, { onError: (err) => setMutationError(err.message) });
    } else {
      enableMutation.mutate({ name }, { onError: (err) => setMutationError(err.message) });
    }
  };

  const handleUninstall = (name: string) => {
    setMutationError(null);
    uninstallMutation.mutate(
      { name },
      {
        onSuccess: () => setUninstallConfirm(null),
        onError: (err) => {
          setMutationError(err.message);
          setUninstallConfirm(null);
        },
      }
    );
  };

  if (isLoading) {
    return <Typography.Body color="hint" css={css`padding: ${theme.spacing[8]};`}>Loading plugins...</Typography.Body>;
  }

  const pluginList = plugins ?? [];

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Header */}
      <div css={css`display: flex; align-items: center; justify-content: space-between;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <Typography.Subtitle as="h2" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Plugins
          </Typography.Subtitle>
          {pluginList.length > 0 && (
            <Badge variant="default">{pluginList.length}</Badge>
          )}
        </div>
        <Button size="sm" onClick={() => { setShowInstallModal(true); setInstallPath(''); setInstallValidation(null); setInstallTab('local'); }}>
          <Plus size={14} css={css`margin-right: ${theme.spacing[1]};`} />
          Add Plugin
        </Button>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {mutationError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              background: ${theme.colors.error.main}1a;
              border-radius: ${theme.borderRadius.default};
              display: flex;
              align-items: center;
              justify-content: space-between;
            `}
          >
            <Typography.SmallBody color={theme.colors.error.main}>
              {mutationError}
            </Typography.SmallBody>
            <button
              onClick={() => setMutationError(null)}
              css={css`cursor: pointer; padding: ${theme.spacing[1]}; color: ${theme.colors.error.main}; &:hover { opacity: 0.7; }`}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Plugin list */}
      {pluginList.length === 0 ? (
        <div css={css`
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: ${theme.spacing[12]} ${theme.spacing[4]};
          gap: ${theme.spacing[4]};
        `}>
          <PuzzlePiece size={40} css={css`color: ${theme.colors.text.disabled};`} />
          <Typography.Body color="hint">No plugins installed</Typography.Body>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setShowInstallModal(true); setInstallPath(''); setInstallValidation(null); setInstallTab('local'); }}
          >
            Add Plugin
          </Button>
        </div>
      ) : (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {pluginList.map((plugin) => {
            const isExpanded = expandedPlugin === plugin.name;
            const source = sourceBadgeConfig[plugin.source] ?? { variant: 'default' as const, label: plugin.source };
            const componentBadges = Object.entries(plugin.components)
              .filter(([, count]) => (count as number) > 0)
              .map(([key, count]) => {
                const labels = componentLabelMap[key];
                return labels
                  ? `${count} ${(count as number) === 1 ? labels.singular : labels.plural}`
                  : `${count} ${key}`;
              });

            return (
              <Card key={plugin.name} variant="outlined" padding="md">
                <div
                  css={css`display: flex; align-items: flex-start; justify-content: space-between; cursor: pointer;`}
                  onClick={() => setExpandedPlugin(isExpanded ? null : plugin.name)}
                >
                  <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1.5]}; flex: 1; min-width: 0;`}>
                    <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
                      <Typography.BodyAlt as="span">{plugin.name}</Typography.BodyAlt>
                      <Typography.Caption as="span" color="hint">v{plugin.version}</Typography.Caption>
                      <Badge variant={source.variant}>{source.label}</Badge>
                    </div>
                    {plugin.description && (
                      <Typography.SmallBody color="secondary" css={css`
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: ${isExpanded ? 'normal' : 'nowrap'};
                      `}>
                        {plugin.description}
                      </Typography.SmallBody>
                    )}
                    {componentBadges.length > 0 && (
                      <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]}; margin-top: ${theme.spacing[0.5]};`}>
                        {componentBadges.map((label) => (
                          <Typography.Caption
                            key={label}
                            as="span"
                            color="hint"
                            css={css`
                              padding: 1px ${theme.spacing[2]};
                              border: 1px solid ${theme.colors.border.default};
                              border-radius: ${theme.borderRadius.full};
                              white-space: nowrap;
                            `}
                          >
                            {label}
                          </Typography.Caption>
                        ))}
                      </div>
                    )}
                  </div>

                  <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]}; flex-shrink: 0; margin-left: ${theme.spacing[3]};`} onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      checked={plugin.enabled}
                      onChange={() => handleToggleEnabled(plugin.name, plugin.enabled)}
                    />
                  </div>
                </div>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      css={css`overflow: hidden;`}
                    >
                      <PluginDetail
                        pluginName={plugin.name}
                        source={plugin.source}
                        hasConfig={plugin.hasConfig}
                        onConfigure={() => setConfigPlugin(plugin.name)}
                        onUninstall={() => setUninstallConfirm(plugin.name)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      )}

      {/* Install Modal */}
      <Modal open={showInstallModal} onClose={() => setShowInstallModal(false)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Add Plugin
          </Typography.Subtitle>

          {/* Tabs */}
          <div css={css`display: flex; gap: ${theme.spacing[1]}; border-bottom: 1px solid ${theme.colors.border.light}; padding-bottom: 0;`}>
            {([
              { id: 'local' as const, label: 'Local Path', icon: FolderOpen },
              { id: 'git' as const, label: 'Git URL', icon: GitBranch },
              { id: 'npm' as const, label: 'npm Package', icon: Package },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setInstallTab(tab.id);
                  setInstallValidation(null);
                  setInstallPath('');
                }}
                css={css`
                  display: flex;
                  align-items: center;
                  gap: ${theme.spacing[1.5]};
                  padding: ${theme.spacing[2]} ${theme.spacing[3]};
                  font-size: ${theme.typography.fontSize.sm};
                  font-weight: ${installTab === tab.id ? theme.typography.fontWeight.medium : theme.typography.fontWeight.normal};
                  color: ${installTab === tab.id ? theme.colors.text.primary : theme.colors.text.secondary};
                  cursor: pointer;
                  border-bottom: 2px solid ${installTab === tab.id ? theme.colors.accent : 'transparent'};
                  margin-bottom: -1px;
                  transition: all ${theme.transitions.micro};

                  &:hover {
                    color: ${theme.colors.text.primary};
                  }
                `}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Local path form */}
          {installTab === 'local' && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Input
                label="Absolute path to plugin directory"
                value={installPath}
                onChange={(e) => { setInstallPath((e.target as HTMLInputElement).value); setInstallValidation(null); }}
                placeholder="/path/to/my-plugin"
              />
              <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleValidatePath}
                  disabled={!installPath.trim()}
                  loading={validateQuery.isFetching}
                >
                  Validate
                </Button>
              </div>

              {/* Validation result */}
              <AnimatePresence>
                {installValidation && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    css={css`
                      padding: ${theme.spacing[3]};
                      border-radius: ${theme.borderRadius.default};
                      background: ${installValidation.valid ? theme.colors.success.main : theme.colors.error.main}0d;
                      border: 1px solid ${installValidation.valid ? theme.colors.success.main : theme.colors.error.main}33;
                    `}
                  >
                    {installValidation.valid ? (
                      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                          <CheckCircle size={16} weight="fill" css={css`color: ${theme.colors.success.main}; flex-shrink: 0;`} />
                          <Typography.SmallBodyAlt as="span" color={theme.colors.success.main}>
                            Valid plugin manifest
                          </Typography.SmallBodyAlt>
                        </div>
                        {installValidation.manifest && (
                          <div css={css`padding-left: ${theme.spacing[6]};`}>
                            <Typography.SmallBody as="div">
                              {installValidation.manifest.name} <Typography.Caption as="span" color="hint">v{installValidation.manifest.version}</Typography.Caption>
                            </Typography.SmallBody>
                            {installValidation.manifest.description && (
                              <Typography.Caption as="div" color="secondary" css={css`margin-top: ${theme.spacing[0.5]};`}>
                                {installValidation.manifest.description}
                              </Typography.Caption>
                            )}
                            {installValidation.manifest.author && (
                              <Typography.Caption as="div" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
                                by {typeof installValidation.manifest.author === 'string'
                                  ? installValidation.manifest.author
                                  : installValidation.manifest.author.name}
                              </Typography.Caption>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div css={css`display: flex; align-items: flex-start; gap: ${theme.spacing[2]};`}>
                        <XCircle size={16} weight="fill" css={css`color: ${theme.colors.error.main}; flex-shrink: 0; margin-top: 2px;`} />
                        <Typography.SmallBody color={theme.colors.error.main}>
                          {installValidation.error}
                        </Typography.SmallBody>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={!installValidation?.valid}
                  loading={installMutation.isPending}
                >
                  Install
                </Button>
              </div>
            </div>
          )}

          {/* Git URL form */}
          {installTab === 'git' && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Input
                label="Git repository URL"
                value={installPath}
                onChange={(e) => setInstallPath((e.target as HTMLInputElement).value)}
                placeholder="https://github.com/user/animus-plugin.git"
              />
              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={!installPath.trim()}
                  loading={installMutation.isPending}
                >
                  Install
                </Button>
              </div>
            </div>
          )}

          {/* npm package form */}
          {installTab === 'npm' && (
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
              <Input
                label="npm package name"
                value={installPath}
                onChange={(e) => setInstallPath((e.target as HTMLInputElement).value)}
                placeholder="@animus/plugin-example"
              />
              <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
                <Button variant="ghost" size="sm" onClick={() => setShowInstallModal(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleInstall}
                  disabled={!installPath.trim()}
                  loading={installMutation.isPending}
                >
                  Install
                </Button>
              </div>
            </div>
          )}

          {/* Install error */}
          {installMutation.isError && (
            <div css={css`
              padding: ${theme.spacing[2]} ${theme.spacing[4]};
              background: ${theme.colors.error.main}1a;
              border-radius: ${theme.borderRadius.default};
            `}>
              <Typography.SmallBody color={theme.colors.error.main}>
                {installMutation.error?.message ?? 'Installation failed'}
              </Typography.SmallBody>
            </div>
          )}
        </div>
      </Modal>

      {/* Uninstall confirmation modal */}
      <Modal open={uninstallConfirm !== null} onClose={() => setUninstallConfirm(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <Warning size={20} css={css`color: ${theme.colors.error.main};`} />
            <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
              Uninstall {uninstallConfirm}?
            </Typography.Subtitle>
          </div>
          <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
            This will remove the plugin and all its components. Any skills, tools, or hooks it provides will no longer be available.
          </Typography.SmallBody>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
            <Button variant="ghost" size="sm" onClick={() => setUninstallConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => uninstallConfirm && handleUninstall(uninstallConfirm)}
              loading={uninstallMutation.isPending}
            >
              Uninstall
            </Button>
          </div>
        </div>
      </Modal>

      {/* Configure Plugin Modal */}
      {configPlugin && (
        <PluginConfigModal
          pluginName={configPlugin}
          onClose={() => setConfigPlugin(null)}
          onSave={(config) => {
            setConfigMutation.mutate({ name: configPlugin, config });
          }}
          isSaving={setConfigMutation.isPending}
        />
      )}
    </div>
  );
}

// ============================================================================
// Plugin Detail (expanded view within plugin card)
// ============================================================================

function PluginDetail({
  pluginName,
  source,
  hasConfig,
  onConfigure,
  onUninstall,
}: {
  pluginName: string;
  source: string;
  hasConfig: boolean;
  onConfigure: () => void;
  onUninstall: () => void;
}) {
  const theme = useTheme();
  const { data: detail, isLoading } = trpc.plugins.get.useQuery({ name: pluginName });

  if (isLoading) {
    return (
      <div css={css`
        margin-top: ${theme.spacing[4]};
        padding-top: ${theme.spacing[4]};
        border-top: 1px solid ${theme.colors.border.light};
      `}>
        <Typography.SmallBody color="hint">Loading details...</Typography.SmallBody>
      </div>
    );
  }

  if (!detail) return null;

  const componentSections = [
    { label: 'Skills', items: detail.components.skills },
    { label: 'Tools (MCP)', items: detail.components.tools },
    { label: 'Context Sources', items: detail.components.contextSources },
    { label: 'Hooks', items: detail.components.hooks },
    { label: 'Decision Types', items: detail.components.decisionTypes },
    { label: 'Triggers', items: detail.components.triggers },
    { label: 'Agents', items: detail.components.agents },
  ].filter((s) => s.items.length > 0);

  return (
    <div css={css`
      margin-top: ${theme.spacing[4]};
      padding-top: ${theme.spacing[4]};
      border-top: 1px solid ${theme.colors.border.light};
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing[4]};
    `}>
      {/* Author & license */}
      {(detail.author || detail.license) && (
        <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[3]};`}>
          {detail.author && (
            <Typography.Caption as="span" color="hint">
              Author: {detail.author.name}
              {detail.author.url && (
                <a
                  href={detail.author.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  css={css`
                    margin-left: ${theme.spacing[1]};
                    color: ${theme.colors.text.secondary};
                    &:hover { color: ${theme.colors.text.primary}; }
                  `}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                  <ArrowSquareOut size={10} css={css`vertical-align: middle;`} />
                </a>
              )}
            </Typography.Caption>
          )}
          {detail.license && (
            <Typography.Caption as="span" color="hint">
              License: {detail.license}
            </Typography.Caption>
          )}
        </div>
      )}

      {/* Component lists */}
      {componentSections.length > 0 && (
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          {componentSections.map((section) => (
            <div key={section.label} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
              <Typography.Caption as="span" color="hint" css={css`
                font-weight: ${theme.typography.fontWeight.medium};
                text-transform: uppercase;
                letter-spacing: 0.06em;
              `}>
                {section.label}
              </Typography.Caption>
              <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[1.5]};`}>
                {section.items.map((item) => (
                  <Typography.SmallBody
                    key={item}
                    as="span"
                    css={css`
                      padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
                      background: ${theme.colors.background.elevated};
                      border-radius: ${theme.borderRadius.sm};
                      font-size: ${theme.typography.fontSize.xs};
                    `}
                  >
                    {item}
                  </Typography.SmallBody>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div css={css`display: flex; gap: ${theme.spacing[2]}; flex-wrap: wrap;`}>
        {hasConfig && (
          <Button
            variant="secondary"
            size="sm"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onConfigure(); }}
          >
            <GearFine size={14} css={css`margin-right: ${theme.spacing[1]};`} />
            Configure
          </Button>
        )}
        {source !== 'built-in' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); onUninstall(); }}
          >
            <Trash size={14} css={css`margin-right: ${theme.spacing[1]};`} />
            Uninstall
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Plugin Config Modal
// ============================================================================

function PluginConfigModal({
  pluginName,
  onClose,
  onSave,
  isSaving,
}: {
  pluginName: string;
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const theme = useTheme();
  const { data: currentConfig, isLoading: configLoading } = trpc.plugins.getConfig.useQuery({ name: pluginName });
  const { data: detail } = trpc.plugins.get.useQuery({ name: pluginName });

  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [rawJson, setRawJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Determine if we have a schema or should use raw JSON
  const configSchema = detail?.manifest?.configSchema;
  const hasSchema = configSchema && typeof configSchema === 'object' && Object.keys(configSchema).length > 0;

  // Initialize values from current config
  useEffect(() => {
    if (initialized) return;
    if (currentConfig !== undefined) {
      const cfg = currentConfig ?? {};
      if (hasSchema) {
        setConfigValues(cfg as Record<string, unknown>);
      } else {
        setRawJson(JSON.stringify(cfg, null, 2));
      }
      setInitialized(true);
    }
  }, [currentConfig, hasSchema, initialized]);

  const handleSave = () => {
    if (hasSchema) {
      onSave(configValues);
    } else {
      try {
        const parsed = JSON.parse(rawJson || '{}');
        setJsonError('');
        onSave(parsed);
      } catch {
        setJsonError('Invalid JSON');
      }
    }
  };

  // Determine if a config key likely holds a secret
  const isSecretKey = (key: string) => {
    const lower = key.toLowerCase();
    return ['key', 'secret', 'token', 'password', 'credential'].some((s) => lower.includes(s));
  };

  return (
    <Modal open onClose={onClose}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Configure: {pluginName}
        </Typography.Subtitle>

        {configLoading ? (
          <Typography.SmallBody color="hint">Loading configuration...</Typography.SmallBody>
        ) : hasSchema ? (
          // Schema-based form
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
            {Object.entries(configSchema as Record<string, any>).map(([key, schemaDef]) => {
              const value = configValues[key];
              const fieldType = schemaDef?.type ?? (typeof value === 'boolean' ? 'boolean' : 'string');
              const label = schemaDef?.title ?? schemaDef?.label ?? key;
              const description = schemaDef?.description;

              if (fieldType === 'boolean') {
                return (
                  <div key={key} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
                    <Toggle
                      checked={!!value}
                      onChange={(checked) => setConfigValues({ ...configValues, [key]: checked })}
                      label={label}
                    />
                    {description && (
                      <Typography.Caption as="p" color="hint">{description}</Typography.Caption>
                    )}
                  </div>
                );
              }

              return (
                <div key={key}>
                  <Input
                    label={label}
                    type={isSecretKey(key) ? 'password' : 'text'}
                    value={value != null ? String(value) : ''}
                    onChange={(e) => setConfigValues({ ...configValues, [key]: (e.target as HTMLInputElement).value })}
                    helperText={description}
                    placeholder={schemaDef?.default != null ? String(schemaDef.default) : undefined}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          // Raw JSON editor
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
            <Typography.SmallBody color="secondary">
              This plugin does not define a config schema. Edit the raw JSON below.
            </Typography.SmallBody>
            <textarea
              value={rawJson}
              onChange={(e) => { setRawJson(e.target.value); setJsonError(''); }}
              rows={10}
              css={css`
                font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
                font-size: ${theme.typography.fontSize.sm};
                padding: ${theme.spacing[3]};
                border-radius: ${theme.borderRadius.default};
                border: 1px solid ${jsonError ? theme.colors.error.main : theme.colors.border.default};
                background: ${theme.colors.background.paper};
                color: ${theme.colors.text.primary};
                resize: vertical;
                width: 100%;
                box-sizing: border-box;

                &:focus {
                  outline: none;
                  border-color: ${jsonError ? theme.colors.error.main : theme.colors.border.focus};
                }
              `}
            />
            {jsonError && (
              <Typography.Caption color={theme.colors.error.main}>{jsonError}</Typography.Caption>
            )}
          </div>
        )}

        <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} loading={isSaving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Section: System
// ============================================================================

function SystemSection() {
  const theme = useTheme();
  const utils = trpc.useUtils();

  const { data: settings } = trpc.settings.getSystemSettings.useQuery();
  const { data: me } = trpc.auth.me.useQuery();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  const softResetMutation = trpc.data.softReset.useMutation();
  const fullResetMutation = trpc.data.fullReset.useMutation();
  const clearConvMutation = trpc.data.clearConversations.useMutation();
  const exportQuery = trpc.data.export.useQuery(undefined, { enabled: false });

  const [confirmAction, setConfirmAction] = useState<'soft' | 'full' | 'clear' | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const handleConfirmAction = () => {
    const onSuccess = () => setConfirmAction(null);
    if (confirmAction === 'soft') softResetMutation.mutate(undefined, { onSuccess });
    if (confirmAction === 'full') fullResetMutation.mutate(undefined, { onSuccess });
    if (confirmAction === 'clear') clearConvMutation.mutate(undefined, { onSuccess });
  };

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `animus-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const confirmMessages = {
    soft: {
      title: 'Soft reset',
      description: 'This will clear all thoughts, emotions, goals, tasks, and decisions. Your Animus will lose its current inner state but retain memories and conversations. The heartbeat will be paused.',
    },
    full: {
      title: 'Full reset',
      description: 'This will clear all AI state including memories, conversations, goals, and tasks. Your Animus will be effectively reborn with the same personality but no accumulated knowledge. This cannot be undone.',
    },
    clear: {
      title: 'Clear conversations',
      description: 'This will delete all message history and media across all contacts and channels. This cannot be undone.',
    },
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* Data Management */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Data Management
        </Typography.Subtitle>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
          <div>
            <button
              onClick={() => setConfirmAction('soft')}
              css={css`
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.error.main};
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
                text-underline-offset: 3px;
                &:hover { opacity: 0.8; }
              `}
            >
              Soft reset
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Clear thoughts, emotions, goals, and tasks. Preserve memories and conversations.
            </Typography.Caption>
          </div>
          <div>
            <button
              onClick={() => setConfirmAction('full')}
              css={css`
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.error.main};
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
                text-underline-offset: 3px;
                &:hover { opacity: 0.8; }
              `}
            >
              Full reset
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Clear all AI state including memories and conversations.
            </Typography.Caption>
          </div>
          <div>
            <button
              onClick={() => setConfirmAction('clear')}
              css={css`
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.error.main};
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
                text-underline-offset: 3px;
                &:hover { opacity: 0.8; }
              `}
            >
              Clear conversations
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Delete all message history and media across all contacts and channels.
            </Typography.Caption>
          </div>
          <div>
            <button
              onClick={handleExport}
              css={css`
                font-size: ${theme.typography.fontSize.sm};
                color: ${theme.colors.text.primary};
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
                text-underline-offset: 3px;
                &:hover { opacity: 0.8; }
              `}
            >
              Export data
            </button>
            <Typography.Caption as="p" color="hint" css={css`margin-top: ${theme.spacing[0.5]};`}>
              Download all databases as a backup file.
            </Typography.Caption>
          </div>
        </div>
      </div>

      {/* Account */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Account
        </Typography.Subtitle>
        <Typography.SmallBody as="div" color="secondary">
          {me?.email ?? 'Loading...'}
        </Typography.SmallBody>
        {!showPasswordForm ? (
          <button
            onClick={() => setShowPasswordForm(true)}
            css={css`
              font-size: ${theme.typography.fontSize.sm};
              color: ${theme.colors.text.primary};
              cursor: pointer;
              padding: 0;
              text-decoration: underline;
              text-underline-offset: 3px;
              text-align: left;
              &:hover { opacity: 0.8; }
            `}
          >
            Change password
          </button>
        ) : (
          <PasswordChangeForm onClose={() => setShowPasswordForm(false)} />
        )}
      </div>

      {/* Reset confirmation modal */}
      <Modal open={confirmAction !== null} onClose={() => setConfirmAction(null)}>
        {confirmAction && (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
              <Warning size={20} css={css`color: ${theme.colors.error.main};`} />
              <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
                {confirmMessages[confirmAction].title}
              </Typography.Subtitle>
            </div>
            <Typography.SmallBody color="secondary" css={css`line-height: ${theme.typography.lineHeight.relaxed};`}>
              {confirmMessages[confirmAction].description}
            </Typography.SmallBody>
            <div css={css`display: flex; gap: ${theme.spacing[3]}; justify-content: flex-end;`}>
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmAction}
                loading={softResetMutation.isPending || fullResetMutation.isPending || clearConvMutation.isPending}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Success/error banners */}
      <AnimatePresence>
        {(softResetMutation.isSuccess || fullResetMutation.isSuccess || clearConvMutation.isSuccess) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            css={css`
              padding: ${theme.spacing[3]} ${theme.spacing[4]};
              background: ${theme.colors.success.main}1a;
              border-radius: ${theme.borderRadius.default};
            `}
          >
            <Typography.SmallBody color={theme.colors.success.main}>
              Operation completed successfully.
            </Typography.SmallBody>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Password Change Form (inline)
// ============================================================================

function PasswordChangeForm({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  // Note: password change is a UI stub for now -- the backend auth router
  // doesn't expose a change-password mutation yet. We'll show the form
  // structure and call the appropriate route when it's available.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    // TODO: Wire to auth.changePassword mutation when available
    setError('Password change not yet implemented in backend');
  };

  return (
    <div css={css`
      display: flex; flex-direction: column; gap: ${theme.spacing[3]};
      padding: ${theme.spacing[4]};
      border: 1px solid ${theme.colors.border.default};
      border-radius: ${theme.borderRadius.md};
    `}>
      <Input
        type="password"
        label="Current password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
      />
      <Input
        type="password"
        label="New password"
        value={newPassword}
        onChange={(e) => setNewPassword((e.target as HTMLInputElement).value)}
      />
      <Input
        type="password"
        label="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
        error={error || undefined}
      />
      <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
        <Button size="sm" onClick={handleSubmit}>Save password</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ============================================================================
// Settings Page (main export)
// ============================================================================

export function SettingsPage() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active section from URL
  const activeSection: SettingsSection = useMemo(() => {
    const path = location.pathname.replace('/settings/', '').replace('/settings', '');
    const match = sections.find((s) => s.id === path);
    return match ? match.id : 'persona';
  }, [location.pathname]);

  // Redirect bare /settings to /settings/persona
  useEffect(() => {
    if (location.pathname === '/settings' || location.pathname === '/settings/') {
      navigate('/settings/persona', { replace: true });
    }
  }, [location.pathname, navigate]);

  const handleSectionChange = (section: SettingsSection) => {
    navigate(`/settings/${section}`);
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mobileMenuOpen]);

  const renderSection = () => {
    switch (activeSection) {
      case 'persona': return <PersonaSection />;
      case 'heartbeat': return <HeartbeatSection />;
      case 'provider': return <ProviderSection />;
      case 'channels': return <ChannelsSection />;
      case 'plugins': return <PluginsSection />;
      case 'goals': return <GoalsSection />;
      case 'system': return <SystemSection />;
      default: return <PersonaSection />;
    }
  };

  return (
    <div css={css`
      display: flex;
      min-height: 100vh;
      padding-top: ${theme.spacing[6]};

      @media (max-width: ${theme.breakpoints.md}) {
        flex-direction: column;
        padding-top: 0;
      }
    `}>
      {/* Desktop Sidebar — reserves flex space; inner content is fixed full-height */}
      <nav css={css`
        width: 220px;
        flex-shrink: 0;

        @media (max-width: ${theme.breakpoints.lg}) {
          width: 180px;
        }

        @media (max-width: ${theme.breakpoints.md}) {
          display: none;
        }
      `}>
        <div css={css`
          position: fixed;
          top: 0;
          bottom: 0;
          width: 220px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: ${theme.spacing[2]};
          border-right: 1px solid ${theme.colors.border.light};
          padding: ${theme.spacing[4]} ${theme.spacing[6]};

          @media (max-width: ${theme.breakpoints.lg}) {
            width: 180px;
          }
        `}>
          {sections.map((section) => {
            const isActive = section.id === activeSection;
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => handleSectionChange(section.id)}
                css={css`
                  display: flex;
                  align-items: center;
                  gap: ${theme.spacing[2]};
                  padding: ${theme.spacing[1.5]} ${theme.spacing[2]};
                  border-radius: ${theme.borderRadius.sm};
                  cursor: pointer;
                  transition: all ${theme.transitions.micro};
                  position: relative;
                  font-size: ${theme.typography.fontSize.sm};
                  font-weight: ${isActive ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
                  color: ${isActive ? theme.colors.text.primary : theme.colors.text.secondary};

                  &:hover {
                    color: ${theme.colors.text.primary};
                    opacity: 0.75;
                  }
                `}
              >
                {isActive && (
                  <motion.div
                    layoutId="settings-sidebar-dot"
                    css={css`
                      position: absolute;
                      left: -${theme.spacing[2]};
                      width: 4px;
                      height: 4px;
                      border-radius: 50%;
                      background: ${theme.colors.accent};
                    `}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon
                  size={14}
                  css={css`
                    opacity: ${isActive ? 1 : 0.55};
                    flex-shrink: 0;
                  `}
                />
                {section.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile hamburger menu */}
      <div
        ref={menuRef}
        css={css`
          display: none;

          @media (max-width: ${theme.breakpoints.md}) {
            display: block;
            position: fixed;
            top: ${theme.spacing[3]};
            left: ${theme.spacing[3]};
            z-index: ${theme.zIndex.fixed};
          }
        `}
      >
        <button
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          css={css`
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: ${theme.borderRadius.full};
            background: ${theme.mode === 'light'
              ? 'rgba(250, 249, 244, 0.85)'
              : 'rgba(28, 26, 24, 0.85)'};
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid ${theme.colors.border.light};
            color: ${theme.colors.text.primary};
            cursor: pointer;
          `}
        >
          {mobileMenuOpen ? <X size={18} /> : <List size={18} />}
        </button>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              css={css`
                position: absolute;
                top: calc(100% + ${theme.spacing[2]});
                left: 0;
                display: flex;
                flex-direction: column;
                gap: ${theme.spacing[1]};
                padding: ${theme.spacing[2]};
                border-radius: ${theme.borderRadius.md};
                background: ${theme.mode === 'light'
                  ? 'rgba(250, 249, 244, 0.95)'
                  : 'rgba(28, 26, 24, 0.95)'};
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid ${theme.colors.border.light};
                min-width: 180px;
              `}
            >
              {sections.map((section) => {
                const isActive = section.id === activeSection;
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => {
                      handleSectionChange(section.id);
                      setMobileMenuOpen(false);
                    }}
                    css={css`
                      display: flex;
                      align-items: center;
                      gap: ${theme.spacing[2]};
                      padding: ${theme.spacing[2]} ${theme.spacing[3]};
                      border-radius: ${theme.borderRadius.sm};
                      font-size: ${theme.typography.fontSize.sm};
                      font-weight: ${isActive ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
                      color: ${isActive ? theme.colors.text.primary : theme.colors.text.secondary};
                      cursor: pointer;
                      transition: all ${theme.transitions.micro};

                      &:hover {
                        color: ${theme.colors.text.primary};
                        background: ${theme.colors.background.elevated};
                      }
                    `}
                  >
                    <Icon size={14} css={css`opacity: ${isActive ? 1 : 0.55}; flex-shrink: 0;`} />
                    {section.label}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <main css={css`
        flex: 1;
        max-width: 640px;
        margin: 0 auto;
        padding: 0 ${theme.spacing[6]} ${theme.spacing[16]};

        @media (max-width: ${theme.breakpoints.md}) {
          max-width: 100%;
          padding: ${theme.spacing[4]} ${theme.spacing[4]} ${theme.spacing[16]};
        }
      `}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {renderSection()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Right spacer to balance sidebar — keeps content truly centered */}
      <div css={css`
        width: 220px;
        flex-shrink: 0;

        @media (max-width: ${theme.breakpoints.lg}) {
          width: 180px;
        }

        @media (max-width: ${theme.breakpoints.md}) {
          display: none;
        }
      `} />
    </div>
  );
}
