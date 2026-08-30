import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { StockCoverageValue } from './StockCoverageValue'

test('labels warehouse coverage inherited from the approved layout', () => {
  const html = renderToStaticMarkup(<StockCoverageValue reserved={0} covered={11_728} unit="мм" />)
    .replaceAll('\u00a0', ' ')

  assert.match(html, /11 728 мм/)
  assert.match(html, /По раскладке/)
  assert.match(html, /Складской материал учтён утверждённой раскладкой/)
})

test('shows an ordinary scoped reservation without a layout label', () => {
  const html = renderToStaticMarkup(<StockCoverageValue reserved={8500} covered={0} unit="мм" />)
    .replaceAll('\u00a0', ' ')

  assert.match(html, /8 500 мм/)
  assert.doesNotMatch(html, /По раскладке/)
})

test('does not call ordinary wire stock coverage a cutting layout', () => {
  const html = renderToStaticMarkup(<StockCoverageValue reserved={0} covered={25} unit="кг" showLayoutSource={false} />)

  assert.match(html, /25 кг/)
  assert.doesNotMatch(html, /По раскладке/)
})
