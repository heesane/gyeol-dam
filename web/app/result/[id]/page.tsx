import type { Metadata } from 'next';
import ResultView from './result-view';

// 풀이는 개인·비공개(게이트) 콘텐츠라 메타데이터는 일반값만.
export const metadata: Metadata = {
  title: '해월의 풀이',
  description: '태어난 때를 읽어 타고난 성향과 지금 들어온 흐름을 짚어준 결담의 사주 풀이.',
  robots: { index: false, follow: false },
  openGraph: {
    title: '결담 · 해월의 풀이',
    description: '해월이 태어난 때를 읽어 반복하는 흐름을 짚어준다.',
  },
};

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultView id={id} />;
}
