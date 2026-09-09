import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReactElement } from 'react'
import { PdfText } from './PdfText'

test('protects the first glyph of every line in a PDF text run', () => {
  const element = PdfText({ children: 'Seller\nDelivery basis' }) as ReactElement<{
    children: unknown[]
  }>

  assert.deepEqual(element.props.children, [
    '\u00A0',
    'Seller\n\u00A0Delivery basis',
  ])
})

test('protects text produced by page-number render callbacks', () => {
  const element = PdfText({
    render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`,
  }) as ReactElement<{
    render: (context: {
      pageNumber: number
      totalPages: number
      subPageNumber: number
      subPageTotalPages: number
    }) => unknown
  }>

  assert.equal(element.props.render({
    pageNumber: 2,
    totalPages: 4,
    subPageNumber: 2,
    subPageTotalPages: 4,
  }), '\u00A0Page 2 of 4')
})
