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

type Point = {x: number; y: number};
type Cubic = {
  start: Point;
  controlOne: Point;
  controlTwo: Point;
  end: Point;
};
type ClosedPath = {
  start: Point;
  segments: Array<{
    controlOne: Point;
    controlTwo: Point;
    end: Point;
  }>;
};

const mix = (from: number, to: number, value: number) => from + (to - from) * value;

const mixPoint = (from: Point, to: Point, value: number): Point => ({
  x: mix(from.x, to.x, value),
  y: mix(from.y, to.y, value),
});

const mixCubic = (from: Cubic, to: Cubic, value: number): Cubic => ({
  start: mixPoint(from.start, to.start, value),
  controlOne: mixPoint(from.controlOne, to.controlOne, value),
  controlTwo: mixPoint(from.controlTwo, to.controlTwo, value),
  end: mixPoint(from.end, to.end, value),
});

const mixClosedPath = (from: ClosedPath, to: ClosedPath, value: number): ClosedPath => ({
  start: mixPoint(from.start, to.start, value),
  segments: from.segments.map((segment, index) => ({
    controlOne: mixPoint(segment.controlOne, to.segments[index].controlOne, value),
    controlTwo: mixPoint(segment.controlTwo, to.segments[index].controlTwo, value),
    end: mixPoint(segment.end, to.segments[index].end, value),
  })),
});

const cubicPath = ({start, controlOne, controlTwo, end}: Cubic) =>
  `M ${start.x} ${start.y} C ${controlOne.x} ${controlOne.y} ${controlTwo.x} ${controlTwo.y} ${end.x} ${end.y}`;

const closedPath = ({start, segments}: ClosedPath) =>
  [
    `M ${start.x} ${start.y}`,
    ...segments.map(
      ({controlOne, controlTwo, end}) =>
        `C ${controlOne.x} ${controlOne.y} ${controlTwo.x} ${controlTwo.y} ${end.x} ${end.y}`,
    ),
    'Z',
  ].join(' ');

const cubicPoint = (value: number, cubic: Cubic): Point => {
  const t = Math.max(0, Math.min(1, value));
  const inverse = 1 - t;

  return {
    x:
      inverse ** 3 * cubic.start.x +
      3 * inverse ** 2 * t * cubic.controlOne.x +
      3 * inverse * t ** 2 * cubic.controlTwo.x +
      t ** 3 * cubic.end.x,
    y:
      inverse ** 3 * cubic.start.y +
      3 * inverse ** 2 * t * cubic.controlOne.y +
      3 * inverse * t ** 2 * cubic.controlTwo.y +
      t ** 3 * cubic.end.y,
  };
};

const ABSTRACT_OUTER: Cubic = {
  start: {x: 72, y: 326},
  controlOne: {x: 100, y: 145},
  controlTwo: {x: 400, y: 120},
  end: {x: 444, y: 258},
};
const FINAL_OUTER: Cubic = {
  start: {x: 36, y: 342},
  controlOne: {x: 34, y: 190},
  controlTwo: {x: 390, y: 12},
  end: {x: 500, y: 160},
};

const ABSTRACT_INNER: Cubic = {
  start: {x: 118, y: 332},
  controlOne: {x: 145, y: 194},
  controlTwo: {x: 384, y: 154},
  end: {x: 438, y: 252},
};
const FINAL_INNER: Cubic = {
  start: {x: 126, y: 356},
  controlOne: {x: 112, y: 236},
  controlTwo: {x: 370, y: 70},
  end: {x: 500, y: 170},
};

const ABSTRACT_LOWER: Cubic = {
  start: {x: 92, y: 354},
  controlOne: {x: 164, y: 468},
  controlTwo: {x: 410, y: 446},
  end: {x: 470, y: 308},
};
const FINAL_LOWER: Cubic = {
  start: {x: 62, y: 388},
  controlOne: {x: 156, y: 507},
  controlTwo: {x: 412, y: 484},
  end: {x: 496, y: 370},
};

const COLLAPSED_RIBBON: ClosedPath = {
  start: {x: 252, y: 280},
  segments: [
    {controlOne: {x: 258, y: 276}, controlTwo: {x: 264, y: 275}, end: {x: 270, y: 276}},
    {controlOne: {x: 276, y: 277}, controlTwo: {x: 282, y: 278}, end: {x: 288, y: 280}},
    {controlOne: {x: 290, y: 282}, controlTwo: {x: 290, y: 286}, end: {x: 287, y: 288}},
    {controlOne: {x: 280, y: 291}, controlTwo: {x: 273, y: 292}, end: {x: 266, y: 291}},
    {controlOne: {x: 260, y: 291}, controlTwo: {x: 254, y: 289}, end: {x: 250, y: 286}},
    {controlOne: {x: 247, y: 284}, controlTwo: {x: 248, y: 282}, end: {x: 252, y: 280}},
  ],
};

const ABSTRACT_RIBBON: ClosedPath = {
  start: {x: 120, y: 296},
  segments: [
    {controlOne: {x: 176, y: 234}, controlTwo: {x: 296, y: 218}, end: {x: 402, y: 246}},
    {controlOne: {x: 420, y: 251}, controlTwo: {x: 427, y: 268}, end: {x: 412, y: 283}},
    {controlOne: {x: 366, y: 329}, controlTwo: {x: 276, y: 354}, end: {x: 188, y: 334}},
    {controlOne: {x: 158, y: 327}, controlTwo: {x: 136, y: 319}, end: {x: 116, y: 315}},
    {controlOne: {x: 98, y: 312}, controlTwo: {x: 100, y: 305}, end: {x: 120, y: 296}},
    {controlOne: {x: 120, y: 296}, controlTwo: {x: 120, y: 296}, end: {x: 120, y: 296}},
  ],
};

const FINAL_RIBBON: ClosedPath = {
  start: {x: 66, y: 340},
  segments: [
    {controlOne: {x: 101, y: 302}, controlTwo: {x: 139, y: 330}, end: {x: 178, y: 386}},
    {controlOne: {x: 218, y: 443}, controlTwo: {x: 258, y: 429}, end: {x: 306, y: 362}},
    {controlOne: {x: 356, y: 292}, controlTwo: {x: 416, y: 193}, end: {x: 489, y: 139}},
    {controlOne: {x: 502, y: 129}, controlTwo: {x: 512, y: 140}, end: {x: 502, y: 165}},
    {controlOne: {x: 465, y: 263}, controlTwo: {x: 405, y: 362}, end: {x: 333, y: 418}},
    {controlOne: {x: 274, y: 464}, controlTwo: {x: 217, y: 469}, end: {x: 168, y: 412}},
  ],
};

const FINAL_FOLD: ClosedPath = {
  start: {x: 66, y: 340},
  segments: [
    {controlOne: {x: 92, y: 317}, controlTwo: {x: 128, y: 332}, end: {x: 169, y: 378}},
    {controlOne: {x: 137, y: 358}, controlTwo: {x: 104, y: 354}, end: {x: 72, y: 371}},
    {controlOne: {x: 53, y: 382}, controlTwo: {x: 49, y: 356}, end: {x: 66, y: 340}},
    {controlOne: {x: 66, y: 340}, controlTwo: {x: 66, y: 340}, end: {x: 66, y: 340}},
    {controlOne: {x: 66, y: 340}, controlTwo: {x: 66, y: 340}, end: {x: 66, y: 340}},
    {controlOne: {x: 66, y: 340}, controlTwo: {x: 66, y: 340}, end: {x: 66, y: 340}},
  ],
};

const makeCollapsedFold = (): ClosedPath => ({
  start: COLLAPSED_RIBBON.start,
  segments: COLLAPSED_RIBBON.segments.map((segment) => ({...segment})),
});

const glowPoint = (
  point: Point,
  opacity: number,
  radius: number,
  key: string,
) => (
  <g key={key} opacity={opacity}>
    <circle cx={point.x} cy={point.y} r={radius * 3.2} fill="#FFD77A" opacity="0.28" filter="url(#course-mark-glow)" />
    <circle cx={point.x} cy={point.y} r={radius} fill="#FFD56F" />
    <circle cx={point.x - radius * 0.2} cy={point.y - radius * 0.2} r={radius * 0.34} fill="#FFFFFF" opacity="0.94" />
  </g>
);

export const CourseMark = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const orbitDraw = progress(frame, BEATS.orbitStarts, BEATS.convergeStarts + 10);
  const innerDraw = progress(frame, BEATS.orbitStarts + 10, BEATS.convergeStarts + 14);
  const lowerDraw = progress(frame, BEATS.orbitStarts + 24, BEATS.convergeStarts + 18);
  const ribbonForm = progress(frame, BEATS.stripStarts, BEATS.stripStarts + 30);
  const converge = progress(frame, BEATS.convergeStarts, BEATS.iconLocks);
  const backgroundForm = progress(frame, BEATS.stripStarts - 8, BEATS.iconLocks - 8);
  const detail = progress(frame, BEATS.convergeStarts + 15, BEATS.iconLocks + 2);

  const settle = spring({
    frame: Math.max(0, frame - BEATS.iconLocks),
    fps,
    config: {damping: 22, stiffness: 110, mass: 0.9},
    durationInFrames: 24,
  });

  const echoOne =
    progress(frame, BEATS.echoesStart, BEATS.echoesStart + 13) *
    (1 - progress(frame, BEATS.echoesStart + 18, BEATS.convergeStarts + 10));
  const echoTwo =
    progress(frame, BEATS.echoesStart + 7, BEATS.echoesStart + 21) *
    (1 - progress(frame, BEATS.echoesStart + 27, BEATS.convergeStarts + 15));

  const outer = mixCubic(ABSTRACT_OUTER, FINAL_OUTER, converge);
  const inner = mixCubic(ABSTRACT_INNER, FINAL_INNER, converge);
  const lower = mixCubic(ABSTRACT_LOWER, FINAL_LOWER, converge);

  const formedRibbon = mixClosedPath(COLLAPSED_RIBBON, ABSTRACT_RIBBON, ribbonForm);
  const ribbon = mixClosedPath(formedRibbon, FINAL_RIBBON, converge);
  const fold = mixClosedPath(makeCollapsedFold(), FINAL_FOLD, converge);

  const ribbonOpacity = progress(frame, BEATS.stripStarts, BEATS.stripStarts + 10);
  const lineWidth = mix(11, 5.5, converge);
  const orbitColor = converge < 0.55 ? '#6D8FD0' : '#7898D4';
  const mutedOrbitColor = converge < 0.55 ? '#A6B9E1' : '#8EA7D9';

  const pointSettle = progress(frame, BEATS.convergeStarts + 3, BEATS.iconLocks - 2);
  const currentPoints = [
    cubicPoint(Math.min(1, orbitDraw * 0.82), outer),
    cubicPoint(Math.min(1, innerDraw * 0.8), inner),
    cubicPoint(Math.min(1, lowerDraw * 0.9), lower),
    cubicPoint(Math.max(0, Math.min(1, lowerDraw * 0.9 - 0.28)), lower),
  ];
  const finalPoints: Point[] = [
    {x: 129, y: 88},
    {x: 337, y: 109},
    {x: 493, y: 368},
    {x: 371, y: 473},
  ];
  const points = currentPoints.map((point, index) => mixPoint(point, finalPoints[index], pointSettle));

  const iconScale = mix(0.94, 1, backgroundForm) * mix(0.992, 1, settle);
  const backgroundSize = mix(404, 512, backgroundForm);
  const backgroundOffset = (512 - backgroundSize) / 2;
  const backgroundRadius = mix(164, 102, converge);
  const titleSafeOpacity = progress(frame, BEATS.lightAppears, BEATS.lightAppears + 12);

  return (
    <svg
      viewBox="0 0 512 512"
      width="560"
      height="560"
      aria-label="课刻元素形变为正式图标"
      style={{
        overflow: 'visible',
        transform: `scale(${iconScale})`,
        opacity: titleSafeOpacity,
      }}
    >
      <defs>
        <linearGradient id="course-icon-base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#DCE2F6" />
          <stop offset="0.58" stopColor="#D0D8F0" />
          <stop offset="1" stopColor="#C5CEE9" />
        </linearGradient>
        <radialGradient id="course-icon-warmth" cx="66%" cy="54%" r="58%">
          <stop offset="0" stopColor="#FFE6A6" stopOpacity={0.5 * detail} />
          <stop offset="0.58" stopColor="#F4E8CD" stopOpacity={0.12 * detail} />
          <stop offset="1" stopColor="#D4DBEF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="course-ribbon-fill" x1="0.08" y1="0.88" x2="0.9" y2="0.12">
          <stop offset="0" stopColor="#AFC6ED" />
          <stop offset="0.18" stopColor="#F2F6FF" />
          <stop offset="0.48" stopColor="#FFFFFF" />
          <stop offset="0.67" stopColor="#FFD778" />
          <stop offset="0.84" stopColor="#F7F4E9" />
          <stop offset="1" stopColor="#C7D6F1" />
        </linearGradient>
        <linearGradient id="course-fold-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#EEF4FF" />
          <stop offset="0.46" stopColor="#9FB9E5" />
          <stop offset="1" stopColor="#5E7EBB" />
        </linearGradient>
        <filter id="course-mark-glow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="course-mark-shadow" x="-45%" y="-55%" width="190%" height="220%">
          <feDropShadow dx="0" dy="17" stdDeviation="22" floodColor="#65729A" floodOpacity={0.22 * backgroundForm} />
        </filter>
        <filter id="ribbon-shadow" x="-40%" y="-50%" width="190%" height="220%">
          <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#6F7896" floodOpacity={0.2 * detail + 0.08} />
        </filter>
      </defs>

      <circle cx="256" cy="256" r={150 + 70 * backgroundForm} fill="#D9DFF2" opacity={0.22 * (1 - backgroundForm)} filter="url(#course-mark-glow)" />

      <g filter="url(#course-mark-shadow)">
        <rect
          x={backgroundOffset}
          y={backgroundOffset}
          width={backgroundSize}
          height={backgroundSize}
          rx={backgroundRadius}
          fill="url(#course-icon-base)"
          opacity={0.26 + backgroundForm * 0.74}
        />
        <rect
          x={backgroundOffset}
          y={backgroundOffset}
          width={backgroundSize}
          height={backgroundSize}
          rx={backgroundRadius}
          fill="url(#course-icon-warmth)"
        />
        <rect
          x={backgroundOffset + 2}
          y={backgroundOffset + 2}
          width={Math.max(0, backgroundSize - 4)}
          height={Math.max(0, backgroundSize - 4)}
          rx={Math.max(0, backgroundRadius - 2)}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={4}
          opacity={0.24 + detail * 0.2}
        />
      </g>

      <path
        d={cubicPath(outer)}
        fill="none"
        stroke={mutedOrbitColor}
        strokeWidth={lineWidth}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset={1 - orbitDraw}
        opacity={0.72 + detail * 0.2}
      />
      <path
        d={cubicPath(inner)}
        fill="none"
        stroke={orbitColor}
        strokeWidth={lineWidth}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset={1 - innerDraw}
        opacity={0.82}
      />
      <path
        d={cubicPath(lower)}
        fill="none"
        stroke={orbitColor}
        strokeWidth={lineWidth}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset={1 - lowerDraw}
        opacity={0.8}
      />

      <g opacity={echoOne * 0.18} transform={`translate(0 ${mix(15, -15, echoOne)}) scale(${1 + echoOne * 0.025})`} style={{transformOrigin: '256px 310px'}}>
        <path d={closedPath(ribbon)} fill="#CAD7F0" />
      </g>
      <g opacity={echoTwo * 0.13} transform={`translate(0 ${mix(21, 17, echoTwo)}) scale(${1 - echoTwo * 0.02})`} style={{transformOrigin: '256px 310px'}}>
        <path d={closedPath(ribbon)} fill="#F9E1A6" />
      </g>

      <g opacity={ribbonOpacity} filter="url(#ribbon-shadow)">
        <path
          d={closedPath(ribbon)}
          fill="url(#course-ribbon-fill)"
          stroke="#FFFFFF"
          strokeWidth={mix(2.2, 3.2, detail)}
          strokeLinejoin="round"
        />
        <path
          d={closedPath(fold)}
          fill="url(#course-fold-fill)"
          stroke="#EDF3FF"
          strokeWidth={2.2}
          opacity={converge}
        />
        <path
          d={cubicPath({
            start: mixPoint({x: 125, y: 287}, {x: 94, y: 337}, converge),
            controlOne: mixPoint({x: 220, y: 241}, {x: 190, y: 354}, converge),
            controlTwo: mixPoint({x: 330, y: 231}, {x: 367, y: 262}, converge),
            end: mixPoint({x: 397, y: 252}, {x: 490, y: 143}, converge),
          })}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={mix(1.4, 2.8, detail)}
          strokeLinecap="round"
          opacity={0.35 + detail * 0.5}
        />
      </g>

      {points.map((point, index) =>
        glowPoint(
          point,
          progress(frame, BEATS.lightAppears + index * 7, BEATS.lightAppears + 14 + index * 7),
          mix(6.5, 7.5, detail),
          `light-${index}`,
        ),
      )}
    </svg>
  );
};
