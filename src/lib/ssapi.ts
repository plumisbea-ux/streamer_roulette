import { uncompress } from 'snappyjs';
import type { Platform, SSAPIDonation } from '../types';

const decoder = new TextDecoder();

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function maybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * SSAPI 문서상 Socket 이벤트 payload는 Snappy 압축된 JSON입니다.
 * 테스트·버전 차이로 객체/문자열이 직접 들어오는 경우도 방어적으로 처리합니다.
 */
export function decodeSSapiPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'object' && !(payload instanceof ArrayBuffer) && !ArrayBuffer.isView(payload)) return payload;
  if (typeof payload === 'string') return maybeJson(payload);

  const bytes = toUint8Array(payload);
  if (!bytes) return payload;

  try {
    const decompressed = uncompress(bytes);
    return maybeJson(decoder.decode(decompressed));
  } catch {
    // 서버가 압축하지 않은 JSON byte array를 보내는 경우도 대비합니다.
    return maybeJson(decoder.decode(bytes));
  }
}

export function asDonation(payload: unknown): SSAPIDonation | null {
  const decoded = decodeSSapiPayload(payload);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  return decoded as SSAPIDonation;
}

export function platformMatches(selectedPlatform: Platform, actualPlatform: unknown) {
  const actual = String(actualPlatform ?? '').trim().toLowerCase();
  if (selectedPlatform === 'chzzk') return actual === 'chzzk';
  // SSAPI 문서와 구 버전/대시보드 표현 차이를 모두 수용합니다.
  return actual === 'soop' || actual === 'afreeca';
}
