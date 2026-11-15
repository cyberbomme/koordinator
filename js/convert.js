/*
 * Koordinator – Umrechnungslogik.
 * Reine Funktionen ohne DOM-Zugriff. Benötigt die Globals `proj4` und `mgrs`.
 * Alle Parser liefern {lat, lon} (WGS84) oder werfen einen Fehler.
 * Alle Formatter liefern einen String oder null (Format für diese Position nicht verfügbar).
 */
(function (root) {
  'use strict';

  const proj4 = root.proj4;
  const mgrs = root.mgrs;

  function fail(code) {
    const e = new Error(code);
    e.code = code;
    throw e;
  }

  function checkRange(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail('range');
    return { lat, lon };
  }

  function pad(n, width) {
    return String(n).padStart(width, '0');
  }

  /* ------------------------------------------------------------------ *
   * Winkelformate (DD, DMS, DDM) – ein gemeinsamer, toleranter Parser
   * ------------------------------------------------------------------ */

  function parseAngular(input) {
    let s = String(input).trim().toUpperCase();
    if (!s) fail('empty');

    s = s
      .replace(/[″”“]/g, '"')
      .replace(/[′’‘´`]/g, "'")
      .replace(/''/g, '"')
      .replace(/−/g, '-')
      .replace(/º/g, '°');

    // Dezimalkomma (z. B. "52,5163 13,3777"), nur wenn kein Punkt vorkommt
    // und die Werte anderweitig getrennt sind.
    if (!/\d\.\d/.test(s) && /\d,\d/.test(s) && /[\s;]/.test(s)) {
      s = s.replace(/(\d),(\d)/g, '$1.$2');
    }

    const tokenRe = /[NSEWO]|-?\d+(?:\.\d+)?/g;
    const rest = s.replace(tokenRe, '').replace(/[°'"\s,;:]/g, '');
    if (rest) fail('format');

    const tokens = s.match(tokenRe) || [];
    const isLetter = (t) => /^[A-Z]$/.test(t);
    const letterCount = tokens.filter(isLetter).length;
    let groups = [];

    if (letterCount === 0) {
      const n = tokens.length;
      if (n < 2 || n > 6 || n % 2) fail('format');
      groups = [{ nums: tokens.slice(0, n / 2) }, { nums: tokens.slice(n / 2) }];
    } else if (letterCount === 2) {
      if (isLetter(tokens[0])) {
        // Präfix: N 52 30.977 E 13 22.662
        let cur = null;
        for (const t of tokens) {
          if (isLetter(t)) {
            cur = { hem: t, nums: [] };
            groups.push(cur);
          } else {
            cur.nums.push(t);
          }
        }
      } else if (isLetter(tokens[tokens.length - 1])) {
        // Suffix: 52°30'58.6"N 13°22'39.7"E
        let cur = { nums: [] };
        for (const t of tokens) {
          if (isLetter(t)) {
            cur.hem = t;
            groups.push(cur);
            cur = { nums: [] };
          } else {
            cur.nums.push(t);
          }
        }
      } else {
        fail('format');
      }
    } else {
      fail('format');
    }

    if (groups.length !== 2) fail('format');

    const values = groups.map((g) => {
      if (g.nums.length < 1 || g.nums.length > 3) fail('format');
      const neg = g.nums[0].startsWith('-');
      const [d, m = 0, sec = 0] = g.nums.map((x) => Math.abs(Number(x)));
      if (g.nums.length > 1 && !Number.isInteger(d)) fail('format');
      if (g.nums.length > 2 && !Number.isInteger(m)) fail('format');
      if (m >= 60 || sec >= 60) fail('format');
      if (g.nums.slice(1).some((x) => x.startsWith('-'))) fail('format');
      let v = d + m / 60 + sec / 3600;
      if (neg) v = -v;
      let axis = null;
      if (g.hem) {
        if (neg) fail('format');
        if (g.hem === 'S' || g.hem === 'W') v = -v;
        axis = g.hem === 'N' || g.hem === 'S' ? 'lat' : 'lon';
      }
      return { v, axis };
    });

    let lat, lon;
    if (values[0].axis || values[1].axis) {
      if (values[0].axis === values[1].axis) fail('format');
      const latObj = values.find((x) => x.axis === 'lat');
      const lonObj = values.find((x) => x.axis === 'lon');
      lat = latObj.v;
      lon = lonObj.v;
    } else {
      lat = values[0].v;
      lon = values[1].v;
    }
    return checkRange(lat, lon);
  }

  function formatDD(lat, lon) {
    const f = (v) => {
      const s = v.toFixed(6);
      return s === '-0.000000' ? '0.000000' : s;
    };
    return `${f(lat)}, ${f(lon)}`;
  }

  // Zerlegt einen Winkel ganzzahlig, damit beim Runden kein "60 Sekunden" entsteht.
  function splitDMS(value, decimals) {
    const f = Math.pow(10, decimals);
    const units = Math.round(Math.abs(value) * 3600 * f);
    const d = Math.floor(units / (3600 * f));
    const m = Math.floor((units % (3600 * f)) / (60 * f));
    const s = (units % (60 * f)) / f;
    return { d, m, s };
  }

  function formatDMS(lat, lon) {
    const part = (v, pos, neg) => {
      const { d, m, s } = splitDMS(v, 2);
      return `${d}°${pad(m, 2)}'${pad(s.toFixed(2), 5)}"${v < 0 ? neg : pos}`;
    };
    return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`;
  }

  function formatDDM(lat, lon) {
    const part = (v, pos, neg, degWidth) => {
      const units = Math.round(Math.abs(v) * 60 * 1000);
      const d = Math.floor(units / 60000);
      const m = (units % 60000) / 1000;
      return `${v < 0 ? neg : pos} ${pad(d, degWidth)}° ${pad(m.toFixed(3), 6)}'`;
    };
    return `${part(lat, 'N', 'S', 2)} ${part(lon, 'E', 'W', 3)}`;
  }

  /* ------------------------------------------------------------------ *
   * UTM
   * ------------------------------------------------------------------ */

  const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

  function utmZone(lat, lon) {
    let z = Math.floor((lon + 180) / 6) + 1;
    if (z > 60) z = 60;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;
    if (lat >= 72 && lat < 84) {
      if (lon >= 0 && lon < 9) z = 31;
      else if (lon >= 9 && lon < 21) z = 33;
      else if (lon >= 21 && lon < 33) z = 35;
      else if (lon >= 33 && lon < 42) z = 37;
    }
    return z;
  }

  function utmBand(lat) {
    return BANDS[Math.max(0, Math.min(19, Math.floor((lat + 80) / 8)))];
  }

  function utmDef(zone, south) {
    return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;
  }

  function formatUTM(lat, lon) {
    if (lat < -80 || lat >= 84) return null;
    const zone = utmZone(lat, lon);
    const [e, n] = proj4('WGS84', utmDef(zone, lat < 0), [lon, lat]);
    return `${zone}${utmBand(lat)} ${Math.round(e)} ${Math.round(n)}`;
  }

  // Zerlegt z. B. "33U 389885E 5820083N" in ["33","U","389885","E","5820083","N"].
  function tokenize(s) {
    return String(s)
      .toUpperCase()
      .replace(/[,;]/g, ' ')
      .replace(/(\d)([A-Z])/g, '$1 $2')
      .replace(/([A-Z])(\d)/g, '$1 $2')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  const isNum = (t) => /^\d+(?:\.\d+)?$/.test(t);

  function parseUTM(input) {
    let t = tokenize(input);
    if (!t.length || !t[0]) fail('empty');

    let zone, band = null, nums;
    // ETRS89-Schreibweise mit Zonenpräfix im Ostwert: "32389885 5820083"
    if (isNum(t[0]) && /^\d{8}(\.\d+)?$/.test(t[0])) {
      zone = Number(t[0].slice(0, 2));
      t = [t[0].slice(2)].concat(t.slice(1));
    } else {
      if (!/^\d{1,2}$/.test(t[0])) fail('format');
      zone = Number(t[0]);
      t = t.slice(1);
      if (t[0] && BANDS.includes(t[0]) && t[0].length === 1) {
        band = t[0];
        t = t.slice(1);
      }
    }
    const ignore = ['E', 'N', 'M', 'O', 'R', 'H', 'EAST', 'NORTH', 'RW', 'HW'];
    nums = t.filter((x) => !ignore.includes(x));
    if (nums.length !== 2 || !nums.every(isNum)) fail('format');
    const e = Number(nums[0]);
    const n = Number(nums[1]);
    if (zone < 1 || zone > 60) fail('format');
    if (e < 100000 || e > 900000 || n < 0 || n > 10000000) fail('range');
    const south = band ? band < 'N' : false;
    const [lon, lat] = proj4(utmDef(zone, south), 'WGS84', [e, n]);
    return checkRange(lat, lon);
  }

  /* ------------------------------------------------------------------ *
   * MGRS / UTMREF
   * ------------------------------------------------------------------ */

  function formatMGRS(lat, lon) {
    if (lat < -80 || lat > 84) return null;
    try {
      const m = mgrs.forward([lon, lat], 5);
      const p = m.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})$/);
      return p ? `${p[1]} ${p[2]} ${p[3]} ${p[4]}` : m;
    } catch (e) {
      return null;
    }
  }

  function parseMGRS(input) {
    const s = String(input).replace(/\s+/g, '').toUpperCase();
    if (!s) fail('empty');
    if (!/^\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(\d{2}|\d{4}|\d{6}|\d{8}|\d{10})?$/.test(s)) fail('format');
    let p;
    try {
      p = mgrs.toPoint(s);
    } catch (e) {
      fail('format');
    }
    return checkRange(p[1], p[0]);
  }

  /* ------------------------------------------------------------------ *
   * Gauß-Krüger (DHDN / Potsdam-Datum, 3°-Streifen)
   * ------------------------------------------------------------------ */

  function gkDef(zone) {
    return (
      `+proj=tmerc +lat_0=0 +lon_0=${zone * 3} +k=1 +x_0=${zone * 1000000 + 500000} +y_0=0 ` +
      '+ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs'
    );
  }

  function formatGK(lat, lon) {
    if (lat < 46 || lat > 56 || lon < 5 || lon > 16) return null;
    const zone = Math.min(5, Math.max(2, Math.round(lon / 3)));
    const [r, h] = proj4('WGS84', gkDef(zone), [lon, lat]);
    return `R ${Math.round(r)} H ${Math.round(h)}`;
  }

  function parseGK(input) {
    const t = tokenize(input);
    if (!t.length) fail('empty');
    const ignore = ['R', 'H', 'RW', 'HW', 'E', 'N', 'M'];
    const nums = t.filter((x) => !ignore.includes(x));
    if (nums.length !== 2 || !nums.every(isNum)) fail('format');
    const r = Number(nums[0]);
    const h = Number(nums[1]);
    const zone = Math.floor(r / 1000000);
    if (zone < 1 || zone > 6 || h < 5000000 || h > 6300000) fail('range');
    const [lon, lat] = proj4(gkDef(zone), 'WGS84', [r, h]);
    return checkRange(lat, lon);
  }

  /* ------------------------------------------------------------------ *
   * Plus Code (Open Location Code)
   * ------------------------------------------------------------------ */

  const OLC = '23456789CFGHJMPQRVWX';
  const OLC_LAT_PREC = 8000 * 3125; // 20^3 * 5^5
  const OLC_LNG_PREC = 8000 * 1024; // 20^3 * 4^5
  const PLUS_LENGTH = 11;

  function olcEncode(lat, lon, length) {
    length = length || PLUS_LENGTH;
    lat = Math.min(90, Math.max(-90, lat));
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    let latVal = Math.floor(Math.round((lat + 90) * OLC_LAT_PREC * 1e6) / 1e6);
    let lngVal = Math.floor(Math.round((lon + 180) * OLC_LNG_PREC * 1e6) / 1e6);
    if (latVal >= 180 * OLC_LAT_PREC) latVal = 180 * OLC_LAT_PREC - 1;
    if (lngVal >= 360 * OLC_LNG_PREC) lngVal -= 360 * OLC_LNG_PREC;

    let code = '';
    for (let i = 0; i < 5; i++) {
      code = OLC[(latVal % 5) * 4 + (lngVal % 4)] + code;
      latVal = Math.floor(latVal / 5);
      lngVal = Math.floor(lngVal / 4);
    }
    for (let i = 0; i < 5; i++) {
      code = OLC[lngVal % 20] + code;
      code = OLC[latVal % 20] + code;
      latVal = Math.floor(latVal / 20);
      lngVal = Math.floor(lngVal / 20);
    }
    code = code.slice(0, 8) + '+' + code.slice(8);
    return code.slice(0, length + 1);
  }

  function olcDecodeFull(code) {
    const digits = code.replace('+', '').replace(/0+$/, '');
    let lat = -90;
    let lng = -180;
    let resLat = 400;
    let resLng = 400;
    for (let i = 0; i < Math.min(10, digits.length); i += 2) {
      resLat /= 20;
      resLng /= 20;
      lat += OLC.indexOf(digits[i]) * resLat;
      lng += OLC.indexOf(digits[i + 1]) * resLng;
    }
    for (let i = 10; i < digits.length; i++) {
      resLat /= 5;
      resLng /= 4;
      const d = OLC.indexOf(digits[i]);
      lat += Math.floor(d / 4) * resLat;
      lng += (d % 4) * resLng;
    }
    return { lat: lat + resLat / 2, lon: lng + resLng / 2 };
  }

  function formatPlus(lat, lon) {
    return olcEncode(lat, lon, PLUS_LENGTH);
  }

  // ref: optionale Referenzposition {lat, lon} für Kurzcodes wie "GC9H+GP"
  function parsePlus(input, ref) {
    const s = String(input).trim().toUpperCase();
    if (!s) fail('empty');
    const sep = s.indexOf('+');
    if (sep < 0 || sep !== s.lastIndexOf('+') || sep % 2 || sep > 8) fail('format');
    const valid = new RegExp(`^[${OLC}0]+\\+[${OLC}]*$`);
    if (!valid.test(s)) fail('format');
    const after = s.length - sep - 1;
    if (after === 1) fail('format');

    if (sep === 8) {
      // Vollständiger Code (Padding mit "0" ist erlaubt, z. B. "9F4M0000+")
      const pre = s.slice(0, 8);
      if (/0/.test(pre)) {
        if (!/^[^0]+0+$/.test(pre) || pre.replace(/0+$/, '').length % 2 || after) fail('format');
      }
      if (OLC.indexOf(s[0]) > 8 || OLC.indexOf(s[1]) > 17) fail('range');
      const p = olcDecodeFull(s);
      return checkRange(p.lat, p.lon);
    }

    // Kurzcode: braucht eine Referenzposition
    if (/0/.test(s)) fail('format');
    if (!ref) fail('plusRef');
    const padLen = 8 - sep;
    const resolution = Math.pow(20, 2 - padLen / 2);
    const half = resolution / 2;
    const full = olcEncode(ref.lat, ref.lon, PLUS_LENGTH).slice(0, padLen) + s;
    let { lat, lon } = olcDecodeFull(full);
    if (ref.lat + half < lat && lat - resolution >= -90) lat -= resolution;
    else if (ref.lat - half > lat && lat + resolution <= 90) lat += resolution;
    if (ref.lon + half < lon) lon -= resolution;
    else if (ref.lon - half > lon) lon += resolution;
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    return checkRange(lat, lon);
  }

  /* ------------------------------------------------------------------ *
   * Geohash
   * ------------------------------------------------------------------ */

  const GH = '0123456789bcdefghjkmnpqrstuvwxyz';
  const GEOHASH_LENGTH = 9;

  function formatGeohash(lat, lon) {
    let latR = [-90, 90];
    let lonR = [-180, 180];
    let hash = '';
    let bit = 0;
    let ch = 0;
    let even = true;
    while (hash.length < GEOHASH_LENGTH) {
      const r = even ? lonR : latR;
      const v = even ? lon : lat;
      const mid = (r[0] + r[1]) / 2;
      if (v >= mid) {
        ch = (ch << 1) | 1;
        r[0] = mid;
      } else {
        ch <<= 1;
        r[1] = mid;
      }
      even = !even;
      if (++bit === 5) {
        hash += GH[ch];
        bit = 0;
        ch = 0;
      }
    }
    return hash;
  }

  function parseGeohash(input) {
    const s = String(input).trim().toLowerCase();
    if (!s) fail('empty');
    if (!/^[0-9b-hjkmnp-z]{1,12}$/.test(s)) fail('format');
    let latR = [-90, 90];
    let lonR = [-180, 180];
    let even = true;
    for (const c of s) {
      const d = GH.indexOf(c);
      for (let b = 4; b >= 0; b--) {
        const r = even ? lonR : latR;
        const mid = (r[0] + r[1]) / 2;
        if ((d >> b) & 1) r[0] = mid;
        else r[1] = mid;
        even = !even;
      }
    }
    return checkRange((latR[0] + latR[1]) / 2, (lonR[0] + lonR[1]) / 2);
  }

  /* ------------------------------------------------------------------ *
   * Maidenhead Locator
   * ------------------------------------------------------------------ */

  function formatMaidenhead(lat, lon) {
    let x = lon + 180;
    let y = Math.min(lat + 90, 179.9999999);
    if (x >= 360) x -= 360;
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWX';
    const f1 = A[Math.floor(x / 20)] + A[Math.floor(y / 10)];
    const f2 = String(Math.floor((x % 20) / 2)) + String(Math.floor(y % 10));
    const f3 = (A[Math.floor((x % 2) * 12)] + A[Math.floor((y % 1) * 24)]).toLowerCase();
    return f1 + f2 + f3;
  }

  function parseMaidenhead(input) {
    const s = String(input).trim().toUpperCase();
    if (!s) fail('empty');
    if (!/^[A-R]{2}(\d{2}([A-X]{2}(\d{2})?)?)?$/.test(s)) fail('format');
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWX';
    let lon = -180 + A.indexOf(s[0]) * 20;
    let lat = -90 + A.indexOf(s[1]) * 10;
    let w = 20;
    let h = 10;
    if (s.length >= 4) {
      w = 2;
      h = 1;
      lon += Number(s[2]) * 2;
      lat += Number(s[3]);
    }
    if (s.length >= 6) {
      w = 2 / 24;
      h = 1 / 24;
      lon += A.indexOf(s[4]) * w;
      lat += A.indexOf(s[5]) * h;
    }
    if (s.length >= 8) {
      w /= 10;
      h /= 10;
      lon += Number(s[6]) * w;
      lat += Number(s[7]) * h;
    }
    return checkRange(lat + h / 2, lon + w / 2);
  }

  root.Koordinator = {
    parseAngular,
    formatDD,
    formatDMS,
    formatDDM,
    parseUTM,
    formatUTM,
    parseMGRS,
    formatMGRS,
    parseGK,
    formatGK,
    parsePlus,
    formatPlus,
    parseGeohash,
    formatGeohash,
    parseMaidenhead,
    formatMaidenhead,
  };
})(typeof window !== 'undefined' ? window : this);
