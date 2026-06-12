// Корневой layout приложения
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
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
      <body className={`${inter.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        <Suspense fallback={null}>
          <TopProgressBar />
        </Suspense>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
