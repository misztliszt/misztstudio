# Novidades

## 1.0.2

**Segurança**
- O programa só lê pela interface os arquivos que conhece (mídias importadas, citadas em projetos abertos ou geradas por ele); antes qualquer arquivo do disco podia ser lido.
- A interface só aceita chamadas vindas dela mesma, e a janela ficou com sandbox e sem navegação para fora do app.
- Salvar projeto só grava em arquivos .edproj que você escolheu ou abriu; as preferências recusam valores inválidos; a gravação de tela valida as fontes.
- Importar por link aceita só endereços http(s), e o yt-dlp baixado agora é conferido pelo hash oficial.
- Exportação: caminhos de mídia precisam ser arquivos locais, a LUT é copiada com nome seguro (nomes com apóstrofo não quebram mais) e ids/medidas do projeto são validados.
- Plugins VST3 só carregam se tiverem sido encontrados pela busca de plugins; downloads da biblioteca livre exigem https de servidor público e têm limite de tamanho.
- Política de segurança do conteúdo mais restrita; o modo de desenvolvimento não vale mais no app instalado.

## 1.0.1

**Proteção contra perda de dados**
- O projeto e a cópia de recuperação são gravados com segurança: uma queda de energia no meio de um salvamento não corrompe mais o arquivo, e a versão anterior fica guardada em um arquivo .bak ao lado.
- Ao fechar a janela com alterações não salvas, o programa pergunta antes de sair.
- Projetos corrompidos ou editados à mão agora mostram uma mensagem clara em vez de derrubar o programa; clipes inválidos são descartados com aviso.
- Mídias movidas ou apagadas são avisadas ao abrir o projeto e marcadas na biblioteca; use "Localizar arquivo…" (botão direito) para reconectar.
- Descartar a cópia de recuperação ou a gravação do set DJ agora pede confirmação.
- Erro ao salvar o projeto passa a aparecer na tela.

**Exportação**
- Exportar por cima de um arquivo existente e falhar não apaga mais o arquivo antigo (a exportação grava num arquivo provisório e só troca no fim).
- Timelines com muitos clipes não estouram mais o limite de linha de comando do Windows.
- Velocidade inválida em um projeto não trava mais o programa.
- Legendas animadas (karaokê, palavra a palavra) exportam sem congelar a janela.

**Correções**
- Arrastar um clipe para outra trilha não interrompe mais o arrasto.
- Gravação de tela: fechar o diálogo durante a contagem regressiva não deixa mais o atalho global e a gravação presos.
- Remover fundo: cancelar durante a preparação apaga os quadros temporários; falhas ao carregar o modelo agora aparecem em vez de travar.

## 1.0.0

**Modo DJ**
- Dois decks com BPM e grade de batidas, SYNC, trava de tom, 8 hot cues, loops e empurrão de andamento.
- Mixer com EQ de 3 bandas, filtro, faders, crossfader, medidores e stems ao vivo (voz, bateria, baixo, outros).
- Tons na roda Camelot com aviso de mixagem harmônica.
- Importa a biblioteca do rekordbox (XML), Traktor (NML), Serato (tags) e Engine DJ.
- Grava o set direto para a timeline (áudio exato e/ou clipes editáveis por deck).

**Áudio**
- Microfone ao vivo para VRChat, Discord e lives: afinação em tempo real, noise gate, EQ, compressor e reverb, com saída para o VB-CABLE.
- Detecção do tom da música, aplicável na afinação da trilha.
- Limpar voz com ajuste fino e prévia antes/depois.
- Detecção de BPM mais precisa (erro abaixo de 0,1 BPM).
- Biblioteca livre de músicas e efeitos sonoros Creative Commons, com créditos para a descrição do vídeo.

**Edição e conforto**
- Pesquisa do YouTube dentro do app.
- Gravação de tela com áudio do sistema e microfone em trilhas separadas.
- Exportação em segundo plano, com fila.
- Histórico de desfazer visual (Ctrl+H).
- Preferências: pastas, qualidade da prévia, proxies, salvamento automático e atalhos personalizáveis.
- Atualização automática pelas Releases do GitHub.

**Correções**
- Exportar um clipe com giro ou zoom junto com brilho/contraste travava o FFmpeg.

## 0.8.0

Primeira versão com instalador: edição multitrilha, mixer, afinação automática, separação de voz e instrumentos, legendas, remoção de fundo, VST3 e importação por link.
