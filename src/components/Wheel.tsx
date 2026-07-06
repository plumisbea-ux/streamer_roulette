import type { CSSProperties } from 'react';
import type { RouletteItem } from '../types';

const COLORS = ['#1f5eff', '#00a57a', '#ee8a1c', '#7446e8', '#d54270', '#1686a7', '#7b8f29', '#b85223'];

type WheelProps = {
  items: RouletteItem[];
  rotation: number;
  spinning: boolean;
  tickId: number;
};

type Segment = {
  item: RouletteItem;
  start: number;
  end: number;
  sweep: number;
};

const FIXED_LABEL_SIZE = 4.25;

function displayLabel(label: string): string {
  const compact = label.trim();
  const limit = 14;
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

export function Wheel({ items, rotation, spinning, tickId }: WheelProps) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.votes), 0);
  let cursor = 0;
  const segments: Segment[] = items.map((item) => {
    const start = cursor;
    const end = cursor + (total > 0 ? (Math.max(0, item.votes) / total) * 360 : 0);
    cursor = end;
    return { item, start, end, sweep: end - start };
  });

  const style: CSSProperties = {
    background: segments.length
      ? `conic-gradient(${segments.map((segment, index) => `${COLORS[index % COLORS.length]} ${segment.start}deg ${segment.end}deg`).join(', ')})`
      : '#eef1f5',
    transform: `rotate(${rotation}deg)`,
  };

  return (
    <div className={`wheel-wrap ${spinning ? 'is-spinning' : ''}`} aria-label="가중치 룰렛">
      <div className="wheel-stage">
        <div className="wheel-halo" aria-hidden="true" />
        <div className="wheel-orbit orbit-one" aria-hidden="true" />
        <div className="wheel-orbit orbit-two" aria-hidden="true" />
        <div className="wheel-pointer" aria-hidden="true">
          <span className="pointer-pin" />
          <span key={tickId} className={`pointer-flap ${spinning && tickId > 0 ? 'is-ticking' : ''}`}>
            <span className="pointer-arrow" />
          </span>
        </div>
        <div className="wheel-rim" aria-hidden="true" />
        <div className="wheel" style={style}>
          <svg className="wheel-label-layer" viewBox="0 0 100 100" aria-hidden="true">
            {segments.map((segment) => {
              const middle = segment.start + segment.sweep / 2;
              const radians = (middle * Math.PI) / 180;
              // 각 텍스트는 중심에 가까운 곳에서 시작해 바깥쪽으로 뻗습니다.
              const innerRadius = 20.5;
              const x = 50 + Math.sin(radians) * innerRadius;
              const y = 50 - Math.cos(radians) * innerRadius;
              const radialTextRotation = middle - 90;

              return (
                <text
                  key={segment.item.id}
                  className="wheel-label"
                  x={x}
                  y={y}
                  fontSize={FIXED_LABEL_SIZE}
                  textAnchor="start"
                  transform={`rotate(${radialTextRotation} ${x} ${y})`}
                >
                  <title>{segment.item.label}</title>
                  {displayLabel(segment.item.label)}
                </text>
              );
            })}
          </svg>
          <div className="wheel-center">
            <span>{spinning ? 'SPIN' : 'LUCKY'}</span>
            <strong>{spinning ? '…' : 'GO'}</strong>
          </div>
        </div>
        <div className="wheel-spark spark-a" aria-hidden="true">✦</div>
        <div className="wheel-spark spark-b" aria-hidden="true">✦</div>
        <div className="wheel-spark spark-c" aria-hidden="true">✦</div>
      </div>
      <div className="wheel-caption" aria-live="polite">
        {spinning ? '감속 중… 핀이 칸을 고르고 있습니다' : items.length ? `${items.length}개 선택지 · ${total.toLocaleString('ko-KR')}표` : '선택지를 추가하세요'}
      </div>
    </div>
  );
}
