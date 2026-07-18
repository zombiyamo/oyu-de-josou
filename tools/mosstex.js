/* 施主撮影の苔写真から、index.html の MOSS_TEX(継ぎ目のないタイル)を合成するツール。
   写真内の「苔率」が高い小領域を多数拾い、円形スタンプをラップしながら
   敷き詰める(テクスチャボミング)ことで、鏡像の万華鏡模様や継ぎ目を出さない。
   元写真は施主の私物なのでリポジトリには含めない(手元にある時だけ再生成できる)。
   使い方: node tools/mosstex.js <photo.jpg>
   出力(カレントディレクトリ): tile.webp.txt / tile.jpeg.txt (data URI),
   preview.png (リピートの目視確認用)。jpeg版を MOSS_TEX.src に貼る */
const path = require('path');
const fs = require('fs');
const { launch } = require('./_launch');

(async () => {
  const photo = process.argv[2];
  if (!photo || !fs.existsSync(photo)) {
    console.error('usage: node tools/mosstex.js <photo.jpg>');
    process.exit(1);
  }
  const browser = await launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(require('url').pathToFileURL(path.resolve(photo)).href);
  const out = await page.evaluate(async () => {
    const img = document.querySelector('img');
    await img.decode();
    const iw = img.naturalWidth, ih = img.naturalHeight;

    // ---- 苔率マップ(1/8縮小)から、ほぼ純粋な苔の小領域を集める ----
    const S = 8;
    const sw = Math.floor(iw / S), sh = Math.floor(ih / S);
    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0, sw, sh);
    const d = cx.getImageData(0, 0, sw, sh).data;
    const mossAt = (x, y) => {
      const i = (y * sw + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      return g > 55 && g > r * 1.06 && g > b * 1.22;
    };
    const SPOT = 200;                     // 元解像度でのスタンプ切り出しサイズ
    const win = Math.floor(SPOT / S);
    const spots = [];
    for (let y = 0; y + win < sh; y += 4) {
      for (let x = 0; x + win < sw; x += 4) {
        let n = 0, tot = 0;
        for (let yy = y; yy < y + win; yy += 2)
          for (let xx = x; xx < x + win; xx += 2) { tot++; if (mossAt(xx, yy)) n++; }
        const frac = n / tot;
        if (frac > 0.92) spots.push({ x: x * S, y: y * S, frac });
      }
    }
    if (spots.length < 8) return { error: 'pure moss spots not found: ' + spots.length };
    // 場所が近すぎるものを間引いて多様性を確保
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
    const T = 192;
    const tile = document.createElement('canvas');
    tile.width = T; tile.height = T;
    const g2 = tile.getContext('2d');
    g2.fillStyle = '#3d5a26';
    g2.fillRect(0, 0, T, T);
    for (let i = 0; i < 260; i++) {
      const spot = picked[Math.floor(Math.random() * picked.length)];
      const size = 40 + Math.random() * 60;
      const st = stampOf(spot, Math.round(size));
      const x = Math.random() * T, y = Math.random() * T;
      const rot = Math.random() * Math.PI * 2;
      for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) {
        g2.save();
        g2.translate(x + dx, y + dy);
        g2.rotate(rot);
        g2.drawImage(st, -st.width / 2, -st.height / 2);
        g2.restore();
      }
    }

    // ---- パレット実測(ベース勾配の校正用) ----
    const td = g2.getImageData(0, 0, T, T).data;
    const px = [];
    for (let i = 0; i < td.length; i += 16) px.push([td[i], td[i + 1], td[i + 2]]);
    px.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const avg = px.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
      .map((v) => Math.round(v / px.length));
    const hex = (p) => '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('');
    const pal = {
      dark: hex(px[Math.floor(px.length * 0.08)]),
      avg: hex(avg),
      light: hex(px[Math.floor(px.length * 0.92)]),
    };

    // ---- 2x2+αリピートのプレビュー ----
    const pv = document.createElement('canvas');
    pv.width = T * 2.5; pv.height = T * 2.5;
    const g3 = pv.getContext('2d');
    g3.fillStyle = g3.createPattern(tile, 'repeat');
    g3.fillRect(0, 0, pv.width, pv.height);

    return {
      spots: picked.length,
      pal,
      webp: tile.toDataURL('image/webp', 0.72),
      jpeg: tile.toDataURL('image/jpeg', 0.62),
      preview: pv.toDataURL('image/png'),
    };
  });
  if (out.error) { await browser.close(); console.error(out.error); process.exit(1); }
  const dir = process.cwd();
  fs.writeFileSync(path.join(dir, 'tile.webp.txt'), out.webp);
  fs.writeFileSync(path.join(dir, 'tile.jpeg.txt'), out.jpeg);
  fs.writeFileSync(path.join(dir, 'preview.png'),
    Buffer.from(out.preview.split(',')[1], 'base64'));
  console.log('spots:', out.spots);
  console.log('palette:', JSON.stringify(out.pal));
  console.log('webp bytes(base64):', out.webp.length, '/ jpeg:', out.jpeg.length);
  await browser.close();
})();
