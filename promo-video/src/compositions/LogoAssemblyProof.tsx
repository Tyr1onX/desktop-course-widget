import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const ease = Easing.bezier(0.22, 1, 0.36, 1);
const progress = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {...clamp, easing: ease});
const mix = (from: number, to: number, value: number) =>
  from + (to - from) * value;

type Point = {x: number; y: number};
type Cubic = {
  start: Point;
  controlOne: Point;
  controlTwo: Point;
  end: Point;
};

type Slice = {
  startX: number;
  endX: number;
  frame: number;
  dx: number;
  dy: number;
  rotation: number;
};

const cubicPoint = (curve: Cubic, value: number): Point => {
  const t = Math.max(0, Math.min(1, value));
  const inverse = 1 - t;

  return {
    x:
      inverse ** 3 * curve.start.x +
      3 * inverse ** 2 * t * curve.controlOne.x +
      3 * inverse * t ** 2 * curve.controlTwo.x +
      t ** 3 * curve.end.x,
    y:
      inverse ** 3 * curve.start.y +
      3 * inverse ** 2 * t * curve.controlOne.y +
      3 * inverse * t ** 2 * curve.controlTwo.y +
      t ** 3 * curve.end.y,
  };
};

const ORBITS: Array<{curve: Cubic; path: string; color: string; width: number; start: number}> = [
  {
    curve: {
      start: {x: 36, y: 342},
      controlOne: {x: 34, y: 190},
      controlTwo: {x: 390, y: 12},
      end: {x: 500, y: 160},
    },
    path: 'M 36 342 C 34 190 390 12 500 160',
    color: '#7795D2',
    width: 5.6,
    start: 4,
  },
  {
    curve: {
      start: {x: 126, y: 356},
      controlOne: {x: 112, y: 236},
      controlTwo: {x: 370, y: 70},
      end: {x: 500, y: 170},
    },
    path: 'M 126 356 C 112 236 370 70 500 170',
    color: '#94A9D8',
    width: 4.5,
    start: 10,
  },
  {
    curve: {
      start: {x: 62, y: 388},
      controlOne: {x: 156, y: 507},
      controlTwo: {x: 412, y: 484},
      end: {x: 496, y: 370},
    },
    path: 'M 62 388 C 156 507 412 484 496 370',
    color: '#819ED5',
    width: 5.2,
    start: 18,
  },
];

const FINAL_LIGHTS: Point[] = [
  {x: 129, y: 88},
  {x: 337, y: 109},
  {x: 493, y: 368},
  {x: 371, y: 473},
];

const RIBBON_SLICES: Slice[] = [
  {startX: 0, endX: 72, frame: 24, dx: -92, dy: 42, rotation: -18},
  {startX: 72, endX: 140, frame: 27, dx: -54, dy: -66, rotation: 13},
  {startX: 140, endX: 208, frame: 30, dx: 18, dy: 88, rotation: -11},
  {startX: 208, endX: 276, frame: 33, dx: -12, dy: -94, rotation: 9},
  {startX: 276, endX: 344, frame: 36, dx: 46, dy: 82, rotation: -8},
  {startX: 344, endX: 412, frame: 39, dx: 78, dy: -62, rotation: 11},
  {startX: 412, endX: 466, frame: 42, dx: 96, dy: 38, rotation: -12},
  {startX: 466, endX: 512, frame: 45, dx: 72, dy: -86, rotation: 16},
];

const FullImage = ({src, opacity = 1}: {src: string; opacity?: number}) => (
  <Img
    src={src}
    style={{
      position: 'absolute',
      inset: 0,
      width: 512,
      height: 512,
      opacity,
    }}
  />
);

const BasePlate = ({frame, opacity}: {frame: number; opacity: number}) => {
  const panelProgress = progress(frame, 0, 28);
  const offsets = [
    {clipPath: 'inset(0 50% 50% 0)', x: -28, y: -22},
    {clipPath: 'inset(0 0 50% 50%)', x: 28, y: -22},
    {clipPath: 'inset(50% 50% 0 0)', x: -28, y: 22},
    {clipPath: 'inset(50% 0 0 50%)', x: 28, y: 22},
  ];

  return (
    <div style={{position: 'absolute', inset: 0, opacity}}>
      {offsets.map((panel, index) => (
        <div
          key={panel.clipPath}
          style={{
            position: 'absolute',
            inset: 18,
            borderRadius: 104,
            background:
              'radial-gradient(circle at 72% 26%, rgba(255,255,255,0.82), rgba(255,255,255,0) 35%), linear-gradient(145deg, #E3E7F7 0%, #D5DCF2 52%, #C9D3EE 100%)',
            boxShadow:
              index === 3
                ? '0 28px 50px rgba(77, 91, 132, 0.16), inset 0 1px 1px rgba(255,255,255,0.82)'
                : 'inset 0 1px 1px rgba(255,255,255,0.82)',
            clipPath: panel.clipPath,
            filter: `blur(${mix(9, 0, panelProgress)}px)`,
            opacity: progress(frame, index * 2, 11 + index * 2),
            transform: `translate(${mix(panel.x, 0, panelProgress)}px, ${mix(
              panel.y,
              0,
              panelProgress,
            )}px) scale(${mix(0.93, 1, panelProgress)})`,
          }}
        />
      ))}
    </div>
  );
};

const OrbitLayer = ({frame, opacity}: {frame: number; opacity: number}) => (
  <svg
    viewBox="0 0 512 512"
    width={512}
    height={512}
    style={{position: 'absolute', inset: 0, overflow: 'visible', opacity}}
  >
    <defs>
      <filter id="assembly-glow" x="-300%" y="-300%" width="600%" height="600%">
        <feGaussianBlur stdDeviation="7" />
      </filter>
    </defs>
    {ORBITS.map((orbit, index) => {
      const draw = progress(frame, orbit.start, orbit.start + 34);
      const trail = progress(frame, orbit.start + 8, orbit.start + 29);

      return (
        <g key={orbit.path}>
          <path
            d={orbit.path}
            fill="none"
            pathLength={1}
            stroke={orbit.color}
            strokeLinecap="round"
            strokeWidth={orbit.width + 4}
            strokeDasharray="1"
            strokeDashoffset={1 - draw}
            opacity={0.1 * trail}
            filter="url(#assembly-glow)"
          />
          <path
            d={orbit.path}
            fill="none"
            pathLength={1}
            stroke={orbit.color}
            strokeLinecap="round"
            strokeWidth={orbit.width}
            strokeDasharray="1"
            strokeDashoffset={1 - draw}
            opacity={0.68 + index * 0.08}
          />
        </g>
      );
    })}
  </svg>
);

const MovingLights = ({frame, opacity}: {frame: number; opacity: number}) => {
  const lights = [
    {orbit: 0, start: 3, final: 0},
    {orbit: 1, start: 11, final: 1},
    {orbit: 2, start: 19, final: 2},
    {orbit: 2, start: 26, final: 3},
  ];

  return (
    <svg
      viewBox="0 0 512 512"
      width={512}
      height={512}
      style={{position: 'absolute', inset: 0, overflow: 'visible', opacity}}
    >
      <defs>
        <filter id="light-blur" x="-500%" y="-500%" width="1000%" height="1000%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      {lights.map((light, index) => {
        const travel = progress(frame, light.start, 57 + index * 2);
        const onCurve = cubicPoint(ORBITS[light.orbit].curve, Math.min(0.92, travel * 0.94));
        const lock = progress(frame, 52 + index, 68 + index);
        const final = FINAL_LIGHTS[light.final];
        const point = {
          x: mix(onCurve.x, final.x, lock),
          y: mix(onCurve.y, final.y, lock),
        };
        const visible = progress(frame, light.start, light.start + 7);
        const pulse = 1 + Math.sin((frame + index * 7) * 0.24) * 0.08 * (1 - lock);

        return (
          <g key={`${light.orbit}-${index}`} opacity={visible}>
            <circle
              cx={point.x}
              cy={point.y}
              r={20 * pulse}
              fill="#FFD36A"
              opacity={0.28}
              filter="url(#light-blur)"
            />
            <circle cx={point.x} cy={point.y} r={7.2 * pulse} fill="#FFD56F" />
            <circle cx={point.x - 1.5} cy={point.y - 1.5} r={2.3} fill="#FFFFFF" opacity={0.96} />
          </g>
        );
      })}
    </svg>
  );
};

const RibbonAssembly = ({frame, opacity}: {frame: number; opacity: number}) => {
  const source = staticFile('logo-layers/ribbon-main.png');

  return (
    <div style={{position: 'absolute', inset: 0, opacity}}>
      {RIBBON_SLICES.map((slice, index) => {
        const arrive = progress(frame, slice.frame, slice.frame + 24);
        const appear = progress(frame, slice.frame, slice.frame + 6);
        const width = slice.endX - slice.startX;

        return (
          <div
            key={`${slice.startX}-${slice.endX}`}
            style={{
              position: 'absolute',
              left: slice.startX,
              top: 0,
              width,
              height: 512,
              overflow: 'hidden',
              opacity: appear,
              filter: `blur(${mix(5.5, 0, arrive)}px)`,
              transform: `translate(${mix(slice.dx, 0, arrive)}px, ${mix(
                slice.dy,
                0,
                arrive,
              )}px) rotate(${mix(slice.rotation, 0, arrive)}deg) scale(${mix(
                0.86 + index * 0.008,
                1,
                arrive,
              )})`,
              transformOrigin: `${width / 2}px 256px`,
            }}
          >
            <Img
              src={source}
              style={{
                position: 'absolute',
                left: -slice.startX,
                top: 0,
                width: 512,
                height: 512,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export const LogoAssemblyProof = () => {
  const frame = useCurrentFrame();
  const original = staticFile('logo-source/icon-original.png');
  const finalBlend = progress(frame, 74, 84);
  const assemblyOpacity = 1 - progress(frame, 78, 84);
  const glint =
    progress(frame, 68, 75) * (1 - progress(frame, 78, 84));

  if (frame >= 84) {
    return (
      <AbsoluteFill style={{backgroundColor: '#F4F6F8'}}>
        <FullImage src={original} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        backgroundColor: '#F4F6F8',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 512,
          height: 512,
          transform: `scale(${mix(0.965, 1, progress(frame, 0, 32))})`,
        }}
      >
        <BasePlate frame={frame} opacity={assemblyOpacity} />
        <OrbitLayer frame={frame} opacity={assemblyOpacity} />
        <MovingLights frame={frame} opacity={assemblyOpacity} />
        <RibbonAssembly frame={frame} opacity={assemblyOpacity} />

        <div
          style={{
            position: 'absolute',
            inset: -120,
            opacity: glint,
            transform: `translateX(${mix(-420, 420, progress(frame, 68, 84))}px) rotate(-18deg)`,
            background:
              'linear-gradient(90deg, rgba(255,255,255,0) 38%, rgba(255,255,255,0.72) 50%, rgba(255,255,255,0) 62%)',
            mixBlendMode: 'screen',
            pointerEvents: 'none',
          }}
        />

        <FullImage src={original} opacity={finalBlend} />
      </div>
    </AbsoluteFill>
  );
};
