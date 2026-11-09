// Gera a ata em Word (.docx) editável, no padrão Solven.
import { montarDocxAta } from "../lib/ata-docx.js";

const SUPABASE_URL = "https://yrygrpdnemmomukhjmlc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyeWdycGRuZW1tb211a2hqbWxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMTUwMDgsImV4cCI6MjEwNjY5MTAwOH0.1dL2JOihL4owPdrreItxz3HMCqXv-VDgaJY5Qpn45R4";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
    const auth = req.headers.authorization || "";
    if (!/^Bearer\s+\S+/.test(auth)) return res.status(401).json({ erro: "Entre no app de novo." });
    const corpo = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!corpo.id) return res.status(400).json({ erro: "Reunião não informada." });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ata_reunioes?id=eq.${encodeURIComponent(corpo.id)}&select=*`, { headers: { apikey: SUPABASE_KEY, Authorization: auth } });
    if (r.status === 401) return res.status(401).json({ erro: "Sessão expirada. Entre no app de novo." });
    if (!r.ok) return res.status(502).json({ erro: "Não consegui ler a reunião." });
    const reu = (await r.json())[0];
    if (!reu) return res.status(404).json({ erro: "Reunião não encontrada." });
    if (!reu.ata) return res.status(400).json({ erro: "Esta reunião ainda não tem ata." });

    const buf = await montarDocxAta(reu);
    const d = new Date(reu.data_reuniao).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(/\//g, "-");
    const nome = `Ata - ${String(reu.titulo || "Reunião").replace(/[\\/:*?"<>|]/g, " ").trim()} - ${d}.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="ata.docx"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader("X-Nome-Arquivo", encodeURIComponent(nome));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: "Não consegui gerar o Word agora. Tente de novo." });
  }
}
