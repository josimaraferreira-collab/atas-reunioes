# Solven Atas

App (PWA) para gravar reuniões presenciais no celular, transcrever o áudio e gerar a ata automaticamente com o Google Gemini. A ata sai em PDF ou Word no padrão visual Solven.

- **Endereço:** https://portal.solven.com.br:4443/solven-atas/
- **Servidor:** `SOLTOTVS`, pasta `C:\inetpub\wwwroot\solven-atas` (`\\SOLTOTVS\wwwroot\solven-atas`), serviço Windows `SolvenAtasNode` (Node.js 24 em `127.0.0.1:3001`) atrás do IIS.
- **Banco:** SQL Server `192.168.0.250`, banco `atas_bd`, usuário `pwa` (o mesmo servidor e usuário do Controle de Despesas).
- **Login:** conta Microsoft da Solven (Entra ID). Cada pessoa vê somente as próprias reuniões.

## Como funciona

1. **Gravação** (`app.js`): o celular grava em trechos de 10 minutos, guarda uma cópia no aparelho (IndexedDB) e envia cada trecho ao servidor assim que fica pronto. Se a internet cair, o trecho sobe depois.
2. **Transcrição** (`server/processador.js`, `server/gemini.js`): o servidor transcreve cada trecho com o Gemini assim que ele chega, em segundo plano. Não é preciso deixar o app aberto.
3. **Ata**: ao encerrar a gravação, o servidor junta as transcrições e o Gemini redige a ata (síntese, pauta, discussões, deliberações, encaminhamentos, pendências).
4. **PDF e Word** (`server/documentos.js`, `lib/`): o PDF é gerado com o Microsoft Edge do servidor (sem janela); o Word com a biblioteca `docx`, totalmente editável.

Os áudios ficam no SQL Server (`dbo.ata_segmentos.audio_data`) até a pessoa tocar em **Apagar o áudio**; a transcrição e a ata continuam guardadas.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html`, `app.js`, `style.css`, `sw.js`, `icons/` | O app (PWA) |
| `pdf.js`, `pdf.css`, `brand/` | Layout da ata no padrão Solven |
| `server/` | Servidor Node (Express): login Microsoft, API, processamento, PDF/Word |
| `lib/` | Montagem da ata em HTML (PDF) e Word |
| `migrations/` | Scripts do banco `atas_bd` (criar banco, tabelas, permissões do `pwa`) |
| `service/`, `scripts/Instalar-Servico.ps1` | Serviço Windows (WinSW) e instalação |
| `web.config` | Regra do IIS que repassa `/solven-atas` ao Node |
| `test/` | Testes automáticos (`npm test`) |

## Desenvolvimento

```powershell
npm install
npm run check
npm test
```

Para rodar localmente, copie `.env.example` para `.env` com `NODE_ENV=development` e `APP_URL=http://localhost:3001/solven-atas`.

A implantação no servidor está em [IMPLANTACAO.md](IMPLANTACAO.md).

## Fonte

O padrão Solven usa a fonte **Now**, que ainda não está no projeto; por enquanto PDF e Word saem em Arial.
