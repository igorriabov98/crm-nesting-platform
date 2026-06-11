import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, parse } from 'node:path';

const cyrillicMap: Record<string, string> = {
  А: 'A',
  Б: 'B',
  В: 'V',
  Г: 'G',
  Д: 'D',
  Е: 'E',
  Ё: 'E',
  Ж: 'Zh',
  З: 'Z',
  И: 'I',
  Й: 'Y',
  К: 'K',
  Л: 'L',
  М: 'M',
  Н: 'N',
  О: 'O',
  П: 'P',
  Р: 'R',
  С: 'S',
  Т: 'T',
  У: 'U',
  Ф: 'F',
  Х: 'Kh',
  Ц: 'Ts',
  Ч: 'Ch',
  Ш: 'Sh',
  Щ: 'Sch',
  Ъ: '',
  Ы: 'Y',
  Ь: '',
  Э: 'E',
  Ю: 'Yu',
  Я: 'Ya',
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

const standardThicknesses = [
  0.5, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30,
];

export function transliterate(text: string): string {
  return Array.from(text)
    .map((char) => cyrillicMap[char] ?? char)
    .join('');
}

export function roundToStandardThickness(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error('Thickness must be a positive finite number.');
  }

  if (raw > 2.5 && raw < 3) {
    return 3;
  }

  return standardThicknesses.reduce((closest, current) => {
    const closestDiff = Math.abs(closest - raw);
    const currentDiff = Math.abs(current - raw);
    if (Math.abs(currentDiff - closestDiff) < 1e-9) {
      return Math.min(closest, current);
    }

    return currentDiff < closestDiff ? current : closest;
  });
}

export function generateId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}

export function sanitizeFilename(name: string): string {
  const withoutTraversal = name.replace(/(?:^|[\\/])\.\.(?=[\\/]|$)/g, '');
  const extension = extname(withoutTraversal);
  const baseName = extension ? withoutTraversal.slice(0, -extension.length) : withoutTraversal;
  const safeBase = transliterate(baseName.replace(/№/g, ''))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120);

  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  return `${safeBase || 'file'}${safeExtension}`;
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function safeJoin(baseDir: string, filename: string): string {
  const safePath = join(baseDir, sanitizeFilename(filename));
  ensureDir(dirname(safePath));
  return safePath;
}
