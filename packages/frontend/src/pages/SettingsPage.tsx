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
} from '@phosphor-icons/react';
import { Card, Button, Input, Modal, Badge, Toggle, Slider } from '../components/ui';
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

type SettingsSection = 'persona' | 'heartbeat' | 'provider' | 'channels' | 'goals' | 'system';

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
        <h3 css={css`
          font-size: ${theme.typography.fontSize.lg};
          font-weight: ${theme.typography.fontWeight.semibold};
          color: ${theme.colors.text.primary};
        `}>
          {title}
        </h3>
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
  const updateMutation = trpc.persona.update.useMutation({
    onSuccess: () => {
      utils.persona.get.invalidate();
      setSuccessMessage('Persona updated. Changes take effect on the next heartbeat tick.');
      setTimeout(() => setSuccessMessage(null), 5000);
      setDirty(false);
    },
  });

  const [dirty, setDirty] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    return <div css={css`color: ${theme.colors.text.hint}; padding: ${theme.spacing[8]};`}>Loading persona...</div>;
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
                <span css={css`font-weight: ${theme.typography.fontWeight.medium};`}>Simulated Life</span>
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
                <span css={css`font-weight: ${theme.typography.fontWeight.medium};`}>Digital Consciousness</span>
              </div>
            </Card>
          </div>
          {existenceParadigm === 'simulated_life' && (
            <Input
              label="Where do they live?"
              value={location}
              onChange={(e) => { setLocation((e.target as HTMLInputElement).value); markDirty(); }}
              placeholder="A city, a small town, the countryside..."
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
        <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary}; line-height: ${theme.typography.lineHeight.relaxed};`}>
          Your archetype was used as a starting point during creation. It is not stored -- your personality is defined by the dimensions and traits below.
        </p>
      </CollapsibleSection>

      {/* Personality Dimensions */}
      <CollapsibleSection title="Personality Dimensions">
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
          {dimensionGroups.map((group) => (
            <div key={group.title} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
              <h4 css={css`
                font-size: ${theme.typography.fontSize.xs};
                font-weight: ${theme.typography.fontWeight.medium};
                color: ${theme.colors.text.hint};
                text-transform: uppercase;
                letter-spacing: 0.06em;
              `}>
                {group.title}
              </h4>
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
          <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.hint};`}>
            {traits.length} of 8 selected {errors['traits'] && <span css={css`color: ${theme.colors.error.main};`}> -- {errors['traits']}</span>}
          </p>
          {traitCategories.map((cat) => (
            <div key={cat.title} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
              <h4 css={css`
                font-size: ${theme.typography.fontSize.xs};
                font-weight: ${theme.typography.fontWeight.medium};
                color: ${theme.colors.text.hint};
                text-transform: uppercase;
                letter-spacing: 0.06em;
              `}>
                {cat.title}
              </h4>
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
                  <span
                    key={id}
                    css={css`
                      display: inline-flex; align-items: center; gap: ${theme.spacing[1]};
                      padding: ${theme.spacing[1]} ${theme.spacing[3]};
                      background: ${theme.colors.accent}; color: ${theme.colors.accentForeground};
                      border-radius: ${theme.borderRadius.full};
                      font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium};
                    `}
                  >
                    <span css={css`opacity: 0.7; font-size: ${theme.typography.fontSize.xs};`}>#{i + 1}</span>
                    {val ? val.name.split(' & ')[0] : id}
                  </span>
                );
              })}
            </div>
          )}
          <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.hint};`}>
            {values.length} of 5 selected {errors['values'] && <span css={css`color: ${theme.colors.error.main};`}> -- {errors['values']}</span>}
          </p>
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
                      <span css={css`
                        display: flex; align-items: center; justify-content: center;
                        width: 20px; height: 20px; border-radius: 50%;
                        background: ${theme.colors.accent}; color: ${theme.colors.accentForeground};
                        font-size: ${theme.typography.fontSize.xs}; font-weight: ${theme.typography.fontWeight.semibold};
                        flex-shrink: 0; margin-top: 2px;
                      `}>
                        {rank + 1}
                      </span>
                    )}
                    <div>
                      <span css={css`font-weight: ${theme.typography.fontWeight.medium}; font-size: ${theme.typography.fontSize.sm};`}>
                        {val.name}
                      </span>
                      <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint}; margin-top: 2px;`}>
                        {val.description}
                      </p>
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
                color: ${theme.colors.success.main};
                border-radius: ${theme.borderRadius.default};
                font-size: ${theme.typography.fontSize.sm};
              `}
            >
              {successMessage}
            </motion.div>
          )}
        </AnimatePresence>
        {updateMutation.isError && (
          <div css={css`
            padding: ${theme.spacing[2]} ${theme.spacing[4]};
            background: ${theme.colors.error.main}1a;
            color: ${theme.colors.error.main};
            border-radius: ${theme.borderRadius.default};
            font-size: ${theme.typography.fontSize.sm};
          `}>
            Failed to save: {updateMutation.error?.message}
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

  const intervalMs = systemSettings?.heartbeatIntervalMs ?? 300000;
  const warmthMs = systemSettings?.sessionWarmthMs ?? 900000;
  const contextBudget = systemSettings?.sessionContextBudget ?? 0.7;

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
    updateIntervalMutation.mutate({ intervalMs: ms }, { onSuccess: () => intervalSave.flash() });
    updateSettingsMutation.mutate({ heartbeatIntervalMs: ms });
  };

  const handleWarmthChange = (mins: number) => {
    const ms = mins * 60000;
    updateSettingsMutation.mutate({ sessionWarmthMs: ms }, { onSuccess: () => warmthSave.flash() });
  };

  const handleBudgetChange = (val: number) => {
    updateSettingsMutation.mutate({ sessionContextBudget: val }, { onSuccess: () => budgetSave.flash() });
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
          <label css={css`font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium}; color: ${theme.colors.text.secondary};`}>
            How often does your Animus think?
          </label>
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
          <span css={css`
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.primary};
            font-weight: ${theme.typography.fontWeight.medium};
            white-space: nowrap;
            min-width: 110px;
          `}>
            {formatInterval(intervalMs)}
          </span>
        </div>
        <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint}; line-height: ${theme.typography.lineHeight.relaxed};`}>
          Shorter intervals mean more frequent thoughts and faster emotional shifts. Longer intervals are more contemplative (and cheaper).
        </p>
      </div>

      {/* Heartbeat Status */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold};`}>
          Status
        </h3>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
            <div css={css`
              width: 8px; height: 8px; border-radius: 50%;
              background: ${isRunning ? theme.colors.success.main : theme.colors.warning.main};
            `} />
            <span css={css`font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium};`}>
              {isRunning ? 'Running' : 'Paused'}
            </span>
          </div>
          <div css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
            Tick #{tickNumber.toLocaleString()}
          </div>
          <div css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
            Last tick: {formatAgo(lastTickAt)}
          </div>
          {isRunning && currentStage !== 'idle' && (
            <div css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
              Currently: {currentStage === 'gather' ? 'Gathering context' : currentStage === 'mind' ? 'Thinking' : currentStage === 'execute' ? 'Executing' : currentStage}
            </div>
          )}
        </div>

        {!isRunning && (
          <div css={css`
            padding: ${theme.spacing[3]} ${theme.spacing[4]};
            background: ${theme.colors.warning.main}1a;
            color: ${theme.colors.warning.dark};
            border-radius: ${theme.borderRadius.default};
            font-size: ${theme.typography.fontSize.sm};
          `}>
            Heartbeat is paused. Your Animus is not thinking.
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
            <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold};`}>
              Pause heartbeat?
            </h3>
            <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary}; line-height: ${theme.typography.lineHeight.relaxed};`}>
              Pausing the heartbeat stops all internal processes. Your Animus will stop thinking, feeling, and acting until resumed.
            </p>
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
        <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold};`}>
          Session
        </h3>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <span css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>State:</span>
          <Badge variant={sessionState === 'active' ? 'success' : sessionState === 'warm' ? 'warning' : 'default'}>
            {sessionState.charAt(0).toUpperCase() + sessionState.slice(1)}
          </Badge>
        </div>

        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
            <label css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
              Warmth window: {Math.round(warmthMs / 60000)} min
            </label>
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
            <label css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
              Context budget: {Math.round(contextBudget * 100)}%
            </label>
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

  const saveKeyMutation = trpc.provider.saveKey.useMutation({
    onSuccess: () => {
      utils.provider.hasKey.invalidate();
    },
  });
  const validateMutation = trpc.provider.validateKey.useMutation();
  const updateSettingsMutation = trpc.settings.updateSystemSettings.useMutation({
    onSuccess: () => utils.settings.getSystemSettings.invalidate(),
  });

  const activeProvider = systemSettings?.defaultAgentProvider ?? 'claude';
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [switchConfirm, setSwitchConfirm] = useState<string | null>(null);
  const [validateResult, setValidateResult] = useState<{ valid: boolean; message: string } | null>(null);

  const providers = [
    {
      id: 'claude' as const,
      name: 'Claude',
      description: 'By Anthropic. Full-featured agent with native tool use and streaming.',
      hasKey: claudeKey?.hasKey ?? false,
    },
    {
      id: 'codex' as const,
      name: 'Codex',
      description: 'By OpenAI. Code-focused agent with function calling.',
      hasKey: codexKey?.hasKey ?? false,
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
    if (!apiKeyInput.trim()) return;
    validateMutation.mutate(
      { provider, apiKey: apiKeyInput },
      {
        onSuccess: (result) => {
          setValidateResult(result);
          if (result.valid) {
            saveKeyMutation.mutate(
              { provider, apiKey: apiKeyInput },
              {
                onSuccess: () => {
                  setApiKeyInput('');
                  setShowKey(false);
                },
              },
            );
          }
        },
      },
    );
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
      {providers.map((p) => (
        <Card
          key={p.id}
          variant={activeProvider === p.id ? 'elevated' : 'outlined'}
          padding="md"
        >
          <div
            css={css`cursor: pointer;`}
            onClick={() => setExpandedProvider(expandedProvider === p.id ? null : p.id)}
          >
            <div css={css`display: flex; align-items: center; justify-content: space-between; margin-bottom: ${theme.spacing[1]};`}>
              <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
                <span css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.medium};`}>
                  {p.name}
                </span>
                {activeProvider === p.id && (
                  <Badge variant="success">Currently active</Badge>
                )}
              </div>
              <Badge variant={p.hasKey ? 'success' : 'default'}>
                {p.hasKey ? 'Connected' : 'Not configured'}
              </Badge>
            </div>
            <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
              {p.description}
            </p>
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
                  <div css={css`display: flex; gap: ${theme.spacing[2]}; align-items: flex-end;`}>
                    <div css={css`flex: 1;`}>
                      <Input
                        label="API Key"
                        type={showKey ? 'text' : 'password'}
                        value={apiKeyInput}
                        onChange={(e) => { setApiKeyInput((e.target as HTMLInputElement).value); setValidateResult(null); }}
                        placeholder={p.hasKey ? '********' : 'Enter API key'}
                        rightElement={
                          <button
                            onClick={(e) => { e.stopPropagation(); setShowKey(!showKey); }}
                            css={css`
                              cursor: pointer; padding: 0; color: ${theme.colors.text.hint};
                              &:hover { color: ${theme.colors.text.primary}; }
                            `}
                          >
                            {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
                          </button>
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleValidateAndSave(p.id)}
                      loading={validateMutation.isPending || saveKeyMutation.isPending}
                      disabled={!apiKeyInput.trim()}
                    >
                      Validate & Save
                    </Button>
                  </div>
                  {validateResult && (
                    <div css={css`
                      font-size: ${theme.typography.fontSize.xs};
                      color: ${validateResult.valid ? theme.colors.success.main : theme.colors.error.main};
                    `}>
                      {validateResult.message}
                    </div>
                  )}
                  {activeProvider !== p.id && p.hasKey && (
                    <Button variant="secondary" size="sm" onClick={() => handleSwitch(p.id)}>
                      Switch to {p.name}
                    </Button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      ))}

      <Modal open={switchConfirm !== null} onClose={() => setSwitchConfirm(null)}>
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold};`}>
            Switch to {switchConfirm}?
          </h3>
          <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary}; line-height: ${theme.typography.lineHeight.relaxed};`}>
            Your Animus will use {switchConfirm} for all future thinking. The current mind session will end and restart with the new provider.
          </p>
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
              <span css={css`font-weight: ${theme.typography.fontWeight.medium};`}>{ch.name}</span>
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
                  <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
                    {ch.type === 'web'
                      ? 'The web channel is always active. No additional configuration needed.'
                      : 'The API channel is always available. Use it to integrate Animus with external systems.'}
                  </p>
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
        <label css={css`font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium}; color: ${theme.colors.text.secondary};`}>
          How should your Animus handle new goals?
        </label>
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
                <span css={css`font-weight: ${theme.typography.fontWeight.medium};`}>{mode.label}</span>
                <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary}; margin-top: ${theme.spacing[1]};`}>
                  {mode.description}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.hint}; line-height: ${theme.typography.lineHeight.relaxed};`}>
        Goals with average salience below 0.05 over 30 days are automatically cleaned up.
      </p>
    </div>
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

  const [timezone, setTimezone] = useState('');
  const [confirmAction, setConfirmAction] = useState<'soft' | 'full' | 'clear' | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const timezoneSave = useSaveFlash();

  useEffect(() => {
    if (settings?.timezone) setTimezone(settings.timezone);
  }, [settings]);

  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz);
    updateSettingsMutation.mutate({ timezone: tz }, { onSuccess: () => timezoneSave.flash() });
  };

  const handleConfirmAction = () => {
    if (confirmAction === 'soft') softResetMutation.mutate();
    if (confirmAction === 'full') fullResetMutation.mutate();
    if (confirmAction === 'clear') clearConvMutation.mutate();
    setConfirmAction(null);
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
      description: 'This will clear all thoughts, emotions, goals, and decisions. Your Animus will lose its current inner state but retain memories and conversations. The heartbeat will be paused.',
    },
    full: {
      title: 'Full reset',
      description: 'This will clear all AI state including memories. Your Animus will be effectively reborn with the same personality but no accumulated knowledge. Conversations are preserved.',
    },
    clear: {
      title: 'Clear conversations',
      description: 'This will delete all message history across all contacts and channels. This cannot be undone.',
    },
  };

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[8]};`}>
      {/* Timezone */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <label css={css`font-size: ${theme.typography.fontSize.sm}; font-weight: ${theme.typography.fontWeight.medium}; color: ${theme.colors.text.secondary};`}>
            Your timezone
          </label>
          <SaveIndicator show={timezoneSave.show} />
        </div>
        <Input
          value={timezone}
          onChange={(e) => handleTimezoneChange((e.target as HTMLInputElement).value)}
          placeholder="America/New_York"
          helperText="All scheduled tasks and time-based displays use this timezone."
        />
      </div>

      {/* Data Management */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold};`}>
          Data Management
        </h3>
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
            <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint}; margin-top: ${theme.spacing[0.5]};`}>
              Clear thoughts, emotions, and goals. Preserve memories and conversations.
            </p>
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
            <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint}; margin-top: ${theme.spacing[0.5]};`}>
              Clear all AI state including memories. Preserve conversations.
            </p>
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
            <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint}; margin-top: ${theme.spacing[0.5]};`}>
              Delete all message history across all contacts and channels.
            </p>
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
            <p css={css`font-size: ${theme.typography.fontSize.xs}; color: ${theme.colors.text.hint}; margin-top: ${theme.spacing[0.5]};`}>
              Download all databases as a backup file.
            </p>
          </div>
        </div>
      </div>

      {/* Account */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold};`}>
          Account
        </h3>
        <div css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary};`}>
          {me?.email ?? 'Loading...'}
        </div>
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
              <h3 css={css`font-size: ${theme.typography.fontSize.lg}; font-weight: ${theme.typography.fontWeight.semibold};`}>
                {confirmMessages[confirmAction].title}
              </h3>
            </div>
            <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.secondary}; line-height: ${theme.typography.lineHeight.relaxed};`}>
              {confirmMessages[confirmAction].description}
            </p>
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
              color: ${theme.colors.success.main};
              border-radius: ${theme.borderRadius.default};
              font-size: ${theme.typography.fontSize.sm};
            `}
          >
            Operation completed successfully.
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

  const renderSection = () => {
    switch (activeSection) {
      case 'persona': return <PersonaSection />;
      case 'heartbeat': return <HeartbeatSection />;
      case 'provider': return <ProviderSection />;
      case 'channels': return <ChannelsSection />;
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
      {/* Desktop Sidebar */}
      <nav css={css`
        width: 220px;
        flex-shrink: 0;
        padding: ${theme.spacing[4]} ${theme.spacing[6]};
        position: sticky;
        top: ${theme.spacing[6]};
        align-self: flex-start;

        @media (max-width: ${theme.breakpoints.lg}) {
          width: 180px;
        }

        @media (max-width: ${theme.breakpoints.md}) {
          display: none;
        }
      `}>
        <div css={css`
          display: flex;
          flex-direction: column;
          gap: ${theme.spacing[2]};
          border-right: 1px solid ${theme.colors.border.light};
          padding-right: ${theme.spacing[6]};
          height: fit-content;
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

      {/* Mobile horizontal nav */}
      <nav css={css`
        display: none;

        @media (max-width: ${theme.breakpoints.md}) {
          display: flex;
          overflow-x: auto;
          gap: ${theme.spacing[4]};
          padding: ${theme.spacing[3]} ${theme.spacing[4]};
          border-bottom: 1px solid ${theme.colors.border.light};
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          &::-webkit-scrollbar { display: none; }
        }
      `}>
        {sections.map((section) => {
          const isActive = section.id === activeSection;
          return (
            <button
              key={section.id}
              onClick={() => handleSectionChange(section.id)}
              css={css`
                flex-shrink: 0;
                padding: ${theme.spacing[1]} 0;
                font-size: ${theme.typography.fontSize.sm};
                font-weight: ${isActive ? theme.typography.fontWeight.semibold : theme.typography.fontWeight.normal};
                color: ${isActive ? theme.colors.text.primary : theme.colors.text.secondary};
                cursor: pointer;
                white-space: nowrap;
                border-bottom: 2px solid ${isActive ? theme.colors.accent : 'transparent'};
                transition: all ${theme.transitions.micro};
                &:hover { color: ${theme.colors.text.primary}; }
              `}
            >
              {section.label}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <main css={css`
        flex: 1;
        max-width: 640px;
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
    </div>
  );
}
