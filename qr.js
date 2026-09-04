/* qr.js — 오프라인 QR 코드 생성기 (바이트 모드, 버전 1~10)
 *
 * 축제 부스에서 와이파이 없이 돌아가야 해서 외부 라이브러리를 쓰지 않는다.
 * QR.encode(text, ec) → { size, get(row,col) }
 *   ec: 'L' | 'M' | 'Q' | 'H'  (기본 'M')
 */
(function (global) {
  'use strict';

  /* ---------- GF(256) ---------- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gmul(a, b) {
    return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  }

  function genPoly(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1);
      for (var k = 0; k < ng.length; k++) ng[k] = 0;
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  }

  function rsEncode(data, ecLen) {
    var g = genPoly(ecLen);
    var buf = new Uint8Array(data.length + ecLen);
    buf.set(data);
    for (var i = 0; i < data.length; i++) {
      var f = buf[i];
      if (f !== 0) {
        for (var j = 0; j < g.length; j++) buf[i + j] ^= gmul(g[j], f);
      }
    }
    return buf.subarray(data.length);
  }

  /* ---------- 버전·오류정정 표 (버전 1~10) ----------
   * [ec코드워드/블록, 그룹1 블록수, 그룹1 데이터수, 그룹2 블록수, 그룹2 데이터수]
   */
  var RS = {
    L: [null,
      [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0],
      [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0],
      [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
    M: [null,
      [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
      [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
      [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
    Q: [null,
      [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0],
      [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19],
      [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]],
    H: [null,
      [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0],
      [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15],
      [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]]
  };

  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  var EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var MAX_VERSION = 10;

  function dataCodewords(version, ec) {
    var r = RS[ec][version];
    return r[1] * r[2] + r[3] * r[4];
  }

  /* ---------- 비트 버퍼 ---------- */
  function BitBuffer() {
    this.bytes = [];
    this.len = 0;
  }
  BitBuffer.prototype.put = function (value, bits) {
    for (var i = bits - 1; i >= 0; i--) this.putBit((value >>> i) & 1);
  };
  BitBuffer.prototype.putBit = function (bit) {
    var idx = this.len >> 3;
    if (this.bytes.length <= idx) this.bytes.push(0);
    if (bit) this.bytes[idx] |= 0x80 >>> (this.len & 7);
    this.len++;
  };

  /* ---------- 데이터 코드워드 만들기 ---------- */
  function makeCodewords(bytes, version, ec) {
    var buf = new BitBuffer();
    buf.put(4, 4);                                  // 바이트 모드
    buf.put(bytes.length, version < 10 ? 8 : 16);   // 글자 수
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    var capacity = dataCodewords(version, ec) * 8;
    // 종단자 최대 4비트
    for (i = 0; i < 4 && buf.len < capacity; i++) buf.putBit(0);
    // 바이트 경계까지
    while (buf.len % 8 !== 0) buf.putBit(0);
    // 채움 바이트
    var pad = [0xec, 0x11], p = 0;
    while (buf.len < capacity) {
      buf.put(pad[p++ % 2], 8);
    }

    var raw = buf.bytes;
    var r = RS[ec][version];
    var ecLen = r[0];
    var blocks = [];
    var offset = 0;
    var g;
    for (g = 0; g < r[1]; g++) {
      blocks.push(Uint8Array.prototype.slice.call(new Uint8Array(raw), offset, offset + r[2]));
      offset += r[2];
    }
    for (g = 0; g < r[3]; g++) {
      blocks.push(Uint8Array.prototype.slice.call(new Uint8Array(raw), offset, offset + r[4]));
      offset += r[4];
    }
    var eccs = blocks.map(function (b) { return rsEncode(b, ecLen); });

    // 인터리브
    var out = [];
    var maxData = Math.max(r[2], r[4]);
    for (i = 0; i < maxData; i++) {
      for (var b = 0; b < blocks.length; b++) {
        if (i < blocks[b].length) out.push(blocks[b][i]);
      }
    }
    for (i = 0; i < ecLen; i++) {
      for (b = 0; b < eccs.length; b++) out.push(eccs[b][i]);
    }
    return new Uint8Array(out);
  }

  /* ---------- BCH ---------- */
  function bchDigit(v) {
    var d = 0;
    while (v !== 0) { d++; v >>>= 1; }
    return d;
  }
  function formatInfo(ec, mask) {
    var data = (EC_BITS[ec] << 3) | mask;
    var d = data << 10;
    while (bchDigit(d) - bchDigit(0x537) >= 0) d ^= 0x537 << (bchDigit(d) - bchDigit(0x537));
    return ((data << 10) | d) ^ 0x5412;
  }
  function versionInfo(version) {
    var d = version << 12;
    while (bchDigit(d) - bchDigit(0x1f25) >= 0) d ^= 0x1f25 << (bchDigit(d) - bchDigit(0x1f25));
    return (version << 12) | d;
  }

  /* ---------- 마스크 ---------- */
  function maskFn(pattern, i, j) {
    switch (pattern) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
      case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
      case 7: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    }
    return false;
  }

  /* ---------- 배치 ---------- */
  function buildMatrix(version, ec, codewords, mask) {
    var size = version * 4 + 17;
    var m = [];
    for (var i = 0; i < size; i++) {
      var row = new Array(size);
      for (var j = 0; j < size; j++) row[j] = null;
      m.push(row);
    }

    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var on = false;
          if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
            var ring = (dr === 0 || dr === 6 || dc === 0 || dc === 6);
            var core = (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
            on = ring || core;
          }
          m[rr][cc] = on;
        }
      }
    }
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    // 타이밍 패턴
    for (i = 8; i < size - 8; i++) {
      var on = (i % 2 === 0);
      if (m[6][i] === null) m[6][i] = on;
      if (m[i][6] === null) m[i][6] = on;
    }

    // 정렬 패턴
    // 파인더와 겹치는 세 모서리만 빼고 모두 놓는다.
    // (버전 7부터는 6행·6열 위에도 정렬 패턴이 온다. "이미 칠해진 칸이면 건너뛴다"로
    //  판단하면 타이밍 패턴에 가려 통째로 빠지므로, 자리로 판단해야 한다.)
    var cen = ALIGN[version];
    var lastC = cen.length - 1;
    for (var a = 0; a < cen.length; a++) {
      for (var b = 0; b < cen.length; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === lastC) || (a === lastC && b === 0)) continue;
        var r = cen[a], c = cen[b];
        for (var dr2 = -2; dr2 <= 2; dr2++) {
          for (var dc2 = -2; dc2 <= 2; dc2++) {
            var ad = Math.max(Math.abs(dr2), Math.abs(dc2));
            m[r + dr2][c + dc2] = (ad !== 1);
          }
        }
      }
    }

    // 버전 정보 (7 이상)
    if (version >= 7) {
      var vb = versionInfo(version);
      for (i = 0; i < 18; i++) {
        var vbit = ((vb >> i) & 1) === 1;
        m[Math.floor(i / 3)][(i % 3) + size - 8 - 3] = vbit;
        m[(i % 3) + size - 8 - 3][Math.floor(i / 3)] = vbit;
      }
    }

    // 형식 정보
    var fi = formatInfo(ec, mask);
    for (i = 0; i < 15; i++) {
      var fbit = ((fi >> i) & 1) === 1;
      if (i < 6) m[i][8] = fbit;
      else if (i < 8) m[i + 1][8] = fbit;
      else m[size - 15 + i][8] = fbit;

      if (i < 8) m[8][size - i - 1] = fbit;
      else if (i < 9) m[8][15 - i - 1 + 1] = fbit;
      else m[8][15 - i - 1] = fbit;
    }
    m[size - 8][8] = true;   // 고정 검은 모듈

    // 데이터 배치 (지그재그)
    var inc = -1, rowp = size - 1, bitIndex = 7, byteIndex = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var k = 0; k < 2; k++) {
          if (m[rowp][col - k] === null) {
            var dark = false;
            if (byteIndex < codewords.length) {
              dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
            }
            if (maskFn(mask, rowp, col - k)) dark = !dark;
            m[rowp][col - k] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        rowp += inc;
        if (rowp < 0 || rowp >= size) { rowp -= inc; inc = -inc; break; }
      }
    }
    return m;
  }

  /* ---------- 마스크 평가 ---------- */
  function penalty(m) {
    var size = m.length, score = 0, i, j, run, prev;

    // 규칙 1: 같은 색 5칸 이상 연속
    for (i = 0; i < size; i++) {
      run = 1; prev = m[i][0];
      for (j = 1; j < size; j++) {
        if (m[i][j] === prev) run++;
        else { if (run >= 5) score += run - 2; run = 1; prev = m[i][j]; }
      }
      if (run >= 5) score += run - 2;

      run = 1; prev = m[0][i];
      for (j = 1; j < size; j++) {
        if (m[j][i] === prev) run++;
        else { if (run >= 5) score += run - 2; run = 1; prev = m[j][i]; }
      }
      if (run >= 5) score += run - 2;
    }

    // 규칙 2: 2x2 같은 색
    for (i = 0; i < size - 1; i++) {
      for (j = 0; j < size - 1; j++) {
        var v = m[i][j];
        if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) score += 3;
      }
    }

    // 규칙 3: 파인더를 흉내내는 1:1:3:1:1 패턴
    // 심볼 바깥은 여백(흰색)이므로, 가장자리에 걸친 패턴도 잡으려면
    // 양 끝에 흰 칸 4개를 덧대고 검사해야 한다.
    var p1 = [true, false, true, true, true, false, true, false, false, false, false];
    var p2 = [false, false, false, false, true, false, true, true, true, false, true];
    function match(line) {
      var padded = [false, false, false, false].concat(line, [false, false, false, false]);
      var hit = 0;
      for (var s = 0; s + 11 <= padded.length; s++) {
        var ok1 = true, ok2 = true;
        for (var t = 0; t < 11; t++) {
          if (padded[s + t] !== p1[t]) ok1 = false;
          if (padded[s + t] !== p2[t]) ok2 = false;
        }
        if (ok1) hit++;
        if (ok2) hit++;
      }
      return hit;
    }
    for (i = 0; i < size; i++) {
      var rowLine = [], colLine = [];
      for (j = 0; j < size; j++) { rowLine.push(m[i][j] === true); colLine.push(m[j][i] === true); }
      score += 40 * match(rowLine);
      score += 40 * match(colLine);
    }

    // 규칙 4: 검은 칸 비율
    var dark = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j]) dark++;
    var pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  /* ---------- 공개 API ---------- */
  function toBytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    var out = [], i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function encode(text, ec, forceVersion, forceMask) {
    ec = ec || 'M';
    var bytes = toBytes(String(text));
    var version = forceVersion || 0;
    if (!version) {
      for (var v = 1; v <= MAX_VERSION; v++) {
        var need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
        if (dataCodewords(v, ec) * 8 >= need) { version = v; break; }
      }
      if (!version) throw new Error('QR: 내용이 너무 깁니다 (버전 ' + MAX_VERSION + ' 초과)');
    }

    var cw = makeCodewords(bytes, version, ec);
    var best = null, bestScore = Infinity;
    var masks = (forceMask === undefined || forceMask === null) ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
    for (var i = 0; i < masks.length; i++) {
      var m = buildMatrix(version, ec, cw, masks[i]);
      var s = masks.length === 1 ? 0 : penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }

    return {
      version: version,
      size: best.length,
      matrix: best,
      get: function (r, c) { return best[r][c] === true; }
    };
  }

  var QR = { encode: encode };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  else global.QR = QR;
})(typeof self !== 'undefined' ? self : this);
