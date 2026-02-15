/** @jsxImportSource @emotion/react */
import { css, useTheme } from '@emotion/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { NotePencil, Brain } from '@phosphor-icons/react';
import { Input, Typography } from '../../components/ui';
import { trpc } from '../../utils/trpc';

interface ContactNotesProps {
  contactId: string;
  fullName: string;
  isPrimary: boolean;
  notes: string | null;
}

export function ContactNotes({ contactId, fullName, isPrimary, notes: initialNotes }: ContactNotesProps) {
  const theme = useTheme();

  const [notes, setNotes] = useState(initialNotes ?? '');
  const [notesSaved, setNotesSaved] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notesSaveMutation = trpc.contacts.update.useMutation({
    onSuccess: () => {
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 1500);
    },
  });

  useEffect(() => {
    setNotes(initialNotes ?? '');
  }, [initialNotes]);

  const handleNotesChange = useCallback(
    (value: string) => {
      setNotes(value);
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(() => {
        notesSaveMutation.mutate({ id: contactId, notes: value || null });
      }, 1500);
    },
    [contactId, notesSaveMutation],
  );

  const firstName = fullName.split(' ')[0];

  return (
    <>
      {/* Contact Notes */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <NotePencil size={16} css={css`color: ${theme.colors.text.secondary};`} />
          <Typography.BodyAlt as="h3">
            {isPrimary ? 'About you' : 'Your notes'}
          </Typography.BodyAlt>
          <AnimatePresence>
            {notesSaved && (
              <Typography.Caption
                as={motion.span}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                color={theme.colors.success.main}
              >
                Saved
              </Typography.Caption>
            )}
          </AnimatePresence>
        </div>
        <Input
          multiline
          value={notes}
          onChange={(e) => handleNotesChange((e.target as HTMLTextAreaElement).value)}
          placeholder={isPrimary ? 'Notes about yourself...' : `Notes about ${fullName}...`}
          helperText="Auto-saves after 1.5 seconds."
        />
      </div>

      {/* Working Memory (read-only) */}
      <div css={css`display: flex; flex-direction: column; gap: ${theme.spacing[3]};`}>
        <div css={css`display: flex; align-items: center; gap: ${theme.spacing[2]};`}>
          <Brain size={16} css={css`color: ${theme.colors.text.secondary};`} />
          <Typography.BodyAlt as="h3">
            What {firstName} knows
          </Typography.BodyAlt>
        </div>
        <Typography.SmallBody color="hint" italic>
          Your Animus hasn't formed notes about this contact yet.
        </Typography.SmallBody>
      </div>
    </>
  );
}
