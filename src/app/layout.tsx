// Корневой layout приложения
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Fira_Code, Fira_Sans, Geist_Mono, Inter } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { TopProgressBar } from '@/components/features/layout/TopProgressBar'
import './globals.css'
import { validateEnv } from '@/lib/config'

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin', 'cyrillic'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const firaSans = Fira_Sans({
  variable: '--font-industrial-sans',
  subsets: ['latin', 'cyrillic'],
  weight: ['300', '400', '500', '600', '700'],
})

const firaCode = Fira_Code({
  variable: '--font-industrial-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'CRM Завода',
  description: 'Система управления производством металлоконструкций',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  validateEnv()
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${inter.variable} ${geistMono.variable} ${firaSans.variable} ${firaCode.variable} antialiased`} suppressHydrationWarning>
        <Suspense fallback={null}>
          <TopProgressBar />
        </Suspense>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
