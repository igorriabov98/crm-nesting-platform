import assert from 'node:assert/strict';
import { normalizeCadText } from '../text-encoding';

const mojibakeSteel = Buffer.from('Сталь', 'utf8').toString('latin1');

assert.equal(normalizeCadText(mojibakeSteel), 'Сталь');
assert.equal(normalizeCadText('Сталь'), 'Сталь');

console.log('[text-encoding] all tests passed');
