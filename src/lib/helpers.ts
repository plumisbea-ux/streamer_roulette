import type { Platform, RouletteItem } from '../types';

export function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function cleanLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeName(value: string): string {
  return cleanLabel(value)
    .toLocaleLowerCase('ko-KR')
    .replace(/[\s\p{P}\p{S}_]+/gu, '');
}

export function parseChannelId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const liveMatch = url.pathname.match(/\/live\/([^/?#]+)/i);
    if (liveMatch?.[1]) return liveMatch[1];
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const pathPart = pathSegments[pathSegments.length - 1];
    if (pathPart) return pathPart;
  } catch {
    // URL이 아닌 일반 채널 ID는 그대로 사용합니다.
  }

  const inlineMatch = trimmed.match(/\/live\/([^/?#]+)/i);
  return inlineMatch?.[1] ?? trimmed;
}

export function platformLabel(platform: Platform): string {
  return platform === 'chzzk' ? '치지직' : '숲';
}

export function formatVotes(value: number): string {
  return `${Math.max(0, Math.floor(value)).toLocaleString('ko-KR')}표`;
}

export function formatMoney(value: number): string {
  return `${Math.max(0, Math.floor(value)).toLocaleString('ko-KR')}원`;
}

export type WeightedPick = {
  winner: RouletteItem;
  /** 당첨 구역 안에서 실제로 멈출 각도(0~360도) */
  targetAngle: number;
};

function randomUnit(): number {
  // 가능한 브라우저에서는 Math.random()보다 예측하기 어려운 난수를 사용합니다.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / 4_294_967_296;
  }
  return Math.random();
}

/**
 * 표 수를 확률 가중치로 사용해 한 표를 무작위로 뽑습니다.
 * 선택지만 고르는 것이 아니라 그 선택지의 부채꼴 안에서 멈출 위치까지 같이 뽑습니다.
 */
export function pickWeightedPosition(items: RouletteItem[]): WeightedPick | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.votes), 0);
  if (total <= 0) return null;

  const marker = randomUnit() * total;
  let accumulatedVotes = 0;

  for (const item of items) {
    const votes = Math.max(0, item.votes);
    if (votes <= 0) continue;

    if (marker < accumulatedVotes + votes) {
      const fractionInSegment = (marker - accumulatedVotes) / votes;
      const startAngle = (accumulatedVotes / total) * 360;
      const sweepAngle = (votes / total) * 360;
      return {
        winner: item,
        targetAngle: startAngle + sweepAngle * fractionInSegment,
      };
    }

    accumulatedVotes += votes;
  }

  const winner = items[items.length - 1];
  if (!winner) return null;
  return { winner, targetAngle: 359.999999 };
}
