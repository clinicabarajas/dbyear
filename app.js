(function () {
  'use strict';

  var FREQS = [250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
  var PTA_FREQS = [500, 1000, 2000, 4000];
  var STORAGE_KEY = 'dbyear.vault.v1';
  var DEFAULT_SETTINGS = {
    minAudiograms: 4,
    minYears: 2,
    meaningfulChange4y: 5,
    maxRmse: 5
  };
  var CATEGORIES = {
    stable: { name: 'Estable consistente', color: '#26795b', short: 'Estable' },
    uncertain: { name: 'Tendencia progresiva no confirmada', color: '#a66308', short: 'No confirmada' },
    progress: { name: 'Progresión sostenida', color: '#cf3848', short: 'Progresión' },
    variable: { name: 'Trayectoria variable o no lineal', color: '#7651b5', short: 'Variable' },
    insufficient: { name: 'Evidencia insuficiente', color: '#7a8799', short: 'Insuficiente' }
  };

  var state = {
    data: null,
    key: null,
    salt: null,
    demo: false,
    selectedId: null,
    importData: null,
    toastTimer: null,
    lockTimer: null
  };

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function uid(prefix) {
    if (window.crypto && crypto.randomUUID) return (prefix || 'id') + '-' + crypto.randomUUID();
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function isNum(value) { return typeof value === 'number' && Number.isFinite(value); }
  function round(value, digits) {
    if (!isNum(value)) return null;
    var p = Math.pow(10, digits == null ? 1 : digits);
    return Math.round(value * p) / p;
  }
  function fmt(value, digits) {
    if (!isNum(value)) return '—';
    return value.toLocaleString('es-ES', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }
  function fmtSigned(value, digits) {
    if (!isNum(value)) return '—';
    return (value > 0 ? '+' : '') + fmt(value, digits == null ? 1 : digits);
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function parseIsoDate(value) {
    if (!value) return null;
    var d = new Date(value + (String(value).length === 10 ? 'T12:00:00' : ''));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function formatDate(value, style) {
    var d = parseIsoDate(value);
    if (!d) return '—';
    return d.toLocaleDateString('es-ES', style === 'short'
      ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function yearsBetween(a, b) {
    var da = parseIsoDate(a), db = parseIsoDate(b);
    if (!da || !db) return 0;
    return (db.getTime() - da.getTime()) / (365.2425 * 86400000);
  }
  function initials(patient) {
    var source = patient.name || patient.code || 'P';
    var parts = source.trim().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)).toUpperCase();
  }
  function todayIso() {
    var d = new Date();
    var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }
  function emptyData() {
    return { version: 1, settings: Object.assign({}, DEFAULT_SETTINGS), patients: [], lastPatientId: null, createdAt: new Date().toISOString() };
  }

  function demoData() {
    function ear(values) {
      var out = {};
      FREQS.forEach(function (f, i) { out[f] = values[i]; });
      return out;
    }
    var rows = [
      ['2018-02-12', [25, 30, 30, 35, 35, 35, 40, 40, 45, 50], [20, 25, 25, 30, 30, 30, 35, 35, 40, 45]],
      ['2020-03-02', [25, 35, 35, 40, 40, 40, 45, 40, 50, 55], [20, 25, 25, 30, 30, 30, 35, 35, 40, 45]],
      ['2022-02-21', [30, 35, 40, 40, 45, 45, 50, 50, 55, 60], [20, 25, 30, 30, 35, 30, 35, 40, 40, 45]],
      ['2024-02-19', [30, 40, 40, 45, 45, 45, 55, 55, 60, 65], [20, 25, 25, 30, 30, 30, 35, 35, 40, 45]],
      ['2026-02-16', [35, 45, 45, 50, 50, 50, 60, 55, 65, 70], [20, 25, 25, 30, 35, 35, 35, 35, 45, 45]]
    ];
    var patient = {
      id: 'demo-patient',
      code: 'DEMO-001',
      name: 'Caso de ejemplo',
      dob: '1954-03-14',
      notes: 'Serie ficticia para explorar la aplicación.',
      audiograms: rows.map(function (r, i) {
        return { id: 'demo-aud-' + i, date: r[0], od: ear(r[1]), oi: ear(r[2]), transducer: 'TDH-39', notes: '' };
      })
    };
    return { version: 1, settings: Object.assign({}, DEFAULT_SETTINGS), patients: [patient], lastPatientId: patient.id, createdAt: new Date().toISOString() };
  }

  function bytesToBase64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }
  function base64ToBytes(value) {
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  async function deriveKey(password, salt) {
    var material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 310000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  async function persist() {
    if (state.demo || !state.key || !state.data) return;
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var plain = new TextEncoder().encode(JSON.stringify(state.data));
    var cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, state.key, plain);
    var payload = {
      format: 'dbyear-vault',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000 },
      cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) },
      salt: bytesToBase64(state.salt),
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
  async function unlockVault(password) {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('No existe un almacén local.');
    var payload = JSON.parse(raw);
    if (payload.format !== 'dbyear-vault' || !payload.cipher || !payload.salt) throw new Error('El almacén no tiene un formato válido.');
    var salt = base64ToBytes(payload.salt);
    var key = await deriveKey(password, salt);
    var plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(payload.cipher.iv) },
      key,
      base64ToBytes(payload.cipher.data)
    );
    var data = JSON.parse(new TextDecoder().decode(plain));
    data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    data.patients = Array.isArray(data.patients) ? data.patients : [];
    state.key = key;
    state.salt = salt;
    state.data = data;
    state.demo = false;
    state.selectedId = data.lastPatientId || (data.patients[0] && data.patients[0].id) || null;
  }

  function resetLockTimer() {
    clearTimeout(state.lockTimer);
    if (!state.data || state.demo) return;
    state.lockTimer = setTimeout(function () { lockApp(true); }, 30 * 60 * 1000);
  }
  function lockApp(auto) {
    clearTimeout(state.lockTimer);
    state.key = null;
    state.salt = null;
    state.data = null;
    state.selectedId = null;
    state.importData = null;
    $('#app').classList.add('hidden');
    $('#gate').classList.remove('hidden');
    if (state.demo) {
      state.demo = false;
      showGate('initial');
    } else {
      showGate(localStorage.getItem(STORAGE_KEY) ? 'unlock' : 'initial');
      if (auto) $('#unlock-error').textContent = 'La sesión se bloqueó tras 30 minutos de inactividad.';
    }
  }

  function showGate(mode) {
    ['#unlock-form', '#setup-form', '#gate-initial'].forEach(function (id) { $(id).classList.add('hidden'); });
    if (mode === 'unlock') {
      $('#unlock-form').classList.remove('hidden');
      setTimeout(function () { $('#unlock-pass').focus(); }, 30);
    } else if (mode === 'setup') {
      $('#setup-form').classList.remove('hidden');
      setTimeout(function () { $('#setup-pass').focus(); }, 30);
    } else {
      $('#gate-initial').classList.remove('hidden');
    }
  }
  function enterApp() {
    $('#gate').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#storage-badge').textContent = state.demo ? 'Modo de ejemplo · no guardado' : 'Almacén cifrado';
    $('#backup-btn').disabled = state.demo;
    renderAll();
    resetLockTimer();
  }
  function toast(message, error) {
    var el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', !!error);
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  function selectedPatient() {
    if (!state.data) return null;
    return state.data.patients.find(function (p) { return p.id === state.selectedId; }) || null;
  }
  function patientFollowup(patient) {
    if (!patient || !patient.audiograms.length) return 0;
    var sorted = patient.audiograms.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    return yearsBetween(sorted[0].date, sorted[sorted.length - 1].date);
  }
  function renderAll() {
    renderPatients();
    var patient = selectedPatient();
    $('#empty-state').classList.toggle('hidden', !!patient);
    $('#patient-view').classList.toggle('hidden', !patient);
    if (patient) renderPatient(patient);
  }
  function renderPatients() {
    var list = $('#patient-list');
    var query = ($('#patient-search').value || '').trim().toLowerCase();
    var patients = state.data.patients.slice().sort(function (a, b) {
      return (a.code || '').localeCompare(b.code || '', 'es', { numeric: true });
    }).filter(function (p) {
      return !query || (p.code || '').toLowerCase().includes(query) || (p.name || '').toLowerCase().includes(query);
    });
    if (!patients.length) {
      list.innerHTML = '<p class="muted" style="padding:.8rem;font-size:.82rem">' + (query ? 'No hay coincidencias.' : 'Todavía no hay pacientes.') + '</p>';
      return;
    }
    list.innerHTML = patients.map(function (p) {
      return '<button class="patient-item ' + (p.id === state.selectedId ? 'active' : '') + '" data-patient="' + escapeHtml(p.id) + '" type="button">' +
        '<span class="patient-avatar">' + escapeHtml(initials(p)) + '</span>' +
        '<span class="patient-copy"><strong>' + escapeHtml(p.code) + '</strong><small>' + escapeHtml(p.name || 'Sin nombre') + '</small></span>' +
        '<span class="patient-count">' + p.audiograms.length + ' aud.</span></button>';
    }).join('');
    $$('.patient-item', list).forEach(function (button) {
      button.addEventListener('click', function () {
        state.selectedId = button.dataset.patient;
        state.data.lastPatientId = state.selectedId;
        persist();
        renderAll();
        $('#patient-sidebar').classList.remove('open');
      });
    });
  }

  function ageAt(date, dob) {
    var d = parseIsoDate(date), b = parseIsoDate(dob);
    if (!d || !b) return null;
    return (d.getTime() - b.getTime()) / (365.2425 * 86400000);
  }
  function renderPatient(patient) {
    var ordered = patient.audiograms.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var analysis = analysePatient(patient);
    $('#patient-title').textContent = (patient.code || 'Sin código') + (patient.name ? ' · ' + patient.name : '');
    var subtitle = ordered.length + (ordered.length === 1 ? ' audiograma' : ' audiogramas');
    if (ordered.length > 1) subtitle += ' · ' + fmt(patientFollowup(patient), 1) + ' años de seguimiento';
    if (patient.dob && ordered.length) {
      var age = ageAt(ordered[ordered.length - 1].date, patient.dob);
      if (isNum(age)) subtitle += ' · ' + fmt(age, 0) + ' años en la última prueba';
    }
    $('#patient-subtitle').textContent = subtitle;
    var enoughBoth = analysis.od.sufficient && analysis.oi.sufficient;
    var enoughOne = analysis.od.sufficient || analysis.oi.sufficient;
    var evidencePill = $('#evidence-pill');
    evidencePill.textContent = enoughBoth ? 'Evidencia suficiente' : enoughOne ? 'Evidencia parcial' : 'Evidencia insuficiente';
    evidencePill.className = 'pill ' + (enoughBoth ? 'sufficient' : 'insufficient');
    renderQuality(analysis);
    renderClassification(analysis);
    $('#clinical-conclusion').textContent = clinicalConclusion(patient, analysis);
    renderAudiogramChart(patient);
    renderPtaChart(analysis);
    renderChronoChart(analysis);
    renderHistory(patient, analysis);
    renderDataTable(patient);
    renderCriteria();
  }

  function thresholdValue(value) {
    var n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
    return Number.isFinite(n) && n >= -10 && n <= 130 ? n : null;
  }
  function pta4(ear) {
    if (!ear) return null;
    var values = PTA_FREQS.map(function (f) { return thresholdValue(ear[f]); }).filter(isNum);
    if (values.length < 3) return null;
    return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  }
  function tCritical95(df) {
    var table = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
      2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074,
      2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
    if (df <= 0) return null;
    if (df <= 30) return table[df];
    if (df <= 40) return 2.021;
    if (df <= 60) return 2.000;
    if (df <= 120) return 1.980;
    return 1.960;
  }
  function regression(points) {
    var clean = points.filter(function (p) { return isNum(p.x) && isNum(p.y); });
    var n = clean.length;
    if (n < 2) return { n: n, slope: null, intercept: null, r2: null, rmse: null, ciLow: null, ciHigh: null, points: clean };
    var mx = clean.reduce(function (s, p) { return s + p.x; }, 0) / n;
    var my = clean.reduce(function (s, p) { return s + p.y; }, 0) / n;
    var sxx = clean.reduce(function (s, p) { return s + Math.pow(p.x - mx, 2); }, 0);
    var sxy = clean.reduce(function (s, p) { return s + (p.x - mx) * (p.y - my); }, 0);
    if (sxx === 0) return { n: n, slope: null, intercept: my, r2: null, rmse: null, ciLow: null, ciHigh: null, points: clean };
    var slope = sxy / sxx;
    var intercept = my - slope * mx;
    var residuals = clean.map(function (p) { return p.y - (intercept + slope * p.x); });
    var sse = residuals.reduce(function (s, e) { return s + e * e; }, 0);
    var sst = clean.reduce(function (s, p) { return s + Math.pow(p.y - my, 2); }, 0);
    var r2 = sst === 0 ? 1 : 1 - sse / sst;
    var rmse = Math.sqrt(sse / n);
    var seSlope = n > 2 ? Math.sqrt((sse / (n - 2)) / sxx) : null;
    var t = n > 2 ? tCritical95(n - 2) : null;
    return {
      n: n, slope: slope, intercept: intercept, r2: r2, rmse: rmse,
      ciLow: isNum(seSlope) && isNum(t) ? slope - t * seSlope : null,
      ciHigh: isNum(seSlope) && isNum(t) ? slope + t * seSlope : null,
      points: clean, residuals: residuals
    };
  }
  function earAnalysis(patient, earName) {
    var ordered = patient.audiograms.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var valid = ordered.map(function (a) { return { date: a.date, y: pta4(a[earName]), source: a }; }).filter(function (p) { return isNum(p.y); });
    var first = valid[0] ? valid[0].date : null;
    var points = valid.map(function (p) { return { x: yearsBetween(first, p.date), y: p.y, date: p.date, source: p.source }; });
    var reg = regression(points);
    var followup = valid.length > 1 ? yearsBetween(valid[0].date, valid[valid.length - 1].date) : 0;
    var perFrequency = {};
    FREQS.forEach(function (frequency) {
      var rows = ordered.map(function (a) {
        return { date: a.date, value: thresholdValue(a[earName] && a[earName][frequency]) };
      }).filter(function (r) { return isNum(r.value); });
      var base = rows[0] ? rows[0].date : null;
      perFrequency[frequency] = regression(rows.map(function (r) { return { x: yearsBetween(base, r.date), y: r.value, date: r.date }; }));
    });
    var settings = state.data.settings;
    var sufficient = reg.n >= settings.minAudiograms && followup >= settings.minYears;
    var predicted4 = isNum(reg.slope) ? reg.slope * 4 : null;
    var ci4Low = isNum(reg.ciLow) ? reg.ciLow * 4 : null;
    var ci4High = isNum(reg.ciHigh) ? reg.ciHigh * 4 : null;
    var category = 'insufficient';
    var reason = 'La serie no alcanza el número de medidas o el tiempo mínimo configurado.';
    if (sufficient) {
      var variable = isNum(reg.rmse) && reg.rmse > settings.maxRmse;
      var apparentImprovement = isNum(predicted4) && predicted4 <= -settings.meaningfulChange4y;
      var stable = isNum(ci4Low) && isNum(ci4High) &&
        ci4Low >= -settings.meaningfulChange4y && ci4High <= settings.meaningfulChange4y &&
        reg.rmse <= settings.maxRmse;
      var progress = isNum(predicted4) && predicted4 >= settings.meaningfulChange4y &&
        isNum(ci4Low) && ci4Low > 0 && reg.rmse <= settings.maxRmse;
      if (variable || apparentImprovement) {
        category = 'variable';
        reason = variable
          ? 'La variabilidad respecto a la recta de tendencia supera el límite configurado.'
          : 'Aparece una mejoría aparente clínicamente relevante; conviene revisar condiciones y comparabilidad.';
      } else if (stable) {
        category = 'stable';
        reason = 'Todo el IC95% del cambio a cuatro años queda dentro del margen clínico configurado.';
      } else if (progress) {
        category = 'progress';
        reason = 'El cambio previsto supera el margen clínico, con IC95% compatible con empeoramiento.';
      } else {
        category = 'uncertain';
        reason = 'La serie no demuestra ni estabilidad equivalente ni una progresión sostenida con precisión suficiente.';
      }
    }
    return {
      ear: earName, valid: valid, points: points, reg: reg, followup: followup,
      perFrequency: perFrequency, sufficient: sufficient, predicted4: predicted4,
      ci4Low: ci4Low, ci4High: ci4High, category: category, reason: reason
    };
  }
  function analysePatient(patient) {
    return { od: earAnalysis(patient, 'od'), oi: earAnalysis(patient, 'oi') };
  }

  function renderQuality(analysis) {
    var el = $('#quality-banner');
    var settings = state.data.settings;
    var messages = [];
    ['od', 'oi'].forEach(function (ear) {
      var a = analysis[ear];
      if (!a.sufficient) {
        var missing = [];
        if (a.reg.n < settings.minAudiograms) missing.push((settings.minAudiograms - a.reg.n) + ' medida(s)');
        if (a.followup < settings.minYears) missing.push(fmt(settings.minYears - a.followup, 1) + ' año(s)');
        messages.push(ear.toUpperCase() + ': faltan ' + missing.join(' y '));
      }
    });
    if (!messages.length) {
      el.className = 'quality-banner';
      el.innerHTML = '<strong>Serie clasificable.</strong> Ambos oídos alcanzan el mínimo de ' + settings.minAudiograms + ' audiogramas y ' + fmt(settings.minYears, 1) + ' años.';
    } else {
      el.className = 'quality-banner warning';
      el.innerHTML = '<strong>Calidad de evidencia limitada.</strong> ' + escapeHtml(messages.join(' · ')) + '. Los indicadores se muestran, pero la categoría queda pendiente donde corresponda.';
    }
  }
  function metricHtml(label, value, detail) {
    return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong>' + (detail ? '<strong class="ci-copy">' + detail + '</strong>' : '') + '</div>';
  }
  function renderClassification(analysis) {
    $('#classification-cards').innerHTML = ['od', 'oi'].map(function (ear) {
      var a = analysis[ear], cat = CATEGORIES[a.category];
      var ci = isNum(a.reg.ciLow) && isNum(a.reg.ciHigh) ? 'IC95% ' + fmtSigned(a.reg.ciLow, 1) + ' a ' + fmtSigned(a.reg.ciHigh, 1) : 'IC no estimable';
      return '<article class="classification-card" style="--cat-color:' + cat.color + '">' +
        '<div class="classification-head"><div class="ear-label"><span class="ear-symbol ' + ear + '">' + ear.toUpperCase() + '</span> Oído ' + (ear === 'od' ? 'derecho' : 'izquierdo') + '</div><span class="category-badge">' + cat.short + '</span></div>' +
        '<h3 class="category-name">' + cat.name + '</h3><p class="category-reason">' + escapeHtml(a.reason) + '</p>' +
        '<div class="metric-grid">' +
        metricHtml('Serie', a.reg.n + ' aud.', fmt(a.followup, 1) + ' años') +
        metricHtml('Pendiente', fmtSigned(a.reg.slope, 2) + ' dB/año', ci) +
        metricHtml('Cambio 4 años', fmtSigned(a.predicted4, 1) + ' dB', isNum(a.ci4Low) ? 'IC95% ' + fmtSigned(a.ci4Low, 1) + ' a ' + fmtSigned(a.ci4High, 1) : '') +
        metricHtml('Variabilidad', fmt(a.reg.rmse, 1) + ' dB', 'R² ' + fmt(a.reg.r2, 2)) +
        '</div></article>';
    }).join('');
  }
  function clinicalConclusion(patient, analysis) {
    function phrase(a, label) {
      if (!a.sufficient) return 'En el ' + label + ' la evidencia es insuficiente para asignar una trayectoria: se dispone de ' + a.reg.n + ' medidas durante ' + fmt(a.followup, 1) + ' años.';
      var cat = CATEGORIES[a.category].name.toLowerCase();
      var text = 'En el ' + label + ' la serie se clasifica como ' + cat + ', con una pendiente de ' + fmtSigned(a.reg.slope, 2) + ' dB/año';
      if (isNum(a.reg.ciLow)) text += ' (IC95%: ' + fmtSigned(a.reg.ciLow, 2) + ' a ' + fmtSigned(a.reg.ciHigh, 2) + ')';
      text += ', un cambio previsto a cuatro años de ' + fmtSigned(a.predicted4, 1) + ' dB y un RMSE de ' + fmt(a.reg.rmse, 1) + ' dB.';
      return text;
    }
    return phrase(analysis.od, 'oído derecho') + ' ' + phrase(analysis.oi, 'oído izquierdo') +
      ' La clasificación debe interpretarse junto con la historia clínica, la comparabilidad de los procedimientos y los umbrales por frecuencia.';
  }

  function chartEmpty(message) { return '<div class="chart-empty">' + escapeHtml(message) + '</div>'; }
  function svgWrap(width, height, content, label) {
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(label) + '" xmlns="http://www.w3.org/2000/svg">' + content + '</svg>';
  }
  function polylinePoints(points) {
    return points.map(function (p) { return round(p.x, 1) + ',' + round(p.y, 1); }).join(' ');
  }
  function renderAudiogramChart(patient) {
    var container = $('#audiogram-chart');
    var rows = patient.audiograms.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (!rows.length) { container.innerHTML = chartEmpty('Añada al menos un audiograma para mostrar el histórico.'); return; }
    var w = 980, h = 365, m = { l: 55, r: 24, t: 34, b: 48 };
    var pw = w - m.l - m.r, ph = h - m.t - m.b;
    function x(f) { return m.l + FREQS.indexOf(f) * pw / (FREQS.length - 1); }
    function y(db) { return m.t + (db + 10) / 140 * ph; }
    var parts = [];
    for (var db = -10; db <= 130; db += 10) {
      parts.push('<line class="svg-grid" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y(db) + '" y2="' + y(db) + '"/>');
      parts.push('<text class="svg-label" x="' + (m.l - 10) + '" y="' + (y(db) + 4) + '" text-anchor="end">' + db + '</text>');
    }
    FREQS.forEach(function (f) {
      parts.push('<line class="svg-grid" x1="' + x(f) + '" x2="' + x(f) + '" y1="' + m.t + '" y2="' + (h - m.b) + '"/>');
      parts.push('<text class="svg-label" x="' + x(f) + '" y="' + (h - 22) + '" text-anchor="middle">' + (f >= 1000 ? String(f / 1000).replace('.', ',') + 'k' : f) + '</text>');
    });
    parts.push('<text class="svg-title" x="15" y="17">dB HL</text><text class="svg-title" x="' + (w - 14) + '" y="' + (h - 8) + '" text-anchor="end">Frecuencia (Hz)</text>');
    rows.forEach(function (row, index) {
      var latest = index === rows.length - 1;
      var opacity = rows.length === 1 ? 1 : 0.22 + 0.68 * index / (rows.length - 1);
      ['od', 'oi'].forEach(function (ear) {
        var points = FREQS.map(function (f) {
          var value = thresholdValue(row[ear] && row[ear][f]);
          return isNum(value) ? { x: x(f), y: y(value), value: value, f: f } : null;
        }).filter(Boolean);
        if (points.length > 1) {
          parts.push('<polyline points="' + polylinePoints(points) + '" fill="none" stroke="' + (ear === 'od' ? '#cf3848' : '#2d64d7') + '" stroke-width="' + (latest ? 2.8 : 1.35) + '" opacity="' + opacity + '"><title>' + ear.toUpperCase() + ' · ' + formatDate(row.date, 'short') + '</title></polyline>');
        }
        points.forEach(function (p) {
          if (ear === 'od') {
            parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (latest ? 4.2 : 2.6) + '" fill="#fff" stroke="#cf3848" stroke-width="' + (latest ? 2.4 : 1.4) + '" opacity="' + opacity + '"><title>OD ' + p.f + ' Hz: ' + p.value + ' dB HL · ' + formatDate(row.date, 'short') + '</title></circle>');
          } else {
            var r = latest ? 4.2 : 2.8;
            parts.push('<path d="M' + (p.x - r) + ' ' + (p.y - r) + 'L' + (p.x + r) + ' ' + (p.y + r) + 'M' + (p.x + r) + ' ' + (p.y - r) + 'L' + (p.x - r) + ' ' + (p.y + r) + '" stroke="#2d64d7" stroke-width="' + (latest ? 2.4 : 1.4) + '" opacity="' + opacity + '"><title>OI ' + p.f + ' Hz: ' + p.value + ' dB HL · ' + formatDate(row.date, 'short') + '</title></path>');
          }
        });
      });
    });
    parts.push('<text class="svg-label" x="' + (w - m.r) + '" y="18" text-anchor="end">Último: ' + escapeHtml(formatDate(rows[rows.length - 1].date, 'short')) + '</text>');
    container.innerHTML = svgWrap(w, h, parts.join(''), 'Histórico de audiogramas superpuestos');
  }

  function renderPtaChart(analysis) {
    var container = $('#pta-chart');
    var all = analysis.od.points.concat(analysis.oi.points);
    if (!all.length) { container.innerHTML = chartEmpty('No hay suficientes frecuencias para calcular PTA4.'); return; }
    var dates = all.map(function (p) { return parseIsoDate(p.date).getTime(); });
    var minDate = Math.min.apply(null, dates), maxDate = Math.max.apply(null, dates);
    if (minDate === maxDate) { minDate -= 180 * 86400000; maxDate += 180 * 86400000; }
    var w = 600, h = 355, m = { l: 50, r: 20, t: 28, b: 44 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
    function x(date) { return m.l + (parseIsoDate(date).getTime() - minDate) / (maxDate - minDate) * pw; }
    function y(db) { return m.t + (db + 10) / 140 * ph; }
    var parts = [];
    for (var db = -10; db <= 130; db += 20) {
      parts.push('<line class="svg-grid" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y(db) + '" y2="' + y(db) + '"/><text class="svg-label" x="' + (m.l - 8) + '" y="' + (y(db) + 4) + '" text-anchor="end">' + db + '</text>');
    }
    var years = [];
    var startYear = new Date(minDate).getFullYear(), endYear = new Date(maxDate).getFullYear();
    for (var yr = startYear; yr <= endYear; yr += Math.max(1, Math.ceil((endYear - startYear + 1) / 6))) years.push(yr);
    years.forEach(function (yr) {
      var d = new Date(yr, 0, 1), xx = m.l + (d.getTime() - minDate) / (maxDate - minDate) * pw;
      if (xx >= m.l && xx <= w - m.r) parts.push('<text class="svg-label" x="' + xx + '" y="' + (h - 18) + '" text-anchor="middle">' + yr + '</text>');
    });
    ['od', 'oi'].forEach(function (ear) {
      var a = analysis[ear], color = ear === 'od' ? '#cf3848' : '#2d64d7';
      if (a.points.length > 1 && isNum(a.reg.slope)) {
        var first = a.points[0], last = a.points[a.points.length - 1];
        var y1 = a.reg.intercept + a.reg.slope * first.x, y2 = a.reg.intercept + a.reg.slope * last.x;
        parts.push('<line x1="' + x(first.date) + '" y1="' + y(y1) + '" x2="' + x(last.date) + '" y2="' + y(y2) + '" stroke="' + color + '" stroke-width="2.4" opacity=".82"/>');
      }
      a.points.forEach(function (p) {
        parts.push('<circle cx="' + x(p.date) + '" cy="' + y(p.y) + '" r="4.2" fill="#fff" stroke="' + color + '" stroke-width="2.2"><title>' + ear.toUpperCase() + ' PTA4 ' + fmt(p.y, 1) + ' dB HL · ' + formatDate(p.date, 'short') + '</title></circle>');
      });
    });
    parts.push('<text class="svg-title" x="12" y="17">PTA4 (dB HL)</text>');
    parts.push('<text class="svg-label" x="' + (w - m.r) + '" y="17" text-anchor="end">OD ' + fmtSigned(analysis.od.reg.slope, 2) + ' · OI ' + fmtSigned(analysis.oi.reg.slope, 2) + ' dB/año</text>');
    container.innerHTML = svgWrap(w, h, parts.join(''), 'Evolución del PTA4');
  }

  function renderChronoChart(analysis) {
    var container = $('#chrono-chart');
    var values = [];
    FREQS.forEach(function (f) {
      ['od', 'oi'].forEach(function (ear) {
        var value = analysis[ear].perFrequency[f].slope;
        if (isNum(value)) values.push(Math.abs(value));
      });
    });
    if (!values.length) { container.innerHTML = chartEmpty('Se necesitan al menos dos umbrales comparables por frecuencia.'); return; }
    var maxAbs = Math.max(2, Math.ceil(Math.max.apply(null, values)));
    var w = 600, h = 355, m = { l: 45, r: 18, t: 30, b: 48 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
    function y(v) { return m.t + (maxAbs - v) / (2 * maxAbs) * ph; }
    var zeroY = y(0), group = pw / FREQS.length, barW = Math.min(14, group * .26), parts = [];
    for (var tick = -maxAbs; tick <= maxAbs; tick++) {
      if (tick % Math.max(1, Math.ceil(maxAbs / 4)) !== 0 && tick !== 0) continue;
      parts.push('<line class="' + (tick === 0 ? 'svg-zero' : 'svg-grid') + '" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y(tick) + '" y2="' + y(tick) + '"/><text class="svg-label" x="' + (m.l - 7) + '" y="' + (y(tick) + 4) + '" text-anchor="end">' + fmtSigned(tick, 0) + '</text>');
    }
    FREQS.forEach(function (f, i) {
      var cx = m.l + group * (i + .5);
      [['od', -barW * .58, '#cf3848'], ['oi', barW * .58, '#2d64d7']].forEach(function (spec) {
        var a = analysis[spec[0]].perFrequency[f], v = a.slope;
        if (!isNum(v)) return;
        var top = Math.min(zeroY, y(v)), height = Math.max(1, Math.abs(y(v) - zeroY));
        parts.push('<rect x="' + (cx + spec[1] - barW / 2) + '" y="' + top + '" width="' + barW + '" height="' + height + '" rx="2" fill="' + spec[2] + '" opacity=".88"><title>' + spec[0].toUpperCase() + ' ' + f + ' Hz: ' + fmtSigned(v, 2) + ' dB/año</title></rect>');
      });
      parts.push('<text class="svg-label" x="' + cx + '" y="' + (h - 20) + '" text-anchor="middle">' + (f >= 1000 ? String(f / 1000).replace('.', ',') + 'k' : f) + '</text>');
    });
    parts.push('<text class="svg-title" x="10" y="17">dB/año</text><text class="svg-label" x="' + (w - m.r) + '" y="17" text-anchor="end">Valores positivos = empeoramiento</text>');
    container.innerHTML = svgWrap(w, h, parts.join(''), 'Cronoaudiograma por frecuencia');
  }

  function renderHistory(patient, analysis) {
    var rows = patient.audiograms.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var wrap = $('#history-cards');
    if (!rows.length) { wrap.innerHTML = chartEmpty('No hay audiogramas registrados.'); return; }
    wrap.innerHTML = rows.map(function (a, index) {
      var od = pta4(a.od), oi = pta4(a.oi);
      return '<div class="history-card"><div class="history-date"><strong>' + formatDate(a.date, 'short') + '</strong><span>' + (index === 0 ? 'Más reciente' : '') + '</span></div>' +
        '<div class="history-summary"><span>PTA4 OD <strong class="ear-od">' + fmt(od, 1) + ' dB HL</strong></span><span>PTA4 OI <strong class="ear-oi">' + fmt(oi, 1) + ' dB HL</strong></span>' +
        (a.transducer ? '<span>Transductor <strong>' + escapeHtml(a.transducer) + '</strong></span>' : '') + '</div>' +
        '<button class="btn ghost-dark compact edit-audiogram" data-audiogram="' + escapeHtml(a.id) + '" type="button">Editar</button></div>';
    }).join('');
    $$('.edit-audiogram', wrap).forEach(function (button) {
      button.addEventListener('click', function () { openAudiogramDialog(button.dataset.audiogram); });
    });
  }
  function renderDataTable(patient) {
    var rows = patient.audiograms.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (!rows.length) { $('#data-table-wrap').innerHTML = chartEmpty('No hay datos que mostrar.'); return; }
    var headFreqs = FREQS.map(function (f) { return '<th>' + (f >= 1000 ? String(f / 1000).replace('.', ',') + 'k' : f) + '</th>'; }).join('');
    var body = [];
    rows.forEach(function (a) {
      ['od', 'oi'].forEach(function (ear, i) {
        body.push('<tr><th>' + (i === 0 ? formatDate(a.date, 'short') : '') + '</th><td class="ear-' + ear + '">' + ear.toUpperCase() + '</td>' +
          FREQS.map(function (f) { var v = thresholdValue(a[ear] && a[ear][f]); return '<td>' + (isNum(v) ? v : '—') + '</td>'; }).join('') +
          '<td>' + fmt(pta4(a[ear]), 1) + '</td></tr>');
      });
    });
    $('#data-table-wrap').innerHTML = '<table class="data-table"><thead><tr><th>Fecha</th><th>Oído</th>' + headFreqs + '<th>PTA4</th></tr></thead><tbody>' + body.join('') + '</tbody></table>';
  }
  function renderCriteria() {
    var s = state.data.settings;
    $('#crit-min-n').value = s.minAudiograms;
    $('#crit-min-years').value = s.minYears;
    $('#crit-change').value = s.meaningfulChange4y;
    $('#crit-rmse').value = s.maxRmse;
  }

  function openPatientDialog(id) {
    var patient = id ? state.data.patients.find(function (p) { return p.id === id; }) : null;
    $('#patient-dialog-title').textContent = patient ? 'Editar paciente' : 'Nuevo paciente';
    $('#patient-id').value = patient ? patient.id : '';
    $('#patient-code').value = patient ? patient.code : '';
    $('#patient-name').value = patient ? patient.name || '' : '';
    $('#patient-dob').value = patient ? patient.dob || '' : '';
    $('#patient-notes').value = patient ? patient.notes || '' : '';
    $('#patient-form-error').textContent = '';
    $('#delete-patient').classList.toggle('hidden', !patient);
    $('#patient-dialog').showModal();
    setTimeout(function () { $('#patient-code').focus(); }, 40);
  }
  function savePatient(event) {
    event.preventDefault();
    var id = $('#patient-id').value;
    var code = $('#patient-code').value.trim();
    if (!code) { $('#patient-form-error').textContent = 'Introduzca un código de paciente.'; return; }
    var duplicate = state.data.patients.find(function (p) { return p.code.toLowerCase() === code.toLowerCase() && p.id !== id; });
    if (duplicate) { $('#patient-form-error').textContent = 'Ya existe un paciente con ese código.'; return; }
    var patient = id ? state.data.patients.find(function (p) { return p.id === id; }) : null;
    if (!patient) {
      patient = { id: uid('patient'), code: code, name: '', dob: '', notes: '', audiograms: [] };
      state.data.patients.push(patient);
    }
    patient.code = code;
    patient.name = $('#patient-name').value.trim();
    patient.dob = $('#patient-dob').value;
    patient.notes = $('#patient-notes').value.trim();
    state.selectedId = patient.id;
    state.data.lastPatientId = patient.id;
    persist();
    $('#patient-dialog').close();
    renderAll();
    toast(id ? 'Paciente actualizado.' : 'Paciente creado.');
  }
  function deletePatient() {
    var id = $('#patient-id').value;
    var patient = state.data.patients.find(function (p) { return p.id === id; });
    if (!patient) return;
    if (!confirm('¿Eliminar al paciente ' + patient.code + ' y todos sus audiogramas? Esta acción no se puede deshacer salvo mediante una copia de seguridad.')) return;
    state.data.patients = state.data.patients.filter(function (p) { return p.id !== id; });
    state.selectedId = state.data.patients[0] ? state.data.patients[0].id : null;
    state.data.lastPatientId = state.selectedId;
    persist();
    $('#patient-dialog').close();
    renderAll();
    toast('Paciente eliminado.');
  }

  function buildThresholdInputs() {
    $$('#threshold-table tbody tr').forEach(function (row) {
      var ear = row.dataset.ear;
      FREQS.forEach(function (frequency) {
        var td = document.createElement('td');
        var input = document.createElement('input');
        input.type = 'number';
        input.min = '-10'; input.max = '130'; input.step = '5';
        input.id = 'thr-' + ear + '-' + frequency;
        input.setAttribute('aria-label', ear.toUpperCase() + ' ' + frequency + ' Hz');
        td.appendChild(input);
        row.appendChild(td);
      });
    });
  }
  function openAudiogramDialog(id) {
    var patient = selectedPatient();
    if (!patient) { openPatientDialog(); return; }
    var a = id ? patient.audiograms.find(function (row) { return row.id === id; }) : null;
    $('#audiogram-dialog-title').textContent = a ? 'Editar audiograma' : 'Añadir audiograma';
    $('#audiogram-id').value = a ? a.id : '';
    $('#audiogram-date').value = a ? a.date : todayIso();
    $('#audiogram-transducer').value = a ? a.transducer || '' : '';
    $('#audiogram-notes').value = a ? a.notes || '' : '';
    ['od', 'oi'].forEach(function (ear) {
      FREQS.forEach(function (frequency) {
        var v = a ? thresholdValue(a[ear] && a[ear][frequency]) : null;
        $('#thr-' + ear + '-' + frequency).value = isNum(v) ? v : '';
      });
    });
    $('#audiogram-form-error').textContent = '';
    $('#delete-audiogram').classList.toggle('hidden', !a);
    $('#audiogram-dialog').showModal();
  }
  function saveAudiogram(event) {
    event.preventDefault();
    var patient = selectedPatient();
    if (!patient) return;
    var id = $('#audiogram-id').value, date = $('#audiogram-date').value;
    if (!date) { $('#audiogram-form-error').textContent = 'Seleccione la fecha de la prueba.'; return; }
    var duplicate = patient.audiograms.find(function (a) { return a.date === date && a.id !== id; });
    if (duplicate) { $('#audiogram-form-error').textContent = 'Ya existe un audiograma con esa fecha.'; return; }
    var a = id ? patient.audiograms.find(function (row) { return row.id === id; }) : null;
    if (!a) {
      a = { id: uid('aud'), date: date, od: {}, oi: {}, transducer: '', notes: '' };
      patient.audiograms.push(a);
    }
    a.date = date;
    a.transducer = $('#audiogram-transducer').value.trim();
    a.notes = $('#audiogram-notes').value.trim();
    ['od', 'oi'].forEach(function (ear) {
      a[ear] = {};
      FREQS.forEach(function (frequency) {
        var raw = $('#thr-' + ear + '-' + frequency).value;
        var value = raw === '' ? null : Number(raw);
        if (isNum(value)) a[ear][frequency] = value;
      });
    });
    var count = ['od', 'oi'].reduce(function (sum, ear) {
      return sum + FREQS.filter(function (f) { return isNum(thresholdValue(a[ear][f])); }).length;
    }, 0);
    if (!count) { $('#audiogram-form-error').textContent = 'Introduzca al menos un umbral.'; return; }
    patient.audiograms.sort(function (x, y) { return x.date.localeCompare(y.date); });
    persist();
    $('#audiogram-dialog').close();
    renderAll();
    toast(id ? 'Audiograma actualizado.' : 'Audiograma añadido.');
  }
  function deleteAudiogram() {
    var patient = selectedPatient(), id = $('#audiogram-id').value;
    if (!patient || !id) return;
    var a = patient.audiograms.find(function (row) { return row.id === id; });
    if (!a || !confirm('¿Eliminar el audiograma del ' + formatDate(a.date, 'short') + '?')) return;
    patient.audiograms = patient.audiograms.filter(function (row) { return row.id !== id; });
    persist();
    $('#audiogram-dialog').close();
    renderAll();
    toast('Audiograma eliminado.');
  }

  function detectDelimiter(line) {
    var candidates = [';', '\t', ','];
    var best = ';', count = -1;
    candidates.forEach(function (d) {
      var n = line.split(d).length;
      if (n > count) { count = n; best = d; }
    });
    return best;
  }
  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var delimiter = detectDelimiter(text.split(/\r?\n/)[0] || '');
    var rows = [], row = [], field = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i], next = text[i + 1];
      if (quoted) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else {
        if (c === '"') quoted = true;
        else if (c === delimiter) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    row.push(field.replace(/\r$/, ''));
    if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
    return rows;
  }
  function normalizeHeader(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function findHeader(headers, aliases) {
    var normalized = headers.map(normalizeHeader);
    for (var i = 0; i < aliases.length; i++) {
      var at = normalized.indexOf(normalizeHeader(aliases[i]));
      if (at >= 0) return at;
    }
    return -1;
  }
  function parseImportedDate(value) {
    var s = String(value || '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
      var iso = s.slice(0, 10).split('-').map(function (x, i) { return i ? x.padStart(2, '0') : x; }).join('-');
      return parseIsoDate(iso) ? iso : null;
    }
    var match = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (match) {
      var year = Number(match[3]); if (year < 100) year += year < 40 ? 2000 : 1900;
      var iso2 = year + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
      return parseIsoDate(iso2) ? iso2 : null;
    }
    var serial = Number(s.replace(',', '.'));
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      var d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return d.toISOString().slice(0, 10);
    }
    var parsed = new Date(s);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  function parseThreshold(value) {
    var s = String(value == null ? '' : value).trim().toUpperCase();
    if (!s || s === 'NA' || s === 'NR' || s === 'N/A' || s === '-') return null;
    var n = Number(s.replace(/[><=]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= -10 && n <= 130 ? n : null;
  }
  function mapCsvRows(rows) {
    if (rows.length < 2) throw new Error('El archivo no contiene filas de datos.');
    var headers = rows[0];
    var dateIdx = findHeader(headers, ['FECHA', 'DATE', 'FECHAAUDIO', 'FECHAAUDIOMETRIA']);
    if (dateIdx < 0) throw new Error('No se encuentra la columna FECHA.');
    var idIdx = findHeader(headers, ['NP', 'NUMEROPACIENTE', 'IDPACIENTE', 'PACIENTEID', 'ID']);
    if (idIdx < 0 && normalizeHeader(headers[0]) === '' && rows.slice(1, 8).some(function (row) { return String(row[0] || '').trim() !== ''; })) idIdx = 0;
    var nameIdx = findHeader(headers, ['NOMBRE', 'NOMBREPACIENTE', 'TEXTO']);
    var mappings = {};
    ['od', 'oi'].forEach(function (ear) {
      mappings[ear] = {};
      FREQS.forEach(function (f) {
        var k = f >= 1000 ? String(f / 1000).replace('.', ',') + 'K' : String(f);
        mappings[ear][f] = findHeader(headers, [
          'AUD' + f + ear.toUpperCase(), 'AUD' + k + ear.toUpperCase(),
          ear.toUpperCase() + f, ear.toUpperCase() + k,
          f + ear.toUpperCase(), k + ear.toUpperCase(),
          'AUD' + ear.toUpperCase() + f, 'AUD' + ear.toUpperCase() + k
        ]);
      });
    });
    var thresholdCols = 0;
    ['od', 'oi'].forEach(function (ear) { FREQS.forEach(function (f) { if (mappings[ear][f] >= 0) thresholdCols++; }); });
    if (!thresholdCols) throw new Error('No se encuentran columnas de umbrales AUD250OD…AUD8KOI.');
    if (idIdx < 0 && !selectedPatient()) throw new Error('El CSV no incluye NP/ID y no hay un paciente abierto al que asignar las filas.');
    var mapped = [], errors = [];
    rows.slice(1).forEach(function (row, index) {
      var date = parseImportedDate(row[dateIdx]);
      if (!date) { errors.push('Fila ' + (index + 2) + ': fecha no válida'); return; }
      var selected = selectedPatient();
      var code = idIdx >= 0 ? String(row[idIdx] || '').trim() : (selected && selected.code);
      if (!code && selected) code = selected.code;
      if (!code) { errors.push('Fila ' + (index + 2) + ': sin NP/ID'); return; }
      var item = { code: code, name: nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '', date: date, od: {}, oi: {} };
      var count = 0;
      ['od', 'oi'].forEach(function (ear) {
        FREQS.forEach(function (f) {
          var idx = mappings[ear][f];
          var value = idx >= 0 ? parseThreshold(row[idx]) : null;
          if (isNum(value)) { item[ear][f] = value; count++; }
        });
      });
      if (!count) { errors.push('Fila ' + (index + 2) + ': sin umbrales válidos'); return; }
      mapped.push(item);
    });
    if (!mapped.length) throw new Error(errors[0] || 'No se ha encontrado ninguna fila válida.');
    return { rows: mapped, errors: errors, thresholdCols: thresholdCols };
  }
  async function handleCsvFile(file) {
    $('#import-error').textContent = '';
    $('#import-preview').classList.add('hidden');
    $('#confirm-import').disabled = true;
    try {
      var text = await file.text();
      state.importData = mapCsvRows(parseCsv(text));
      var codes = Array.from(new Set(state.importData.rows.map(function (r) { return r.code; })));
      var preview = $('#import-preview');
      preview.innerHTML = '<strong>' + state.importData.rows.length + ' audiogramas válidos</strong><span>' + codes.length + ' paciente(s) · ' + state.importData.thresholdCols + ' columnas de umbral reconocidas' +
        (state.importData.errors.length ? ' · ' + state.importData.errors.length + ' filas omitidas' : '') + '</span>';
      preview.classList.remove('hidden');
      $('#confirm-import').disabled = false;
    } catch (error) {
      state.importData = null;
      $('#import-error').textContent = error.message || 'No se pudo leer el archivo.';
    }
  }
  function confirmImport(event) {
    event.preventDefault();
    if (!state.importData) return;
    var touched = new Set(), added = 0, updated = 0;
    state.importData.rows.forEach(function (row) {
      var patient = state.data.patients.find(function (p) { return (p.code || '').toLowerCase() === row.code.toLowerCase(); });
      if (!patient) {
        patient = { id: uid('patient'), code: row.code, name: row.name || '', dob: '', notes: '', audiograms: [] };
        state.data.patients.push(patient);
      } else if (!patient.name && row.name) patient.name = row.name;
      var a = patient.audiograms.find(function (x) { return x.date === row.date; });
      if (!a) {
        a = { id: uid('aud'), date: row.date, od: {}, oi: {}, transducer: '', notes: 'Importado desde CSV' };
        patient.audiograms.push(a); added++;
      } else updated++;
      a.od = Object.assign({}, a.od || {}, row.od);
      a.oi = Object.assign({}, a.oi || {}, row.oi);
      patient.audiograms.sort(function (x, y) { return x.date.localeCompare(y.date); });
      touched.add(patient.id);
      state.selectedId = patient.id;
    });
    state.data.lastPatientId = state.selectedId;
    persist();
    $('#import-dialog').close();
    state.importData = null;
    $('#csv-file').value = '';
    renderAll();
    toast('Importación completada: ' + added + ' añadidos y ' + updated + ' actualizados.');
  }

  function csvCell(value) {
    var s = String(value == null ? '' : value);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportPatientCsv() {
    var patient = selectedPatient();
    if (!patient) return;
    var headers = ['NP', 'NOMBRE', 'FECHA'].concat(FREQS.map(function (f) { return 'AUD' + f + 'OD'; }), FREQS.map(function (f) { return 'AUD' + f + 'OI'; }));
    var lines = [headers.join(';')];
    patient.audiograms.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (a) {
      var row = [patient.code, patient.name || '', a.date];
      ['od', 'oi'].forEach(function (ear) {
        FREQS.forEach(function (f) {
          var v = thresholdValue(a[ear] && a[ear][f]);
          row.push(isNum(v) ? v : '');
        });
      });
      lines.push(row.map(csvCell).join(';'));
    });
    download(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'dBYEAR_' + safeFilename(patient.code) + '.csv');
  }
  function safeFilename(value) { return String(value || 'paciente').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, ''); }
  function download(blob, filename) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function exportBackup() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { toast('No hay un almacén cifrado que exportar.', true); return; }
    download(new Blob([raw], { type: 'application/json' }), 'dBYEAR_copia_' + todayIso() + '.dbyear');
    toast('Copia cifrada descargada.');
  }
  async function restoreBackupFile(file) {
    try {
      var text = await file.text(), payload = JSON.parse(text);
      if (payload.format !== 'dbyear-vault' || !payload.salt || !payload.cipher || !payload.cipher.data) throw new Error('La copia no tiene un formato dBYEAR válido.');
      if (localStorage.getItem(STORAGE_KEY) && !confirm('La copia sustituirá el almacén local actual. ¿Continuar?')) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      state.key = null; state.data = null; state.demo = false;
      $('#app').classList.add('hidden'); $('#gate').classList.remove('hidden');
      $('#unlock-pass').value = ''; $('#unlock-error').textContent = '';
      showGate('unlock');
      toast('Copia restaurada. Introduzca su contraseña.');
    } catch (error) { toast(error.message || 'No se pudo restaurar la copia.', true); }
  }

  function openImport() {
    state.importData = null;
    $('#csv-file').value = '';
    $('#import-error').textContent = '';
    $('#import-preview').classList.add('hidden');
    $('#confirm-import').disabled = true;
    $('#import-dialog').showModal();
  }
  function switchTab(name) {
    $$('.tab').forEach(function (tab) { tab.classList.toggle('active', tab.dataset.tab === name); });
    $$('.tab-panel').forEach(function (panel) { panel.classList.add('hidden'); });
    $('#tab-' + name).classList.remove('hidden');
  }
  function copyConclusion() {
    var text = $('#clinical-conclusion').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Conclusión copiada.'); }).catch(function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select();
    document.execCommand('copy'); area.remove(); toast('Conclusión copiada.');
  }
  function saveCriteria(event) {
    event.preventDefault();
    var next = {
      minAudiograms: Number($('#crit-min-n').value),
      minYears: Number($('#crit-min-years').value),
      meaningfulChange4y: Number($('#crit-change').value),
      maxRmse: Number($('#crit-rmse').value)
    };
    if (next.minAudiograms < 3 || next.minYears <= 0 || next.meaningfulChange4y <= 0 || next.maxRmse <= 0) {
      toast('Revise los criterios introducidos.', true); return;
    }
    state.data.settings = next;
    persist(); renderAll(); switchTab('criteria'); toast('Criterios actualizados.');
  }
  function resetCriteria() {
    if (!confirm('¿Restablecer los criterios clínicos iniciales?')) return;
    state.data.settings = Object.assign({}, DEFAULT_SETTINGS);
    persist(); renderAll(); switchTab('criteria'); toast('Criterios restablecidos.');
  }

  function bindEvents() {
    $('#start-setup').addEventListener('click', function () { showGate('setup'); });
    $('#start-demo').addEventListener('click', function () {
      state.demo = true; state.data = demoData(); state.selectedId = state.data.lastPatientId; enterApp();
    });
    $('#setup-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var pass = $('#setup-pass').value, confirmPass = $('#setup-confirm').value;
      $('#setup-error').textContent = '';
      if (!window.crypto || !crypto.subtle) { $('#setup-error').textContent = 'Este navegador no admite el cifrado requerido.'; return; }
      if (pass.length < 10) { $('#setup-error').textContent = 'La contraseña debe tener al menos 10 caracteres.'; return; }
      if (pass !== confirmPass) { $('#setup-error').textContent = 'Las contraseñas no coinciden.'; return; }
      try {
        state.salt = crypto.getRandomValues(new Uint8Array(16));
        state.key = await deriveKey(pass, state.salt);
        state.data = emptyData(); state.demo = false; state.selectedId = null;
        await persist();
        $('#setup-pass').value = ''; $('#setup-confirm').value = '';
        enterApp();
      } catch (error) { $('#setup-error').textContent = 'No se pudo crear el almacén seguro.'; }
    });
    $('#unlock-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      $('#unlock-error').textContent = '';
      try {
        await unlockVault($('#unlock-pass').value);
        $('#unlock-pass').value = '';
        enterApp();
      } catch (error) { $('#unlock-error').textContent = 'Contraseña incorrecta o almacén dañado.'; }
    });
    $$('.password-toggle').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = $('#' + button.dataset.target);
        input.type = input.type === 'password' ? 'text' : 'password';
        button.textContent = input.type === 'password' ? 'Ver' : 'Ocultar';
      });
    });
    $('#reset-vault').addEventListener('click', function () {
      if (!confirm('¿Borrar definitivamente el almacén cifrado de este navegador? Antes, descargue una copia si la necesita.')) return;
      localStorage.removeItem(STORAGE_KEY); location.reload();
    });
    ['#restore-from-gate', '#restore-initial'].forEach(function (id) {
      $(id).addEventListener('click', function () { $('#backup-file').click(); });
    });
    $('#backup-file').addEventListener('change', function () {
      if (this.files[0]) restoreBackupFile(this.files[0]);
      this.value = '';
    });
    $('#lock-btn').addEventListener('click', function () { lockApp(false); });
    $('#backup-btn').addEventListener('click', exportBackup);
    $('#import-btn').addEventListener('click', openImport);
    $('#empty-import').addEventListener('click', openImport);
    $('#new-patient-btn').addEventListener('click', function () { openPatientDialog(); });
    $('#empty-new').addEventListener('click', function () { openPatientDialog(); });
    $('#edit-patient-btn').addEventListener('click', function () { var p = selectedPatient(); if (p) openPatientDialog(p.id); });
    $('#patient-form').addEventListener('submit', savePatient);
    $('#delete-patient').addEventListener('click', deletePatient);
    $('#add-audiogram-btn').addEventListener('click', function () { openAudiogramDialog(); });
    $('#history-add').addEventListener('click', function () { openAudiogramDialog(); });
    $('#audiogram-form').addEventListener('submit', saveAudiogram);
    $('#delete-audiogram').addEventListener('click', deleteAudiogram);
    $$('.close-dialog').forEach(function (button) {
      button.addEventListener('click', function () { button.closest('dialog').close(); });
    });
    $('#patient-search').addEventListener('input', renderPatients);
    $$('.tab').forEach(function (tab) { tab.addEventListener('click', function () { switchTab(tab.dataset.tab); }); });
    $('#copy-conclusion').addEventListener('click', copyConclusion);
    $('#print-btn').addEventListener('click', function () { switchTab('summary'); setTimeout(function () { window.print(); }, 50); });
    $('#criteria-form').addEventListener('submit', saveCriteria);
    $('#reset-criteria').addEventListener('click', resetCriteria);
    $('#csv-file').addEventListener('change', function () { if (this.files[0]) handleCsvFile(this.files[0]); });
    $('#import-form').addEventListener('submit', confirmImport);
    $('#export-patient-csv').addEventListener('click', exportPatientCsv);
    $('#mobile-patients').addEventListener('click', function () { $('#patient-sidebar').classList.toggle('open'); });
    ['pointerdown', 'keydown'].forEach(function (eventName) {
      document.addEventListener(eventName, resetLockTimer, { passive: true });
    });
  }

  function init() {
    buildThresholdInputs();
    bindEvents();
    if (!window.crypto || !crypto.subtle) {
      showGate('initial');
      $('#gate-initial').insertAdjacentHTML('afterbegin', '<p class="form-error">Este navegador no admite Web Crypto. Utilice una versión reciente de Chrome, Edge, Firefox o Safari.</p>');
      $('#start-setup').disabled = true;
      return;
    }
    showGate(localStorage.getItem(STORAGE_KEY) ? 'unlock' : 'initial');
  }

  init();
})();
