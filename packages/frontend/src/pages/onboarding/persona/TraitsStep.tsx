/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';

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
      <div>
        <h2 css={css`font-size: ${theme.typography.fontSize['2xl']}; font-weight: ${theme.typography.fontWeight.light}; margin-bottom: ${theme.spacing[2]};`}>
          Add some texture
        </h2>
        <p css={css`color: ${theme.colors.text.secondary};`}>
          These are the adjectives -- the quirks, style, and flavor that make a personality distinctive.
        </p>
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

      <p css={css`font-size: ${theme.typography.fontSize.sm}; color: ${theme.colors.text.hint};`}>
        {selected.length} of {MAX_TRAITS} selected
      </p>

      {traitCategories.map((cat) => (
        <div key={cat.title} css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
          <h3 css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.hint};
            text-transform: uppercase;
            letter-spacing: 0.06em;
          `}>
            {cat.title}
          </h3>
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

      <div css={css`display: flex; justify-content: space-between; margin-top: ${theme.spacing[4]};`}>
        <Button variant="ghost" onClick={handleBack}>Back</Button>
        <Button onClick={handleContinue} disabled={selected.length < 5}>
          Continue
        </Button>
      </div>
    </div>
  );
}
