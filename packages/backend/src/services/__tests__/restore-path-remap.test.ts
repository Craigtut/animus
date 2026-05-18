import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { remapDataSubdirPath, remapSavedJsonPaths } from '../restore-service.js';

describe('restore path remapping', () => {
  const currentDataDir = path.join(path.sep, 'new', 'animus-data');

  it('remaps media paths while preserving nested media subdirectories', () => {
    const restored = remapDataSubdirPath(
      '/old/install/data/media/speech/reply.wav',
      'media',
      currentDataDir,
      true,
    );

    expect(restored).toBe(path.join(currentDataDir, 'media', 'speech', 'reply.wav'));
  });

  it('remaps persisted tool-result markers inside session JSON', () => {
    const oldPath = '/old/install/data/tool-results/42/Bash-abc.md';
    const session = [
      {
        role: 'assistant',
        content: `[Result persisted: ${oldPath} (12000 chars, ~3000 tokens)]`,
      },
    ];

    const remapped = remapSavedJsonPaths(session, currentDataDir) as typeof session;

    expect(remapped[0]!.content).toContain(
      `[Result persisted: ${path.join(currentDataDir, 'tool-results', '42', 'Bash-abc.md')} (`,
    );
  });

  it('remaps localPath fields in nested message metadata', () => {
    const metadata = {
      media: [
        {
          type: 'image',
          localPath: '/old/install/data/media/photo.png',
        },
      ],
    };

    const remapped = remapSavedJsonPaths(metadata, currentDataDir) as typeof metadata;

    expect(remapped.media[0]!.localPath).toBe(path.join(currentDataDir, 'media', 'photo.png'));
  });
});
