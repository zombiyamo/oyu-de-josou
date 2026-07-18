/* OGP画像(1200x630)とPWAアイコンの生成。
   使い方: node tools/genassets.js          … 全アセット生成
           node tools/genassets.js ogp-only … OGPだけ再生成(見た目変更後の定番)
   注意: シークレット種(虹の四つ葉)がネタバレしないよう totalKilled=1999 で撮影する */
const path = require('path');
const { launch, INDEX, ROOT } = require('./_launch');

(async () => {
  const browser = await launch();

  // ---- OGP画像 (1200x630) ----
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(INDEX);
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    closePanel();
    document.getElementById('hint').classList.add('hide');
    document.getElementById('hud').style.display = 'none';
    // 華やかな庭を用意(シークレットの虹色四つ葉はネタバレになるので出さない)
    totalKilled = 1999;
    weeds.length = 0;
    initGarden();
    let g = 0;
    while (weeds.length < 120 && g++ < 8000) {
      spawnWeed(weeds.length && Math.random() < 0.75
        ? { near: weeds[Math.floor(Math.random() * weeds.length)], size: rnd(0.8, 1.2) }
        : { size: rnd(0.8, 1.2) });
    }
    for (let i = weeds.length - 1; i >= 0; i--) {
      if (weeds[i].type === 'nijiyotsuba') weeds.splice(i, 1);   // 念のため
    }
    for (const w of weeds) w.age = 10;
  });
  await page.waitForTimeout(400);
  // 中央右寄りの草に注ぐ(やかん+湯気を見せる)
  const t = await page.evaluate(() => {
    const w = weeds.reduce((best, w) => {
      const d = Math.hypot(w.x - W * 0.62, w.y - H * 0.55);
      return !best || d < best.d ? { w, d } : best;
    }, null).w;
    return { x: (w.x + 36) * ZOOM, y: (w.y - 40) * ZOOM };
  });
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  // タイトルオーバーレイ
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:56px;bottom:52px;z-index:99;color:#fff;font-family:system-ui,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;';
    d.innerHTML = `
      <div style="background:rgba(18,16,12,.62);border-radius:22px;padding:26px 38px;backdrop-filter:blur(2px);">
        <div style="font-size:58px;font-weight:800;letter-spacing:.03em;text-shadow:0 2px 10px rgba(0,0,0,.6);">🫖 お湯de除草</div>
        <div style="font-size:24px;margin-top:10px;opacity:.95;text-shadow:0 1px 6px rgba(0,0,0,.6);">熱湯でのんびり雑草退治 〜砂利の庭〜</div>
      </div>`;
    document.body.appendChild(d);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(ROOT, 'ogp.png') });
  await page.mouse.up();
  await page.close();

  // ---- アイコン (絵文字🫖を緑地に) ---- `ogp-only` 指定時はスキップ
  for (const [size, name] of process.argv.includes('ogp-only') ? [] : [[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-icon.png']]) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<!doctype html><body style="margin:0;width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      background:radial-gradient(circle at 35% 30%, #6f8f5f, #4a6440 70%);">
      <div style="font-size:${Math.round(size * 0.62)}px;line-height:1;">🫖</div></body>`);
    await p.waitForTimeout(250);
    await p.screenshot({ path: path.join(ROOT, name) });
    await p.close();
  }
  await browser.close();
  console.log('assets generated');
})();
