import type { Metadata } from 'next';
import { Geist, Geist_Mono, Noto_Serif_KR } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'], display: 'swap' });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], display: 'swap' });
const notoSerif = Noto_Serif_KR({
  variable: '--font-serif',
  weight: ['600', '800'],
  subsets: ['latin'],
  display: 'swap',
  preload: false,
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gyeol-dam-heesanes-projects.vercel.app';
const DESC = '태어난 때를 읽어 타고난 성향과 지금 들어온 흐름, 반복하는 선택을 짚어준다. 무당 해월의 사주·손금 풀이.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: '결담 — 해월의 사주·손금 풀이', template: '%s · 결담' },
  description: DESC,
  keywords: ['결담', '해월', '사주', '손금', '사주풀이', '명리', '만세력', '운세'],
  applicationName: '결담',
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    siteName: '결담',
    title: '결담 — 해월의 사주·손금 풀이',
    description: DESC,
    locale: 'ko_KR',
  },
  twitter: { card: 'summary_large_image', title: '결담 — 해월의 사주·손금 풀이', description: DESC },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable} ${notoSerif.variable}`}>{children}</body>
    </html>
  );
}
