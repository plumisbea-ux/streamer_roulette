import { motion, AnimatePresence } from 'framer-motion';
import type { RouletteItem } from '../types';
import { formatVotes } from '../lib/text';

type Props = {
  items: RouletteItem[];
  onAdjust: (id: string, delta: number) => void;
  onDelete: (id: string) => void;
};

export function RankList({ items, onAdjust, onDelete }: Props) {
  const sorted = [...items].sort((a, b) => (b.votes - a.votes) || (a.createdAt - b.createdAt));

  if (!sorted.length) {
    return <div className="empty-state">아직 선택지가 없어요.<br />후원 메시지나 수동 추가로 시작하세요.</div>;
  }

  return (
    <div className="rank-list">
      <AnimatePresence initial={false}>
        {sorted.map((item, index) => (
          <motion.div
            className="rank-row"
            key={item.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 18, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34, mass: 0.7 }}
          >
            <div className={`rank-number rank-${Math.min(index + 1, 4)}`}>{index + 1}</div>
            <div className="rank-name" title={item.label}>{item.label}</div>
            <strong className="rank-votes">{formatVotes(item.votes)}</strong>
            <div className="rank-controls" aria-label={`${item.label} 표 조정`}>
              <button type="button" className="icon-btn" onClick={() => onAdjust(item.id, -1)} disabled={item.votes <= 1} aria-label="1표 빼기">−</button>
              <button type="button" className="icon-btn" onClick={() => onAdjust(item.id, 1)} aria-label="1표 더하기">＋</button>
              <button type="button" className="icon-btn danger" onClick={() => onDelete(item.id)} aria-label="항목 삭제">×</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
