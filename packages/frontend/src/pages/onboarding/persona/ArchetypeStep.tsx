/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination } from 'swiper/modules';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { Button, SelectionCard, Typography } from '../../../components/ui';
import { useOnboardingStore } from '../../../store';
import { OnboardingNav } from '../OnboardingNav';
import { archetypePresets, defaultDimensions } from './archetype-presets';
import type SwiperCore from 'swiper';

import 'swiper/css';
import 'swiper/css/pagination';
import 'swiper/css/navigation';

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
  const swiperRef = useRef<SwiperCore | null>(null);
  const [isBeginning, setIsBeginning] = useState(true);
  const [isEnd, setIsEnd] = useState(false);

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
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <Typography.Body color="secondary" serif css={css`
          font-style: italic;
        `}>
          A starting point, not a cage
        </Typography.Body>
        <Typography.Title3 as="h2" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          Pick an archetype that resonates
        </Typography.Title3>
      </div>

      {/* Swiper carousel — breaks out of the content column for more room */}
      <div
        css={css`
          /* Break out of the max-width content column */
          position: relative;
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
          .swiper-slide {
            height: auto;
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
        {/* Navigation arrows */}
        <button
          onClick={() => swiperRef.current?.slidePrev()}
          aria-label="Previous"
          css={css`
            position: absolute;
            left: ${theme.spacing[1]};
            top: 50%;
            transform: translateY(-70%);
            z-index: 10;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 1px solid ${theme.colors.border.default};
            background: ${theme.colors.background.default};
            color: ${theme.colors.text.secondary};
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all ${theme.transitions.fast};
            opacity: ${isBeginning ? 0 : 1};
            pointer-events: ${isBeginning ? 'none' : 'auto'};
            box-shadow: ${theme.shadows.sm};
            &:hover {
              background: ${theme.colors.background.default};
              color: ${theme.colors.text.primary};
            }
            @media (max-width: ${theme.breakpoints.sm}) {
              display: none;
            }
          `}
        >
          <CaretLeft size={18} weight="bold" />
        </button>
        <button
          onClick={() => swiperRef.current?.slideNext()}
          aria-label="Next"
          css={css`
            position: absolute;
            right: ${theme.spacing[1]};
            top: 50%;
            transform: translateY(-70%);
            z-index: 10;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 1px solid ${theme.colors.border.default};
            background: ${theme.colors.background.default};
            color: ${theme.colors.text.secondary};
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all ${theme.transitions.fast};
            opacity: ${isEnd ? 0 : 1};
            pointer-events: ${isEnd ? 'none' : 'auto'};
            box-shadow: ${theme.shadows.sm};
            &:hover {
              background: ${theme.colors.background.default};
              color: ${theme.colors.text.primary};
            }
            @media (max-width: ${theme.breakpoints.sm}) {
              display: none;
            }
          `}
        >
          <CaretRight size={18} weight="bold" />
        </button>

        <Swiper
          modules={[Navigation, Pagination]}
          pagination={{ clickable: true }}
          onSwiper={(swiper) => {
            swiperRef.current = swiper;
            setIsBeginning(swiper.isBeginning);
            setIsEnd(swiper.isEnd);
          }}
          onSlideChange={(swiper) => {
            setIsBeginning(swiper.isBeginning);
            setIsEnd(swiper.isEnd);
          }}
          spaceBetween={12}
          slidesPerView={1.4}
          centeredSlides={false}
          breakpoints={{
            500: {
              slidesPerView: 2,
              spaceBetween: 12,
            },
            768: {
              slidesPerView: 3,
              spaceBetween: 14,
            },
            1024: {
              slidesPerView: 4,
              spaceBetween: 16,
            },
            1280: {
              slidesPerView: 5,
              spaceBetween: 16,
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSelected(selected === 'scratch' ? null : 'scratch')}
          css={css`
            ${selected === 'scratch' ? css`
              border-color: ${theme.colors.border.focus};
              box-shadow: ${theme.shadows.sm};
            ` : ''}
          `}
        >
          Or start from scratch
        </Button>
      </div>

      <OnboardingNav
        onBack={handleBack}
        onContinue={handleContinue}
        continueDisabled={selected === null}
      />
    </div>
  );
}
