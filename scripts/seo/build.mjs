// Genera immagini di condivisione, icone, robots.txt, sitemap.xml e il blocco SEO/social di ogni pagina.
// Uso: npm run seo            (usa scripts/seo/config.json)
//      npm run seo -- https://nuovo-dominio.it   (cambia indirizzo e rigenera tutto)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PUB = join(ROOT, "public");
const CFG_FILE = join(HERE, "config.json");
const cfg = JSON.parse(readFileSync(CFG_FILE, "utf8"));
const arg = process.argv[2];
if (arg) {
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(arg)) { console.error("Indirizzo non valido: usa https://dominio senza barra finale."); process.exit(1); }
  cfg.base = arg; writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}
const BASE = cfg.base, HOST = new URL(BASE).host;

const PAGES = [
  { file: "index.html", path: "/", og: "home", img: "trama-og.png", alt: "Trama: dal documento al backlog, con le regole.", ld: true, priority: "1.0", en: true }, // en: versione inglese con ?lang=en
  { file: "brand.html", path: "/brand", og: "brand", img: "trama-og-brand.png", alt: "Il marchio Trama: nome, logo, colori e tipografia.", priority: "0.4" },
  { file: "privacy.html", path: "/privacy", og: "privacy", img: "trama-og-privacy.png", alt: "Come Trama tratta i dati personali.", priority: "0.3" },
  { file: "installazione.html", path: "/installazione", og: "install", img: "trama-og-install.png", alt: "Collega Claude a Trama sul tuo computer: la guida per i colleghi.", priority: "0.6" },
  { file: "studio.html", path: "/studio", noindex: true },
];

// 1. Immagini di condivisione 1200×630 (Chrome senza interfaccia, con i font del marchio)
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(join(PUB, "og"), { recursive: true });
let src = readFileSync(join(HERE, "og-source.html"), "utf8").replace(/trama-backlog\.vercel\.app|<div class="url">[^<]*<\/div>/g, (m) => (m.startsWith("<div") ? `<div class="url">${HOST}</div>` : HOST));
writeFileSync(join(HERE, "og-source.html"), src);
if (existsSync(CHROME)) {
  for (const p of PAGES.filter((p) => p.og)) {
    execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1200,630", "--virtual-time-budget=8000",
      `--screenshot=${join(PUB, "og", p.img)}`, `file://${join(HERE, "og-source.html")}?v=${p.og}`], { stdio: "ignore" });
    const f = join(PUB, "og", p.img), opt = await sharp(f).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
    writeFileSync(f, opt);
    console.log("immagine", `og/${p.img}`, `${Math.round(opt.length / 1024)} KB`);
  }
} else console.log("Chrome non trovato: salto le immagini di condivisione (imposta CHROME_BIN).");

// 2. Icone dal simbolo vettoriale
const svg = readFileSync(join(PUB, "favicon.svg"));
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
for (const [name, size] of [["favicon-32.png", 32], ["icon-192.png", 192], ["icon-512.png", 512]]) writeFileSync(join(PUB, name), await png(size));
// Icona "maskable": simbolo al 62% su fondo pieno, così non viene tagliata dalle maschere circolari di Android
const sym = await sharp(svg, { density: 384 }).resize(317, 317).png().toBuffer();
writeFileSync(join(PUB, "icon-maskable-512.png"), await sharp({ create: { width: 512, height: 512, channels: 4, background: cfg.themeColor } }).composite([{ input: sym, gravity: "center" }]).png().toBuffer());
// favicon.ico con tre PNG incorporati (16, 32, 48)
const sizes = [16, 32, 48], blobs = await Promise.all(sizes.map(png));
const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = head.length; blobs.forEach((b, i) => { const o = 6 + 16 * i; head[o] = sizes[i]; head[o + 1] = sizes[i]; head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(b.length, o + 8); head.writeUInt32LE(off, o + 12); off += b.length; });
writeFileSync(join(PUB, "favicon.ico"), Buffer.concat([head, ...blobs]));
writeFileSync(join(PUB, "site.webmanifest"), JSON.stringify({
  name: "Trama", short_name: "Trama", description: "Dal documento di requisiti al backlog Jira, con le regole.", lang: "it", dir: "ltr",
  start_url: "/studio", scope: "/", display: "standalone", theme_color: cfg.themeColor, background_color: cfg.backgroundColor,
  icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
}, null, 2) + "\n");
console.log("icone e manifest");

// 3. robots.txt e sitemap.xml
writeFileSync(join(PUB, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${BASE}/sitemap.xml\n`);
writeFileSync(join(PUB, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  PAGES.filter((p) => !p.noindex).flatMap((p) => [p.path, ...(p.en ? [p.path + "?lang=en"] : [])].map((path) => `  <url>\n    <loc>${BASE}${path}</loc>\n    <lastmod>${cfg.lastmod}</lastmod>\n    <priority>${p.priority}</priority>\n  </url>\n`)).join("") + `</urlset>\n`);
console.log("robots.txt, sitemap.xml");

// 4. Blocco SEO nell'<head> di ogni pagina (tra i marcatori; titolo e descrizione si leggono dalla pagina stessa)
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const START = "<!-- seo:start (generato da scripts/seo/build.mjs: non modificare a mano) -->", END = "<!-- seo:end -->";
for (const p of PAGES) {
  const file = join(PUB, p.file);
  let html = readFileSync(file, "utf8");
  html = html.replace(new RegExp(`${START.replace(/[()]/g, "\\$&")}[\\s\\S]*?${END}\\n?`), "");
  html = html.replace(/<link rel="(icon|apple-touch-icon|manifest)"[^>]*>\n?/g, "");
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] || cfg.name;
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] || "";
  const url = BASE + (p.path === "/" ? "/" : p.path);
  const lines = [
    START,
    `<link rel="icon" href="/favicon.ico" sizes="48x48">`,
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`,
    `<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    `<link rel="manifest" href="/site.webmanifest">`,
  ];
  if (p.noindex) lines.push(`<meta name="robots" content="noindex,nofollow">`);
  else {
    const img = `${BASE}/og/${p.img}?v=${cfg.ogVersion}`;
    lines.push(`<link rel="canonical" href="${url}">`);
    // versione inglese: stessa pagina con ?lang=en (i18n.js la traduce e sposta lì il canonico)
    if (p.en) lines.push(`<link rel="alternate" hreflang="it" href="${url}">`, `<link rel="alternate" hreflang="en" href="${url}?lang=en">`, `<link rel="alternate" hreflang="x-default" href="${url}">`);
    lines.push(`<meta name="robots" content="index,follow,max-image-preview:large">`,
      `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="${cfg.name}">`, `<meta property="og:locale" content="${cfg.locale}">`, ...(p.en ? [`<meta property="og:locale:alternate" content="en_GB">`] : []),
      `<meta property="og:title" content="${title}">`, `<meta property="og:description" content="${desc}">`, `<meta property="og:url" content="${url}">`,
      `<meta property="og:image" content="${img}">`, `<meta property="og:image:type" content="image/png">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`, `<meta property="og:image:alt" content="${esc(p.alt)}">`,
      `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${title}">`, `<meta name="twitter:description" content="${desc}">`, `<meta name="twitter:image" content="${img}">`, `<meta name="twitter:image:alt" content="${esc(p.alt)}">`);
    if (p.ld) lines.push(`<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [
      { "@type": "WebSite", "@id": BASE + "/#site", url: BASE + "/", name: cfg.name, inLanguage: "it" },
      { "@type": "SoftwareApplication", "@id": BASE + "/#app", name: cfg.name, url: BASE + "/", description: desc, applicationCategory: "BusinessApplication", operatingSystem: "Web", inLanguage: "it", image: `${BASE}/og/${p.img}` }] })}</script>`);
  }
  lines.push(END);
  html = html.replace("</head>", lines.join("\n") + "\n</head>");
  writeFileSync(file, html);
  console.log("pagina", p.file, p.noindex ? "(noindex)" : "");
}
