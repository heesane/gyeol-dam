// node test-sanitize.mjs — 결과 검수기 자체 점검
import assert from 'node:assert/strict';
// import 는 끌어올려지니 env 를 먼저 세우고 동적 import 한다 (서버·DB 를 띄우지 않으려고).
process.env.GYEOLDAM_NO_LISTEN = '1';
const { stripUnpairedQuotes, META_SENTENCE, daYunMismatch, reviewResult } = await import('./server.mjs');

// 따옴표: 열리지 않은 닫는 따옴표만 지운다
assert.equal(stripUnpairedQuotes('평가해.”” 같은 선언보다 마감을 지켜.'), '평가해. 같은 선언보다 마감을 지켜.');
assert.equal(stripUnpairedQuotes('그가 “해봐”라고 했어.'), '그가 “해봐”라고 했어.');
assert.equal(stripUnpairedQuotes('쓰여.”라는 말이 닿아 있어.'), '쓰여.라는 말이 닿아 있어.');

// 메타 문장: 실제로 유출됐던 4종을 문장째로 지운다
const leaked = [
  '너는 이미 알고 있잖아. 라는 말이 네 명식에 가장 정확히 닿아 있어.처럼 꾸밀 필요도 없어. 늦어진 일은 공개를 미룬 결과였어.',
  '느낀 대로 말해. 같은 문장을 반복할 필요도 없어. 오늘 고마움을 전해.',
  '기록을 남겨. 격언으로 포장할 필요도 없어. 이번 주에 하나만 끝내.',
  '숫자를 봐. 같은 말을 덧붙이지 않아도 충분해. 구독 하나를 끊어.',
];
for (const text of leaked) {
  const cleaned = text.replace(META_SENTENCE, '').replace(/\s+/g, ' ').trim();
  assert.ok(META_SENTENCE.test(text) || text.match(META_SENTENCE), `못 잡음: ${text}`);
  assert.ok(!cleaned.includes('필요도 없어') && !cleaned.includes('덧붙이지 않아도'), `안 지워짐: ${cleaned}`);
}
// 멀쩡한 문장은 건드리지 않는다
const keep = '완벽해질 때까지 기다리는 버릇부터 끊어야 해. 30일 안에 하나를 공개해.';
assert.equal(keep.replace(META_SENTENCE, ''), keep);

// 명식 교차검증: 카드의 대운 나이와 본문이 어긋나면 잡는다
const chart = { daYun: [{ gz: '壬申', age: 9 }, { gz: '辛未', age: 19 }, { gz: '庚午', age: 29 }] };
assert.ok(daYunMismatch('일곱 살 무렵 壬申 대운이 시작됐고 7세부터 이어져.', chart));
assert.equal(daYunMismatch('9세(2008년~) 壬申 대운으로 들어가.', chart), null);
assert.equal(daYunMismatch('스물일곱 즈음에 판이 바뀐다.', chart), null); // 간지 없는 문장은 대조하지 않음

// reviewResult: 상투어도 잡는다
const section = (body) => ({ lead: '한 문장.', blocks: [{ heading: 'h', body }] });
assert.deepEqual(reviewResult({ summary: '요약.', sections: [section('담백한 본문이야.')] }, chart), []);
assert.ok(reviewResult({ summary: '요약.', sections: [section('여기서 갈린다. 그러니 해.')] }, chart).length);

console.log('ok');
