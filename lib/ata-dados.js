// Lê o markdown da ata e separa as partes (usado pelo gerador de Word).
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


  return { reu, data, hora, sintese, pauta, participantes, decisoes, encs, pend, discussoes: secDisc ? topicos(secDisc.linhas).map((t) => ({ titulo: t.titulo, paragrafos: paragrafos(t.linhas) })) : [], outras: outras.map((o) => ({ titulo: o.titulo, itens: itens(o.linhas), paragrafos: paragrafos(o.linhas) })), encerramento: secFim ? paragrafos(secFim.linhas) : [], duracao: reu.duracao_seg ? duracao(reu.duracao_seg) : "" };
}
