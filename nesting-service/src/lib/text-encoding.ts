import { TextDecoder } from 'node:util';

const windows1251Decoder = new TextDecoder('windows-1251');
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const WINDOWS_1252_TO_BYTE: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

const CYRILLIC_RE = /[А-Яа-яЁё]/;
const MOJIBAKE_HIGH_RE = /[À-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

export function normalizeCadText(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  return repairWindows1251Mojibake(trimmed) ?? value;
}

function repairWindows1251Mojibake(value: string): string | null {
  if (CYRILLIC_RE.test(value) || !MOJIBAKE_HIGH_RE.test(value)) {
    return null;
  }

  const encoded = encodeSingleByteText(value);

  if (!encoded || encoded.highByteCount < 2) {
    return null;
  }

  const utf8Decoded = decodeUtf8(encoded.bytes);
  if (utf8Decoded && looksLikeCyrillicName(utf8Decoded)) {
    return utf8Decoded;
  }

  const decoded = windows1251Decoder.decode(encoded.bytes).trim();

  if (!looksLikeCyrillicName(decoded)) {
    return null;
  }

  return decoded;
}

function encodeSingleByteText(value: string): { bytes: Uint8Array; highByteCount: number } | null {
  const bytes: number[] = [];
  let highByteCount = 0;

  for (const char of value) {
    const code = char.codePointAt(0);

    if (code === undefined) {
      return null;
    }

    if (code <= 0xff) {
      bytes.push(code);
      if (code >= 0x80) {
        highByteCount += 1;
      }
      continue;
    }

    const mapped = WINDOWS_1252_TO_BYTE[char];
    if (mapped === undefined) {
      return null;
    }

    bytes.push(mapped);
    highByteCount += 1;
  }

  return { bytes: Uint8Array.from(bytes), highByteCount };
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return utf8Decoder.decode(bytes).trim();
  } catch {
    return null;
  }
}

function looksLikeCyrillicName(value: string): boolean {
  let cyrillicCount = 0;
  let latinCount = 0;

  for (const char of value) {
    if (/[А-Яа-яЁё]/.test(char)) {
      cyrillicCount += 1;
    } else if (/[A-Za-z]/.test(char)) {
      latinCount += 1;
    }
  }

  const alphaCount = cyrillicCount + latinCount;

  return cyrillicCount >= 3 && alphaCount > 0 && cyrillicCount / alphaCount >= 0.35;
}
