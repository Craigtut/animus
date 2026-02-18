/**
 * CommandInput — text input with green prompt prefix.
 * Always active — input is accepted even while the agent is streaming.
 * Shows a dimmed indicator when the agent is working.
 */

import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  isStreaming: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

export function CommandInput({ isStreaming, value, onChange, onSubmit }: Props) {
  return (
    <Box>
      <Text color="green" bold>
        you {'>'}{' '}
      </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      {isStreaming && (
        <Text color="gray" dimColor>
          {' '}(agent working...)
        </Text>
      )}
    </Box>
  );
}
