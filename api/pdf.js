// Gera o PDF da ata no servidor (Chromium), no padrão Solven.
// O iPhone não imprime direito a partir do app instalado na Tela de Início,
// então o app pede o PDF pronto aqui e abre o menu de compartilhar/salvar.
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { montarHtmlAta } from "../lib/ata-html.js";

const SUPABASE_URL = "https://yrygrpdnemmomukhjmlc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeWdycGRuZW1tb211a2hqbWxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMTUwMDgsImV4cCI6MjEwNjY5MTAwOH0.1dL2JOihL4owPdrreItxz3HMCqXv-VDgaJY5Qpn45R4";

const AMOSTRA = {
  titulo: "Teste do gerador de PDF", local: "Solven", participantes: "Ester, Josimara",
  data_reuniao: "2026-10-28T13:50:36.794Z", duracao_seg: 101,
  ata: "## Participantes\n- Ester\n- Josimara\n\n## Pauta\n1. Conferir acentuação: ação, decisão, prazos — “aspas”\n\n## Discussões\n### Tema único\nTexto de teste com acentos: é, ã, ç, ô.\n\n## Deliberações\n- Aprovado o teste.\n\n## Encaminhamentos\n- **Revisar o PDF** — Responsável: Josimara — Prazo: não definido\n\n## Encerramento\nEncerrada.",
};

let navegador = null;
async function abrirNavegador() {
  if (navegador?.connected) return navegador;
  navegador = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1240, height: 1754 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  return navegador;
}

async function buscarReuniao(id, auth) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ata_reunioes?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: auth },
  });
  if (r.status === 401) return { status: 401 };
  if (!r.ok) return { status: 502 };
  const linhas = await r.json();
  return linhas[0] ? { status: 200, reu: linhas[0] } : { status: 404 };
}

function nomeArquivo(reu) {
  const d = new Date(reu.data_reuniao).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(/\//g, "-");
  return `Ata - ${String(reu.titulo || "Reunião").replace(/[\\/:*?"<>|]/g, " ").trim()} - ${d}.pdf`;
}

export default async function handler(req, res) {
  try {
    let reu;
    const teste = req.method === "GET" && req.query?.teste === "1" && process.env.VERCEL_ENV !== "production";
    if (teste) reu = AMOSTRA;
    else {
      if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
      const auth = req.headers.authorization || "";
      if (!/^Bearer\s+\S+/.test(auth)) return res.status(401).json({ erro: "Entre no app de novo." });
      const corpo = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (!corpo.id) return res.status(400).json({ erro: "Reunião não informada." });
      const b = await buscarReuniao(corpo.id, auth);
      if (b.status === 401) return res.status(401).json({ erro: "Sessão expirada. Entre no app de novo." });
      if (b.status !== 200) return res.status(b.status).json({ erro: "Reunião não encontrada." });
      reu = b.reu;
      if (!reu.ata) return res.status(400).json({ erro: "Esta reunião ainda não tem ata." });
    }

    const html = montarHtmlAta(reu);
    const nav = await abrirNavegador();
    const pagina = await nav.newPage();
    try {
      await pagina.setContent(html, { waitUntil: "load", timeout: 20000 });
      await pagina.evaluateHandle("document.fonts.ready");
      if (teste && req.query?.info === "1") {
        const fontes = await pagina.evaluate(() => [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`));
        const pdf = await pagina.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
        return res.status(200).json({ fontes, bytes: pdf.length, paginas: (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length, fontesPdf: [...new Set(Buffer.from(pdf).toString("latin1").match(/\/BaseFont\s*\/[A-Za-z+\-]+/g) || [])] });
      }
      const pdf = await pagina.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
      const nome = nomeArquivo(reu);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="ata.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`);
      res.setHeader("X-Nome-Arquivo", encodeURIComponent(nome));
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(Buffer.from(pdf));
    } finally {
      await pagina.close().catch(() => {});
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Não consegui gerar o PDF agora. Tente de novo." });
  }
}
