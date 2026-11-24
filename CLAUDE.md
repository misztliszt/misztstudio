# Miszt Studio — instruções do projeto

Instruções específicas deste projeto. As regras gerais (idioma, fluxo de trabalho, changelog, git) estão no `CLAUDE.md` global.

## Visão geral

Editor de vídeo para Windows com áudio de nível DAW (mixer, afinação, separação de voz/instrumentos, VST3), Modo DJ com dois decks e microfone ao vivo com afinação (saída para o VB-CABLE). Interface toda em português do Brasil. Distribuído por instalador NSIS nas Releases do GitHub (`misztliszt/misztstudio`).

## Stack

- **Electron 45.5.0** (versão fixada; Chromium 156, Node 24) (processo principal em CommonJS, `electron/*.cjs`) + **React 18 + TypeScript + Vite** (`src/`).
- FFmpeg/FFprobe via `ffmpeg-static`/`ffprobe-static`; yt-dlp, Demucs (Python), pedalboard (Python) instalados sob demanda na pasta de dados.
- Testes: **Vitest** (`tests/`). Não há ESLint no projeto.

## Comandos

```powershell
npm run dev        # Vite + Electron em desenvolvimento
npm run typecheck  # tsc --noEmit
npm test           # vitest run (usa FFmpeg de verdade; leva ~20 s)
npm run build      # typecheck + vite build
npm run dist       # build + instalador NSIS (release/)
npm run release    # publica a Release (ver scripts/release.cjs; pede confirmação)
```

Gerar só o app descompactado, sem instalador: `ELECTRON_BUILDER_CACHE=<repo>/.cache/electron-builder CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --dir --publish never`
(sem essa variável o electron-builder tenta criar links simbólicos e falha sem privilégio de administrador).

## Arquitetura

- `electron/main.cjs`: janela, protocolos `app://` (interface) e `media://` (mídia local), todos os `ipcMain.handle`.
- `electron/security.cjs`: regras puras de segurança (lista de mídias liberadas, origem confiável, validação de preferências). Mexeu em IPC ou em `media://`? Comece por aqui.
- `electron/export.cjs`: projeto → comando do FFmpeg. `exportqueue.cjs`: fila (uma exportação por vez, grava em arquivo provisório). `dsp-tasks.cjs` + `dsp-worker.cjs`: afinação e ducking da exportação em `worker_threads`.
- `electron/procs.cjs`: **todo processo filho passa por aqui** (`spawn`/`track`), para encerrar tudo ao sair e matar a árvore no Cancelar.
- `electron/fsutil.cjs`: `writeFileAtomic` (projeto, autosave, preferências).
- `src/store.ts`: estado do projeto (reducer puro + histórico de desfazer). `src/projectFile.ts`: valida e normaliza o `.edproj` ao abrir.
- `src/engine.ts` + `src/audio.ts`: prévia (vídeo/áudio) e cadeia de efeitos das trilhas. `src/dj.ts`, `src/live.ts`: Modo DJ e microfone ao vivo. `src/dsp/*.js`: núcleos de DSP compartilhados entre a prévia (AudioWorklet) e a exportação.
- `src/ui/a11y.ts`: acessibilidade dos diálogos (role, foco, Esc, Tab preso) aplicada a toda a interface.

## Convenções

- Texto de interface, comentários, logs e commits em português do Brasil, com acentuação.
- Toda correção de bug nasce com um teste que falha antes e passa depois.
- O que vem do renderer é **não confiável** no processo principal: caminhos passam por `isLocalPath`, preferências por `sanitizeSettingsPatch`, e todo `ipcMain.handle` só aceita a nossa interface.
- O programa só lê pelo `media://` arquivos "liberados" (`MediaAllowlist`): importados, citados em projeto aberto ou gerados pelo app. Gerou um arquivo novo para a interface? Devolva a URL com `mediaUrl()`.
- Arquivos de cache nunca ficam pela metade: escreva em `.parcial` e renomeie no fim.

## Armadilhas

- No Windows os arquivos do repositório ficam com CRLF na cópia de trabalho (`core.autocrlf`); o Git normaliza. Ao editar por script, trate `\r\n`.
- FFmpeg: caminhos com apóstrofo quebram `lut3d` — a LUT é copiada com nome seguro. Grafos longos vão em `-filter_complex_script` (limite de linha de comando do Windows).
- Filtros `lutrgb`/`hflip` derrubam o FFmpeg se o quadro muda de tamanho a cada quadro: manter a ordem usada em `export.cjs`.
- A interface empacotada é servida por `app://` (não `file://`) para workers e AudioWorklet carregarem como módulos.
- O instalador não é assinado (decisão registrada); o Windows SmartScreen avisa.
- `package.json` → `allowScripts` não é reconhecido pelo npm (provavelmente sem efeito).

## Testes pelo Claude

Além de `typecheck` e `npm test`, o app real pode ser conduzido pelo Chrome DevTools Protocol: abra o Electron com `--remote-debugging-port=<porta> --user-data-dir=<pasta temporária>` e um `.edproj` na linha de comando, e avalie JavaScript na página (foi assim que a interface foi verificada). Microfone real/VB-CABLE, VRChat, gravação de tela com áudio do sistema e atualização automática **não** têm teste automatizado.
