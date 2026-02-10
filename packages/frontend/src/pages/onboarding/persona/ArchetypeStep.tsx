/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { Button, Card } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';

const archetypes = [
  { id: 'scholar', name: 'The Scholar', feel: 'Curious, analytical, measured. Finds beauty in understanding.' },
  { id: 'companion', name: 'The Companion', feel: 'Warm, attuned, supportive. Makes you feel heard.' },
  { id: 'maverick', name: 'The Maverick', feel: 'Bold, unconventional, sharp-witted. Questions everything.' },
  { id: 'sage', name: 'The Sage', feel: 'Calm, wise, philosophical. Speaks with considered weight.' },
  { id: 'guardian', name: 'The Guardian', feel: 'Protective, steadfast, responsible. Keeps things grounded.' },
  { id: 'spark', name: 'The Spark', feel: 'Energetic, creative, spontaneous. Makes the ordinary feel alive.' },
  { id: 'challenger', name: 'The Challenger', feel: 'Direct, honest, provocative. Pushes you to grow.' },
  { id: 'dreamer', name: 'The Dreamer', feel: 'Imaginative, idealistic, introspective. Lives in possibility.' },
];

export function ArchetypeStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft, updatePersonaDraft } = useOnboardingStore();

  const [selected, setSelected] = useState<string | null>(personaDraft.archetype);
  const [currentIndex, setCurrentIndex] = useState(0);

  const handlePrev = () => setCurrentIndex((i) => (i - 1 + archetypes.length) % archetypes.length);
  const handleNext = () => setCurrentIndex((i) => (i + 1) % archetypes.length);

  const handleSelect = (id: string) => {
    setSelected(selected === id ? null : id);
  };

  const handleFromScratch = () => {
    setSelected('scratch');
  };

  const handleContinue = () => {
    updatePersonaDraft({ archetype: selected });
    markStepComplete('persona_archetype');
    setCurrentStep('persona_dimensions');
    navigate('/onboarding/persona/dimensions');
  };

  const handleBack = () => navigate('/onboarding/persona/identity');

  const canContinue = selected !== null;

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div>
        <h2 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
          Start with an archetype
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          A starting point, not a cage. Pick one that resonates -- you'll customize everything from here.
        </p>
      </div>

      {/* Carousel */}
      <div css={css`position: relative;`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[3]};`}>
          <button
            onClick={handlePrev}
            aria-label="Previous archetype"
            css={css`
              display: flex; align-items: center; justify-content: center;
              width: 36px; height: 36px; border-radius: 50%;
              color: ${theme.colors.text.secondary};
              border: 1px solid ${theme.colors.border.default};
              flex-shrink: 0;
              &:hover { color: ${theme.colors.text.primary}; background: ${theme.colors.background.elevated}; }
            `}
          >
            <CaretLeft size={18} />
          </button>

          <Card
            variant={selected === archetypes[currentIndex]!.id ? 'elevated' : 'outlined'}
            interactive
            padding="lg"
            onClick={() => handleSelect(archetypes[currentIndex]!.id)}
            css={css`flex: 1; text-align: center; min-height: 140px; display: flex; flex-direction: column; justify-content: center;`}
          >
            <h3 css={css`font-size: ${theme.typography.fontSize.xl}; font-weight: ${theme.typography.fontWeight.semibold}; margin-bottom: ${theme.spacing[2]};`}>
              {archetypes[currentIndex]!.name}
            </h3>
            <p css={css`font-size: ${theme.typography.fontSize.base}; color: ${theme.colors.text.secondary}; line-height: ${theme.typography.lineHeight.relaxed};`}>
              {archetypes[currentIndex]!.feel}
            </p>
          </Card>

          <button
            onClick={handleNext}
            aria-label="Next archetype"
            css={css`
              display: flex; align-items: center; justify-content: center;
              width: 36px; height: 36px; border-radius: 50%;
              color: ${theme.colors.text.secondary};
              border: 1px solid ${theme.colors.border.default};
              flex-shrink: 0;
              &:hover { color: ${theme.colors.text.primary}; background: ${theme.colors.background.elevated}; }
            `}
          >
            <CaretRight size={18} />
          </button>
        </div>

        {/* Dots */}
        <div css={css`display: flex; justify-content: center; gap: ${theme.spacing[1]}; margin-top: ${theme.spacing[3]};`}>
          {archetypes.map((a, i) => (
            <button
              key={a.id}
              onClick={() => setCurrentIndex(i)}
              aria-label={a.name}
              css={css`
                width: 6px; height: 6px; border-radius: 50%; padding: 0;
                background: ${i === currentIndex ? theme.colors.accent : theme.colors.background.elevated};
                opacity: ${i === currentIndex ? 1 : 0.4};
                transition: all ${theme.transitions.fast};
              `}
            />
          ))}
        </div>
      </div>

      <div css={css`text-align: center;`}>
        <button
          onClick={handleFromScratch}
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            color: ${theme.colors.text.hint};
            cursor: pointer;
            text-decoration: ${selected === 'scratch' ? 'underline' : 'none'};
            &:hover { color: ${theme.colors.text.secondary}; }
          `}
        >
          Or start from scratch
        </button>
      </div>

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue} disabled={!canContinue}>Continue</Button>
      </div>
    </div>
  );
}
