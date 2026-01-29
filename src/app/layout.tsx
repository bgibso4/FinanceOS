import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/app-shell';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FinanceOS',
  description: 'Personal finance cockpit with auto-categorization and analytics.',
  icons: {
    icon: '/images/logo-icon.png',
    apple: '/images/logo-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            (function() {
              const theme = localStorage.getItem('theme') || 'system';
              const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
              const activeTheme = theme === 'system' ? systemTheme : theme;
              if (activeTheme === 'dark') {
                document.documentElement.classList.add('dark');
              }
            })();
          `,
          }}
        />
      </head>
      <body className={inter.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
