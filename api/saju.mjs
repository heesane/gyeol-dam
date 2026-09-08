// 서버에서 사주 명식을 결정론적으로 계산한다 (lunar-javascript).
// LLM 이 만세력 사이트를 매번 웹검색하지 않게 -> 시간·비용 절감 + 명식 고정.
// computeSaju() 는 { text, chart } 를 반환한다.
//  - text: 프롬프트에 주입할 "확정된 명식" 블록
//  - chart: 프론트 명식 카드용 구조화 데이터
import { Solar, Lunar } from 'lunar-javascript';

const GAN_KO = { 甲: '갑', 乙: '을', 丙: '병', 丁: '정', 戊: '무', 己: '기', 庚: '경', 辛: '신', 壬: '임', 癸: '계' };
const ZHI_KO = { 子: '자', 丑: '축', 寅: '인', 卯: '묘', 辰: '진', 巳: '사', 午: '오', 未: '미', 申: '신', 酉: '유', 戌: '술', 亥: '해' };
const GAN_WX = { 甲: '목', 乙: '목', 丙: '화', 丁: '화', 戊: '토', 己: '토', 庚: '금', 辛: '금', 壬: '수', 癸: '수' };
const ZHI_WX = { 子: '수', 丑: '토', 寅: '목', 卯: '목', 辰: '토', 巳: '화', 午: '화', 未: '토', 申: '금', 酉: '금', 戌: '토', 亥: '수' };
const SHISHEN_KO = {
  比肩: '비견', 劫財: '겁재', 劫财: '겁재', 食神: '식신', 傷官: '상관', 伤官: '상관',
  偏財: '편재', 偏财: '편재', 正財: '정재', 正财: '정재', 偏官: '편관', 正官: '정관',
  七殺: '편관', 七杀: '편관', 偏印: '편인', 正印: '정인', 日主: '일간',
};

const pill = (s) => ({ gan: s[0], ganKo: GAN_KO[s[0]] ?? s[0], zhi: s[1], zhiKo: ZHI_KO[s[1]] ?? s[1] });
const gzKo = (s) => `${GAN_KO[s[0]] ?? s[0]}${ZHI_KO[s[1]] ?? s[1]}`;

export function computeSaju({ birthDate, birthTime, dateType, gender }) {
  const [y, m, d] = String(birthDate).split('-').map(Number);
  const [hh, mm] = String(birthTime).split(':').map(Number);
  const solar = dateType === 'lunar'
    ? Lunar.fromYmdHms(y, m, d, hh || 0, mm || 0, 0).getSolar()
    : Solar.fromYmdHms(y, m, d, hh || 0, mm || 0, 0);
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();

  const raw = { year: ec.getYear(), month: ec.getMonth(), day: ec.getDay(), time: ec.getTime() };
  const dayGan = ec.getDayGan();

  const chars = [raw.year, raw.month, raw.day, raw.time].join('');
  const wuxing = { 목: 0, 화: 0, 토: 0, 금: 0, 수: 0 };
  for (let i = 0; i < chars.length; i += 1) {
    const w = i % 2 === 0 ? GAN_WX[chars[i]] : ZHI_WX[chars[i]];
    if (w) wuxing[w] += 1;
  }

  const daYun = [];
  let daYunDir = '';
  try {
    const yun = ec.getYun(gender === 'female' ? 0 : 1);
    daYunDir = yun.isForward?.() ? '순행' : '역행';
    for (const dy of yun.getDaYun()) {
      const gz = dy.getGanZhi();
      if (!gz) continue;
      daYun.push({ age: dy.getStartAge(), year: dy.getStartYear(), gz, gzKo: gzKo(gz) });
      if (daYun.length >= 9) break;
    }
  } catch { /* ignore */ }

  const sipseong = {
    year: SHISHEN_KO[ec.getYearShiShenGan?.()] ?? '',
    month: SHISHEN_KO[ec.getMonthShiShenGan?.()] ?? '',
    time: SHISHEN_KO[ec.getTimeShiShenGan?.()] ?? '',
  };

  const chart = {
    solar: solar.toYmd?.() ?? `${solar.getYear()}-${solar.getMonth()}-${solar.getDay()}`,
    pillars: { year: pill(raw.year), month: pill(raw.month), day: pill(raw.day), time: pill(raw.time) },
    dayGan, dayGanKo: GAN_KO[dayGan] ?? dayGan,
    dayElement: GAN_WX[dayGan] ?? '',
    wuxing, sipseong, daYunDir, daYun,
  };

  const text = [
    '# 확정된 명식 (서버가 만세력으로 계산 완료 · 웹 검색 불필요)',
    `- 양력 환산: ${chart.solar} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    `- 년주 ${raw.year}(${gzKo(raw.year)}) / 월주 ${raw.month}(${gzKo(raw.month)}) / 일주 ${raw.day}(${gzKo(raw.day)}) / 시주 ${raw.time}(${gzKo(raw.time)})`,
    `- 일간(日干): ${dayGan}(${chart.dayGanKo}) · ${chart.dayElement}`,
    `- 오행 개수(천간4+지지4): 목 ${wuxing.목} · 화 ${wuxing.화} · 토 ${wuxing.토} · 금 ${wuxing.금} · 수 ${wuxing.수}`,
    `- 십성(천간): 년 ${sipseong.year || '-'} · 월 ${sipseong.month || '-'} · 시 ${sipseong.time || '-'}`,
    `- 대운(${daYunDir}): ${daYun.map((x) => `${x.age}세(${x.year}년~) ${x.gz}(${x.gzKo})`).join(' · ') || '(계산 불가)'}`,
    `- 납음: 년 ${lunar.getYearNaYin?.() ?? '-'} / 일 ${lunar.getDayNaYin?.() ?? '-'}`,
    '위 명식은 확정본이다. 만세력·절기·간지를 웹에서 다시 조사하지 말고, 이 값을 근거로 해석만 하라.',
    '신강/신약, 조후, 용신·희신·기신, 합충형파해는 위 명식에서 직접 판정하라.',
  ].join('\n');

  return { text, chart };
}
