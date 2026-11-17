/**
 * scanner.js — Core detection engine for Screenshot Guardian
 * Handles: Email, Phone, QR Code, Sensitive IDs, Crypto, IP, and Password/Secret detection
 * OCR runs via IPC in main process (Tesseract.js v5 in Node)
 * QR scanning via jsQR in renderer (browser context)
 * Computer vision scanning for password masking dots & input fields
 */

const Scanner = (() => {

  // ── Detection Patterns ──────────────────────────────────────────────
  const PATTERNS = {
    password: {
      color: '#f43f5e',
      label: 'Password',
      type: 'password',
      patterns: [
        { name: 'Masked Dots',     regex: /(?:[\u2022\u25cf\u2219\u2027\u25cb\u25e6*]{3,}|(?:\s*[•●·*.]){4,})/g },
        { name: 'Password Assign', regex: /(?:password|passwd|pwd|passphrase)\s*[:=]\s*["']?([^\s"'`\r\n]{3,})["']?/gi },
        { name: 'Secret Key',      regex: /(?:api_secret|client_secret|app_secret|secret_key|secret)\s*[:=]\s*["']?([^\s"'`\r\n]{4,})["']?/gi },
        { name: 'Auth Token',      regex: /(?:auth_token|access_token|refresh_token)\s*[:=]\s*["']?([^\s"'`\r\n]{6,})["']?/gi },
        { name: 'Bearer Token',    regex: /\bBearer\s+([A-Za-z0-9_\-\.]{12,})\b/gi },
        { name: 'PIN / Code',      regex: /(?:pin|passcode|security\s*code)\s*[:=]\s*["']?([0-9A-Za-z]{3,8})["']?/gi },
      ]
    },
    email: {
      regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
      color: '#a78bfa',
      label: 'Email',
      type: 'email',
    },
    phone: {
      regex: /(?<!\d)(?:\+?(\d{1,3})[\s\-.]?)?\(?(\d{2,4})\)?[\s\-.]?(\d{3,4})[\s\-.]?(\d{3,6})(?!\d)/g,
      color: '#34d399',
      label: 'Phone',
      type: 'phone',
      validate: (s) => {
        const digits = s.replace(/\D/g, '');
        return digits.length >= 7 && digits.length <= 15;
      }
    },
    id: {
      patterns: [
        { name: 'SSN',         regex: /\b\d{3}-\d{2}-\d{4}\b/g },
        { name: 'Aadhaar',     regex: /\b\d{4}\s\d{4}\s\d{4}\b/g },
        { name: 'PAN',         regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
        { name: 'Passport',    regex: /\b[A-Z]{1,2}\d{6,8}\b/g },
        { name: 'Credit Card', regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g },
        { name: 'API Key',     regex: /\b(?:sk[-_]|pk[-_]|api[-_]?key[-_]?|token[-_]?)[A-Za-z0-9_\-]{16,64}\b/gi },
        { name: 'JWT',         regex: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g },
        { name: 'UUID',        regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
        { name: 'AWS Key',     regex: /\bAKIA[0-9A-Z]{16}\b/g },
        { name: 'Hash MD5',    regex: /\b[a-f0-9]{32}\b/gi },
        { name: 'Hash SHA',    regex: /\b[a-f0-9]{40,64}\b/gi },
        { name: 'IBAN',        regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g },
        { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |)PRIVATE KEY-----/g },
      ],
      color: '#fbbf24',
      label: 'Sensitive ID',
      type: 'id',
    },
    crypto: {
      patterns: [
        { name: 'Bitcoin',   regex: /\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b/g },
        { name: 'Ethereum',  regex: /\b0x[a-fA-F0-9]{40}\b/g },
        { name: 'Monero',    regex: /\b4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}\b/g },
      ],
      color: '#f472b6',
      label: 'Crypto',
      type: 'crypto',
    },
    ip: {
      patterns: [
        { name: 'IPv4',       regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g },
        { name: 'IPv6',       regex: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g },
      ],
      color: '#f87171',
      label: 'IP Address',
      type: 'ip',
    },
  };

  // ── QR Code Detection via jsQR ────────────────────────────────────────
  function detectQRCodes(imageData) {
    const results = [];
    if (typeof jsQR === 'undefined') return results;
    try {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (code && code.data) {
        const loc = code.location;
        const xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomLeftCorner.x, loc.bottomRightCorner.x];
        const ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomLeftCorner.y, loc.bottomRightCorner.y];
        const minX = Math.min(...xs) - 10;
        const minY = Math.min(...ys) - 10;
        const maxX = Math.max(...xs) + 10;
        const maxY = Math.max(...ys) + 10;
        results.push({
          id:    generateId(),
          type:  'qr',
          label: 'QR Code',
          text:  code.data.length > 80 ? code.data.slice(0, 80) + '…' : code.data,
          color: '#38bdf8',
          bbox: { x: Math.max(0, minX), y: Math.max(0, minY), w: maxX - minX, h: maxY - minY },
          blurred: false,
        });
      }
    } catch (e) {
      console.error('QR scan error:', e);
    }
    return results;
  }

  // ── OCR via IPC ───────────────────────────────────────────────────────
  async function runOCR(dataURL, progressCb) {
    try {
      progressCb && progressCb(25, 'Running OCR…');
      const result = await window.electronAPI.ocrRecognize({ dataURL });
      progressCb && progressCb(80, 'OCR complete');
      if (result && result.success) {
        return {
          text: result.text || '',
          words: result.words || [],
          lines: result.lines || []
        };
      }
      return { text: '', words: [], lines: [] };
    } catch (e) {
      console.warn('OCR IPC failed:', e);
      return { text: '', words: [], lines: [] };
    }
  }

  // ── Find word bboxes for a text match (Symbol-aware & Line-fallback) ────
  function findBboxForMatch(matchText, words, lines, fullText) {
    if ((!words || words.length === 0) && (!lines || lines.length === 0)) return null;

    const matchTrimmed = matchText.trim();
    const isSymbolic = /[•●·*#$@!%^&()]/.test(matchTrimmed);

    const relevantWords = [];

    // 1. Direct symbol check (for masked bullets/asterisks)
    if (isSymbolic && words) {
      for (const w of words) {
        const wt = (w.text || '').trim();
        if (/[•●·*]{2,}/.test(wt) || wt.includes('***') || wt.includes('•••')) {
          relevantWords.push(w);
        }
      }
    }

    // 2. Standard word token check
    if (relevantWords.length === 0 && words) {
      const matchTokens = matchTrimmed
        .toLowerCase()
        .split(/[\s@.\-_:=]/)
        .filter(t => t.length >= 3);

      for (const w of words) {
        const wt = (w.text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (wt.length < 2) continue;

        for (const token of matchTokens) {
          const tokenClean = token.replace(/[^a-z0-9]/g, '');
          if (tokenClean.length >= 3 && (wt.includes(tokenClean) || tokenClean.includes(wt))) {
            relevantWords.push(w);
            break;
          }
        }

        const matchStart = matchTrimmed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
        if (matchStart.length >= 4 && wt.includes(matchStart)) {
          if (!relevantWords.includes(w)) relevantWords.push(w);
        }
      }
    }

    if (relevantWords.length > 0) {
      const bboxes = relevantWords.map(w => w.bbox).filter(Boolean);
      if (bboxes.length > 0) {
        const minX = Math.min(...bboxes.map(b => b.x0));
        const minY = Math.min(...bboxes.map(b => b.y0));
        const maxX = Math.max(...bboxes.map(b => b.x1));
        const maxY = Math.max(...bboxes.map(b => b.y1));
        return {
          x: Math.max(0, minX - 6),
          y: Math.max(0, minY - 4),
          w: maxX - minX + 12,
          h: maxY - minY + 8
        };
      }
    }

    // 3. Fallback to line matching
    if (lines && lines.length > 0) {
      const cleanMatch = matchTrimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const l of lines) {
        const lt = (l.text || '').toLowerCase();
        const cleanLt = lt.replace(/[^a-z0-9]/g, '');
        if ((cleanMatch.length >= 4 && cleanLt.includes(cleanMatch)) || (isSymbolic && /[•●·*]{3,}/.test(lt))) {
          const b = l.bbox;
          if (b) {
            return {
              x: Math.max(0, b.x0 - 4),
              y: Math.max(0, b.y0 - 3),
              w: b.x1 - b.x0 + 8,
              h: b.y1 - b.y0 + 6
            };
          }
        }
      }
    }

    return null;
  }

  // ── Pattern scan on extracted text ────────────────────────────────────
  function scanText(text, words, lines, enabledTypes) {
    const findings = [];
    const seen = new Set();

    function addFinding(type, label, matchText, color, subLabel, bbox) {
      const key = `${type}::${matchText}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({
        id: generateId(),
        type,
        label: label + (subLabel ? ` (${subLabel})` : ''),
        text: matchText,
        color,
        bbox,
        blurred: false,
      });
    }

    // Password & Secrets
    if (enabledTypes.password) {
      const p = PATTERNS.password;
      for (const pat of p.patterns) {
        const rx = new RegExp(pat.regex.source, pat.regex.flags);
        let m;
        while ((m = rx.exec(text)) !== null) {
          const rawMatch = m[0].trim();
          // If regex has capture group (e.g. value after password: ), blur that value
          const targetText = (m[1] && m[1].length >= 2) ? m[1].trim() : rawMatch;
          const bbox = findBboxForMatch(targetText, words, lines, text) || findBboxForMatch(rawMatch, words, lines, text);
          addFinding('password', 'Password', targetText, p.color, pat.name, bbox);
        }
      }
    }

    // Email
    if (enabledTypes.email) {
      const rx = new RegExp(PATTERNS.email.regex.source, PATTERNS.email.regex.flags);
      let m;
      while ((m = rx.exec(text)) !== null) {
        const bbox = findBboxForMatch(m[0], words, lines, text);
        addFinding('email', 'Email', m[0], PATTERNS.email.color, null, bbox);
      }
    }

    // Phone
    if (enabledTypes.phone) {
      const p = PATTERNS.phone;
      const rx = new RegExp(p.regex.source, p.regex.flags);
      let m;
      while ((m = rx.exec(text)) !== null) {
        const s = m[0].trim();
        if (!p.validate(s)) continue;
        const bbox = findBboxForMatch(s, words, lines, text);
        addFinding('phone', 'Phone', s, p.color, null, bbox);
      }
    }

    // Sensitive IDs
    if (enabledTypes.id) {
      for (const pat of PATTERNS.id.patterns) {
        const rx = new RegExp(pat.regex.source, pat.regex.flags);
        let m;
        while ((m = rx.exec(text)) !== null) {
          const bbox = findBboxForMatch(m[0], words, lines, text);
          addFinding('id', 'ID', m[0], PATTERNS.id.color, pat.name, bbox);
        }
      }
    }

    // Crypto
    if (enabledTypes.crypto) {
      for (const pat of PATTERNS.crypto.patterns) {
        const rx = new RegExp(pat.regex.source, pat.regex.flags);
        let m;
        while ((m = rx.exec(text)) !== null) {
          const bbox = findBboxForMatch(m[0], words, lines, text);
          addFinding('crypto', 'Crypto', m[0], PATTERNS.crypto.color, pat.name, bbox);
        }
      }
    }

    // IP
    if (enabledTypes.ip) {
      for (const pat of PATTERNS.ip.patterns) {
        const rx = new RegExp(pat.regex.source, pat.regex.flags);
        let m;
        while ((m = rx.exec(text)) !== null) {
          if (m[0] === '0.0.0.0' || m[0] === '127.0.0.1') continue;
          const bbox = findBboxForMatch(m[0], words, lines, text);
          addFinding('ip', 'IP Address', m[0], PATTERNS.ip.color, pat.name, bbox);
        }
      }
    }

    return findings;
  }

  // ── Password Form Field & UI Layout Detector ─────────────────────────
  function detectPasswordFormFields(imageData, ocrData, existingFindings) {
    const findings = [];
    const words = ocrData.words || [];
    const lines = ocrData.lines || [];
    if (words.length === 0 && lines.length === 0) return findings;

    const LABEL_REGEX = /\b(passwords?|passcodes?|passphrases?|pins?|secret\s*key|auth\s*code|credentials?|master\s*password)\b/i;

    // Helper to test if a box overlaps an already found finding
    function overlapsExisting(bbox) {
      const allFindings = [...existingFindings, ...findings];
      for (const f of allFindings) {
        if (!f.bbox) continue;
        const b = f.bbox;
        const xOverlap = Math.max(0, Math.min(bbox.x + bbox.w, b.x + b.w) - Math.max(bbox.x, b.x));
        const yOverlap = Math.max(0, Math.min(bbox.y + bbox.h, b.y + b.h) - Math.max(bbox.y, b.y));
        const overlapArea = xOverlap * yOverlap;
        const minArea = Math.min(bbox.w * bbox.h, b.w * b.h);
        if (minArea > 0 && overlapArea / minArea > 0.45) return true;
      }
      return false;
    }

    // Find all words matching password labels
    const labelItems = [];
    for (const w of words) {
      if (LABEL_REGEX.test(w.text || '')) {
        labelItems.push({ text: w.text, bbox: w.bbox });
      }
    }
    // Also check lines if multi-word label (e.g. "Confirm Password")
    for (const l of lines) {
      if (LABEL_REGEX.test(l.text || '') && !labelItems.some(item => Math.abs(item.bbox.y0 - l.bbox.y0) < 5)) {
        labelItems.push({ text: l.text, bbox: l.bbox });
      }
    }

    for (const item of labelItems) {
      const lb = item.bbox;
      const labelW = lb.x1 - lb.x0;
      const labelH = lb.y1 - lb.y0;
      const labelMidY = (lb.y0 + lb.y1) / 2;

      // 1. Check for words to the RIGHT on the same line
      const rightWords = words.filter(w => {
        if (w === item || (w.bbox.x0 === lb.x0 && w.bbox.y0 === lb.y0)) return false;
        const wMidY = (w.bbox.y0 + w.bbox.y1) / 2;
        return (
          w.bbox.x0 >= lb.x1 - 4 &&
          w.bbox.x0 <= lb.x1 + 380 &&
          Math.abs(wMidY - labelMidY) <= Math.max(16, labelH * 1.1)
        );
      });

      if (rightWords.length > 0) {
        const minX = Math.min(...rightWords.map(w => w.bbox.x0));
        const minY = Math.min(...rightWords.map(w => w.bbox.y0));
        const maxX = Math.max(...rightWords.map(w => w.bbox.x1));
        const maxY = Math.max(...rightWords.map(w => w.bbox.y1));
        const bbox = {
          x: Math.max(0, minX - 8),
          y: Math.max(0, minY - 6),
          w: Math.min(imageData.width - minX + 8, (maxX - minX) + 16),
          h: (maxY - minY) + 12
        };

        if (!overlapsExisting(bbox)) {
          findings.push({
            id: generateId(),
            type: 'password',
            label: 'Password Field',
            text: rightWords.map(w => w.text).join(' '),
            color: '#f43f5e',
            bbox,
            blurred: false,
          });
          continue;
        }
      }

      // 2. Check for words directly BELOW the label (vertical form layout)
      const belowWords = words.filter(w => {
        if (w === item || (w.bbox.x0 === lb.x0 && w.bbox.y0 === lb.y0)) return false;
        return (
          w.bbox.y0 >= lb.y1 - 2 &&
          w.bbox.y0 <= lb.y1 + Math.max(50, labelH * 3.5) &&
          Math.abs(w.bbox.x0 - lb.x0) <= Math.max(150, labelW * 2)
        );
      });

      if (belowWords.length > 0) {
        const minX = Math.min(...belowWords.map(w => w.bbox.x0));
        const minY = Math.min(...belowWords.map(w => w.bbox.y0));
        const maxX = Math.max(...belowWords.map(w => w.bbox.x1));
        const maxY = Math.max(...belowWords.map(w => w.bbox.y1));
        const bbox = {
          x: Math.max(0, minX - 8),
          y: Math.max(0, minY - 6),
          w: Math.min(imageData.width - minX + 8, (maxX - minX) + 16),
          h: (maxY - minY) + 12
        };

        if (!overlapsExisting(bbox)) {
          findings.push({
            id: generateId(),
            type: 'password',
            label: 'Password Field',
            text: belowWords.map(w => w.text).join(' '),
            color: '#f43f5e',
            bbox,
            blurred: false,
          });
          continue;
        }
      }

      // 3. If no words found, suggest the input field region directly adjacent/below
      // Try horizontal layout first if room exists
      const hasRoomRight = lb.x1 + 120 < imageData.width;
      let fieldBbox;

      if (hasRoomRight && (item.text.includes(':') || labelW < 140)) {
        // Horizontal input box next to label
        const boxW = Math.min(240, imageData.width - lb.x1 - 10);
        const boxH = Math.max(28, Math.round(labelH + 10));
        fieldBbox = {
          x: lb.x1 + 6,
          y: Math.max(0, Math.round(labelMidY - boxH / 2)),
          w: boxW,
          h: boxH
        };
      } else {
        // Vertical input box below label
        const boxW = Math.min(280, Math.max(180, imageData.width - lb.x0 - 20));
        const boxH = Math.max(32, Math.round(labelH * 1.8));
        fieldBbox = {
          x: Math.max(0, lb.x0),
          y: Math.min(imageData.height - boxH, lb.y1 + 4),
          w: boxW,
          h: boxH
        };
      }

      if (fieldBbox && !overlapsExisting(fieldBbox)) {
        findings.push({
          id: generateId(),
          type: 'password',
          label: 'Password Field',
          text: `[Input near ${item.text.trim()}]`,
          color: '#f43f5e',
          bbox: fieldBbox,
          blurred: false,
        });
      }
    }

    return findings;
  }

  // ── Computer Vision: Visual Masked Password Dots Detector ─────────────
  function detectVisualMaskedDots(imageData, existingFindings) {
    const findings = [];
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    if (width < 40 || height < 20) return findings;

    // Luminance helper
    function getLum(x, y) {
      const idx = (y * width + x) * 4;
      return (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
    }

    function overlapsAny(bx, by, bw, bh) {
      const all = [...existingFindings, ...findings];
      for (const f of all) {
        if (!f.bbox) continue;
        const b = f.bbox;
        if (
          bx < b.x + b.w &&
          bx + bw > b.x &&
          by < b.y + b.h &&
          by + bh > b.y
        ) return true;
      }
      return false;
    }

    // Scan horizontal lines sampling every 4px vertically
    const stepY = 4;
    const seenY = new Set();

    for (let y = 15; y < height - 15; y += stepY) {
      let runDots = [];
      let inDot = false;
      let dotStart = 0;
      let bgLum = getLum(10, y);

      for (let x = 8; x < width - 8; x++) {
        const lum = getLum(x, y);
        // Look for contrast against local background
        const isContrast = Math.abs(lum - bgLum) > 35;

        if (isContrast && !inDot) {
          inDot = true;
          dotStart = x;
        } else if (!isContrast && inDot) {
          inDot = false;
          const dotWidth = x - dotStart;
          // Valid dot glyphs are 3px to 14px wide
          if (dotWidth >= 3 && dotWidth <= 14) {
            runDots.push({ start: dotStart, end: x, width: dotWidth });
          } else if (dotWidth > 18) {
            // Long block, reset sequence
            if (runDots.length >= 4) break;
            runDots = [];
          }
        }
        // Update background tracker if long consistent stretch
        if (!inDot && (x % 30 === 0)) {
          bgLum = lum;
        }
      }

      // Check if we found 4+ dots with consistent width and spacing
      if (runDots.length >= 4) {
        const gaps = [];
        for (let i = 0; i < runDots.length - 1; i++) {
          gaps.push(runDots[i + 1].start - runDots[i].end);
        }

        // Are gaps regular? (between 3px and 22px, variation within 5px)
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const validGaps = avgGap >= 2 && avgGap <= 24 && gaps.every(g => Math.abs(g - avgGap) <= 6);

        if (validGaps) {
          const firstDot = runDots[0];
          const lastDot = runDots[runDots.length - 1];
          const totalW = (lastDot.end - firstDot.start) + 20;
          const boxX = Math.max(0, firstDot.start - 10);
          const boxY = Math.max(0, y - 14);
          const boxH = 28;

          // Check if already captured near this Y
          const yKey = Math.round(boxY / 20);
          if (!seenY.has(yKey) && !overlapsAny(boxX, boxY, totalW, boxH)) {
            seenY.add(yKey);
            findings.push({
              id: generateId(),
              type: 'password',
              label: 'Password (Masked)',
              text: '•'.repeat(runDots.length),
              color: '#f43f5e',
              bbox: {
                x: boxX,
                y: boxY,
                w: Math.min(width - boxX, totalW),
                h: Math.min(height - boxY, boxH)
              },
              blurred: false,
            });
          }
        }
      }
    }

    return findings;
  }

  // ── Main scan entry point ─────────────────────────────────────────────
  async function scan(imageData, dataURL, enabledTypes, progressCb) {
    const results = [];
    const cb = progressCb || (() => {});

    // Step 1: QR detection (instant, no async)
    if (enabledTypes.qr) {
      cb(5, 'Scanning QR codes…');
      const qrResults = detectQRCodes(imageData);
      results.push(...qrResults);
      cb(15, `Found ${qrResults.length} QR code(s)`);
    }

    // Step 2: OCR via main process
    cb(20, 'Starting OCR (this may take a moment)…');
    let ocrData = { text: '', words: [], lines: [] };
    try {
      ocrData = await runOCR(dataURL, (p, msg) => cb(p, msg));
    } catch (e) {
      console.warn('OCR failed, proceeding without text:', e);
    }

    // Step 3: Pattern detection on extracted text
    cb(80, 'Analyzing sensitive patterns…');
    const textFindings = scanText(ocrData.text, ocrData.words, ocrData.lines, enabledTypes);
    results.push(...textFindings);

    // Step 4: Password field detection & Visual dot scanner
    if (enabledTypes.password) {
      cb(90, 'Detecting password fields & masks…');
      // A. Form layout detection (detecting input fields near "Password", "Passcode", "PIN")
      const formFieldFindings = detectPasswordFormFields(imageData, ocrData, results);
      results.push(...formFieldFindings);

      // B. Computer vision masked dots detection (independent of OCR)
      const visualDotFindings = detectVisualMaskedDots(imageData, results);
      results.push(...visualDotFindings);
    }

    cb(100, `Done — ${results.length} sensitive item(s) detected`);
    return results;
  }

  function generateId() {
    return Math.random().toString(36).slice(2, 10);
  }

  return { scan, PATTERNS };
})();
