import type { CSSProperties } from 'react';
import type { RouletteItem } from '../types';

const COLORS = ['#1f5eff', '#00a57a', '#ee8a1c', '#7446e8', '#d54270', '#1686a7', '#7b8f29', '#b85223'];

type WheelProps = {
  items: RouletteItem[];
  rotation: number;
  spinning: boolean;
};

export function Wheel({ items, rotation, spinning }: WheelProps) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.votes), 0);
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    const end = cursor + (total > 0 ? (Math.max(0, item.votes) / total) * 360 : 0);
    cursor = end;
    return `${COLORS[index % COLORS.length]} ${start}deg ${end}deg`;
  });

  const style: CSSProperties = {
    background: segments.length ? `conic-gradient(${segments.join(', ')})` : '#eef1f5',
    transform: `rotate(${rotation}deg)`,
  };

  return (
    <div className={`wheel-wrap ${spinning ? 'is-spinning' : ''}`} aria-label="가중치 룰렛">
      <div className="wheel-stage">
        <div className="wheel-halo" aria-hidden="true" />
        <div className="wheel-orbit orbit-one" aria-hidden="true" />
        <div className="wheel-orbit orbit-two" aria-hidden="true" />
        <div className="wheel-pointer" aria-hidden="true" />
        <div className="wheel-rim" aria-hidden="true" />
        <div className="wheel" style={style}>
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
        {spinning ? '운명을 고르는 중…' : items.length ? `${items.length}개 선택지 · ${total.toLocaleString('ko-KR')}표` : '선택지를 추가하세요'}
      </div>
    </div>
  );
}
