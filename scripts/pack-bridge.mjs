// Copia il ponte in public/ponte/ così i colleghi lo scaricano da /ponte/trama-ponte.mjs (nessun clone del progetto).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const src = readFileSync(new URL("./claude-bridge.mjs", import.meta.url), "utf8");
mkdirSync(new URL("../public/ponte/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/ponte/trama-ponte.mjs", import.meta.url), src);
console.log("public/ponte/trama-ponte.mjs", createHash("sha256").update(src).digest("hex").slice(0, 12), `${src.split("\n").length} righe`);
