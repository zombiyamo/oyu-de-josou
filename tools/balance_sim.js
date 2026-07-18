/* レベルデザイン計測: update()を早回しして構成別の収入(除草/分)を実測。
   レベルデザイン(価格・自動化の挙動・スポーン)を変えたら必ず回すこと。
   使い方: node tools/balance_sim.js
   健全な目安(2026-07時点の実測):
   - 設備なし・やかん/ししおどしのみ: 0/分(片付け手段がないため。仕様)
   - やかん3+からくりヤギ1: 20〜25/分
   - やかん8+しし4+風Lv1: 15〜20/分 / 風Lv4: 20〜30/分
   - フル構成(8+4+ヤギ3+風Lv4): 50〜70/分
   庭の初期配置が毎回ランダムなので±30%程度は揺れる。傾向(階段)を見ること。 */
const { launch, INDEX } = require('./_launch');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.goto(INDEX);
  await page.waitForTimeout(700);
  await page.evaluate(() => { closePanel(); localStorage.clear(); });

  // シナリオ: [名前, やかん, ししおどし, からくりヤギ, 風Lv]
  const scenarios = [
    ['設備なし(自然枯れのみ)', 0, 0, 0, 0],
    ['やかん1', 1, 0, 0, 0],
    ['やかん3', 3, 0, 0, 0],
    ['やかん8', 8, 0, 0, 0],
    ['やかん8+しし4', 8, 4, 0, 0],
    ['やかん3+ヤギ1', 3, 0, 1, 0],
    ['やかん8+しし4+風Lv1', 8, 4, 0, 1],
    ['やかん8+しし4+風Lv4', 8, 4, 0, 4],
    ['フル(8+4+ヤギ3+風Lv4)', 8, 4, 3, 4],
  ];

  for (const [name, k, s, g, sw] of scenarios) {
    const r = await page.evaluate(async ([k2, s2, g2, sw2]) => {
      weeds.length = 0;
      roots.length = 0;
      autoKettles.length = 0;
      autoSprinklers.length = 0;
      goats.length = 0;
      gardenStones.length = 0;
      ponds.length = 0;
      sweeperLevel = 0;
      sweepFx = null;
      totalKilled = 3000;   // 全種解放状態で計測
      initGarden();
      for (const w of weeds) w.age = 10;
      for (let i = 0; i < k2; i++) placeAutoItem('kettle');
      for (let i = 0; i < s2; i++) placeAutoItem('sprinkler');
      for (let i = 0; i < g2; i++) placeAutoItem('goat');
      sweeperLevel = sw2;
      sweeperTimer = 3;
      const before = totalKilled;
      // 20分ぶんを早回し(dt=0.1s × 12000)
      let simT = 1000;
      for (let i = 0; i < 12000; i++) {
        update(0.1, simT);
        simT += 0.1;
      }
      return {
        kills: totalKilled - before,
        perMin: ((totalKilled - before) / 20).toFixed(1),
        weedsLeft: weeds.length,
        husks: weeds.filter((w) => w.wither >= 1 && !w.removing).length,
      };
    }, [k, s, g, sw]);
    console.log(name.padEnd(26), JSON.stringify(r));
  }
  await browser.close();
})();
