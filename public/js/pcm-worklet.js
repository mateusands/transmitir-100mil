/* Transforma PCM cru vindo do app de mesa numa faixa de áudio da página.
 *
 * No Linux o som chega como dispositivo e a página só faz getUserMedia. No
 * macOS e no Windows não existe dispositivo: as bibliotecas nativas entregam
 * blocos de PCM, e é aqui que eles viram som. A saída deste nó vai para um
 * MediaStreamAudioDestinationNode, e o que sai de lá é uma faixa igual a
 * qualquer outra — o WebRTC não sabe a diferença.
 *
 * Formato de entrada: inteiro de 16 bits com sinal, intercalado por canal.
 * Vale para as duas plataformas, e não é suposição:
 *   - Windows: WAVE_FORMAT_PCM / 2 canais / 48000 / 16 bits, fixo no fonte do
 *     ApplicationLoopback.
 *   - macOS: o conversor do audiotee usa kAudioFormatFlagIsSignedInteger, então
 *     pedir uma taxa de amostragem garante inteiro; vem em 1 canal.
 */

const CHEIO = 48000;   // ~1s de amostras por canal: acima disso o atraso é pior que o corte

class FonteDePcm extends AudioWorkletProcessor {
  constructor(opcoes) {
    super();
    this.canais = opcoes.processorOptions?.canais || 1;
    this.pedacos = [];   // Int16Array esperando para tocar
    this.lidas = 0;      // amostras já consumidas do primeiro pedaço
    this.guardadas = 0;  // total na fila, para não crescer sem limite
    this.port.onmessage = evento => this.receber(evento.data);
  }

  receber(dados) {
    if (!(dados instanceof ArrayBuffer) || dados.byteLength < 2) return;
    const bloco = new Int16Array(dados, 0, dados.byteLength >> 1);
    this.pedacos.push(bloco);
    this.guardadas += bloco.length;

    /* Se quem produz for mais rápido que a placa de som, a fila cresce para
       sempre e o som chega cada vez mais atrasado. Descartar o mais antigo
       troca um engasgo por um atraso permanente — o engasgo é preferível. */
    while (this.guardadas > CHEIO * this.canais && this.pedacos.length > 1) {
      this.guardadas -= this.pedacos[0].length - this.lidas;
      this.pedacos.shift();
      this.lidas = 0;
    }
  }

  proxima() {
    while (this.pedacos.length) {
      const bloco = this.pedacos[0];
      if (this.lidas < bloco.length) {
        this.guardadas--;
        // 32768 e não 32767: divide certo o extremo negativo, sem estourar
        return bloco[this.lidas++] / 32768;
      }
      this.pedacos.shift();
      this.lidas = 0;
    }
    return 0;   // sem dado ainda: silêncio é melhor que ruído
  }

  process(_entradas, saidas) {
    const saida = saidas[0];
    if (!saida || !saida.length) return true;
    const quadros = saida[0].length;
    const quadro = new Array(this.canais);

    for (let i = 0; i < quadros; i++) {
      /* Consome pela contagem da ORIGEM, não pela da saída. Se as duas
         divergirem — mono do macOS numa saída estéreo — consumir pela saída
         comeria amostras a mais e os canais iriam se descolando a cada bloco. */
      for (let c = 0; c < this.canais; c++) quadro[c] = this.proxima();
      for (let c = 0; c < saida.length; c++) {
        // mono numa saída de dois: o mesmo valor dos dois lados
        saida[c][i] = quadro[Math.min(c, this.canais - 1)];
      }
    }
    // nunca devolve false: o nó vive enquanto a faixa existir, mesmo em silêncio
    return true;
  }
}

registerProcessor('fonte-de-pcm', FonteDePcm);
