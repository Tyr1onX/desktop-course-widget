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
  iconLocks: 108,
  titleStarts: 123,
} as const;

export const PALETTE = {
  background: '#F4F6F8',
  ink: '#18202A',
  track: '#7897D1',
  trackMuted: '#A9BCE1',
  strip: '#F8FAFF',
  stripBorder: '#D8E0F2',
  accent: '#FFD478',
  accentSoft: '#FFE8AC',
  shadow: 'rgba(61, 75, 115, 0.16)',
} as const;
