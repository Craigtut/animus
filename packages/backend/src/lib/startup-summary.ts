export interface StartupSummaryData {
  dbCount: number;
  credentialsStored: number;
  cliDetectedProviders: string[];
  modelDataCount: number;
  pluginsLoaded: number;
  pluginsEnabled: number;
  deployedSkills: number;
  toolsSeeded: number;
  channelsInstalled: number;
  channelsRunning: number;
  speechSttReady: boolean;
  speechTtsReady: boolean;
  speechFfmpegAvailable: boolean;
  telemetryEnabled: boolean;
  resumedAfterRestart: boolean;
  nextTickInMs: number | null;
  startupMs: number;
  address: string;
  environment: string;
}

function row(label: string, value: string, width: number): string {
  const body = `${label.padEnd(15)} ${value}`;
  const padded = body.length >= width ? body.slice(0, width) : body.padEnd(width);
  return `| ${padded} |`;
}

export function formatStartupSummary(data: StartupSummaryData): string {
  const innerWidth = 70;
  const cli = data.cliDetectedProviders.length > 0 ? data.cliDetectedProviders.join(', ') : 'none';
  const heartbeatLine = data.resumedAfterRestart
    ? `resumed after restart${data.nextTickInMs ? ` | next tick in ${data.nextTickInMs}ms` : ''}`
    : 'fresh start';
  const lines = [
    '+------------------------------------------------------------------------+',
    '| Animus Startup                                                         |',
    '+------------------------------------------------------------------------+',
    row('Databases', `${data.dbCount} ready`, innerWidth),
    row('Credentials', `${data.credentialsStored} stored | CLI detected: ${cli}`, innerWidth),
    row('Model Data', `${data.modelDataCount} entries loaded`, innerWidth),
    row('Plugins', `${data.pluginsLoaded} loaded | ${data.pluginsEnabled} enabled | ${data.deployedSkills} skills deployed`, innerWidth),
    row('Tools', `${data.toolsSeeded} tool permissions seeded`, innerWidth),
    row('Channels', `${data.channelsInstalled} installed | ${data.channelsRunning} running`, innerWidth),
    row('Speech', `STT: ${data.speechSttReady ? 'ready' : 'unavailable'} | TTS: ${data.speechTtsReady ? 'ready' : 'pending download'} | ffmpeg: ${data.speechFfmpegAvailable ? 'yes' : 'missing'}`, innerWidth),
    row('Telemetry', data.telemetryEnabled ? 'enabled' : 'disabled', innerWidth),
    row('Heartbeat', heartbeatLine, innerWidth),
    row('Startup Time', `${data.startupMs}ms`, innerWidth),
    row('Server', `${data.address} (${data.environment})`, innerWidth),
    '+------------------------------------------------------------------------+',
  ];

  return lines.join('\n');
}
