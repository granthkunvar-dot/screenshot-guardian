/**
 * renderer.js — Main UI controller for Screenshot Guardian
 * Handles: Image loading, canvas rendering, blur application, UI interactions
 */

(async () => {

  // ── State ─────────────────────────────────────────────────────────────
  const state = {
    imageFile: null,         // { path, base64, mimeType, name, size }
    imageBitmap: null,       // ImageBitmap
    findings: [],            // array of finding objects
    blurRegions: [],         // manually drawn blur regions
    history: [],             // undo history stack
    zoom: 1.0,
    blurStyle: 'pixelate',  // pixelate | blackbar | blur
    enabledTypes: { password: true, email: true, phone: true, qr: true, id: true, crypto: true, ip: true },
    drawing: false,
    drawStart: null,
    drawRect: null,
    scanning: false,
    ocrInitialized: false,
  };

  // ── DOM ───────────────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => document.querySelectorAll(sel);

  const dropzone       = $('#dropzone');
  const analysisView   = $('#analysis-view');
  const mainCanvas     = $('#main-canvas');
  const overlayCanvas  = $('#overlay-canvas');
  const ctx            = mainCanvas.getContext('2d');
  const octx           = overlayCanvas.getContext('2d');
  const canvasWrap     = $('#canvas-wrap');
  const findingsList   = $('#findings-list');
  const noFindingsMsg  = $('#no-findings-msg');
  const riskFill       = $('#risk-fill');
  const riskLabel      = $('#risk-label');
  const findingCounts  = $('#finding-counts');
  const progressBar    = $('#progress-bar');
  const progressText   = $('#progress-text');
  const scanProgress   = $('#scan-progress');
  const zoomLevelEl    = $('#zoom-level');
  const fileInfoEl     = $('#file-info');
  const loadingOverlay = $('#loading-overlay');
  const loadingText    = $('#loading-text');

  // ── Window Controls ────────────────────────────────────────────────────
  $('#btn-minimize').addEventListener('click', () => window.electronAPI.windowMinimize());
  $('#btn-maximize').addEventListener('click', () => window.electronAPI.windowMaximize());
  $('#btn-close').addEventListener('click',    () => window.electronAPI.windowClose());

  // ── Toggle switches ───────────────────────────────────────────────────
  $all('.toggle-switch').forEach(sw => {
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = sw.dataset.key;
      state.enabledTypes[key] = !state.enabledTypes[key];
      sw.classList.toggle('active', state.enabledTypes[key]);
    });
  });

  // ── Blur style selector ───────────────────────────────────────────────
  $all('.blur-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.blur-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.blurStyle = btn.dataset.blur;
    });
  });

  // ── Inbuilt Screenshot Snip triggers ──────────────────────────────────
  const triggerSnip = () => window.electronAPI.triggerSnip();
  const snipBtn1 = $('#btn-snip-screen');
  const snipBtn2 = $('#btn-title-snip');
  const snipBtn3 = $('#btn-toolbar-snip');
  if (snipBtn1) snipBtn1.addEventListener('click', triggerSnip);
  if (snipBtn2) snipBtn2.addEventListener('click', triggerSnip);
  if (snipBtn3) snipBtn3.addEventListener('click', triggerSnip);

  // Receive captured screenshot from main process / snipper
  window.electronAPI.onScreenshotLoaded(async (file) => {
    await loadImage(file);
    showToast('📸 Screenshot captured & loaded', 'success');
  });

  // ── Load image: file dialog ───────────────────────────────────────────
  $('#btn-open-file').addEventListener('click', openFile);
  async function openFile() {
    const file = await window.electronAPI.openFileDialog();
    if (file) await loadImage(file);
  }

  // ── Load image: clipboard ─────────────────────────────────────────────
  $('#btn-paste-clipboard').addEventListener('click', pasteClipboard);
  async function pasteClipboard() {
    const file = await window.electronAPI.readClipboardImage();
    if (file) {
      await loadImage(file);
    } else {
      showToast('No image in clipboard', 'error');
    }
  }

  // ── Global Keyboard Shortcuts ─────────────────────────────────────────
  document.addEventListener('keydown', async (e) => {
    // Ctrl+V: Paste image from clipboard
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      await pasteClipboard();
    }
    // Ctrl+C: Copy safe blurred screenshot to clipboard
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !window.getSelection().toString()) {
      e.preventDefault();
      await copyBlurredToClipboard();
    }
    // Ctrl+Z: Undo last blur
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoLastBlur();
    }
    // Ctrl+S: Save safe image
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveSafeCopy();
    }
  });

  // ── Drag & drop ───────────────────────────────────────────────────────
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = ev.target.result.split(',')[1];
        await loadImage({ path: file.path, base64, mimeType: file.type, name: file.name, size: file.size });
      };
      reader.readAsDataURL(file);
    }
  });

  // ── New scan button ───────────────────────────────────────────────────
  $('#btn-new-scan').addEventListener('click', resetToDropzone);
  function resetToDropzone() {
    state.imageFile = null;
    state.imageBitmap = null;
    state.findings = [];
    state.blurRegions = [];
    dropzone.classList.remove('hidden');
    analysisView.classList.add('hidden');
    findingsList.innerHTML = '';
    findingsList.appendChild(noFindingsMsg);
    noFindingsMsg.classList.remove('hidden');
    updateRiskMeter();
  }

  // ── Load & render image ───────────────────────────────────────────────
  async function loadImage(file) {
    state.imageFile = file;
    state.findings = [];
    state.blurRegions = [];

    // Show analysis view
    dropzone.classList.add('hidden');
    analysisView.classList.remove('hidden');

    const dataURL = `data:${file.mimeType};base64,${file.base64}`;
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = dataURL;
    });

    state.imageBitmap = await createImageBitmap(img);

    // Set canvas sizes
    mainCanvas.width  = img.width;
    mainCanvas.height = img.height;
    overlayCanvas.width  = img.width;
    overlayCanvas.height = img.height;

    // Update canvas wrap size
    setZoom(fitZoom(img.width, img.height));

    // Draw base image
    ctx.drawImage(img, 0, 0);

    // File info
    const kb = (file.size / 1024).toFixed(1);
    fileInfoEl.textContent = `${file.name}  •  ${img.width}×${img.height}  •  ${kb} KB`;

    // Reset findings panel
    findingsList.innerHTML = '';
    findingsList.appendChild(noFindingsMsg);
    noFindingsMsg.classList.remove('hidden');
    updateRiskMeter();

    // Warm up OCR in background
    showLoading('Initializing scanner…');
    try {
      const iData = ctx.getImageData(0, 0, img.width, img.height);
      await runScan(iData, dataURL);
    } finally {
      hideLoading();
    }
  }

  // ── Run detection scan ────────────────────────────────────────────────
  async function runScan(imageData, dataURL) {
    if (state.scanning) return;
    state.scanning = true;

    scanProgress.classList.remove('hidden');
    setProgress(0, 'Starting…');

    try {
      const results = await Scanner.scan(
        imageData,
        dataURL,
        { ...state.enabledTypes },
        (pct, msg) => {
          setProgress(pct, msg);
          loadingText.textContent = msg;
        }
      );

      state.findings = results;
      renderFindings();
      drawOverlay();
      updateRiskMeter();

      if (results.length === 0) {
        showToast('✅ No sensitive data detected', 'success');
      } else {
        showToast(`⚠️ Found ${results.length} sensitive item${results.length > 1 ? 's' : ''}`, results.length > 3 ? 'error' : 'info');
      }
    } catch (e) {
      console.error('Scan failed:', e);
      showToast('Scan failed: ' + e.message, 'error');
    } finally {
      state.scanning = false;
      scanProgress.classList.add('hidden');
    }
  }

  // ── Render findings list ──────────────────────────────────────────────
  function renderFindings() {
    findingsList.innerHTML = '';
    if (state.findings.length === 0) {
      findingsList.appendChild(noFindingsMsg);
      noFindingsMsg.classList.remove('hidden');
      return;
    }

    noFindingsMsg.classList.add('hidden');

    state.findings.forEach((f, idx) => {
      const card = document.createElement('div');
      card.className = 'finding-card' + (f.blurred ? ' blurred' : '');
      card.id = `finding-${f.id}`;
      card.innerHTML = `
        <div class="finding-card-top">
          <span class="finding-type-badge" style="background:${hexToRgba(f.color, 0.15)};color:${f.color}">${f.label}</span>
          <span class="finding-text" title="${escapeHtml(f.text)}">${escapeHtml(truncate(f.text, 28))}</span>
        </div>
        <div class="finding-card-actions">
          <button class="finding-action-btn" data-action="goto" data-id="${f.id}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Locate
          </button>
          ${!f.blurred ? `<button class="finding-action-btn danger" data-action="blur" data-id="${f.id}">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" stroke-dasharray="3 3"/></svg>
            Blur
          </button>` : `<span style="font-size:11px;color:var(--green);padding:4px 8px">✓ Blurred</span>`}
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) {
          const action = e.target.closest('[data-action]').dataset.action;
          const id     = e.target.closest('[data-action]').dataset.id;
          const finding = state.findings.find(x => x.id === id);
          if (!finding) return;
          if (action === 'blur') applyBlurToFinding(finding);
          if (action === 'goto') scrollToFinding(finding);
        } else {
          scrollToFinding(state.findings.find(x => x.id === f.id));
        }
      });

      findingsList.appendChild(card);
    });
  }

  // ── Draw overlay boxes on canvas ──────────────────────────────────────
  function drawOverlay() {
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    state.findings.forEach(f => {
      if (!f.bbox || f.blurred) return;
      const b = f.bbox;

      // Glow
      octx.shadowColor = f.color;
      octx.shadowBlur = 12;

      octx.strokeStyle = f.color;
      octx.lineWidth = 2;
      octx.strokeRect(b.x, b.y, b.w, b.h);

      // Label chip
      octx.shadowBlur = 0;
      octx.fillStyle = hexToRgba(f.color, 0.85);
      const labelText = f.label;
      octx.font = 'bold 10px Inter, sans-serif';
      const tw = octx.measureText(labelText).width;
      const lx = b.x;
      const ly = b.y - 18 > 0 ? b.y - 18 : b.y + b.h + 2;
      octx.fillRect(lx, ly, tw + 10, 16);
      octx.fillStyle = '#000';
      octx.fillText(labelText, lx + 5, ly + 11);

      // Semi fill
      octx.fillStyle = hexToRgba(f.color, 0.07);
      octx.fillRect(b.x, b.y, b.w, b.h);
    });

    // Draw manual blur regions (as redacted boxes)
    state.blurRegions.forEach(r => {
      octx.fillStyle = 'rgba(30,35,48,0.6)';
      octx.strokeStyle = 'rgba(255,255,255,0.1)';
      octx.lineWidth = 1;
      octx.fillRect(r.x, r.y, r.w, r.h);
      octx.strokeRect(r.x, r.y, r.w, r.h);
    });

    // Current draw rect
    if (state.drawing && state.drawRect) {
      const r = state.drawRect;
      octx.strokeStyle = '#a78bfa';
      octx.lineWidth = 1.5;
      octx.setLineDash([4, 4]);
      octx.strokeRect(r.x, r.y, r.w, r.h);
      octx.setLineDash([]);
      octx.fillStyle = 'rgba(167,139,250,0.1)';
      octx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  // ── Canvas mouse drawing (manual blur regions) ────────────────────────
  overlayCanvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const pt = canvasPoint(e);
    state.drawing = true;
    state.drawStart = pt;
    state.drawRect = { x: pt.x, y: pt.y, w: 0, h: 0 };
  });

  overlayCanvas.addEventListener('mousemove', (e) => {
    if (!state.drawing) return;
    const pt = canvasPoint(e);
    const sx = state.drawStart.x;
    const sy = state.drawStart.y;
    state.drawRect = {
      x: Math.min(sx, pt.x),
      y: Math.min(sy, pt.y),
      w: Math.abs(pt.x - sx),
      h: Math.abs(pt.y - sy),
    };
    drawOverlay();
  });

  overlayCanvas.addEventListener('mouseup', (e) => {
    if (!state.drawing) return;
    state.drawing = false;
    const r = state.drawRect;
    if (r && r.w > 5 && r.h > 5) {
      pushHistory();
      applyBlurToRegion(r);
      state.blurRegions.push(r);
    }
    state.drawRect = null;
    drawOverlay();
  });

  function canvasPoint(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width  / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  // ── Apply blur to a bbox region on main canvas ─────────────────────────
  function applyBlurToRegion(bbox, style) {
    const s = style || state.blurStyle;
    const { x, y, w, h } = bbox;
    if (w < 2 || h < 2) return;

    if (s === 'blackbar') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, w, h);
    } else if (s === 'pixelate') {
      pixelateRegion(ctx, x, y, w, h, 10);
    } else if (s === 'blur') {
      gaussianBlurRegion(ctx, x, y, w, h, 12);
    }
  }

  function pixelateRegion(ctx, x, y, w, h, blockSize) {
    x = Math.floor(x); y = Math.floor(y);
    w = Math.ceil(w);  h = Math.ceil(h);

    const imgData = ctx.getImageData(x, y, w, h);
    const d = imgData.data;

    for (let bx = 0; bx < w; bx += blockSize) {
      for (let by = 0; by < h; by += blockSize) {
        const bw = Math.min(blockSize, w - bx);
        const bh = Math.min(blockSize, h - by);
        // Average color
        let r = 0, g = 0, b = 0, a = 0, count = 0;
        for (let px = bx; px < bx + bw; px++) {
          for (let py = by; py < by + bh; py++) {
            const i = (py * w + px) * 4;
            r += d[i]; g += d[i+1]; b += d[i+2]; a += d[i+3];
            count++;
          }
        }
        r = Math.round(r/count); g = Math.round(g/count);
        b = Math.round(b/count); a = Math.round(a/count);
        // Fill block
        for (let px = bx; px < bx + bw; px++) {
          for (let py = by; py < by + bh; py++) {
            const i = (py * w + px) * 4;
            d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = a;
          }
        }
      }
    }
    ctx.putImageData(imgData, x, y);
  }

  function gaussianBlurRegion(ctx, x, y, w, h, radius) {
    x = Math.floor(x); y = Math.floor(y);
    w = Math.ceil(w);  h = Math.ceil(h);

    // Simple box blur approximation
    const passes = 3;
    const imgData = ctx.getImageData(x, y, w, h);
    for (let p = 0; p < passes; p++) {
      boxBlur(imgData.data, w, h, Math.floor(radius / 2));
    }
    ctx.putImageData(imgData, x, y);
  }

  function boxBlur(data, w, h, r) {
    const temp = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rr = 0, g = 0, b = 0, count = 0;
        for (let ky = -r; ky <= r; ky++) {
          for (let kx = -r; kx <= r; kx++) {
            const nx = Math.min(w - 1, Math.max(0, x + kx));
            const ny = Math.min(h - 1, Math.max(0, y + ky));
            const i = (ny * w + nx) * 4;
            rr += temp[i]; g += temp[i+1]; b += temp[i+2];
            count++;
          }
        }
        const i = (y * w + x) * 4;
        data[i] = rr/count; data[i+1] = g/count; data[i+2] = b/count;
      }
    }
  }

  // ── Undo & History ────────────────────────────────────────────────────
  function pushHistory() {
    if (!mainCanvas.width || !mainCanvas.height) return;
    const imgData = ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
    state.history.push({
      imageData: imgData,
      findings: JSON.parse(JSON.stringify(state.findings)),
      blurRegions: JSON.parse(JSON.stringify(state.blurRegions)),
    });
    if (state.history.length > 25) state.history.shift();
  }

  function undoLastBlur() {
    if (state.history.length === 0) {
      showToast('Nothing to undo', 'info');
      return;
    }
    const prev = state.history.pop();
    ctx.putImageData(prev.imageData, 0, 0);
    state.findings = prev.findings;
    state.blurRegions = prev.blurRegions;
    drawOverlay();
    renderFindings();
    updateRiskMeter();
    showToast('Undid last blur', 'info');
  }

  const undoBtn = $('#btn-undo-blur');
  if (undoBtn) undoBtn.addEventListener('click', undoLastBlur);

  // ── Copy blurred screenshot to clipboard ──────────────────────────────
  async function copyBlurredToClipboard() {
    if (!state.imageFile) {
      showToast('No image loaded', 'info');
      return;
    }
    const combined = document.createElement('canvas');
    combined.width  = mainCanvas.width;
    combined.height = mainCanvas.height;
    const cctx = combined.getContext('2d');
    cctx.drawImage(mainCanvas, 0, 0);

    const base64 = combined.toDataURL('image/png').split(',')[1];
    const result = await window.electronAPI.copyToClipboard({ base64 });
    if (result && result.success) {
      showToast('✅ Copied safe screenshot to clipboard!', 'success');
    } else {
      showToast('Failed to copy to clipboard', 'error');
    }
  }

  const copyBtn = $('#btn-copy-clipboard');
  if (copyBtn) copyBtn.addEventListener('click', copyBlurredToClipboard);

  // ── Apply blur to a finding ───────────────────────────────────────────
  function applyBlurToFinding(finding) {
    if (!finding.bbox) {
      showToast('No position data — draw a region manually on canvas', 'info');
      return;
    }
    pushHistory();
    applyBlurToRegion(finding.bbox);
    finding.blurred = true;
    drawOverlay();
    renderFindings();
    updateRiskMeter();
    showToast(`${finding.label} blurred`, 'success');
  }

  // ── Auto-blur all findings ────────────────────────────────────────────
  $('#btn-auto-blur').addEventListener('click', autoBlurAll);
  const blurAllBtn = $('#btn-blur-all-findings');
  if (blurAllBtn) blurAllBtn.addEventListener('click', autoBlurAll);

  function autoBlurAll() {
    const toBlur = state.findings.filter(f => !f.blurred && f.bbox);
    if (toBlur.length === 0) {
      showToast('No regions to blur', 'info');
      return;
    }
    pushHistory();
    let count = 0;
    toBlur.forEach(f => {
      applyBlurToRegion(f.bbox);
      f.blurred = true;
      count++;
    });
    drawOverlay();
    renderFindings();
    updateRiskMeter();
    showToast(`Blurred ${count} sensitive region${count > 1 ? 's' : ''}`, 'success');
  }

  // ── Save blurred image ────────────────────────────────────────────────
  async function saveSafeCopy() {
    if (!state.imageFile) return;
    const combined = document.createElement('canvas');
    combined.width  = mainCanvas.width;
    combined.height = mainCanvas.height;
    const cctx = combined.getContext('2d');
    cctx.drawImage(mainCanvas, 0, 0);

    const base64 = combined.toDataURL('image/png').split(',')[1];
    const result = await window.electronAPI.saveBlurredImage({
      base64,
      originalPath: state.imageFile.path,
    });
    if (result.success) {
      showToast('Saved: ' + result.filePath.split('\\').pop(), 'success');
    }
  }

  $('#btn-save').addEventListener('click', saveSafeCopy);

  // ── Zoom controls ─────────────────────────────────────────────────────
  $('#btn-zoom-in').addEventListener('click',    () => setZoom(state.zoom * 1.2));
  $('#btn-zoom-out').addEventListener('click',   () => setZoom(state.zoom / 1.2));
  $('#btn-zoom-reset').addEventListener('click', () => {
    if (state.imageBitmap) {
      setZoom(fitZoom(mainCanvas.width, mainCanvas.height));
    }
  });

  function setZoom(z) {
    state.zoom = Math.max(0.1, Math.min(5, z));
    const scaled = state.zoom;
    const w = mainCanvas.width  * scaled;
    const h = mainCanvas.height * scaled;
    mainCanvas.style.width  = w + 'px';
    mainCanvas.style.height = h + 'px';
    overlayCanvas.style.width  = w + 'px';
    overlayCanvas.style.height = h + 'px';
    canvasWrap.style.minWidth  = (w + 40) + 'px';
    canvasWrap.style.minHeight = (h + 40) + 'px';
    zoomLevelEl.textContent = Math.round(state.zoom * 100) + '%';
  }

  function fitZoom(iw, ih) {
    const wrapW = canvasWrap.clientWidth  - 40;
    const wrapH = canvasWrap.clientHeight - 40;
    return Math.min(1, wrapW / iw, wrapH / ih);
  }

  // ── Risk Meter ────────────────────────────────────────────────────────
  function updateRiskMeter() {
    const total = state.findings.length;
    const unblurred = state.findings.filter(f => !f.blurred).length;
    const pct = total === 0 ? 0 : (unblurred / Math.max(total, 5)) * 100;

    riskFill.style.width = pct + '%';

    const level = unblurred === 0 && total === 0
      ? 'No image'
      : unblurred === 0
        ? '✅ All clear'
        : unblurred <= 2
          ? `⚠️ ${unblurred} unblurred`
          : `🔴 ${unblurred} sensitive items`;
    riskLabel.textContent = level;

    // Count badges
    const typeCounts = {};
    state.findings.filter(f => !f.blurred).forEach(f => {
      typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
    });

    const typeLabels = { password: 'Passwords', email: 'Emails', phone: 'Phones', qr: 'QR Codes', id: 'IDs', crypto: 'Crypto', ip: 'IPs' };
    findingCounts.innerHTML = Object.entries(typeCounts)
      .map(([type, count]) => `
        <div class="count-item">
          <span class="count-label">${typeLabels[type] || type}</span>
          <span class="count-badge badge-${type}">${count}</span>
        </div>
      `).join('');
  }

  // ── Progress helpers ───────────────────────────────────────────────────
  function setProgress(pct, msg) {
    progressBar.style.width = pct + '%';
    progressText.textContent = msg;
  }

  // ── Loading overlay ────────────────────────────────────────────────────
  function showLoading(msg) {
    loadingText.textContent = msg || 'Loading…';
    loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    loadingOverlay.classList.add('hidden');
  }

  // ── Toast notifications ───────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const icons = {
      success: `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg>`,
      error:   `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      info:    `<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="#38bdf8"/></svg>`,
    };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  }

  // ── Utility ────────────────────────────────────────────────────────────
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  // ── Pre-warm OCR silently ──────────────────────────────────────────────
  // (Tesseract will load lazily on first scan)

})();
