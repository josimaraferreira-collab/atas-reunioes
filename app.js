// Solven Atas — app (PWA). Conversa com o servidor da Solven (Node + SQL Server) em /solven-atas.
const BASE = document.querySelector('meta[name="app-base"]')?.content || "";
const rota = (p) => BASE + p;
const BLOCO_MS = 10 * 60 * 1000; // cada trecho tem até 10 min de áudio

const $app = document.getElementById("app");
let usuario = null;
let gravador = null; // gravação em andamento (só uma por vez)
let pollTimer = null;
let csrf = "";

// Chamada à API do servidor (mesmo endereço, cookie de sessão + proteção CSRF)
class ErroApi extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(caminho, { method = "GET", json, form } = {}) {
  const headers = {};
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const r = await fetch(rota(caminho), { method, headers, body, credentials: "same-origin" });
  if (r.status === 401) { if (!gravador) { usuario = null; telaLogin(); } throw new ErroApi("Sua sessão expirou. Entre novamente.", 401); }
  const tipo = r.headers.get("content-type") || "";
  const dados = tipo.includes("application/json") ? await r.json().catch(() => null) : null;
  if (!r.ok) throw new ErroApi(dados?.erro || "Não foi possível falar com o servidor. Tente de novo.", r.status);
  return dados;
}

/* ============ utilidades ============ */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const relogio = (seg) => {
  seg = Math.max(0, Math.floor(seg));
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
};
const duracaoTexto = (seg) => {
  seg = Math.round(seg || 0);
  if (seg < 60) return `${seg} s`;
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
};
const dataTexto = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dataLonga = (iso) => new Date(iso).toLocaleString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("mostrar");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("mostrar"), ms);
}

const ic = {
  voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  pausa: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  parar: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v14"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  editar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  refazer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5"/></svg>',
  word: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13l1.5 5 2.5-4 2.5 4 1.5-5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/></svg>',
};

/* ============ IndexedDB: guarda o áudio no aparelho até ele subir ============ */
const idb = {
  db: null,
  abrir() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("atas-local", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("pedacos", { autoIncrement: true }).createIndex("k", "k");
        db.createObjectStore("blocos", { keyPath: "k" });
      };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(store, modo, fn) {
    const db = await this.abrir();
    return new Promise((res, rej) => {
      const t = db.transaction(store, modo);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((v) => (out = v));
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
    });
  },
  req: (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async addPedaco(k, blob) { try { await this.tx("pedacos", "readwrite", (s) => s.add({ k, blob })); } catch (e) { console.warn(e); } },
  async putBloco(b) { try { await this.tx("blocos", "readwrite", (s) => s.put(b)); } catch (e) { console.warn(e); } },
  async blocos() { try { return await this.tx("blocos", "readonly", (s) => this.req(s.getAll())); } catch { return []; } },
  async pedacos(k) {
    return this.tx("pedacos", "readonly", (s) => this.req(s.index("k").getAll(k)));
  },
  async apagar(k) {
    try {
      await this.tx("pedacos", "readwrite", (s) => {
        const c = s.index("k").openCursor(IDBKeyRange.only(k));
        c.onsuccess = () => { const cur = c.result; if (cur) { cur.delete(); cur.continue(); } };
      });
      await this.tx("blocos", "readwrite", (s) => s.delete(k));
    } catch (e) { console.warn(e); }
  },
};

/* ============ envio dos trechos e fila de transcrição ============ */
function extDe(mime) { return mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : "m4a"; }

async function enviarTrecho({ k, reuniaoId, ordem, mime, duracao, blob }) {
  const tipo = mime.split(";")[0];
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      const form = new FormData();
      form.append("ordem", String(ordem));
      form.append("duracao", String(Math.round(duracao || 0)));
      form.append("audio", new File([blob], `trecho-${String(ordem).padStart(3, "0")}.${extDe(mime)}`, { type: tipo }));
      await api(`/api/reunioes/${reuniaoId}/trechos`, { method: "POST", form });
      if (k) await idb.apagar(k);
      return true;
    } catch (e) {
      console.warn("envio falhou", e);
      if (e.status === 401 || e.status === 404 || e.status === 400) return false;
      await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
    }
  }
  return false; // fica guardado no aparelho e sobe depois
}

// Sobe trechos que ficaram no aparelho (sem internet, app fechado no meio etc.)
async function recuperarPendentes() {
  const blocos = await idb.blocos();
  let enviados = 0;
  for (const b of blocos) {
    if (gravador && gravador.reuniaoId === b.reuniaoId && gravador.ordem === b.ordem) continue;
    if (b.uid !== usuario.id) continue;
    const pedacos = await idb.pedacos(b.k);
    if (!pedacos.length) { await idb.apagar(b.k); continue; }
    const blob = new Blob(pedacos.map((p) => p.blob), { type: b.mime.split(";")[0] });
    const ok = await enviarTrecho({ ...b, blob });
    if (ok) enviados++;
  }
  return enviados;
}

function atualizarTela(reuniaoId) {
  if (location.hash === `#/r/${reuniaoId}` && telaDetalhe.recarregar) telaDetalhe.recarregar();
}

/* ============ gravador em trechos ============ */
class Gravador {
  constructor(reuniao, ordemInicial = 0, segInicial = 0) {
    this.reuniao = reuniao;
    this.reuniaoId = reuniao.id;
    this.ordem = ordemInicial;
    this.totalAnterior = segInicial; // segundos já gravados antes (retomada)
    this.ativoMs = 0;     // tempo gravado no trecho atual
    this.totalMs = 0;     // tempo gravado nesta sessão
    this.pausado = false;
    this.interrompido = false;
    this.enviados = 0;
    this.envios = [];
    this.onTick = () => {};
  }

  escolherMime() {
    const op = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    return op.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  }

  static microfone() {
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  }

  async iniciar(stream) {
    this.stream = stream || await Gravador.microfone();
    this.mime = this.escolherMime();
    this.stream.getAudioTracks().forEach((t) => (t.onended = () => this.marcarInterrupcao()));
    this.medidor();
    this.novoTrecho();
    this.ultimo = performance.now();
    this.loop = setInterval(() => this.tick(), 250);
    this.travarTela();
    document.addEventListener("visibilitychange", this.onVis = () => this.visibilidade());
  }

  novoTrecho() {
    const opts = { audioBitsPerSecond: 64000 };
    if (this.mime) opts.mimeType = this.mime;
    const rec = new MediaRecorder(this.stream, opts);
    const k = `${this.reuniaoId}|${this.ordem}`;
    const info = { k, uid: usuario.id, reuniaoId: this.reuniaoId, ordem: this.ordem, mime: rec.mimeType || this.mime || "audio/mp4", duracao: 0 };
    const pedacos = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) { pedacos.push(e.data); idb.addPedaco(k, e.data); }
    };
    rec.onstop = () => {
      if (info.enviado) return;
      info.enviado = true;
      const blob = new Blob(pedacos, { type: info.mime.split(";")[0] });
      info.duracao = info.duracaoFinal ?? (this.info === info ? this.ativoMs / 1000 : info.duracao);
      idb.putBloco(info);
      if (blob.size === 0) { idb.apagar(k); return; }
      const p = enviarTrecho({ ...info, blob }).then((ok) => {
        if (ok) this.enviados++;
        this.onTick();
      });
      this.envios.push(p);
    };
    idb.putBloco(info);
    rec.start(1000);
    this.rec = rec;
    this.info = info;
    this.ativoMs = 0;
  }

  trocarTrecho() {
    const antigo = this.rec, infoAntigo = this.info;
    infoAntigo.duracaoFinal = this.ativoMs / 1000;
    this.ordem++;
    this.novoTrecho();      // começa o novo antes de parar o antigo: sem buraco no áudio
    try { antigo.stop(); } catch {}
  }

  tick() {
    const agora = performance.now();
    const dt = agora - this.ultimo;
    this.ultimo = agora;
    if (!this.pausado && !this.interrompido && this.rec?.state === "recording") {
      this.ativoMs += dt;
      this.totalMs += dt;
      if (Math.floor(this.ativoMs / 5000) !== Math.floor((this.ativoMs - dt) / 5000)) {
        this.info.duracao = this.ativoMs / 1000;
        idb.putBloco(this.info);
      }
      if (this.ativoMs >= BLOCO_MS) this.trocarTrecho();
    }
    if (this.rec && this.rec.state === "inactive" && !this.parando && !this.interrompido) this.marcarInterrupcao();
    this.onTick();
  }

  get segundos() { return this.totalAnterior + this.totalMs / 1000; }

  pausar() { if (this.rec?.state === "recording") { this.rec.pause(); this.pausado = true; this.onTick(); } }
  continuar() { if (this.rec?.state === "paused") { this.rec.resume(); this.pausado = false; this.ultimo = performance.now(); this.onTick(); } }

  marcarInterrupcao() {
    if (this.interrompido || this.parando) return;
    this.interrompido = true;
    // salva o que já foi gravado neste trecho
    if (this.info && !this.info.enviado) this.info.duracaoFinal = this.ativoMs / 1000;
    try { if (this.rec && this.rec.state !== "inactive") this.rec.stop(); } catch {}
    this.onTick();
  }

  async retomar() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = await Gravador.microfone();
    this.stream.getAudioTracks().forEach((t) => (t.onended = () => this.marcarInterrupcao()));
    this.medidor();
    this.ordem++;
    this.interrompido = false;
    this.pausado = false;
    this.ultimo = performance.now();
    this.novoTrecho();
    this.travarTela();
    this.onTick();
  }

  visibilidade() {
    if (document.visibilityState === "visible") {
      this.travarTela();
      const trilha = this.stream?.getAudioTracks()[0];
      if (!trilha || trilha.readyState === "ended" || trilha.muted) this.marcarInterrupcao();
      this.audioCtx?.resume?.();
    }
  }

  async travarTela() {
    try { if ("wakeLock" in navigator && document.visibilityState === "visible") this.lock = await navigator.wakeLock.request("screen"); } catch {}
  }

  medidor() {
    try {
      this.audioCtx?.close?.();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new Ctx();
      this.audioCtx.resume?.();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.buf = new Uint8Array(this.analyser.fftSize);
    } catch { this.analyser = null; }
  }

  nivel() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let soma = 0;
    for (const v of this.buf) { const x = (v - 128) / 128; soma += x * x; }
    return Math.min(1, Math.sqrt(soma / this.buf.length) * 4);
  }

  async parar() {
    this.parando = true;
    clearInterval(this.loop);
    document.removeEventListener("visibilitychange", this.onVis);
    if (this.rec && this.rec.state !== "inactive") {
      this.info.duracaoFinal = this.ativoMs / 1000;
      await new Promise((res) => { const o = this.rec.onstop; this.rec.onstop = () => { o(); res(); }; this.rec.stop(); });
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.audioCtx?.close(); } catch {}
    try { await this.lock?.release(); } catch {}
    await Promise.all(this.envios);
  }
}

/* ============ markdown simples para a ata ============ */
function markdown(md) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");
  const linhas = String(md || "").replace(/\r/g, "").split("\n");
  let html = "", lista = null, par = [];
  const fecharPar = () => { if (par.length) { html += `<p>${par.map(inline).join("<br>")}</p>`; par = []; } };
  const fecharLista = () => { if (lista) { html += `</${lista}>`; lista = null; } };
  for (const l of linhas) {
    let m;
    if (!l.trim()) { fecharPar(); fecharLista(); continue; }
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { fecharPar(); fecharLista(); const n = Math.min(m[1].length, 3); html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { fecharPar(); if (lista !== "ul") { fecharLista(); html += "<ul>"; lista = "ul"; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { fecharPar(); if (lista !== "ol") { fecharLista(); html += "<ol>"; lista = "ol"; } html += `<li>${inline(m[1])}</li>`; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { fecharPar(); fecharLista(); continue; }
    fecharLista(); par.push(l.trim());
  }
  fecharPar(); fecharLista();
  return html;
}
const textoPuro = (md) => String(md || "").replace(/^#{1,4}\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1$2").replace(/^\s*[-*]\s+/gm, "• ");

/* ============ PDF no padrão Solven ============ */
// Gera o arquivo no servidor (PDF ou Word) e oferece Salvar/Enviar (funciona no app instalado no iPhone).
const TIPOS = {
  pdf: { mime: "application/pdf", nome: "PDF", espera: "Gerando o PDF… pode levar alguns segundos" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", nome: "Word", espera: "Gerando o Word…" },
};
async function gerarArquivo(reu, botao, tipo) {
  const t = TIPOS[tipo];
  const original = botao?.innerHTML;
  if (botao) { botao.disabled = true; botao.innerHTML = '<span class="girando"></span> Gerando…'; }
  toast(t.espera, 6000);
  try {
    const r = await fetch(rota(`/api/reunioes/${reu.id}/${tipo}`), { credentials: "same-origin" });
    if (r.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
    if (!r.ok) {
      let msg = `Não consegui gerar o ${t.nome} agora.`;
      try { const j = await r.json(); if (j?.erro) msg = j.erro; } catch {}
      throw new Error(msg);
    }
    const blob = await r.blob();
    const nome = decodeURIComponent(r.headers.get("X-Nome-Arquivo") || "") || `Ata.${tipo}`;
    mostrarPdfPronto(new File([blob], nome, { type: t.mime }), t.nome);
  } catch (e) {
    toast(e.message || `Não consegui gerar o ${t.nome} agora.`, 5000);
  } finally {
    if (botao) { botao.disabled = false; botao.innerHTML = original; }
  }
}

function mostrarPdfPronto(arquivo, rotuloTipo = "PDF") {
  document.getElementById("pdfPronto")?.remove();
  const url = URL.createObjectURL(arquivo);
  const podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [arquivo] }));
  const el = document.createElement("div");
  el.id = "pdfPronto";
  el.innerHTML = `<div class="folha-pdf" role="dialog" aria-label="Arquivo pronto">
      <div class="t">${rotuloTipo} pronto</div>
      <div class="d">${esc(arquivo.name)}</div>
      ${podeCompartilhar ? `<button class="btn primario bloco" id="pdfShare">${ic.enviar} Salvar ou enviar</button>` : ""}
      <a class="btn bloco" id="pdfAbrir" href="${url}" download="${esc(arquivo.name)}" target="_blank" rel="noopener">${ic.pdf} ${podeCompartilhar ? "Abrir" : "Baixar"}</a>
      <button class="btn bloco" id="pdfFechar">Fechar</button>
    </div>`;
  document.body.appendChild(el);
  const fechar = () => { el.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  el.addEventListener("click", (e) => { if (e.target === el) fechar(); });
  document.getElementById("pdfFechar").onclick = fechar;
  const sh = document.getElementById("pdfShare");
  if (sh) sh.onclick = async () => {
    try { await navigator.share({ files: [arquivo], title: arquivo.name.replace(/\.(pdf|docx)$/, "") }); fechar(); }
    catch (e) { if (e?.name !== "AbortError") toast("Não consegui abrir o compartilhamento. Use Abrir."); }
  };
}

function rotas() {
  clearInterval(pollTimer);
  telaDetalhe.recarregar = null;
  const h = location.hash || "#/";
  if (!usuario) return telaLogin();
  if (gravador && !h.startsWith(`#/gravar/${gravador.reuniaoId}`)) { location.hash = `#/gravar/${gravador.reuniaoId}`; return; }
  let m;
  if (h === "#/nova") return telaForm();
  if ((m = h.match(/^#\/editar\/(.+)$/))) return telaForm(m[1]);
  if ((m = h.match(/^#\/gravar\/(.+)$/))) return telaGravar(m[1]);
  if ((m = h.match(/^#\/r\/(.+)$/))) return telaDetalhe(m[1]);
  return telaLista();
}

function telaLogin() {
  const erro = new URLSearchParams(location.search).get("authError");
  const msg = erro === "denied" ? "Sua conta não tem acesso ao Atas. Peça liberação à TI." : erro === "expired" ? "O login demorou demais. Tente de novo." : "";
  $app.innerHTML = `
    <div class="login">
      <img class="logo-login" src="${BASE}/brand/solven-logo-horizontal-color.webp" alt="Solven">
      <div class="marca">Atas</div>
      <p>Grave a reunião e receba a ata pronta.</p>
      ${msg ? `<div class="aviso vermelho" style="margin:0 0 16px">${esc(msg)}</div>` : ""}
      <a class="btn primario bloco" href="${BASE}/auth/login">Entrar com a conta Microsoft</a>
      <p style="margin-top:14px;font-size:14px">Use o mesmo login da Solven (e-mail e senha da Microsoft).</p>
    </div>`;
}

function selo(status) {
  const map = {
    gravando: ["gravando", "Gravando"], transcrevendo: ["processando", "Transcrevendo"],
    gerando_ata: ["processando", "Escrevendo ata"], pronta: ["pronta", "Ata pronta"], erro: ["erro", "Erro"],
  };
  const [c, t] = map[status] || ["", status];
  return `<span class="selo ${c}">${t}</span>`;
}

async function telaLista() {
  const padrao = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  let dicaFechada = false; try { dicaFechada = localStorage.getItem("atas-dica") === "1"; } catch {}
  $app.innerHTML = `
    <div class="topo"><h1>Atas</h1><button class="icone" id="sair" aria-label="Sair">${ic.sair}</button></div>
    ${iOS && !padrao && !dicaFechada ? `<div class="dica-instalar">Para instalar: toque em Compartilhar e depois em “Adicionar à Tela de Início”.<button id="fechaDica" aria-label="Fechar">✕</button></div>` : ""}
    <div id="lista"><div class="vazio"><span class="girando"></span></div></div>
    <button class="fab" id="nova"><span class="ponto"></span>Nova reunião</button>`;
  document.getElementById("sair").onclick = async () => {
    if (!confirm("Sair do app?")) return;
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    usuario = null; telaLogin();
  };
  document.getElementById("nova").onclick = () => (location.hash = "#/nova");
  const fd = document.getElementById("fechaDica");
  if (fd) fd.onclick = () => { try { localStorage.setItem("atas-dica", "1"); } catch {} fd.parentElement.remove(); };

  let data;
  try { data = await api("/api/reunioes"); }
  catch (e) { const el = document.getElementById("lista"); if (el) el.innerHTML = `<div class="vazio">Não consegui carregar. ${esc(e.message)}</div>`; return; }
  const el = document.getElementById("lista");
  if (!el) return;
  if (!data.length) {
    el.innerHTML = `<div class="vazio"><div class="grande">Nenhuma reunião ainda</div>Toque em <b>Nova reunião</b>, deixe o iPhone no meio da mesa e grave. A ata sai pronta no final.</div>`;
    return;
  }
  el.innerHTML = `<div class="lista">${data.map((r) => `
    <a class="cartao" href="#/r/${r.id}">
      <div class="titulo">${esc(r.titulo)}</div>
      <div class="meta"><span>${dataTexto(r.data_reuniao)}</span>${r.duracao_seg ? `<span>· ${duracaoTexto(r.duracao_seg)}</span>` : ""}${selo(r.status)}</div>
    </a>`).join("")}</div>`;
  // atualiza sozinho enquanto alguma ata estiver sendo feita no servidor
  if (data.some((r) => r.status === "transcrevendo" || r.status === "gerando_ata")) pollTimer = setInterval(() => { if (location.hash === "" || location.hash === "#/") telaLista(); }, 8000);
}

async function telaForm(id) {
  let r = { titulo: "", local: "", participantes: "", pauta: "" };
  if (id) {
    try { const d = await api(`/api/reunioes/${id}`); r = d.reuniao; } catch (e) { toast(e.message); }
  }
  $app.innerHTML = `
    <div class="topo"><button class="icone" id="voltar" aria-label="Voltar">${ic.voltar}</button><h2>${id ? "Dados da reunião" : "Nova reunião"}</h2><span style="width:44px"></span></div>
    <form id="f">
      <label class="campo"><span>Assunto</span><input name="titulo" value="${esc(r.titulo)}" placeholder="Ex.: Reunião de condomínio" required></label>
      <label class="campo"><span>Local</span><input name="local" value="${esc(r.local)}" placeholder="Opcional"></label>
      <label class="campo"><span>Participantes</span><textarea name="participantes" placeholder="Nomes separados por vírgula">${esc(r.participantes)}</textarea><small>Ajuda a IA a colocar o nome certo em quem fala. Opcional.</small></label>
      <label class="campo"><span>Pauta prevista</span><textarea name="pauta" placeholder="Opcional">${esc(r.pauta)}</textarea></label>
      <button class="btn ${id ? "primario" : ""} bloco" id="ok" style="${id ? "" : "background:var(--rec);border-color:var(--rec);color:#fff"}">${id ? "Salvar" : `${ic.mic} Começar a gravar`}</button>
    </form>`;
  document.getElementById("voltar").onclick = () => history.back();
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const dados = { titulo: fd.titulo.trim() || "Reunião", local: fd.local.trim(), participantes: fd.participantes.trim(), pauta: fd.pauta.trim() };
    const b = document.getElementById("ok"); b.disabled = true;
    if (id) {
      try { await api(`/api/reunioes/${id}`, { method: "PUT", json: dados }); }
      catch (e) { toast(e.message); b.disabled = false; return; }
      location.hash = `#/r/${id}`;
      return;
    }
    // pede o microfone já no toque (exigência do iPhone)
    let stream;
    try { stream = await Gravador.microfone(); }
    catch {
      toast("Preciso de acesso ao microfone. Libere em Ajustes do iPhone.", 5000);
      b.disabled = false; return;
    }
    let nova;
    try { nova = await api("/api/reunioes", { method: "POST", json: dados }); }
    catch (e) { stream.getTracks().forEach((t) => t.stop()); toast(e.message); b.disabled = false; return; }
    const g = new Gravador(nova);
    try { await g.iniciar(stream); }
    catch (err) {
      try { await api(`/api/reunioes/${nova.id}`, { method: "DELETE" }); } catch {}
      toast("Não consegui iniciar a gravação neste aparelho.", 5000);
      b.disabled = false; return;
    }
    gravador = g;
    location.replace(`#/gravar/${nova.id}`);
  };
}

async function telaGravar(id) {
  if (!gravador || gravador.reuniaoId !== id) { location.replace(`#/r/${id}`); return; }
  const g = gravador;
  $app.innerHTML = `
    <div class="gravacao">
      <div class="assunto">${esc(g.reuniao.titulo)}</div>
      <div class="estado" id="estado">Gravando</div>
      <div class="relogio" id="rel">00:00</div>
      <div class="nivel" id="nivel">${"<i></i>".repeat(21)}</div>
      <div class="controles">
        <div><button class="ctrl" id="pausa" aria-label="Pausar">${ic.pausa}</button><div class="ctrl-legenda" id="pausaLeg">Pausar</div></div>
        <div><button class="ctrl parar" id="parar" aria-label="Encerrar">${ic.parar}</button><div class="ctrl-legenda">Encerrar</div></div>
        <div style="width:64px"></div>
      </div>
      <div id="avisoBox"></div>
      <div class="trechos-env" id="env"></div>
    </div>`;
  const barras = [...document.querySelectorAll("#nivel i")];
  const $rel = document.getElementById("rel"), $estado = document.getElementById("estado");
  const $nivel = document.getElementById("nivel"), $aviso = document.getElementById("avisoBox"), $env = document.getElementById("env");
  const $pausa = document.getElementById("pausa"), $pausaLeg = document.getElementById("pausaLeg");
  let ultimoEstado = "";

  g.onTick = () => {
    $rel.textContent = relogio(g.segundos);
    const n = g.pausado || g.interrompido ? 0 : g.nivel();
    barras.forEach((b, i) => {
      const c = Math.abs(i - 10) / 10;
      const v = Math.max(0.08, n * (1 - c * 0.7) * (0.75 + Math.random() * 0.5));
      b.style.height = `${Math.round(6 + v * 50)}px`;
    });
    const estado = g.interrompido ? "int" : g.pausado ? "pau" : "rec";
    if (estado !== ultimoEstado) {
      ultimoEstado = estado;
      $nivel.classList.toggle("pausado", estado !== "rec");
      $estado.textContent = estado === "int" ? "Gravação interrompida" : estado === "pau" ? "Pausado" : "Gravando";
      $pausa.innerHTML = estado === "rec" ? ic.pausa : ic.play;
      $pausaLeg.textContent = estado === "rec" ? "Pausar" : "Continuar";
      $aviso.innerHTML = estado === "int"
        ? `<div class="aviso vermelho">O iPhone parou o microfone (tela bloqueada ou outro app). O que já foi gravado está salvo. Toque em <b>Continuar</b> para seguir gravando.</div>`
        : `<div class="aviso">Deixe o app aberto e a tela ligada. Se a tela bloquear, o iPhone pode parar a gravação, mas nada do que já foi gravado se perde.</div>`;
    }
    $env.textContent = g.enviados ? `${g.enviados} trecho(s) já salvos no servidor e sendo transcritos` : "";
  };
  g.onTick();

  $pausa.onclick = async () => {
    if (g.interrompido) {
      try { await g.retomar(); } catch { toast("Não consegui ligar o microfone de novo."); }
    } else if (g.pausado) g.continuar(); else g.pausar();
  };
  document.getElementById("parar").onclick = async () => {
    if (!confirm("Encerrar a gravação e gerar a ata?")) return;
    $app.innerHTML = `<div class="gravacao"><div class="relogio" style="font-size:20px"><span class="girando"></span></div><div class="estado">Salvando o áudio…</div></div>`;
    const seg = Math.round(g.segundos);
    await g.parar();
    gravador = null;
    await recuperarPendentes().catch(() => 0);
    try { await api(`/api/reunioes/${id}/finalizar`, { method: "POST", json: { duracao_seg: seg } }); }
    catch (e) { toast(e.message, 5000); }
    location.replace(`#/r/${id}`);
  };
}

async function telaDetalhe(id) {
  let aba = sessionStorage.getItem("aba-" + id) || "ata";
  let editando = false;
  let reu = null, segs = [];

  $app.innerHTML = `
    <div class="topo"><button class="icone" id="voltar" aria-label="Voltar">${ic.voltar}</button><h2></h2><button class="icone" id="editarDados" aria-label="Editar dados">${ic.editar}</button></div>
    <div id="cab"></div><div id="corpo"><div class="vazio"><span class="girando"></span></div></div>`;
  document.getElementById("voltar").onclick = () => (location.hash = "#/");
  document.getElementById("editarDados").onclick = () => (location.hash = `#/editar/${id}`);

  async function carregar() {
    try {
      const d = await api(`/api/reunioes/${id}`);
      reu = d.reuniao; segs = d.segmentos || [];
      return true;
    } catch (e) {
      if (e.status === 401) return false;
      if (e.status === 404) { $app.innerHTML = `<div class="vazio">Reunião não encontrada. <a href="#/">Voltar</a></div>`; return false; }
      if (!reu) { $app.innerHTML = `<div class="vazio">${esc(e.message)} <a href="#/">Voltar</a></div>`; }
      return false;
    }
  }

  function painelStatus() {
    const total = segs.length, ok = segs.filter((s) => s.status === "ok").length;
    const erros = segs.filter((s) => s.status === "erro");
    if (reu.status === "gravando") {
      return `<div class="painel-status"><div class="t">A gravação foi interrompida</div><div class="d">O app foi fechado durante a gravação. ${total ? `${total} trecho(s) foram salvos.` : "Nenhum trecho chegou a ser salvo."}</div>
        <div class="linha-btns"><button class="btn primario" id="finalizar" ${total ? "" : "disabled"}>Gerar ata com o que foi gravado</button><button class="btn" id="continuarGrav">Continuar gravando</button></div></div>`;
    }
    if (reu.status === "transcrevendo") {
      return `<div class="painel-status"><div class="t"><span class="girando"></span> Transcrevendo o áudio</div><div class="d">${ok} de ${total} trecho(s) prontos. O servidor continua mesmo se você fechar o app.</div><div class="barra"><i style="width:${total ? Math.round((ok / total) * 100) : 5}%"></i></div></div>`;
    }
    if (reu.status === "gerando_ata") {
      return `<div class="painel-status"><div class="t"><span class="girando"></span> Escrevendo a ata</div><div class="d">Leva menos de um minuto.</div><div class="barra"><i style="width:92%"></i></div></div>`;
    }
    if (reu.status === "erro") {
      return `<div class="painel-status"><div class="t" style="color:var(--rec)">Algo deu errado</div><div class="d">${esc(reu.erro || (erros[0]?.erro) || "Erro desconhecido")}</div><button class="btn primario" id="tentar">${ic.refazer} Tentar de novo</button></div>`;
    }
    return "";
  }

  function render() {
    document.querySelector(".topo h2").textContent = "";
    document.getElementById("cab").innerHTML = `
      <div class="cab-reuniao">
        <div class="titulo">${esc(reu.titulo)}</div>
        <div class="meta">${dataLonga(reu.data_reuniao)}${reu.duracao_seg ? ` · ${duracaoTexto(reu.duracao_seg)}` : ""}${reu.local ? ` · ${esc(reu.local)}` : ""}</div>
      </div>
      ${painelStatus()}
      <div class="abas" role="tablist">
        ${[["ata", "Ata"], ["transcricao", "Transcrição"], ["audio", "Áudio"]].map(([k, t]) => `<button role="tab" data-aba="${k}" aria-selected="${aba === k}">${t}</button>`).join("")}
      </div>`;
    document.querySelectorAll("[data-aba]").forEach((b) => (b.onclick = () => { aba = b.dataset.aba; sessionStorage.setItem("aba-" + id, aba); editando = false; render(); }));
    ligarStatus();
    const corpo = document.getElementById("corpo");
    if (aba === "ata") corpo.innerHTML = htmlAta();
    if (aba === "transcricao") corpo.innerHTML = htmlTranscricao();
    if (aba === "audio") corpo.innerHTML = htmlAudio();
    ligarAcoes();
  }

  function htmlAta() {
    if (editando) {
      return `<div class="folha"><textarea id="txtAta">${esc(reu.ata || "")}</textarea></div>
        <div class="acoes-ata"><button class="btn" id="cancelar">Cancelar</button><button class="btn primario" id="salvar">Salvar</button></div>`;
    }
    if (!reu.ata) {
      return `<div class="vazio">${reu.status === "pronta" || reu.status === "erro" ? "A ata ainda não foi gerada." : "A ata aparece aqui assim que a transcrição terminar."}</div>`;
    }
    return `<article class="folha" id="folha">${markdown(reu.ata)}</article>
      <div class="acoes-ata">
        <button class="btn" id="copiar">${ic.copiar} Copiar</button>
        <button class="btn" id="compartilhar">${ic.enviar} Enviar</button>
        <button class="btn" id="imprimir">${ic.pdf} PDF</button>
        <button class="btn" id="word">${ic.word} Word</button>
        <button class="btn" id="editar" style="grid-column:1/-1">${ic.editar} Editar</button>
      </div>
      <button class="btn bloco nao-imprimir" id="refazerAta" style="margin-top:8px">${ic.refazer} Gerar a ata de novo</button>`;
  }

  function htmlTranscricao() {
    const texto = segs.map((s) => s.transcricao || "").join("\n").trim();
    if (!texto) return `<div class="vazio">A transcrição aparece aqui conforme os trechos forem processados.</div>`;
    const linhas = texto.split("\n").filter((l) => l.trim());
    return `<div class="transcricao">${linhas.map((l) => {
      const m = l.match(/^\[([\d:]+)\]\s*([^:]{1,40}):\s*(.*)$/);
      if (!m) return `<div class="fala solta">${esc(l)}</div>`;
      return `<div class="fala"><div class="q"><b>${esc(m[2])}</b>${esc(m[1])}</div>${esc(m[3])}</div>`;
    }).join("")}</div>
    <button class="btn bloco" id="copiarTrans" style="margin-top:12px">${ic.copiar} Copiar transcrição</button>`;
  }

  function htmlAudio() {
    if (reu.audio_apagado) return `<div class="vazio">O áudio desta reunião foi apagado. A transcrição e a ata continuam guardadas.</div>${perigo()}`;
    if (!segs.length) return `<div class="vazio">Nenhum áudio salvo.</div>${perigo()}`;
    let ini = 0;
    return segs.map((s) => {
      const de = ini; ini += s.duracao_seg || 0;
      const st = { ok: "Transcrito", pendente: "Na fila", processando: "Transcrevendo…", erro: "Erro" }[s.status];
      return `<div class="trecho">
        <div class="cab"><span>Trecho ${s.ordem + 1} · ${relogio(de)}–${relogio(ini)}</span><span class="selo ${s.status === "ok" ? "pronta" : s.status === "erro" ? "erro" : "processando"}">${st}</span></div>
        ${s.erro && s.status === "erro" ? `<div class="err">${esc(s.erro)}</div><button class="btn bloco" data-refazer="${s.id}" style="margin-bottom:8px">${ic.refazer} Transcrever de novo</button>` : ""}
        ${s.audio_bytes ? `<audio controls preload="none" src="${BASE}/api/trechos/${s.id}/audio"></audio>` : ""}
      </div>`;
    }).join("") + perigo();
  }

  const perigo = () => `<div class="secao-perigo">
      ${!reu.audio_apagado && segs.length ? `<button class="btn perigo bloco" id="apagarAudio">Apagar o áudio (mantém a ata)</button>` : ""}
      <button class="btn perigo bloco" id="excluir">Excluir reunião</button>
    </div>`;

  function ligarStatus() {
    const fin = document.getElementById("finalizar");
    if (fin) fin.onclick = async () => {
      try { await api(`/api/reunioes/${id}/finalizar`, { method: "POST", json: {} }); } catch (e) { toast(e.message); }
      await recarregar();
    };
    const cont = document.getElementById("continuarGrav");
    if (cont) cont.onclick = async () => {
      const prox = segs.length ? Math.max(...segs.map((s) => s.ordem)) + 1 : 0;
      const seg = segs.reduce((s, x) => s + (x.duracao_seg || 0), 0);
      const g = new Gravador(reu, prox, seg);
      try { await g.iniciar(); } catch { toast("Preciso de acesso ao microfone."); return; }
      gravador = g;
      location.replace(`#/gravar/${id}`);
    };
    const tent = document.getElementById("tentar");
    if (tent) tent.onclick = async () => {
      try { await api(`/api/reunioes/${id}/tentar-novamente`, { method: "POST" }); } catch (e) { toast(e.message); }
      await recarregar();
    };
  }

  function ligarAcoes() {
    const on = (i, f) => { const e = document.getElementById(i); if (e) e.onclick = f; };
    on("copiar", async () => { await navigator.clipboard.writeText(textoPuro(reu.ata)); toast("Ata copiada"); });
    on("copiarTrans", async () => { await navigator.clipboard.writeText(segs.map((s) => s.transcricao || "").join("\n")); toast("Transcrição copiada"); });
    on("compartilhar", async () => {
      const texto = textoPuro(reu.ata);
      if (navigator.share) { try { await navigator.share({ title: `Ata – ${reu.titulo}`, text: texto }); } catch {} }
      else { await navigator.clipboard.writeText(texto); toast("Copiada; cole onde quiser enviar"); }
    });
    on("imprimir", (ev) => gerarArquivo(reu, ev.currentTarget, "pdf"));
    on("word", (ev) => gerarArquivo(reu, ev.currentTarget, "docx"));
    on("editar", () => { editando = true; render(); });
    on("cancelar", () => { editando = false; render(); });
    on("salvar", async () => {
      const ata = document.getElementById("txtAta").value;
      try { await api(`/api/reunioes/${id}/ata`, { method: "PUT", json: { ata } }); } catch (e) { return toast(e.message); }
      reu.ata = ata; editando = false; render(); toast("Ata salva");
    });
    on("refazerAta", async () => {
      if (!confirm("Gerar a ata de novo? As edições que você fez nela serão substituídas.")) return;
      try { await api(`/api/reunioes/${id}/finalizar`, { method: "POST", json: {} }); } catch (e) { return toast(e.message); }
      await recarregar();
    });
    document.querySelectorAll("[data-refazer]").forEach((b) => (b.onclick = async () => {
      try { await api(`/api/trechos/${b.dataset.refazer}/tentar-novamente`, { method: "POST" }); } catch (e) { toast(e.message); }
      await recarregar();
    }));
    on("apagarAudio", async () => {
      if (!confirm("Apagar o áudio desta reunião? A transcrição e a ata ficam guardadas.")) return;
      try { await api(`/api/reunioes/${id}/audio`, { method: "DELETE" }); } catch (e) { return toast(e.message); }
      toast("Áudio apagado"); recarregar();
    });
    on("excluir", async () => {
      if (!confirm("Excluir esta reunião com áudio, transcrição e ata? Não dá para desfazer.")) return;
      try { await api(`/api/reunioes/${id}`, { method: "DELETE" }); } catch (e) { return toast(e.message); }
      toast("Reunião excluída"); location.hash = "#/";
    });
  }

  async function recarregar() {
    if (editando) return;
    if (location.hash !== `#/r/${id}`) return;
    const audiosTocando = [...document.querySelectorAll("audio")].some((a) => !a.paused);
    if (await carregar()) { if (!(aba === "audio" && audiosTocando)) render(); }
  }
  telaDetalhe.recarregar = recarregar;

  if (!(await carregar())) return;
  render();

  pollTimer = setInterval(() => {
    if (["transcrevendo", "gerando_ata"].includes(reu?.status) || segs.some((x) => x.status === "pendente" || x.status === "processando")) recarregar();
  }, 4000);
}

/* ============ início ============ */
window.addEventListener("hashchange", rotas);
window.addEventListener("beforeunload", (e) => { if (gravador) { e.preventDefault(); e.returnValue = ""; } });

async function iniciar() {
  try {
    const r = await fetch(rota("/api/me"), { credentials: "same-origin" });
    if (r.status === 401) return telaLogin();
    if (!r.ok) throw new Error();
    const d = await r.json();
    usuario = d.user; csrf = d.csrf;
    if (location.search.includes("authError")) history.replaceState(null, "", location.pathname + location.hash);
    rotas();
    recuperarPendentes().then((n) => { if (n) toast(`${n} trecho(s) recuperado(s) e enviados`); }).catch(() => {});
  } catch {
    $app.innerHTML = `<div class="vazio">Não consegui falar com o servidor.<br><br><button class="btn" id="recarregar">Tentar de novo</button></div>`;
    document.getElementById("recarregar").onclick = () => location.reload();
  }
}
iniciar();

if ("serviceWorker" in navigator) navigator.serviceWorker.register(rota("/sw.js"), { scope: BASE + "/" }).catch(() => {});
