import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {BEATS, PALETTE} from '../timing';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const progress = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });

const orbitPoint = (value: number, radiusX: number, radiusY: number) => {
  const angle = (-155 + value * 330) * (Math.PI / 180);
  return {
    x: 280 + Math.cos(angle) * radiusX,
    y: 280 + Math.sin(angle) * radiusY,
  };
};

export const CourseMark = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const appear = progress(frame, BEATS.lightAppears, BEATS.lightAppears + 14);
  const orbit = progress(frame, BEATS.orbitStarts, BEATS.iconLocks - 12);
  const innerOrbit = progress(frame, BEATS.orbitStarts + 12, BEATS.iconLocks - 4);
  const strip = progress(frame, BEATS.stripStarts, BEATS.stripStarts + 30);
  const settle = spring({
    frame: frame - BEATS.iconLocks,
    fps,
    config: {damping: 18, stiffness: 115, mass: 0.8},
    durationInFrames: 24,
  });

  const mainPoint = orbitPoint(orbit, 193, 150);
  const secondaryProgress = Math.max(0, orbit - 0.19);
  const secondaryPoint = orbitPoint(secondaryProgress, 151, 112);

  const markScale = interpolate(settle, [0, 1], [0.985, 1]);
  const stripWidth = interpolate(strip, [0, 1], [8, 238]);
  const stripHeight = interpolate(strip, [0, 1], [4, 74]);
  const stripRadius = interpolate(strip, [0, 1], [2, 28]);

  const echoOne = progress(frame, BEATS.echoesStart, BEATS.echoesStart + 15) *
    (1 - progress(frame, BEATS.echoesStart + 18, BEATS.echoesStart + 34));
  const echoTwo = progress(frame, BEATS.echoesStart + 8, BEATS.echoesStart + 23) *
    (1 - progress(frame, BEATS.echoesStart + 27, BEATS.echoesStart + 42));

  return (
    <svg
      viewBox="0 0 560 560"
      width="560"
      height="560"
      aria-label="课刻图标形成动画"
      style={{overflow: 'visible', transform: `scale(${markScale})`}}
    >
      <defs>
        <filter id="course-mark-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="course-mark-shadow" x="-40%" y="-60%" width="180%" height="220%">
          <feDropShadow dx="0" dy="18" stdDeviation="22" floodColor="#26313C" floodOpacity="0.14" />
        </filter>
      </defs>

      <g opacity={interpolate(orbit, [0, 1], [0.18, 1])}>
        <path
          d="M 87 280 C 87 151 177 83 280 83 C 408 83 473 178 473 280 C 473 409 383 477 280 477 C 152 477 87 382 87 280"
          fill="none"
          stroke={PALETTE.trackMuted}
          strokeWidth="16"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          strokeDashoffset={1 - orbit}
        />
        <path
          d="M 129 280 C 129 184 197 126 280 126 C 382 126 431 202 431 280 C 431 376 363 434 280 434 C 178 434 129 358 129 280"
          fill="none"
          stroke={PALETTE.track}
          strokeWidth="11"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          strokeDashoffset={1 - innerOrbit}
          opacity="0.76"
        />
      </g>

      <g opacity={echoOne * 0.28} transform={`translate(0 ${interpolate(echoOne, [0, 1], [18, -18])})`}>
        <rect x="183" y="240" width="194" height="64" rx="25" fill={PALETTE.accentSoft} />
      </g>
      <g opacity={echoTwo * 0.2} transform={`translate(0 ${interpolate(echoTwo, [0, 1], [24, 22])})`}>
        <rect x="197" y="250" width="166" height="55" rx="22" fill={PALETTE.track} />
      </g>

      <g filter="url(#course-mark-shadow)">
        <rect
          x={280 - stripWidth / 2}
          y={280 - stripHeight / 2}
          width={stripWidth}
          height={stripHeight}
          rx={stripRadius}
          fill={PALETTE.strip}
          stroke={PALETTE.stripBorder}
          strokeWidth="3"
        />
        <rect
          x={280 - stripWidth * 0.31}
          y={278 - stripHeight * 0.12}
          width={stripWidth * 0.42}
          height={Math.max(2, stripHeight * 0.12)}
          rx="8"
          fill={PALETTE.ink}
          opacity={strip * 0.68}
        />
        <rect
          x={280 - stripWidth * 0.31}
          y={296 - stripHeight * 0.06}
          width={stripWidth * 0.58}
          height={Math.max(2, stripHeight * 0.09)}
          rx="7"
          fill={PALETTE.track}
          opacity={strip * 0.5}
        />
      </g>

      <circle
        cx={mainPoint.x}
        cy={mainPoint.y}
        r={23 * appear}
        fill={PALETTE.accent}
        opacity={appear * 0.22}
        filter="url(#course-mark-glow)"
      />
      <circle
        cx={mainPoint.x}
        cy={mainPoint.y}
        r={9 * appear}
        fill={PALETTE.accent}
      />
      <circle
        cx={mainPoint.x - 2}
        cy={mainPoint.y - 2}
        r={3.2 * appear}
        fill="#FFFFFF"
        opacity="0.9"
      />

      <circle
        cx={secondaryPoint.x}
        cy={secondaryPoint.y}
        r={5.5 * progress(frame, BEATS.orbitStarts + 22, BEATS.orbitStarts + 37)}
        fill={PALETTE.ink}
        opacity={0.7 * (1 - progress(frame, BEATS.iconLocks - 10, BEATS.iconLocks + 6))}
      />
    </svg>
  );
};
