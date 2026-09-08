// node test-sanitize.mjs — 결과 검수기 자체 점검
import assert from 'node:assert/strict';
// import 는 끌어올려지니 env 를 먼저 세우고 동적 import 한다 (서버·DB 를 띄우지 않으려고).
process.env.GYEOLDAM_NO_LISTEN = '1';
const { stripUnpairedQuotes, META_SENTENCE, daYunMismatch, reviewSection, duplicateSections, corePrompt, groupPrompt, groupSections } = await import('./server.mjs');

// 따옴표: 열리지 않은 닫는 따옴표만 지운다
assert.equal(stripUnpairedQuotes('평가해.”” 같은 선언보다 마감을 지켜.'), '평가해. 같은 선언보다 마감을 지켜.');
assert.equal(stripUnpairedQuotes('그가 “해봐”라고 했어.'), '그가 “해봐”라고 했어.');
assert.equal(stripUnpairedQuotes('쓰여.”라는 말이 닿아 있어.'), '쓰여.라는 말이 닿아 있어.');

// 메타 문장: 실제로 유출됐던 유형을 문장째로 지운다
const leaked = [
  '너는 이미 알고 있잖아. 라는 말이 네 명식에 가장 정확히 닿아 있어.처럼 꾸밀 필요도 없어. 늦어진 일은 공개를 미룬 결과였어.',
  '느낀 대로 말해. 같은 문장을 반복할 필요도 없어. 오늘 고마움을 전해.',
  '기록을 남겨. 격언으로 포장할 필요도 없어. 이번 주에 하나만 끝내.',
  '숫자를 봐. 같은 말을 덧붙이지 않아도 충분해. 구독 하나를 끊어.',
  '판단해. 같은 선언보다 더 현실적인 기준이 있어. 공개는 빠르게.',
];
for (const text of leaked) {
  const cleaned = text.replace(META_SENTENCE, '');
  assert.ok(cleaned.length < text.length, `못 잡음: ${text}`);
  assert.ok(!/필요도 없어|덧붙이지 않아도|같은 선언보다/.test(cleaned), `안 지워짐: ${cleaned}`);
}
// 멀쩡한 문장은 건드리지 않는다
const keep = '완벽해질 때까지 기다리는 버릇부터 끊어야 해. 30일 안에 하나를 공개해.';
assert.equal(keep.replace(META_SENTENCE, ''), keep);

// 명식 교차검증: 카드의 대운 나이와 본문이 어긋나면 잡는다
const chart = { daYun: [{ gz: '壬申', age: 9 }, { gz: '辛未', age: 19 }, { gz: '庚午', age: 29 }] };
assert.ok(daYunMismatch('일곱 살 무렵 壬申 대운이 시작됐고 7세부터 이어져.', chart));
assert.equal(daYunMismatch('9세(2008년~) 壬申 대운으로 들어가.', chart), null);
assert.equal(daYunMismatch('스물일곱 즈음에 판이 바뀐다.', chart), null); // 간지 없는 문장은 대조하지 않음

// reviewSection: 상투어·메타 문장·명식 불일치를 섹션 단위로 모은다
const section = (key, body) => ({
  key, title: 't', lead: '한 문장.', keywords: ['a', 'b'],
  evidence: '유금이 셋이라 자기검열이 실행보다 먼저 들어온다는 근거야.', caution: '어긋나면 공개가 늦어져.',
  blocks: [{ heading: 'h', body }],
});
assert.deepEqual(reviewSection(section('innate', '담백한 본문이야.'), chart), []);
assert.equal(reviewSection(section('innate', '여기서 갈린다. 그러니 해.'), chart).length, 1);
assert.equal(reviewSection(section('innate', '7세 壬申 대운에 들어가.'), chart).length, 1);

// duplicateSections: 다른 섹션이 같은 문장을 돌려쓰면 뒤쪽 섹션을 지목한다
const shared = '완벽해질 때까지 기다리는 버릇부터 끊고 결과물을 밖으로 내놓아야 해';
const dup = duplicateSections([section('innate', `${shared}.`), section('choices', `${shared}.`)]);
assert.deepEqual([...dup.keys()], ['choices']);
assert.equal(duplicateSections([section('innate', '짧은 문장.'), section('choices', '짧은 문장.')]).size, 0);

// 프롬프트 분할: 단계마다 필요한 블록만 실리고, 페르소나는 어디서도 빠지지 않는다
const input = { mode: 'saju', birthDate: '1999-09-15', dateType: 'solar', birthTime: '17:30', gender: 'male', birthPlace: '서울' };
const groups = groupSections(false);
const core = { summary: '요약', verdict: '판정', assignments: groups.flat().map((g) => ({ key: g.key, angle: '축', evidence: '근거', avoid: '회피' })) };
const prompts = [corePrompt(input), ...groups.map((g) => groupPrompt(input, core, g))];
const money = prompts[2]; // workTalent+moneyBusiness 그룹
for (const prompt of prompts) {
  assert.ok(prompt.includes('최고 수준의 명리학자이자 수상가인'), '페르소나 머리말이 빠졌다');
  assert.ok(prompt.includes('\n# 2. 전체 말투와 분위기'), '말투 규칙이 빠졌다');
  for (const dropped of ['\n# 0. 입력정보', '\n# 35. 서비스 후킹', '\n# 36. 결과 화면', '\n# 39. 저장']) {
    assert.ok(!prompt.includes(dropped), `서버가 대신하는 블록이 실렸다: ${dropped}`);
  }
}
assert.ok(money.includes('\n# 15. 재물운') && money.includes('\n# 16. 직업'), '맡은 섹션의 해석 범위가 빠졌다');
assert.ok(!money.includes('\n# 13. 연애운'), '다른 그룹의 해석 범위가 실렸다');
assert.ok(!prompts[0].includes('\n# 13. 연애운'), '1단계에 본문용 해석 범위가 실렸다');
// 손금 규칙은 손 사진이 있는 그룹에만
assert.ok(!prompts.some((p) => p.includes('\n# 10. 주요 손금')), '사주 모드에 손금 규칙이 실렸다');
const palmGroups = groupSections(true);
const palmPrompt = groupPrompt({ ...input, mode: 'saju_palm', dominantHand: 'right' },
  { ...core, assignments: palmGroups.flat().map((g) => ({ key: g.key, angle: '축', evidence: '근거', avoid: '회피' })) },
  palmGroups.find((g) => g.some((x) => x.key === 'palm')));
assert.ok(palmPrompt.includes('\n# 10. 주요 손금'), '손금 그룹에 손금 규칙이 없다');

console.log('ok');
