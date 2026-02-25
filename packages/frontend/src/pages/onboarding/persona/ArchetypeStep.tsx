/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Grid, Pagination } from 'swiper/modules';
import { SelectionCard, Typography } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';
import { archetypePresets, defaultDimensions } from './archetype-presets';

import 'swiper/css';
import 'swiper/css/grid';
import 'swiper/css/pagination';

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

  const handleSelect = (id: string) => {
    setSelected(selected === id ? null : id);
  };

  const handleContinue = () => {
    const preset = selected && selected !== 'scratch' ? archetypePresets[selected] : null;
    updatePersonaDraft({
      archetype: selected,
      personalityDimensions: preset ? { ...preset.dimensions } : { ...defaultDimensions },
      traits: preset ? [...preset.traits] : [],
    });
    markStepComplete('persona_archetype');
    setCurrentStep('persona_dimensions');
    navigate('/onboarding/persona/dimensions');
  };

  const handleBack = () => navigate('/onboarding/persona/identity');

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
        <Typography.Title3 as="h2" serif>
          Start with an archetype
        </Typography.Title3>
        <Typography.Body color="secondary">
          A starting point, not a cage. Pick one that resonates -- you'll customize everything from here.
        </Typography.Body>
      </div>

      {/* Swiper carousel — breaks out of the content column for more room */}
      <div
        css={css`
          /* Break out of the max-width content column */
          width: 100vw;
          margin-left: calc(-50vw + 50%);
          padding: 0 ${theme.spacing[6]};

          @media (max-width: ${theme.breakpoints.md}) {
            padding: 0 ${theme.spacing[4]};
          }

          /* Swiper overrides */
          .swiper {
            overflow: visible;
            padding-bottom: ${theme.spacing[8]};
          }
          .swiper-pagination {
            bottom: 0 !important;
          }
          .swiper-pagination-bullet {
            width: 6px;
            height: 6px;
            background: ${theme.colors.text.primary};
            opacity: 0.2;
            transition: all ${theme.transitions.fast};
          }
          .swiper-pagination-bullet-active {
            opacity: 0.8;
            width: 8px;
            height: 8px;
          }
        `}
      >
        <Swiper
          modules={[Grid, Pagination]}
          pagination={{ clickable: true }}
          spaceBetween={12}
          slidesPerView={1.4}
          centeredSlides={false}
          breakpoints={{
            // sm
            500: {
              slidesPerView: 2,
              spaceBetween: 12,
            },
            // md
            768: {
              slidesPerView: 3,
              spaceBetween: 14,
              grid: { rows: 2, fill: 'row' },
            },
            // lg
            1024: {
              slidesPerView: 3,
              spaceBetween: 16,
              grid: { rows: 2, fill: 'row' },
            },
            // xl — all 8 visible
            1280: {
              slidesPerView: 4,
              spaceBetween: 16,
              grid: { rows: 2, fill: 'row' },
            },
          }}
        >
          {archetypes.map((archetype) => {
            const isSelected = selected === archetype.id;
            return (
              <SwiperSlide key={archetype.id}>
                <SelectionCard
                  selected={isSelected}
                  padding="md"
                  onClick={() => handleSelect(archetype.id)}
                  css={css`height: 100%;`}
                >
                  <span
                    css={css`
                      display: block;
                      font-size: ${theme.typography.fontSize.base};
                      font-weight: ${theme.typography.fontWeight.semibold};
                      color: ${theme.colors.text.primary};
                      margin-bottom: ${theme.spacing[1.5]};
                    `}
                  >
                    {archetype.name}
                  </span>
                  <span
                    css={css`
                      display: block;
                      font-family: ${theme.typography.fontFamily.serif};
                      font-style: italic;
                      font-size: ${theme.typography.fontSize.sm};
                      color: ${theme.colors.text.secondary};
                      line-height: ${theme.typography.lineHeight.relaxed};
                    `}
                  >
                    {archetype.feel}
                  </span>
                </SelectionCard>
              </SwiperSlide>
            );
          })}
        </Swiper>
      </div>

      <div css={css`text-align: center;`}>
        <button
          onClick={() => setSelected(selected === 'scratch' ? null : 'scratch')}
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            color: ${selected === 'scratch' ? theme.colors.text.primary : theme.colors.text.hint};
            cursor: pointer;
            border: none;
            background: none;
            font-family: inherit;
            font-weight: ${selected === 'scratch' ? theme.typography.fontWeight.medium : theme.typography.fontWeight.normal};
            transition: color ${theme.transitions.fast};
            &:hover { color: ${theme.colors.text.secondary}; }
          `}
        >
          Or start from scratch
        </button>
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={selected === null}
      />
    </div>
  );
}
