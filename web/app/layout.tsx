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

export const metadata: Metadata = {
  title: '결담 — 해월의 손금과 사주 풀이',
  description: '결담의 무당 해월이 태어난 때와 선택적으로 올린 손 사진을 함께 읽어 반복되는 기질과 흐름을 짚어준다.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable} ${notoSerif.variable}`}>{children}</body>
    </html>
  );
}
