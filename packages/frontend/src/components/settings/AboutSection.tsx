/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowSquareOut, CaretRight, CaretDown } from '@phosphor-icons/react';
import { Typography } from '../ui';
import { trpc } from '../../utils/trpc';

// ============================================================================
// Types
// ============================================================================

interface AttributionEntry {
  name: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  description: string;
}

// ============================================================================
// Data
// ============================================================================

const aiModels: AttributionEntry[] = [
  {
    name: 'Pocket TTS',
    author: 'Kyutai',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://huggingface.co/kyutai/pocketlm-tts-pretrained-v1',
    description: 'Lightweight text-to-speech model (weights, tokenizer, config)',
  },
  {
    name: 'Kyutai TTS Voices',
    author: 'Kyutai',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://huggingface.co/kyutai/pocketlm-tts-pretrained-v1',
    description: '8 built-in voice prompts (VCTK, EAR, Expresso datasets)',
  },
  {
    name: 'Parakeet TDT v3',
    author: 'NVIDIA',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2',
    description: 'Speech recognition model (ONNX via sherpa-onnx)',
  },
  {
    name: 'BGE-small-en-v1.5',
    author: 'BAAI',
    license: 'MIT',
    licenseUrl: 'https://opensource.org/licenses/MIT',
    sourceUrl: 'https://huggingface.co/BAAI/bge-small-en-v1.5',
    description: 'Text embedding model for semantic search',
  },
];

const libraries: AttributionEntry[] = [
  {
    name: 'pocket-tts',
    author: 'babybirdprd',
    license: 'MIT',
    licenseUrl: 'https://opensource.org/licenses/MIT',
    sourceUrl: 'https://github.com/babybirdprd/pocket-tts',
    description: 'Rust implementation of Pocket TTS inference',
  },
  {
    name: 'sharp / libvips',
    author: 'Lovell Fuller',
    license: 'Apache-2.0 / LGPL-3.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    sourceUrl: 'https://github.com/lovell/sharp',
    description: 'High-performance image processing for Node.js',
  },
];

// ============================================================================
// Attribution Card
// ============================================================================

function AttributionCard({ entry }: { entry: AttributionEntry }) {
  const theme = useTheme();

  return (
    <div css={css`
      padding: ${theme.spacing[3]} ${theme.spacing[4]};
      border-bottom: 1px solid ${theme.colors.border.light};

      &:last-child {
        border-bottom: none;
      }
    `}>
      <div css={css`
        display: flex;
        align-items: center;
        gap: ${theme.spacing[2]};
        margin-bottom: ${theme.spacing[1]};
      `}>
        <a
          href={entry.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          css={css`
            font-size: ${theme.typography.fontSize.sm};
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.primary};
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: ${theme.spacing[1]};

            &:hover {
              text-decoration: underline;
            }
          `}
        >
          {entry.name}
          <ArrowSquareOut size={12} weight="bold" />
        </a>
        <span css={css`
          font-size: ${theme.typography.fontSize.tiny};
          color: ${theme.colors.text.secondary};
        `}>
          by {entry.author}
        </span>
        <a
          href={entry.licenseUrl}
          target="_blank"
          rel="noopener noreferrer"
          css={css`
            font-size: ${theme.typography.fontSize.tiny};
            font-weight: ${theme.typography.fontWeight.medium};
            color: ${theme.colors.text.secondary};
            background: ${theme.colors.background.elevated};
            padding: ${theme.spacing[0.5]} ${theme.spacing[2]};
            border-radius: ${theme.borderRadius.full};
            border: 1px solid ${theme.colors.border.light};
            text-decoration: none;
            white-space: nowrap;

            &:hover {
              border-color: ${theme.colors.border.default};
            }
          `}
        >
          {entry.license}
        </a>
      </div>
      <Typography.Caption color="secondary">
        {entry.description}
      </Typography.Caption>
    </div>
  );
}

// ============================================================================
// AboutInline — compact block for the System settings section
// ============================================================================

export function AboutInline() {
  const theme = useTheme();
  const { data: versionData } = trpc.settings.getVersion.useQuery();
  const [expanded, setExpanded] = useState(false);

  const groupLabelStyles = css`
    font-size: ${theme.typography.fontSize.xs};
    font-weight: ${theme.typography.fontWeight.semibold};
    color: ${theme.colors.text.secondary};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: ${theme.spacing[2]};
  `;

  const cardStyles = css`
    border: 1px solid ${theme.colors.border.light};
    border-radius: ${theme.borderRadius.md};
    background: ${theme.colors.background.paper};
    overflow: hidden;
  `;

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
      <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
        About
      </Typography.Subtitle>

      {/* Engine identity: name, version, copyright */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[1]};`}>
        <div css={css`display: flex; align-items: baseline; gap: ${theme.spacing[2]};`}>
          <Typography.SmallBody css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
            Animus Engine
          </Typography.SmallBody>
          <span css={css`
            font-size: ${theme.typography.fontSize.xs};
            color: ${theme.colors.text.secondary};
            font-family: ${theme.typography.fontFamily.mono};
          `}>
            v{versionData?.version ?? '...'}
          </span>
        </div>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Typography.Caption color="hint">
            &copy; 2026 Craig Tuttle (Animus Labs)
          </Typography.Caption>
          <a
            href="https://github.com/craigtut/animus/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            css={css`
              font-size: ${theme.typography.fontSize.tiny};
              color: ${theme.colors.text.hint};
              text-decoration: underline;
              text-underline-offset: 2px;
              &:hover { color: ${theme.colors.text.secondary}; }
            `}
          >
            MIT License
          </a>
        </div>
      </div>

      {/* Expand/collapse trigger */}
      <button
        onClick={() => setExpanded((e) => !e)}
        css={css`
          display: flex;
          align-items: center;
          gap: ${theme.spacing[1.5]};
          padding: 0;
          cursor: pointer;
          color: ${theme.colors.text.hint};
          user-select: none;
          &:hover { color: ${theme.colors.text.secondary}; }
        `}
      >
        {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
        <Typography.Caption color="hint">
          {expanded ? 'Hide attributions' : 'Attributions & licenses'}
        </Typography.Caption>
      </button>

      {/* Expandable attributions */}
      <AnimatePresence initial={false}>
        {expanded && (
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
              gap: ${theme.spacing[5]};
              padding-left: ${theme.spacing[3]};
              border-left: 1px solid ${theme.colors.border.light};
              margin-left: ${theme.spacing[1]};
            `}>
              {/* AI Models */}
              <div>
                <div css={groupLabelStyles}>AI Models</div>
                <div css={cardStyles}>
                  {aiModels.map((entry) => (
                    <AttributionCard key={entry.name} entry={entry} />
                  ))}
                </div>
              </div>

              {/* Libraries */}
              <div>
                <div css={groupLabelStyles}>Libraries</div>
                <div css={cardStyles}>
                  {libraries.map((entry) => (
                    <AttributionCard key={entry.name} entry={entry} />
                  ))}
                </div>
              </div>

              {/* Footer */}
              <Typography.Caption color="hint">
                Full attribution details available in{' '}
                <a
                  href="https://github.com/craigtut/animus/blob/main/THIRD-PARTY-LICENSES.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  css={css`
                    color: ${theme.colors.text.secondary};
                    text-decoration: underline;
                    text-underline-offset: 2px;
                    &:hover { color: ${theme.colors.text.primary}; }
                  `}
                >
                  THIRD-PARTY-LICENSES.md
                </a>
              </Typography.Caption>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** @deprecated Use AboutInline instead. Kept for backwards compat if referenced elsewhere. */
export const AboutSection = AboutInline;
