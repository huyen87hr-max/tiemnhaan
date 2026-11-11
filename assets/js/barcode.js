/*
 * Epsilon.Blue Soft / Material Master / Code 128 barcode renderer.
 * No network or third-party runtime. Encodes the material CODE, not its database ID.
 * Code Set B supports ASCII 32..127; FNC4 handles ISO-8859-1 160..255.
 * Does not silently transliterate legacy characters (e.g. U+00D0 'Ð').
 * Labels should be checked with the actual printer and barcode scanner before production use.
 */
(function (root) {
  'use strict';

  // Standard Code 128 codeword bar/space widths, values 0..106 (106 = STOP).
  const PATTERNS = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
    '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
    '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
    '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
    '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
    '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
    '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
    '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
    '114131','311141','411131','211412','211214','211232','2331112'
  ];
  const START_B = 104;
  const FNC4_B = 100;
  const STOP = 106;
  const QUIET_MODULES = 10;
  const NS = 'http://www.w3.org/2000/svg';

  function encode(value) {
    if (typeof value !== 'string' || value.length === 0) throw new Error('Mã vật tư chưa có giá trị.');
    if (value.length > 32) throw new Error('Mã vật tư vượt quá 32 ký tự.');
    const words = [START_B];
    for (const symbol of value) {
      const n = symbol.codePointAt(0);
      if (n >= 32 && n <= 127) words.push(n - 32);
      else if (n >= 160 && n <= 255) words.push(FNC4_B, n - 160);
      else throw new Error('Mã chứa ký tự không thể mã hóa nguyên vẹn bằng Code 128: U+' + n.toString(16).toUpperCase().padStart(4,'0'));
    }
    let weighted = words[0];
    for (let i = 1; i < words.length; i++) weighted += i * words[i];
    const checksum = weighted % 103;
    const all = [...words, checksum, STOP];
    const widths = all.map(i => PATTERNS[i]);
    const modules = widths.reduce((sum, pat) => sum + [...pat].reduce((n, c) => n + Number(c), 0), 0) + 2 * QUIET_MODULES;
    return {value, codewords: all, checksum, patterns: widths, modules, quietModules: QUIET_MODULES};
  }

  function makeSvg(value, options = {}) {
    const data = encode(value);
    const barHeight = Number.isFinite(options.barHeight) && options.barHeight > 0 ? Math.min(150,options.barHeight) : 76;
    const svg = document.createElementNS(NS,'svg');
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('viewBox', `0 0 ${data.modules} ${barHeight}`);
    svg.setAttribute('width', String(data.modules));
    svg.setAttribute('height', String(barHeight));
    svg.setAttribute('preserveAspectRatio','none'); // Fill label width; all module widths remain proportional.
    svg.setAttribute('role','img');
    svg.setAttribute('aria-label', 'Barcode Code 128 cho mã vật tư ' + value);
    const title = document.createElementNS(NS,'title');
    title.textContent = 'Code 128 · ' + value;
    svg.append(title);
    const background = document.createElementNS(NS,'rect');
    background.setAttribute('x','0');background.setAttribute('y','0');
    background.setAttribute('width', String(data.modules));
    background.setAttribute('height', String(barHeight));
    background.setAttribute('fill','#ffffff');
    svg.append(background);
    let x = data.quietModules;
    for (const pattern of data.patterns) {
      for (let p=0;p<pattern.length;p++) {
        const width = Number(pattern[p]);
        if (p%2===0) {
          const bar = document.createElementNS(NS,'rect');
          bar.setAttribute('x',String(x));bar.setAttribute('y','0');
          bar.setAttribute('width',String(width));bar.setAttribute('height',String(barHeight));
          bar.setAttribute('fill','#101828');
          svg.append(bar);
        }
        x += width;
      }
    }
    return svg;
  }

  function render(container, value, options = {}) {
    if (!(container instanceof Element)) throw new Error('Thiếu vùng hiển thị barcode.');
    try {
      const svg = makeSvg(value, options);
      container.replaceChildren(svg);
      container.dataset.barcodeReady = 'true';
      return {ok:true, svg};
    } catch (error) {
      const p = document.createElement('span');
      p.className = 'barcode-error-message';
      p.textContent = error instanceof Error ? error.message : 'Không tạo được mã vạch.';
      container.replaceChildren(p);
      container.dataset.barcodeReady = 'false';
      return {ok:false,error};
    }
  }

  const api = Object.freeze({encode,makeSvg,render,symbology:'CODE128',supportsLatin1:true});
  root.MaterialBarcode = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
