// Gera a ata em Word (.docx) no padrão Solven, com tudo editável (texto, tabelas, cores).
import { readFileSync } from "node:fs";
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle,
  ShadingType, AlignmentType, Header, Footer, PageNumber, TabStopType, VerticalAlign, LevelFormat, TableLayoutType, LineRuleType,
} from "docx";
import { extrairAta } from "./ata-dados.js";

const AZUL = "013F7D", VERMELHO = "D92323", TINTA = "1F2933", CINZA = "64748B", LINHA = "E2E8F0", FUNDO = "F8FAFC", FUNDO_VERM = "FCEEEE";
const FONTE = "Arial"; // fonte oficial Now: trocar aqui quando estiver instalada nos computadores
const MM = 56.7; // twips por mm
const LARGURA = Math.round(178 * MM); // A4 menos margens de 16 mm

const ler = (rel) => readFileSync(new URL(rel, import.meta.url));
const SEM = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const semBordas = { top: SEM, bottom: SEM, left: SEM, right: SEM, insideHorizontal: SEM, insideVertical: SEM };
const borda = (cor = LINHA, size = 4, style = BorderStyle.SINGLE) => ({ style, size, color: cor });

// texto com **negrito** do markdown
function runs(txt, o = {}) {
  const partes = String(txt ?? "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return partes.map((p) => {
    const b = /^\*\*(.+)\*\*$/.exec(p);
    return new TextRun({ text: (b ? b[1] : p).replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1$2"), bold: o.bold || !!b, color: o.color || TINTA, size: o.size || 19, font: FONTE, allCaps: o.caps, characterSpacing: o.spacing });
  });
}
const P = (txt, o = {}) => new Paragraph({ children: runs(txt, o), spacing: { before: o.before ?? 0, after: o.after ?? 80, line: o.line ?? 290, lineRule: LineRuleType.AUTO }, alignment: o.align, keepNext: o.keepNext, border: o.border, indent: o.indent });
const rotulo = (txt, cor = AZUL, after = 40) => P(txt, { bold: true, color: cor, size: 14, caps: true, spacing: 8, after, line: 240 });

function titulo2(txt, selo) {
  // parágrafo com linha azul embaixo; o selo fica alinhado à direita por tabulação (mantém junto com o conteúdo seguinte)
  return new Paragraph({
    keepNext: true, keepLines: true, spacing: { before: 0, after: 120 },
    border: { bottom: borda(AZUL, 12, BorderStyle.SINGLE) },
    tabStops: [{ type: TabStopType.RIGHT, position: LARGURA }],
    children: [
      new TextRun({ text: txt, bold: true, color: AZUL, size: 26, font: FONTE }),
      ...(selo ? [new TextRun({ text: "\t" }), new TextRun({ text: ` ${selo.toUpperCase()} `, bold: true, size: 14, color: AZUL, font: FONTE, shading: { type: ShadingType.CLEAR, fill: "E6ECF3", color: "auto" } })] : []),
    ],
  });
}
const espaco = (pt = 10, junto = false) => new Paragraph({ keepNext: junto, spacing: { before: 0, after: pt * 20 }, children: [] });

function caixa(filhos, o = {}) {
  return new Table({
    width: { size: o.largura || LARGURA, type: WidthType.DXA }, columnWidths: [o.largura || LARGURA], layout: TableLayoutType.FIXED,
    borders: semBordas,
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      shading: o.fundo ? { type: ShadingType.CLEAR, fill: o.fundo, color: "auto" } : undefined,
      borders: { top: o.topo || borda(o.contorno || (o.fundo ? o.fundo : LINHA)), bottom: borda(o.contorno || (o.fundo ? o.fundo : LINHA)), right: borda(o.contorno || (o.fundo ? o.fundo : LINHA)), left: o.esquerda || borda(o.contorno || (o.fundo ? o.fundo : LINHA)) },
      margins: { top: 110, bottom: 110, left: 200, right: 200 },
      children: filhos,
    })] })],
  });
}

function lista(itens, o = {}) {
  return itens.map((t) => new Paragraph({ numbering: { reference: "marcador", level: 0 }, spacing: { after: 60, line: 276 }, children: runs(t, { size: 18, color: o.color || CINZA }) }));
}

export async function montarDocxAta(reu) {
  const d = extrairAta(reu);
  const sharp = (await import("sharp")).default;
  const logo = await sharp(ler("../brand/solven-logo-horizontal-color.webp")).png().toBuffer();
  const logoRun = (w) => new ImageRun({ type: "png", data: logo, transformation: { width: w, height: Math.round(w * 120 / 318) } });

  const corpo = [];

  // título
  corpo.push(rotulo("Ata de reunião", VERMELHO, 60));
  corpo.push(P(reu.titulo, { bold: true, size: 44, before: 60, after: 120, line: 264 }));
  if (d.sintese) corpo.push(P(d.sintese, { color: CINZA, size: 20, after: 160 }));

  // dados da reunião
  const meta = [["Data", d.data], ["Horário", d.hora + (d.duracao ? ` · ${d.duracao}` : "")], ["Local", reu.local || "Não informado"], ["Status", "Rascunho para revisão"]];
  const c4 = Math.floor(LARGURA / 4);
  corpo.push(new Table({
    width: { size: LARGURA, type: WidthType.DXA }, columnWidths: [c4, c4, c4, LARGURA - 3 * c4], layout: TableLayoutType.FIXED,
    borders: { ...semBordas, top: borda(LINHA), bottom: borda(AZUL, 12) },
    rows: [new TableRow({ children: meta.map(([k, v]) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: FUNDO, color: "auto" }, borders: semBordas, margins: { top: 100, bottom: 100, left: 140, right: 100 },
      children: [rotulo(k, CINZA, 20), P(v, { bold: true, color: AZUL, size: 18, after: 0 })],
    })) })],
  }));
  corpo.push(espaco(8));

  // faixa de resumo
  const resumo = [
    ["Temas", `${d.pauta.length || "—"} ${d.pauta.length === 1 ? "assunto tratado" : "assuntos tratados"}`],
    ["Resultado", `${d.decisoes.length} ${d.decisoes.length === 1 ? "decisão" : "decisões"} · ${d.encs.length} ${d.encs.length === 1 ? "encaminhamento" : "encaminhamentos"}`],
    ["Fonte", "Gravação da reunião, transcrição automática"],
  ];
  const c3 = Math.floor(LARGURA / 3);
  corpo.push(new Table({
    width: { size: LARGURA, type: WidthType.DXA }, columnWidths: [c3, c3, LARGURA - 2 * c3], layout: TableLayoutType.FIXED, borders: semBordas,
    rows: [new TableRow({ children: resumo.map(([k, v]) => new TableCell({
      borders: { top: borda(VERMELHO, 18), bottom: borda(), left: borda(), right: borda() }, margins: { top: 100, bottom: 100, left: 160, right: 120 },
      children: [rotulo(k), P(v, { bold: true, size: 20, after: 0, line: 260 })],
    })) })],
  }));

  // pauta
  if (d.pauta.length) {
    corpo.push(espaco(14), titulo2("Pauta", `${d.pauta.length} ${d.pauta.length === 1 ? "item" : "itens"}`), espaco(2, true));
    corpo.push(new Table({
      width: { size: LARGURA, type: WidthType.DXA }, columnWidths: [15 * MM, LARGURA - 15 * MM], layout: TableLayoutType.FIXED,
      borders: { ...semBordas, insideHorizontal: borda() , bottom: borda() },
      rows: d.pauta.map((p, i) => new TableRow({ cantSplit: true, children: [
        new TableCell({ borders: semBordas, verticalAlign: VerticalAlign.CENTER, margins: { top: 80, bottom: 80 }, children: [new Paragraph({ children: [new TextRun({ text: `  ${String(i + 1).padStart(2, "0")}  `, bold: true, color: "FFFFFF", size: 16, font: FONTE, shading: { type: ShadingType.CLEAR, fill: AZUL, color: "auto" } })] })] }),
        new TableCell({ borders: semBordas, verticalAlign: VerticalAlign.CENTER, margins: { top: 80, bottom: 80 }, children: [P(p, { bold: true, size: 20, after: 0 })] }),
      ] })),
    }));
  }

  // discussões
  if (d.discussoes.length) {
    corpo.push(espaco(14), titulo2("Discussões", "registro"), espaco(2, true));
    d.discussoes.forEach((t, i) => {
      if (t.titulo) corpo.push(P(t.titulo, { bold: true, size: 21, after: 60, before: i ? 160 : 0, keepNext: true }));
      t.paragrafos.forEach((p) => corpo.push(P(p, { color: CINZA, size: 19, after: 80, line: 300 })));
    });
  }

  // outras seções que a IA criar
  for (const o of d.outras) {
    corpo.push(espaco(14), titulo2(o.titulo), espaco(2, true));
    if (o.itens.length) corpo.push(...lista(o.itens));
    else o.paragrafos.forEach((p) => corpo.push(P(p, { color: CINZA })));
  }

  // decisões
  corpo.push(espaco(14), titulo2("Decisões tomadas", "deliberações"), espaco(2, true));
  if (d.decisoes.length) {
    d.decisoes.forEach((x, i) => {
      corpo.push(caixa([rotulo(`Decisão ${i + 1}`), P(x, { size: 19, after: 0 })], { esquerda: borda(AZUL, 18) }));
      corpo.push(espaco(4));
    });
  } else corpo.push(P("Não houve deliberações registradas nesta reunião.", { color: CINZA }));

  // encaminhamentos
  corpo.push(espaco(10), titulo2("Encaminhamentos", "responsáveis"), espaco(2, true));
  if (d.encs.length) {
    const cols = [LARGURA - 3 * 31 * MM, 31 * MM, 31 * MM, 31 * MM];
    const cel = (txt, o = {}) => new TableCell({ borders: { top: SEM, left: SEM, right: SEM, bottom: borda() }, shading: o.fundo ? { type: ShadingType.CLEAR, fill: o.fundo, color: "auto" } : undefined, margins: { top: 90, bottom: 90, left: 120, right: 120 }, children: [P(txt, { size: 17, after: 0, bold: o.bold, color: o.color })] });
    corpo.push(new Table({
      width: { size: LARGURA, type: WidthType.DXA }, columnWidths: cols, layout: TableLayoutType.FIXED, borders: semBordas,
      rows: [
        new TableRow({ tableHeader: true, children: ["Ação", "Responsável", "Prazo", "Status"].map((h) => cel(h, { fundo: FUNDO, bold: true, color: AZUL })) }),
        ...d.encs.map((e) => new TableRow({ cantSplit: true, children: [
          cel(e.acao), cel(e.resp || "A definir", { bold: true, color: AZUL }),
          cel(e.prazo ? e.prazo.replace(/^n[aã]o definido$/i, "A definir") : "A definir"), cel(e.status || "Em aberto"),
        ] })),
      ],
    }));
  } else corpo.push(P("Nenhum encaminhamento registrado.", { color: CINZA }));

  // pendências + participantes
  corpo.push(espaco(14));
  const metade = Math.floor((LARGURA - 5 * MM) / 2);
  corpo.push(new Table({
    width: { size: LARGURA, type: WidthType.DXA }, columnWidths: [metade, 5 * MM, LARGURA - metade - 5 * MM], layout: TableLayoutType.FIXED, borders: semBordas,
    rows: [new TableRow({ cantSplit: true, children: [
      new TableCell({ shading: { type: ShadingType.CLEAR, fill: FUNDO_VERM, color: "auto" }, borders: { top: SEM, bottom: SEM, right: SEM, left: borda(VERMELHO, 24) }, margins: { top: 140, bottom: 140, left: 200, right: 160 },
        children: [rotulo("Pendências e ressalvas", AZUL, 80), ...lista(d.pend)] }),
      new TableCell({ borders: semBordas, children: [P("")] }),
      new TableCell({ shading: { type: ShadingType.CLEAR, fill: FUNDO, color: "auto" }, borders: { top: borda(), bottom: borda(), left: borda(), right: borda() }, margins: { top: 140, bottom: 140, left: 200, right: 160 },
        children: [rotulo("Participantes", AZUL, 80), ...(d.participantes.length ? lista(d.participantes) : [P("Não informados.", { color: CINZA })])] }),
    ] })],
  }));

  // encerramento
  if (d.encerramento.length) {
    corpo.push(espaco(12));
    corpo.push(caixa([rotulo("Encerramento"), ...d.encerramento.map((p) => P(p, { size: 19, after: 0 }))], { fundo: FUNDO, esquerda: borda(AZUL, 24) }));
  }

  // confirmação
  corpo.push(espaco(16));
  const tracej = borda("CBD5E1", 6, BorderStyle.DASHED);
  corpo.push(new Table({
    width: { size: LARGURA, type: WidthType.DXA }, columnWidths: [c3, c3, LARGURA - 2 * c3], layout: TableLayoutType.FIXED, borders: semBordas,
    rows: [new TableRow({ cantSplit: true, children: ["Elaboração", "Revisão", "Aprovação"].map((k) => new TableCell({
      borders: { top: tracej, bottom: tracej, left: tracej, right: tracej }, margins: { top: 120, bottom: 120, left: 160, right: 160 },
      children: [rotulo(k, CINZA, 500), P("Nome / área", { bold: true, color: AZUL, size: 16, after: 0, border: { top: borda("CBD5E1", 6) } })],
    })) })],
  }));

  const cabecalho = new Header({ children: [new Table({
    width: { size: LARGURA, type: WidthType.DXA }, columnWidths: [Math.round(LARGURA * 0.4), LARGURA - Math.round(LARGURA * 0.4)], layout: TableLayoutType.FIXED,
    borders: { ...semBordas, bottom: borda() },
    rows: [new TableRow({ children: [
      new TableCell({ borders: semBordas, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ spacing: { after: 120 }, children: [logoRun(150)] })] }),
      new TableCell({ borders: semBordas, verticalAlign: VerticalAlign.CENTER, children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [new TextRun({ text: "ATA / RESUMO DE REUNIÃO", size: 14, color: CINZA, font: FONTE })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 120 }, children: [new TextRun({ text: reu.titulo, bold: true, size: 21, color: AZUL, font: FONTE })] }),
      ] }),
    ] })],
  })] });

  const rodape = new Footer({ children: [new Paragraph({
    border: { top: borda() }, spacing: { before: 80 },
    tabStops: [{ type: TabStopType.RIGHT, position: LARGURA }],
    children: [
      new TextRun({ text: `Solven · Ata de reunião · ${reu.titulo} · ${d.data}`, size: 14, color: CINZA, font: FONTE }),
      new TextRun({ text: "\tPágina ", size: 14, color: CINZA, font: FONTE }),
      new TextRun({ children: [PageNumber.CURRENT], size: 14, color: CINZA, font: FONTE }),
      new TextRun({ text: " de ", size: 14, color: CINZA, font: FONTE }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: CINZA, font: FONTE }),
    ],
  })] });

  const doc = new Document({
    creator: "App Atas", title: `Ata - ${reu.titulo}`, description: "Ata de reunião no padrão Solven",
    styles: { default: { document: { run: { font: FONTE, size: 19, color: TINTA } } } },
    numbering: { config: [{ reference: "marcador", levels: [{ level: 0, format: LevelFormat.BULLET, text: "■", alignment: AlignmentType.LEFT,
      style: { run: { color: VERMELHO, size: 12 }, paragraph: { indent: { left: 300, hanging: 220 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: Math.round(12 * MM), bottom: Math.round(16 * MM), left: Math.round(16 * MM), right: Math.round(16 * MM), header: Math.round(8 * MM), footer: Math.round(8 * MM) } } },
      headers: { default: cabecalho }, footers: { default: rodape },
      children: [espaco(4), ...corpo],
    }],
  });
  return Packer.toBuffer(doc);
}
