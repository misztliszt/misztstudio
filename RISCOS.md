# Riscos do Miszt Studio

Última revisão geral: 2026-11-24 (auditoria completa em 5 lotes; versões 1.0.1 a 1.2.0).
Escala: probabilidade e impacto em **B**aixa, **M**édia ou **A**lta.

## Abertos

| # | Risco | Prob. | Impacto | Ação | Responsável | Revisão |
|---|---|---|---|---|---|---|
| 1 | **Electron 33 fora da janela de suporte de segurança** do Chromium (a versão atual é a 45). O app abre links e importa por URL. | M | A | Atualizar o Electron e fixar a versão exata; testar instalador, worklets e atualizador depois. Pendente de confirmação do dono. | Gabriel | 2026-11-24 |
| 2 | **Cadeia de atualização depende só da conta do GitHub**: instalador sem assinatura e `scripts/release.cjs` publica a Release já visível antes de subir todos os arquivos. | B | A | Token com escopo mínimo e 2FA; criar a Release como rascunho e publicar só no fim; Electron Fuses. Pendente de confirmação. | Gabriel | 2026-11-24 |
| 3 | **Dependências Python sem versão fixa** (torch, demucs, pedalboard) instaladas na pasta de dados do usuário. | M | M | Fixar versões e hashes; limitar a versão máxima do Python. | Gabriel | 2026-11-24 |
| 4 | **CSP libera `cdn.jsdelivr.net`** em `script-src` (provavelmente para o onnxruntime/transformers). | B | M | Empacotar os arquivos do onnxruntime localmente e remover o CDN da política. | Gabriel | 2026-11-24 |
| 5 | **Fluxos sem teste ao vivo**: microfone real + VB-CABLE, VRChat, gravação de tela com áudio do sistema, atualização automática e a *audição* do autotune e do limitador do DJ. Só testados por código e por testes numéricos. | M | M | Teste manual por quem tem o equipamento antes de cada Release. | Gabriel | 2026-11-24 |
| 6 | **Memória em projetos grandes**: elementos de vídeo/áudio já tocados ficam vivos até o clipe sair; `detectBeats` e `getPeaks` rodam na thread principal. | M | M | Pool de elementos por distância do cursor; mover análises para worker. | Gabriel | 2026-11-24 |
| 7 | **O CI não gera o instalador**: roda typecheck, testes e `vite build`, mas erros de empacotamento (`asarUnpack`, `files`) só aparecem no `npm run dist` local. (O CI do GitHub rodou e passou nos PRs 1 a 4.) | M | M | Incluir `electron-builder --dir` no CI (com `CSC_IDENTITY_AUTO_DISCOVERY=false`). | Gabriel | 2026-11-24 |
| 8 | **Sem ESLint**: três `eslint-disable react-hooks/exhaustive-deps` escondem fechamentos desatualizados em `App.tsx`. | M | B | Adicionar ESLint (dependência nova — pede confirmação) e revisar os três pontos. | Gabriel | 2026-11-24 |
| 9 | **Acessibilidade parcial**: clipes da timeline e a régua não têm operação por teclado. | A | M | Dar `role`/foco aos clipes e atalhos de mover/aparar. | Gabriel | 2026-11-24 |
| 10 | **Histórico de desfazer**: `checkpoint` pode criar passos idênticos e apagar o "refazer"; mudar só trilhas/formato num projeto vazio não conta como "alterado". | M | B | Checkpoint preguiçoso (só no primeiro `merge` que muda algo). | Gabriel | 2026-11-24 |
| 11 | **Decisões de design que contrariam a acessibilidade**: texto branco sobre o gradiente do botão primário (contraste ~2–4:1) e introdução de abertura que não pode ser pulada. | B | B | Dono decide: texto escuro (`--on-accent`) no botão e permitir pular a introdução. | Gabriel | 2026-11-24 |
| 12 | **Titular da licença/autor**: `package.json` diz "Miszt"; a regra do dono pede LICENSE proprietária em nome de Gabriel Felipe Andrade Lima. | B | M | Conferir o `LICENSE` e o campo `author` com o dono. | Gabriel | 2026-11-24 |
| 13 | **Mixdown para transcrição** (`audio:mixdown`) acumula tudo na memória e passa por IPC (≈ 460 MB para 2 h). | B | M | Gravar em arquivo temporário ou limitar a duração. | Gabriel | 2026-11-24 |

## Fechados na auditoria

- Perda de dados por gravação não atômica, fechar sem salvar, `.edproj` inválido e mídia movida (1.0.1).
- Leitura de arquivos arbitrários pelo `media://`, IPC sem validação, injeção de opções no yt-dlp, filtros do FFmpeg alimentados por dados do projeto, carga de plugins arbitrários (1.0.2).
- Processos órfãos ao sair, instância duplicada, corridas no microfone ao vivo, desafino do autotune, estouro no master do DJ (1.0.3).
- Timeline pesada, exportação que congelava a janela, caches parciais (1.1.0).
- Diálogos e controles sem acessibilidade básica (1.2.0).
