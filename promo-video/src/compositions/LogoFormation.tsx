import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {CourseMark} from '../components/CourseMark';
import {BEATS, PALETTE} from '../timing';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

export const LogoFormation = () => {
  const frame = useCurrentFrame();

  const titleProgress = interpolate(
    frame,
    [BEATS.titleStarts, BEATS.titleStarts + 18],
    [0, 1],
    {...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1)},
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: PALETTE.background,
        color: PALETTE.ink,
        fontFamily:
          'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
      }}
    >
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${interpolate(titleProgress, [0, 1], [24, -42])}px)`,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 560,
            height: 560,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <CourseMark />
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 790,
          textAlign: 'center',
          opacity: titleProgress,
          transform: `translateY(${interpolate(titleProgress, [0, 1], [18, 0])}px)`,
        }}
      >
        <div style={{fontSize: 54, fontWeight: 650, letterSpacing: '0.08em'}}>课刻</div>
        <div
          style={{
            marginTop: 18,
            fontSize: 25,
            fontWeight: 400,
            letterSpacing: '0.12em',
            color: '#637080',
          }}
        >
          让一天在桌面上缓慢流动
        </div>
      </div>
    </AbsoluteFill>
  );
};
