# Implantação do Solven Atas no SOLTOTVS

Segue o mesmo desenho do Controle de Despesas: IIS na porta 4443 → Node.js local → SQL Server interno.

| Item | Valor |
|---|---|
| Endereço público | `https://portal.solven.com.br:4443/solven-atas/` |
| Pasta | `C:\inetpub\wwwroot\solven-atas` (`\\SOLTOTVS\wwwroot\solven-atas`) |
| Serviço Windows | `SolvenAtasNode` (conta `LOCAL SERVICE`) |
| Node | `127.0.0.1:3001` (o Controle de Despesas usa a 3000) |
| Banco | `192.168.0.250:1433`, banco `atas_bd`, usuário `pwa` |
| Health check | `http://127.0.0.1:3001/solven-atas/health` |

## 1. Banco de dados (DBA)

No SQL Server `192.168.0.250`, com uma conta administradora, execute na ordem:

1. `migrations/01-criar-banco.sql` — cria o banco `atas_bd` e o usuário `pwa` dentro dele (o login `pwa` já existe).
2. `migrations/02-schema.sql` — cria `ata_reunioes`, `ata_segmentos` (áudios) e `app_sessions`.
3. `migrations/03-permissoes-pwa.sql` — dá ao `pwa` só leitura e gravação nessas tabelas e mostra a conferência (tudo `1`, menos `database_control` = `0`).

Espaço: cada hora de reunião gravada ocupa cerca de 30 MB no banco até o áudio ser apagado. Inclua o `atas_bd` no backup.

## 2. Microsoft Entra ID

Crie um **novo registro de aplicativo** chamado "Solven Atas" (recomendado, separado do Controle de Despesas):

- Tipo de conta: somente esta organização.
- URI de redirecionamento (Web): `https://portal.solven.com.br:4443/solven-atas/auth/callback`
- Crie um segredo do cliente e anote: tenant ID, client ID e valor do segredo.
- Em **Aplicativos empresariais → Solven Atas → Propriedades**, marque **Atribuição obrigatória = Sim** e, em **Usuários e grupos**, adicione quem pode usar o app.
- Opcional: crie a função de aplicativo `Atas.Usuario`, atribua aos usuários e preencha `ENTRA_REQUIRED_ROLE=Atas.Usuario`.

## 3. Arquivos no servidor

1. Copie o conteúdo deste repositório para `C:\inetpub\wwwroot\solven-atas`.
2. Crie `C:\inetpub\wwwroot\solven-atas\.env.producao` a partir de `.env.example` e preencha as senhas e segredos (nunca versionar):
   - `SESSION_SECRET`: valor aleatório com pelo menos 32 caracteres (diferente do Controle de Despesas).
   - `DB_PASSWORD`: senha do `pwa`.
   - `GEMINI_API_KEY`: chave do Google AI Studio.
3. No PowerShell, na pasta do app: `npm install --omit=dev`

## 4. Pré-requisitos do servidor

- **Node.js 24** (já instalado para o Controle de Despesas).
- **Microsoft Edge** instalado (usado para gerar o PDF, sem abrir janela). Se não houver Edge, instale o Edge ou o Chrome, ou informe o caminho em `PDF_BROWSER_PATH`. Sem navegador, o botão Word continua funcionando.
- **Saída para a internet** do servidor até `generativelanguage.googleapis.com:443` (Gemini). Se a rede usar proxy, adicione no XML do serviço `<env name="NODE_USE_ENV_PROXY" value="1"/>` e `<env name="HTTPS_PROXY" value="http://proxy:porta"/>`.
- **URL Rewrite + ARR** com proxy habilitado (já configurados para o Controle de Despesas). A variável `HTTP_X_FORWARDED_PROTO` precisa estar na lista de variáveis permitidas do URL Rewrite (a mesma usada pelo Controle de Despesas).

## 5. IIS

O `web.config` da pasta já contém a regra: tudo em `/solven-atas/*` vai para `http://127.0.0.1:3001/solven-atas/*`, com `X-Forwarded-Proto=https`, limite de upload de 50 MB e bloqueio das pastas internas (`server`, `data`, `.env.producao` etc.).

- Se `solven-atas` estiver como **aplicativo** no IIS, use o pool sem código gerenciado. Se for só uma pasta do site, funciona do mesmo jeito.
- No ARR, deixe **Reverse rewrite host in response headers** desmarcado (como no Controle de Despesas).

## 6. Serviço Windows

No servidor, PowerShell **como administrador**:

```powershell
& 'C:\inetpub\wwwroot\solven-atas\scripts\Instalar-Servico.ps1'
```

O script confere os arquivos e o executável WinSW, cria `data` e `logs`, dá à conta `LOCAL SERVICE` só as permissões necessárias, instala e inicia o serviço e testa o health check.

Operação:

```powershell
Get-Service SolvenAtasNode
Restart-Service SolvenAtasNode
```

Logs: `C:\inetpub\wwwroot\solven-atas\logs\winsw`.

## 7. Validação

1. `Invoke-RestMethod http://127.0.0.1:3001/solven-atas/health` → `ok = True`.
2. `Invoke-RestMethod https://portal.solven.com.br:4443/solven-atas/health` → `ok = True`.
3. No iPhone, abra o endereço no Safari, entre com a conta Microsoft, grave 1 minuto e encerre. A ata deve aparecer em seguida.
4. Teste PDF, Word, ouvir o áudio, apagar o áudio e excluir uma reunião de teste.
5. Confirme que outra pessoa não vê as reuniões da primeira.
6. Instale na Tela de Início: Compartilhar → Adicionar à Tela de Início.

## Publicar uma nova versão

1. Copie os arquivos novos para a pasta, sem substituir `.env.producao`, `data` e `logs`.
2. Se `package.json` mudou: `npm install --omit=dev`.
3. `Restart-Service SolvenAtasNode` e confira o health check.

O que estava sendo transcrito ou escrito quando o serviço parou é retomado automaticamente ao iniciar.
