# Novidades

## 1.0.3

**Edição**
- Arrastar vários clipes selecionados move o grupo inteiro, mantendo a distância entre eles.
- Dividir (S), colar, novo texto, marcador e congelar quadro usam a posição exata do cursor, mesmo durante a reprodução (antes podiam errar em até 4 quadros).
- A rampa de velocidade preserva os keyframes de animação e de volume do clipe.
- Dividir uma legenda karaokê mantém o destaque das palavras certo na segunda metade.
- Congelar quadro perto da borda do clipe avisa em vez de criar clipes sobrepostos; colar um clipe cuja mídia foi removida deixou de criar clipes fantasmas.
- Remover a trilha de voz desliga o ducking que a usava (a música não fica mais abaixada para sempre).
- Segurar uma tecla não repete mais play, marcador, dividir etc.; os atalhos [ e ] funcionam no teclado ABNT2; os campos numéricos não alteram o valor só por entrar e sair.

**Modo DJ**
- Limitador na saída: dois decks somados não estouram mais o som nem a gravação do set.
- Hot cues ficam salvos na mídia do projeto (voltam ao recarregar a faixa e ao reabrir o projeto).
- Erro ao abrir um arquivo de áudio agora aparece; separar stems não troca mais a faixa errada se você carregou outra no meio; SYNC ignora o empurrão temporário de andamento do outro deck; o volume master mostra o valor certo ao voltar à tela.

**Áudio ao vivo e gravação**
- Afinação: voltar ao tom certo não desafina mais a nota (antes passava de um semitom por alguns milissegundos), e religar o efeito não toca som antigo.
- Microfone ao vivo: trocar de dispositivo rápido não deixa microfone ou áudio órfãos; falha no retorno nos fones é avisada sem derrubar a voz; microfone desconectado é avisado; o diálogo deixou de redesenhar 60 vezes por segundo à toa.
- Gravar áudio: fechar durante a contagem regressiva não inicia gravação nem a timeline sozinha.

**Estabilidade**
- Fechar o programa encerra yt-dlp, FFmpeg e Python que estivessem rodando (e Cancelar mata também os processos filhos).
- Só uma instância do programa: dar duplo clique em outro projeto abre-o na janela já aberta.
- A fila de exportação não para mais ao fechar a janela no meio de uma exportação.
- Títulos com acento do yt-dlp e linhas de progresso não são mais cortados no meio; a separação de faixas apaga o arquivo temporário grande ao terminar, falhar ou cancelar.
- Textos: erros em inglês do sistema não aparecem mais cruamente; "views" virou "visualizações"; o aviso de exportação concluída não se repete.

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
