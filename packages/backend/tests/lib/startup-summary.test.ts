import { describe, expect, it } from 'vitest';
import { formatStartupSummary } from '../../src/lib/startup-summary.js';

describe('startup summary', () => {
  it('renders model data and tool counts', () => {
    const output = formatStartupSummary({
      dbCount: 6,
      credentialsStored: 3,
      cliDetectedProviders: ['claude'],
      modelDataCount: 21,
      pluginsLoaded: 4,
      pluginsEnabled: 3,
      deployedSkills: 7,
      toolsSeeded: 29,
      channelsInstalled: 2,
      channelsRunning: 1,
      speechSttReady: true,
      speechTtsReady: false,
      speechFfmpegAvailable: true,
      telemetryEnabled: true,
      resumedAfterRestart: true,
      nextTickInMs: 600000,
      startupMs: 842,
      address: 'http://127.0.0.1:3000',
      environment: 'development',
    });

    expect(output).toContain('Model Data');
    expect(output).toContain('21 entries loaded');
    expect(output).toContain('Tools');
    expect(output).toContain('29 tool permissions seeded');
    expect(output).toContain('Speech');
    expect(output).toContain('STT: ready');
    expect(output).toContain('TTS: pending download');
    expect(output).toContain('ffmpeg: yes');
    expect(output).toContain('Telemetry');
    expect(output).toContain('enabled');
    expect(output).toContain('Heartbeat');
    expect(output).toContain('resumed after restart');
    expect(output).toContain('CLI detected: claude');
  });
});
