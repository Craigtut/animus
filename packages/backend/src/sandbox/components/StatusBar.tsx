/**
 * StatusBar — single-line status showing provider, model, plugins, and session state.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { SandboxState } from '../types.js';

interface Props {
  state: SandboxState;
}

export function StatusBar({ state }: Props) {
  const sessionStatus = state.isStreaming
    ? 'streaming'
    : state.sessionId
      ? 'idle'
      : 'no session';

  const statusColor =
    sessionStatus === 'streaming'
      ? 'yellow'
      : sessionStatus === 'idle'
        ? 'green'
        : 'gray';

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold color="cyan">
        sandbox
      </Text>
      <Text color="gray"> | </Text>
      <Text color="magenta">{state.provider}</Text>
      {state.model && (
        <>
          <Text color="gray">:</Text>
          <Text color="white">{state.model}</Text>
        </>
      )}
      <Text color="gray"> | </Text>
      <Text color="blue">plugins: {state.pluginsLoaded}</Text>
      <Text color="gray"> | </Text>
      <Text color={statusColor}>{sessionStatus}</Text>
      {state.showVerboseEvents && (
        <>
          <Text color="gray"> | </Text>
          <Text color="yellow">verbose</Text>
        </>
      )}
    </Box>
  );
}
