# Lista de afazeres

Próximos passos combinados para o Miszt Studio. Marque com `[x]` ao concluir.

## Repositório

- [ ] **Releases com o instalador**: publicar cada versão (ex.: v0.8.0) como Release do GitHub, com o `.exe` anexado e as novidades.
- [ ] **Capturas de tela e GIF no README**: tela inicial, editor, mixer e a introdução animada.
- [ ] **Testes automatizados**: transformar em testes do projeto as verificações feitas durante o desenvolvimento (exportação, afinação e transposição, ripple, timeline magnética, rampa de velocidade, ducking, loudness).

## Aplicativo

- [ ] **Atualização automática**: o app avisa e instala versões novas sozinho (usa as Releases acima).
- [ ] **Tela de preferências**: pasta padrão, qualidade da prévia, atalhos e idioma.
- [ ] **Biblioteca de músicas e efeitos sonoros livres** (Creative Commons), dentro do app.
- [ ] **Exportar em segundo plano**, com fila, para continuar editando enquanto renderiza.
- [ ] **Histórico de desfazer visual**: uma lista de ações para voltar a qualquer ponto.
- [ ] **Microfone ao vivo** (karaokê no VRChat, Discord, lives): escolher o microfone, aplicar em tempo real a afinação do app (tom, escala, velocidade), além de EQ, compressor e reverb leve, e mandar a voz corrigida para o VB-CABLE, que o jogo usa como microfone ("CABLE Output"). Inclui botão de tom rápido para trocar de música, monitoramento nos fones e controle de latência. Usa a afinação própria do app; o MAutoPitch via pedalboard não funciona ao vivo.

## Modo DJ

Tudo com código próprio. O REA só serve para entender os formatos dos arquivos da biblioteca do próprio usuário; não usamos código de outros programas (o Mixxx é GPL) nem abrimos o banco criptografado do rekordbox.

- [ ] **Importar a biblioteca de DJ**: BPM, grid de batidas, tom e hot cues do rekordbox (XML exportado), Traktor (`collection.nml`), Serato (tags nos arquivos) e Engine DJ (SQLite), virando marcadores na timeline.
- [ ] **Detecção de tom** com a roda Camelot (ex.: 4A) e sugestão de músicas compatíveis para mixagem harmônica.
- [ ] **Dois decks**: crossfader, sincronia de BPM, loops, hot cues e EQ por deck, usando os stems já separados (voz, bateria, baixo…).
- [ ] **Montar o set na timeline** e exportar a mixagem em MP3 ou WAV.
