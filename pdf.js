// Monta a ata no padrão "Ata / resumo de reunião" do Sistema Visual Solven.
// Recebe a reunião (com o markdown da ata gerado pelo Gemini) e devolve HTML pronto para imprimir/salvar em PDF.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1$2");
const semMd = (s) => String(s ?? "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1$2").trim();
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function duracao(seg) {
  seg = Math.round(seg || 0);
  if (seg < 60) return `${seg} s`;
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

// Separa o markdown em seções "## Título"
function secoes(md) {
  const out = [];
  let atual = null;
  for (const linha of String(md || "").replace(/\r/g, "").split("\n")) {
    const m = linha.match(/^##\s+(.*)$/);
    if (m) { atual = { titulo: m[1].trim(), linhas: [] }; out.push(atual); continue; }
    if (/^#\s+/.test(linha)) continue; // título principal: usamos o título da reunião
    if (atual) atual.linhas.push(linha);
  }
  return out;
}

const itens = (linhas) => linhas
  .map((l) => l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/))
  .filter(Boolean).map((m) => m[1].trim()).filter(Boolean);

const paragrafos = (linhas) => {
  const ps = []; let buf = [];
  for (const l of linhas) {
    if (!l.trim()) { if (buf.length) ps.push(buf.join(" ")); buf = []; continue; }
    buf.push(l.trim().replace(/^(?:[-*•])\s+/, ""));
  }
  if (buf.length) ps.push(buf.join(" "));
  return ps;
};

function topicos(linhas) {
  const ts = []; let t = null; const soltas = [];
  for (const l of linhas) {
    const m = l.match(/^###\s+(.*)$/);
    if (m) { t = { titulo: m[1].trim(), linhas: [] }; ts.push(t); continue; }
    (t ? t.linhas : soltas).push(l);
  }
  if (soltas.some((l) => l.trim())) ts.unshift({ titulo: "", linhas: soltas });
  return ts;
}

// "**Ação** — Responsável: X — Prazo: Y"
function encaminhamento(txt) {
  const partes = txt.split(/\s+[—–]\s+|\s+-\s+(?=(?:Respons|Prazo|Status))/i).map((p) => p.trim());
  const r = { acao: semMd(partes[0] || txt), resp: "", prazo: "", status: "" };
  for (const p of partes.slice(1)) {
    const m = p.match(/^(respons[aá]vel|prazo|status)\s*:\s*(.*)$/i);
    if (!m) { r.acao += " — " + semMd(p); continue; }
    const k = norm(m[1]); const v = semMd(m[2]).replace(/^[“"](.*)[”"]$/, "$1");
    if (k.startsWith("respons")) r.resp = v; else if (k === "prazo") r.prazo = v; else r.status = v;
  }
  return r;
}

export function extrairAta(reu) {
  const s = secoes(reu.ata);
  const pega = (...chaves) => s.find((x) => chaves.some((c) => norm(x.titulo).startsWith(c)));
  const usadas = new Set();
  const usar = (sec) => { if (sec) usadas.add(sec); return sec; };

  const secSintese = usar(pega("sintese", "resumo"));
  const secPart = usar(pega("participantes"));
  const secPauta = usar(pega("pauta"));
  const secDisc = usar(pega("discuss"));
  const secDelib = usar(pega("delibera", "decis"));
  const secEnc = usar(pega("encaminhamento", "acoes", "proximos passos"));
  const secPend = usar(pega("pendencia", "ressalva"));
  const secFim = usar(pega("encerramento"));
  const outras = s.filter((x) => !usadas.has(x) && x.linhas.some((l) => l.trim()));

  const dt = new Date(reu.data_reuniao);
  const data = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });
  const hora = dt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  // Síntese: usa a seção própria; senão, abre com a pauta resumida
  let sintese = secSintese ? paragrafos(secSintese.linhas).join(" ") : "";
  const pauta = secPauta ? itens(secPauta.linhas) : [];
  if (!sintese && pauta.length) sintese = `Reunião dedicada a ${pauta.length === 1 ? "um tema" : pauta.length + " temas"}: ${pauta.map((p) => semMd(p).replace(/\.$/, "")).join("; ")}.`;

  const participantes = secPart ? itens(secPart.linhas).map(semMd) : (reu.participantes || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  const decisoes = secDelib ? itens(secDelib.linhas).filter((d) => !/^n[aã]o houve/i.test(semMd(d))) : [];
  const encs = secEnc ? itens(secEnc.linhas).map(encaminhamento) : [];
  const pend = (secPend ? itens(secPend.linhas) : []).filter((p) => !/^nenhum/i.test(semMd(p)));

  // Ressalvas automáticas (sempre honestas sobre a origem do texto)
  const naoIdent = participantes.filter((p) => /^participante\s*\d+/i.test(p));
  if (naoIdent.length) pend.push(`Confirmar a identidade de ${naoIdent.join(", ").replace(/, ([^,]*)$/, " e $1")}, que não foram identificados pelo nome na gravação.`);
  if (encs.some((e) => !e.prazo || /n[aã]o definido/i.test(e.prazo))) pend.push("Definir prazo dos encaminhamentos marcados como “não definido”.");
  pend.push("Ata gerada a partir de gravação com transcrição automática: revisar nomes, valores e prazos antes de circular.");

  const nomeTopico = (t) => t || "Registro";

  return { reu, data, hora, sintese, pauta, participantes, decisoes, encs, pend, discussoes: secDisc ? topicos(secDisc.linhas).map((t) => ({ titulo: t.titulo, paragrafos: paragrafos(t.linhas) })) : [], outras: outras.map((o) => ({ titulo: o.titulo, itens: itens(o.linhas), paragrafos: paragrafos(o.linhas) })), encerramento: secFim ? paragrafos(secFim.linhas) : [], duracao: reu.duracao_seg ? duracao(reu.duracao_seg) : "" };
}

export function montarAtaSolven(reu) {
  const s = secoes(reu.ata);
  const pega = (...chaves) => s.find((x) => chaves.some((c) => norm(x.titulo).startsWith(c)));
  const usadas = new Set();
  const usar = (sec) => { if (sec) usadas.add(sec); return sec; };

  const secSintese = usar(pega("sintese", "resumo"));
  const secPart = usar(pega("participantes"));
  const secPauta = usar(pega("pauta"));
  const secDisc = usar(pega("discuss"));
  const secDelib = usar(pega("delibera", "decis"));
  const secEnc = usar(pega("encaminhamento", "acoes", "proximos passos"));
  const secPend = usar(pega("pendencia", "ressalva"));
  const secFim = usar(pega("encerramento"));
  const outras = s.filter((x) => !usadas.has(x) && x.linhas.some((l) => l.trim()));

  const dt = new Date(reu.data_reuniao);
  const data = dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });
  const hora = dt.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

  // Síntese: usa a seção própria; senão, abre com a pauta resumida
  let sintese = secSintese ? paragrafos(secSintese.linhas).join(" ") : "";
  const pauta = secPauta ? itens(secPauta.linhas) : [];
  if (!sintese && pauta.length) sintese = `Reunião dedicada a ${pauta.length === 1 ? "um tema" : pauta.length + " temas"}: ${pauta.map((p) => semMd(p).replace(/\.$/, "")).join("; ")}.`;

  const participantes = secPart ? itens(secPart.linhas).map(semMd) : (reu.participantes || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  const decisoes = secDelib ? itens(secDelib.linhas).filter((d) => !/^n[aã]o houve/i.test(semMd(d))) : [];
  const encs = secEnc ? itens(secEnc.linhas).map(encaminhamento) : [];
  const pend = (secPend ? itens(secPend.linhas) : []).filter((p) => !/^nenhum/i.test(semMd(p)));

  // Ressalvas automáticas (sempre honestas sobre a origem do texto)
  const naoIdent = participantes.filter((p) => /^participante\s*\d+/i.test(p));
  if (naoIdent.length) pend.push(`Confirmar a identidade de ${naoIdent.join(", ").replace(/, ([^,]*)$/, " e $1")}, que não foram identificados pelo nome na gravação.`);
  if (encs.some((e) => !e.prazo || /n[aã]o definido/i.test(e.prazo))) pend.push("Definir prazo dos encaminhamentos marcados como “não definido”.");
  pend.push("Ata gerada a partir de gravação com transcrição automática: revisar nomes, valores e prazos antes de circular.");

  const nomeTopico = (t) => t || "Registro";

  const html = `
<div class="sv">
  <header class="sv-header">
    <img src="brand/solven-logo-horizontal-color.webp" alt="Solven">
    <div><p>Ata / resumo de reunião</p><strong>${esc(reu.titulo)}</strong></div>
  </header>

  <section class="sv-title">
    <div>
      <p class="sv-kicker">Ata de reunião</p>
      <h1>${esc(reu.titulo)}</h1>
      ${sintese ? `<p class="sv-sintese">${inline(sintese)}</p>` : ""}
    </div>
    <aside class="sv-meta">
      <div><span>Data</span><strong>${esc(data)}</strong></div>
      <div><span>Horário</span><strong>${esc(hora)}${reu.duracao_seg ? ` · ${esc(duracao(reu.duracao_seg))}` : ""}</strong></div>
      <div><span>Local</span><strong>${esc(reu.local || "Não informado")}</strong></div>
      <div><span>Status</span><strong>Rascunho para revisão</strong></div>
    </aside>
  </section>

  <section class="sv-strip" aria-label="Resumo da reunião">
    <article><span>Temas</span><strong>${pauta.length || "—"} ${pauta.length === 1 ? "assunto tratado" : "assuntos tratados"}</strong></article>
    <article><span>Resultado</span><strong>${decisoes.length} ${decisoes.length === 1 ? "decisão" : "decisões"} · ${encs.length} ${encs.length === 1 ? "encaminhamento" : "encaminhamentos"}</strong></article>
    <article><span>Fonte</span><strong>Gravação da reunião, transcrição automática</strong></article>
  </section>

  ${pauta.length ? `
  <section class="sv-section">
    <div class="sv-heading"><h2>Pauta</h2><span>${pauta.length} ${pauta.length === 1 ? "item" : "itens"}</span></div>
    <div class="sv-pauta">
      ${pauta.map((p, i) => `<article><span class="sv-step">${String(i + 1).padStart(2, "0")}</span><strong>${inline(p)}</strong></article>`).join("")}
    </div>
  </section>` : ""}

  ${secDisc ? `
  <section class="sv-section">
    <div class="sv-heading"><h2>Discussões</h2><span>registro</span></div>
    ${topicos(secDisc.linhas).map((t) => `
      <article class="sv-topico">
        ${t.titulo ? `<h3>${inline(nomeTopico(t.titulo))}</h3>` : ""}
        ${paragrafos(t.linhas).map((p) => `<p>${inline(p)}</p>`).join("")}
      </article>`).join("")}
  </section>` : ""}

  ${outras.map((o) => `
  <section class="sv-section">
    <div class="sv-heading"><h2>${inline(o.titulo)}</h2></div>
    ${itens(o.linhas).length
      ? `<ul class="sv-lista">${itens(o.linhas).map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`
      : paragrafos(o.linhas).map((p) => `<p>${inline(p)}</p>`).join("")}
  </section>`).join("")}

  <section class="sv-section">
    <div class="sv-heading"><h2>Decisões tomadas</h2><span>deliberações</span></div>
    ${decisoes.length
      ? `<div class="sv-decisoes ${decisoes.length === 1 ? "sv-uma" : ""}">${decisoes.map((d, i) => `<article class="sv-decisao"><span>Decisão ${i + 1}</span><p>${inline(d)}</p></article>`).join("")}</div>`
      : `<p class="sv-vazio">Não houve deliberações registradas nesta reunião.</p>`}
  </section>

  <section class="sv-section">
    <div class="sv-heading"><h2>Encaminhamentos</h2><span>responsáveis</span></div>
    ${encs.length ? `
    <table>
      <thead><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr></thead>
      <tbody>
        ${encs.map((e) => `<tr><td>${esc(e.acao)}</td><td>${esc(e.resp || "A definir")}</td><td>${esc(e.prazo ? e.prazo.replace(/^n[aã]o definido$/i, "A definir") : "A definir")}</td><td>${esc(e.status || "Em aberto")}</td></tr>`).join("")}
      </tbody>
    </table>` : `<p class="sv-vazio">Nenhum encaminhamento registrado.</p>`}
  </section>

  <section class="sv-bottom">
    <article class="sv-pend">
      <span>Pendências e ressalvas</span>
      <ul class="sv-lista">${pend.map((p) => `<li>${inline(p)}</li>`).join("")}</ul>
    </article>
    <article class="sv-part">
      <span>Participantes</span>
      ${participantes.length ? `<ul class="sv-lista">${participantes.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p class="sv-vazio" style="margin-top:2.6mm">Não informados.</p>`}
    </article>
  </section>

  ${secFim ? `
  <section class="sv-encerra">
    <span class="sv-label">Encerramento</span>
    ${paragrafos(secFim.linhas).map((p) => `<p>${inline(p)}</p>`).join("")}
  </section>` : ""}

  <section class="sv-confirma" aria-label="Confirmação">
    <div><span>Elaboração</span><strong>Nome / área</strong></div>
    <div><span>Revisão</span><strong>Nome / área</strong></div>
    <div><span>Aprovação</span><strong>Nome / área</strong></div>
  </section>

  <footer class="sv-footer">
    <span>Solven · Ata de reunião · ${esc(reu.titulo)} · ${esc(data)}</span>
    <span>Gerada pelo app Atas a partir da gravação</span>
  </footer>
</div>`;
  return html;
}
