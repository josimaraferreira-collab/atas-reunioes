// Monta o HTML completo da ata (padrão Solven) com CSS, imagens e fontes embutidos,
// para o Chromium do servidor gerar o PDF sem depender de rede.
import { readFileSync } from "node:fs";
import { montarAtaSolven } from "../pdf.js";

const ler = (rel) => readFileSync(new URL(rel, import.meta.url));
const dataUrl = (rel, tipo) => `data:${tipo};base64,${ler(rel).toString("base64")}`;

let cache = null;
function recursos() {
  if (cache) return cache;
  const img = {
    "brand/solven-logo-horizontal-color.webp": dataUrl("../brand/solven-logo-horizontal-color.webp", "image/webp"),
    "brand/solven-step-marker.png": dataUrl("../brand/solven-step-marker.png", "image/png"),
    "brand/solven-list-marker.png": dataUrl("../brand/solven-list-marker.png", "image/png"),
  };
  // Fonte oficial "Now" ainda não disponível: usa Arimo (mesmas medidas da Arial) registrada como "Arial".
  const fonte = (peso) => {
    for (const [rel, tipo] of [[`../node_modules/@fontsource/arimo/files/arimo-latin-${peso}-normal.woff2`, "font/woff2"], [`../fonts/arial-${peso === 400 ? "regular" : "bold"}.woff`, "font/woff"]]) {
      try { return `url(${dataUrl(rel, tipo)}) format("${tipo.split("/")[1]}")`; } catch {}
    }
    return 'local("Arial")';
  };
  const fontes = `
@font-face { font-family: "Arial"; font-weight: 400; src: ${fonte(400)}; }
@font-face { font-family: "Arial"; font-weight: 700; src: ${fonte(700)}; }`;
  let css = ler("../pdf.css").toString("utf8");
  for (const [k, v] of Object.entries(img)) css = css.split(k).join(v);
  cache = { img, css: fontes + "\n" + css };
  return cache;
}

export function montarHtmlAta(reu) {
  const { img, css } = recursos();
  let corpo = montarAtaSolven(reu);
  for (const [k, v] of Object.entries(img)) corpo = corpo.split(`"${k}"`).join(`"${v}"`);
  return `<!doctype html><html lang="pt-BR" class="imprimindo"><head><meta charset="utf-8"><title>Ata</title><style>${css}
#impressao{display:block!important}</style></head><body><div id="impressao">${corpo}</div></body></html>`;
}
