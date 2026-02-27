/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Microphone,
  Upload,
  Trash,
  SpeakerHigh,
  Check,
} from '@phosphor-icons/react';
import { Card, SelectionCard, Button, Input, Slider, Typography, Badge } from '../ui';
import { trpc } from '../../utils/trpc';

// ============================================================================
// Types
// ============================================================================

interface VoiceTabProps {
  voiceId: string | null;
  setVoiceId: (v: string | null) => void;
  voiceSpeed: number;
  setVoiceSpeed: (v: number) => void;
  markDirty: () => void;
}

// ============================================================================
// Voice Card
// ============================================================================

function VoiceCard({
  voice,
  isSelected,
  onSelect,
}: {
  voice: { id: string; name: string; type: 'builtin' | 'custom'; description?: string };
  isSelected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();

  return (
    <SelectionCard
      selected={isSelected}
      padding="sm"
      onClick={onSelect}
    >
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <SpeakerHigh
          size={16}
          weight={isSelected ? 'fill' : 'regular'}
          css={css`
            color: ${isSelected ? theme.colors.accent : theme.colors.text.hint};
            flex-shrink: 0;
          `}
        />
        <div css={css`flex: 1; min-width: 0;`}>
          <Typography.SmallBodyAlt as="span">{voice.name}</Typography.SmallBodyAlt>
          {voice.description && (
            <Typography.Caption as="p" color="hint" css={css`margin-top: 2px;`}>
              {voice.description}
            </Typography.Caption>
          )}
        </div>
        <Badge variant={voice.type === 'builtin' ? 'default' : 'info'}>
          {voice.type === 'builtin' ? 'Built-in' : 'Custom'}
        </Badge>
      </div>
    </SelectionCard>
  );
}

// ============================================================================
// Upload Section
// ============================================================================

function UploadSection({ onUploaded }: { onUploaded: () => void }) {
  const theme = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const uploadMutation = trpc.speech.uploadCustomVoice.useMutation({
    onSuccess: () => {
      utils.speech.listVoices.invalidate();
      setUploadName('');
      setUploadDesc('');
      setSelectedFile(null);
      setError(null);
      if (fileRef.current) fileRef.current.value = '';
      onUploaded();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.wav')) {
      setError('Only WAV files are supported for voice references.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File must be under 5MB. Use a 5-15 second clean audio clip.');
      return;
    }

    setSelectedFile(file);
    setError(null);
    // Auto-fill name from filename if empty
    if (!uploadName) {
      const nameFromFile = file.name.replace(/\.wav$/i, '').replace(/[-_]/g, ' ');
      setUploadName(nameFromFile.charAt(0).toUpperCase() + nameFromFile.slice(1));
    }
  }, [uploadName]);

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !uploadName.trim()) return;

    const buffer = await selectedFile.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
    );

    uploadMutation.mutate({
      name: uploadName.trim(),
      wavBase64: base64,
      description: uploadDesc.trim() || undefined,
    });
  }, [selectedFile, uploadName, uploadDesc, uploadMutation]);

  return (
    <div css={css`
      display: flex;
      flex-direction: column;
      gap: ${theme.spacing[3]};
      padding: ${theme.spacing[4]};
      border: 1px dashed ${theme.colors.border.default};
      border-radius: ${theme.borderRadius.default};
    `}>
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        <Upload size={16} css={css`color: ${theme.colors.text.secondary};`} />
        <Typography.SmallBody css={css`font-weight: ${theme.typography.fontWeight.medium};`}>
          Add Custom Voice
        </Typography.SmallBody>
      </div>

      <Typography.Caption color="hint">
        Upload a clean WAV recording (5-15 seconds recommended). The voice quality in
        the reference clip is directly reproduced in generated speech.
      </Typography.Caption>

      <input
        ref={fileRef}
        type="file"
        accept=".wav,audio/wav"
        onChange={handleFileSelect}
        css={css`
          font-size: ${theme.typography.fontSize.sm};
          color: ${theme.colors.text.secondary};
          &::file-selector-button {
            padding: ${theme.spacing[1.5]} ${theme.spacing[3]};
            border: 1px solid ${theme.colors.border.default};
            border-radius: ${theme.borderRadius.sm};
            background: ${theme.colors.background.elevated};
            color: ${theme.colors.text.primary};
            font-size: ${theme.typography.fontSize.sm};
            cursor: pointer;
            margin-right: ${theme.spacing[3]};
          }
        `}
      />

      {selectedFile && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}
        >
          <Input
            label="Voice Name"
            value={uploadName}
            onChange={(e) => setUploadName((e.target as HTMLInputElement).value)}
            placeholder="e.g., My Voice"
          />
          <Input
            label="Description (optional)"
            value={uploadDesc}
            onChange={(e) => setUploadDesc((e.target as HTMLInputElement).value)}
            placeholder="e.g., Warm, calm tone"
          />
          <Button
            onClick={handleUpload}
            disabled={!uploadName.trim()}
            loading={uploadMutation.isPending}
          >
            Upload Voice
          </Button>
        </motion.div>
      )}

      {error && (
        <Typography.Caption css={css`color: ${theme.colors.error.main};`}>
          {error}
        </Typography.Caption>
      )}
    </div>
  );
}

// ============================================================================
// Custom Voice Row (for delete)
// ============================================================================

function CustomVoiceRow({
  voice,
  isSelected,
}: {
  voice: { id: string; name: string; description?: string };
  isSelected: boolean;
}) {
  const theme = useTheme();
  const utils = trpc.useUtils();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = trpc.speech.removeCustomVoice.useMutation({
    onSuccess: () => {
      utils.speech.listVoices.invalidate();
      setConfirmDelete(false);
    },
  });

  return (
    <div css={css`
      display: flex;
      align-items: center;
      gap: ${theme.spacing[2]};
      padding: ${theme.spacing[2]} 0;
    `}>
      <div css={css`flex: 1; min-width: 0;`}>
        <Typography.SmallBody as="span" css={css`
          font-weight: ${theme.typography.fontWeight.medium};
        `}>
          {voice.name}
          {isSelected && (
            <Check size={12} weight="bold" css={css`
              margin-left: ${theme.spacing[1]};
              color: ${theme.colors.success.main};
            `} />
          )}
        </Typography.SmallBody>
        {voice.description && (
          <Typography.Caption as="p" color="hint">{voice.description}</Typography.Caption>
        )}
      </div>
      {confirmDelete ? (
        <div css={css`display: flex; gap: ${theme.spacing[1]};`}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteMutation.mutate({ id: voice.id })}
            loading={deleteMutation.isPending}
          >
            Confirm
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          css={css`
            color: ${theme.colors.text.hint};
            cursor: pointer;
            padding: ${theme.spacing[1]};
            border-radius: ${theme.borderRadius.sm};
            transition: color ${theme.transitions.micro};
            &:hover { color: ${theme.colors.error.main}; }
          `}
        >
          <Trash size={16} />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Main Voice Tab
// ============================================================================

export function VoiceTab({
  voiceId,
  setVoiceId,
  voiceSpeed,
  setVoiceSpeed,
  markDirty,
}: VoiceTabProps) {
  const theme = useTheme();
  const { data: voices, isLoading: voicesLoading } = trpc.speech.listVoices.useQuery();
  const { data: status } = trpc.speech.getStatus.useQuery();

  const builtinVoices = voices?.filter((v) => v.type === 'builtin') ?? [];
  const customVoices = voices?.filter((v) => v.type === 'custom') ?? [];
  const allVoices = voices ?? [];

  const handleSelectVoice = useCallback((id: string) => {
    setVoiceId(id === voiceId ? null : id);
    markDirty();
  }, [voiceId, setVoiceId, markDirty]);

  const handleSpeedChange = useCallback((v: number) => {
    setVoiceSpeed(Math.round(v * 20) / 20); // snap to 0.05 increments
    markDirty();
  }, [setVoiceSpeed, markDirty]);

  // TTS not available — show informational state
  if (status && !status.ttsAvailable) {
    return (
      <div css={css`
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: ${theme.spacing[4]};
        padding: ${theme.spacing[8]} ${theme.spacing[4]};
        text-align: center;
      `}>
        <Microphone size={32} css={css`color: ${theme.colors.text.hint};`} />
        <Typography.Body color="secondary">
          Voice is not available yet.
        </Typography.Body>
        <Typography.SmallBody color="hint" css={css`max-width: 400px; line-height: ${theme.typography.lineHeight.relaxed};`}>
          TTS model files have not been downloaded. Voice features will become
          available once the Pocket TTS model is installed in the data/models/tts directory.
        </Typography.SmallBody>
      </div>
    );
  }

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* Voice Selection */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid ${theme.colors.border.light};
          padding-bottom: ${theme.spacing[3]};
        `}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Voice
          </Typography.Subtitle>
          {voiceId && (
            <Typography.Caption color="hint">
              Selected: {allVoices.find((v) => v.id === voiceId)?.name ?? voiceId}
            </Typography.Caption>
          )}
        </div>

        {voicesLoading ? (
          <Typography.SmallBody color="hint">Loading voices...</Typography.SmallBody>
        ) : allVoices.length === 0 ? (
          <Typography.SmallBody color="hint">
            No voices available. Install TTS model files to get started.
          </Typography.SmallBody>
        ) : (
          <>
            {/* Built-in voices */}
            {builtinVoices.length > 0 && (
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <Typography.Caption as="h4" color="hint" css={css`
                  font-weight: ${theme.typography.fontWeight.medium};
                  text-transform: uppercase;
                  letter-spacing: 0.06em;
                `}>
                  Built-in Voices
                </Typography.Caption>
                <div css={css`
                  display: grid;
                  grid-template-columns: repeat(2, 1fr);
                  gap: ${theme.spacing[2]};
                  @media (max-width: ${theme.breakpoints.sm}) { grid-template-columns: 1fr; }
                `}>
                  {builtinVoices.map((voice) => (
                    <VoiceCard
                      key={voice.id}
                      voice={voice}
                      isSelected={voiceId === voice.id}
                      onSelect={() => handleSelectVoice(voice.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Custom voices */}
            {customVoices.length > 0 && (
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <Typography.Caption as="h4" color="hint" css={css`
                  font-weight: ${theme.typography.fontWeight.medium};
                  text-transform: uppercase;
                  letter-spacing: 0.06em;
                `}>
                  Custom Voices
                </Typography.Caption>
                <div css={css`
                  display: grid;
                  grid-template-columns: repeat(2, 1fr);
                  gap: ${theme.spacing[2]};
                  @media (max-width: ${theme.breakpoints.sm}) { grid-template-columns: 1fr; }
                `}>
                  {customVoices.map((voice) => (
                    <VoiceCard
                      key={voice.id}
                      voice={voice}
                      isSelected={voiceId === voice.id}
                      onSelect={() => handleSelectVoice(voice.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* No voice selected hint */}
            {!voiceId && (
              <Typography.Caption color="hint" css={css`
                font-style: italic;
              `}>
                No voice selected. The default voice (Alba) will be used.
              </Typography.Caption>
            )}
          </>
        )}
      </div>

      {/* Voice Speed */}
      <div css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[3]};
        border-bottom: 1px solid ${theme.colors.border.light};
        padding-bottom: ${theme.spacing[6]};
      `}>
        <div css={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
        `}>
          <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
            Speed
          </Typography.Subtitle>
          <Typography.SmallBody color="secondary" css={css`
            font-variant-numeric: tabular-nums;
          `}>
            {voiceSpeed.toFixed(2)}x
          </Typography.SmallBody>
        </div>
        <Slider
          value={voiceSpeed}
          onChange={handleSpeedChange}
          min={0.5}
          max={2.0}
          step={0.05}
          leftLabel="Slower"
          rightLabel="Faster"
          showNeutral
        />
      </div>

      {/* Upload Custom Voice */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <Typography.Subtitle as="h3" css={css`font-weight: ${theme.typography.fontWeight.semibold};`}>
          Custom Voices
        </Typography.Subtitle>

        <UploadSection onUploaded={() => {}} />

        {/* Manage custom voices (delete) */}
        {customVoices.length > 0 && (
          <div css={css`
            display: flex;
            flex-direction: column;
            gap: ${theme.spacing[1]};
            margin-top: ${theme.spacing[2]};
          `}>
            <Typography.Caption as="h4" color="hint" css={css`
              font-weight: ${theme.typography.fontWeight.medium};
              text-transform: uppercase;
              letter-spacing: 0.06em;
              margin-bottom: ${theme.spacing[1]};
            `}>
              Manage Custom Voices
            </Typography.Caption>
            {customVoices.map((voice) => (
              <CustomVoiceRow
                key={voice.id}
                voice={voice}
                isSelected={voiceId === voice.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
