/* Twitter用デモ動画の撮影スクリプト。
   1280x720で実プレイを録画+ページ内MediaRecorderでゲーム音声もキャプチャ。
   白フラッシュ+ビープの同期マーカーで映像と音声の位置合わせをする。
   使い方: node tools/demovideo.js → tools/out/ に動画(webm)と音声(webm)が出る。
   仕上げ(ffmpeg合成)の手順とパラメータは CLAUDE.md 経由でコミット履歴
   (デモ動画の回)を参照。枯れ進行だけ早回しで、色変化の演出は本物のロジック。 */
const fs = require('fs');
const path = require('path');
const { launch, INDEX } = require('./_launch');
const DIR = path.join(__dirname, 'out');
fs.mkdirSync(DIR, { recursive: true });
const Z = 1.6; // ゲーム内ZOOM: 世界座標→CSSピクセル
const S = (wx, wy) => [wx * Z, wy * Z];

(async () => {
  const browser = await launch({
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    locale: 'ja-JP',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: DIR + '/vid', size: { width: 1280, height: 720 } },
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('oyu_onboarded', '1');   // オンボは飛ばす
      localStorage.setItem('oyu_totalKilled', '1500'); // 種類が多い庭にする
      localStorage.setItem('oyu_elapsed', '0');     // 朝5時スタート
    } catch (e) {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(INDEX);
  await page.waitForTimeout(400);
  await page.evaluate(() => { try { closePanel(); } catch (e) {} });

  // --- 音声キャプチャ: audio.master をMediaRecorderに分岐 ---
  await page.mouse.click(60, 20);   // HUDタイトルをクリック=無害なユーザージェスチャ(音声解錠用)
  await page.waitForTimeout(100);
  const audioState = await page.evaluate(async () => {
    unlockAudio();
    for (let i = 0; i < 20 && audio.ctx.state !== 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      unlockAudio();
    }
    const c = audio.ctx;
    window.__dest = c.createMediaStreamDestination();
    audio.master.connect(__dest);
    window.__chunks = [];
    window.__rec = new MediaRecorder(__dest.stream, {
      mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000,
    });
    __rec.ondataavailable = (e) => { if (e.data.size) __chunks.push(e.data); };
    __rec.start(1000);
    return c.state;
  });
  console.log('audio ctx state:', audioState);
  await page.waitForTimeout(250);
  // 同期マーカー: 白フラッシュ+ビープを同時に出す(最終動画からはトリムで除去)
  await page.evaluate(() => {
    const c = audio.ctx;
    const t = c.currentTime + 0.08;
    const o = c.createOscillator();
    o.frequency.value = 2400;
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(g); g.connect(__dest);   // 録音側にだけ入れる
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.005);
    g.gain.setValueAtTime(0.6, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.06);
    o.start(t); o.stop(t + 0.12);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:99999';
    setTimeout(() => {
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 130);
    }, 80);
  });
  await page.waitForTimeout(700);

  // ページ内ヘルパー
  await page.evaluate(() => {
    // x範囲内で一番密な群生の中心を探す
    window.__colony = (x0, x1) => {
      const cells = new Map();
      for (const w of weeds) {
        if (w.x < x0 || w.x > x1 || w.y < 130 || w.y > 380) continue;
        const k = Math.round(w.x / 90) + ',' + Math.round(w.y / 90);
        const c = cells.get(k) || { n: 0, sx: 0, sy: 0 };
        c.n++; c.sx += w.x; c.sy += w.y;
        cells.set(k, c);
      }
      let best = null;
      for (const c of cells.values()) if (!best || c.n > best.n) best = c;
      return best ? { x: best.sx / best.n, y: best.sy / best.n, n: best.n } : { x: (x0 + x1) / 2, y: 250, n: 0 };
    };
    // お湯がかかった草の枯れ進行を早回し(タイムラプス)
    window.__lapse = (ticks, rate) => new Promise((res) => {
      let i = 0;
      const iv = setInterval(() => {
        for (const w of weeds) {
          if (w.removing || w.wither >= 1) continue;
          if (w.scald >= 0.12) w.wither = Math.min(1, w.wither + rate);
        }
        if (++i >= ticks) { clearInterval(iv); res(); }
      }, 110);
    });
    // 指定エリアの熱かかり草を段階的に枯れ草まで進める
    window.__huskify = (cx, cy, r, n) => {
      const cand = weeds
        .filter((w) => !w.removing && w.wither < 1 && w.scald > 0.1 &&
          (w.x - cx) ** 2 + (w.y - cy) ** 2 < r * r)
        .sort((a, b) => b.wither - a.wither)
        .slice(0, n);
      return new Promise((res) => {
        const iv = setInterval(() => {
          let done = true;
          for (const w of cand) {
            if (w.wither < 1) { w.wither = Math.min(1, w.wither + 0.12); done = false; }
          }
          if (done) { clearInterval(iv); res(); }
        }, 120);
      });
    };
    // タップ対象の枯れ草の座標リスト
    window.__husks = (cx, cy, r, n) =>
      weeds
        .filter((w) => w.wither >= 1 && !w.removing && (w.x - cx) ** 2 + (w.y - cy) ** 2 < r * r)
        .sort((a, b) => ((a.x - cx) ** 2 + (a.y - cy) ** 2) - ((b.x - cx) ** 2 + (b.y - cy) ** 2))
        .slice(0, n)
        .map((w) => [Math.round(w.x), Math.round(w.y)]);
    // まだ元気な草だけで一番密な群生を探す(2杯やかんシーン用)
    window.__colonyFresh = () => {
      const cells = new Map();
      for (const w of weeds) {
        if (w.wither > 0.2 || w.scald > 0.15 || w.removing) continue;
        if (w.x < 120 || w.x > 700 || w.y < 130 || w.y > 380) continue;
        const k = Math.round(w.x / 90) + ',' + Math.round(w.y / 90);
        const c = cells.get(k) || { n: 0, sx: 0, sy: 0 };
        c.n++; c.sx += w.x; c.sy += w.y;
        cells.set(k, c);
      }
      let best = null;
      for (const c of cells.values()) if (!best || c.n > best.n) best = c;
      return best ? { x: best.sx / best.n, y: best.sy / best.n, n: best.n } : { x: 400, y: 250, n: 0 };
    };
    // 自然ドロップの整理: 除草剤は演出が狂うので消し、金のやかんの位置を返す
    window.__prepPickups = () => {
      for (let i = pickups.length - 1; i >= 0; i--) {
        if (pickups[i].kind === 'herbicide') pickups.splice(i, 1);
      }
      const k = pickups.find((p) => p.kind === 'kettle2');
      if (k) return { x: k.x, y: k.y };
      spawnPickup(400, 240, 'kettle2');
      const s = pickups.find((p) => p.kind === 'kettle2');
      return s ? { x: s.x, y: s.y } : null;
    };
  });

  const c1 = await page.evaluate(() => __colony(120, 380));
  const c2 = await page.evaluate(() => __colony(430, 700));

  // 着水点が(cx,cy)に来るよう指はやや右上に置き、ゆっくり渦を描いて注ぐ
  const pourOver = async (cx, cy, dur) => {
    const fx = cx + 36, fy = cy - 40;
    const [sx, sy] = S(fx, fy);
    await page.mouse.move(sx, sy, { steps: 20 });
    await page.mouse.down();
    const t0 = Date.now();
    while (Date.now() - t0 < dur) {
      const t = (Date.now() - t0) / 1000;
      const a = t * 1.7;
      const g = Math.min(1, t / 1.2);
      const [mx, my] = S(fx + Math.cos(a) * 52 * g, fy + Math.sin(a) * 32 * g);
      await page.mouse.move(mx, my, { steps: 2 });
      await page.waitForTimeout(55);
    }
    await page.mouse.up();
  };

  const tapAt = async (wx, wy) => {
    const [sx, sy] = S(wx, wy);
    await page.mouse.move(sx, sy, { steps: 6 });
    await page.mouse.down();
    await page.waitForTimeout(35);
    await page.mouse.up();
  };

  await page.waitForTimeout(1400);                     // 夜明けの庭をひと呼吸

  await pourOver(c1.x, c1.y, 6200);                    // シーンA: 群生1にお湯
  await page.evaluate(() => __lapse(14, 0.028));       // 枯れの経過を早回し
  await page.waitForTimeout(300);

  await pourOver(c2.x, c2.y, 4300);                    // シーンB: 群生2にお湯
  const lapse2 = page.evaluate(() => __lapse(12, 0.03));
  await page.evaluate((c) => __huskify(c.x, c.y, 140, 9), c1);
  await lapse2;

  // シーンC: 枯れ草をタップで片付け
  const husks = await page.evaluate((c) => __husks(c.x, c.y, 150, 6), c1);
  for (const [hx, hy] of husks) {
    await tapAt(hx, hy);
    await page.waitForTimeout(340);
  }
  await page.waitForTimeout(400);

  // シーンC2: 金のやかんを拾って、やかん2つで注ぐ
  const gk = await page.evaluate(() => __prepPickups());
  await page.waitForTimeout(900);
  await tapAt(gk.x, gk.y);
  await page.waitForTimeout(400);
  const c3 = await page.evaluate(() => __colonyFresh());
  await pourOver(c3.x, c3.y, 3600);
  await page.waitForTimeout(400);

  // シーンD: レア除草剤(紫の波)
  await page.evaluate(() => spawnPickup(400, 250, 'herbicide', 3));
  await page.waitForTimeout(1200);
  await tapAt(400, 250);
  await page.waitForTimeout(2600);

  // シーンE: 夜が明けて、新芽がふわふわ生えてくる(翌朝で終わる)
  await page.waitForTimeout(7500);

  const stats = await page.evaluate(() => ({
    weeds: weeds.length, killed: totalKilled, hour: Math.floor(gameHour()),
  }));

  // 録音を止めて音声を回収
  const dataUrl = await page.evaluate(() => new Promise((res) => {
    __rec.onstop = () => {
      const blob = new Blob(__chunks, { type: 'audio/webm' });
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.readAsDataURL(blob);
    };
    __rec.stop();
  }));
  fs.writeFileSync(
    path.join(DIR, 'demo_audio.webm'),
    Buffer.from(dataUrl.split(',')[1], 'base64')
  );

  console.log(JSON.stringify({ c1, c2, husksTapped: husks.length, stats, errors }));
  const vpath = await page.video().path();
  await context.close();   // ここで動画が確定する
  console.log('video:' + vpath);
  await browser.close();
})();
