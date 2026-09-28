import { getSetting, setSetting } from './db';

export interface Settings {
  bitrate: 128 | 192 | 320;
  autoUpdateYtdlp: boolean;
}

const DEFAULTS: Settings = { bitrate: 320, autoUpdateYtdlp: true };

export function getSettings(): Settings {
  const bitrate = Number(getSetting('bitrate') ?? DEFAULTS.bitrate);
  return {
    bitrate: ([128, 192, 320] as number[]).includes(bitrate) ? (bitrate as Settings['bitrate']) : DEFAULTS.bitrate,
    autoUpdateYtdlp: (getSetting('autoUpdateYtdlp') ?? '1') === '1',
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  if (patch.bitrate !== undefined) setSetting('bitrate', String(patch.bitrate));
  if (patch.autoUpdateYtdlp !== undefined) setSetting('autoUpdateYtdlp', patch.autoUpdateYtdlp ? '1' : '0');
  return getSettings();
}
