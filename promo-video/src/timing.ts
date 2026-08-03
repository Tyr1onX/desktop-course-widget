export const VIDEO = {
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 150,
} as const;

export const BEATS = {
  lightAppears: 7,
  orbitStarts: 16,
  stripStarts: 37,
  echoesStart: 57,
  convergeStarts: 73,
  iconLocks: 121,
  titleStarts: 126,
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
