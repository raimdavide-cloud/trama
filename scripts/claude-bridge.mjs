// Ponte locale Claude Code: fa usare a Trama il tuo abbonamento Claude Code.
// Avvio: npm run claude   (dal progetto) oppure   node trama-ponte.mjs   (file scaricato da /installazione).
// Lascia aperto il terminale mentre usi Trama.
//
// Ascolta solo su 127.0.0.1 e accetta richieste solo dal sito indicato in APP_URL
// (e da http://localhost:8888 per lo sviluppo). Ogni richiesta lancia `claude -p`
// senza strumenti, in una cartella temporanea vuota, e inoltra la risposta in streaming
// con lo stesso formato di eventi dell'API Messages, che Trama sa già leggere.
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, delimiter } from "node:path";

// Il file .env si legge solo quando il ponte gira dal progetto (scripts/), mai dal file scaricato.
if (import.meta.url.includes("/scripts/") && existsSync(new URL("../.env", import.meta.url))) {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Il figlio non riceve chiavi API: così `claude` usa sempre l'abbonamento Claude Code, come dichiarato.
const API_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].filter((k) => process.env[k]);
const CHILD_ENV = { ...process.env };
for (const k of API_KEYS) delete CHILD_ENV[k];

const PORT = Number(process.env.BRIDGE_PORT) || 8790;
const TOKEN = process.env.BRIDGE_TOKEN || "";
// Cerca `claude` nel PATH e nelle cartelle dove lo installa l'installer ufficiale (che spesso non sono nel PATH di un terminale appena aperto).
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const dirs = [...(process.env.PATH || "").split(delimiter), join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const d of dirs) if (d && existsSync(join(d, exe))) return join(d, exe);
  return "claude";
}
const CLAUDE = findClaude();
const MODEL = process.env.CLAUDE_MODEL || "";
const DEFAULT_SITE = "https://trama-backlog.vercel.app";
const ORIGINS = new Set(
  [process.env.APP_URL || DEFAULT_SITE, "http://localhost:8888", "http://127.0.0.1:8888"].filter(Boolean).map((u) => u.replace(/\/$/, "")),
);
const EFFORTS = new Set(["low", "medium", "high"]);
const MAX_PARALLEL = 2;
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BODY = 8_000_000; // byte
const WORKDIR = mkdtempSync(join(tmpdir(), "backlog-studio-claude-"));
const SYSTEM =
  "Sei l'assistente di Trama, uno strumento che aiuta un Product Owner a trasformare documenti di requisiti in un backlog Jira seguendo un playbook preciso. Non hai strumenti a disposizione: rispondi solo con testo. Segui le istruzioni contenute nei messaggi dell'utente e rispetta esattamente i formati di risposta richiesti.";

let running = 0;
let authCache = { at: 0, loggedIn: null };

function authStatus() {
  if (Date.now() - authCache.at < 30_000) return Promise.resolve(authCache.loggedIn);
  return new Promise((resolve) => {
    execFile(CLAUDE, ["auth", "status"], { timeout: 15_000, env: CHILD_ENV }, (err, stdout) => {
      let loggedIn = null;
      try { loggedIn = !!JSON.parse(stdout).loggedIn; } catch { loggedIn = err ? null : true; }
      authCache = { at: Date.now(), loggedIn };
      resolve(loggedIn);
    });
  });
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !ORIGINS.has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-bridge-token");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

const sendJson = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};

// La conversazione diventa un solo messaggio: `claude -p` riceve un turno utente per volta.
function toUserContent(messages) {
  const text = (c) =>
    typeof c === "string" ? c : (Array.isArray(c) ? c : []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  const images = (c) => (Array.isArray(c) ? c.filter((b) => b?.type === "image" && b.source?.type === "base64") : []);
  const last = messages.at(-1);
  const history = messages.slice(0, -1);
  let prompt = "";
  if (history.length) {
    prompt += "Conversazione finora (in ordine):\n\n";
    for (const m of history) prompt += `[${m.role === "user" ? "Utente" : "Assistente"}]\n${text(m.content)}\n\n`;
    prompt += "Nuovo messaggio dell'utente, a cui devi rispondere:\n\n";
  }
  prompt += text(last.content);
  return [...images(last.content), { type: "text", text: prompt }];
}

// SIGTERM, e SIGKILL se dopo 5 s `claude` non è ancora uscito.
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const t = setTimeout(() => child.kill("SIGKILL"), 5000);
  t.unref();
  child.once("close", () => clearTimeout(t));
}

// Un'eccezione non deve lasciare la richiesta appesa né il figlio acceso.
function handleAi(req, res, body) {
  const st = {};
  try { startAi(req, res, body, st); }
  catch (e) {
    console.error("Errore nella richiesta /ai:", e?.stack || e);
    if (st.child) stop(st.child);
    const message = "Errore interno del ponte: riprova.";
    if (!res.headersSent) sendJson(res, 500, { ok: false, code: "bridge_error", message });
    else if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`);
      res.end();
    }
  }
}

function startAi(req, res, body, st) {
  const messages = Array.isArray(body.messages) ? body.messages.filter((m) => m && (m.role === "user" || m.role === "assistant")) : [];
  if (!messages.length || messages.at(-1).role !== "user") return sendJson(res, 400, { ok: false, code: "invalid_request", message: "La conversazione deve finire con l'utente." });
  if (running >= MAX_PARALLEL) return sendJson(res, 429, { ok: false, code: "rate_limited", message: "Claude Code sta già lavorando a due richieste: attendi qualche secondo." });

  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools", "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--system-prompt", SYSTEM,
    "--effort", EFFORTS.has(body.effort) ? body.effort : "medium",
    ...(MODEL ? ["--model", MODEL] : []),
  ];
  const child = spawn(CLAUDE, args, { cwd: WORKDIR, env: CHILD_ENV, stdio: ["pipe", "pipe", "pipe"] });
  st.child = child;
  running++;
  child.on("close", () => running--);
  const timer = setTimeout(() => stop(child), TIMEOUT_MS);
  let finished = false;
  let started = false;
  let sentText = false;
  let stderr = "";

  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
  const emit = (ev) => !res.writableEnded && res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  emit({ type: "message_start", message: { id: `bridge_${Date.now()}`, type: "message", role: "assistant", content: [] } });
  const text = (t) => {
    if (!t) return;
    if (!started) { emit({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }); started = true; }
    emit({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } });
    sentText = true;
  };
  const finish = (stopReason, error) => {
    if (finished || res.writableEnded) return;
    finished = true;
    if (error) emit({ type: "error", error: { type: error.type || "api_error", message: error.message } });
    else {
      if (started) emit({ type: "content_block_stop", index: 0 });
      emit({ type: "message_delta", delta: { stop_reason: stopReason || "end_turn" } });
      emit({ type: "message_stop" });
    }
    res.end();
  };

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === "stream_event" && msg.event?.type === "content_block_delta" && msg.event.delta?.type === "text_delta") {
        text(msg.event.delta.text);
      } else if (msg.type === "assistant" && !sentText) {
        // senza messaggi parziali: usa il testo completo del turno
        for (const b of msg.message?.content || []) if (b.type === "text") text(b.text);
      } else if (msg.type === "result") {
        if (msg.is_error) {
          const m = String(msg.result || msg.subtype || "errore");
          const auth = /login|log in|api key|authenticat|unauthori/i.test(m);
          finish(null, {
            type: auth ? "authentication_error" : "api_error",
            message: auth ? "Claude Code non è autenticato: esegui `claude` nel terminale e accedi con il tuo account." : m,
          });
        } else {
          if (!sentText && msg.result) text(msg.result);
          finish(msg.stop_reason === "max_tokens" ? "max_tokens" : "end_turn");
        }
      }
    }
  });
  child.stderr.on("data", (d) => { if (stderr.length < 4000) stderr = (stderr + d).slice(0, 4000); });
  // EPIPE se `claude` esce prima di leggere tutto: a Trama l'errore lo manda `close`, con lo stderr.
  child.stdin.on("error", (e) => console.error(`Scrittura verso Claude Code non riuscita: ${e.code || e.message}`));
  child.on("error", (e) => {
    finish(null, { message: e.code === "ENOENT" ? "Comando `claude` non trovato: installa Claude Code (npm install -g @anthropic-ai/claude-code)." : e.message });
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (!finished) finish(null, { message: `Claude Code si è fermato (codice ${code}). ${stderr.trim().slice(0, 300)}` });
  });
  res.on("close", () => { if (!finished) stop(child); });

  child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: toUserContent(messages) } }) + "\n");
  child.stdin.end();
}

const server = http.createServer((req, res) => {
  const allowed = cors(req, res);
  if (!allowed) return sendJson(res, 403, { ok: false, code: "forbidden", message: "Origine non consentita." });
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (TOKEN && req.headers["x-bridge-token"] !== TOKEN) {
    return sendJson(res, 401, { ok: false, code: "bridge_token", message: "Token del ponte mancante o errato." });
  }
  if (req.method === "GET" && url.pathname === "/health") {
    return authStatus().then((loggedIn) => sendJson(res, 200, { ok: true, bridge: "claude-code", loggedIn }));
  }
  if (req.method === "POST" && url.pathname === "/ai") {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      if (tooBig) return;
      size += c.length;
      if (size <= MAX_BODY) return chunks.push(c);
      tooBig = true;
      chunks.length = 0;
      res.setHeader("connection", "close");
      sendJson(res, 413, { ok: false, code: "too_large", message: "Richiesta troppo grande per il ponte." });
    });
    req.on("end", () => {
      if (tooBig) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return sendJson(res, 400, { ok: false, code: "invalid_request", message: "JSON non valido." }); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, 400, { ok: false, code: "invalid_request", message: "La richiesta deve essere un oggetto JSON." });
      handleAi(req, res, body);
    });
    return;
  }
  sendJson(res, 404, { ok: false, code: "not_found" });
});

// Un errore sfuggito a un handler non deve spegnere il ponte mentre Trama lo usa.
process.on("uncaughtException", (e) => console.error("Errore inatteso nel ponte:", e?.stack || e));

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`La porta ${PORT} è già occupata: probabilmente un altro ponte è ancora acceso (in un altro terminale).`);
    console.error("Chiudilo con Ctrl+C in quel terminale, poi riavvia questo.");
    process.exit(1);
  }
  console.error(`Il ponte non riesce ad ascoltare sulla porta ${PORT}: ${e.code || ""} ${e.message}`);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", async () => {
  const loggedIn = await authStatus();
  console.log(`Ponte Claude Code attivo su http://127.0.0.1:${PORT}`);
  console.log(`Origini consentite: ${[...ORIGINS].join(", ")}`);
  console.log(`Claude Code: ${CLAUDE}`);
  if (API_KEYS.length) console.log(`Attenzione: il ponte usa l'abbonamento Claude Code e ignora ${API_KEYS.join(" e ")}.`);
  if (loggedIn === false) console.log("Attenzione: Claude Code non è autenticato. In un altro terminale esegui `claude` e accedi.");
  console.log(TOKEN ? "Token del ponte attivo: Trama lo deve conoscere (campo «Token» nelle impostazioni del ponte)." : "Nessun token impostato (BRIDGE_TOKEN): il ponte accetta solo questo computer. Imposta un token se lo esponi con un tunnel.");
  console.log("Lascia aperto questo terminale mentre usi Trama. Ctrl+C per fermarlo.");
});
