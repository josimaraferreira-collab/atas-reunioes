# Atas

App (PWA) para gravar reuniões presenciais no iPhone, transcrever o áudio e gerar a ata automaticamente com o Google Gemini. A ata pode ser baixada em PDF ou Word no padrão visual Solven.

Publicado em: https://atas-reunioes.vercel.app

## Como funciona

1. **Gravação** (`app.js`): grava pelo microfone em trechos de 10 minutos, com cópia de segurança no próprio aparelho (IndexedDB). Cada trecho vai para o Supabase Storage (bucket `ata-audios`).
2. **Transcrição e ata** (`supabase/functions/atas-ia`): função do Supabase que envia cada trecho ao Gemini, junta as transcrições e escreve a ata em Markdown.
3. **PDF e Word** (`api/pdf.js`, `api/docx.js`): funções da Vercel que montam a ata no padrão Solven.
   - PDF: gerado com Chromium (`@sparticuz/chromium`), a partir de `pdf.js` e `pdf.css`.
   - Word: gerado com a biblioteca `docx` (`lib/ata-docx.js`), tudo editável.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest`, `icons/` | O app (PWA) |
| `pdf.js`, `pdf.css`, `brand/` | Layout da ata no padrão Solven |
| `api/pdf.js`, `api/docx.js`, `lib/` | Geração de PDF e Word na Vercel |
| `supabase/functions/atas-ia/` | Transcrição e geração da ata (Gemini) |
| `supabase/migrations/` | Tabelas `ata_reunioes` e `ata_segmentos`, regras de acesso e bucket de áudio |

## Configuração

- **Supabase:** projeto `yrygrpdnemmomukhjmlc`. A função `atas-ia` precisa do segredo `GEMINI_API_KEY` (configurado no painel do Supabase, nunca no código).
- **Vercel:** projeto `atas-reunioes`, sem etapa de build; as dependências de `package.json` são usadas só pelas funções em `api/`.
- A chave `anon` do Supabase em `app.js` é pública por natureza; o acesso aos dados é protegido pelas regras de RLS.

## Fonte

O padrão Solven usa a fonte **Now**, que ainda não está no projeto; por enquanto PDF e Word saem em Arial (no PDF, Arimo com as mesmas medidas).
