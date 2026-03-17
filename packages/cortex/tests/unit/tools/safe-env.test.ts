import { describe, it, expect } from 'vitest';
import { buildSafeEnv } from '../../../src/tools/shared/safe-env.js';

describe('buildSafeEnv (shared)', () => {
  it('strips LD_ prefixed variables', () => {
    const env = buildSafeEnv({ LD_PRELOAD: '/tmp/evil.so', LD_LIBRARY_PATH: '/lib' });
    expect(env['LD_PRELOAD']).toBeUndefined();
    expect(env['LD_LIBRARY_PATH']).toBeUndefined();
  });

  it('strips DYLD_ prefixed variables', () => {
    const env = buildSafeEnv({ DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' });
    expect(env['DYLD_INSERT_LIBRARIES']).toBeUndefined();
  });

  it('strips BASH_FUNC_ prefixed variables', () => {
    const env = buildSafeEnv({ 'BASH_FUNC_evil%%': '() { echo pwned; }' });
    expect(env['BASH_FUNC_evil%%']).toBeUndefined();
  });

  it('strips blocked exact-match variables', () => {
    const env = buildSafeEnv({
      NODE_OPTIONS: '--max-old-space-size=4096',
      BASH_ENV: '/tmp/evil.sh',
      PYTHONPATH: '/tmp',
      GIT_EXTERNAL_DIFF: '/tmp/evil',
      SSLKEYLOGFILE: '/tmp/keys.log',
      PROMPT_COMMAND: 'echo evil',
    });
    expect(env['NODE_OPTIONS']).toBeUndefined();
    expect(env['BASH_ENV']).toBeUndefined();
    expect(env['PYTHONPATH']).toBeUndefined();
    expect(env['GIT_EXTERNAL_DIFF']).toBeUndefined();
    expect(env['SSLKEYLOGFILE']).toBeUndefined();
    expect(env['PROMPT_COMMAND']).toBeUndefined();
  });

  it('preserves safe variables', () => {
    const env = buildSafeEnv({
      HOME: '/home/user',
      PATH: '/usr/bin',
      MY_SAFE_VAR: 'value',
    });
    expect(env['HOME']).toBe('/home/user');
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['MY_SAFE_VAR']).toBe('value');
  });

  it('adds marker when provided', () => {
    const env = buildSafeEnv({}, 'exec');
    expect(env['CORTEX_SHELL']).toBe('exec');
  });

  it('does not add marker when undefined', () => {
    const env = buildSafeEnv({});
    expect(env['CORTEX_SHELL']).toBeUndefined();
  });

  it('skips undefined values in parent env', () => {
    const parentEnv: NodeJS.ProcessEnv = { DEFINED: 'yes', UNDEF: undefined };
    const env = buildSafeEnv(parentEnv);
    expect(env['DEFINED']).toBe('yes');
    expect('UNDEF' in env).toBe(false);
  });

  // -----------------------------------------------------------------------
  // envOverrides
  // -----------------------------------------------------------------------

  describe('envOverrides', () => {
    it('merges overrides on top of sanitized env', () => {
      const env = buildSafeEnv(
        { HOME: '/home/user', PATH: '/usr/bin' },
        undefined,
        { CUSTOM_VAR: 'custom_value' },
      );
      expect(env['HOME']).toBe('/home/user');
      expect(env['CUSTOM_VAR']).toBe('custom_value');
    });

    it('overrides can restore blocked DYLD_ variables', () => {
      const env = buildSafeEnv(
        { DYLD_INSERT_LIBRARIES: '/original/path.dylib' },
        undefined,
        { DYLD_INSERT_LIBRARIES: '/app/dock-suppress.dylib' },
      );
      // The parent env value was stripped, but the override restores it
      expect(env['DYLD_INSERT_LIBRARIES']).toBe('/app/dock-suppress.dylib');
    });

    it('overrides can restore blocked LD_ variables', () => {
      const env = buildSafeEnv(
        { LD_PRELOAD: '/evil.so' },
        undefined,
        { LD_PRELOAD: '/safe/preload.so' },
      );
      expect(env['LD_PRELOAD']).toBe('/safe/preload.so');
    });

    it('overrides can restore blocked exact-match variables', () => {
      const env = buildSafeEnv(
        { NODE_OPTIONS: '--original' },
        undefined,
        { NODE_OPTIONS: '--override-value' },
      );
      expect(env['NODE_OPTIONS']).toBe('--override-value');
    });

    it('overrides take precedence over safe parent env values', () => {
      const env = buildSafeEnv(
        { MY_VAR: 'original' },
        undefined,
        { MY_VAR: 'overridden' },
      );
      expect(env['MY_VAR']).toBe('overridden');
    });

    it('overrides are applied after marker', () => {
      const env = buildSafeEnv(
        {},
        'exec',
        { CORTEX_SHELL: 'override-marker' },
      );
      // Override should win over the marker
      expect(env['CORTEX_SHELL']).toBe('override-marker');
    });

    it('no-op when overrides is undefined', () => {
      const env = buildSafeEnv({ HOME: '/home/user' }, undefined, undefined);
      expect(env['HOME']).toBe('/home/user');
    });

    it('no-op when overrides is empty', () => {
      const env = buildSafeEnv({ HOME: '/home/user' }, undefined, {});
      expect(env['HOME']).toBe('/home/user');
    });
  });
});
