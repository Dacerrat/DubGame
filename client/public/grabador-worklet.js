// Captura el micrófono en bloques con la marca de tiempo del AudioContext.
class Grabador extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bloque = new Float32Array(2048);
    this.lleno = 0;
    this.inicio = 0;
  }

  process(inputs) {
    const canal = inputs[0] && inputs[0][0];
    if (!canal) return true;
    if (this.lleno === 0) this.inicio = currentFrame;
    const cabe = Math.min(canal.length, this.bloque.length - this.lleno);
    this.bloque.set(canal.subarray(0, cabe), this.lleno);
    this.lleno += cabe;
    if (this.lleno >= this.bloque.length) {
      this.port.postMessage({ frame: this.inicio, datos: this.bloque });
      this.bloque = new Float32Array(2048);
      this.lleno = 0;
      if (cabe < canal.length) {
        this.inicio = currentFrame + cabe;
        this.bloque.set(canal.subarray(cabe), 0);
        this.lleno = canal.length - cabe;
      }
    }
    return true;
  }
}

registerProcessor('grabador', Grabador);
