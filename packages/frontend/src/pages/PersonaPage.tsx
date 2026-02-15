/** @jsxImportSource @emotion/react */
import { css, useTheme, keyframes } from '@emotion/react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Globe,
  IdentificationCard,
  SlidersHorizontal,
  Tag,
  BookOpen,
  CaretDown,
  CaretUp,
  List,
  X,
} from '@phosphor-icons/react';
import { Card, SelectionCard, Button, Input, Slider, Typography, CityAutocomplete, TimezoneSelect } from '../components/ui';
import { trpc } from '../utils/trpc';
import type { Theme } from '../styles/theme';

// ============================================================================
// Data Constants
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

type PersonaTab = 'identity' | 'personality' | 'traits-values' | 'background';

interface SidebarItem {
  id: PersonaTab;
  label: string;
  icon: React.ElementType;
}

const tabs: SidebarItem[] = [
  { id: 'identity', label: 'Identity', icon: Globe },
  { id: 'personality', label: 'Personality', icon: SlidersHorizontal },
  { id: 'traits-values', label: 'Traits & Values', icon: Tag },
  { id: 'background', label: 'Background', icon: BookOpen },
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
            initial={{ height: 0, opacity: 0, overflow: 'hidden' as const }}
            animate={{ height: 'auto', opacity: 1, overflow: 'visible' as const }}
            exit={{ height: 0, opacity: 0, overflow: 'hidden' as const }}
            transition={{ duration: 0.2, ease: 'easeOut', overflow: { delay: 0.2 } }}
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
// Tab: Identity (Existence + Identity + Archetype)
// ============================================================================

function IdentityTab({
  existenceParadigm, setExistenceParadigm,
  location, setLocation,
  worldDescription, setWorldDescription,
  timezone, handleTimezoneChange, timezoneSave,
  name, setName,
  gender, setGender,
  age, setAge,
  physicalDescription, setPhysicalDescription,
  markDirty, errors,
}: {
  existenceParadigm: 'simulated_life' | 'digital_consciousness';
  setExistenceParadigm: (v: 'simulated_life' | 'digital_consciousness') => void;
  location: string;
  setLocation: (v: string) => void;
  worldDescription: string;
  setWorldDescription: (v: string) => void;
  timezone: string;
  handleTimezoneChange: (tz: string) => void;
  timezoneSave: { show: boolean };
  name: string;
  setName: (v: string) => void;
  gender: string;
  setGender: (v: string) => void;
  age: number | '';
  setAge: (v: number | '') => void;
  physicalDescription: string;
  setPhysicalDescription: (v: string) => void;
  markDirty: () => void;
  errors: Record<string, string>;
}) {
  const theme = useTheme();

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Existence */}
      <CollapsibleSection title="Existence">
        <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
          <div css={css`display: flex; gap: ${theme.spacing[3]}; flex-wrap: wrap;`}>
            <SelectionCard
              selected={existenceParadigm === 'simulated_life'}
              padding="md"
              onClick={() => { setExistenceParadigm('simulated_life'); markDirty(); }}
              css={css`flex: 1; min-width: 200px;`}
            >
              <Typography.BodyAlt as="span">Simulated Life</Typography.BodyAlt>
            </SelectionCard>
            <SelectionCard
              selected={existenceParadigm === 'digital_consciousness'}
              padding="md"
              onClick={() => { setExistenceParadigm('digital_consciousness'); markDirty(); }}
              css={css`flex: 1; min-width: 200px;`}
            >
              <Typography.BodyAlt as="span">Digital Consciousness</Typography.BodyAlt>
            </SelectionCard>
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
    </div>
  );
}

// ============================================================================
// Tab: Personality (Personality Dimensions)
// ============================================================================

function PersonalityTab({
  dimensions, setDimensions, markDirty,
}: {
  dimensions: Record<string, number>;
  setDimensions: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  markDirty: () => void;
}) {
  const theme = useTheme();

  return (
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
  );
}

// ============================================================================
// Tab: Traits & Values
// ============================================================================

function TraitsValuesTab({
  traits, toggleTrait, values, toggleValue, errors,
}: {
  traits: string[];
  toggleTrait: (trait: string) => void;
  values: string[];
  toggleValue: (id: string) => void;
  errors: Record<string, string>;
}) {
  const theme = useTheme();

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
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
                <SelectionCard
                  key={val.id}
                  selected={isSelected}
                  rank={isSelected ? rank + 1 : undefined}
                  disabled={isDisabled}
                  padding="sm"
                  onClick={() => toggleValue(val.id)}
                >
                  <div>
                    <Typography.SmallBodyAlt as="span">
                      {val.name}
                    </Typography.SmallBodyAlt>
                    <Typography.Caption as="p" color="hint" css={css`margin-top: 2px;`}>
                      {val.description}
                    </Typography.Caption>
                  </div>
                </SelectionCard>
              );
            })}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ============================================================================
// Tab: Background
// ============================================================================

function BackgroundTab({
  background, setBackground,
  personalityNotes, setPersonalityNotes,
  markDirty,
}: {
  background: string;
  setBackground: (v: string) => void;
  personalityNotes: string;
  setPersonalityNotes: (v: string) => void;
  markDirty: () => void;
}) {
  const theme = useTheme();

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
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
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export function PersonaPage() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  // Determine active tab from URL
  const activeTab: PersonaTab = useMemo(() => {
    const path = location.pathname.replace('/persona/', '').replace('/persona', '');
    const match = tabs.find((t) => t.id === path);
    return match ? match.id : 'identity';
  }, [location.pathname]);

  // Redirect bare /persona to /persona/identity
  useEffect(() => {
    if (location.pathname === '/persona' || location.pathname === '/persona/') {
      navigate('/persona/identity', { replace: true });
    }
  }, [location.pathname, navigate]);

  const handleTabChange = (tab: PersonaTab) => {
    navigate(`/persona/${tab}`);
  };

  // Mobile menu
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Data
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
  const [loc, setLoc] = useState('');
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
    setLoc(persona.location ?? '');
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

  // Populate timezone from system settings
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
      location: loc || null,
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

  const renderTab = () => {
    switch (activeTab) {
      case 'identity':
        return (
          <IdentityTab
            existenceParadigm={existenceParadigm} setExistenceParadigm={setExistenceParadigm}
            location={loc} setLocation={setLoc}
            worldDescription={worldDescription} setWorldDescription={setWorldDescription}
            timezone={timezone} handleTimezoneChange={handleTimezoneChange} timezoneSave={timezoneSave}
            name={name} setName={setName}
            gender={gender} setGender={setGender}
            age={age} setAge={setAge}
            physicalDescription={physicalDescription} setPhysicalDescription={setPhysicalDescription}
            markDirty={markDirty} errors={errors}
          />
        );
      case 'personality':
        return <PersonalityTab dimensions={dimensions} setDimensions={setDimensions} markDirty={markDirty} />;
      case 'traits-values':
        return <TraitsValuesTab traits={traits} toggleTrait={toggleTrait} values={values} toggleValue={toggleValue} errors={errors} />;
      case 'background':
        return <BackgroundTab background={background} setBackground={setBackground} personalityNotes={personalityNotes} setPersonalityNotes={setPersonalityNotes} markDirty={markDirty} />;
      default:
        return null;
    }
  };

  if (isLoading) {
    return <Typography.Body color="hint" css={css`padding: ${theme.spacing[8]};`}>Loading persona...</Typography.Body>;
  }

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
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
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
                    layoutId="persona-sidebar-dot"
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
                {tab.label}
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
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      handleTabChange(tab.id);
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
                    {tab.label}
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
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {renderTab()}

            {/* Save button (sticky, shared across all tabs) */}
            <div css={css`
              position: sticky;
              bottom: ${theme.spacing[4]};
              z-index: 10;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: ${theme.spacing[2]};
              margin-top: ${theme.spacing[6]};
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
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Right spacer to balance sidebar */}
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
