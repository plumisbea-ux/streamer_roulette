export function normalizeOptionName(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ko-KR')
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '');
}

export function cleanDisplayLabel(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function formatWon(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(Math.max(0, Math.floor(value)))}원`;
}

export function formatVotes(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(Math.max(0, Math.floor(value)))}표`;
}

export function shortChannelId(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 14) return trimmed || '채널 ID 미설정';
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-6)}`;
}

export function platformLabel(platform: 'chzzk' | 'soop') {
  return platform === 'chzzk' ? '치지직' : '숲';
}

export function parseChannelId(raw: string) {
  const value = raw.trim();
  if (!value) return '';

  // URL의 마지막 path segment를 우선 사용합니다.
  try {
    const url = new URL(value);
    const last = url.pathname.split('/').filter(Boolean).at(-1);
    return last ? decodeURIComponent(last) : value;
  } catch {
    return value;
  }
}
