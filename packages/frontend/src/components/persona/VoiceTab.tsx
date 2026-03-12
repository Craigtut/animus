/** @jsxImportSource @emotion/react */
import { css, keyframes, useTheme } from '@emotion/react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Microphone,
  Plus,
  Trash,
  SpeakerHigh,
  Play,
  Stop,
  Info,
  Upload,
  X,
  CircleNotch,
} from '@phosphor-icons/react';
import { SelectionCard, Button, Input, Slider, Tooltip, Typography } from '../ui';
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

interface Voice {
  id: string;
  name: string;
  type: 'builtin' | 'custom';
  description?: string;
}

// ============================================================================
// Waveform Animation (shown during playback)
// ============================================================================

const waveformBounce = keyframes`
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
`;

function WaveformBars({ generating }: { generating?: boolean }) {
  const theme = useTheme();
  const barCount = 4;

  return (
    <div css={css`
      display: flex;
      align-items: center;
      gap: 2px;
      height: 16px;
    `}>
      {Array.from({ length: barCount }).map((_, i) => (
        <div
          key={i}
          css={css`
            width: 2px;
            height: 100%;
            border-radius: 1px;
            background: ${generating ? theme.colors.text.hint : theme.colors.accent};
            animation: ${waveformBounce} ${generating ? '1.2s' : '0.6s'} ease-in-out infinite;
            animation-delay: ${i * (generating ? 150 : 80)}ms;
            transform-origin: center;
          `}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Voice Preview Hook
// ============================================================================

/**
 * Streaming voice preview hook -- fetches chunked PCM from the backend
 * and plays it in near-real-time via Web Audio API (ScriptProcessorNode).
 *
 * Falls back to the tRPC mutation if the streaming endpoint fails.
 */
function useVoicePreview() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const bufferRef = useRef<Float32Array[]>([]);
  const bufferOffsetRef = useRef(0);
  const streamDoneRef = useRef(false);
  const previewMutation = trpc.speech.previewVoice.useMutation();

  const cleanup = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    bufferRef.current = [];
    bufferOffsetRef.current = 0;
    streamDoneRef.current = false;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setPlayingId(null);
    setGenerating(false);
  }, [cleanup]);

  const play = useCallback(async (voiceId: string) => {
    // Stop any current playback
    stop();

    setPlayingId(voiceId);
    setGenerating(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const response = await fetch('/api/speech/preview-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ voiceId }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Stream failed: ${response.status}`);
      }

      const reader = response.body.getReader();

      // Read the 8-byte binary header for sample rate
      let headerBuf = new Uint8Array(0);
      let headerParsed = false;
      let leftoverBytes = new Uint8Array(0);
      let resampleRatio = 1;

      // Set up Web Audio
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const targetRate = audioCtx.sampleRate;

      // ScriptProcessorNode for real-time playback
      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const output = e.outputBuffer.getChannelData(0);
        let outputIdx = 0;

        while (outputIdx < output.length) {
          if (bufferRef.current.length === 0) {
            if (streamDoneRef.current) {
              output.fill(0, outputIdx);
              setTimeout(() => {
                setPlayingId(null);
                setGenerating(false);
                cleanup();
              }, 0);
              return;
            }
            output.fill(0, outputIdx);
            return;
          }

          const currentChunk = bufferRef.current[0]!;
          const remaining = currentChunk.length - bufferOffsetRef.current;
          const needed = output.length - outputIdx;
          const toCopy = Math.min(remaining, needed);

          for (let i = 0; i < toCopy; i++) {
            output[outputIdx + i] = currentChunk[bufferOffsetRef.current + i]!;
          }
          outputIdx += toCopy;
          bufferOffsetRef.current += toCopy;

          if (bufferOffsetRef.current >= currentChunk.length) {
            bufferRef.current.shift();
            bufferOffsetRef.current = 0;
          }
        }
      };

      processor.connect(audioCtx.destination);

      // Process incoming Int16LE PCM chunks from the stream
      const processBytes = (bytes: Uint8Array) => {
        let data: Uint8Array;
        if (leftoverBytes.length > 0) {
          data = new Uint8Array(leftoverBytes.length + bytes.length);
          data.set(leftoverBytes);
          data.set(bytes, leftoverBytes.length);
          leftoverBytes = new Uint8Array(0);
        } else {
          data = bytes;
        }

        const usableBytes = data.length - (data.length % 2);
        if (data.length % 2 !== 0) {
          leftoverBytes = data.slice(usableBytes);
        }

        if (usableBytes === 0) return;

        const view = new DataView(data.buffer, data.byteOffset, usableBytes);
        const sampleCount = usableBytes / 2;
        const floats = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
          const int16 = view.getInt16(i * 2, true);
          floats[i] = int16 / (int16 < 0 ? 0x8000 : 0x7FFF);
        }

        // Resample and push to ring buffer
        if (Math.abs(resampleRatio - 1.0) < 0.001) {
          bufferRef.current.push(floats);
        } else {
          const outputLen = Math.round(floats.length * resampleRatio);
          const resampled = new Float32Array(outputLen);
          for (let i = 0; i < outputLen; i++) {
            const srcIdx = i / resampleRatio;
            const idx0 = Math.floor(srcIdx);
            const idx1 = Math.min(idx0 + 1, floats.length - 1);
            const frac = srcIdx - idx0;
            resampled[i] = floats[idx0]! * (1 - frac) + floats[idx1]! * frac;
          }
          bufferRef.current.push(resampled);
        }
      };

      // Read stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortController.signal.aborted) break;

        let chunk = value;

        // Parse the 8-byte header from the first bytes
        if (!headerParsed) {
          const combined = new Uint8Array(headerBuf.length + chunk.length);
          combined.set(headerBuf);
          combined.set(chunk, headerBuf.length);

          if (combined.length < 8) {
            headerBuf = combined;
            continue;
          }

          const headerView = new DataView(combined.buffer, combined.byteOffset, 8);
          const sourceSampleRate = headerView.getUint32(0, true);
          headerParsed = true;
          resampleRatio = targetRate / sourceSampleRate;

          // Transition from generating to playing on first data
          setGenerating(false);

          chunk = combined.slice(8);
          if (chunk.length === 0) continue;
        }

        processBytes(chunk);
      }

      streamDoneRef.current = true;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      // Fallback to non-streaming tRPC mutation
      cleanup();

      try {
        const result = await previewMutation.mutateAsync({ voiceId });
        if (abortRef.current?.signal.aborted) return;
        setGenerating(false);

        const audio = new Audio(`data:audio/wav;base64,${result.wavBase64}`);
        audio.onended = () => { setPlayingId(null); };
        audio.onerror = () => { setPlayingId(null); };
        await audio.play();
      } catch {
        setPlayingId(null);
        setGenerating(false);
      }
    }
  }, [previewMutation, stop, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { playingId, generating, play, stop };
}

// ============================================================================
// Section Label
// ============================================================================

function SectionLabel({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Typography.Caption as="h4" color="hint" css={css`
      font-weight: ${theme.typography.fontWeight.medium};
      text-transform: uppercase;
      letter-spacing: 0.06em;
    `}>
      {children}
    </Typography.Caption>
  );
}

// ============================================================================
// Voice Card
// ============================================================================

function VoiceCard({
  voice,
  isSelected,
  onSelect,
  onDelete,
  previewState,
  onPreview,
  onStopPreview,
}: {
  voice: Voice;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  previewState: 'idle' | 'generating' | 'playing';
  onPreview: () => void;
  onStopPreview: () => void;
}) {
  const theme = useTheme();
  const isActive = previewState !== 'idle';

  return (
    <SelectionCard
      selected={isSelected}
      padding="sm"
      onClick={onSelect}
    >
      <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
        {/* Preview button / waveform */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isActive) onStopPreview();
            else onPreview();
          }}
          css={css`
            flex-shrink: 0;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all ${theme.transitions.fast};
            color: ${isActive ? theme.colors.accent : theme.colors.text.hint};
            background: ${isActive ? `${theme.colors.accent}12` : 'transparent'};

            &:hover {
              color: ${theme.colors.accent};
              background: ${theme.colors.accent}12;
            }
          `}
          aria-label={isActive ? 'Stop preview' : `Preview ${voice.name}`}
        >
          {previewState === 'generating' ? (
            <WaveformBars generating />
          ) : previewState === 'playing' ? (
            <WaveformBars />
          ) : (
            <Play size={14} weight="fill" />
          )}
        </button>

        {/* Voice info */}
        <div css={css`flex: 1; min-width: 0;`}>
          <Typography.SmallBodyAlt as="span">{voice.name}</Typography.SmallBodyAlt>
          {voice.description && (
            <Typography.Caption as="p" color="hint" css={css`margin-top: 2px;`}>
              {voice.description}
            </Typography.Caption>
          )}
        </div>

        {/* Delete button (custom voices only, visible on hover) */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            css={css`
              color: ${theme.colors.text.disabled};
              cursor: pointer;
              padding: ${theme.spacing[1]};
              border-radius: ${theme.borderRadius.sm};
              transition: all ${theme.transitions.fast};
              opacity: 0;
              flex-shrink: 0;

              *:hover > * > * > & {
                opacity: 1;
              }
              &:hover {
                color: ${theme.colors.error.main};
              }
            `}
            aria-label={`Delete ${voice.name}`}
          >
            <Trash size={14} />
          </button>
        )}
      </div>
    </SelectionCard>
  );
}

// ============================================================================
// Custom Voice Card (wraps VoiceCard with delete confirmation)
// ============================================================================

function CustomVoiceCard({
  voice,
  isSelected,
  onSelect,
  previewState,
  onPreview,
  onStopPreview,
}: {
  voice: Voice;
  isSelected: boolean;
  onSelect: () => void;
  previewState: 'idle' | 'generating' | 'playing';
  onPreview: () => void;
  onStopPreview: () => void;
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

  if (confirmDelete) {
    return (
      <div css={css`
        display: flex;
        align-items: center;
        justify-content: center;
        gap: ${theme.spacing[2]};
        padding: ${theme.spacing[3]};
        border: 1px solid ${theme.colors.border.default};
        border-radius: ${theme.borderRadius.md};
        background: ${theme.colors.background.elevated};
      `}>
        <Typography.Caption color="secondary" css={css`flex: 1;`}>
          Remove {voice.name}?
        </Typography.Caption>
        <Button
          variant="danger"
          size="sm"
          onClick={() => deleteMutation.mutate({ id: voice.id })}
          loading={deleteMutation.isPending}
        >
          Remove
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <VoiceCard
      voice={voice}
      isSelected={isSelected}
      onSelect={onSelect}
      onDelete={() => setConfirmDelete(true)}
      previewState={previewState}
      onPreview={onPreview}
      onStopPreview={onStopPreview}
    />
  );
}

// ============================================================================
// Upload Drop Zone (drag-and-drop + click, progressive disclosure)
// ============================================================================

function UploadDropZone({ onUploaded }: { onUploaded: () => void }) {
  const theme = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
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
      setExpanded(false);
      if (fileRef.current) fileRef.current.value = '';
      onUploaded();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith('.wav')) {
      setError('Only WAV files are supported.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File must be under 5MB.');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setExpanded(true);

    // Auto-fill name from filename
    const nameFromFile = file.name.replace(/\.wav$/i, '').replace(/[-_]/g, ' ');
    setUploadName(nameFromFile.charAt(0).toUpperCase() + nameFromFile.slice(1));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileRef.current) fileRef.current.value = '';
  }, [processFile]);

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

  const handleClose = useCallback(() => {
    setExpanded(false);
    setSelectedFile(null);
    setUploadName('');
    setUploadDesc('');
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  // Hidden file input
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".wav,audio/wav"
      onChange={handleFileInputChange}
      css={css`display: none;`}
    />
  );

  return (
    <div>
      {fileInput}
      <AnimatePresence mode="wait">
        {!expanded ? (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            css={css`
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: ${theme.spacing[1.5]};
              padding: ${theme.spacing[4]} ${theme.spacing[3]};
              border: 1.5px dashed ${isDragOver ? theme.colors.accent : theme.colors.border.default};
              border-radius: ${theme.borderRadius.md};
              background: ${isDragOver ? `${theme.colors.accent}08` : 'transparent'};
              cursor: pointer;
              transition: all ${theme.transitions.fast};

              &:hover {
                border-color: ${theme.colors.border.focus};
                background: ${theme.colors.background.elevated};
              }
            `}
          >
            {isDragOver ? (
              <Upload size={20} weight="fill" css={css`color: ${theme.colors.accent};`} />
            ) : (
              <Plus size={16} weight="bold" css={css`color: ${theme.colors.text.hint};`} />
            )}
            <div css={css`text-align: center;`}>
              <Typography.SmallBody color={isDragOver ? 'primary' : 'hint'} css={css`
                font-weight: ${theme.typography.fontWeight.medium};
              `}>
                {isDragOver ? 'Drop WAV file' : 'Add Custom Voice'}
              </Typography.SmallBody>
              {!isDragOver && (
                <div css={css`
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: ${theme.spacing[1]};
                  margin-top: ${theme.spacing[0.5]};
                `}>
                  <Typography.Caption color="hint">
                    Upload a WAV recording, 5-15 seconds
                  </Typography.Caption>
                  <Tooltip content="The voice quality in the reference clip is directly reproduced in generated speech. Use a clean recording with minimal background noise.">
                    <Info
                      size={12}
                      css={css`
                        color: ${theme.colors.text.disabled};
                        cursor: help;
                        flex-shrink: 0;
                        &:hover { color: ${theme.colors.text.hint}; }
                      `}
                    />
                  </Tooltip>
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            css={css`overflow: hidden;`}
          >
            <div css={css`
              display: flex;
              flex-direction: column;
              gap: ${theme.spacing[3]};
              padding: ${theme.spacing[4]};
              border: 1px solid ${theme.colors.border.default};
              border-radius: ${theme.borderRadius.md};
              background: ${theme.colors.background.elevated};
            `}>
              {/* Header */}
              <div css={css`
                display: flex;
                align-items: center;
                justify-content: space-between;
              `}>
                <Typography.SmallBodyAlt>
                  {selectedFile ? selectedFile.name : 'Upload Custom Voice'}
                </Typography.SmallBodyAlt>
                <button
                  onClick={handleClose}
                  css={css`
                    color: ${theme.colors.text.hint};
                    cursor: pointer;
                    padding: ${theme.spacing[1]};
                    border-radius: ${theme.borderRadius.sm};
                    transition: color ${theme.transitions.fast};
                    &:hover { color: ${theme.colors.text.primary}; }
                  `}
                >
                  <X size={16} />
                </button>
              </div>

              {!selectedFile ? (
                /* If expanded but no file yet (edge case), show drop target */
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  css={css`
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: ${theme.spacing[2]};
                    padding: ${theme.spacing[4]};
                    border: 1.5px dashed ${theme.colors.border.default};
                    border-radius: ${theme.borderRadius.default};
                    cursor: pointer;
                    &:hover { border-color: ${theme.colors.border.focus}; }
                  `}
                >
                  <Upload size={16} css={css`color: ${theme.colors.text.hint};`} />
                  <Typography.SmallBody color="hint">
                    Drop a WAV file or click to browse
                  </Typography.SmallBody>
                </div>
              ) : (
                <>
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
                  <div css={css`display: flex; gap: ${theme.spacing[2]};`}>
                    <Button
                      onClick={handleUpload}
                      disabled={!uploadName.trim()}
                      loading={uploadMutation.isPending}
                    >
                      Upload Voice
                    </Button>
                    <Button variant="ghost" onClick={() => {
                      setSelectedFile(null);
                      if (fileRef.current) fileRef.current.value = '';
                    }}>
                      Change File
                    </Button>
                  </div>
                </>
              )}

              {error && (
                <Typography.Caption css={css`color: ${theme.colors.error.main};`}>
                  {error}
                </Typography.Caption>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Voice Grid
// ============================================================================

const voiceGridStyles = (breakpoint: string) => css`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  @media (max-width: ${breakpoint}) { grid-template-columns: 1fr; }
`;

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
  const preview = useVoicePreview();

  const builtinVoices = voices?.filter((v) => v.type === 'builtin') ?? [];
  const customVoices = voices?.filter((v) => v.type === 'custom') ?? [];
  const allVoices = voices ?? [];

  const handleSelectVoice = useCallback((id: string) => {
    setVoiceId(id === voiceId ? null : id);
    markDirty();
  }, [voiceId, setVoiceId, markDirty]);

  const handleSpeedChange = useCallback((v: number) => {
    setVoiceSpeed(Math.round(v * 20) / 20);
    markDirty();
  }, [setVoiceSpeed, markDirty]);

  const getPreviewState = useCallback((id: string): 'idle' | 'generating' | 'playing' => {
    if (preview.playingId !== id) return 'idle';
    return preview.generating ? 'generating' : 'playing';
  }, [preview.playingId, preview.generating]);

  // TTS not available
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
          The text-to-speech model has not been downloaded. Voice features will become
          available once the model is installed.
        </Typography.SmallBody>
      </div>
    );
  }

  return (
    <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[6]};`}>
      {/* ---- Voice Selection ---- */}
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
        ) : allVoices.length === 0 && customVoices.length === 0 ? (
          <Typography.SmallBody color="hint">
            No voices available. Install TTS model files to get started.
          </Typography.SmallBody>
        ) : (
          <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[4]};`}>
            {/* Built-in voices */}
            {builtinVoices.length > 0 && (
              <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
                <SectionLabel>Built-in Voices</SectionLabel>
                <div css={voiceGridStyles(theme.breakpoints.sm)}>
                  {builtinVoices.map((voice) => (
                    <VoiceCard
                      key={voice.id}
                      voice={voice}
                      isSelected={voiceId === voice.id}
                      onSelect={() => handleSelectVoice(voice.id)}
                      previewState={getPreviewState(voice.id)}
                      onPreview={() => preview.play(voice.id)}
                      onStopPreview={preview.stop}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Custom voices + upload */}
            <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[2]};`}>
              <SectionLabel>Your Voices</SectionLabel>

              {customVoices.length > 0 && (
                <div css={voiceGridStyles(theme.breakpoints.sm)}>
                  {customVoices.map((voice) => (
                    <CustomVoiceCard
                      key={voice.id}
                      voice={voice}
                      isSelected={voiceId === voice.id}
                      onSelect={() => handleSelectVoice(voice.id)}
                      previewState={getPreviewState(voice.id)}
                      onPreview={() => preview.play(voice.id)}
                      onStopPreview={preview.stop}
                    />
                  ))}
                </div>
              )}

              <UploadDropZone onUploaded={() => {}} />
            </div>

            {/* No voice selected hint */}
            {!voiceId && (
              <Typography.Caption color="hint" css={css`font-style: italic;`}>
                No voice selected. The default voice (Alba) will be used.
              </Typography.Caption>
            )}
          </div>
        )}
      </div>

      {/* ---- Speed ---- */}
      <div css={css`
        display: flex;
        flex-direction: column;
        gap: ${theme.spacing[3]};
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
          max={1.5}
          step={0.05}
          leftLabel="Slower"
          rightLabel="Faster"
          showNeutral
        />
      </div>
    </div>
  );
}
