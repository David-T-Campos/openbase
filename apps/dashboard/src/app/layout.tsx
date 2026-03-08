import type { Metadata } from 'next'
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google'
import './globals.css'

const sans = Instrument_Sans({
    subsets: ['latin'],
    variable: '--font-sans',
})

const mono = IBM_Plex_Mono({
    subsets: ['latin'],
    weight: ['400', '500', '600'],
    variable: '--font-mono',
})

export const metadata: Metadata = {
    title: 'OpenBase - Open-source backend infrastructure',
    description: 'OpenBase is an open-source backend service with database, auth, storage, and realtime built around Telegram-backed infrastructure.',
    icons: {
        icon: [
            { url: '/icon.svg', type: 'image/svg+xml' },
        ],
    },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className="dark">
            <body className={`${sans.variable} ${mono.variable} min-h-screen`}>
                {children}
            </body>
        </html>
    )
}
