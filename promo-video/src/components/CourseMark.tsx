import {
  Easing,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
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

const cubicPoint = (
  value: number,
  start: Point,
  controlOne: Point,
  controlTwo: Point,
  end: Point,
): Point => {
  const t = Math.max(0, Math.min(1, value));
  const inverse = 1 - t;

  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * controlOne.x +
      3 * inverse * t ** 2 * controlTwo.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * controlOne.y +
      3 * inverse * t ** 2 * controlTwo.y +
      t ** 3 * end.y,
  };
};

const OFFICIAL_ICON = staticFile('course-icon.png');

const OUTER_ORBIT =
  'M 14 315 C 58 158 260 28 430 55 C 490 64 517 98 503 152';
const INNER_ORBIT =
  'M 104 338 C 112 222 248 112 390 99 C 452 93 498 111 510 158';
const LOWER_ORBIT =
  'M 34 386 C 117 486 316 503 450 414 C 496 383 518 338 501 291';
const RIBBON_CENTER =
  'M 4 356 C 55 304 98 367 148 420 C 194 469 253 454 305 389 C 360 319 414 218 516 139';

export const CourseMark = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const background = progress(frame, BEATS.lightAppears - 3, BEATS.orbitStarts + 8);
  const outerOrbit = progress(frame, BEATS.orbitStarts, BEATS.iconLocks - 25);
  const innerOrbit = progress(frame, BEATS.orbitStarts + 11, BEATS.iconLocks - 17);
  const lowerOrbit = progress(frame, BEATS.orbitStarts + 26, BEATS.iconLocks - 8);
  const ribbon = progress(frame, BEATS.stripStarts, BEATS.iconLocks - 12);
  const lights = progress(frame, BEATS.lightAppears + 8, BEATS.iconLocks - 4);
  const completion = progress(frame, BEATS.iconLocks - 6, BEATS.iconLocks + 12);

  const settle = spring({
    frame: Math.max(0, frame - BEATS.iconLocks),
    fps,
    config: {damping: 20, stiffness: 105, mass: 0.85},
    durationInFrames: 24,
  });

  const echoOne =
    progress(frame, BEATS.echoesStart, BEATS.echoesStart + 14) *
    (1 - progress(frame, BEATS.echoesStart + 18, BEATS.echoesStart + 34));
  const echoTwo =
    progress(frame, BEATS.echoesStart + 8, BEATS.echoesStart + 22) *
    (1 - progress(frame, BEATS.echoesStart + 27, BEATS.echoesStart + 42));

  const leadPoint = cubicPoint(
    outerOrbit,
    {x: 14, y: 315},
    {x: 58, y: 158},
    {x: 260, y: 28},
    {x: 503, y: 152},
  );
  const secondaryPoint = cubicPoint(
    innerOrbit,
    {x: 104, y: 338},
    {x: 112, y: 222},
    {x: 390, y: 99},
    {x: 510, y: 158},
  );

  const markScale = interpolate(background, [0, 1], [0.94, 1]) *
    interpolate(settle, [0, 1], [0.992, 1]);
  const constructionOpacity = 1 - completion;

  return (
    <svg
      viewBox="0 0 512 512"
      width="560"
      height="560"
      aria-label="课刻正式图标逐层形成动画"
      style={{
        overflow: 'visible',
        transform: `scale(${markScale})`,
        opacity: background,
      }}
    >
      <defs>
        <linearGradient id="course-icon-base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#D8DDF3" />
          <stop offset="0.55" stopColor="#CFD6F0" />
          <stop offset="1" stopColor="#C6CDE9" />
        </linearGradient>
        <radialGradient id="course-icon-warmth" cx="66%" cy="53%" r="58%">
          <stop offset="0" stopColor="#FFE9B1" stopOpacity="0.38" />
          <stop offset="0.62" stopColor="#E5E9F5" stopOpacity="0.08" />
          <stop offset="1" stopColor="#D3D9EF" stopOpacity="0" />
        </radialGradient>
        <filter id="course-mark-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="11" />
        </filter>
        <filter id="course-mark-shadow" x="-35%" y="-45%" width="170%" height="200%">
          <feDropShadow dx="0" dy="20" stdDeviation="24" floodColor="#65729A" floodOpacity="0.22" />
        </filter>
        <clipPath id="course-icon-clip">
          <rect x="0" y="0" width="512" height="512" rx="102" />
        </clipPath>

        <mask id="outer-orbit-mask">
          <rect width="512" height="512" fill="black" />
          <path
            d={OUTER_ORBIT}
            fill="none"
            stroke="white"
            strokeWidth="34"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - outerOrbit}
          />
        </mask>
        <mask id="inner-orbit-mask">
          <rect width="512" height="512" fill="black" />
          <path
            d={INNER_ORBIT}
            fill="none"
            stroke="white"
            strokeWidth="34"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - innerOrbit}
          />
        </mask>
        <mask id="lower-orbit-mask">
          <rect width="512" height="512" fill="black" />
          <path
            d={LOWER_ORBIT}
            fill="none"
            stroke="white"
            strokeWidth="38"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - lowerOrbit}
          />
        </mask>
        <mask id="ribbon-mask">
          <rect width="512" height="512" fill="black" />
          <path
            d={RIBBON_CENTER}
            fill="none"
            stroke="white"
            strokeWidth="194"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - ribbon}
          />
        </mask>
        <mask id="light-mask">
          <rect width="512" height="512" fill="black" />
          <circle cx="129" cy="86" r={38 * lights} fill="white" />
          <circle cx="336" cy="107" r={36 * lights} fill="white" />
          <circle cx="500" cy="383" r={38 * lights} fill="white" />
          <circle cx="361" cy="491" r={38 * lights} fill="white" />
        </mask>
      </defs>

      <g clipPath="url(#course-icon-clip)" filter="url(#course-mark-shadow)">
        <rect width="512" height="512" rx="102" fill="url(#course-icon-base)" />
        <rect width="512" height="512" rx="102" fill="url(#course-icon-warmth)" />

        <image
          href={OFFICIAL_ICON}
          width="512"
          height="512"
          preserveAspectRatio="xMidYMid slice"
          mask="url(#outer-orbit-mask)"
        />
        <image
          href={OFFICIAL_ICON}
          width="512"
          height="512"
          preserveAspectRatio="xMidYMid slice"
          mask="url(#inner-orbit-mask)"
        />
        <image
          href={OFFICIAL_ICON}
          width="512"
          height="512"
          preserveAspectRatio="xMidYMid slice"
          mask="url(#lower-orbit-mask)"
        />

        <g opacity={echoOne * 0.22} transform="translate(0 -18)">
          <image
            href={OFFICIAL_ICON}
            width="512"
            height="512"
            preserveAspectRatio="xMidYMid slice"
            mask="url(#ribbon-mask)"
          />
        </g>
        <g opacity={echoTwo * 0.16} transform="translate(0 20)">
          <image
            href={OFFICIAL_ICON}
            width="512"
            height="512"
            preserveAspectRatio="xMidYMid slice"
            mask="url(#ribbon-mask)"
          />
        </g>
        <image
          href={OFFICIAL_ICON}
          width="512"
          height="512"
          preserveAspectRatio="xMidYMid slice"
          mask="url(#ribbon-mask)"
        />
        <image
          href={OFFICIAL_ICON}
          width="512"
          height="512"
          preserveAspectRatio="xMidYMid slice"
          mask="url(#light-mask)"
        />

        <image
          href={OFFICIAL_ICON}
          width="512"
          height="512"
          preserveAspectRatio="xMidYMid slice"
          opacity={completion}
        />
      </g>

      <rect
        x="2"
        y="2"
        width="508"
        height="508"
        rx="100"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="4"
        opacity={0.52 * (1 - completion) + 0.16}
      />

      <g opacity={constructionOpacity}>
        <circle
          cx={leadPoint.x}
          cy={leadPoint.y}
          r="28"
          fill={PALETTE.accent}
          opacity={0.3 * outerOrbit}
          filter="url(#course-mark-glow)"
        />
        <circle cx={leadPoint.x} cy={leadPoint.y} r="8" fill={PALETTE.accent} opacity={outerOrbit} />
        <circle cx={leadPoint.x - 2} cy={leadPoint.y - 2} r="2.8" fill="#FFFFFF" opacity={outerOrbit} />

        <circle
          cx={secondaryPoint.x}
          cy={secondaryPoint.y}
          r="18"
          fill={PALETTE.accent}
          opacity={0.18 * innerOrbit}
          filter="url(#course-mark-glow)"
        />
        <circle
          cx={secondaryPoint.x}
          cy={secondaryPoint.y}
          r="5.5"
          fill={PALETTE.accent}
          opacity={0.72 * innerOrbit}
        />
      </g>
    </svg>
  );
};
