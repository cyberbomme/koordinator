/* Koordinator – Oberfläche */
(function () {
  'use strict';

  const K = window.Koordinator;
  const STORE_KEY = 'koordinator.settings';

  // Reihenfolge = Anzeigereihenfolge
  const FORMATS = [
    { id: 'dd', std: true, parse: K.parseAngular, format: K.formatDD },
    { id: 'dms', std: true, parse: K.parseAngular, format: K.formatDMS },
    { id: 'ddm', std: true, parse: K.parseAngular, format: K.formatDDM },
    { id: 'plus', std: true, parse: (s) => K.parsePlus(s, state.coord), format: K.formatPlus },
    { id: 'utm', std: false, parse: K.parseUTM, format: K.formatUTM },
    { id: 'mgrs', std: false, parse: K.parseMGRS, format: K.formatMGRS },
    { id: 'gk', std: false, parse: K.parseGK, format: K.formatGK },
    { id: 'geohash', std: false, parse: K.parseGeohash, format: K.formatGeohash },
    { id: 'maidenhead', std: false, parse: K.parseMaidenhead, format: K.formatMaidenhead },
  ];

  const state = {
    coord: null, // {lat, lon}
    settings: loadSettings(),
  };

  const $ = (sel, el) => (el || document).querySelector(sel);
  const fieldsEl = $('#fields');
  let map = null;
  let marker = null;

  /* ---------------- Einstellungen ---------------- */

  function defaultSettings() {
    const nav = (navigator.language || 'de').toLowerCase();
    return {
      lang: nav.startsWith('de') ? 'de' : 'en',
      theme: 'auto',
      showMap: true,
      enabled: FORMATS.filter((f) => f.std).map((f) => f.id),
    };
  }

  function loadSettings() {
    const def = defaultSettings();
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return {
        lang: s.lang === 'de' || s.lang === 'en' ? s.lang : def.lang,
        theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : def.theme,
        showMap: typeof s.showMap === 'boolean' ? s.showMap : def.showMap,
        enabled: Array.isArray(s.enabled) && s.enabled.length ? s.enabled : def.enabled,
      };
    } catch (e) {
      return def;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.settings));
    } catch (e) {
      /* privater Modus o. ä. – Einstellungen gelten dann nur für diese Sitzung */
    }
  }

  const t = (key) => window.I18N[state.settings.lang][key];
  const tf = (id) => window.I18N[state.settings.lang].formats[id];

  /* ---------------- Felder ---------------- */

  function renderFields() {
    fieldsEl.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'fields-head';
    head.innerHTML = `<button type="button" class="linkbtn" id="btn-clear"><svg aria-hidden="true"><use href="#i-clear"/></svg><span></span></button>`;
    $('span', head).textContent = t('clear');
    $('#btn-clear', head).addEventListener('click', clearAll);
    fieldsEl.appendChild(head);

    for (const f of FORMATS) {
      if (!state.settings.enabled.includes(f.id)) continue;
      const txt = tf(f.id);
      const el = document.createElement('div');
      el.className = 'field';
      el.dataset.id = f.id;
      el.innerHTML = `
        <label class="field-label" for="f-${f.id}">
          <span class="field-name"></span>
          <span class="field-desc"></span>
        </label>
        <div class="field-row">
          <input id="f-${f.id}" type="text" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
          <button type="button" class="copy" title="">
            <svg class="ic-copy" aria-hidden="true"><use href="#i-copy"/></svg>
            <svg class="ic-check" aria-hidden="true"><use href="#i-check"/></svg>
            <span class="copy-label"></span>
          </button>
        </div>
        <div class="field-msg" aria-live="polite"></div>`;
      $('.field-name', el).textContent = txt.name;
      $('.field-desc', el).textContent = txt.desc;
      const input = $('input', el);
      input.placeholder = txt.ph;
      const btn = $('.copy', el);
      btn.title = t('copy');
      btn.setAttribute('aria-label', `${txt.name}: ${t('copy')}`);
      $('.copy-label', el).textContent = t('copy');

      input.addEventListener('input', () => onInput(f, el, input));
      input.addEventListener('blur', () => {
        if (!input.value.trim()) setMsg(el, '');
      });
      btn.addEventListener('click', () => copyField(el, input, btn));
      fieldsEl.appendChild(el);
    }
    updateAll(null);
  }

  function setMsg(el, msg, kind) {
    const m = $('.field-msg', el);
    m.textContent = msg;
    el.classList.toggle('invalid', kind === 'error');
    el.classList.toggle('na', kind === 'na');
  }

  function onInput(f, el, input) {
    const value = input.value.trim();
    if (!value) {
      setMsg(el, '');
      return;
    }
    try {
      const c = f.parse(value);
      setMsg(el, '');
      setCoord(c.lat, c.lon, f.id);
    } catch (e) {
      const key = { range: 'errRange', plusRef: 'errPlusRef' }[e.code] || 'errFormat';
      setMsg(el, t(key), 'error');
    }
  }

  // Aktualisiert alle Felder außer dem, in dem gerade getippt wird.
  function updateAll(sourceId) {
    for (const f of FORMATS) {
      if (f.id === sourceId) continue;
      const el = fieldsEl.querySelector(`.field[data-id="${f.id}"]`);
      if (!el) continue;
      const input = $('input', el);
      if (!state.coord) {
        input.value = '';
        setMsg(el, '');
        continue;
      }
      let out = null;
      try {
        out = f.format(state.coord.lat, state.coord.lon);
      } catch (e) {
        out = null;
      }
      input.value = out || '';
      input.placeholder = out === null ? '—' : tf(f.id).ph;
      if (out === null) setMsg(el, tf(f.id).na || t('errRange'), 'na');
      else setMsg(el, '');
    }
  }

  function setCoord(lat, lon, sourceId) {
    state.coord = { lat, lon };
    updateAll(sourceId);
    updateMap(sourceId);
    updateLinks();
    updateUrl();
  }

  function clearAll() {
    state.coord = null;
    updateAll(null);
    if (marker) {
      marker.remove();
      marker = null;
    }
    updateLinks();
    updateUrl();
  }

  /* ---------------- Zwischenablage ---------------- */

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  async function copyField(el, input, btn) {
    const text = input.value.trim();
    if (!text) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      return;
    }
    const ok = await writeClipboard(text);
    if (!ok) {
      toast(t('copyFail'));
      return;
    }
    btn.classList.add('done');
    $('.copy-label', btn).textContent = t('copied');
    clearTimeout(btn._timer);
    btn._timer = setTimeout(() => {
      btn.classList.remove('done');
      $('.copy-label', btn).textContent = t('copy');
    }, 1500);
  }

  /* ---------------- Toast ---------------- */

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------------- Karte ---------------- */

  function initMap() {
    if (map || !window.L) return;
    map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([51.1657, 10.4515], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.on('click', (e) => {
      const ll = e.latlng.wrap();
      setCoord(ll.lat, ll.lng, 'map');
    });
    if (state.coord) updateMap(null, true);
  }

  function updateMap(sourceId, initial) {
    if (!map) return;
    if (!state.coord) return;
    const ll = [state.coord.lat, state.coord.lon];
    if (!marker) {
      marker = L.marker(ll, { draggable: true, keyboard: true }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng().wrap();
        setCoord(p.lat, p.lng, 'map');
      });
    } else {
      marker.setLatLng(ll);
    }
    if (sourceId === 'map') return;
    if (initial || map.getZoom() < 12) map.setView(ll, Math.max(map.getZoom(), 15));
    else if (!map.getBounds().pad(-0.15).contains(ll)) map.panTo(ll);
  }

  function applyMapVisibility() {
    const show = state.settings.showMap;
    $('#layout').classList.toggle('no-map', !show);
    $('#mapcol').hidden = !show;
    if (show) {
      initMap();
      setTimeout(() => map && map.invalidateSize(), 50);
    }
  }

  function updateLinks() {
    const links = $('#maplinks');
    links.classList.toggle('disabled', !state.coord);
    if (!state.coord) {
      ['#link-gmaps', '#link-osm', '#link-apple'].forEach((s) => $(s).removeAttribute('href'));
      $('#btn-share').disabled = true;
      return;
    }
    const lat = state.coord.lat.toFixed(6);
    const lon = state.coord.lon.toFixed(6);
    $('#link-gmaps').href = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    $('#link-osm').href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
    $('#link-apple').href = `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`;
    $('#btn-share').disabled = false;
  }

  /* ---------------- URL / Teilen ---------------- */

  function shareUrl() {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    let s = u.toString();
    if (state.coord) s += `?c=${state.coord.lat.toFixed(6)},${state.coord.lon.toFixed(6)}`;
    return s;
  }

  function updateUrl() {
    try {
      history.replaceState(null, '', shareUrl());
    } catch (e) {
      /* z. B. file:// – egal */
    }
  }

  async function share() {
    if (!state.coord) return;
    const url = shareUrl();
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (navigator.share && coarse) {
      try {
        await navigator.share({ title: 'Koordinator', text: K.formatDD(state.coord.lat, state.coord.lon), url });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    toast((await writeClipboard(url)) ? t('linkCopied') : t('copyFail'));
  }

  function readUrl() {
    const c = new URLSearchParams(location.search).get('c');
    if (!c) return;
    try {
      const p = K.parseAngular(c);
      state.coord = { lat: p.lat, lon: p.lon };
    } catch (e) {
      /* ungültiger Parameter wird ignoriert */
    }
  }

  /* ---------------- Standort ---------------- */

  function locate() {
    if (!navigator.geolocation) {
      toast(t('locateFail'));
      return;
    }
    const btn = $('#btn-locate');
    btn.classList.add('busy');
    toast(t('locating'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.classList.remove('busy');
        setCoord(pos.coords.latitude, pos.coords.longitude, null);
        toast(t('locateOk').replace('{acc}', Math.round(pos.coords.accuracy)));
      },
      (err) => {
        btn.classList.remove('busy');
        toast(err && err.code === 1 ? t('locateDenied') : t('locateFail'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  /* ---------------- Texte & Einstellungsdialog ---------------- */

  function applyTexts() {
    document.documentElement.lang = state.settings.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const v = t(el.dataset.i18nAria);
      el.setAttribute('aria-label', v);
      el.title = v;
    });
  }

  function applyTheme() {
    const th = state.settings.theme;
    if (th === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = th;
  }

  function renderSettingsChecks() {
    const std = $('#checks-standard');
    const adv = $('#checks-advanced');
    std.innerHTML = '';
    adv.innerHTML = '';
    for (const f of FORMATS) {
      const label = document.createElement('label');
      label.className = 'check';
      label.innerHTML = `<input type="checkbox" value="${f.id}"><span><strong></strong><small></small></span>`;
      $('strong', label).textContent = tf(f.id).name;
      $('small', label).textContent = tf(f.id).desc;
      const cb = $('input', label);
      cb.checked = state.settings.enabled.includes(f.id);
      cb.addEventListener('change', () => {
        const set = new Set(state.settings.enabled);
        if (cb.checked) set.add(f.id);
        else set.delete(f.id);
        if (!set.size) {
          cb.checked = true;
          toast(t('atLeastOne'));
          return;
        }
        state.settings.enabled = FORMATS.map((x) => x.id).filter((id) => set.has(id));
        saveSettings();
        renderFields();
      });
      (f.std ? std : adv).appendChild(label);
    }
    if (FORMATS.some((f) => !f.std && state.settings.enabled.includes(f.id))) $('#advanced').open = true;
  }

  function initSettingsDialog() {
    const dlg = $('#settings');
    $('#btn-settings').addEventListener('click', () => {
      dlg.querySelectorAll('input[name="lang"]').forEach((r) => (r.checked = r.value === state.settings.lang));
      dlg.querySelectorAll('input[name="theme"]').forEach((r) => (r.checked = r.value === state.settings.theme));
      $('#opt-map').checked = state.settings.showMap;
      renderSettingsChecks();
      dlg.showModal();
    });
    // Klick auf den Hintergrund schließt den Dialog
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.querySelectorAll('input[name="lang"]').forEach((r) =>
      r.addEventListener('change', () => {
        state.settings.lang = r.value;
        saveSettings();
        applyTexts();
        renderFields();
        renderSettingsChecks();
      })
    );
    dlg.querySelectorAll('input[name="theme"]').forEach((r) =>
      r.addEventListener('change', () => {
        state.settings.theme = r.value;
        saveSettings();
        applyTheme();
      })
    );
    $('#opt-map').addEventListener('change', (e) => {
      state.settings.showMap = e.target.checked;
      saveSettings();
      applyMapVisibility();
    });
  }

  /* ---------------- Start ---------------- */

  readUrl();
  applyTheme();
  applyTexts();
  renderFields();
  applyMapVisibility();
  updateLinks();
  initSettingsDialog();
  $('#btn-locate').addEventListener('click', locate);
  $('#btn-share').addEventListener('click', share);
})();
