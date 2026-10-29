// Generates PWA / notification icons from an inline SVG.
import sharp from "sharp";
const svg = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#e11d2e"/>
<circle cx="50" cy="50" r="28" fill="none" stroke="#fff" stroke-width="5"/>
<circle cx="50" cy="50" r="15" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="4"/>
<path d="M50 50 L72 30" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
<circle cx="50" cy="50" r="5" fill="#fff"/></svg>`);
for (const s of [192, 512]) await sharp(svg(s)).png().toFile(`public/icon-${s}.png`);
await sharp(svg(32)).png().toFile("src/app/icon.png");
await sharp(svg(180)).png().toFile("src/app/apple-icon.png");
