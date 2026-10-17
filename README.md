<p align="center">
  <img src="build/icon.png" width="112" alt="Miszt Studio" />
</p>

<h1 align="center">Miszt Studio</h1>

<p align="center">
  Edição de vídeo com áudio de estúdio: timeline multitrilha, mixer, afinação automática,<br />
  separação de voz e instrumentos por IA e exportação profissional.
</p>

<p align="center">
  <strong>Desenvolvido por Miszt</strong> · Windows · Software proprietário
</p>

---

## Recursos

### Edição de vídeo
- Timeline multitrilha com mover, aparar, dividir, snap (inclusive em batidas e marcadores) e zoom.
- Copiar, recortar, colar e duplicar clipes; menu de contexto em clipes, trilhas e mídias.
- **Transformar na prévia**: arraste para mover, cantos para escalar, alça para girar; corte por lado.
- **Keyframes** de posição, escala, rotação e opacidade, com curvas suave, linear e segurar.
- **Velocidade** de 0,25× a 4× (o tom da voz é preservado).
- Textos com estilos prontos e animações; transições dissolver e preto.
- Cor: brilho, contraste, saturação, matiz, sépia, filtros prontos e LUT `.cube`.
- **Legendas automáticas** com Whisper rodando no computador.
- **Importar de link** (YouTube e outros sites) com o yt-dlp, escolhendo qualidade e pasta.
- Proxies automáticos para vídeos pesados (HEVC, ProRes, 4K).

### Áudio
- Mixer por trilha: volume, pan, EQ de 3 bandas, compressor, reverb e medidores.
- **Mudar o tom** de −12 a +12 semitons, com assistente "de Si maior para Dó maior".
- **Afinação automática**: tom, escala, velocidade de correção e gráfico de pitch em tempo real.
- **Separar voz e instrumentos** (2, 4 ou 6 faixas) com o Demucs, sob demanda.
- **Separar o áudio do vídeo** em uma trilha própria.
- **Ducking**: a música abaixa sozinha quando há voz.
- **Detecção de batidas** (BPM) com ímã na timeline.
- Automação de volume por pontos e fades.

### Exportação
- Presets: YouTube 1080p e 4K, Reels/TikTok, arquivo mestre, rascunho, MP3 e WAV.
- MP4 (H.264/H.265), MOV, WebM; resolução, fps e qualidade ajustáveis.
- Normalização de volume para −14 LUFS e estimativa do tamanho do arquivo.

### Conforto
- Introdução animada na abertura.
- Tela inicial com modelos de projeto (YouTube, Reels/TikTok, quadrado, podcast, clipe musical) e projetos recentes.
- Salvamento automático com recuperação, desfazer/refazer, marcadores e atalhos J/K/L.

## Atalhos principais

| Tecla | Ação |
|---|---|
| Espaço | Reproduzir / pausar |
| J / K / L | Voltar 5 s / pausar / tocar |
| S | Dividir no cursor |
| T | Novo texto |
| M | Marcador no cursor · `[` `]` navegam |
| Ctrl+C / X / V / D | Copiar / recortar / colar / duplicar |
| Ctrl+Z / Ctrl+Y | Desfazer / refazer |
| Ctrl+S / Ctrl+O / Ctrl+E | Salvar / abrir / exportar |
| Ctrl + roda | Zoom da timeline |

## Desenvolvimento

Requisitos: Node.js 22+ e Windows 10/11 (x64). Para separar voz e instrumentos, Python 3.9+.

```bash
npm install
npm run dev
```

Gerar o instalador (`release/MisztStudio-Setup-<versão>.exe`):

```bash
npm run dist
```

- Use `ELECTRON_BUILDER_CACHE=.cache/electron-builder` para manter o cache do electron-builder no disco do projeto.
- Se a extração do `winCodeSign` falhar por causa de links simbólicos, extraia o `.7z` em `.cache/electron-builder/winCodeSign/winCodeSign-2.6.0` sem a pasta `darwin`.
- O ícone vem de `build/icon.svg`; `npm run icon` gera o `build/icon.png`.

### Estrutura

| Caminho | Conteúdo |
|---|---|
| `electron/main.cjs` | Janela, protocolos `app://` e `media://`, IPC, proxies, autosave |
| `electron/export.cjs` | Timeline → FFmpeg (vídeo, cor, animação, áudio, ducking, loudness) |
| `electron/stems.cjs`, `separate.py` | Separação de faixas com Demucs |
| `electron/downloader.cjs` | Importação por link com yt-dlp |
| `src/engine.ts`, `src/audio.ts` | Prévia: composição no canvas e grafo Web Audio |
| `src/dsp/` | Afinação/transposição e reverb, compartilhados entre prévia e exportação |
| `src/anim.ts`, `src/color.ts`, `src/text.ts` | Mesmas fórmulas na prévia e na exportação |
| `src/components/` | Interface (timeline, inspetor, mixer, diálogos, introdução) |

## Licença

**Software proprietário. Todos os direitos reservados © 2026 Miszt.**

É proibido copiar, distribuir, modificar, fazer engenharia reversa ou criar obras derivadas sem autorização por escrito. Veja os termos completos em [LICENSE](LICENSE).

Componentes de terceiros mantêm suas próprias licenças; veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
