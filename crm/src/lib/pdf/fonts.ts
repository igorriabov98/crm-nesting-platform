import { Font } from '@react-pdf/renderer'
import { existsSync } from 'fs'

export const PDF_FONT_FAMILY = 'CrmPdfArial'

let registered = false

export function registerPdfFonts() {
  if (registered) return
  registered = true

  const regular = 'C:/Windows/Fonts/arial.ttf'
  const bold = 'C:/Windows/Fonts/arialbd.ttf'

  if (!existsSync(regular)) return

  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: regular, fontWeight: 'normal' },
      ...(existsSync(bold) ? [{ src: bold, fontWeight: 'bold' as const }] : []),
    ],
  })
}
