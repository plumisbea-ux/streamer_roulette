import { uncompress } from 'snappyjs';
import type { Platform, SSAPIDonation } from '../types';

const decoder = new TextDecoder();

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function maybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function decodeSSapiPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'object' && !(payload instanceof ArrayBuffer) && !ArrayBuffer.isView(payload)) {
    return payload;
  }
  if (typeof payload === 'string') return maybeJson(payload);

  const bytes = toUint8Array(payload);
  if (!bytes) return payload;

  try {
    return maybeJson(decoder.decode(uncompress(bytes)));
  } catch {
    return maybeJson(decoder.decode(bytes));
  }
}

export function asDonation(payload: unknown): SSAPIDonation | null {
  const decoded = decodeSSapiPayload(payload);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  return decoded as SSAPIDonation;
}

export function platformMatches(selectedPlatform: Platform, actualPlatform: unknown): boolean {
  const actual = String(actualPlatform ?? '').trim().toLowerCase();
  return selectedPlatform === 'chzzk'
    ? actual === 'chzzk'
    : actual === 'soop' || actual === 'afreeca';
}
