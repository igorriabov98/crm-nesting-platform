import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClientPublicAlias } from './public-alias'

test('builds uppercase Unicode aliases from every word', () => {
  assert.equal(buildClientPublicAlias('Леда Металл'), 'ЛЕД.МЕТ')
  assert.equal(buildClientPublicAlias('Acme steel works'), 'ACM.STE.WOR')
  assert.equal(buildClientPublicAlias('ТО'), 'ТО')
})

test('strips quotes and punctuation without losing Unicode words', () => {
  assert.equal(buildClientPublicAlias('«Леда-Металл» (Україна)'), 'ЛЕД.МЕТ.УКР')
  assert.equal(buildClientPublicAlias('  "A&B" / C  '), 'A.B.C')
})

test('uses a safe fallback and permits equal aliases for different clients', () => {
  assert.equal(buildClientPublicAlias('---'), 'КЛИЕНТ')
  assert.equal(buildClientPublicAlias('Леда Металл'), buildClientPublicAlias('Ледник Метизы'))
})
