/* お湯de除草 スモークテスト
   基本動作(注ぐ/タップ/パネル/ショップ/省電力/モバイルHUD)の回帰確認。
   使い方: node tools/smoketest.js */
const { launch, INDEX } = require('./_launch');

(async () => {
  const browser = await launch();
  const results = [];
  const t = (name, cond) => results.push([name, !!cond]);
  // 固定待ちだと初回起動の遅い環境(CI・並列実行)で落ちるので、条件をポーリングして待つ。
  // タイムアウトしても例外にせず、直後の t() の評価に判定を委ねる
  const waitFor = (page, fn, timeout = 5000) =>
    page.waitForFunction(fn, null, { timeout }).catch(() => {});

  // ---------- デスクトップ基本動作 ----------
  {
    const ctx2 = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 720 } });
    await ctx2.addInitScript(() => {
      localStorage.setItem('oyu_onboarded', '1');
      localStorage.setItem('oyu_totalKilled', '500');
    });
    const page = await ctx2.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(INDEX);
    await waitFor(page, () => typeof weeds !== 'undefined' && weeds.length > 30);
    await page.evaluate(() => closePanel());

    t('草が生えている', await page.evaluate(() => weeds.length > 30));
    // 実写の葉テクスチャの読み込み(壊れたdata URIだと無音でテクスチャなしに劣化するため)
    t('葉の実写テクスチャが読み込まれている', await page.evaluate(() =>
      GRASS_TEX.complete && GRASS_TEX.naturalWidth > 0));

    // 長押しで注ぐ → やかんが出て草に熱湯がかかる
    // (着水点は指のワールド座標から(-36,+40)。実在の草を狙う)
    const aim = await page.evaluate(() => {
      const w = weeds.find((x) => !x.removing && x.wither < 1 && x.x > 120 && x.x < W - 60);
      return { x: (w.x + 36) * ZOOM, y: (w.y - 40) * ZOOM };
    });
    await page.mouse.move(aim.x, aim.y);
    await page.mouse.down();
    await waitFor(page, () => pour.started);
    t('長押しでやかんが出る', await page.evaluate(() => pour.started));
    await waitFor(page, () => weeds.some((w) => w.scald > 0.1));
    t('お湯で草に熱が入る', await page.evaluate(() => weeds.some((w) => w.scald > 0.1)));
    await page.mouse.up();

    // タップで枯れ草を片付け → 除草数が増える
    const husk = await page.evaluate(() => {
      const w = weeds.find((x) => !x.removing && x.wither < 1);
      w.wither = 1;
      return { x: w.x * ZOOM, y: w.y * ZOOM, before: totalKilled };
    });
    await page.mouse.move(husk.x, husk.y, { steps: 4 });
    await page.mouse.down();
    await page.waitForTimeout(35);
    await page.mouse.up();
    await page.waitForFunction((b) => totalKilled > b, husk.before, { timeout: 5000 })
      .catch(() => {});
    t('タップで枯れ草が片付き除草数が増える',
      await page.evaluate((b) => totalKilled > b, husk.before));

    // 全パネルが開く
    for (const [btn, panel] of [
      ['helpBtn', 'helpPanel'], ['bookBtn', 'bookPanel'], ['kettleBtn', 'kettlePanel'],
      ['shopBtn', 'shopPanel'], ['settingsBtn', 'settingsPanel'],
    ]) {
      await page.click('#' + btn);
      t(`パネル ${panel} が開く`, await page.evaluate(
        (p) => !document.getElementById(p).classList.contains('hidden'), panel));
      await page.evaluate(() => closePanel());
    }

    // 設定パネルにアップデート情報が載っている
    t('設定にアップデート情報が表示される', await page.evaluate(() => {
      const rows = document.querySelectorAll('#updatesList .updrow');
      return rows.length >= 10 &&
        /^\d{4}-\d{2}-\d{2}$/.test(rows[0].querySelector('.d').textContent) &&
        rows[0].querySelector('.t').textContent.length > 3;
    }));

    // ショップ購入 → ポイント減・設置・保存
    await page.click('#shopBtn');
    await page.click('#shopList .shopbuy[data-kind="kettle"]');
    t('自動やかんを購入できる', await page.evaluate(() =>
      autoKettles.length === 1 && spentPoints === 50 &&
      JSON.parse(localStorage.getItem('oyu_autoItems')).kettle.length === 1));
    t('HUDにポイントが表示される', await page.evaluate(() =>
      document.getElementById('pts').textContent === `${points()}pt`));
    await page.evaluate(() => closePanel());

    // 図鑑が最下段までスクロールできる
    await page.click('#bookBtn');
    t('図鑑を最下段までスクロールできる', await page.evaluate(() => {
      const p = document.getElementById('bookPanel');
      p.scrollTop = p.scrollHeight;
      const cards = p.querySelectorAll('.card');
      const last = cards[cards.length - 1].getBoundingClientRect();
      return cards.length === 13 && last.bottom <= p.getBoundingClientRect().bottom + 2;
    }));
    await page.evaluate(() => closePanel());

    // つむじ風: 枯れ草をまとめて片付ける
    await page.evaluate(() => {
      sweeperLevel = 1;
      let n = 0;
      for (const w of weeds) if (!w.removing && w.wither < 1 && n < 6) { w.wither = 1; n++; }
      sweeperTimer = 0.05;
    });
    await waitFor(page, () => !weeds.some((w) => w.wither >= 1 && !w.removing), 8000);
    t('つむじ風が枯れ草をまとめて片付ける', await page.evaluate(() =>
      !weeds.some((w) => w.wither >= 1 && !w.removing)));
    await page.evaluate(() => { sweeperLevel = 0; });   // 以降のテストを乱さない

    // からくりヤギ: 枯れ草を食べて除草数が増える
    const goatBefore = await page.evaluate(() => {
      const w = weeds.find((x) => !x.removing && x.wither < 1);
      w.wither = 1;
      placeAutoItem('goat', { x: w.x + 22, y: w.y });
      return totalKilled;
    });
    await page.waitForFunction((b) => totalKilled > b, goatBefore, { timeout: 12000 })
      .catch(() => {});
    t('からくりヤギが枯れ草を食べて除草数が増える',
      await page.evaluate((b) => totalKilled > b, goatBefore));

    // 庭づくり(苔石・池): 購入 → 設置 → 範囲内の草が片付く → 生えなくなる
    await page.evaluate(() => { totalKilled = 20000; updateHud(); });   // クリア後想定
    await page.click('#shopBtn');
    await page.click('#shopList .shopbuy[data-kind="stone"]');
    await page.click('#shopList .shopbuy[data-kind="pond"]');
    t('苔石と池を購入・設置できる', await page.evaluate(() =>
      gardenStones.length === 1 && ponds.length === 1 &&
      JSON.parse(localStorage.getItem('oyu_autoItems')).pond.length === 1));
    // 実写苔テクスチャの読み込み(壊れたdata URIだと無音でテクスチャなしに劣化するため)
    t('苔庭の実写テクスチャが読み込まれている', await page.evaluate(() =>
      MOSS_TEX.complete && MOSS_TEX.naturalWidth > 0));
    await page.evaluate(() => closePanel());
    t('飾りの範囲の草が片付いていく', await page.evaluate(() =>
      weeds.every((w) => w.removing || !inDecoration(w.x, w.y))));
    // 苔庭(約3割)+池(約5割)で画面の過半が草よけになっている
    t('苔庭+池が画面の6〜8割を占める', await page.evaluate(() => {
      let inside = 0, total = 0;
      for (let gx = 10; gx < W; gx += 12) {
        for (let gy = 44; gy < H; gy += 12) {
          total++;
          if (inDecoration(gx, gy)) inside++;
        }
      }
      const frac = inside / total;
      return frac > 0.55 && frac < 0.85;
    }));
    // 20分ぶん早回ししても、飾りの範囲には草が生えない
    t('飾りの範囲には草が生えない(早回し20分)', await page.evaluate(() => {
      let simT = 5000;
      for (let i = 0; i < 12000; i++) { update(0.1, simT); simT += 0.1; }
      return !weeds.some((w) => !w.removing && inDecoration(w.x, w.y));
    }));

    // リセットで記録・設置物・飾りが全部消える
    await page.click('#helpBtn');
    await page.click('#resetBtn');
    await page.click('#resetBtn');
    await page.waitForTimeout(200);
    t('リセットで記録と設置物が消える', await page.evaluate(() =>
      totalKilled === 0 && spentPoints === 0 && autoKettles.length === 0 &&
      gardenStones.length === 0 && ponds.length === 0));

    t('デスクトップ: ページエラーなし', errors.length === 0);
    await ctx2.close();
  }

  // ---------- モバイル(390x844, DPR3, タッチ) ----------
  {
    const ctx3 = await browser.newContext({
      locale: 'ja-JP', viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3, hasTouch: true,
    });
    await ctx3.addInitScript(() => {
      localStorage.setItem('oyu_onboarded', '1');
      localStorage.setItem('oyu_totalKilled', '1234');
    });
    const page = await ctx3.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(INDEX);
    await waitFor(page, () => window.weeds && canvas.width > 0);
    await page.evaluate(() => closePanel());

    t('モバイル: 5ボタンが44px以上で画面内に収まる', await page.evaluate(() =>
      ['helpBtn', 'bookBtn', 'kettleBtn', 'shopBtn', 'settingsBtn'].every((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return r.width >= 44 && r.right <= window.innerWidth + 1 && r.left >= 0;
      })));
    t('モバイル: 統計がはみ出さない', await page.evaluate(() =>
      document.getElementById('stats').getBoundingClientRect().right <= window.innerWidth));

    // 省電力モード: 解像度が DPR2 → 1.5 に落ちる
    t('モバイル: 通常時はDPR2', await page.evaluate(() => canvas.width === 390 * 2));
    await page.click('#settingsBtn');
    await page.click('#psToggle');
    t('省電力ONで解像度がDPR1.5に下がる', await page.evaluate(() => canvas.width === 390 * 1.5));
    t('省電力設定が保存される', await page.evaluate(() =>
      localStorage.getItem('oyu_powersave') === 'true'));

    t('モバイル: ページエラーなし', errors.length === 0);
    await ctx3.close();
  }

  await browser.close();

  // ---------- 結果 ----------
  let fail = 0;
  for (const [name, ok] of results) {
    if (!ok) fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}`);
  }
  console.log(fail === 0 ? `\nALL PASS (${results.length}件)` : `\n${fail}/${results.length} 件 FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
