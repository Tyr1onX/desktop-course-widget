export const VIDEO = {
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 150,
} as const;

export const BEATS = {
  lightAppears: 8,
  orbitStarts: 18,
  stripStarts: 42,
  echoesStart: 65,
  iconLocks: 102,
  officialIconCrossfade: 116,
  titleStarts: 123,
} as const;

export const PALETTE = {
  background: '#F4F6F8',
  ink: '#18202A',
  track: '#8E9AA8',
  trackMuted: '#D8DEE5',
  strip: '#FFFFFF',
  stripBorder: '#DDE3E9',
  accent: '#66C8C4',
  accentSoft: '#BCE9E6',
  shadow: 'rgba(33, 42, 52, 0.12)',
} as const;
