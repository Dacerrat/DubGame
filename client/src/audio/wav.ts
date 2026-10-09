// Codificación / decodificación WAV PCM 16 bits.

export function codificarWav(datos: Float32Array, sr: number): ArrayBuffer {
  return codificarWavCanales([datos], sr);
}

export function codificarWavCanales(canales: Float32Array[], sr: number): ArrayBuffer {
  const nc = canales.length;
  const n = canales[0].length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const txt = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, 'RIFF');
  v.setUint32(4, 36 + n * nc * 2, true);
  txt(8, 'WAVE');
  txt(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  txt(36, 'data');
  v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, canales[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}

export function decodificarWav(buf: ArrayBuffer): { sr: number; canales: Float32Array[] } {
  const v = new DataView(buf);
  const txt = (o: number, l: number) => String.fromCharCode(...new Uint8Array(buf, o, l));
  if (txt(0, 4) !== 'RIFF' || txt(8, 4) !== 'WAVE') throw new Error('No es un WAV');
  let o = 12;
  let sr = 44100, nc = 1, bits = 16;
  while (o + 8 <= buf.byteLength) {
    const id = txt(o, 4);
    const tam = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      nc = v.getUint16(o + 10, true);
      sr = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error('Solo WAV de 16 bits');
      const n = Math.floor(Math.min(tam, buf.byteLength - o - 8) / (2 * nc));
      const canales = Array.from({ length: nc }, () => new Float32Array(n));
      let p = o + 8;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < nc; c++) {
          canales[c][i] = v.getInt16(p, true) / 0x8000;
          p += 2;
        }
      }
      return { sr, canales };
    }
    o += 8 + tam + (tam % 2);
  }
  throw new Error('WAV sin datos');
}
