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
  const pair = PC.posts[PC.posts.length - 1];
  t('保存1回＝送信1回（本体と時刻の組）', pair.bulk === true && eq(Object.keys(pair.data), ['memos', '_ts_memos']) && String(pair.data._ts_memos) === PC.store[LS + 'ts_memos']);
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
  t('あとから保存したスマホ役の一覧でGASが上書きされ、PC役のメモがGASから欠ける（想定どおり）', gas.all().memos.length === 3 && !gas.all().memos.some(m => m.date === '2026-11-10'));
  await sync(PC);
  t('PC役の次の受信で、欠けたメモが書き戻され、スマホ役のメモも受け取る', gas.all().memos.length === 4 && PC.get('memos').length === 4);
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
  t('（スマホ役の保存で、消したメモがいったんGASに戻る）', gas.all().memos.some(m => m.id === delId));
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
  t('その日の自動バックアップは1日1つ（開き直しても上書きしない）', (() => { const k = LS + 'backup_2026-11-16'; const v = PC.store[k]; PC.ev('autoBackup()'); return !!v && PC.store[k] === v; })());
  PC.store[LS + 'backup_2026-11-01'] = '{}'; PC.ev('autoBackup()');
  t('7日より古い自動バックアップは消える（健康アプリの autobackup_ には触らない）', PC.store[LS + 'backup_2026-11-01'] === undefined && healthIntact(PC));
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
  t('応答が読めなくても、GASには書き込まれている', gas.all().memos.some(m => m.date === '2026-11-05'));
  await sync(PC); await sync(SP);
  t('最後に：PC役・スマホ役・GASのメモがすべて一致', eq(ids(PC.get('memos')), ids(SP.get('memos'))) && eq(ids(PC.get('memos')), ids(gas.all().memos)), [PC.get('memos').length, SP.get('memos').length, gas.all().memos.length]);
  t('最後に：削除記録も一致', eq(PC.get('deleted_ids').memos.slice().sort(), gas.all().deleted_ids.memos.slice().sort()) && eq(SP.get('deleted_ids').memos.slice().sort(), gas.all().deleted_ids.memos.slice().sort()));
  t('最後に：健康アプリのキーは、どの端末でも変わっていない', healthIntact(PC) && healthIntact(SP));
  t('最後に：想定外のエラーが出ていない', errors.length === 0, errors);
  finish();
})().catch(e => { console.error(e); process.exit(1); });
