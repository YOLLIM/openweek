// 그림 파일 앞부분에서 가로 · 세로 크기(px)를 읽는다 (PPT · 엑셀에 비율대로 넣기 위해)
// png · jpg · gif · webp. 알 수 없으면 null
function imgSize(b) {
  try {
    if (b.length > 24 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.length > 10 && /^GIF8/.test(b.toString('latin1', 0, 4))) return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const t = b.toString('latin1', 12, 16);
      if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (t === 'VP8L') { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
      if (t === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
    }
  } catch { /* 깨진 파일 */ }
  return null;
}

// 상자(maxW × maxH) 안에 비율을 지켜 넣은 크기
function fit(size, maxW, maxH) {
  const s = size && size.w > 0 && size.h > 0 ? size : { w: 4, h: 3 };
  const k = Math.min(maxW / s.w, maxH / s.h);
  return { w: s.w * k, h: s.h * k };
}

module.exports = { imgSize, fit };
