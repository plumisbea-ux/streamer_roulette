import { useEffect, useMemo, useRef } from 'react';
import type { RouletteItem, SpinPlan } from '../types';
import { formatVotes } from '../lib/text';

type Props = {
  items: RouletteItem[];
  spinPlan: SpinPlan | null;
  onSpinFinished: (winnerId: string) => void;
};

const COLORS = ['#8b5cf6', '#f97316', '#14b8a6', '#ec4899', '#3b82f6', '#eab308', '#22c55e', '#ef4444', '#06b6d4', '#a855f7'];
const TAU = Math.PI * 2;

function totalVotes(items: RouletteItem[]) {
  return items.reduce((sum, item) => sum + Math.max(0, item.votes), 0);
}

function clampText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let output = text;
  while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
  return `${output}…`;
}

export function RouletteWheel({ items, spinPlan, onSpinFinished }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
    draw(rotationRef.current);
  });

  function draw(rotation: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(240, rect.width);
    const height = Math.max(240, rect.height);

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const source = itemsRef.current.filter((item) => item.votes > 0);
    const total = totalVotes(source);
    const size = Math.min(width, height);
    const radius = size * 0.43;
    const cx = width / 2;
    const cy = height / 2;

    // 외곽 그림자
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 9, 0, TAU);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.20)';
    ctx.fill();
    ctx.restore();

    if (!source.length || !total) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
      ctx.fillStyle = '#64748b';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('후원 또는 수동 추가를 기다리는 중', cx, cy + 5);
      ctx.restore();
      return;
    }

    let angle = -Math.PI / 2 + rotation;
    source.forEach((item, index) => {
      const slice = (item.votes / total) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = COLORS[index % COLORS.length];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();

      const center = angle + slice / 2;
      const textRadius = radius * 0.63;
      const tx = cx + Math.cos(center) * textRadius;
      const ty = cy + Math.sin(center) * textRadius;
      const maxTextWidth = Math.max(56, radius * Math.min(0.9, slice / 1.35));

      ctx.save();
      ctx.translate(tx, ty);
      let readableAngle = center;
      if (readableAngle > Math.PI / 2 && readableAngle < (Math.PI * 3) / 2) readableAngle += Math.PI;
      ctx.rotate(readableAngle);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.32)';
      ctx.shadowBlur = 3;
      ctx.font = `800 ${Math.max(11, Math.min(17, radius / 13))}px system-ui, sans-serif`;
      ctx.fillText(clampText(ctx, item.label, maxTextWidth), 0, -3);
      ctx.font = `700 ${Math.max(9, Math.min(13, radius / 17))}px system-ui, sans-serif`;
      ctx.fillText(formatVotes(item.votes), 0, 14);
      ctx.restore();

      angle += slice;
    });

    // 중앙 캡
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.18, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#1e1b4b';
    ctx.stroke();
    ctx.fillStyle = '#1e1b4b';
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.max(12, radius / 12)}px system-ui, sans-serif`;
    ctx.fillText('GO!', cx, cy + 5);

    // 상단 포인터
    ctx.save();
    ctx.translate(cx, cy - radius - 5);
    ctx.beginPath();
    ctx.moveTo(0, 27);
    ctx.lineTo(-16, -8);
    ctx.lineTo(16, -8);
    ctx.closePath();
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  useEffect(() => {
    const redraw = () => draw(rotationRef.current);
    window.addEventListener('resize', redraw);
    redraw();
    return () => window.removeEventListener('resize', redraw);
  }, []);

  useEffect(() => {
    if (!spinPlan) return;

    const source = spinPlan.items.filter((item) => item.votes > 0);
    const total = totalVotes(source);
    const winnerIndex = source.findIndex((item) => item.id === spinPlan.winnerId);
    if (!source.length || !total || winnerIndex < 0) return;

    const cumulativeVotes = source.slice(0, winnerIndex).reduce((sum, item) => sum + item.votes, 0);
    const winner = source[winnerIndex];
    const slice = (winner.votes / total) * TAU;
    const winnerCenter = -Math.PI / 2 + ((cumulativeVotes / total) * TAU) + slice / 2;
    const desiredMod = ((-Math.PI / 2 - winnerCenter) % TAU + TAU) % TAU;
    const start = rotationRef.current;
    const startMod = ((start % TAU) + TAU) % TAU;
    const extra = (desiredMod - startMod + TAU) % TAU;
    const destination = start + TAU * 8 + extra;
    const duration = 5000;
    const startedAt = performance.now();

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      rotationRef.current = start + (destination - start) * eased;
      draw(rotationRef.current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        rotationRef.current = destination;
        frameRef.current = null;
        onSpinFinished(spinPlan.winnerId);
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [spinPlan?.id]);

  const summary = useMemo(() => {
    const active = items.filter((item) => item.votes > 0);
    return { count: active.length, total: totalVotes(active) };
  }, [items]);

  return (
    <div className="wheel-wrap">
      <canvas ref={canvasRef} className="roulette-canvas" aria-label="가중치 룰렛" />
      <div className="wheel-summary">
        <span>선택지 {summary.count}개</span>
        <strong>총 {formatVotes(summary.total)}</strong>
      </div>
    </div>
  );
}
