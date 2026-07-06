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

export function pickWeighted(items: RouletteItem[]): RouletteItem | null {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.votes), 0);
  if (total <= 0) return null;

  let marker = Math.random() * total;
  for (const item of items) {
    marker -= Math.max(0, item.votes);
    if (marker < 0) return item;
  }
  return items[items.length - 1] ?? null;
}

export function winnerCenterAngle(items: RouletteItem[], winnerId: string): number {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.votes), 0);
  if (total <= 0) return 0;
  let start = 0;

  for (const item of items) {
    const sweep = (Math.max(0, item.votes) / total) * 360;
    if (item.id === winnerId) return start + sweep / 2;
    start += sweep;
  }
  return 0;
}
