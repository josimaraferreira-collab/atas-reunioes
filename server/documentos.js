// PDF (Microsoft Edge/Chrome instalado no servidor, sem janela) e Word (biblioteca docx).
import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {montarHtmlAta} from '../lib/ata-html.js';
import {montarDocxAta} from '../lib/ata-docx.js';

const CANDIDATOS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
];

export function acharNavegador(configurado) {
  if (configurado) return existsSync(configurado) ? configurado : null;
  return CANDIDATOS.find((p) => existsSync(p)) || null;
}

export function nomeArquivo(reu, ext) {
  const d = new Date(reu.data_reuniao).toLocaleDateString('pt-BR', {timeZone: 'America/Sao_Paulo'}).replace(/\//g, '-');
  return `Ata - ${String(reu.titulo || 'Reunião').replace(/[\\/:*?"<>|\r\n]/g, ' ').trim().slice(0, 120)} - ${d}.${ext}`;
}

export function criarDocumentos({navegadorPath, pastaDados}) {
  let navegador = null, abrindo = null;

  async function abrir() {
    if (navegador?.connected) return navegador;
    if (abrindo) return abrindo;
    const exe = acharNavegador(navegadorPath);
    if (!exe) throw Object.assign(new Error('O PDF precisa do Microsoft Edge ou Google Chrome instalado no servidor. Use o botão Word por enquanto.'), {status: 503});
    const perfil = path.join(pastaDados, 'navegador');
    mkdirSync(perfil, {recursive: true});
    const {default: puppeteer} = await import('puppeteer-core');
    abrindo = puppeteer.launch({
      executablePath: exe, headless: true, userDataDir: perfil,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio'],
    }).then((b) => { navegador = b; b.on('disconnected', () => { navegador = null; }); return b; })
      .finally(() => { abrindo = null; });
    return abrindo;
  }

  return {
    async pdf(reu) {
      const html = montarHtmlAta(reu);
      const nav = await abrir();
      const pagina = await nav.newPage();
      try {
        await pagina.setJavaScriptEnabled(false);
        await pagina.setContent(html, {waitUntil: 'load', timeout: 30000});
        await pagina.evaluateHandle('document.fonts && document.fonts.ready').catch(() => {});
        return Buffer.from(await pagina.pdf({format: 'A4', preferCSSPageSize: true, printBackground: true}));
      } finally {
        await pagina.close().catch(() => {});
      }
    },
    docx: (reu) => montarDocxAta(reu),
    async fechar() { await navegador?.close().catch(() => {}); },
  };
}
