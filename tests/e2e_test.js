// 通しテスト：index.html のスクリプト全体を2台分（PC役・スマホ役）起動し、
// gas_code.js（本物のコード＋シートの模型）につないで一連の操作を行う。
const { makeSheet, loadGas, makeApp, settle, act, sync, t, eq, finish, clock, errors, LS } = require('./harness');

const URL_ = 'https://script.google.com/macros/s/x/exec';
const READY = { [LS + 'gas_url']: URL_, [LS + 'sync_token']: 'tok' };
// 健康アプリのキー（同じ保存場所を共有している）。学びメモが触ってはいけないもの
const HEALTH = { gas_url: 'https://script.google.com/macros/s/HEALTH/exec', sync_token: 'health-token', deleted_ids: '{"supple":["s1"]}', diary: '[{"date":"2026-11-01"}]', maintenance_mode: 'on', 'autobackup_2026-11-10': '{"diary":"[]"}', _ts_diary: '123' };
const healthIntact = (app) => Object.keys(HEALTH).every(k => app.store[k] === HEALTH[k]);
const fill = (app, p, v) => ['date', 'title', 'course', 'content', 'reaction', 'next', 'link'].forEach(f => { app.el(p + '-' + f).value = v[f] || ''; });
const ids = (list) => list.map(m => m.id).sort();
// 受信し直すが、表示を消すタイマーは進めない（同期の表示を確かめるとき用）
const syncShow = async (app) => { clock.t += 61000; app.ev('maybeResync()'); await settle(); };
const boot = async (name, gas, store) => { const a = makeApp(name, gas, store); await settle(); a.runTimers(); await settle(); return a; };

(async () => {
  const sheet = makeSheet(); const gasOpts = {}; const gas = loadGas(sheet, gasOpts);

  console.log('1. 同期を設定する前（この端末だけで使う）');
  const PC = await boot('PC', gas, Object.assign({}, HEALTH));
  t('起動してエラーが出ない', errors.length === 0, errors);
  t('メモが1件も無い端末では、自動バックアップを作らない', !Object.keys(PC.store).some(k => k.startsWith(LS + 'backup_')));
  t('初期カテゴリ3つが時刻0で入る', eq(PC.get('categories').map(c => [c.id, c._ts]), [['lcat_kintore', 0], ['lcat_massage', 0], ['lcat_praise', 0]]));
  t('同期が未設定なら通信しない', PC.fetches === 0);
  t('「同期はまだ設定されていません」の案内が出る', PC.el('setup-hint').innerHTML.includes('同期はまだ設定されていません'));
  await act(PC, 'quickSave()');
  t('カテゴリを選ばずに「記録する」と、保存されず案内が出る', PC.get('memos', []).length === 0 && PC.toasts.includes('カテゴリを選んでください'));
  PC.el('quick-date').value = '2026-11-16';
  await act(PC, "quickPickCat('lcat_kintore'); quickSave()");
  const m1 = PC.get('memos')[0];
  t('日付だけ記録：日付とカテゴリだけで保存される', PC.get('memos').length === 1 && m1.date === '2026-11-16' && m1.category === 'lcat_kintore' && m1.title === '' && m1.mastery === 0);
  t('一覧に「日付だけ」の印と「内容を書き足す」ボタンが出る', PC.el('memo-list').innerHTML.includes('stub-badge') && PC.el('memo-list').innerHTML.includes('内容を書き足す'));
  t('今月の学びに 筋トレ 1回 と出る', /筋トレ <b>1<\/b>回/.test(PC.el('summary').innerHTML));
  t('設定前の保存では通信しない', PC.fetches === 0);
  PC.confirmAnswer = false; PC.el('quick-date').value = '2026-11-16';
  await act(PC, "quickPickCat('lcat_kintore'); quickSave()");
  t('同じ日・同じカテゴリの2件目は確認が出て、「いいえ」なら増えない', PC.confirms.length === 1 && PC.get('memos').length === 1);
  PC.confirmAnswer = true; await act(PC, "quickPickCat('lcat_kintore')");   // 選択を外す

  console.log('2. 同期を設定する → まっさらなGASへ自動で上がる');
  await act(PC, 'showSettingsModal()');
  PC.el('gas-url-input').value = 'http://example.com/'; PC.el('sync-token-input').value = 'tok';
  await act(PC, 'saveSettingsFromModal()');
  t('URLの形が違えば保存しない', PC.store[LS + 'gas_url'] === undefined && PC.el('settings-error').textContent.includes('形式'));
  PC.el('gas-url-input').value = ' ' + URL_ + ' '; PC.el('sync-token-input').value = '';
  await act(PC, 'saveSettingsFromModal()');
  t('合言葉が空なら保存しない', PC.store[LS + 'gas_url'] === undefined);
  PC.el('sync-token-input').value = ' tok ';
  await act(PC, 'saveSettingsFromModal()');
  t('URLと合言葉が前置きつきのキーに保存される（前後の空白は除く）', PC.store[LS + 'gas_url'] === URL_ && PC.store[LS + 'sync_token'] === 'tok');
  let g = gas.all();
  t('保存直後の受信同期で、端末のメモとカテゴリがGASへ書き戻される', g.memos.length === 1 && g.categories.length === 3, g);
  t('書き戻しは1回の送信にまとまっている', PC.posts.length === 2 && PC.posts[0].action === 'getAll' && PC.posts[1].bulk === true && !!PC.posts[1].data.memos && !!PC.posts[1].data.categories);
  t('健康アプリのキーは1つも変わっていない', healthIntact(PC));
  t('学びメモが書いたキーはすべて custom_manabi_ で始まる', Object.keys(PC.store).filter(k => !(k in HEALTH)).every(k => k.startsWith(LS)), Object.keys(PC.store));
  t('GASに送ったキーは memos / categories / deleted_ids と時刻だけ', PC.posts.every(p => !p.data || Object.keys(p.data).every(k => ['memos', 'categories', 'deleted_ids', '_ts_memos', '_ts_categories'].includes(k))));

  console.log('3. 2台目（スマホ役）が受信する');
  const SP = await boot('スマホ', gas, Object.assign({}, HEALTH, READY));
  t('まっさらな2台目：起動時の受信でメモが入る', eq(ids(SP.get('memos')), ids(PC.get('memos'))) && errors.length === 0, errors);
  t('まっさらな2台目は、GASへ何も書き込まない（受信の要求だけ）', SP.posts.length === 1 && SP.posts[0].action === 'getAll', SP.posts);
  t('初期カテゴリは重複しない（3つのまま）', SP.get('categories').length === 3 && gas.all().categories.length === 3);

  console.log('4. くわしく書く → もう1台に届く');
  await act(PC, 'toggleForm()');
  t('フォームを開くと「くわしく書く」ボタンは隠れる', PC.el('new-trigger').style.display === 'none');
  fill(PC, 'lma', { date: '2026-11-15', title: '後ろ足の負重', course: '筋トレ講座', content: 'ゆっくり3秒', reaction: 'うれしそう', next: '回数を増やす', link: 'https://example.com/a' });
  await act(PC, "saveMemo('lma')");
  t('カテゴリを選ばないと保存されない', PC.get('memos').length === 1 && PC.toasts.includes('カテゴリを選んでください'));
  await act(PC, "formPickCat('lcat_massage'); pickMastery('lma', 2); saveMemo('lma')");
  const full = PC.get('memos').find(m => m.title === '後ろ足の負重');
  t('全項目が保存される（形式Zoom・習熟度2）', !!full && full.category === 'lcat_massage' && full.format === 'Zoom' && full.mastery === 2 && full.next === '回数を増やす');
  const last2 = PC.posts.slice(-2);
  t('保存1回＝「受信 → マージした一覧の書き戻し」の2回の通信（一覧を丸ごと新しい時刻で上書きしない）', last2[0].action === 'getAll' && last2[1].bulk === true && eq(Object.keys(last2[1].data), ['memos']) && !last2[1].force && eq(ids(gas.all().memos), ids(PC.get('memos'))), last2.map(p => p.action || Object.keys(p.data)));
  t('一覧に内容が出て、習熟度「練習中」が表示される', PC.el('memo-list').innerHTML.includes('後ろ足の負重') && PC.el('memo-list').innerHTML.includes('練習中'));
  await sync(SP);
  t('スマホ役：画面に戻ったときの受信で新しいメモが届く', SP.get('memos').length === 2 && SP.el('memo-list').innerHTML.includes('後ろ足の負重'));
  const before = SP.posts.length; SP.ev('maybeResync()'); await settle();
  t('1分以内の受信し直しはしない', SP.posts.length === before);

  console.log('5. 日付だけの記録を、あとで書き足す');
  await act(SP, `openEdit(${JSON.stringify(m1.id)})`);
  t('書き足しフォームが開く（形式・習熟度は未選択）', SP.el('memo-list').innerHTML.includes('内容を書き足す') && SP.ev('_editFormat') === '' && SP.ev('_editMastery') === 0);
  await sync(PC); const pcPostsBefore = PC.posts.length;
  clock.t += 61000; SP.ev('maybeResync()'); await settle();
  t('編集中は受信し直さない', SP.posts[SP.posts.length - 1].action === 'getAll' && SP.posts.filter(p => p.action === 'getAll').length === 2);
  fill(SP, 'lme', { date: '2026-11-16', title: '', content: 'スクワットを5回', reaction: '' });
  await act(SP, "pickMastery('lme', 1); pickMastery('lme', 1); pickFormat('lme', '対面'); saveMemo('lme')");
  const fleshed = SP.get('memos').find(m => m.id === m1.id);
  t('書き足した内容が保存される（習熟度は2度押しで未選択のまま）', fleshed.content === 'スクワットを5回' && fleshed.format === '対面' && fleshed.mastery === 0);
  t('書き足したら「日付だけ」の印が消える', !SP.el('memo-list').innerHTML.includes('stub-badge'));
  await sync(PC);
  t('PC役：書き足した内容が届く', PC.get('memos').find(m => m.id === m1.id).content === 'スクワットを5回');
  t('PC役：受け取るだけのときは書き戻さない', PC.posts.slice(pcPostsBefore).every(p => p.action === 'getAll'), PC.posts.slice(pcPostsBefore));

  console.log('6. 2台が互いを知らないまま保存 → どちらのメモも残る');
  PC.el('quick-date').value = '2026-11-10'; await act(PC, "quickPickCat('lcat_praise'); quickSave()");
  SP.el('quick-date').value = '2026-11-11'; await act(SP, "quickPickCat('lcat_massage'); quickSave()");
  t('あとから保存したスマホ役は、PC役のメモを受け取ってから送るので、GASからPC役のメモが欠けない', gas.all().memos.length === 4 && gas.all().memos.some(m => m.date === '2026-11-10') && SP.get('memos').length === 4);
  await sync(PC);
  t('PC役の次の受信で、スマホ役のメモも受け取る', gas.all().memos.length === 4 && PC.get('memos').length === 4);
  await sync(SP);
  t('スマホ役にも4件そろう', SP.get('memos').length === 4 && eq(ids(SP.get('memos')), ids(PC.get('memos'))));

  console.log('7. 削除が伝わる・復活しない');
  const delId = PC.get('memos').find(m => m.date === '2026-11-10').id;
  await act(PC, `deleteMemo(${JSON.stringify(delId)})`);
  t('削除記録がGASに入り、メモがGASから消える', gas.all().deleted_ids.memos.includes(delId) && !gas.all().memos.some(m => m.id === delId));
  // スマホ役は削除を知らないまま、同じメモを編集する（時刻は削除より新しい）
  await act(SP, `openEdit(${JSON.stringify(delId)})`);
  fill(SP, 'lme', { date: '2026-11-10', content: '消されたメモへの書き足し' });
  await act(SP, "saveMemo('lme')");
  t('スマホ役が消されたメモを知らずに保存しても、GASには戻らず、スマホ役からも消える', !gas.all().memos.some(m => m.id === delId) && !SP.get('memos').some(m => m.id === delId));
  await sync(SP);
  t('スマホ役：次の受信で削除記録が届き、メモが消える', !SP.get('memos').some(m => m.id === delId));
  t('GASからも消える（削除記録を適用した一覧が書き戻される）', !gas.all().memos.some(m => m.id === delId));
  await sync(PC);
  t('PC役でも復活しない', !PC.get('memos').some(m => m.id === delId) && PC.get('memos').length === 3);

  console.log('8. 通信できないあいだの操作が、あとで届く');
  PC.offline = true; PC.expectErrors = true;
  const offDel = PC.get('memos').find(m => m.date === '2026-11-11').id;
  await act(PC, `deleteMemo(${JSON.stringify(offDel)})`);
  PC.el('quick-date').value = '2026-11-09'; await act(PC, "quickPickCat('lcat_kintore'); quickSave()");
  t('通信できなくても端末には保存される', PC.get('memos').length === 3 && PC.get('memos').some(m => m.date === '2026-11-09'));
  t('GASにはまだ届いていない', !(gas.all().deleted_ids.memos || []).includes(offDel) && !gas.all().memos.some(m => m.date === '2026-11-09'));
  await sync(PC);
  t('通信できないときの受信は「オフライン」表示', PC.el('sync-status').textContent === '' || PC.warns.some(w => w.includes('[同期失敗]')));
  PC.offline = false; PC.expectErrors = false;
  await sync(PC);
  g = gas.all();
  t('通信が戻ると、削除記録と新しいメモが1回の送信でGASへ届く', g.deleted_ids.memos.includes(offDel) && g.memos.some(m => m.date === '2026-11-09') && !g.memos.some(m => m.id === offDel));
  await sync(SP);
  t('スマホ役：消したメモが消え、新しいメモが届く', !SP.get('memos').some(m => m.id === offDel) && SP.get('memos').some(m => m.date === '2026-11-09') && eq(ids(SP.get('memos')), ids(PC.get('memos'))));

  console.log('9. カテゴリの追加');
  SP.promptAnswer = '  ハイドロセラピー  ';
  await act(SP, "addCategory('quick')");
  const newCat = SP.get('categories').find(c => c.label === 'ハイドロセラピー');
  t('カテゴリが追加され、選ばれた状態になる（色は未使用のもの）', !!newCat && SP.ev('_quickCat') === newCat.id && newCat.solid === '#7d9fd3' && newCat.order === 4);
  await act(SP, "addCategory('quick')");
  t('同じ名前をもう一度入れても増えない', SP.get('categories').length === 4);
  await sync(PC);
  t('PC役にカテゴリが届く', PC.get('categories').length === 4 && PC.el('filter-bar').innerHTML.includes('ハイドロセラピー'));
  await act(SP, 'quickPickCat(_quickCat)');

  console.log('10. 絞り込み・月ごとのまとまり');
  PC.el('quick-date').value = '2026-10-05'; await act(PC, "quickPickCat('lcat_kintore'); quickSave()");
  let html = PC.el('memo-list').innerHTML;
  t('月ごとにまとまる（2026年11月・2026年10月）', html.includes('2026年11月') && html.includes('2026年10月') && html.indexOf('2026年11月') < html.indexOf('2026年10月'));
  await act(PC, "setFilter('lcat_massage')");
  t('カテゴリで絞り込める', PC.el('memo-list').innerHTML.includes('後ろ足の負重') && !PC.el('memo-list').innerHTML.includes('スクワットを5回'));
  await act(PC, 'setFilter(null); toggleStubFilter()');
  t('「日付だけ」で絞り込める', PC.el('memo-list').innerHTML.includes('stub-badge') && !PC.el('memo-list').innerHTML.includes('後ろ足の負重'));
  await act(PC, 'toggleStubFilter()');
  t('今月の学び：今月の分だけを数える（10月の記録は入らない）', /合計 3 回/.test(PC.el('summary').innerHTML), PC.el('summary').innerHTML);

  console.log('11. エラー応答・汚れたデータ');
  const snap = JSON.stringify(PC.get('memos'));
  PC.store[LS + 'sync_token'] = 'ちがう';
  await syncShow(PC);
  t('合言葉が違うと「合言葉を確認してください」。端末のデータは変わらない', PC.el('sync-status').textContent === '合言葉を確認してください' && JSON.stringify(PC.get('memos')) === snap);
  t('エラー応答の status / message を端末に保存しない', !Object.keys(PC.store).some(k => /status|message/.test(k)));
  PC.store[LS + 'sync_token'] = 'tok'; PC.runTimers();
  gasOpts.busy = true; await syncShow(PC);
  t('混雑のときは受信をスキップ。端末のデータは変わらない', PC.el('sync-status').textContent.includes('混み合っている') && JSON.stringify(PC.get('memos')) === snap);
  gasOpts.busy = false; PC.runTimers();
  // シートに、想定外のキーと壊れた要素を紛れ込ませる
  gas.post({ bulk: true, data: { status: 'error', message: 'unauthorized', diary: [{ date: 'x' }], gas_url: 'http://evil/', memos: gas.all().memos.concat([null, 'もじ', { title: 'idなし' }, { id: 'lm_x<img src=x onerror=alert(1)>', date: '2026-11-01', category: 'lcat_kintore', title: '<script>alert(1)</script>', content: '"\'><b>x', _ts: 5 }]) } });
  gas.post({ bulk: true, data: { categories: gas.all().categories.map(c => c.id === 'lcat_kintore' ? Object.assign({}, c, { fill: 'red;background:url(http://evil/)', _ts: 9 }) : c) } });
  await syncShow(PC);
  t('status キーが紛れたデータでも、エラーと誤判定せず同期できる', PC.el('sync-status').textContent === '同期済み', PC.el('sync-status').textContent);
  t('想定外のキーは端末に保存しない', !Object.keys(PC.store).some(k => k.startsWith(LS) && /status|message|diary/.test(k)) && PC.store[LS + 'gas_url'] === URL_ && healthIntact(PC));
  t('壊れた要素（null・文字列・idなし）は取り込まず、GASからも掃除する', PC.get('memos').every(m => m && typeof m.id === 'string') && gas.all().memos.every(m => m && typeof m.id === 'string'));
  PC.runTimers(); await settle();
  html = PC.html();
  t('タグや引用符を含む値は、文字としてだけ表示される', !html.includes('<script>') && !html.includes('<img') && !html.includes('<b>x') && html.includes('&lt;script&gt;'));
  t('色に不正な値が来ても style に入れない', !html.includes('evil'));
  const evilId = PC.get('memos').find(m => m.id.includes('<img')).id;
  await act(PC, `deleteMemo(${JSON.stringify(evilId)})`);
  await sync(PC); await sync(SP);

  console.log('12. メンテナンスモード');
  await act(SP, 'toggleMaintenanceMode()');
  t('ON にすると帯が出る（健康アプリのメンテナンスモードとは別のキー）', SP.el('maintenance-banner').style.display === 'block' && SP.store[LS + 'maintenance_mode'] === 'on');
  PC.el('quick-date').value = '2026-11-08'; await act(PC, "quickPickCat('lcat_praise'); quickSave()");
  const n = SP.posts.length; await sync(SP);
  t('ON の間は受信し直さない', SP.posts.length === n && !SP.get('memos').some(m => m.date === '2026-11-08'));
  const SP2 = await boot('スマホ(再起動)', gas, SP.store);
  t('ON の間は起動時の受信もしない', SP2.posts.length === 0);
  await act(SP, 'toggleMaintenanceMode()'); await sync(SP);
  t('OFF に戻すと受信する', SP.get('memos').some(m => m.date === '2026-11-08') && SP.store[LS + 'maintenance_mode'] === undefined);

  console.log('13. 書き出し・読み込み');
  await act(PC, 'exportData()');
  const exp = JSON.parse(PC.lastExport);
  t('書き出しにメモ・カテゴリ・削除記録が入り、URLと合言葉は入らない', exp.app === 'ao-manabi-memo' && exp.memos.length === PC.get('memos').length && exp.categories.length === 4 && !!exp.deletedIds.memos && !PC.lastExport.includes('script.google.com') && !/"tok"/.test(PC.lastExport));
  const imp = async (app, obj) => { app.el('import-file').files = [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }]; app.ev("importData({ target: document.getElementById('import-file') })"); await settle(); app.runTimers(); await settle(); };
  const stateBefore = JSON.stringify([PC.get('memos'), PC.get('categories'), PC.get('deleted_ids')]);
  for (const [label, bad] of [
    ['JSONでないファイル', 'これはJSONではない'],
    ['健康アプリの書き出しファイル', { ver: 5, diary: [], learningMemos: [] }],
    ['日付の無いメモを含むファイル', { app: 'ao-manabi-memo', memos: [{ id: 'a', category: 'lcat_kintore' }], categories: [] }],
    ['idの無いメモを含むファイル', { app: 'ao-manabi-memo', memos: [{ date: '2026-11-01', category: 'lcat_kintore' }], categories: [] }],
    ['削除記録の形が違うファイル', { app: 'ao-manabi-memo', memos: [], categories: [], deletedIds: { memos: 'x' } }],
  ]) {
    const pn = PC.posts.length; await imp(PC, bad);
    t(label + 'は読み込まず、何も変えない', JSON.stringify([PC.get('memos'), PC.get('categories'), PC.get('deleted_ids')]) === stateBefore && PC.posts.length === pn);
  }
  // 書き出したあとで、1件を書き換え・1件を削除・1件を追加してから、書き出しファイルを読み込む
  const editTarget = PC.get('memos').find(m => m.title === '後ろ足の負重');
  await act(PC, `openEdit(${JSON.stringify(editTarget.id)})`);
  fill(PC, 'lme', { date: '2026-11-15', title: 'まちがえて書き換えた' }); await act(PC, "saveMemo('lme')");
  const delTarget = PC.get('memos').find(m => m.date === '2026-11-08');
  await act(PC, `deleteMemo(${JSON.stringify(delTarget.id)})`);
  PC.el('quick-date').value = '2026-11-07'; await act(PC, "quickPickCat('lcat_kintore'); quickSave()");
  PC.confirmAnswer = false; let pn = PC.posts.length; await imp(PC, exp);
  t('確認で「いいえ」なら読み込まない', PC.get('memos').find(m => m.id === editTarget.id).title === 'まちがえて書き換えた' && PC.posts.length === pn);
  PC.confirmAnswer = true; pn = PC.posts.length; await imp(PC, exp);
  const after = PC.get('memos');
  t('ファイルの内容で上書きされる（書き換えが元に戻る）', after.find(m => m.id === editTarget.id).title === '後ろ足の負重');
  t('ファイルに無いメモ（あとから追加した分）は残る', after.some(m => m.date === '2026-11-07'));
  t('削除したメモは読み込んでも戻らない', !after.some(m => m.id === delTarget.id) && PC.toasts[PC.toasts.length - 1].includes('削除済みのため見送り 1 件'), PC.toasts.slice(-2));
  const impPosts = PC.posts.slice(pn);
  t('読み込み中の個別の送信は0回で、終わったあとに全データ送信を1回だけ（force付き）', impPosts.length === 1 && impPosts[0].force === true && !!impPosts[0].data.deleted_ids, impPosts.map(p => Object.keys(p.data || p)));
  t('読み込み前の状態が自動バックアップに残る', Object.keys(PC.store).some(k => k.startsWith(LS + 'backup_') && k.includes('読み込み前')));
  t('読み込みのあとも、ふだんの保存は送信される（止めたままになっていない）', PC.ev('_importing') === false);
  await sync(SP);
  t('スマホ役にも、読み込みで戻した内容が届く', SP.get('memos').find(m => m.id === editTarget.id).title === '後ろ足の負重' && eq(ids(SP.get('memos')), ids(PC.get('memos'))));
  // バックアップを作れないときは中止
  await act(PC, `openEdit(${JSON.stringify(editTarget.id)})`);
  fill(PC, 'lme', { date: '2026-11-15', title: '2回目の書き換え' }); await act(PC, "saveMemo('lme')");
  PC.failSet = k => k.includes('backup_'); PC.expectErrors = true; pn = PC.posts.length;
  await imp(PC, exp);
  t('読み込み前のバックアップを作れないときは、読み込みを中止する', PC.get('memos').find(m => m.id === editTarget.id).title === '2回目の書き換え' && PC.posts.length === pn && PC.toasts[PC.toasts.length - 1].includes('中止'));
  PC.failSet = null; PC.expectErrors = false;

  console.log('14. 自動バックアップから戻す');
  await act(PC, 'showBackupModal()');
  const bname = Object.keys(PC.store).filter(k => k.startsWith(LS + 'backup_') && k.includes('読み込み前')).sort()[0].slice((LS + 'backup_').length);
  t('バックアップの一覧に件数つきで出る', PC.el('backup-list').innerHTML.includes('読み込み前') && PC.el('backup-list').innerHTML.includes('メモ '));
  await act(PC, `restoreFromBackup(${JSON.stringify(bname)})`);
  t('戻すと、その時点の内容に書き戻る', PC.get('memos').find(m => m.id === editTarget.id).title === 'まちがえて書き換えた');
  t('戻したあとも削除記録は減らない', PC.get('deleted_ids').memos.includes(delTarget.id));
  const bk = () => Object.keys(PC.store).filter(k => k.startsWith(LS + 'backup_')).sort();
  PC.ev('autoBackup()');
  t('その日の自動バックアップは1日1つ（開き直しても上書きしない）', (() => { const k = LS + 'backup_2026-11-16'; const v = PC.store[k]; PC.el('quick-date').value = '2026-11-03'; PC.ev("quickPickCat('lcat_kintore'); quickSave(); autoBackup()"); return !!v && PC.store[k] === v; })());
  for (let i = 1; i <= 6; i++) PC.store[LS + 'backup_2026-10-0' + i] = '{}';
  PC.ev('autoBackup()');
  t('自動バックアップは新しい順に5つまで（古いものから消える。健康アプリの autobackup_ には触らない）', bk().length === 5 && !bk().some(k => /2026-10-0[1-4]/.test(k)) && bk().some(k => k.endsWith('backup_2026-11-16')) && healthIntact(PC), bk());
  const day = 86400000;
  clock.t += day; PC.ev('autoBackup()');
  t('翌日：直近のバックアップと中身が違えば、その日の最初に開いたときに作る', bk().some(k => k.endsWith('backup_2026-11-17')) && bk().length === 5, bk());
  clock.t += day; PC.ev('autoBackup()');
  t('その次の日：中身が変わっていなければ作らない', !bk().some(k => k.endsWith('backup_2026-11-18')), bk());
  clock.t -= 2 * day;
  await sync(SP);

  console.log('15. 全データGAS同期');
  PC.toasts.length = 0; await act(PC, 'pushAllToCloud()');
  t('成功すると「全データ同期完了」', PC.toasts.some(m => m.startsWith('全データ同期完了')) && PC.posts[PC.posts.length - 1].force === true);
  PC.store[LS + 'sync_token'] = 'ちがう'; PC.toasts.length = 0; await act(PC, 'pushAllToCloud()');
  t('合言葉が違うときは失敗と表示し、送り直さない', PC.toasts.some(m => m.includes('合言葉を確認')) && !PC.toasts.some(m => m.startsWith('全データ同期完了')));
  PC.store[LS + 'sync_token'] = 'tok'; PC.runTimers();
  PC.offline = true; PC.toasts.length = 0; PC.ev('pushAllToCloud()'); PC.ev('pushAllToCloud()');
  for (let i = 0; i < 6; i++) { await settle(); PC.runTimers(); }
  t('通信できないときは失敗と表示。連打は1回にまとめる', PC.toasts.includes('同期中です。完了までお待ちください') && PC.toasts.some(m => m.includes('通信できず')));
  PC.offline = false;

  console.log('16. 保存できないとき（端末の保存領域がいっぱい）');
  PC.failSet = k => k === LS + 'memos'; PC.expectErrors = true; pn = PC.posts.length;
  const cnt = PC.get('memos').length;
  PC.el('quick-date').value = '2026-11-06'; await act(PC, "quickPickCat('lcat_kintore'); quickSave()");
  t('保存できなければGASへも送らず、「記録しました」とも出さない', PC.get('memos').length === cnt && PC.posts.length === pn && !PC.toasts[PC.toasts.length - 1].includes('記録しました'));
  t('消えない帯で知らせる', PC.el('storage-error-banner').style.display === 'block');
  PC.failSet = null; PC.expectErrors = false; await act(PC, 'quickPickCat(_quickCat)');

  console.log('17. データの消えた端末が、URLと合言葉を入れ直したとき');
  // 利用者がカテゴリの名前を変えた状態をGASに作る（初期カテゴリと同じidで、時刻が新しい）
  gas.post({ bulk: true, data: { categories: gas.all().categories.map(c => c.id === 'lcat_praise' ? Object.assign({}, c, { label: 'プレイズタッチ®', _ts: 99 }) : c) } });
  const gBefore = JSON.stringify(gas.all());
  const WIPED = await boot('消えた端末', gas, Object.assign({}, READY));
  t('初期カテゴリ（時刻0）は、GASの本物を上書きしない', JSON.stringify(gas.all()) === gBefore && WIPED.get('categories').find(c => c.id === 'lcat_praise').label === 'プレイズタッチ®');
  t('メモと追加カテゴリがすべて戻る', eq(ids(WIPED.get('memos')), ids(gas.all().memos)) && WIPED.get('categories').length === 4);
  t('消えた端末は、GASへ何も書き込まない', WIPED.posts.every(p => p.action === 'getAll'), WIPED.posts);

  console.log('18. 応答を受け取れなかった保存');
  PC.dropResponse = true; PC.expectErrors = true;
  PC.el('quick-date').value = '2026-11-05'; await act(PC, "quickPickCat('lcat_massage'); quickSave()");
  PC.dropResponse = false; PC.expectErrors = false;
  t('応答を受け取れなかった保存は、端末には残っている', PC.get('memos').some(m => m.date === '2026-11-05'));
  await sync(PC);
  t('次に同期できたときに、GASへ届く', gas.all().memos.some(m => m.date === '2026-11-05'));

  console.log('19. カテゴリの名前変更');
  await sync(PC); await sync(SP); await sync(PC);
  const labels = (app) => JSON.parse(app.ev('JSON.stringify(_sortedCategories().map(c => c.label))'));
  const catIds = (app) => JSON.parse(app.ev('JSON.stringify(_sortedCategories().map(c => c.id))'));
  const gasCatIds = () => gas.all().categories.map(c => c.id).sort();
  const memoSnap = (app) => JSON.stringify(app.get('memos').map(m => [m.id, m.category, m._ts]).sort());
  const settleAll = async () => { await sync(PC); await sync(SP); await sync(PC); await sync(SP); };
  const quick = async (app, date, cat) => { app.el('quick-date').value = date; await act(app, `quickPickCat(${JSON.stringify(cat)}); quickSave()`); return app.get('memos').slice(-1)[0]; };
  {
    const before = memoSnap(PC); const nKin = PC.get('memos').filter(m => m.category === 'lcat_kintore').length;
    PC.promptAnswer = '  後ろ足トレーニング  '; await act(PC, "showCatModal(); catRename('lcat_kintore')");
    t('名前が変わり、メモそのものは変わらない（メモはカテゴリの id を持つだけ）', labels(PC).includes('後ろ足トレーニング') && !labels(PC).includes('筋トレ') && memoSnap(PC) === before && nKin > 0);
    PC.ev('closeCatModal()');
    t('そのカテゴリのメモ・絞り込み・日付だけ記録が、すべて新しい名前で表示される', PC.el('memo-list').innerHTML.includes('後ろ足トレーニング') && !PC.html().includes('筋トレ</') && PC.el('filter-bar').innerHTML.includes('後ろ足トレーニング') && PC.el('quick-container').innerHTML.includes('後ろ足トレーニング'));
    await sync(SP);
    t('名前の変更がスマホ役に伝わる', labels(SP).includes('後ろ足トレーニング') && SP.el('memo-list').innerHTML.includes('後ろ足トレーニング') && memoSnap(SP) === before);
    PC.toasts.length = 0; PC.promptAnswer = 'マッサージ'; await act(PC, "catRename('lcat_kintore')");
    PC.promptAnswer = '   '; await act(PC, "catRename('lcat_kintore')");
    PC.promptAnswer = null; await act(PC, "catRename('lcat_kintore')");
    t('同じ名前・空の名前・キャンセルでは変わらない', PC.toasts.includes('同じ名前のカテゴリがすでにあります') && PC.toasts.includes('名前を入力してください') && labels(PC).includes('後ろ足トレーニング'));
  }

  console.log('20. カテゴリの並べ替え');
  {
    const before = catIds(PC); const last = before[before.length - 1];
    PC.posts.length = 0; await act(PC, `catMove(${JSON.stringify(before[0])}, -1)`);
    t('一番上を「上へ」しても何も起きない（送信もしない）', eq(catIds(PC), before) && PC.posts.length === 0);
    await act(PC, `catMove(${JSON.stringify(last)}, -1)`); await act(PC, `catMove(${JSON.stringify(last)}, -1)`); await act(PC, `catMove(${JSON.stringify(last)}, -1)`);
    const want = [last].concat(before.slice(0, -1));
    t('一番下のカテゴリを一番上まで動かせる', eq(catIds(PC), want), catIds(PC));
    const pos = (app, id) => labels(app).map(l => app.el(id).innerHTML.indexOf('>' + l + '<'));
    const asc = (arr) => arr.every((v, i) => v >= 0 && (i === 0 || arr[i - 1] < v));
    const pe = PC.get('memos').find(m => m.category === 'lcat_kintore');
    await act(PC, 'toggleForm()');
    t('日付だけ記録・くわしく書く・絞り込みのチップが、その順番で並ぶ', asc(pos(PC, 'quick-container')) && asc(pos(PC, 'form-container')) && asc(pos(PC, 'filter-bar')), [pos(PC, 'quick-container'), pos(PC, 'form-container'), pos(PC, 'filter-bar')]);
    await act(PC, 'toggleForm()');
    const m20a = await quick(PC, PC.ev('todayKey()'), last); const m20b = await quick(PC, PC.ev('todayKey()'), 'lcat_kintore');
    const sp = labels(PC).map(l => PC.el('summary').innerHTML.indexOf(l + ' <b>')).filter(v => v >= 0);
    t('今月の学びの表示も、その順番で並ぶ', sp.length >= 2 && asc(sp), sp);
    await sync(SP);
    t('並び順がスマホ役に伝わる', eq(catIds(SP), want) && asc(pos(SP, 'filter-bar')));
    // 別々の端末で、名前の変更と並べ替えを同時に行う（互いを知らないまま）
    PC.promptAnswer = 'マッサージ（改）'; await act(PC, "catRename('lcat_massage')");
    await act(SP, "catMove('lcat_massage', 1)");
    const spOrder = catIds(SP);
    await settleAll();
    t('PCの名前変更とスマホの並べ替えが、両方とも残る', labels(PC).includes('マッサージ（改）') && eq(catIds(PC), spOrder) && eq(catIds(SP), spOrder) && eq(labels(PC), labels(SP)), [labels(PC), labels(SP), spOrder]);
    PC.posts.length = 0; SP.posts.length = 0; await sync(PC); await sync(SP);
    t('落ち着いたあとは、受信しても書き戻しが出ない', PC.posts.concat(SP.posts).every(p => p.action === 'getAll'));
  }

  console.log('21. カテゴリの削除（メモが0件）');
  {
    SP.promptAnswer = 'いらないカテゴリ'; await act(SP, "addCategory('quick')"); await act(SP, 'quickPickCat(_quickCat)');
    const junk = SP.get('categories').find(c => c.label === 'いらないカテゴリ').id;
    await sync(PC);
    PC.confirmAnswer = false; await act(PC, `showCatModal(); catDelete(${JSON.stringify(junk)})`);
    t('確認で「いいえ」なら消えない', catIds(PC).includes(junk));
    PC.confirmAnswer = true; PC.confirms.length = 0; const nMemo = PC.get('memos').length;
    await act(PC, `setFilter(${JSON.stringify(junk)}); catDelete(${JSON.stringify(junk)})`);
    t('0件のカテゴリは、確認のあとすぐ消える（メモは1件も変わらない）', !catIds(PC).includes(junk) && PC.confirms.length === 1 && PC.get('memos').length === nMemo && PC.get('deleted_ids').categories.includes(junk));
    t('消したカテゴリで絞り込み中だったら、絞り込みが外れる', PC.ev('_filterCat') === null);
    PC.ev('closeCatModal()');
    await settleAll(); await settleAll();
    t('削除がスマホ役に伝わり、同期を重ねても復活しない（GASにも無い）', !catIds(SP).includes(junk) && !catIds(PC).includes(junk) && !gasCatIds().includes(junk) && gas.all().deleted_ids.categories.includes(junk));
  }

  console.log('22. カテゴリの削除（メモがある → 移してから消す）');
  {
    const from = 'lcat_massage', to = 'lcat_kintore';
    await quick(PC, '2026-10-03', from); await sync(SP);
    const moved = ids(PC.get('memos').filter(m => m.category === from)); const allIds = ids(PC.get('memos'));
    await act(PC, `showCatModal(); catDelete(${JSON.stringify(from)})`);
    t('メモのあるカテゴリは、すぐには消えず「◯件のメモがあります。どのカテゴリに移しますか？」と聞く', catIds(PC).includes(from) && PC.el('cat-list').innerHTML.includes('<b>' + moved.length + '件</b> のメモがあります。どのカテゴリに移しますか？') && moved.length > 0);
    PC.toasts.length = 0; await act(PC, 'catDeleteConfirm()');
    t('移し先を選ばないと消せない', catIds(PC).includes(from) && PC.toasts.includes('移し先のカテゴリを選んでください') && eq(ids(PC.get('memos').filter(m => m.category === from)), moved));
    await act(PC, 'catDeleteCancel()');
    t('「やめる」で元に戻る', catIds(PC).includes(from) && !PC.el('cat-list').innerHTML.includes('どのカテゴリに移しますか'));
    await act(PC, `catDelete(${JSON.stringify(from)}); catDeletePickTarget(${JSON.stringify(to)}); catDeleteConfirm()`);
    t('移し先を選ぶと、メモを移してからカテゴリが消える（メモは1件も消えない）', !catIds(PC).includes(from) && eq(ids(PC.get('memos')), allIds) && moved.every(id => PC.get('memos').find(m => m.id === id).category === to) && PC.get('deleted_ids').categories.includes(from), PC.toasts.slice(-1));
    PC.ev('closeCatModal()');
    await sync(SP);
    t('移したメモが、スマホ役にも新しいカテゴリで伝わる', eq(ids(SP.get('memos')), allIds) && moved.every(id => SP.get('memos').find(m => m.id === id).category === to) && !catIds(SP).includes(from));
    await settleAll();
    t('同期を重ねても、消したカテゴリは復活せず、メモは移し先のまま（GASも同じ）', !gasCatIds().includes(from) && !catIds(PC).includes(from) && !catIds(SP).includes(from) && moved.every(id => gas.all().memos.find(m => m.id === id).category === to) && eq(ids(gas.all().memos), allIds));
    t('カテゴリなしのメモは出ていない', PC.ev('_orphanCount()') === 0 && SP.ev('_orphanCount()') === 0 && !PC.el('filter-bar').innerHTML.includes('カテゴリなし'));
  }

  console.log('23. 片方でカテゴリを消しているあいだに、もう片方でそのカテゴリを使った場合');
  {
    PC.promptAnswer = 'お試し'; await act(PC, "addCategory('quick')"); await act(PC, 'quickPickCat(_quickCat)');
    const X = PC.get('categories').find(c => c.label === 'お試し').id;
    const mx = await quick(PC, '2026-09-01', X);
    await settleAll();
    // PC：X を消してメモを移す。スマホ：それを知らないまま、X にメモを書き、別のカテゴリも足す（古い一覧でGASを上書きする）
    await act(PC, `showCatModal(); catDelete(${JSON.stringify(X)}); catDeletePickTarget('lcat_kintore'); catDeleteConfirm(); closeCatModal()`);
    const late = await quick(SP, SP.ev('todayKey()'), X);
    SP.promptAnswer = 'あとから足した'; await act(SP, "addCategory('quick')"); await act(SP, 'quickPickCat(_quickCat)');
    t('スマホが古い一覧のまま保存しても、消したカテゴリはGASに戻らない', !gasCatIds().includes(X) && !catIds(SP).includes(X));
    const total = new Set(PC.get('memos').map(m => m.id).concat(SP.get('memos').map(m => m.id))).size;
    await settleAll(); await settleAll();
    t('消したカテゴリは、どの端末にもGASにも復活しない', !catIds(PC).includes(X) && !catIds(SP).includes(X) && !gasCatIds().includes(X));
    t('メモは1件も消えない（スマホで書いたメモも両方にある）', PC.get('memos').length === total && SP.get('memos').length === total && PC.get('memos').some(m => m.id === late.id) && PC.get('memos').find(m => m.id === mx.id).category === 'lcat_kintore');
    t('スマホが足したカテゴリは残る', labels(PC).includes('あとから足した') && labels(SP).includes('あとから足した'));
    for (const app of [PC, SP]) { app.ev('_monthOpen = {}; _filterCat = null; _filterStub = false; renderAll()'); }
    t('存在しないカテゴリのメモは「カテゴリなし」として一覧に出る（見えなくならない）', [PC, SP].every(app => app.ev('_orphanCount()') === 1 && app.el('memo-list').innerHTML.includes('>カテゴリなし<') && app.el('memo-list').innerHTML.includes('🏷 カテゴリを選ぶ')));
    t('絞り込みに「カテゴリなし（1）」が出て、今月の学びにも数えられる', [PC, SP].every(app => app.el('filter-bar').innerHTML.includes('カテゴリなし（1）') && app.el('summary').innerHTML.includes('カテゴリなし <b>1</b>回')));
    await act(PC, 'setFilter(NO_CAT)');
    t('「カテゴリなし」で絞り込むと、そのメモだけが出る', JSON.parse(PC.ev('JSON.stringify(_filteredMemos().map(m => m.id))')).join() === late.id);
    PC.toasts.length = 0; await act(PC, `openEdit(${JSON.stringify(late.id)}); saveMemo('lme')`);
    t('カテゴリなしのメモを開くと、カテゴリは未選択。選ばないと保存できない', PC.toasts.includes('カテゴリを選んでください') && PC.ev('_editCat') === null);
    await act(PC, "editPickCat('lcat_praise'); saveMemo('lme')");
    t('カテゴリを選び直して保存すると「カテゴリなし」が消え、絞り込みも外れる', PC.ev('_orphanCount()') === 0 && !PC.el('filter-bar').innerHTML.includes('カテゴリなし') && PC.ev('_filterCat') === null && PC.get('memos').find(m => m.id === late.id).category === 'lcat_praise');
    await sync(SP);
    t('選び直したカテゴリがスマホ役に伝わる', SP.get('memos').find(m => m.id === late.id).category === 'lcat_praise' && SP.ev('_orphanCount()') === 0);
  }

  console.log('24. 2台が、互いのカテゴリを移し先にして同時に消した場合');
  {
    PC.promptAnswer = 'カテA'; await act(PC, "addCategory('quick')"); await act(PC, 'quickPickCat(_quickCat)');
    PC.promptAnswer = 'カテB'; await act(PC, "addCategory('quick')"); await act(PC, 'quickPickCat(_quickCat)');
    const A = PC.get('categories').find(c => c.label === 'カテA').id, B = PC.get('categories').find(c => c.label === 'カテB').id;
    const ma = await quick(PC, '2026-08-01', A), mb = await quick(PC, '2026-08-02', B);
    await settleAll();
    const total = PC.get('memos').length;
    await act(PC, `showCatModal(); catDelete(${JSON.stringify(A)}); catDeletePickTarget(${JSON.stringify(B)}); catDeleteConfirm(); closeCatModal()`);
    await act(SP, `showCatModal(); catDelete(${JSON.stringify(B)}); catDeletePickTarget(${JSON.stringify(A)}); catDeleteConfirm(); closeCatModal()`);
    await settleAll(); await settleAll();
    t('両方のカテゴリが消え、メモは1件も消えない（カテゴリなしとして残る）', !catIds(PC).includes(A) && !catIds(PC).includes(B) && eq(catIds(PC), catIds(SP)) && PC.get('memos').length === total && SP.get('memos').length === total && [ma.id, mb.id].every(id => PC.get('memos').some(m => m.id === id) && SP.get('memos').some(m => m.id === id)) && PC.ev('_orphanCount()') === 2 && SP.ev('_orphanCount()') === 2, [PC.ev('_orphanCount()'), SP.ev('_orphanCount()')]);
    for (const id of [ma.id, mb.id]) await act(PC, `openEdit(${JSON.stringify(id)}); editPickCat('lcat_kintore'); saveMemo('lme')`);
    await settleAll();
    t('選び直せば元どおり（両端末とも、カテゴリなしが0件）', PC.ev('_orphanCount()') === 0 && SP.ev('_orphanCount()') === 0);
  }

  console.log('25. 最後の1つは消せない・整理の画面を開いているあいだは受信しない');
  {
    const L = await boot('1台だけ', gas, {});   // 同期を設定していない端末
    L.confirmAnswer = true;
    await act(L, "showCatModal(); catDelete('lcat_kintore'); catDelete('lcat_massage')");
    L.toasts.length = 0; await act(L, "catDelete('lcat_praise')");
    t('最後の1つのカテゴリは消せない', eq(catIds(L), ['lcat_praise']) && L.toasts.includes('最後の1つのカテゴリは削除できません') && L.el('cat-list').innerHTML.includes('最後の1つのカテゴリは削除できません') && /class="del" disabled/.test(L.el('cat-list').innerHTML));
    L.ev('closeCatModal()');
    await act(PC, 'showCatModal()'); PC.posts.length = 0; PC.el('cat-modal').style.display = 'flex';
    await sync(PC);
    t('整理の画面を開いているあいだは、受信し直さない（操作の途中で一覧が入れ替わらない）', PC.posts.length === 0);
    PC.ev('closeCatModal()'); PC.el('cat-modal').style.display = 'none';
    await settleAll();
    t('カテゴリの一覧と並び順が、PC役・スマホ役で一致し、GASとも中身が同じ', eq(catIds(PC), catIds(SP)) && eq(labels(PC), labels(SP)) && eq(catIds(PC).slice().sort(), gasCatIds()) && JSON.stringify(PC.get('categories').slice().sort((a, b) => a.id < b.id ? -1 : 1)) === JSON.stringify(gas.all().categories.slice().sort((a, b) => a.id < b.id ? -1 : 1)));
    t('削除記録（カテゴリ）もGASと一致', eq(PC.get('deleted_ids').categories.slice().sort(), gas.all().deleted_ids.categories.slice().sort()) && eq(SP.get('deleted_ids').categories.slice().sort(), gas.all().deleted_ids.categories.slice().sort()));
  }


  console.log('26. 古い内容を表示している端末での保存（2026-11-16 実機で起きた場面）');
  {
    await settleAll();
    const gLabel = (id) => (gas.all().categories.find(c => c.id === id) || {}).label;
    const lab = (app, id) => app.ev(`(_catById(${JSON.stringify(id)}) || {}).label`);
    const K = 'lcat_kintore'; const orig = lab(PC, K);
    // 名前を変えて元に戻す。スマホは「変えた名前」を受け取ったあと、戻したことを知らないまま並べ替える
    PC.promptAnswer = '筋トレ2'; await act(PC, `showCatModal(); catRename(${JSON.stringify(K)}); closeCatModal()`);
    await sync(SP);
    t('（前提）スマホ役に「筋トレ2」が届いている', lab(SP, K) === '筋トレ2');
    PC.promptAnswer = orig; await act(PC, `showCatModal(); catRename(${JSON.stringify(K)}); closeCatModal()`);
    t('（前提）PCで元の名前に戻し、GASも元の名前。スマホ役はまだ「筋トレ2」を表示', gLabel(K) === orig && lab(SP, K) === '筋トレ2');
    const lastId = catIds(SP).slice(-1)[0];
    SP.ev(`catMove(${JSON.stringify(lastId)}, -1)`);   // 整理の画面を開かずに操作した場合（開いたときの受信に頼らない確認）
    await settle(); SP.runTimers(); await settle();
    t('スマホ役で並べ替えても、GASの名前は古い方に戻らない', gLabel(K) === orig, gLabel(K));
    t('スマホ役の表示も、その場で元の名前に揃う（PCの再読み込みを待たない）', lab(SP, K) === orig && SP.el('filter-bar').innerHTML.includes('>' + orig + '<') && !SP.el('filter-bar').innerHTML.includes('筋トレ2'));
    t('スマホ役の並べ替えはGASに入っている', eq(gas.all().categories.slice().sort((a, b) => a.order - b.order).map(c => c.id), catIds(SP)));
    await sync(PC);
    t('PC役は1回の受信で、名前はそのまま・並び順はスマホ役と同じになる（書き戻しも不要）', lab(PC, K) === orig && eq(catIds(PC), catIds(SP)) && PC.posts.slice(-1)[0].action === 'getAll');
    // 名前を変えてすぐ、もう1台で並べ替える（スマホは変更を受け取っていない）
    PC.promptAnswer = '筋トレ（新）'; await act(PC, `showCatModal(); catRename(${JSON.stringify(K)}); closeCatModal()`);
    const first = catIds(SP)[0];
    SP.ev(`catMove(${JSON.stringify(first)}, 1)`); await settle(); SP.runTimers(); await settle();
    const spOrder = catIds(SP);
    t('名前を変えてすぐ、もう1台で並べ替えても、名前の変更は消えず、並べ替えも入る', gLabel(K) === '筋トレ（新）' && lab(SP, K) === '筋トレ（新）' && eq(gas.all().categories.slice().sort((a, b) => a.order - b.order).map(c => c.id), spOrder));
    await sync(PC);
    t('PC役にも並び順が届き、名前は新しいまま', lab(PC, K) === '筋トレ（新）' && eq(catIds(PC), spOrder));
    // 整理の画面を開くと、その時点の最新を受け取る
    PC.promptAnswer = orig; await act(PC, `showCatModal(); catRename(${JSON.stringify(K)}); closeCatModal()`);
    await act(SP, 'showCatModal()');
    t('整理の画面を開くと最新を受け取り、開いたままの一覧にも新しい名前が出る', lab(SP, K) === orig && SP.el('cat-list').innerHTML.includes('>' + orig + '<'));
    SP.ev('closeCatModal()');
    // 続けて何度も押した場合（1回目の同期の最中に次の保存が入る）
    const o0 = catIds(SP);
    SP.ev(`catMove(${JSON.stringify(o0[o0.length - 1])}, -1); catMove(${JSON.stringify(o0[o0.length - 1])}, -1); catMove(${JSON.stringify(o0[0])}, 1)`);
    await settle(); SP.runTimers(); await settle();
    t('続けて3回並べ替えても、最後の並びがGASに入る（途中の同期に取りこぼされない）', eq(gas.all().categories.slice().sort((a, b) => a.order - b.order).map(c => c.id), catIds(SP)) && !eq(catIds(SP), o0));
    // メモでも同じ：PCの編集を知らないスマホが別のメモを保存しても、PCの編集がGASから消えない
    const target = PC.get('memos')[0];
    await act(PC, `openEdit(${JSON.stringify(target.id)})`); PC.el('lme-title').value = 'PCで直したタイトル';
    if (!PC.ev('_editCat')) PC.ev("editPickCat('lcat_kintore')");
    await act(PC, "saveMemo('lme')");
    await quick(SP, '2026-07-07', 'lcat_kintore');
    t('メモも同じ：PCの編集を知らないスマホが別のメモを保存しても、PCの編集はGASに残り、スマホにもその場で届く', gas.all().memos.find(m => m.id === target.id).title === 'PCで直したタイトル' && SP.get('memos').find(m => m.id === target.id).title === 'PCで直したタイトル');
    // メンテナンスモード中は受信しないので、従来どおりそのまま送る
    SP.ev('setMaintenanceMode(true)'); SP.posts.length = 0;
    await quick(SP, '2026-07-08', 'lcat_kintore');
    t('メンテナンスモード中の保存は、受信せずにそのまま送る（従来どおり）', SP.posts.length === 1 && SP.posts[0].bulk === true && eq(Object.keys(SP.posts[0].data), ['memos', '_ts_memos']));
    SP.ev('setMaintenanceMode(false)');
    await settleAll();
  }

  await sync(PC); await sync(SP);
  t('最後に：PC役・スマホ役・GASのメモがすべて一致', eq(ids(PC.get('memos')), ids(SP.get('memos'))) && eq(ids(PC.get('memos')), ids(gas.all().memos)), [PC.get('memos').length, SP.get('memos').length, gas.all().memos.length]);
  t('最後に：削除記録も一致', eq(PC.get('deleted_ids').memos.slice().sort(), gas.all().deleted_ids.memos.slice().sort()) && eq(SP.get('deleted_ids').memos.slice().sort(), gas.all().deleted_ids.memos.slice().sort()));
  t('最後に：健康アプリのキーは、どの端末でも変わっていない', healthIntact(PC) && healthIntact(SP));
  t('最後に：想定外のエラーが出ていない', errors.length === 0, errors);
  finish();
})().catch(e => { console.error(e); process.exit(1); });
