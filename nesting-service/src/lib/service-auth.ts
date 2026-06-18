import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export function verifyServiceAuthorization(value: string | undefined): boolean {
  if (!config.NESTING_SERVICE_SECRET) {
    return config.NODE_ENV !== 'production';
  }

  const expected = Buffer.from(`Bearer ${config.NESTING_SERVICE_SECRET}`);
  const actual = Buffer.from(value || '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
