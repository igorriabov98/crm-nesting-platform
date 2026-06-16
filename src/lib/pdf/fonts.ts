import { Font } from '@react-pdf/renderer'
import { existsSync } from 'fs'
import path from 'path'

export const PDF_FONT_FAMILY = 'CrmPdfArial'

let registered = false

export function registerPdfFonts() {
  if (registered) return

  const publicFontsDir = path.join(process.cwd(), 'public', 'fonts')
  const bundledRegular = path.join(publicFontsDir, 'NotoSans-Regular.ttf')
  const bundledBold = path.join(publicFontsDir, 'NotoSans-Bold.ttf')
  const legacyRegular = path.join(publicFontsDir, 'noto-sans-cyrillic-400-normal.woff')
  const legacyBold = path.join(publicFontsDir, 'noto-sans-cyrillic-700-normal.woff')
  const regular = existsSync(bundledRegular)
    ? bundledRegular
    : existsSync(legacyRegular)
      ? legacyRegular
      : 'C:/Windows/Fonts/arial.ttf'
  const bold = existsSync(bundledBold)
    ? bundledBold
    : existsSync(legacyBold)
      ? legacyBold
      : 'C:/Windows/Fonts/arialbd.ttf'

  if (!existsSync(regular)) {
    console.warn(`[PDF] Font file is missing, PDF family was not registered: ${regular}`)
    return
  }

  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: regular, fontWeight: 'normal' },
      ...(existsSync(bold) ? [{ src: bold, fontWeight: 'bold' as const }] : []),
    ],
  })
  registered = true
}
