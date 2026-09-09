import type { ComponentProps, ReactNode } from 'react'
import { Text as ReactPdfText } from '@react-pdf/renderer'

const LEADING_GLYPH_GUARD = '\u00A0'

function guardWrappedLineStarts(value: ReactNode): ReactNode {
  if (typeof value === 'string') {
    return value.replace(/\n(?=.)/g, `\n${LEADING_GLYPH_GUARD}`)
  }
  if (Array.isArray(value)) return value.map(guardWrappedLineStarts)
  return value
}

/**
 * React PDF can clip the first glyph of a text run in the production renderer.
 * A leading non-breaking space keeps the real first character inside the run.
 */
type PdfRenderContext = {
  pageNumber: number
  totalPages: number
  subPageNumber: number
  subPageTotalPages: number
}
type PdfTextRender = (context: PdfRenderContext) => ReactNode
type PdfTextProps = ComponentProps<typeof ReactPdfText> & {
  children?: ReactNode
  render?: PdfTextRender
}

function guardRenderedText(value: ReactNode): ReactNode {
  if (typeof value === 'string' || typeof value === 'number') {
    return `${LEADING_GLYPH_GUARD}${guardWrappedLineStarts(String(value))}`
  }
  return value
}

export function PdfText({ children, render, ...props }: PdfTextProps) {
  return (
    <ReactPdfText
      {...props}
      {...(render ? { render: (context: PdfRenderContext) => guardRenderedText(render(context)) } : {})}
    >
      {LEADING_GLYPH_GUARD}
      {guardWrappedLineStarts(children)}
    </ReactPdfText>
  )
}
