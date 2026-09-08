// 서버에서 사주 명식을 결정론적으로 계산한다 (lunar-javascript).
// LLM 이 만세력 사이트를 매번 웹검색하지 않게 -> 시간·비용 절감 + 명식 고정.
import { Solar, Lunar } from 'lunar-javascript';

const GAN_KO = { 甲: '갑', 乙: '을', 丙: '병', 丁: '정', 戊: '무', 己: '기', 庚: '경', 辛: '신', 壬: '임', 癸: '계' };
const ZHI_KO = { 子: '자', 丑: '축', 寅: '인', 卯: '묘', 辰: '진', 巳: '사', 午: '오', 未: '미', 申: '신', 酉: '유', 戌: '술', 亥: '해' };
const WUXING_KO = { 木: '목', 火: '화', 土: '토', 金: '금', 水: '수' };
const SHISHEN_KO = {
  比肩: '비견', 劫財: '겁재', 食神: '식신', 傷官: '상관', 偏財: '편재', 正財: '정재',
  偏官: '편관', 正官: '정관', 七殺: '편관', 偏印: '편인', 正印: '정인',
};

const gz = (s) => `${s}(${(GAN_KO[s[0]] ?? '') + (ZHI_KO[s[1]] ?? '')})`;
const ko = (map, s) => (s || '').split('').map((c) => map[c] ?? c).join('');

function fmtDaYun(yun) {
  try {
    // 첫 원소는 출생~첫대운 전 구간(간지 없음) — 제외.
    const list = yun.getDaYun().filter((d) => d.getGanZhi());
    return list.slice(0, 9)
      .map((d) => `${d.getStartAge()}세(${d.getStartYear()}년~) ${gz(d.getGanZhi())}`)
      .join(' · ');
  } catch { return '(대운 계산 불가)'; }
}

// birthDate: "YYYY-MM-DD", birthTime: "HH:MM", dateType: "solar"|"lunar"
export function computeSaju({ birthDate, birthTime, dateType, gender }) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const [hh, mm] = String(birthTime).split(':').map(Number);
  const solar = dateType === 'lunar'
    ? Lunar.fromYmdHms(y, m, d, hh || 0, mm || 0, 0).getSolar()
    : Solar.fromYmdHms(y, m, d, hh || 0, mm || 0, 0);
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();

  const pillars = {
    year: ec.getYear(), month: ec.getMonth(), day: ec.getDay(), time: ec.getTime(),
  };
  const dayGan = ec.getDayGan();

  // 오행 개수 (천간 4 + 지지 본기 4)
  const chars = [pillars.year, pillars.month, pillars.day, pillars.time].join('');
  const ganWx = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
  const zhiWx = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
  const count = { 목: 0, 화: 0, 토: 0, 금: 0, 수: 0 };
  for (let i = 0; i < chars.length; i += 1) {
    const w = i % 2 === 0 ? ganWx[chars[i]] : zhiWx[chars[i]];
    if (w) count[WUXING_KO[w]] += 1;
  }

  let daYun = '(대운 계산 불가)';
  try {
    const yun = ec.getYun(gender === 'female' ? 0 : 1);
    const dir = yun.isForward?.() ? '순행' : '역행';
    const first = yun.getDaYun().find((d) => d.getGanZhi());
    const startAt = first ? `${first.getStartAge()}세(${first.getStartYear()}년)` : '?';
    daYun = `${dir} · 첫 대운 ${startAt} → ${fmtDaYun(yun)}`;
  } catch { /* ignore */ }

  let shiShen = '';
  try {
    shiShen = [
      `년간 ${SHISHEN_KO[ec.getYearShiShenGan?.()] ?? ec.getYearShiShenGan?.() ?? '-'}`,
      `월간 ${SHISHEN_KO[ec.getMonthShiShenGan?.()] ?? ec.getMonthShiShenGan?.() ?? '-'}`,
      `일간 ${ko(GAN_KO, dayGan)}(일주 주체)`,
      `시간 ${SHISHEN_KO[ec.getTimeShiShenGan?.()] ?? ec.getTimeShiShenGan?.() ?? '-'}`,
    ].join(', ');
  } catch { /* ignore */ }

  return [
    '# 확정된 명식 (서버가 만세력으로 계산 완료 · 웹 검색 불필요)',
    `- 양력 환산: ${solar.toYmdHms?.() ?? `${solar.getYear()}-${solar.getMonth()}-${solar.getDay()}`}`,
    `- 년주 ${gz(pillars.year)} / 월주 ${gz(pillars.month)} / 일주 ${gz(pillars.day)} / 시주 ${gz(pillars.time)}`,
    `- 일간(日干): ${dayGan}(${ko(GAN_KO, dayGan)})`,
    `- 오행 개수(천간4+지지4): 목 ${count.목} · 화 ${count.화} · 토 ${count.토} · 금 ${count.금} · 수 ${count.수}`,
    `- 십성(천간 기준): ${shiShen || '(계산 불가 — 직접 판정)'}`,
    `- 대운: ${daYun}`,
    `- 납음: 년 ${lunar.getYearNaYin?.() ?? '-'} / 일 ${lunar.getDayNaYin?.() ?? '-'}`,
    '위 명식은 확정본이다. 만세력·절기·간지를 웹에서 다시 조사하지 말고, 이 값을 근거로 해석만 하라.',
    '신강/신약, 조후, 용신·희신·기신, 합충형파해는 위 명식에서 직접 판정하라.',
  ].join('\n');
}
