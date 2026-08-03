import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import {CourseMark} from '../components/CourseMark';
import {BEATS, PALETTE} from '../timing';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

export const LogoFormation = () => {
  const frame = useCurrentFrame();

  const vectorOpacity = interpolate(
    frame,
    [BEATS.officialIconCrossfade - 4, BEATS.officialIconCrossfade + 16],
    [1, 0],
    clamp,
  );
  const officialOpacity = interpolate(
    frame,
    [BEATS.officialIconCrossfade, BEATS.officialIconCrossfade + 14],
    [0, 1],
    {...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1)},
  );
  const officialScale = interpolate(
    frame,
    [BEATS.officialIconCrossfade, BEATS.officialIconCrossfade + 18],
    [0.96, 1],
    {...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1)},
  );
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
          <div style={{position: 'absolute', opacity: vectorOpacity}}>
            <CourseMark />
          </div>
          <Img
            src={staticFile('course-icon.png')}
            style={{
              position: 'absolute',
              width: 420,
              height: 420,
              objectFit: 'contain',
              opacity: officialOpacity,
              transform: `scale(${officialScale})`,
              filter: 'drop-shadow(0 24px 36px rgba(33, 42, 52, 0.12))',
            }}
          />
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
