// GASコード（gas_code.js）のテスト。模型のシートにつないで動かす。
const { makeSheet, loadGas, t, eq, finish } = require('./harness');

console.log('1. 合言葉');
{
  const sh = makeSheet(); const opts = {}; const g = loadGas(sh, opts);
  t('合言葉が違う保存は断る', eq(g.post(JSON.stringify({ key: 'memos', value: [], token: 'x' })), { status: 'error', message: 'unauthorized' }));
  t('合言葉が違う受信は断る', eq(g.post(JSON.stringify({ action: 'getAll', token: 'x' })), { status: 'error', message: 'unauthorized' }));
  t('合言葉なしは断る', g.post(JSON.stringify({ action: 'getAll' })).message === 'unauthorized');
  t('断ったときはシートに何も書かない', sh._st.cells.length === 0);
  const log = opts.sheets && opts.sheets.auth_log;
  t('間違いは auth_log に1時間1行で記録（回数3・受信2・保存1）', !!log && eq(log._st.cells[1], ['2026-11-16 10時台', '3', '2026-11-16 10:05:00', '2', '1']), log && log._st.cells);
  t('auth_log に合言葉そのものは残らない', !JSON.stringify(log._st.cells).includes('"x"'));
  const g2 = loadGas(makeSheet(), { noToken: true });
  t('SYNC_TOKEN が未設定なら、正しそうな合言葉でも断る', g2.post({ action: 'getAll' }).message === 'unauthorized');
  t('形のおかしい要求は bad_request', g.post('こわれた').message === 'bad_request' && g.post({ value: 1 }).message === 'bad_request');
}
console.log('2. GET はデータを返さない');
{
  const sh = makeSheet(); const g = loadGas(sh);
  g.post({ bulk: true, data: { memos: [{ id: 'a', title: 'ひみつ' }] } });
  const r = g.getRaw({ action: 'getAll', token: 'tok' });
  t('正しい合言葉を付けたGETでも、データは返らない', typeof r.text === 'string' && !r.text.includes('ひみつ') && r.mime === 'text', r);
}
console.log('3. 保存と受信');
{
  const sh = makeSheet(); const g = loadGas(sh);
  t('空のシートの受信は {}', eq(g.all(), {}));
  const memos = [{ id: 'lm_1', date: '2026-11-16', title: '=A1 +1 -2 \'x @y 😀🐩  空白  ', mastery: 0 }];
  t('本体と時刻の組を保存（count 2）', eq(g.post({ bulk: true, data: { memos, _ts_memos: 1000 } }), { status: 'ok', count: 2 }));
  t('記号・絵文字・空白がそのまま戻る', eq(g.all(), { memos, _ts_memos: 1000 }));
  t('古い時刻の組は書かない（skipped）', eq(g.post({ bulk: true, data: { memos: [], _ts_memos: 900 } }), { status: 'ok', count: 0, skipped: ['memos'] }) && eq(g.all().memos, memos));
  t('force 付きなら古い時刻でも書く', g.post({ bulk: true, force: true, data: { memos: [], _ts_memos: 800 } }).count === 2 && eq(g.all(), { memos: [], _ts_memos: 800 }));
  t('時刻なしの書き戻しは必ず書く', g.post({ bulk: true, data: { memos } }).count === 1 && eq(g.all().memos, memos));
  const big = Array.from({ length: 600 }, (_, i) => ({ id: 'lm_' + i, date: '2026-01-01', content: 'あいうえお😀 = + - ' + 'か'.repeat(200) + i }));
  t('5万文字を超える一覧も保存できる（複数セルに分割）', g.post({ bulk: true, data: { memos: big, _ts_memos: 5000 } }).status === 'ok' && sh._st.cells.some(r => r[0] === 'memos' && r[2] !== '' && r[2] !== undefined));
  t('分割した一覧が元どおりに戻る', eq(g.all().memos, big));
  t('短い一覧に戻すと、余ったセルが消える', g.post({ bulk: true, data: { memos, _ts_memos: 6000 } }).status === 'ok' && eq(g.all().memos, memos));
  sh._st.failNextSet = true; const before = JSON.stringify(sh._st.cells);
  t('書き込みに失敗したら server_error を返し、シートは元のまま', g.post({ bulk: true, data: { memos: [], _ts_memos: 7000 } }).message === 'server_error' && JSON.stringify(sh._st.cells) === before);
}
console.log('4. 削除記録は合算');
{
  const g = loadGas(makeSheet());
  g.post({ bulk: true, data: { deleted_ids: { memos: ['a'] } } });
  g.post({ bulk: true, data: { deleted_ids: { memos: ['b'], categories: ['c'] } } });
  t('別々に送った削除記録が合わさる（上書きで消えない）', eq(g.all().deleted_ids, { memos: ['a', 'b'], categories: ['c'] }));
  g.post({ bulk: true, force: true, data: { deleted_ids: { memos: [] } } });
  t('force 付きの全データ送信でも減らない', eq(g.all().deleted_ids, { memos: ['a', 'b'], categories: ['c'] }));
  g.post({ key: 'deleted_ids', value: { memos: ['a'] }, replaceDeletedIds: true });
  t('replaceDeletedIds を付けたときだけ置き換え（手作業の掃除用）', eq(g.all().deleted_ids, { memos: ['a'] }));
}
console.log('5. 混雑');
{
  const opts = {}; const g = loadGas(makeSheet(), opts);
  opts.busy = true;
  t('順番待ちが時間切れなら busy を返す（保存・受信とも）', g.post({ bulk: true, data: { memos: [] } }).message === 'busy' && g.all().message === 'busy');
}
finish();
