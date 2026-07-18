/* 共通ヘルパー: playwrightの解決とChromium起動
   - playwright はローカル node_modules → npmグローバル の順で探す
     (見つからなければ `npm i -D playwright` を案内)
   - Chromium は環境変数 CHROMIUM_PATH > /opt/pw-browsers/chromium(Claude環境)
     > playwright同梱 の順で使う */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  try {
    const g = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return require(path.join(g, 'playwright'));
  } catch (e) {}
  console.error('playwright が見つかりません。リポジトリ直下で `npm i -D playwright` を実行してください。');
  process.exit(1);
}

const { chromium } = loadPlaywright();
const EXE = process.env.CHROMIUM_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

module.exports = {
  chromium,
  launch: (opts = {}) => chromium.launch(EXE ? { executablePath: EXE, ...opts } : opts),
  INDEX: 'file://' + path.join(__dirname, '..', 'index.html'),
  ROOT: path.join(__dirname, '..'),
};
