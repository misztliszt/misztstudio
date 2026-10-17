# Componentes de terceiros

O Miszt Studio é software proprietário (veja [LICENSE](LICENSE)), mas usa os componentes abaixo, que continuam sob as licenças dos seus autores. Nada na licença do Miszt Studio restringe os direitos que essas licenças concedem sobre os respectivos componentes.

## Incluídos no instalador

| Componente | Uso | Licença |
|---|---|---|
| [Electron](https://www.electronjs.org/) (Chromium, Node.js) | Base do aplicativo | MIT (Chromium: BSD e outras) |
| [FFmpeg](https://ffmpeg.org/) / FFprobe, via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) e [ffprobe-static](https://github.com/joshwnj/ffprobe-static) | Leitura, proxies e exportação de mídia | GPL v3 (build com x264/x265). Executado como programa separado. O código-fonte está em https://ffmpeg.org/download.html |
| [React](https://react.dev/) | Interface | MIT |
| [Lucide](https://lucide.dev/) | Ícones da interface | ISC |
| [Inter](https://rsms.me/inter/) via Fontsource | Fonte da interface | SIL Open Font License 1.1 |
| [Transformers.js](https://github.com/huggingface/transformers.js) e [ONNX Runtime Web](https://onnxruntime.ai/) | Legendas automáticas (Whisper local) | Apache 2.0 / MIT |

## Baixados sob demanda, só quando o usuário pede

| Componente | Uso | Licença |
|---|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Importar vídeos por link | The Unlicense (domínio público) |
| [Demucs](https://github.com/facebookresearch/demucs) + [PyTorch](https://pytorch.org/) | Separar voz e instrumentos | MIT / BSD-3-Clause |
| Modelos [Whisper](https://github.com/openai/whisper) (via Hugging Face) | Transcrição | MIT |
| Modelo [MODNet](https://github.com/ZHKKKe/MODNet) (`Xenova/modnet`) | Remover fundo de vídeo | Apache 2.0 |
| [pedalboard](https://github.com/spotify/pedalboard) (Spotify) | Hospedar plugins VST3 | GPL v3. Executado como programa separado, num Python próprio; código-fonte em https://github.com/spotify/pedalboard |

O texto completo de cada licença acompanha o respectivo pacote (em `node_modules/<pacote>/LICENSE` no código e em `resources/` no aplicativo instalado) ou está disponível no site do projeto.
