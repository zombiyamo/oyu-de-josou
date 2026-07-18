/* 施主撮影の草写真から、index.html の GRASS_TEX(葉のグレイン。グレースケールの
   高周波タイル・overlay合成用)を合成するツール。mosstex.js と同じテクスチャボミング
   方式で苔率ならぬ「葉率」の高い小領域を集めてタイルを作り、そこから低周波(ぼかし)
   を差し引いて質感だけを抽出する。
   元写真は施主の私物なのでリポジトリには含めない(手元にある時だけ再生成できる)。
   使い方: node tools/grasstex.js <photo.jpg>
   出力(カレントディレクトリ): grain.jpeg.txt (data URI。GRASS_TEX.src に貼る),
   grain_preview.png (リピートの目視確認用) */
const path = require('path');
const fs = require('fs');
const { launch } = require('./_launch');

(async () => {
  const photo = process.argv[2];
  if (!photo || !fs.existsSync(photo)) {
    console.error('usage: node tools/grasstex.js <photo.jpg>');
    process.exit(1);
  }
  const browser = await launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(require('url').pathToFileURL(path.resolve(photo)).href);
  const out = await page.evaluate(async () => {
    const img = document.querySelector('img');
    await img.decode();
    const iw = img.naturalWidth, ih = img.naturalHeight;

    // ---- 葉率マップ(1/8縮小)から、葉が密な小領域を集める ----
    const S = 8;
    const sw = Math.floor(iw / S), sh = Math.floor(ih / S);
    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0, sw, sh);
    const d = cx.getImageData(0, 0, sw, sh).data;
    const leafAt = (x, y) => {
      const i = (y * sw + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      return g > 60 && g > r * 1.04 && g > b * 1.18;
    };
    const SPOT = 260;   // 元解像度でのスタンプ切り出しサイズ
    const win = Math.floor(SPOT / S);
    const spots = [];
    for (let y = 0; y + win < sh; y += 4) {
      for (let x = 0; x + win < sw; x += 4) {
        let n = 0, tot = 0;
        for (let yy = y; yy < y + win; yy += 2)
          for (let xx = x; xx < x + win; xx += 2) { tot++; if (leafAt(xx, yy)) n++; }
        if (n / tot > 0.9) spots.push({ x: x * S, y: y * S });
      }
    }
    if (spots.length < 5) return { error: 'leafy spots not found: ' + spots.length };
    spots.sort(() => Math.random() - 0.5);
    const picked = [];
    for (const s of spots) {
      if (picked.every((p) => Math.hypot(p.x - s.x, p.y - s.y) > SPOT * 0.6)) picked.push(s);
      if (picked.length >= 48) break;
    }

    // ---- スタンプ(radialでフェードする円形パッチ)を事前生成 ----
    const stampOf = (spot, size) => {
      const st = document.createElement('canvas');
      st.width = size; st.height = size;
      const gs = st.getContext('2d');
      gs.drawImage(img, spot.x, spot.y, SPOT, SPOT, 0, 0, size, size);
      gs.globalCompositeOperation = 'destination-in';
      const grd = gs.createRadialGradient(size / 2, size / 2, size * 0.15,
                                          size / 2, size / 2, size * 0.5);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      gs.fillStyle = grd;
      gs.fillRect(0, 0, size, size);
      return st;
    };

    // ---- タイル合成: ベース色 → スタンプをラップしながら大量に ----
    const T = 128;
    const tile = document.createElement('canvas');
    tile.width = T; tile.height = T;
    const g2 = tile.getContext('2d');
    g2.fillStyle = '#5a7a3a';
    g2.fillRect(0, 0, T, T);
    for (let i = 0; i < 240; i++) {
      const spot = picked[Math.floor(Math.random() * picked.length)];
      const size = 36 + Math.random() * 54;
      const st = stampOf(spot, Math.round(size));
      const x = Math.random() * T, y = Math.random() * T;
      const rot = Math.random() * Math.PI * 2;
      for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) {
        g2.save(); g2.translate(x + dx, y + dy); g2.rotate(rot);
        g2.drawImage(st, -st.width / 2, -st.height / 2); g2.restore();
      }
    }

    // ---- グレースケール化 + 高周波抽出(128 ± (原 - ぼかし)) ----
    // overlay合成で使うので、色そのものではなく質感(明暗の細かい変化)だけを残す。
    // 128=無変化。差分を誇張して薄い質感でもoverlayで乗るようにする
    const lum = g2.getImageData(0, 0, T, T);
    const gray = document.createElement('canvas');
    gray.width = T; gray.height = T;
    const gg = gray.getContext('2d');
    const gd = gg.createImageData(T, T);
    for (let i = 0; i < lum.data.length; i += 4) {
      const l = 0.299 * lum.data[i] + 0.587 * lum.data[i + 1] + 0.114 * lum.data[i + 2];
      gd.data[i] = gd.data[i + 1] = gd.data[i + 2] = l; gd.data[i + 3] = 255;
    }
    gg.putImageData(gd, 0, 0);
    const blur = document.createElement('canvas');
    blur.width = T; blur.height = T;
    const bg = blur.getContext('2d');
    bg.filter = 'blur(4px)';
    // ぼかしの縁対策に3x3で敷いてから中央を使う(タイルはリピートなので継ぎ目なし)
    for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) bg.drawImage(gray, dx, dy);
    const bd = bg.getImageData(0, 0, T, T).data;
    const gd2 = gg.getImageData(0, 0, T, T);
    const od = gg.createImageData(T, T);
    for (let i = 0; i < gd2.data.length; i += 4) {
      const v = Math.max(0, Math.min(255, 128 + (gd2.data[i] - bd[i]) * 1.7));
      od.data[i] = od.data[i + 1] = od.data[i + 2] = v; od.data[i + 3] = 255;
    }
    const outCv = document.createElement('canvas');
    outCv.width = T; outCv.height = T;
    outCv.getContext('2d').putImageData(od, 0, 0);

    // ---- 3x3リピートのプレビュー ----
    const pv = document.createElement('canvas');
    pv.width = T * 3; pv.height = T * 3;
    const g3 = pv.getContext('2d');
    g3.fillStyle = g3.createPattern(outCv, 'repeat');
    g3.fillRect(0, 0, pv.width, pv.height);

    return {
      spots: picked.length,
      jpeg: outCv.toDataURL('image/jpeg', 0.6),
      preview: pv.toDataURL('image/png'),
    };
  });
  if (out.error) { await browser.close(); console.error(out.error); process.exit(1); }
  const dir = process.cwd();
  fs.writeFileSync(path.join(dir, 'grain.jpeg.txt'), out.jpeg);
  fs.writeFileSync(path.join(dir, 'grain_preview.png'),
    Buffer.from(out.preview.split(',')[1], 'base64'));
  console.log('spots:', out.spots);
  console.log('jpeg bytes(base64):', out.jpeg.length);
  await browser.close();
})();
