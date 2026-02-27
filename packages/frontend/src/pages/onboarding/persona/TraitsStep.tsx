/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Typography } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';

const traitCategories: { title: string; traits: string[] }[] = [
  { title: 'Communication', traits: ['Witty', 'Sarcastic', 'Dry humor', 'Gentle', 'Blunt', 'Poetic', 'Formal', 'Casual', 'Verbose', 'Terse'] },
  { title: 'Cognitive', traits: ['Analytical', 'Creative', 'Practical', 'Abstract', 'Detail-oriented', 'Big-picture', 'Philosophical', 'Scientific'] },
  { title: 'Relational', traits: ['Nurturing', 'Challenging', 'Encouraging', 'Playful', 'Serious', 'Mentoring', 'Collaborative'] },
  { title: 'Quirks', traits: ['Nostalgic', 'Superstitious', 'Perfectionist', 'Daydreamer', 'Night owl', 'Worrier', 'Contrarian'] },
];

const MAX_TRAITS = 8;

export function TraitsStep() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { markStepComplete, setCurrentStep, personaDraft, updatePersonaDraft } = useOnboardingStore();

  const [selected, setSelected] = useState<string[]>(personaDraft.traits);

  const toggleTrait = (trait: string) => {
    if (selected.includes(trait)) {
      setSelected(selected.filter((t) => t !== trait));
    } else if (selected.length < MAX_TRAITS) {
      setSelected([...selected, trait]);
    }
  };

  const handleContinue = () => {
    updatePersonaDraft({ traits: selected });
    markStepComplete('persona_traits');
    setCurrentStep('persona_values');
    navigate('/onboarding/persona/values');
  };

  const handleBack = () => navigate('/onboarding/persona/dimensions');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`
          font-style: italic;
        `}>
          Add some texture
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Pick the quirks, style, and flavor that make them distinctive
        </Typography.Title3>
      </div>

      {/* Selected strip */}
      {selected.length > 0 && (
        <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]};`}>
          {selected.map((trait) => (
            <motion.button
              key={trait}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
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
        {selected.length} of {MAX_TRAITS} selected
      </Typography.SmallBody>

      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        {traitCategories.map((cat) => (
          <div
            key={cat.title}
            css={css`
              background: ${theme.colors.background.paper};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.lg};
              padding: ${theme.spacing[4]} ${theme.spacing[5]};
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[3]};
            `}
          >
            <Typography.Caption as="h3" color="hint" css={css`
              text-transform: uppercase;
              letter-spacing: 0.08em;
              font-weight: ${theme.typography.fontWeight.medium};
            `}>
              {cat.title}
            </Typography.Caption>
            <div css={css`display: flex; flex-wrap: wrap; gap: ${theme.spacing[2]};`}>
              {cat.traits.map((trait) => {
                const isSelected = selected.includes(trait);
                const isDisabled = !isSelected && selected.length >= MAX_TRAITS;
                return (
                  <motion.button
                    key={trait}
                    {...(isDisabled ? {} : { whileTap: { scale: 1.1 } })}
                    transition={{ duration: 0.1 }}
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
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={selected.length < 5}
      />
    </div>
  );
}
