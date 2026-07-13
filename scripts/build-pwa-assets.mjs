import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(root, "assets");

const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">Zustand App Icon</title>
  <desc id="desc">A connected state path for the Zustand process planning app.</desc>
  <defs>
    <linearGradient id="bg" x1="76" y1="40" x2="452" y2="472" gradientUnits="userSpaceOnUse">
      <stop stop-color="#07111f"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="line" x1="116" y1="136" x2="396" y2="376" gradientUnits="userSpaceOnUse">
      <stop stop-color="#38bdf8"/>
      <stop offset=".55" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#34d399"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="13" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.219 0 0 0 0 0.741 0 0 0 0 0.973 0 0 0 .55 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <path d="M144 158h150c49 0 89 40 89 89s-40 89-89 89h-76c-26 0-47 21-47 47s21 47 47 47h150" fill="none" stroke="url(#line)" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <circle cx="144" cy="158" r="42" fill="#f59e0b"/>
  <circle cx="383" cy="247" r="42" fill="#38bdf8"/>
  <circle cx="368" cy="430" r="42" fill="#34d399"/>
  <circle cx="144" cy="158" r="14" fill="#020617"/>
  <circle cx="383" cy="247" r="14" fill="#020617"/>
  <circle cx="368" cy="430" r="14" fill="#020617"/>
</svg>
`;

const maskableSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">Zustand Maskable Icon</title>
  <desc id="desc">A safe-area app icon for Zustand.</desc>
  <rect width="512" height="512" fill="#07111f"/>
  <circle cx="74" cy="66" r="210" fill="#0ea5e9" opacity=".18"/>
  <circle cx="452" cy="456" r="230" fill="#34d399" opacity=".13"/>
  <path d="M136 160h156c50 0 90 40 90 90s-40 90-90 90h-78c-24 0-44 20-44 44s20 44 44 44h162" fill="none" stroke="#38bdf8" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M136 160h156c50 0 90 40 90 90" fill="none" stroke="#a78bfa" stroke-width="20" stroke-linecap="round" opacity=".95"/>
  <circle cx="136" cy="160" r="39" fill="#f59e0b"/>
  <circle cx="382" cy="250" r="39" fill="#38bdf8"/>
  <circle cx="376" cy="428" r="39" fill="#34d399"/>
</svg>
`;

const shareHtml = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body {
      width: 1200px;
      height: 630px;
      margin: 0;
      overflow: hidden;
      font-family: "Segoe UI", Arial, sans-serif;
      background:
        radial-gradient(circle at 13% 8%, rgba(56,189,248,.28), transparent 30%),
        radial-gradient(circle at 88% 92%, rgba(52,211,153,.18), transparent 34%),
        linear-gradient(135deg, #07111f 0%, #020617 78%);
      color: #e5f0ff;
    }
    .wrap { position: relative; width: 100%; height: 100%; padding: 64px 72px; }
    .brand { color: #7dd3fc; font-size: 32px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; }
    h1 { margin: 30px 0 0; width: 620px; font-size: 68px; line-height: 1.02; letter-spacing: 0; color: #f8fbff; }
    p { margin: 20px 0 0; width: 600px; color: #b7c9dd; font-size: 27px; line-height: 1.3; font-weight: 700; }
    .board {
      position: absolute;
      right: 68px;
      bottom: 104px;
      width: 380px;
      height: 270px;
      border: 2px solid rgba(56,189,248,.32);
      border-radius: 30px;
      background: rgba(8,24,39,.78);
      box-shadow: 0 30px 80px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.08);
    }
    .node {
      position: absolute;
      width: 118px;
      height: 70px;
      border-radius: 16px;
      background: #123052;
      border: 2px solid #315f8c;
      box-shadow: 0 16px 40px rgba(0,0,0,.25);
    }
    .n1 { left: 44px; top: 112px; border-color: #34d399; }
    .n2 { right: 42px; top: 52px; border-color: #38bdf8; }
    .n3 { right: 56px; bottom: 44px; border-color: #f59e0b; }
    .wire { position: absolute; inset: 0; }
    .chip {
      position: absolute;
      left: 72px;
      bottom: 52px;
      display: inline-flex;
      align-items: center;
      height: 48px;
      padding: 0 22px;
      border: 1px solid rgba(56,189,248,.36);
      border-radius: 999px;
      color: #7dd3fc;
      font-size: 20px;
      font-weight: 850;
      background: rgba(7,19,33,.78);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">Zustand</div>
    <h1>Nur verstandene Prozesse werden digital.</h1>
    <p>Business-Flows als globale JSON-State-Machine planen, testen und als Website exportieren.</p>
    <div class="chip">digitalisierungsplanung.de</div>
    <div class="board" aria-hidden="true">
      <svg class="wire" viewBox="0 0 418 300" fill="none">
        <path d="M158 146H224V86H292" stroke="#38bdf8" stroke-width="8" stroke-linecap="round"/>
        <path d="M158 146H228V222H280" stroke="#34d399" stroke-width="8" stroke-linecap="round"/>
        <circle cx="158" cy="146" r="9" fill="#38bdf8"/>
        <circle cx="292" cy="86" r="9" fill="#38bdf8"/>
        <circle cx="280" cy="222" r="9" fill="#34d399"/>
      </svg>
      <div class="node n1"></div>
      <div class="node n2"></div>
      <div class="node n3"></div>
    </div>
  </div>
</body>
</html>`;

async function ensureDir(file) {
  await mkdir(dirname(file), { recursive: true });
}

async function writeText(file, text) {
  await ensureDir(file);
  await writeFile(file, text, "utf8");
}

async function pngFromSvg(browser, svg, file, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>body{margin:0;width:${size}px;height:${size}px}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}

async function pngFromHtml(browser, html, file, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
  await page.close();
}

await mkdir(assetsDir, { recursive: true });
await writeText(resolve(assetsDir, "zustand-icon.svg"), iconSvg);
await writeText(resolve(assetsDir, "zustand-maskable.svg"), maskableSvg);

const browser = await chromium.launch();
try {
  await pngFromSvg(browser, iconSvg, resolve(assetsDir, "icon-192.png"), 192);
  await pngFromSvg(browser, iconSvg, resolve(assetsDir, "icon-512.png"), 512);
  await pngFromSvg(browser, maskableSvg, resolve(assetsDir, "maskable-512.png"), 512);
  await pngFromSvg(browser, iconSvg, resolve(assetsDir, "apple-touch-icon.png"), 180);
  await pngFromHtml(browser, shareHtml, resolve(assetsDir, "share-card.png"), 1200, 630);
} finally {
  await browser.close();
}
