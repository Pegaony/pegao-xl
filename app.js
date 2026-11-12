/* PEGAO XL — Fase Android, datos compartidos por Cloud Firestore
   (proyecto pegao-xl) cuando Firebase está configurado; si no,
   localStorage como antes, sin datos inventados */
(function () {
  'use strict';
  /* Enlaces para compartir (los rellena el agente padre; vacíos = se
     comparte sin enlace y nada se rompe):
     PEGAO_WEB_URL = enlace a la versión web de la app (para que quien
     toque el enlace entre a la app y se registre). Es el DESTINO al que
     manda la página de redirección de GitHub Pages.
     PEGAO_APK_URL = enlace de descarga directa de la APK.
     PEGAO_SHARE_BASE = enlace corto que va en los textos compartidos
     (GitHub Pages, https://pegaony.github.io/pegao-xl/): si la app está
     instalada, Android abre la app directo (App Link); si no, la página
     redirige a PEGAO_WEB_URL. */
  if (typeof window.PEGAO_WEB_URL === 'undefined') window.PEGAO_WEB_URL = 'https://muse.ai/s/pegao-xl-web-ka6xoxxxghxyswq/BjsKXQWPpkUL0vaKwOE8fI9aRxqKhE_JsHNc3YuJ8Bo';
  if (typeof window.PEGAO_APK_URL === 'undefined') window.PEGAO_APK_URL = 'https://github.com/Pegaony/pegao-xl/releases/download/v8/pegao-xl-v8.apk';
  if (typeof window.PEGAO_SHARE_BASE === 'undefined') window.PEGAO_SHARE_BASE = 'https://pegaony.github.io/pegao-xl/';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* ---------- Estabilidad: que nunca se quede la pantalla en blanco ----------
     Cualquier error inesperado muestra un aviso amable y la app sigue.
     El arranque también va por pasos con try/catch (ver el final). */
  function safeToast(msg) {
    try {
      var t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg; t.classList.add('show');
      setTimeout(function () { t.classList.remove('show'); }, 2600);
    } catch (e) { /* nunca rompe nada */ }
  }
  window.addEventListener('error', function () { safeToast('Algo falló, pero la app sigue funcionando'); });
  window.addEventListener('unhandledrejection', function () { safeToast('Algo falló, pero la app sigue funcionando'); });

  /* Caché en memoria + localStorage: el feed se pinta al instante desde
     aquí, antes de que Firebase conecte. Si localStorage se llena
     (flyers grandes), la memoria sigue funcionando en la sesión y
     save() devuelve false para que quien guarda pueda reaccionar. */
  var memCache = {};
  function load(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(memCache, key)) return memCache[key];
    try { var v = JSON.parse(localStorage.getItem(key)); var out = (v == null ? fallback : v); memCache[key] = out; return out; }
    catch (e) { memCache[key] = fallback; return fallback; }
  }
  /* Escritura diferida a localStorage (anti-ANR): la memoria siempre
     está al día al instante, pero el disco solo se escribe como mucho
     una vez por segundo. Un JSON.stringify de varios megas (flyers en
     data URL) en cada snapshot de Firestore o en cada render bloqueaba
     el hilo principal y Android mataba la app con "no responde". */
  var SAVE_FLUSH_MS = 1000;
  var saveDirty = {};
  var saveTimer = null;
  function flushSaves() {
    try { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } } catch (e) {}
    var keys = Object.keys(saveDirty);
    saveDirty = {};
    keys.forEach(function (key) {
      try {
        if (!Object.prototype.hasOwnProperty.call(memCache, key)) { localStorage.removeItem(key); return; }
        localStorage.setItem(key, JSON.stringify(memCache[key]));
      } catch (e) { /* sin espacio: la memoria sigue valiendo en la sesión */ }
    });
  }
  function save(key, val) {
    memCache[key] = val;
    saveDirty[key] = true;
    if (!saveTimer) {
      saveTimer = setTimeout(function () { saveTimer = null; flushSaves(); }, SAVE_FLUSH_MS);
    }
    return true;
  }
  /* Escritura síncrona (solo donde hay que saber AL MOMENTO si cupo,
     como al publicar con flyer: si no cabe, se publica sin flyer). */
  function saveSync(key, val) {
    memCache[key] = val;
    try { delete saveDirty[key]; } catch (e) {}
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }
  function removeStored(key) {
    try { delete memCache[key]; } catch (e) {}
    try { delete saveDirty[key]; } catch (e) {}
    try { localStorage.removeItem(key); } catch (e) {}
  }
  /* La escritura pendiente nunca se pierde al salir o al pausar la app. */
  try {
    document.addEventListener('visibilitychange', function () { if (document.hidden) { try { flushSaves(); } catch (e) {} } });
    window.addEventListener('pagehide', function () { try { flushSaves(); } catch (e) {} });
  } catch (e) {}
  function uid() { return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  /* ---------- Imágenes: compresión en el teléfono ----------
     Acepta cualquier imagen normal (JPG, PNG, WebP, GIF...): el input es
     accept="image/*" y aquí se convierte a JPEG. Si el teléfono entrega
     un formato que el canvas no puede leer, devuelve null y quien llama
     avisa con un toast honesto; nunca rompe nada. */
  function compressImage(file, maxSide, startQuality, maxBytes) {
    return new Promise(function (resolve) {
      try {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) { resolve(null); return; }
        var url = (window.URL && URL.createObjectURL) ? URL.createObjectURL(file) : null;
        if (!url) { resolve(null); return; }
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) { URL.revokeObjectURL(url); resolve(null); return; }
            var scale = Math.min(1, maxSide / Math.max(w, h));
            var attempt = function (q, side) {
              try {
                var cw = Math.max(1, Math.round(w * side)), ch = Math.max(1, Math.round(h * side));
                var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
                var ctx = cv.getContext('2d');
                if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
                ctx.drawImage(img, 0, 0, cw, ch);
                var dataUrl = cv.toDataURL('image/jpeg', q);
                var bytes = Math.round((dataUrl.length - 23) * 3 / 4);
                if (bytes <= maxBytes || (q <= 0.5 && side <= 0.5)) { URL.revokeObjectURL(url); resolve(dataUrl); return; }
                if (q > 0.55) attempt(Math.max(0.5, q - 0.15), side);
                else attempt(0.5, side * 0.75);
              } catch (e) { URL.revokeObjectURL(url); resolve(null); }
            };
            attempt(startQuality, scale);
          } catch (e) { URL.revokeObjectURL(url); resolve(null); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch (e) { resolve(null); }
    });
  }
  /* Reconstruye un File desde un data URL (para compartir el flyer como
     archivo con navigator.share). Devuelve null si no se puede. */
  function dataUrlToFile(dataUrl, name) {
    try {
      if (!dataUrl || dataUrl.indexOf('data:') !== 0) return Promise.resolve(null);
      return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
        try { return new File([blob], name || 'flyer.jpg', { type: blob.type || 'image/jpeg' }); }
        catch (e) { return null; }
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  /* Miniatura de un data URL (para los pines del mapa y la tarjeta
     flotante): máx 96 px de lado, JPEG. El flyer completo (~600 KB)
     como fondo de cada pin bloqueaba la interfaz al repintar el mapa. */
  var THUMB_MAX_SIDE = 96;
  function thumbFromDataUrl(dataUrl, maxSide) {
    return new Promise(function (resolve) {
      try {
        if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) { resolve(null); return; }
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) { resolve(null); return; }
            var side = maxSide || THUMB_MAX_SIDE;
            var scale = Math.min(1, side / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
            var ctx = cv.getContext('2d');
            if (!ctx) { resolve(null); return; }
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(cv.toDataURL('image/jpeg', 0.72));
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = dataUrl;
      } catch (e) { resolve(null); }
    });
  }
  /* Miniatura tardía (sin bloquear la publicación): si una publicación
     tiene flyer/foto pero no miniatura (publicada rápido, o vieja),
     se genera en segundo plano y se guarda (mismo id, sin duplicar). */
  function ensureThumbForPost(kind, obj) {
    try {
      if (!obj) return;
      var src = null, field = null;
      if (kind === 'fiesta') {
        if (!obj.flyerThumb && obj.flyer && flyerStatus(obj).state === 'ok') { src = obj.flyer; field = 'flyerThumb'; }
      } else {
        if (!obj.photoThumb && obj.photos && obj.photos[0]) { src = obj.photos[0]; field = 'photoThumb'; }
        else if (!obj.flyerThumb && obj.flyer && flyerStatus(obj).state === 'ok') { src = obj.flyer; field = 'flyerThumb'; }
      }
      if (!src || !field) return;
      thumbFromDataUrl(src, THUMB_MAX_SIDE).then(function (t) {
        if (!t) return;
        obj[field] = t;
        var key = kind === 'fiesta' ? 'pegaoxl_parties' : 'pegaoxl_businesses';
        var coll = kind === 'fiesta' ? 'parties' : 'businesses';
        var list = load(key, []);
        for (var i = 0; i < list.length; i++) { if (list[i].id === obj.id) { list[i][field] = t; break; } }
        save(key, list);
        scheduleRender('map', renderMapMarkers);
        if (isCloud()) cloudPut(coll, obj);
      });
    } catch (e) {}
  }
  /* Migración en segundo plano (después del primer pintado): las
     publicaciones viejas con flyer/foto pero sin miniatura la generan
     una a una, sin frenar la app. Como mucho 20 por arranque. */
  function migrateThumbs() {
    try {
      var pending = [];
      parties().forEach(function (p) { if (!p.flyerThumb && p.flyer) pending.push({ kind: 'fiesta', x: p }); });
      businesses().forEach(function (b) { if (!b.photoThumb && !b.flyerThumb && (b.photos || b.flyer)) pending.push({ kind: 'negocio', x: b }); });
      pending = pending.slice(0, 20);
      var i = 0;
      var next = function () {
        if (i >= pending.length) return;
        var it = pending[i++];
        try { ensureThumbForPost(it.kind, it.x); } catch (e) {}
        setTimeout(next, 250);
      };
      next();
    } catch (e) {}
  }

  /* ---------- Flyers: caducidad ----------
     Un flyer dura 7 días como máximo y se elimina al pasar la fecha del
     evento. Si caducó, la tarjeta NO muestra la imagen (etiqueta
     "Flyer vencido" o "Finalizado" si ya pasó la fecha). */
  var FLYER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  function eventEndMs(dateStr) {
    try {
      if (!dateStr) return null;
      var p = String(dateStr).split('-');
      if (p.length !== 3) return null;
      return new Date(+p[0], +p[1] - 1, +p[2], 23, 59, 59).getTime();
    } catch (e) { return null; }
  }
  /* Umbral de borrado de una fiesta: su fecha + su hora. Si tiene hora,
     se borra cuando pasa esa hora; si solo tiene fecha, al terminar ese
     día. Sin fecha no se borra nunca. */
  function eventDateTimeMs(p) {
    try {
      if (!p || !p.date) return null;
      var d = String(p.date).split('-');
      if (d.length !== 3) return null;
      if (p.time && /^\d{1,2}:\d{2}/.test(String(p.time))) {
        var t = String(p.time).split(':');
        return new Date(+d[0], +d[1] - 1, +d[2], +t[0], +t[1] || 0, 0).getTime();
      }
      return new Date(+d[0], +d[1] - 1, +d[2], 23, 59, 59).getTime();
    } catch (e) { return null; }
  }
  function isPastEvent(p) {
    var end = eventDateTimeMs(p);
    return end !== null && end < Date.now();
  }
  function flyerStatus(x) {
    if (!x || !x.flyer) return { state: 'none' };
    var now = Date.now();
    var end = eventEndMs(x.date);
    if (end && now > end) return { state: 'expired', reason: 'date' };
    if (x.flyerAt && (now - x.flyerAt) > FLYER_MAX_AGE_MS) return { state: 'expired', reason: 'age' };
    return { state: 'ok' };
  }
  /* Limpieza silenciosa al arrancar: quita el flyer caducado de las
     publicaciones PROPIAS (nunca las de otros; esas solo no se muestran). */
  function cleanupExpiredFlyers() {
    try {
      var u = currentUser(); if (!u) return;
      var changed = { parties: false, businesses: false };
      ['parties', 'businesses'].forEach(function (coll) {
        var key = CACHE_KEYS[coll];
        var list = load(key, []);
        var dirty = false;
        list.forEach(function (x) {
          if (x.by === u.name && x.flyer && flyerStatus(x).state === 'expired') {
            delete x.flyer; delete x.flyerAt; x.pending = true; dirty = true;
          }
        });
        if (dirty) { save(key, list); changed[coll] = true; if (isCloud()) { list.forEach(function (x) { if (x.pending && x.flyer === undefined) cloudPut(coll, x); }); } }
      });
      if (changed.parties || changed.businesses) { renderFeed(); }
    } catch (e) { /* limpieza opcional, nunca rompe la app */ }
  }

  /* ---------- Borrado automático de fiestas pasadas ----------
     Cuando pasa el día y la hora de una fiesta, la publicación se
     elimina DEFINITIVAMENTE: del caché local y del documento en
     Firestore (si hay nube), con su flyer (va dentro del documento),
     sus reservas y sus reseñas/comentarios. Lo de hoy que todavía no
     pasó su hora se queda. Los negocios NO expiran (no tienen
     fecha de evento). Silencioso, sin avisar. Si no hay nube, el
     borrado queda apuntado en `pegaoxl_tombstones` y se ejecuta al
     conectar (flushTombstones), para que la fiesta no resucite cuando
     el snapshot de la nube la vuelva a traer. Esto también ayuda a que
     lo gratis dure: menos documentos acumulados. */
  function deleteDocEverywhere(coll, id) {
    try {
      if (!id) return;
      if (isCloud()) {
        try { db.collection(coll).doc(id).delete().catch(function () {}); } catch (e) {}
        return;
      }
      var tombs = load('pegaoxl_tombstones', []);
      if (!tombs.some(function (t) { return t.coll === coll && t.id === id; })) {
        tombs.push({ coll: coll, id: id, at: Date.now() });
        save('pegaoxl_tombstones', tombs);
      }
    } catch (e) {}
  }
  function flushTombstones() {
    try {
      if (!isCloud()) return;
      var tombs = load('pegaoxl_tombstones', []);
      if (!tombs.length) return;
      /* Solo se quitan las lápidas que de verdad se borraron en la
         nube; las que fallaron (p. ej. reglas) se quedan para
         reintentarlo al conectar, y el fallo queda registrado en
         Cuenta en vez de morir en silencio. */
      var doneKeys = {};
      var jobs = tombs.map(function (t) {
        var key = t.coll + ':' + t.id;
        try {
          var p = db.collection(t.coll).doc(t.id).delete();
          if (!p || !p.then) { doneKeys[key] = true; return null; }
          return p.then(function () { doneKeys[key] = true; }).catch(function (err) {
            try { recordLastError('borrado', err); } catch (e2) {}
          });
        } catch (e) { return null; }
      }).filter(function (j) { return !!j; });
      var finish = function () {
        try {
          var rest = load('pegaoxl_tombstones', []).filter(function (t) { return !doneKeys[t.coll + ':' + t.id]; });
          save('pegaoxl_tombstones', rest);
        } catch (e) {}
      };
      if (jobs.length) { try { Promise.all(jobs).then(finish).catch(finish); } catch (e) { finish(); } }
      else finish();
    } catch (e) {}
  }
  /* Borra las reservas, reseñas y comentarios de UNA publicación
     (local + nube o lápida). El flyer va dentro del documento de la
     publicación, así que se borra con él. */
  function deletePostChildren(kind, id) {
    try {
      var resList = reservations();
      var resKept = resList.filter(function (r) { return !(r.postKind === kind && r.postId === id); });
      if (resKept.length !== resList.length) {
        resList.forEach(function (r) { if (r.postKind === kind && r.postId === id) deleteDocEverywhere('reservations', r.id); });
        save('pegaoxl_reservations', resKept);
      }
      [['reviews', 'pegaoxl_reviews'], ['comments', 'pegaoxl_comments']].forEach(function (pair) {
        var coll = pair[0], key = pair[1];
        var items = load(key, []);
        var keptItems = items.filter(function (x) { return !(x.targetKind === kind && x.targetId === id); });
        if (keptItems.length !== items.length) {
          items.forEach(function (x) { if (x.targetKind === kind && x.targetId === id) deleteDocEverywhere(coll, x.id); });
          save(key, keptItems);
        }
      });
    } catch (e) {}
  }
  function cleanupPastEvents() {
    try {
      var list = parties();
      var gone = [];
      var kept = list.filter(function (p) {
        if (isPastEvent(p)) { gone.push(p.id); return false; }
        return true;
      });
      if (!gone.length) return 0;
      save('pegaoxl_parties', kept);
      gone.forEach(function (id) {
        deleteDocEverywhere('parties', id);
        deletePostChildren('fiesta', id);
      });
      scheduleRender('feed', renderFeed); scheduleRender('account', renderReservations);
      return gone.length;
    } catch (e) { return 0; }
  }

  var toastTimer = null;
  function toast(msg) {
    try {
      var t = $('#toast'); if (!t) return;
      t.textContent = msg; t.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
    } catch (e) { /* nunca rompe nada */ }
  }

  /* ---------- Último error guardado ----------
     Si algo falla al publicar o al guardar el perfil, nunca debe morir
     en silencio: el error queda registrado y se muestra en Cuenta, para
     que el usuario pueda decirnos qué pasó. */
  function recordLastError(where, err) {
    try {
      var msg = (err && err.message) ? String(err.message) : String(err || 'Error desconocido');
      save('pegaoxl_last_error', { where: where, message: msg, at: Date.now() });
    } catch (e) {}
  }
  function clearLastError() { try { removeStored('pegaoxl_last_error'); } catch (e) {} }
  function reportError(where, err) {
    recordLastError(where, err);
    var msg = (err && err.message) ? String(err.message) : String(err || 'Error desconocido');
    toast('No se pudo guardar: ' + msg);
    renderLastError();
  }
  function renderLastError() {
    try {
      var el = document.getElementById('lastErrorLine');
      if (!el) return;
      var rec = load('pegaoxl_last_error', null);
      if (!rec || !rec.message) { el.classList.add('hidden'); el.textContent = ''; return; }
      var d = new Date(rec.at || Date.now());
      var when = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.textContent = 'Último error: ' + rec.message + ' (' + when + ')';
      el.classList.remove('hidden');
    } catch (e) {}
  }

  /* ---------- Nube: Cloud Firestore (compartido entre teléfonos) ----------
     Modo nube solo cuando hay config completa (appId real, no el marcador)
     y el SDK de Firebase cargó. Si no, todo sigue en localStorage, igual
     que antes. Las colecciones son: parties, businesses,
     reviews, comments y profiles.
     FUENTE DE VERDAD: el caché local (localStorage + memoria). El feed se
     pinta al instante desde el caché; los snapshots de Firestore solo
     actualizan ese caché. Las escrituras son optimistas: se guardan en
     el caché y se ven al instante, y Firestore se escribe en segundo
     plano con el MISMO id, así el snapshot no duplica nada. */
  var db = null, cloudOn = false, cloudStarted = false;
  var CACHE_KEYS = { parties: 'pegaoxl_parties', businesses: 'pegaoxl_businesses', reviews: 'pegaoxl_reviews', comments: 'pegaoxl_comments', reservations: 'pegaoxl_reservations', broadcasts: 'pegaoxl_broadcasts' };
  function isCloud() { return cloudOn && !!db; }
  function cloudConfigValid() {
    var c = window.PEGAO_FIREBASE_CONFIG;
    return typeof firebase !== 'undefined' && c && c.apiKey && c.projectId &&
      c.appId && c.appId !== 'REEMPLAZAR_CON_APP_ID_WEB_DE_FIREBASE';
  }
  /* Los SDK de Firebase se cargan de forma diferida, después del primer
     pintado, para que nada externo bloquee el arranque. Sin internet
     simplemente no cargan y la app sigue en local. */
  var firebaseSdkState = 'idle', firebaseSdkPromise = null;
  function loadFirebaseSDKs() {
    if (firebaseSdkState === 'ready') return Promise.resolve(true);
    if (firebaseSdkState === 'loading') return firebaseSdkPromise;
    firebaseSdkState = 'loading';
    firebaseSdkPromise = new Promise(function (resolve) {
      var urls = [
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
      ];
      var i = 0;
      var next = function () {
        if (i >= urls.length) { firebaseSdkState = 'ready'; resolve(true); return; }
        var s = document.createElement('script');
        s.src = urls[i++]; s.async = true;
        s.onload = next;
        /* Si un SDK no carga, se vuelve a 'idle': el siguiente intento
           vuelve a descargar los scripts en vez de quedarse en 'failed'. */
        s.onerror = function () { firebaseSdkState = 'idle'; firebaseSdkPromise = null; resolve(false); };
        document.head.appendChild(s);
      };
      try { next(); } catch (e) { firebaseSdkState = 'idle'; firebaseSdkPromise = null; resolve(false); }
    });
    return firebaseSdkPromise;
  }
  /* Conexión a la nube con reintentos: un fallo transitorio al abrir la
     app (sin internet, SDK que no carga, registro anónimo que falla) ya
     no deja la app en local para siempre. Espera creciente: 15 s, 30 s,
     60 s; también reintenta al abrir el Feed, al volver a la app y al
     tocar la línea de estado en Cuenta. */
  var cloudRetryTimer = null, cloudRetryCount = 0, cloudHadFailure = false;
  var cloudRetryDelays = [15000, 30000, 60000];
  var CLOUD_RETRY_MAX = 8;
  function cloudRetryDelay() {
    var i = cloudRetryCount < cloudRetryDelays.length ? cloudRetryCount : cloudRetryDelays.length - 1;
    return cloudRetryDelays[i];
  }
  function scheduleCloudRetry(ms) {
    if (cloudOn) return;
    if (cloudRetryTimer) return; /* ya hay un reintento en camino */
    if (cloudRetryCount >= CLOUD_RETRY_MAX) return;
    var delay = (typeof ms === 'number') ? ms : cloudRetryDelay();
    cloudRetryCount++;
    cloudRetryTimer = setTimeout(function () { cloudRetryTimer = null; connectCloud(); }, delay);
  }
  function updateCloudStatus() {
    try {
      var el = document.getElementById('cloudStatusLine');
      if (!el) return;
      var on = isCloud();
      el.textContent = on ? 'Nube: conectada' : 'Nube: sin conexión — toca para reintentar';
      el.classList.toggle('cloud-ok', on);
      el.classList.toggle('cloud-off', !on);
    } catch (e) {}
    safeStep(updateMirrorUI); /* el modo espejo cambia el texto y el aviso */
  }
  function noteCloudFailure(ms) {
    cloudOn = false; cloudHadFailure = true;
    updateCloudStatus();
    scheduleCloudRetry(ms);
    safeStep(fetchMirror); /* sin nube, el espejo muestra el contenido */
  }
  function onCloudConnected() {
    cloudOn = true;
    cloudRetryCount = 0;
    try { if (cloudRetryTimer) { clearTimeout(cloudRetryTimer); cloudRetryTimer = null; } } catch (e) {}
    updateCloudStatus();
    safeStep(exitMirrorMode); /* la nube volvió: modo completo otra vez */
    if (cloudHadFailure) { cloudHadFailure = false; toast('Conectado a la nube'); }
    flushTombstones(); /* borrados que quedaron pendientes sin nube */
    safeStep(cleanupPastEvents); /* fiestas pasadas: se borran también de la nube */
    startCloudListeners();
    migrateLocalToCloud();
    flushPending();
    tryShowPendingPost();
    safeStep(handleRefParam); /* un referido pendiente se registra ahora */
  }
  function initFirebase() {
    if (cloudOn) return; /* ya conectada */
    if (!cloudConfigValid()) { noteCloudFailure(); return; } /* fallback: localStorage */
    try { firebase.initializeApp(window.PEGAO_FIREBASE_CONFIG); }
    catch (e) {
      /* Reintento: la app ya estaba inicializada, se reutiliza. */
      try { if (!firebase.apps || !firebase.apps.length) { noteCloudFailure(); return; } } catch (e2) { noteCloudFailure(); return; }
    }
    try { db = firebase.firestore(); } catch (e) { noteCloudFailure(); return; }
    try {
      firebase.auth().signInAnonymously().then(function () { onCloudConnected(); }).catch(function () { noteCloudFailure(); });
    } catch (e) { noteCloudFailure(); }
  }
  function connectCloud() {
    if (cloudOn) return;
    loadFirebaseSDKs().then(function (ok) {
      if (!ok) { noteCloudFailure(); return; }
      safeStep(initFirebase);
    });
  }
  function retryCloud() {
    try { if (cloudRetryTimer) { clearTimeout(cloudRetryTimer); cloudRetryTimer = null; } } catch (e) {}
    cloudRetryCount = 0;
    if (cloudOn) { updateCloudStatus(); return; }
    toast('Conectando a la nube…');
    connectCloud();
    /* Acción explícita del usuario (tocó reintentar o tiró para
       actualizar): el espejo sí se vuelve a pedir. */
    safeStep(function () { fetchMirror(true); });
  }

  /* ---------- Espejo sin VPN (Cloudflare Worker, solo lectura) ----------
     En países donde Google está bloqueado (Cuba y otros), Firebase no
     conecta ni con reintentos. El Worker pegao-xl-feed es un espejo de
     LECTURA de las colecciones públicas de Firestore (lee por REST con
     la clave web pública, como la página de GitHub Pages): devuelve
     {country, parties, businesses, reviews} y el país del
     visitante (cf-ipcountry). Si la nube no conecta y el espejo
     responde, la app muestra el feed y el mapa con esos datos en modo
     SOLO LECTURA. El aviso de la VPN sale SOLO si el país está en la
     lista restringida Y la nube no conecta; en cuanto Firebase conecta,
     la app sale sola del modo espejo y vuelve al modo completo. */
  var MIRROR_URL = 'https://pegao-xl-feed.pegaonysupernova.workers.dev/';
  var MIRROR_TIMEOUT_MS = 8000;
  /* El espejo se pide UNA vez al arrancar (o cuando la nube falla) y
     luego como mucho una vez cada 10 minutos: si ya se pidió hace
     poco, se usa la caché local. Solo una acción explícita del usuario
     (reintentar la nube, tirar para actualizar) lo vuelve a pedir. */
  var MIRROR_MIN_INTERVAL_MS = 600000;
  var RESTRICTED_COUNTRIES = ['CU', 'IR', 'SY', 'KP'];
  var OWNER_UID = '118218329060418865983';
  var mirrorData = null, mirrorCountry = null, mirrorMode = false, mirrorFetching = false, mirrorLastTry = 0;
  function isRestrictedCountry() { return !!mirrorCountry && RESTRICTED_COUNTRIES.indexOf(mirrorCountry) >= 0; }
  function isMirrorMode() { return mirrorMode; }
  function mirrorCountryOf() { return mirrorCountry; }
  function vpnMessage() { return 'Estás en un país donde Google está bloqueado. Activa la VPN para publicar.'; }
  /* ¿Se puede hacer esta acción? En modo espejo no: ni publicar, ni
     estrellas, ni comentarios. Compartir sí se puede. */
  function guardAction() {
    if (!mirrorMode) return true;
    if (isRestrictedCountry()) toast(vpnMessage());
    else toast('Sin conexión a la nube. Cuando vuelva la conexión podrás hacerlo.');
    return false;
  }
  function applyMirrorData(data) {
    try {
      if (!data || typeof data !== 'object') return false;
      mirrorData = data;
      mirrorCountry = data.country ? String(data.country).toUpperCase() : null;
      /* El espejo tiene el mismo esquema que el caché: se fusiona con
         syncCache (conserva las publicaciones pendientes locales). */
      ['parties', 'businesses', 'reviews'].forEach(function (coll) {
        if (Array.isArray(data[coll])) syncCache(coll, data[coll].slice());
      });
      if (Array.isArray(data.reviews)) save('pegaoxl_reviews', data.reviews.slice());
      return true;
    } catch (e) { return false; }
  }
  function enterMirrorMode() {
    if (isCloud()) return;
    if (!mirrorData) return;
    mirrorMode = true;
    try { document.body.classList.add('mirror-readonly'); } catch (e) {}
    updateMirrorUI();
    renderFeed(); renderMapMarkers();
  }
  function exitMirrorMode() {
    if (!mirrorMode) { updateMirrorUI(); return; }
    mirrorMode = false;
    try { document.body.classList.remove('mirror-readonly'); } catch (e) {}
    updateMirrorUI();
    renderFeed(); renderMapMarkers();
  }
  function updateMirrorUI() {
    try {
      var banner = document.getElementById('vpnBanner');
      var show = mirrorMode && isRestrictedCountry();
      if (banner) {
        if (show) {
          banner.innerHTML = '<p class="vpn-title">🔒 Estás en un país donde Google está bloqueado.</p><p class="vpn-sub">Puedes ver todo, pero para publicar o dejar reseñas activa la VPN.</p>';
          banner.classList.remove('hidden');
        } else banner.classList.add('hidden');
      }
      /* La línea de estado de la nube explica el modo lectura. */
      var line = document.getElementById('cloudStatusLine');
      if (line && mirrorMode) {
        line.textContent = isRestrictedCountry() ? 'Modo lectura: activa la VPN para publicar' : 'Modo lectura (espejo) — sin conexión a la nube';
        line.classList.remove('cloud-ok'); line.classList.add('cloud-off');
      }
      /* La puerta de Publicar muestra el aviso en vez del de registro. */
      var gate = document.getElementById('publishGate');
      var forms = document.getElementById('publishForms');
      if (gate && forms) {
        if (mirrorMode) {
          var gp = gate.querySelector('p');
          if (gp) gp.textContent = isRestrictedCountry() ? vpnMessage() : 'Sin conexión a la nube: en modo lectura no se puede publicar.';
          gate.classList.remove('hidden');
          forms.classList.add('hidden');
        } else {
          var u = currentUser();
          gate.classList.toggle('hidden', !!u);
          forms.classList.toggle('hidden', !u);
        }
      }
    } catch (e) {}
  }
  function fetchMirror(force) {
    try {
      if (isCloud() || mirrorFetching) return;
      var now = Date.now();
      if (!force && now - mirrorLastTry < MIRROR_MIN_INTERVAL_MS) return; /* ya se pidió hace poco: usa la caché local */
      mirrorLastTry = now;
      if (!window.fetch) return;
      mirrorFetching = true;
      var timedOut = false;
      var timer = setTimeout(function () { timedOut = true; mirrorFetching = false; }, MIRROR_TIMEOUT_MS);
      Promise.resolve().then(function () { return fetch(MIRROR_URL); }).then(function (r) { return r.json(); }).then(function (data) {
        clearTimeout(timer); mirrorFetching = false;
        if (timedOut || isCloud()) return;
        if (applyMirrorData(data)) enterMirrorMode();
      }).catch(function () { clearTimeout(timer); mirrorFetching = false; });
    } catch (e) { mirrorFetching = false; }
  }
  /* Intercepta los botones de Publicar en modo espejo: no cambian de
     pestaña, solo muestran el aviso. Va en captura para ganarle a los
     listeners de navegación que ya existen. */
  document.addEventListener('click', function (e) {
    try {
      if (!mirrorMode) return;
      if (!e.target || !e.target.closest) return;
      var t = e.target.closest('[data-tab="publicar"], [data-goto="publicar"], #headerPlusBtn');
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      guardAction();
    } catch (err) {}
  }, true);
  /* Re-renders con debounce: varios snapshots seguidos pintan una sola
     vez, como mucho una vez cada ~500 ms. Pintar el feed y el mapa
     completos en cada evento de Firestore bloqueaba la interfaz. */
  var renderTimers = {};
  function scheduleRender(name, fn, ms) {
    try { clearTimeout(renderTimers[name]); } catch (e) {}
    renderTimers[name] = setTimeout(function () { try { fn(); } catch (e) {} }, ms || 500);
  }
  /* El snapshot es la verdad de la nube: el caché se reemplaza por él,
     salvo las escrituras optimistas pendientes (pending:true) que aún no
     aparecen en el snapshot, que se conservan para no perderlas. */
  function syncCache(coll, arr) {
    try {
      var key = CACHE_KEYS[coll]; if (!key) return;
      /* Las fiestas pasadas nunca vuelven al caché: ni del snapshot de
         la nube ni del espejo. Si no, resucitarían al conectar. */
      var list = (coll === 'parties') ? arr.filter(function (o) { return !isPastEvent(o); }) : arr;
      /* Las lápidas (borrados pendientes sin nube) también ganan: ni el
         espejo ni el snapshot resucitan lo borrado antes de que el
         borrado llegue a la nube. Sin esto, borrar sin VPN borraba
         solo en el teléfono y la publicación volvía sola. */
      var tombs = load('pegaoxl_tombstones', []);
      if (tombs.length) {
        var tombed = {};
        tombs.forEach(function (t) { if (t.coll === coll) tombed[t.id] = true; });
        list = list.filter(function (o) { return !tombed[o.id]; });
      }
      var ids = {}; list.forEach(function (o) { ids[o.id] = true; });
      var kept = load(key, []).filter(function (o) { return o.pending && !ids[o.id]; });
      var merged = list.concat(kept);
      merged.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      save(key, merged);
    } catch (e) { /* el caché viejo sigue valiendo */ }
  }
  function startCloudListeners() {
    if (cloudStarted || !db) return;
    cloudStarted = true;
    /* Límites acotados en todo: nada de cargar colecciones enteras sin
       límite. El feed y el mapa muestran lo más reciente; lo viejo
       queda en Firestore, no se descarga. Las reservas van con el
       mismo límite (solo las ve quien publicó, en su Cuenta). */
    var defs = [
      { coll: 'parties', limit: 100, render: function () { scheduleRender('feed', renderFeed); scheduleRender('map', renderMapMarkers); } },
      { coll: 'businesses', limit: 100, render: function () { scheduleRender('feed', renderFeed); } },
      { coll: 'reviews', limit: 200, render: function () { scheduleRender('feed', renderFeed); scheduleRender('reputation', renderReputation); } },
      { coll: 'comments', limit: 200, render: function () { scheduleRender('feed', renderFeed); } },
      { coll: 'reservations', limit: 50, render: function () { scheduleRender('account', renderReservations); scheduleRender('feed', renderFeed); } },
      /* Avisos del administrador: un solo documento, el más reciente. */
      { coll: 'broadcasts', limit: 1, render: function () { renderBroadcast(); } }
    ];
    defs.forEach(function (d) {
      var q = db.collection(d.coll).orderBy('at', 'desc');
      if (q.limit) q = q.limit(d.limit);
      q.onSnapshot(function (snap) {
        var arr = [];
        snap.forEach(function (doc) { var o = doc.data() || {}; o.id = doc.id; arr.push(o); });
        syncCache(d.coll, arr); d.render();
        safeStep(tryShowPendingPost); /* un post enlazado que llegó tarde igual se muestra */
      }, function () {
        /* Error de la nube: el caché local sigue mostrando el feed y se
           reintenta la conexión a los 20 s en vez de quedarse en local. */
        noteCloudFailure(20000);
        renderFeed(); renderMapMarkers();
      });
    });
    /* Perfiles: mapa id -> perfil (para mostrar foto y nombre en el feed). Acotado a 200. */
    var pq = db.collection('profiles');
    if (pq.limit) pq = pq.limit(200);
    pq.onSnapshot(function (snap) {
      try {
        var fresh = {};
        snap.forEach(function (doc) { var o = doc.data() || {}; o.id = doc.id; fresh[doc.id] = o; });
        var mine = load('pegaoxl_profile', null);
        if (mine && mine.pending && !fresh[mine.id]) fresh[mine.id] = mine;
        save('pegaoxl_profiles', fresh);
        if (mine && fresh[mine.id] && !fresh[mine.id].pending) save('pegaoxl_profile', fresh[mine.id]);
        /* Los gustos viajan con el perfil: si este teléfono aún no tiene,
           adopta los de la nube; si no, la categoría del perfil siembra. */
        var myFresh = mine && fresh[mine.id];
        if (myFresh && myFresh.tastes && !hasTastes()) { try { save('pegaoxl_tastes', myFresh.tastes); } catch (e) {} }
        seedTastesFromProfile();
        safeStep(adoptFavoritesFromProfile); /* los favoritos viajan con el perfil */
        scheduleRender('feed', renderFeed); scheduleRender('account', renderAccount);
      } catch (e) { /* sigue en local */ }
    }, function () { /* sigue en local */ });
  }
  function withoutId(x) {
    var o = {}, k;
    for (k in x) { if (k !== 'id' && Object.prototype.hasOwnProperty.call(x, k)) o[k] = x[k]; }
    return o;
  }
  /* Lo que se manda a Firestore: sin id local y sin la marca pending. */
  function toCloud(x) {
    var o = withoutId(x);
    delete o.pending;
    return o;
  }
  /* Escritura optimista en segundo plano con el MISMO id del caché, para
     que el snapshot no duplique la publicación. Devuelve la promesa (o
     null si no hay nube) para que quien publica pueda reaccionar. */
  function cloudPut(coll, obj) {
    if (!isCloud() || !obj || !obj.id) return null;
    try {
      var p = db.collection(coll).doc(obj.id).set(toCloud(obj));
      p.catch(function () { scheduleRetry(coll, obj); });
      return p;
    } catch (e) { scheduleRetry(coll, obj); return null; }
  }
  function cloudDelete(coll, id) {
    if (!isCloud() || !id) return null;
    try { return db.collection(coll).doc(id).delete(); } catch (e) { return null; }
  }
  function scheduleRetry(coll, obj) {
    setTimeout(function () {
      try {
        if (!isCloud()) return;
        var list = load(CACHE_KEYS[coll] || '', []);
        var still = list.some(function (x) { return x.id === obj.id && x.pending; });
        if (!still) return;
        db.collection(coll).doc(obj.id).set(toCloud(obj)).catch(function () {});
      } catch (e) {}
    }, 10000);
  }
  /* Al conectar, reintenta subir lo que quedó pendiente (p. ej. se
     publicó sin internet y se cerró la app). */
  function flushPending() {
    if (!isCloud()) return;
    Object.keys(CACHE_KEYS).forEach(function (coll) {
      load(CACHE_KEYS[coll], []).forEach(function (o) {
        if (o.pending && o.id) {
          try { db.collection(coll).doc(o.id).set(toCloud(o)).catch(function () {}); } catch (e) {}
        }
      });
    });
    var mine = load('pegaoxl_profile', null);
    if (mine && mine.pending && mine.id) {
      try { db.collection('profiles').doc(mine.id).set(toCloud(mine)).catch(function () {}); } catch (e) {}
    }
  }
  function migrateLocalToCloud() {
    if (!isCloud()) return;
    try {
      if (localStorage.getItem('pegaoxl_migrated_v1')) return;
      var jobs = [];
      var pushAll = function (coll, key) {
        load(key, []).forEach(function (x) {
          if (!x.id) x.id = uid();
          jobs.push(db.collection(coll).doc(x.id).set(toCloud(x)));
        });
      };
      pushAll('parties', 'pegaoxl_parties');
      pushAll('businesses', 'pegaoxl_businesses');
      pushAll('reviews', 'pegaoxl_reviews');
      pushAll('comments', 'pegaoxl_comments');
      var mine = load('pegaoxl_profile', null);
      if (mine && mine.id) jobs.push(db.collection('profiles').doc(mine.id).set(toCloud(mine)));
      if (!jobs.length) { localStorage.setItem('pegaoxl_migrated_v1', '1'); return; }
      Promise.all(jobs).then(function () {
        localStorage.setItem('pegaoxl_migrated_v1', '1');
      }).catch(function () { /* sin marca: se reintenta en la próxima apertura */ });
    } catch (e) { /* migración opcional, nunca rompe la app */ }
  }
  function linkGoogleToFirebase(idToken) {
    try {
      if (!isCloud() || !idToken || !firebase.auth().currentUser) return;
      firebase.auth().signInWithCredential(
        firebase.auth.GoogleAuthProvider.credential(idToken)).catch(function () {});
    } catch (e) { /* sesión anónima sigue valiendo */ }
  }
  function firebaseReauthAnonymous() {
    try {
      if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;
      firebase.auth().signOut().then(function () {
        return firebase.auth().signInAnonymously();
      }).catch(function () {});
    } catch (e) { /* nunca rompe el cierre de sesión */ }
  }

  /* ---------- Tema ---------- */
  /* Tres temas: Claro, Modo fiesta (oscuro) y Futurista (frío, neón
     sutil). El elegido se guarda en localStorage y se aplica a toda
     la app. El botón de arriba rota entre los tres. */
  var THEMES = { dark: 'Modo fiesta', light: 'Modo claro', future: 'Futurista' };
  function applyTheme(theme) {
    if (!THEMES[theme]) theme = 'dark';
    document.body.setAttribute('data-theme', theme);
    save('pegaoxl_theme', theme);
    var btn = $('#themeToggle');
    btn.textContent = THEMES[theme];
    $$('.appearance-option').forEach(function (b) { b.classList.toggle('selected', b.getAttribute('data-theme-pick') === theme); });
  }
  var savedTheme = load('pegaoxl_theme', 'dark');
  applyTheme(savedTheme);
  $('#themeToggle').addEventListener('click', function () {
    var order = ['dark', 'light', 'future'];
    var cur = document.body.getAttribute('data-theme');
    var next = order[(order.indexOf(cur) + 1) % order.length];
    applyTheme(next);
    toast(THEMES[next] + ' activado');
  });
  $$('.appearance-option').forEach(function (b) {
    b.addEventListener('click', function () { applyTheme(b.getAttribute('data-theme-pick')); toast('Apariencia guardada ✓'); });
  });

  /* ---------- Navegación ---------- */
  var mapReady = false, map = null, markersLayer = null, topoLayer = null, esriLayer = null, baseLayer = null, baseLayerSwapAt = 0;
  var ARTEMISA_CENTER = [22.81, -82.75]; /* vista inicial y punto de partida del selector de pin; NUNCA un pin falso */
  function showTab(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
    $$('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'mapa') { setTimeout(ensureMap, 60); }
    if (name === 'publicar') { setTimeout(function () { safeStep(initPublishPickers); }, 60); /* mini-mapas del selector de pin */ }
    if (name === 'feed') { safeStep(connectCloud); } /* reintenta la nube al abrir el Feed */
  }
  $$('.nav-btn').forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
  $$('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-goto')); }); });

  /* ---------- Botón + y REGISTRARSE en el header ----------
     El + lleva a Publicar, pero si no hay cuenta primero manda al
     registro. REGISTRARSE abre la Cuenta y baja hasta el apartado de
     registro con Google. La mini-ficha (con cuenta) también va a Cuenta. */
  var headerPlusBtn = $('#headerPlusBtn');
  if (headerPlusBtn) headerPlusBtn.addEventListener('click', function () {
    if (!currentUser()) { showTab('cuenta'); toast('Regístrate con Google para publicar'); return; }
    showTab('publicar');
  });
  var headerRegisterBtn = $('#headerRegisterBtn');
  if (headerRegisterBtn) headerRegisterBtn.addEventListener('click', function () {
    showTab('cuenta');
    var card = $('#accountLoggedOut');
    if (card) setTimeout(function () { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
  });
  var headerUserChip = $('#headerUserChip');
  if (headerUserChip) headerUserChip.addEventListener('click', function () { showTab('cuenta'); });

  /* ---------- Cuenta: registro REAL con Google (gratis, sin simulación) ---------- */
  function googleAuth() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth) || null; }
    catch (e) { return null; }
  }
  /* El plugin de Google NO arranca solo: hay que inicializarlo antes de
     llamar a signIn, si no el cliente de Google queda en null y el
     registro falla siempre. Se llama al arrancar y otra vez antes de entrar. */
  var GOOGLE_WEB_CLIENT_ID = '684483593421-ui31prab7mq311e0q4ibjk7rbrut5ue8.apps.googleusercontent.com';
  /* GoogleAuth se inicializa UNA vez, en paralelo al arrancar, y nunca
     bloquea nada. El botón "Continuar con Google" no espera a Firebase
     ni al inicio anónimo: da feedback al instante y abre el selector
     en cuanto GoogleAuth está listo (que ya viene inicializado del
     arranque). Si la inicialización aún no terminó, se espera solo a
     ella, nunca a Firebase. */
  var googleInitDone = false, googleInitPromise = null;
  function initGoogleAuth() {
    if (googleInitPromise) return googleInitPromise;
    var ga = googleAuth();
    if (!ga || !ga.initialize) return Promise.resolve();
    try {
      googleInitPromise = Promise.resolve(ga.initialize({ clientId: GOOGLE_WEB_CLIENT_ID, scopes: ['profile', 'email'], grantOfflineAccess: true }))
        .then(function () { googleInitDone = true; })
        .catch(function () { googleInitPromise = null; });
      return googleInitPromise;
    } catch (e) { googleInitPromise = null; return Promise.resolve(); }
  }
  function currentUser() { return load('pegaoxl_user', null); }
  function renderAccount() {
    var u = currentUser();
    var lo = $('#accountLoggedOut'); if (lo) lo.classList.toggle('hidden', !!u);
    var li = $('#accountLoggedIn'); if (li) li.classList.toggle('hidden', !u);
    var gate = $('#publishGate'); if (gate) gate.classList.toggle('hidden', !!u);
    var forms = $('#publishForms'); if (forms) forms.classList.toggle('hidden', !u);
    if (u) {
      var prof = getMyProfile();
      var nameEl = $('#accountName'); if (nameEl) nameEl.textContent = (prof && prof.displayName) || u.name;
      var emailEl = $('#accountEmail'); if (emailEl) emailEl.textContent = u.email;
      var photo = $('#accountPhoto');
      var photoUrl = (prof && prof.photo) || u.imageUrl;
      if (photo) { if (photoUrl) { photo.src = photoUrl; photo.style.display = ''; } else { photo.style.display = 'none'; } }
    }
    /* Header: REGISTRARSE solo visible sin cuenta; con cuenta sale la
       mini-ficha con la foto (o inicial) y el nombre. */
    var regBtn = $('#headerRegisterBtn'), chip = $('#headerUserChip');
    if (regBtn) regBtn.classList.toggle('hidden', !!u);
    if (chip) {
      chip.classList.toggle('hidden', !u);
      if (u) {
        var prof2 = getMyProfile();
        var displayName = (prof2 && prof2.displayName) || u.name || 'P';
        var av = $('#headerUserAvatar');
        if (av) {
          if (prof2 && prof2.photo) av.innerHTML = '<img class="chip-photo" src="' + esc(prof2.photo) + '" alt="">';
          else av.textContent = displayName.trim().charAt(0).toUpperCase();
        }
        var nm = $('#headerUserName'); if (nm) nm.textContent = displayName.split(' ')[0];
      }
    }
    renderReputation();
    renderProfile();
    renderLastError();
    updateCloudStatus();
    safeStep(renderSaved);
    safeStep(renderInvite);
    safeStep(renderReports);
    safeStep(renderReservations);
    safeStep(renderAdminPanel);
    safeStep(renderPermissions); /* v18: sección Permisos + avisos push */
    safeStep(startReportsListener); /* solo el dueño ve los reportes */
    safeStep(adoptFavoritesFromProfile);
  }
  /* La línea de estado de la nube (en Cuenta) se toca para reintentar. */
  var cloudStatusEl = $('#cloudStatusLine');
  if (cloudStatusEl) cloudStatusEl.addEventListener('click', function () { retryCloud(); });

  /* ---------- Perfil editable (estilo Instagram) ----------
     Vista del perfil (foto, nombre, @usuario, biografía, categoría y
     estadísticas reales) + formulario para editarlo. El perfil toma por
     defecto el nombre y la foto de Google. */
  var profilePhotoData = null, profileFormDirty = false;
  function myStats() {
    var u = currentUser(); if (!u) return { posts: 0, avg: 0, count: 0 };
    var posts = 0, mine = [];
    parties().forEach(function (p) { if (p.by === u.name) { posts++; mine.push({ kind: 'fiesta', id: p.id }); } });
    businesses().forEach(function (b) { if (b.by === u.name) { posts++; mine.push({ kind: 'negocio', id: b.id }); } });
    var all = reviews().filter(function (r) { return mine.some(function (t) { return t.kind === r.targetKind && t.id === r.targetId; }); });
    var sum = 0; all.forEach(function (r) { sum += r.stars || 0; });
    return { posts: posts, avg: all.length ? sum / all.length : 0, count: all.length };
  }
  function renderProfile() {
    try {
      var sec = $('#profileSection'); if (!sec) return;
      var u = currentUser();
      sec.classList.toggle('hidden', !u);
      if (!u) return;
      var prof = getMyProfile();
      seedTastesFromProfile();
      var setText = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
      var viewPhoto = $('#profileViewPhoto');
      if (viewPhoto) {
        if (prof.photo) viewPhoto.innerHTML = '<img src="' + esc(prof.photo) + '" alt="">';
        else viewPhoto.textContent = (prof.displayName || 'P').trim().charAt(0).toUpperCase();
      }
      setText('profileViewName', prof.displayName || u.name || '');
      setText('profileViewUsername', prof.username ? '@' + prof.username : '');
      setText('profileViewBio', prof.bio || '');
      setText('profileViewCategory', prof.category || 'Otro');
      /* El plan solo lo ve este usuario, arriba de SU perfil. Los demás
         ven su perfil normal, sin saber que tiene plan. */
      var badge = document.getElementById('myPlanBadge');
      if (badge) {
        var myPlan = activePlanOf(prof);
        if (myPlan) {
          badge.textContent = myPlan.type === 'premium' ? '⭐ Plan premium activo' : '⭐ Tu plan ' + planLabel(myPlan.type) + ' está activo' + (myPlan.until ? ' · vence el ' + fmtDateShort(myPlan.until) : '');
          badge.classList.remove('hidden');
        } else badge.classList.add('hidden');
      }
      var st = myStats();
      setText('profileStatPosts', String(st.posts));
      setText('profileStatStars', st.count ? st.avg.toFixed(1) : '—');
      setText('profileStatReviews', String(st.count));
      renderMyPosts();
      renderMyReviews();
      /* El formulario solo se rellena si el usuario no está escribiendo,
         para no pisarle lo que escribe cuando llega un snapshot. */
      if (profileFormDirty) return;
      var setVal = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
      setVal('profileName', prof.displayName || '');
      setVal('profileUsername', prof.username || '');
      setVal('profileBio', prof.bio || '');
      setVal('profileCategory', prof.category || 'Otro');
    } catch (e) { /* nunca rompe la cuenta */ }
  }
  /* Mis publicaciones estilo Letterboxd: fila horizontal con las
     tarjetas de lo que publicó el usuario (fiestas y negocios).
     Tocar una abre el detalle o baja hasta su tarjeta. */
  function renderMyPosts() {
    try {
      var u = currentUser(); var box = $('#profileMyPosts'); if (!box) return;
      if (!u) { box.innerHTML = ''; return; }
      var mine = [];
      parties().forEach(function (p) { if (p.by === u.name) mine.push({ kind: 'fiesta', id: p.id, title: p.desc, at: p.at || 0, flyer: p.flyer, flyerAt: p.flyerAt, date: p.date }); });
      businesses().forEach(function (b) { if (b.by === u.name) mine.push({ kind: 'negocio', id: b.id, title: b.name, at: b.at || 0, flyer: b.flyer, flyerAt: b.flyerAt, date: null }); });
      mine.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      if (!mine.length) { box.innerHTML = '<p class="muted">Todavía no publicaste nada. Cuando publiques, tus fiestas y negocios salen aquí.</p>'; return; }
      box.innerHTML = mine.map(function (m) {
        var thumb = '';
        var fs = m.flyer ? flyerStatus(m) : null;
        if (fs && fs.state === 'ok') thumb = '<img src="' + esc(m.flyer) + '" alt="">';
        else thumb = '<span class="profile-post-thumb-letter">' + esc((m.title || '?').trim().charAt(0).toUpperCase()) + '</span>';
        return '<button type="button" class="profile-post-card" data-my-post="' + m.kind + ':' + m.id + '">' +
          '<span class="profile-post-thumb">' + thumb + '</span>' +
          '<span class="profile-post-title">' + esc(m.title || '') + '</span>' +
          '<span class="tag">' + (m.kind === 'fiesta' ? 'Fiesta' : 'Negocio') + '</span></button>';
      }).join('');
      $$('#profileMyPosts [data-my-post]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = b.getAttribute('data-my-post').split(':');
          if (p[0] === 'negocio') { openBizDetail(p[1]); return; }
          showTab('feed');
          setTimeout(function () { highlightPostCard('fiesta', p[1]); }, 150);
        });
      });
    } catch (e) {}
  }
  /* Reseñas que dejaron otros en TUS publicaciones: la reputación
     que se ve en el perfil, estilo Letterboxd ("Recent activity"). */
  function renderMyReviews() {
    try {
      var u = currentUser(); var box = $('#profileMyReviews'); if (!box) return;
      if (!u) { box.innerHTML = ''; return; }
      var mine = [];
      parties().forEach(function (p) { if (p.by === u.name) mine.push({ kind: 'fiesta', id: p.id, title: p.desc }); });
      businesses().forEach(function (b) { if (b.by === u.name) mine.push({ kind: 'negocio', id: b.id, title: b.name }); });
      var all = reviews().filter(function (r) { return mine.some(function (t) { return t.kind === r.targetKind && t.id === r.targetId; }); });
      all.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      if (!all.length) { box.innerHTML = '<p class="muted">Todavía no te dejaron reseñas. Cuando alguien te deje estrellas en tus publicaciones, salen aquí.</p>'; return; }
      box.innerHTML = all.slice(0, 10).map(function (r) {
        var t = mine.filter(function (m) { return m.kind === r.targetKind && m.id === r.targetId; })[0];
        var st = ''; for (var i = 1; i <= 5; i++) st += (i <= (r.stars || 0) ? '★' : '☆');
        return '<div class="profile-review-item"><p class="profile-review-stars">' + st + '</p>' +
          '<p><strong>' + esc(r.by || '') + '</strong> en <em>' + esc(t ? t.title : '') + '</em></p>' +
          (r.text ? '<p class="muted">' + esc(r.text) + '</p>' : '') + '</div>';
      }).join('');
    } catch (e) {}
  }
  /* Pestañas del perfil: publicaciones o reseñas recibidas. */
  var profileTabPostsBtn = $('#profileTabPosts');
  if (profileTabPostsBtn) profileTabPostsBtn.addEventListener('click', function () { setProfileTab('posts'); });
  var profileTabReviewsBtn = $('#profileTabReviews');
  if (profileTabReviewsBtn) profileTabReviewsBtn.addEventListener('click', function () { setProfileTab('reviews'); });
  function setProfileTab(which) {
    var posts = $('#profileMyPosts'), revs = $('#profileMyReviews');
    if (posts) posts.classList.toggle('hidden', which !== 'posts');
    if (revs) revs.classList.toggle('hidden', which !== 'reviews');
    if (profileTabPostsBtn) profileTabPostsBtn.classList.toggle('active', which === 'posts');
    if (profileTabReviewsBtn) profileTabReviewsBtn.classList.toggle('active', which === 'reviews');
  }
  var profilePhotoInput = $('#profilePhotoInput');
  if (profilePhotoInput) profilePhotoInput.addEventListener('change', function () {
    var file = profilePhotoInput.files && profilePhotoInput.files[0];
    var preview = $('#profilePhotoPreview');
    if (!file) { profilePhotoData = null; if (preview) preview.innerHTML = ''; return; }
    compressImage(file, 512, 0.8, 200 * 1024).then(function (dataUrl) {
      if (!dataUrl) { toast('Esa imagen no se pudo leer, prueba con otra foto'); profilePhotoInput.value = ''; profilePhotoData = null; if (preview) preview.innerHTML = ''; return; }
      profilePhotoData = dataUrl;
      if (preview) preview.innerHTML = '<img src="' + esc(dataUrl) + '" alt="Vista previa">';
    });
  });
  var profileFormEl = $('#profileForm');
  if (profileFormEl) {
    profileFormEl.addEventListener('input', function () { profileFormDirty = true; });
    profileFormEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('button[type="submit"]');
      var restoreBtn = function () { if (btn) { btn.disabled = false; btn.textContent = 'Guardar perfil'; } };
      try {
        var u = currentUser(); if (!u) { toast('Primero regístrate con Google'); return; }
        var name = ($('#profileName').value || '').trim();
        var username = ($('#profileUsername').value || '').trim().toLowerCase();
        var bio = ($('#profileBio').value || '').trim();
        var category = $('#profileCategory').value || 'Otro';
        if (!name) { toast('Pon tu nombre'); return; }
        if (!username || !/^[a-z0-9._]{2,30}$/.test(username)) { toast('El nombre de usuario debe tener 2-30 letras, números, puntos o guion bajo'); return; }
        var id = profileIdOf(u);
        var map = profilesMap();
        var takenLocal = Object.keys(map).some(function (k) { var p = map[k]; return k !== id && p && p.usernameLower === username; });
        if (takenLocal) { toast('Ese nombre de usuario ya está en uso'); return; }
        var finish = function () {
          var prof = { id: id, displayName: name, username: username, usernameLower: username, bio: bio, category: category, photo: profilePhotoData || getMyProfile().photo || null, ownerName: u.name, email: u.email, updatedAt: Date.now(), pending: isCloud() };
          /* Los campos del administrador no se borran al editar el perfil:
             si el usuario está suspendido o tiene plan, se conservan. */
          var oldProf = getMyProfile();
          if (oldProf) { if (oldProf.suspended) prof.suspended = true; if (oldProf.plan) prof.plan = oldProf.plan; }
          var ok = saveSync('pegaoxl_profile', prof);
          if (!ok && prof.photo && prof.photo.indexOf('data:') === 0) {
            prof.photo = getMyProfile().photo || u.imageUrl || null;
            saveSync('pegaoxl_profile', prof);
            toast('La foto no cabía en este teléfono, se guardó el resto del perfil');
          }
          var m2 = profilesMap(); m2[id] = prof; save('pegaoxl_profiles', m2);
          profilePhotoData = null; profileFormDirty = false;
          var pp = $('#profilePhotoPreview'); if (pp) pp.innerHTML = '';
          var pi = $('#profilePhotoInput'); if (pi) pi.value = '';
          renderProfile(); renderAccount(); renderFeed();
          clearLastError(); renderLastError();
          toast('Perfil guardado');
          if (isCloud()) cloudPut('profiles', prof);
        };
        if (isCloud()) {
          if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
          /* La consulta a la nube no puede colgarse para siempre: a los
             8 segundos se sigue en local (el perfil ya está guardado en
             el teléfono) y el botón vuelve a 'Guardar perfil'. */
          var settled = false;
          var goFinish = function () {
            if (settled) return; settled = true;
            restoreBtn();
            try { finish(); } catch (err) { reportError('guardar perfil', err); }
          };
          var timer = setTimeout(function () {
            toast('La conexión va lenta, se guardó en este teléfono');
            goFinish();
          }, 8000);
          db.collection('profiles').where('usernameLower', '==', username).limit(2).get().then(function (snap) {
            if (settled) return;
            var taken = false;
            snap.forEach(function (doc) { if (doc.id !== id) taken = true; });
            if (taken) { settled = true; clearTimeout(timer); restoreBtn(); toast('Ese nombre de usuario ya está en uso'); return; }
            clearTimeout(timer);
            goFinish();
          }).catch(function () {
            if (settled) return;
            clearTimeout(timer);
            goFinish();
          });
          return;
        }
        finish();
      } catch (err) {
        restoreBtn();
        reportError('guardar perfil', err);
      }
    });
  }
  /* Reputación del usuario: promedio de estrellas de TODAS sus
     publicaciones (fiestas y negocios con su nombre).
     La reputación es lo que sustituye a los seguidores: no hay
     seguidores en la app, la calidad se mide en estrellas. */
  function renderReputation() {
    var el = $('#accountReputation'); if (!el) return;
    var u = currentUser();
    if (!u) { el.textContent = ''; return; }
    var mine = [];
    parties().forEach(function (p) { if (p.by === u.name) mine.push({ kind: 'fiesta', id: p.id }); });
    businesses().forEach(function (b) { if (b.by === u.name) mine.push({ kind: 'negocio', id: b.id }); });
    var all = reviews().filter(function (r) {
      return mine.some(function (t) { return t.kind === r.targetKind && t.id === r.targetId; });
    });
    if (!all.length) { el.textContent = 'Aún no tienes reseñas.'; return; }
    var sum = 0; all.forEach(function (r) { sum += r.stars || 0; });
    el.textContent = 'Tu reputación: ★ ' + (sum / all.length).toFixed(1) + ' (' + all.length + (all.length === 1 ? ' reseña)' : ' reseñas)');
  }
  $('#registerForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var ga = googleAuth();
    if (!ga) { toast('El registro con Google solo funciona dentro de la APK en el teléfono. Instala la APK y regístrate ahí.'); return; }
    var btn = e.target.querySelector('button[type="submit"]');
    /* Feedback inmediato: el botón cambia ANTES de esperar nada. */
    if (btn) { btn.disabled = true; btn.textContent = 'Abriendo Google...'; }
    var restoreBtn = function () { if (btn) { btn.disabled = false; btn.textContent = 'Continuar con Google'; } };
    var go = function () { return ga.signIn(); };
    var waitInit = googleInitDone ? Promise.resolve() : initGoogleAuth();
    waitInit.then(go).then(function (res) {
      var u = res && res.user ? res.user : res;
      if (!u || !u.email) { restoreBtn(); toast('Google no devolvió tu correo, inténtalo de nuevo'); return; }
      save('pegaoxl_user', { name: u.name || u.givenName || u.email, email: u.email, imageUrl: u.imageUrl || null, googleId: u.id || null, google: true, at: Date.now() });
      /* Si entra otra cuenta de Google, no vale el perfil ni los gustos del anterior. */
      var oldProf = load('pegaoxl_profile', null);
      if (oldProf && oldProf.id !== profileIdOf(load('pegaoxl_user', null))) { removeStored('pegaoxl_profile'); removeStored('pegaoxl_tastes'); }
      if (res && res.authentication && res.authentication.idToken) linkGoogleToFirebase(res.authentication.idToken);
      safeStep(saveFcmTokenToProfile); /* el token push va a su perfil */
      safeStep(handleRefParam); /* venía por un enlace de invitación ?ref= */
      renderAccount(); restoreBtn(); toast('¡Registrado con Google! Ya puedes publicar'); showTab('feed'); tryShowPendingPost(); /* venía por un enlace compartido */
    }).catch(function (err) {
      restoreBtn();
      var msg = (err && err.message) ? err.message : '';
      toast('No se pudo entrar con Google' + (msg ? (': ' + msg) : ', inténtalo de nuevo'));
    });
  });
  $('#logoutBtn').addEventListener('click', function () {
    var ga = googleAuth();
    if (ga && ga.signOut) { ga.signOut().catch(function () {}); }
    removeStored('pegaoxl_user'); removeStored('pegaoxl_profile'); removeStored('pegaoxl_tastes');
    renderAccount(); toast('Sesión cerrada');
    firebaseReauthAnonymous();
  });

  /* ---------- Fiestas y negocios ---------- */
  /* El caché local es la fuente de verdad: se pinta al instante al
     cargar y Firestore lo actualiza en vivo por detrás. */
  function parties() { return load('pegaoxl_parties', []); }
  function businesses() { return load('pegaoxl_businesses', []); }
  function reviews() { return load('pegaoxl_reviews', []); }
  function comments() { return load('pegaoxl_comments', []); }
  function catOf(x, fallback) { return (x && x.category) ? x.category : (fallback || 'Otro'); }

  /* Borrado optimista: desaparece al instante; la nube va por detrás.
     Si la nube falla, la publicación vuelve y se avisa. */
  function deleteListing(kind, id) {
    var key = kind === 'fiesta' ? 'pegaoxl_parties' : 'pegaoxl_businesses';
    var coll = kind === 'fiesta' ? 'parties' : 'businesses';
    var list = load(key, []);
    var removed = null;
    var kept = list.filter(function (x) { if (x.id === id) { removed = x; return false; } return true; });
    if (!removed) return;
    save(key, kept); renderFeed(); renderMapMarkers();
    deletePostChildren(kind, id); /* sus reservas, reseñas y comentarios también se van */
    if (isCloud()) {
      var p = cloudDelete(coll, id);
      if (p && p.catch) {
        toast('Publicación borrada');
        p.catch(function () {
          var back = load(key, []); back.unshift(removed); save(key, back);
          renderFeed(); renderMapMarkers();
          toast('No se pudo borrar en la nube, la publicación volvió');
        });
      } else {
        /* El borrado ni siquiera arrancó (la nube se cayó en el
           intento): no se miente con éxito, la publicación vuelve y
           se avisa. */
        var back2 = load(key, []); back2.unshift(removed); save(key, back2);
        renderFeed(); renderMapMarkers();
        toast('No se pudo borrar en la nube, la publicación volvió');
      }
    } else {
      /* Sin nube (p. ej. modo espejo sin VPN): el borrado queda
         apuntado como lápida y se ejecuta al conectar; ni el espejo
         ni el snapshot la resucitan mientras tanto. */
      deleteDocEverywhere(coll, id);
      toast('Publicación borrada: se quitará de la nube al conectar');
    }
  }

  /* ---------- Perfiles (estilo Instagram) ----------
     Colección Firestore `profiles`, doc id = id de Google si existe, si
     no el correo. Caché local: `pegaoxl_profile` (el mío) y
     `pegaoxl_profiles` (mapa id -> perfil, para mostrar foto y nombre
     en las publicaciones de otros). */
  var PROFILE_CATEGORIES = ['Cantante', 'Bailarín', 'Influencer', 'Fiesta', 'Restaurante', 'Servicio de Comida', 'Bar', 'Discoteca', 'Centro Nocturno', 'MIPYME', 'Negocio', 'Otro'];
  function profileIdOf(u) { return (u && (u.googleId || u.email)) || null; }
  function profilesMap() { return load('pegaoxl_profiles', {}); }

  /* ---------- Panel administrativo ----------
     Solo lo ve el usuario registrado con el correo del administrador.
     Para cualquier otro correo el panel NO existe (ni botón ni mención).
     Los planes NO son de pago: nadie paga nada dentro de la app; cuando
     alguien pague, lo hace directo por WhatsApp con el administrador,
     fuera de la aplicación. El plan es solo un estado visible para ese
     usuario y para el administrador, y no bloquea nada.
     La seguridad real (que solo el uid del administrador pueda escribir
     suspended/plan/broadcasts o borrar publicaciones ajenas) va en las
     reglas de Firestore, fuera de www/. */
  var ADMIN_EMAIL = 'pegaonysupernova@gmail.com';
  function isAdmin() {
    try {
      var u = currentUser(); if (!u || !u.email) return false;
      return String(u.email).trim().toLowerCase() === ADMIN_EMAIL;
    } catch (e) { return false; }
  }
  /* Plan activo de un perfil (null si no tiene o ya venció). */
  function activePlanOf(prof) {
    try {
      if (!prof || !prof.plan || !prof.plan.type) return null;
      if (prof.plan.until && prof.plan.until <= Date.now()) return null;
      return prof.plan;
    } catch (e) { return null; }
  }
  function planLabel(type) {
    return type === 'premium' ? 'premium' : type === 'mensual' ? 'mensual' : type === 'anual' ? 'anual' : String(type || '');
  }
  function fmtDateShort(ts) {
    try { return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return ''; }
  }
  /* ¿Está suspendido el usuario actual? La suspensión llega por el
     listener de perfiles (su propio perfil se sincroniza en la nube). */
  function isSuspended() {
    try {
      var prof = getMyProfile();
      if (prof && prof.suspended) return true;
      var u = currentUser(); if (!u) return false;
      var map = profilesMap();
      var id = profileIdOf(u);
      if (id && map[id] && map[id].suspended) return true;
      return false;
    } catch (e) { return false; }
  }
  function guardSuspended() {
    if (!isSuspended()) return true;
    toast('Tu cuenta está suspendida. No puedes publicar. Escríbele al administrador.');
    return false;
  }
  function getMyProfile() {
    var u = currentUser(); if (!u) return null;
    var p = load('pegaoxl_profile', null);
    if (p) return p;
    return { id: profileIdOf(u), displayName: u.name || '', username: usernameFromEmail(u.email), bio: '', category: 'Otro', photo: u.imageUrl || null, ownerName: u.name || '', updatedAt: Date.now() };
  }
  function usernameFromEmail(email) {
    try {
      var base = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30);
      return base || 'usuario';
    } catch (e) { return 'usuario'; }
  }
  function authorProfile(byName, byId) {
    try {
      var map = profilesMap();
      if (byId && map[byId]) return map[byId];
      var found = null;
      Object.keys(map).forEach(function (k) { var p = map[k]; if (p && (p.displayName === byName || p.ownerName === byName)) found = p; });
      return found;
    } catch (e) { return null; }
  }
  function avatarHtml(byName, byId) {
    var p = authorProfile(byName, byId);
    if (p && p.photo) return '<span class="post-avatar post-avatar-photo"><img src="' + esc(p.photo) + '" alt=""></span>';
    return '<span class="post-avatar" aria-hidden="true">' + avatarInitial(byName) + '</span>';
  }
  function authorDisplayName(byName, byId) {
    var p = authorProfile(byName, byId);
    return (p && p.displayName) ? p.displayName : byName;
  }

  /* Visor simple del flyer: toca la imagen y se abre grande. */
  function openFlyerViewer(src) {
    try {
      var v = $('#flyerViewer'), im = $('#flyerViewerImg');
      if (!v || !im || !src) return;
      im.src = src; v.classList.remove('hidden');
    } catch (e) {}
  }
  function closeFlyerViewer() { try { var v = $('#flyerViewer'); if (v) v.classList.add('hidden'); } catch (e) {} }
  var flyerViewerClose = $('#flyerViewerClose');
  if (flyerViewerClose) flyerViewerClose.addEventListener('click', closeFlyerViewer);
  var flyerViewerEl = $('#flyerViewer');
  if (flyerViewerEl) flyerViewerEl.addEventListener('click', function (e) { if (e.target === flyerViewerEl) closeFlyerViewer(); });

  /* ---------- Para ti: la app aprende de lo que te gusta ----------
     Solo tus propios datos, en localStorage (`pegaoxl_tastes`: puntos
     por categoría y por tipo fiesta/negocio) y, si estás
     registrado, también en tu perfil de Firestore (campo `tastes`)
     para que te siga en otro teléfono. Sin IA externa, sin costo. */
  function getTastes() { return load('pegaoxl_tastes', { categories: {}, types: {}, updatedAt: 0 }); }
  function hasTastes() {
    var t = getTastes();
    var total = 0;
    Object.keys(t.categories || {}).forEach(function (k) { total += t.categories[k] || 0; });
    Object.keys(t.types || {}).forEach(function (k) { total += t.types[k] || 0; });
    return total > 0;
  }
  function recordTaste(category, kind, points) {
    try {
      var t = getTastes();
      t.categories = t.categories || {}; t.types = t.types || {};
      if (category) t.categories[category] = (t.categories[category] || 0) + points;
      if (kind) t.types[kind] = (t.types[kind] || 0) + points;
      t.updatedAt = Date.now();
      save('pegaoxl_tastes', t);
      scheduleTastesSync();
    } catch (e) { /* nunca rompe nada */ }
  }
  function targetOf(kind, id) {
    if (kind === 'fiesta') return parties().find(function (x) { return x.id === id; });
    if (kind === 'negocio') return businesses().find(function (x) { return x.id === id; });
    return null; /* v18: ningún tipo desconocido resuelve */
  }
  function recordTasteForTarget(kind, id, points) {
    try {
      var x = targetOf(kind, id); if (!x) return;
      recordTaste(catOf(x, kind === 'fiesta' ? 'Fiesta' : 'Otro'), kind, points);
    } catch (e) {}
  }
  var tastesSyncTimer = null;
  function scheduleTastesSync() {
    try { clearTimeout(tastesSyncTimer); } catch (e) {}
    tastesSyncTimer = setTimeout(syncTastesToProfile, 2000);
  }
  function syncTastesToProfile() {
    try {
      var u = currentUser(); if (!u || !isCloud()) return;
      var prof = getMyProfile(); if (!prof || !prof.id) return;
      db.collection('profiles').doc(prof.id).set({ tastes: getTastes(), updatedAt: Date.now() }, { merge: true }).catch(function () {});
    } catch (e) {}
  }
  /* La categoría del perfil es el punto de partida: si aún no hay
     gustos, esa categoría empieza con puntos a favor. */
  function seedTastesFromProfile() {
    try {
      if (hasTastes()) return;
      var prof = getMyProfile(); if (!prof || !prof.category || prof.category === 'Otro') return;
      var t = getTastes();
      t.categories[prof.category] = 5;
      t.updatedAt = Date.now();
      save('pegaoxl_tastes', t);
    } catch (e) {}
  }
  /* Puntuación "Para ti": afinidad con tus gustos + qué tan reciente
     es + promedio de estrellas. Sin gustos no hay recomendaciones. */
  function feedScore(kind, x) {
    var t = getTastes();
    var catPts = (t.categories && t.categories[catOf(x, kind === 'fiesta' ? 'Fiesta' : 'Otro')]) || 0;
    var typePts = (t.types && t.types[kind]) || 0;
    var affinity = Math.min(catPts, 10) * 3 + Math.min(typePts, 10) * 2;
    var ageH = Math.max(0, (Date.now() - (x.at || Date.now())) / 3600000);
    var recency = Math.max(0, 72 - ageH) / 72 * 20;
    var r = ratingFor(kind, x.id);
    var stars = r.count ? (r.avg / 5) * 20 : 0;
    /* Lo favorito pesa mucho más arriba, pero nada se esconde: el
       resto sigue abajo en el orden de siempre. */
    var favBoost = isFavorite(kind, x.id) ? 60 : 0;
    return affinity + recency + stars + favBoost;
  }
  function feedMode() {
    var m = load('pegaoxl_feed_mode', null);
    if (m) return m;
    return hasTastes() ? 'foryou' : 'recent';
  }
  function updateFeedModeUI(mode) {
    try {
      var fy = $('#feedModeForYou'), rc = $('#feedModeRecent'), hint = $('#tasteHint');
      if (fy) fy.classList.toggle('active', mode === 'foryou' && hasTastes());
      if (rc) rc.classList.toggle('active', !(mode === 'foryou' && hasTastes()));
      if (hint) hint.classList.toggle('hidden', hasTastes());
    } catch (e) {}
  }

  /* ---------- Feed estilo Instagram: tiempo relativo, avatar, iconos ----------
     Una sola lista cronológica (fiestas + negocios, lo más nuevo arriba).
     Cada tarjeta tiene cabecera con avatar-inicial, tiempo relativo,
     barra de acciones con iconos SVG (estrella, bocadillo, avión) y
     vista previa de los 2 comentarios más recientes. */
  function timeAgo(at) {
    if (!at) return '';
    var diff = Date.now() - at;
    if (diff < 0) diff = 0;
    var min = Math.floor(diff / 60000);
    if (min < 1) return 'ahora mismo';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24) return 'hace ' + h + ' h';
    if (h < 48) return 'ayer';
    return new Date(at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }
  function avatarInitial(name) {
    var n = (name || 'P').trim();
    return esc(n.charAt(0).toUpperCase());
  }
  var ICON_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>';
  var ICON_COMMENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  function feedPostHtml(kind, x) {
    var u = currentUser();
    var by = x.by || 'PEGAO XL';
    var displayName = authorDisplayName(by, x.byId);
    var isOwn = !!(u && by === u.name);
    var hasCoords = isFinite(x.lat) && isFinite(x.lng);
    var title, lines;
    if (kind === 'fiesta') {
      title = x.desc;
      lines = '<p>' + esc(x.place) + '</p>' + (x.address ? '<p>Dirección: ' + esc(x.address) + '</p>' : '') + '<p>' + esc(x.date) + ' · ' + esc(x.time) + '</p><p class="price">' + esc(x.price || 'Precio a confirmar') + '</p>' + seatsLineHtml(x);
    } else {
      title = x.name;
      lines = '<p>' + esc(x.services) + '</p><p>' + esc(x.place) + '</p>' + (x.address ? '<p>Dirección: ' + esc(x.address) + '</p>' : '') + openStatusHtml(x);
    }
    var cmts = comments().filter(function (c) { return c.targetKind === kind && c.targetId === x.id; });
    var preview = cmts.slice(0, 2).map(function (c) {
      return '<p class="post-comment"><strong>' + esc(c.by) + '</strong> ' + esc(c.text) + '</p>';
    }).join('');
    if (cmts.length > 2) preview += '<button type="button" class="link-btn" data-comment="' + kind + ':' + x.id + '">Ver todos los comentarios (' + cmts.length + ')</button>';
    /* Flyer: grande arriba de la tarjeta, como foto de Instagram. Si
       caducó (7 días o fecha del evento pasada) no se muestra la imagen
       y sale la etiqueta. Al tocarlo se abre grande en el visor. */
    var fs = flyerStatus(x);
    var flyerHtml = '';
    if (fs.state === 'ok') {
      flyerHtml = '<img class="post-flyer" src="' + esc(x.flyer) + '" alt="Flyer" data-flyer-view="' + esc(x.flyer) + '">';
    } else if (fs.state === 'expired') {
      flyerHtml = '<p class="flyer-expired">' + (fs.reason === 'date' ? 'Finalizado' : 'Flyer vencido') + '</p>';
    }
    var prof = authorProfile(by, x.byId);
    var profTag = (prof && prof.category && prof.category !== 'Otro') ? '<span class="tag">' + esc(prof.category) + '</span>' : '';
    var views = (typeof x.views === 'number' ? x.views : 0);
    var fav = isFavorite(kind, x.id);
    var saved = isSaved(kind, x.id);
    var interested = kind === 'fiesta' ? isInterested(x.id) : false;
    return '<article class="post-card ' + (kind === 'fiesta' ? 'party-card' : 'biz-card') + '" id="post-' + kind + '-' + x.id + '" data-kind="' + kind + '" data-id="' + x.id + '">' +
      '<div class="post-head">' + avatarHtml(by, x.byId) +
      '<div class="post-meta"><strong>' + esc(displayName) + '</strong>' +
      '<span class="post-sub"><span class="tag tag-cat">' + esc(catOf(x, kind === 'fiesta' ? 'Fiesta' : 'Otro')) + '</span>' + profTag + '<span class="tag">' + (kind === 'fiesta' ? 'Fiesta' : 'Negocio') + '</span>' + (mirrorMode ? '<span class="mirror-badge">Solo lectura</span>' : '') + '<span class="post-time">' + esc(timeAgo(x.at)) + '</span></span></div>' +
      (isOwn ? '<button type="button" class="post-del" data-del-' + kind + '="' + x.id + '">Borrar</button>' : '') +
      '</div>' + flyerHtml +
      '<div class="post-body"><h3>' + esc(title) + '</h3>' + lines +
      '<p>Contacto: ' + esc(x.contact || 'Sin contacto') + '</p>' + reserveLineHtml(x) + '</div>' +
      '<div class="reserve-row">' + reserveBtnHtml(kind, x) + '</div>' +
      (kind === 'negocio' ? '<button type="button" class="btn-primary biz-open-btn" data-biz-open="' + x.id + '">Ver negocio</button>' : '') +
      '<p class="post-stats"><span class="rating">' + ratingLine(kind, x.id) + '</span><span>' + cmts.length + (cmts.length === 1 ? ' comentario' : ' comentarios') + '</span><span>👁 ' + views + '</span></p>' +
      '<div class="ig-actions">' +
      '<button type="button" class="ig-action" data-review="' + kind + ':' + x.id + '" aria-label="Dejar reseña">' + ICON_STAR + '<span>Reseña</span></button>' +
      '<button type="button" class="ig-action" data-comment="' + kind + ':' + x.id + '" aria-label="Comentar">' + ICON_COMMENT + '<span>Comentar</span></button>' +
      '<button type="button" class="ig-action" data-share="' + kind + ':' + x.id + '" aria-label="Compartir">' + ICON_SEND + '<span>Compartir</span></button>' +
      '</div>' +
      '<div class="post-actions-extra">' +
      '<button type="button" class="mini-btn' + (fav ? ' on' : '') + '" data-fav="' + kind + ':' + x.id + '">' + (fav ? '⭐ En favoritos' : '☆ Favorito') + '</button>' +
      '<button type="button" class="mini-btn' + (saved ? ' on' : '') + '" data-save="' + kind + ':' + x.id + '">' + (saved ? '🔖 Guardado ✓' : '🔖 Guardar') + '</button>' +
      (kind === 'fiesta' ? '<button type="button" class="mini-btn' + (interested ? ' on' : '') + '" data-interest="' + x.id + '">' + (interested ? '🔔 Me interesa ✓' : '🔔 Me interesa') + '</button>' : '') +
      (isOwn && !hasCoords ? '<button type="button" class="mini-btn locate-btn" data-locate="' + kind + ':' + x.id + '">📍 Ubicar en el mapa</button>' : '') +
      '<button type="button" class="mini-btn" data-report="' + kind + ':' + x.id + '">🚩 Reportar</button>' +
      '</div>' +
      (preview ? '<div class="post-comments-preview">' + preview + '</div>' : '') +
      '<div class="panel" id="panel-' + kind + '-' + x.id + '"></div></article>';
  }

  function renderFeed() {
    var q = ($('#feedSearch').value || '').toLowerCase();
    var filter = $('#feedFilter').value;
    var cat = $('#feedCategory').value;
    var priceF = $('#feedPrice') ? $('#feedPrice').value : 'cualquiera';
    var items = [];
    parties().forEach(function (p) { items.push({ kind: 'fiesta', x: p }); });
    businesses().forEach(function (b) { items.push({ kind: 'negocio', x: b }); });
    var total = items.length;
    items = items.filter(function (it) {
      var x = it.x;
      /* Buscar por nombre, lugar, categoría, fecha, hora y contacto. */
      var hay = it.kind === 'fiesta'
        ? ((x.desc || '') + ' ' + (x.place || '') + ' ' + (x.address || '') + ' ' + (x.date || '') + ' ' + (x.time || '') + ' ' + catOf(x, 'Fiesta') + ' ' + (x.contact || '')).toLowerCase()
        : ((x.name || '') + ' ' + (x.services || '') + ' ' + (x.place || '') + ' ' + (x.address || '') + ' ' + catOf(x, 'Otro') + ' ' + (x.contact || '')).toLowerCase();
      if (q && hay.indexOf(q) < 0) return false;
      if (filter !== 'todo' && filter !== it.kind) return false;
      if (cat !== 'todas' && catOf(x) !== cat) return false;
      if (priceF !== 'cualquiera' && it.kind === 'fiesta' && !priceMatches(x.price, priceF)) return false;
      if (feedOpenOnly && !(it.kind === 'negocio' && isOpenNow(x) === true)) return false;
      return true;
    });
    /* "Cerca de mí" ordena por distancia; sin coordenadas, al final. */
    var mode = feedMode();
    if (feedNear && myLatLng) {
      items.sort(function (a, b) {
        var da = feedDist(a.x), db = feedDist(b.x);
        return da - db;
      });
    } else if (mode === 'foryou' && hasTastes()) {
      /* "Para ti" ordena por afinidad + reciente + estrellas. Los
         favoritos pesan mucho más, pero nada se esconde: abajo sigue
         todo lo demás en el orden de siempre. */
      items.sort(function (a, b) {
        var s = feedScore(b.kind, b.x) - feedScore(a.kind, a.x);
        return s !== 0 ? s : ((b.x.at || 0) - (a.x.at || 0));
      });
    } else {
      items.sort(function (a, b) { return (b.x.at || 0) - (a.x.at || 0); });
    }
    updateFeedModeUI(mode);
    renderFavSection();
    renderTodaySection();
    renderTopSection();
    renderCalendar();
    /* Estado vacío claro: si hay publicaciones pero los filtros las
       esconden, se dice y se ofrece quitar los filtros. */
    var empty = $('#feedEmpty');
    if (items.length) { empty.style.display = 'none'; }
    else {
      empty.style.display = '';
      if (total > 0) {
        empty.innerHTML = '<div class="empty-art"><img src="icon-flame.webp" alt=""></div>' +
          '<p><strong>Nada coincide con tu búsqueda.</strong></p>' +
          '<p>Prueba con otra palabra o quita los filtros para ver todo.</p>' +
          '<button class="btn-primary" type="button" id="feedClearFilters">Quitar filtros</button>';
        var cf = document.getElementById('feedClearFilters');
        if (cf) cf.addEventListener('click', clearFeedFilters);
      } else {
        empty.innerHTML = '<div class="empty-art"><img src="icon-flame.webp" alt=""></div>' +
          '<p><strong>Todavía no hay publicaciones.</strong></p>' +
          '<p>Sé el primero: publica tu fiesta o tu negocio y que todo el mundo lo vea.</p>' +
          '<button class="btn-primary" type="button" data-goto="publicar">Publicar ahora</button>';
        var pb = empty.querySelector('[data-goto="publicar"]');
        if (pb) pb.addEventListener('click', function () { showTab('publicar'); });
      }
    }
    var calView = $('#calendarView');
    var list = $('#feedList');
    if (calView && !calView.classList.contains('hidden')) { list.style.display = 'none'; }
    else { list.style.display = ''; }
    countViews(items); /* una vista por usuario, por publicación, por día: antes de pintar, para que el 👁 ya salga actualizado */
    list.innerHTML = items.map(function (it) { return feedPostHtml(it.kind, it.x); }).join('');
    $$('[data-del-fiesta]').forEach(function (b) { b.addEventListener('click', function () { if (confirm('¿Borrar esta fiesta?')) deleteListing('fiesta', b.getAttribute('data-del-fiesta')); }); });
    $$('[data-del-negocio]').forEach(function (b) { b.addEventListener('click', function () { if (confirm('¿Borrar este negocio?')) deleteListing('negocio', b.getAttribute('data-del-negocio')); }); });
    $$('[data-flyer-view]').forEach(function (img) { img.addEventListener('click', function () { openFlyerViewer(img.getAttribute('data-flyer-view')); }); });
    $$('[data-biz-open]').forEach(function (b) { b.addEventListener('click', function () { openBizDetail(b.getAttribute('data-biz-open')); }); });
    $$('#feedList [data-fav]').forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-fav').split(':'); toggleFavorite(p[0], p[1]); }); });
    $$('#feedList [data-save]').forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-save').split(':'); toggleSaved(p[0], p[1]); }); });
    $$('#feedList [data-interest]').forEach(function (b) { b.addEventListener('click', function () { toggleInterest(b.getAttribute('data-interest')); }); });
    $$('#feedList [data-report]').forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-report').split(':'); reportPost(p[0], p[1]); }); });
    $$('#feedList [data-locate]').forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-locate').split(':'); openLocatePicker(p[0], p[1]); }); });
    $$('#feedList [data-reserve]').forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-reserve').split(':'); saveReservation(p[0], p[1]); }); });
    /* Tocar la tarjeta abre su detalle: fiesta o negocio. Los botones,
       el flyer y los paneles quedan fuera (cada uno hace lo suyo). */
    $$('#feedList .post-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        try {
          if (!e.target || !e.target.closest) return;
          if (e.target.closest('button, a, input, textarea, select, img, .panel')) return;
          var kind = card.getAttribute('data-kind'), id = card.getAttribute('data-id');
          if (kind === 'fiesta') openPartyDetail(id);
          else if (kind === 'negocio') openBizDetail(id);
        } catch (err) {}
      });
    });
    bindCardButtons($('#tab-feed'));
    restorePanels();
    tryShowPendingPost(); /* enlace compartido ?post=<id>: bajar hasta esa tarjeta */
    reapplyHighlight(); /* el resaltado sobrevive a los repintados del feed */
    renderBroadcast(); /* aviso del administrador arriba del feed */
  }
  /* ---------- Detalle del negocio (vista por dentro) ----------
     Al pinchar "Ver negocio" se abre la pantalla completa del negocio:
     galería de fotos grande arriba (estilo app de comida), nombre,
     categoría, estrellas, dirección, descripción, productos/servicios
     en tarjetas de vidrio con su detalle, reseñas, comentarios y
     compartir. Las reseñas/comentarios usan las mismas funciones del
     feed (saveReview/saveComment/handleShareOption); después de guardar
     se repinta el detalle para que el promedio se actualice. */
  var bizDetailId = null, bizDetailPhotoIdx = 0, bizDetailSvcId = null, bizDetailStars = 0, bizDetailReviewDraft = '';
  function bizGalleryPhotos(b) {
    var arr = (b.photos || []).filter(function (p) { return !!p; });
    if (arr.length) return arr;
    var fs = flyerStatus(b);
    if (fs.state === 'ok' && b.flyer) return [b.flyer];
    return [];
  }
  function openBizDetail(id) {
    try {
      var b = businesses().find(function (x) { return x.id === id; });
      if (!b) { toast('Ese negocio ya no está'); return; }
      bizDetailId = id; bizDetailPhotoIdx = 0; bizDetailSvcId = null; bizDetailStars = 0; bizDetailReviewDraft = '';
      recordTasteForTarget('negocio', id, 2);
      renderBizDetail(id);
      var d = $('#bizDetail'); if (d) { d.classList.remove('hidden'); d.scrollTop = 0; }
    } catch (e) {}
  }
  function closeBizDetail() {
    try { var d = $('#bizDetail'); if (d) d.classList.add('hidden'); bizDetailId = null; } catch (e) {}
  }
  function renderBizDetail(id) {
    try {
      var b = businesses().find(function (x) { return x.id === id; });
      var inner = $('#bizDetailInner'); if (!inner) return;
      if (!b) { inner.innerHTML = '<button type="button" class="biz-detail-close" id="bizDetailClose">← Volver</button><p class="muted">Ese negocio ya no está disponible.</p>'; bindBizDetailClose(); return; }
      var photos = bizGalleryPhotos(b);
      var u = currentUser();
      var isOwn = !!(u && b.by === u.name);
      var r = ratingFor('negocio', b.id);
      var cmts = comments().filter(function (c) { return c.targetKind === 'negocio' && c.targetId === b.id; });
      var mine = myReview('negocio', b.id);
      var sel = bizDetailStars || (mine ? mine.stars : 0);
      var stars = '';
      for (var i = 1; i <= 5; i++) stars += '<button type="button" class="star-btn' + (i <= sel ? ' on' : '') + '" data-biz-star="' + i + '" aria-label="' + i + ' estrellas">★</button>';
      var list = b.servicesList || [];
      var svcDetail = null;
      if (bizDetailSvcId) svcDetail = list.filter(function (s) { return s.id === bizDetailSvcId; })[0] || null;
      var html = '<button type="button" class="biz-detail-close" id="bizDetailClose">← Volver</button>';
      if (photos.length) {
        html += '<div class="biz-gallery"><img id="bizDetailMainImg" class="biz-gallery-main" src="' + esc(photos[Math.min(bizDetailPhotoIdx, photos.length - 1)]) + '" alt="Foto del negocio">';
        if (photos.length > 1) html += '<div class="biz-gallery-thumbs">' + photos.map(function (p, i) { return '<img src="' + esc(p) + '" alt="Foto ' + (i + 1) + '" class="' + (i === Math.min(bizDetailPhotoIdx, photos.length - 1) ? 'active' : '') + '" data-biz-thumb="' + i + '">'; }).join('') + '</div>';
        html += '</div>';
      } else {
        html += '<div class="biz-gallery-empty"><img src="icon-flame.webp" alt=""><p class="muted">Este negocio todavía no subió fotos.</p></div>';
      }
      html += '<div class="biz-detail-head"><h2>' + esc(b.name) + '</h2>' +
        '<div class="biz-detail-tags"><span class="tag tag-cat">' + esc(catOf(b, 'Otro')) + '</span><span class="tag">Negocio</span></div>' +
        '<p class="rating">★ ' + (r.count ? (r.avg.toFixed(1) + ' · ' + r.count + (r.count === 1 ? ' reseña' : ' reseñas')) : 'Sin reseñas aún') + '</p>' +
        openStatusHtml(b) +
        '<p>' + esc(b.place) + '</p>' + (b.address ? '<p>Dirección: ' + esc(b.address) + '</p>' : '') +
        '<p>Contacto: ' + esc(b.contact || 'Sin contacto') + '</p>' + reserveLineHtml(b) +
        (b.description ? '<p class="biz-detail-desc">' + esc(b.description) + '</p>' : '') +
        '<p class="muted">Servicios: ' + esc(b.services || '') + '</p></div>';
      if (isFinite(b.lat) && isFinite(b.lng)) html += '<button type="button" class="btn-secondary biz-map-btn" id="bizDetailMapBtn">Ver en el mapa</button>';
      html += '<div class="reserve-row">' + reserveBtnHtml('negocio', b) + '</div>';
      html += '<h3 class="section-title">Productos y servicios</h3>';
      if (list.length) {
        html += '<div class="svc-grid">' + list.map(function (s) {
          return '<button type="button" class="svc-card" data-biz-svc="' + s.id + '">' +
            (s.photo ? '<img src="' + esc(s.photo) + '" alt="">' : '<span class="svc-card-noimg">PEGAO XL</span>') +
            '<span class="svc-card-body"><strong>' + esc(s.name) + '</strong>' + (s.price ? '<span class="svc-price">' + esc(s.price) + '</span>' : '') + '</span></button>';
        }).join('') + '</div>';
      } else {
        html += '<p class="muted">Este negocio todavía no agregó productos o servicios con foto y precio.</p>';
      }
      if (svcDetail) {
        html += '<div class="svc-detail">' + (svcDetail.photo ? '<img src="' + esc(svcDetail.photo) + '" alt="">' : '') +
          '<h3>' + esc(svcDetail.name) + '</h3>' + (svcDetail.price ? '<p class="svc-price big">' + esc(svcDetail.price) + '</p>' : '') +
          (svcDetail.desc ? '<p>' + esc(svcDetail.desc) + '</p>' : '') +
          '<button type="button" class="btn-primary" id="bizSvcContactBtn">Pedir / Contactar</button></div>';
      }
      html += '<h3 class="section-title">Reseñas</h3>';
      var revs = reviews().filter(function (rv) { return rv.targetKind === 'negocio' && rv.targetId === b.id; });
      if (revs.length) html += '<div class="biz-reviews">' + revs.map(function (rv) {
        var st = ''; for (var j = 1; j <= 5; j++) st += (j <= (rv.stars || 0) ? '★' : '☆');
        return '<div class="profile-review-item"><p class="profile-review-stars">' + st + '</p><p><strong>' + esc(rv.by || '') + '</strong></p>' + (rv.text ? '<p class="muted">' + esc(rv.text) + '</p>' : '') + '</div>';
      }).join('') + '</div>';
      if (u) {
        html += '<div class="stars-row">' + stars + '</div><textarea id="bizDetailReviewText" class="panel-text" rows="2" maxlength="300" placeholder="Cuenta tu experiencia (opcional)">' + esc(bizDetailReviewDraft || (mine ? mine.text : '')) + '</textarea>' +
          '<button type="button" class="btn-primary panel-save" id="bizDetailSaveReview">' + (mine ? 'Actualizar reseña' : 'Guardar reseña') + '</button>';
      } else html += '<p class="muted">Regístrate con Google para dejar tu reseña.</p>';
      html += '<h3 class="section-title">Comentarios (' + cmts.length + ')</h3>';
      if (cmts.length) html += '<div class="comment-list">' + cmts.map(function (c) { return '<p class="comment-item"><strong>' + esc(c.by) + ':</strong> ' + esc(c.text) + '</p>'; }).join('') + '</div>';
      if (u) html += '<textarea id="bizDetailCommentText" class="panel-text" rows="2" maxlength="300" placeholder="Escribe tu comentario"></textarea><button type="button" class="btn-primary panel-save" id="bizDetailSaveComment">Publicar comentario</button>';
      else html += '<p class="muted">Regístrate con Google para comentar.</p>';
      html += '<h3 class="section-title">Compartir</h3><div class="biz-share-row">' +
        '<button type="button" class="btn-secondary" data-biz-share="whatsapp">WhatsApp</button>' +
        '<button type="button" class="btn-secondary" data-biz-share="whatsapp-status">Estado de WhatsApp</button>' +
        '<button type="button" class="btn-secondary" data-biz-share="facebook">Facebook</button>' +
        '<button type="button" class="btn-secondary" data-biz-share="instagram">Instagram</button>' +
        '<button type="button" class="btn-secondary" data-biz-share="system">Más opciones</button>' +
        '<button type="button" class="btn-secondary" data-biz-share="copy">Copiar texto</button></div>';
      html += '<div class="qr-box"><canvas id="bizDetailQR" width="200" height="200"></canvas><p>Código QR de este negocio: escanea con la cámara para abrirlo en PEGAO XL.</p></div>';
      html += '<div class="post-actions-extra" style="padding:0 0 12px">' +
        '<button type="button" class="mini-btn' + (isFavorite('negocio', b.id) ? ' on' : '') + '" id="bizDetailFav">' + (isFavorite('negocio', b.id) ? '⭐ En favoritos' : '☆ Favorito') + '</button>' +
        '<button type="button" class="mini-btn' + (isSaved('negocio', b.id) ? ' on' : '') + '" id="bizDetailSave">' + (isSaved('negocio', b.id) ? '🔖 Guardado ✓' : '🔖 Guardar') + '</button>' +
        '<button type="button" class="mini-btn" id="bizDetailReport">🚩 Reportar</button></div>';
      if (isOwn) html += '<button type="button" class="btn-danger biz-del-btn" id="bizDetailDelete">Borrar este negocio</button>';
      inner.innerHTML = html;
      bindBizDetailClose();
      bindBizDetail(id);
      drawQR(document.getElementById('bizDetailQR'), shareLinkFor('negocio', id));
    } catch (e) {}
  }
  function bindBizDetailClose() {
    var c = $('#bizDetailClose'); if (c) c.addEventListener('click', closeBizDetail);
  }
  function bindBizDetail(id) {
    try {
      $$('#bizDetailInner [data-biz-thumb]').forEach(function (t) {
        t.addEventListener('click', function () {
          bizDetailPhotoIdx = parseInt(t.getAttribute('data-biz-thumb'), 10);
          var b = businesses().find(function (x) { return x.id === id; });
          var photos = b ? bizGalleryPhotos(b) : [];
          var main = $('#bizDetailMainImg');
          if (main && photos[bizDetailPhotoIdx]) main.src = photos[bizDetailPhotoIdx];
          $$('#bizDetailInner [data-biz-thumb]').forEach(function (x) { x.classList.toggle('active', parseInt(x.getAttribute('data-biz-thumb'), 10) === bizDetailPhotoIdx); });
        });
      });
      $$('#bizDetailInner [data-biz-svc]').forEach(function (c) {
        c.addEventListener('click', function () {
          var sid = c.getAttribute('data-biz-svc');
          bizDetailSvcId = (bizDetailSvcId === sid) ? null : sid;
          renderBizDetail(id);
        });
      });
      $$('#bizDetailInner [data-biz-star]').forEach(function (s) {
        s.addEventListener('click', function () {
          var ta = $('#bizDetailReviewText');
          if (ta) bizDetailReviewDraft = ta.value; /* no se pierde lo escrito al tocar una estrella */
          bizDetailStars = parseInt(s.getAttribute('data-biz-star'), 10);
          renderBizDetail(id);
        });
      });
      var saveR = $('#bizDetailSaveReview');
      if (saveR) saveR.addEventListener('click', function () {
        if (!bizDetailStars) { toast('Elige de 1 a 5 estrellas'); return; }
        var ta = $('#bizDetailReviewText');
        saveReview('negocio', id, bizDetailStars, ta ? ta.value.trim() : '');
        bizDetailStars = 0; bizDetailReviewDraft = '';
        renderBizDetail(id);
      });
      var saveC = $('#bizDetailSaveComment');
      if (saveC) saveC.addEventListener('click', function () {
        var ta = $('#bizDetailCommentText');
        var text = ta ? ta.value.trim() : '';
        if (!text) { toast('Escribe tu comentario'); return; }
        saveComment('negocio', id, text);
        renderBizDetail(id);
      });
      $$('#bizDetailInner [data-biz-share]').forEach(function (b) {
        b.addEventListener('click', function () { handleShareOption('negocio', id, b.getAttribute('data-biz-share')); });
      });
      var favBtn = $('#bizDetailFav');
      if (favBtn) favBtn.addEventListener('click', function () { toggleFavorite('negocio', id); renderBizDetail(id); drawQR(document.getElementById('bizDetailQR'), shareLinkFor('negocio', id)); });
      var saveBtn = $('#bizDetailSave');
      if (saveBtn) saveBtn.addEventListener('click', function () { toggleSaved('negocio', id); renderBizDetail(id); drawQR(document.getElementById('bizDetailQR'), shareLinkFor('negocio', id)); });
      var repBtn = $('#bizDetailReport');
      if (repBtn) repBtn.addEventListener('click', function () { reportPost('negocio', id); });
      $$('#bizDetailInner [data-reserve]').forEach(function (b) {
        b.addEventListener('click', function () { var p = b.getAttribute('data-reserve').split(':'); saveReservation(p[0], p[1]); });
      });
      var contactBtn = $('#bizSvcContactBtn');
      if (contactBtn) contactBtn.addEventListener('click', function () {
        var b = businesses().find(function (x) { return x.id === id; });
        if (b && b.contact) copyText(b.contact, 'Contacto copiado: ' + b.contact);
        else toast('Este negocio no puso contacto');
      });
      var mapBtn = $('#bizDetailMapBtn');
      if (mapBtn) mapBtn.addEventListener('click', function () {
        var b = businesses().find(function (x) { return x.id === id; });
        closeBizDetail(); showTab('mapa'); ensureMap();
        if (b && isFinite(b.lat) && isFinite(b.lng)) {
          setTimeout(function () { try { if (map) { map.setView([b.lat, b.lng], 16); } } catch (e) {} }, 1200);
        }
      });
      var delBtn = $('#bizDetailDelete');
      if (delBtn) delBtn.addEventListener('click', function () {
        if (confirm('¿Borrar este negocio?')) { closeBizDetail(); deleteListing('negocio', id); }
      });
    } catch (e) {}
  }

  /* ---------- Detalle de la fiesta ----------
     Tocar una tarjeta de fiesta abre su detalle: flyer grande, fecha,
     hora, lugar, dirección, precio, contacto, estrellas, comentarios,
     compartir, QR, "Me interesa", Favorito, Guardar y Reportar. Igual
     que el detalle del negocio, pero para fiestas. */
  var partyDetailId = null, partyDetailStars = 0, partyDetailReviewDraft = '';
  function openPartyDetail(id) {
    try {
      var p = parties().find(function (x) { return x.id === id; });
      if (!p) { toast('Esa fiesta ya no está'); return; }
      partyDetailId = id; partyDetailStars = 0; partyDetailReviewDraft = '';
      recordTasteForTarget('fiesta', id, 2);
      renderPartyDetail(id);
      var d = $('#partyDetail'); if (d) { d.classList.remove('hidden'); d.scrollTop = 0; }
    } catch (e) {}
  }
  function closePartyDetail() {
    try { var d = $('#partyDetail'); if (d) d.classList.add('hidden'); partyDetailId = null; } catch (e) {}
  }
  function renderPartyDetail(id) {
    try {
      var p = parties().find(function (x) { return x.id === id; });
      var inner = $('#partyDetailInner'); if (!inner) return;
      if (!p) { inner.innerHTML = '<button type="button" class="biz-detail-close" id="partyDetailClose">← Volver</button><p class="muted">Esa fiesta ya no está disponible.</p>'; bindPartyDetailClose(); return; }
      var u = currentUser();
      var isOwn = !!(u && p.by === u.name);
      var r = ratingFor('fiesta', p.id);
      var cmts = comments().filter(function (c) { return c.targetKind === 'fiesta' && c.targetId === p.id; });
      var mine = myReview('fiesta', p.id);
      var sel = partyDetailStars || (mine ? mine.stars : 0);
      var stars = '';
      for (var i = 1; i <= 5; i++) stars += '<button type="button" class="star-btn' + (i <= sel ? ' on' : '') + '" data-party-star="' + i + '" aria-label="' + i + ' estrellas">★</button>';
      var fs = flyerStatus(p);
      var html = '<button type="button" class="biz-detail-close" id="partyDetailClose">← Volver</button>';
      if (fs.state === 'ok' && p.flyer) html += '<div class="biz-gallery"><img id="partyDetailFlyer" class="biz-gallery-main" src="' + esc(p.flyer) + '" alt="Flyer de la fiesta"></div>';
      else if (fs.state === 'expired') html += '<p class="flyer-expired">' + (fs.reason === 'date' ? 'Finalizado' : 'Flyer vencido') + '</p>';
      html += '<div class="biz-detail-head"><h2>' + esc(p.desc || 'Fiesta') + '</h2>' +
        '<div class="biz-detail-tags"><span class="tag tag-cat">' + esc(catOf(p, 'Fiesta')) + '</span><span class="tag">Fiesta</span></div>' +
        '<p class="rating">★ ' + (r.count ? (r.avg.toFixed(1) + ' · ' + r.count + (r.count === 1 ? ' reseña' : ' reseñas')) : 'Sin reseñas aún') + ' · 👁 ' + (typeof p.views === 'number' ? p.views : 0) + '</p>' +
        '<p>' + esc(p.place || '') + '</p>' + (p.address ? '<p>Dirección: ' + esc(p.address) + '</p>' : '') +
        '<p>' + esc(p.date || '') + ' · ' + esc(p.time || '') + '</p>' +
        '<p class="price">' + esc(p.price || 'Precio a confirmar') + '</p>' + seatsLineHtml(p) +
        '<p>Contacto: ' + esc(p.contact || 'Sin contacto') + '</p>' + reserveLineHtml(p) + '</div>';
      if (isFinite(p.lat) && isFinite(p.lng)) html += '<button type="button" class="btn-secondary biz-map-btn" id="partyDetailMapBtn">Ver en el mapa</button>';
      html += '<div class="reserve-row">' + reserveBtnHtml('fiesta', p) + '</div>';
      html += '<div class="post-actions-extra" style="padding:12px 0">' +
        '<button type="button" class="mini-btn' + (isFavorite('fiesta', p.id) ? ' on' : '') + '" id="partyDetailFav">' + (isFavorite('fiesta', p.id) ? '⭐ En favoritos' : '☆ Favorito') + '</button>' +
        '<button type="button" class="mini-btn' + (isSaved('fiesta', p.id) ? ' on' : '') + '" id="partyDetailSave">' + (isSaved('fiesta', p.id) ? '🔖 Guardado ✓' : '🔖 Guardar') + '</button>' +
        '<button type="button" class="mini-btn' + (isInterested(p.id) ? ' on' : '') + '" id="partyDetailInterest">' + (isInterested(p.id) ? '🔔 Me interesa ✓' : '🔔 Me interesa') + '</button>' +
        '<button type="button" class="mini-btn" id="partyDetailReport">🚩 Reportar</button></div>';
      html += '<h3 class="section-title">Reseñas</h3>';
      var revs = reviews().filter(function (rv) { return rv.targetKind === 'fiesta' && rv.targetId === p.id; });
      if (revs.length) html += '<div class="biz-reviews">' + revs.map(function (rv) {
        var st = ''; for (var j = 1; j <= 5; j++) st += (j <= (rv.stars || 0) ? '★' : '☆');
        return '<div class="profile-review-item"><p class="profile-review-stars">' + st + '</p><p><strong>' + esc(rv.by || '') + '</strong></p>' + (rv.text ? '<p class="muted">' + esc(rv.text) + '</p>' : '') + '</div>';
      }).join('') + '</div>';
      if (u) {
        html += '<div class="stars-row">' + stars + '</div><textarea id="partyDetailReviewText" class="panel-text" rows="2" maxlength="300" placeholder="Cuenta tu experiencia (opcional)">' + esc(partyDetailReviewDraft || (mine ? mine.text : '')) + '</textarea>' +
          '<button type="button" class="btn-primary panel-save" id="partyDetailSaveReview">' + (mine ? 'Actualizar reseña' : 'Guardar reseña') + '</button>';
      } else html += '<p class="muted">Regístrate con Google para dejar tu reseña.</p>';
      html += '<h3 class="section-title">Comentarios (' + cmts.length + ')</h3>';
      if (cmts.length) html += '<div class="comment-list">' + cmts.map(function (c) { return '<p class="comment-item"><strong>' + esc(c.by) + ':</strong> ' + esc(c.text) + '</p>'; }).join('') + '</div>';
      if (u) html += '<textarea id="partyDetailCommentText" class="panel-text" rows="2" maxlength="300" placeholder="Escribe tu comentario"></textarea><button type="button" class="btn-primary panel-save" id="partyDetailSaveComment">Publicar comentario</button>';
      else html += '<p class="muted">Regístrate con Google para comentar.</p>';
      html += '<h3 class="section-title">Compartir</h3><div class="biz-share-row">' +
        '<button type="button" class="btn-secondary" data-party-share="whatsapp">WhatsApp</button>' +
        '<button type="button" class="btn-secondary" data-party-share="whatsapp-status">Estado de WhatsApp</button>' +
        '<button type="button" class="btn-secondary" data-party-share="facebook">Facebook</button>' +
        '<button type="button" class="btn-secondary" data-party-share="instagram">Instagram</button>' +
        '<button type="button" class="btn-secondary" data-party-share="system">Más opciones</button>' +
        '<button type="button" class="btn-secondary" data-party-share="copy">Copiar texto</button></div>';
      html += '<div class="qr-box"><canvas id="partyDetailQR" width="200" height="200"></canvas><p>Código QR de esta fiesta: escanea con la cámara para abrirla en PEGAO XL.</p></div>';
      if (isOwn) html += '<button type="button" class="btn-danger biz-del-btn" id="partyDetailDelete">Borrar esta fiesta</button>';
      inner.innerHTML = html;
      bindPartyDetailClose();
      bindPartyDetail(id);
      drawQR(document.getElementById('partyDetailQR'), shareLinkFor('fiesta', id));
    } catch (e) {}
  }
  function bindPartyDetailClose() {
    var c = $('#partyDetailClose'); if (c) c.addEventListener('click', closePartyDetail);
  }
  function bindPartyDetail(id) {
    try {
      var flyer = $('#partyDetailFlyer');
      if (flyer) flyer.addEventListener('click', function () { openFlyerViewer(flyer.getAttribute('src')); });
      $$('#partyDetailInner [data-party-star]').forEach(function (s) {
        s.addEventListener('click', function () {
          var ta = $('#partyDetailReviewText');
          if (ta) partyDetailReviewDraft = ta.value;
          partyDetailStars = parseInt(s.getAttribute('data-party-star'), 10);
          renderPartyDetail(id);
        });
      });
      var saveR = $('#partyDetailSaveReview');
      if (saveR) saveR.addEventListener('click', function () {
        if (!partyDetailStars) { toast('Elige de 1 a 5 estrellas'); return; }
        var ta = $('#partyDetailReviewText');
        saveReview('fiesta', id, partyDetailStars, ta ? ta.value.trim() : '');
        partyDetailStars = 0; partyDetailReviewDraft = '';
        renderPartyDetail(id);
      });
      var saveC = $('#partyDetailSaveComment');
      if (saveC) saveC.addEventListener('click', function () {
        var ta = $('#partyDetailCommentText');
        var text = ta ? ta.value.trim() : '';
        if (!text) { toast('Escribe tu comentario'); return; }
        saveComment('fiesta', id, text);
        renderPartyDetail(id);
      });
      $$('#partyDetailInner [data-party-share]').forEach(function (b) {
        b.addEventListener('click', function () { handleShareOption('fiesta', id, b.getAttribute('data-party-share')); });
      });
      var favBtn = $('#partyDetailFav');
      if (favBtn) favBtn.addEventListener('click', function () { toggleFavorite('fiesta', id); renderPartyDetail(id); });
      var saveBtn = $('#partyDetailSave');
      if (saveBtn) saveBtn.addEventListener('click', function () { toggleSaved('fiesta', id); renderPartyDetail(id); });
      var intBtn = $('#partyDetailInterest');
      if (intBtn) intBtn.addEventListener('click', function () { toggleInterest(id); renderPartyDetail(id); });
      var repBtn = $('#partyDetailReport');
      if (repBtn) repBtn.addEventListener('click', function () { reportPost('fiesta', id); });
      $$('#partyDetailInner [data-reserve]').forEach(function (b) {
        b.addEventListener('click', function () { var p = b.getAttribute('data-reserve').split(':'); saveReservation(p[0], p[1]); });
      });
      var mapBtn = $('#partyDetailMapBtn');
      if (mapBtn) mapBtn.addEventListener('click', function () {
        var p = parties().find(function (x) { return x.id === id; });
        closePartyDetail(); showTab('mapa'); ensureMap();
        if (p && isFinite(p.lat) && isFinite(p.lng)) {
          setTimeout(function () { try { if (map) { map.setView([p.lat, p.lng], 16); } } catch (e) {} }, 1200);
        }
      });
      var delBtn = $('#partyDetailDelete');
      if (delBtn) delBtn.addEventListener('click', function () {
        if (confirm('¿Borrar esta fiesta?')) { closePartyDetail(); deleteListing('fiesta', id); }
      });
    } catch (e) {}
  }

  $('#feedSearch').addEventListener('input', renderFeed);
  $('#feedSearch').addEventListener('change', function () {
    /* Buscar también enseña gustos: si el texto nombra una categoría. */
    try {
      var q = ($('#feedSearch').value || '').toLowerCase();
      if (q.length >= 3) {
        ['Fiesta', 'Restaurante', 'Servicio de Comida', 'Bar', 'Discoteca', 'Centro Nocturno', 'Influencer', 'Cantante', 'Bailarín', 'MIPYME'].forEach(function (c) {
          if (q.indexOf(c.toLowerCase()) >= 0) recordTaste(c, null, 1);
        });
      }
    } catch (e) {}
  });
  $('#feedFilter').addEventListener('change', function () {
    var v = $('#feedFilter').value;
    if (v === 'fiesta' || v === 'negocio') recordTaste(null, v, 1);
    renderFeed();
  });
  $('#feedCategory').addEventListener('change', function () {
    var v = $('#feedCategory').value;
    if (v && v !== 'todas') recordTaste(v, null, 1);
    renderFeed();
  });
  var feedModeForYouBtn = $('#feedModeForYou');
  if (feedModeForYouBtn) feedModeForYouBtn.addEventListener('click', function () { save('pegaoxl_feed_mode', 'foryou'); renderFeed(); });
  var feedModeRecentBtn = $('#feedModeRecent');
  if (feedModeRecentBtn) feedModeRecentBtn.addEventListener('click', function () { save('pegaoxl_feed_mode', 'recent'); renderFeed(); });

  /* ---------- Flyer en los formularios ----------
     Cualquier imagen normal (JPG, PNG, WebP, GIF...): se comprime a
     JPEG en el teléfono y se ve la miniatura antes de publicar. */
  var partyFlyerData = null, bizFlyerData = null;
  var partyFlyerThumb = null, bizFlyerThumb = null;
  function bindFlyerInput(inputId, previewId, setData, setThumb) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      var preview = document.getElementById(previewId);
      if (!file) { setData(null); setThumb(null); if (preview) preview.innerHTML = ''; return; }
      compressImage(file, 1080, 0.82, 600 * 1024).then(function (dataUrl) {
        if (!dataUrl) { toast('Esa imagen no se pudo leer, prueba con otra foto'); input.value = ''; setData(null); setThumb(null); if (preview) preview.innerHTML = ''; return; }
        setData(dataUrl);
        thumbFromDataUrl(dataUrl, THUMB_MAX_SIDE).then(function (t) { setThumb(t); });
        if (preview) preview.innerHTML = '<img src="' + esc(dataUrl) + '" alt="Vista previa del flyer"><button type="button" class="link-btn" data-clear-flyer>Quitar flyer</button>';
        var clearBtn = preview && preview.querySelector('[data-clear-flyer]');
        if (clearBtn) clearBtn.addEventListener('click', function () { input.value = ''; setData(null); setThumb(null); preview.innerHTML = ''; });
      });
    });
  }
  bindFlyerInput('partyFlyerInput', 'partyFlyerPreview', function (v) { partyFlyerData = v; }, function (v) { partyFlyerThumb = v; });
  bindFlyerInput('bizFlyerInput', 'bizFlyerPreview', function (v) { bizFlyerData = v; }, function (v) { bizFlyerThumb = v; });

  /* ---------- Fotos y productos del negocio ----------
     El dueño sube hasta 5 fotos del negocio y sus productos /
     servicios (cada uno con foto, nombre, precio opcional y
     descripción). Las fotos se comprimen igual que el flyer
     (JPEG ≤ ~600 KB). Se guardan en el negocio como `photos`
     (arreglo de data URL) y `servicesList` (arreglo de objetos).
     `services` sigue siendo el texto resumen de siempre (lo usan
     el feed, el mapa y compartir), por eso el arreglo no se llama
     `services`. */
  var bizPhotosData = [], bizPhotosThumbs = [], bizServicesData = [], bizSvcPhotoData = null;
  function renderBizPhotosPreview() {
    var pv = $('#bizPhotosPreview'); if (!pv) return;
    if (!bizPhotosData.length) { pv.innerHTML = ''; return; }
    pv.innerHTML = bizPhotosData.map(function (src, i) {
      return '<span class="photo-thumb"><img src="' + esc(src) + '" alt="Foto ' + (i + 1) + '"><button type="button" class="photo-rm" data-biz-photo-rm="' + i + '" aria-label="Quitar foto">×</button></span>';
    }).join('') + (bizPhotosData.length < 5 ? '<span class="photo-count">' + bizPhotosData.length + ' de 5</span>' : '');
    $$('#bizPhotosPreview [data-biz-photo-rm]').forEach(function (b) {
      b.addEventListener('click', function () { var i = parseInt(b.getAttribute('data-biz-photo-rm'), 10); bizPhotosData.splice(i, 1); bizPhotosThumbs.splice(i, 1); renderBizPhotosPreview(); });
    });
  }
  var bizPhotosInput = $('#bizPhotosInput');
  if (bizPhotosInput) bizPhotosInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(bizPhotosInput.files || []);
    bizPhotosInput.value = '';
    if (!files.length) return;
    var room = 5 - bizPhotosData.length;
    if (room <= 0) { toast('Ya tienes 5 fotos, quita una para agregar otra'); return; }
    files.slice(0, room).forEach(function (file) {
      compressImage(file, 1080, 0.82, 600 * 1024).then(function (dataUrl) {
        if (!dataUrl) { toast('Una foto no se pudo leer, prueba con otra'); return; }
        var idx = bizPhotosData.length;
        bizPhotosData.push(dataUrl);
        bizPhotosThumbs[idx] = null;
        thumbFromDataUrl(dataUrl, THUMB_MAX_SIDE).then(function (t) { bizPhotosThumbs[idx] = t; });
        renderBizPhotosPreview();
      });
    });
    if (files.length > room) toast('Solo caben 5 fotos, se agregaron las primeras ' + room);
  });
  function renderBizServicesList() {
    var list = $('#bizServicesList'); if (!list) return;
    if (!bizServicesData.length) { list.innerHTML = '<p class="muted small">Ningún producto todavía. Agrega el primero abajo.</p>'; return; }
    list.innerHTML = bizServicesData.map(function (s, i) {
      return '<div class="svc-row">' + (s.photo ? '<img src="' + esc(s.photo) + '" alt="">' : '<span class="svc-row-noimg">Sin foto</span>') +
        '<div class="svc-row-meta"><strong>' + esc(s.name) + '</strong>' + (s.price ? '<span class="svc-price">' + esc(s.price) + '</span>' : '') + (s.desc ? '<span class="muted small">' + esc(s.desc) + '</span>' : '') + '</div>' +
        '<button type="button" class="photo-rm svc-row-rm" data-biz-svc-rm="' + i + '" aria-label="Quitar producto">×</button></div>';
    }).join('');
    $$('#bizServicesList [data-biz-svc-rm]').forEach(function (b) {
      b.addEventListener('click', function () { bizServicesData.splice(parseInt(b.getAttribute('data-biz-svc-rm'), 10), 1); renderBizServicesList(); });
    });
  }
  var svcPhotoInput = $('#svcPhotoInput');
  if (svcPhotoInput) svcPhotoInput.addEventListener('change', function () {
    var file = svcPhotoInput.files && svcPhotoInput.files[0];
    var preview = $('#svcPhotoPreview');
    if (!file) { bizSvcPhotoData = null; if (preview) preview.innerHTML = ''; return; }
    compressImage(file, 800, 0.82, 600 * 1024).then(function (dataUrl) {
      if (!dataUrl) { toast('Esa foto no se pudo leer, prueba con otra'); svcPhotoInput.value = ''; bizSvcPhotoData = null; if (preview) preview.innerHTML = ''; return; }
      bizSvcPhotoData = dataUrl;
      if (preview) preview.innerHTML = '<img src="' + esc(dataUrl) + '" alt="Vista previa del producto"><button type="button" class="link-btn" id="svcPhotoClear">Quitar foto</button>';
      var cb = $('#svcPhotoClear');
      if (cb) cb.addEventListener('click', function () { svcPhotoInput.value = ''; bizSvcPhotoData = null; preview.innerHTML = ''; });
    });
  });
  var svcAddBtn = $('#svcAddBtn');
  if (svcAddBtn) svcAddBtn.addEventListener('click', function () {
    var name = ($('#svcName').value || '').trim();
    var price = ($('#svcPrice').value || '').trim();
    var desc = ($('#svcDesc').value || '').trim();
    if (!name) { toast('Pon el nombre del producto o servicio'); return; }
    if (bizServicesData.length >= 20) { toast('Ya tienes 20 productos, es suficiente por negocio'); return; }
    bizServicesData.push({ id: uid(), name: name, price: price, desc: desc, photo: bizSvcPhotoData });
    bizSvcPhotoData = null;
    var sn = $('#svcName'); if (sn) sn.value = '';
    var sp = $('#svcPrice'); if (sp) sp.value = '';
    var sd = $('#svcDesc'); if (sd) sd.value = '';
    var si = $('#svcPhotoInput'); if (si) si.value = '';
    var sv = $('#svcPhotoPreview'); if (sv) sv.innerHTML = '';
    renderBizServicesList();
  });
  renderBizServicesList();

  /* Publicar es optimista: la publicación se ve en el feed AL INSTANTE
     desde el caché y el toast sale de inmediato; Firestore se escribe
     en segundo plano. Nunca se espera a la red para ver el contenido. */
  /* ---------- Dirección guiada ----------
     País → Ciudad → Calle → Entre calles → Número (opcional). La
     dirección compuesta es la que se guarda (campo `address` de
     siempre) y la que se geocodifica; si la geocodificación falla, se
     guarda igual con el texto. Obligatorios: país, ciudad y calle.
     Las publicaciones viejas con dirección en texto libre se siguen
     mostrando igual (el campo `address` no cambió). */
  function composeAddress(country, city, street, between1, between2, number) {
    try {
      var c = String(country || '').trim();
      var ci = String(city || '').trim();
      var st = String(street || '').trim();
      if (!st || !ci || !c) return '';
      var out = st;
      var b1 = String(between1 || '').trim(), b2 = String(between2 || '').trim();
      if (b1 && b2) out += ' entre ' + b1 + ' y ' + b2;
      else if (b1) out += ' entre ' + b1;
      var num = String(number || '').trim().replace(/^#/, '');
      if (num) out += ', #' + num;
      out += ', ' + ci + ', ' + c;
      return out;
    } catch (e) { return ''; }
  }
  function addressFieldsOf(f) {
    try {
      var v = function (n) { try { return (f.elements[n] ? (f.elements[n].value || '') : ''); } catch (e) { return ''; } };
      return { country: v('country'), city: v('city'), street: v('street'), between1: v('between1'), between2: v('between2'), number: v('number') };
    } catch (e) { return { country: '', city: '', street: '', between1: '', between2: '', number: '' }; }
  }
  function syncAddressForm(formId, previewId) {
    try {
      var f = document.getElementById(formId); if (!f) return;
      var a = addressFieldsOf(f);
      var addr = composeAddress(a.country, a.city, a.street, a.between1, a.between2, a.number);
      var hidden = f.elements['address']; if (hidden) hidden.value = addr;
      var pv = document.getElementById(previewId);
      if (pv) pv.textContent = addr ? ('📍 ' + addr) : '';
    } catch (e) {}
  }
  /* Selectores de pin de los formularios (se crean en la sección del
     mapa) y el del overlay "Ubicar en el mapa". */
  var partyPicker = null, bizPicker = null, locatePicker = null;
  var locateTarget = null;
  [['partyForm', 'partyAddressPreview'], ['bizForm', 'bizAddressPreview']].forEach(function (pair) {
    try {
      var f = document.getElementById(pair[0]); if (!f) return;
      ['country', 'city', 'street', 'between1', 'between2', 'number'].forEach(function (n) {
        var el = f.elements[n]; if (!el) return;
        el.addEventListener('input', function () { syncAddressForm(pair[0], pair[1]); scheduleAddressGeocode(pair[0]); });
        el.addEventListener('change', function () { syncAddressForm(pair[0], pair[1]); scheduleAddressGeocode(pair[0]); });
      });
      syncAddressForm(pair[0], pair[1]);
    } catch (e) {}
  });

  $('#partyForm').addEventListener('submit', function (e) {
    e.preventDefault();
    try {
      if (!guardAction()) return;
      var u = currentUser(); if (!u) { toast('Primero regístrate en Cuenta'); showTab('cuenta'); return; }
      if (!guardSuspended()) return;
      var f = e.target;
      /* Validación en JS (el form lleva novalidate): la validación
         nativa del navegador bloqueaba el envío en silencio. */
      var desc = (f.elements['desc'].value || '').trim();
      var place = (f.elements['place'].value || '').trim();
      var af = addressFieldsOf(f);
      var address = composeAddress(af.country, af.city, af.street, af.between1, af.between2, af.number) || (f.elements['address'] ? (f.elements['address'].value || '').trim() : '');
      var date = f.elements['date'].value || '';
      var time = f.elements['time'].value || '';
      if (!desc) { toast('Pon la descripción de la fiesta'); return; }
      if (!place) { toast('Pon el lugar de la fiesta'); return; }
      /* Dirección: vale la compuesta por los campos guiados o una ya
         escrita en el campo de dirección (compatibilidad). */
      if (!address) {
        if (!af.street) { toast('Pon la calle de la fiesta'); return; }
        if (!af.city) { toast('Pon la ciudad de la fiesta'); return; }
        if (!af.country) { toast('Pon el país de la fiesta'); return; }
        toast('Pon la dirección de la fiesta'); return;
      }
      if (!date) { toast('Pon la fecha de la fiesta'); return; }
      if (!time) { toast('Pon la hora de la fiesta'); return; }
      var capRaw = (f.elements['capacity'] ? f.elements['capacity'].value : '').trim();
      var capNum = parseInt(capRaw, 10);
      var obj = { id: uid(), desc: desc, place: place, address: address, date: date, time: time, price: (f.elements['price'].value || '').trim(), contact: (f.elements['contact'].value || '').trim(), category: f.elements['category'].value || 'Fiesta', by: u.name, byId: profileIdOf(u), at: Date.now(), pending: isCloud(),
        reservePhone: normalizePhone(f.elements['reservePhone'] ? f.elements['reservePhone'].value : ''),
        reserveIg: (f.elements['reserveIg'] ? (f.elements['reserveIg'].value || '') : '').trim(),
        addrStreet: af.street, addrCity: af.city, addrCountry: af.country };
      if (isFinite(capNum) && capNum > 0) obj.capacity = Math.min(capNum, 1000);
      if (partyFlyerData) { obj.flyer = partyFlyerData; obj.flyerAt = Date.now(); if (partyFlyerThumb) obj.flyerThumb = partyFlyerThumb; }
      var pinPos = partyPicker && partyPicker.getPos();
      if (pinPos) { obj.lat = pinPos.lat; obj.lng = pinPos.lng; }
      var list = parties(); list.unshift(obj);
      var ok = saveSync('pegaoxl_parties', list);
      if (!ok && obj.flyer) {
        /* El flyer fallido nunca bloquea la publicación: sale sin flyer. */
        delete obj.flyer; delete obj.flyerAt; delete obj.flyerThumb;
        saveSync('pegaoxl_parties', list);
        toast('El flyer no cabía en este teléfono, se publicó sin flyer');
      }
      partyFlyerData = null; partyFlyerThumb = null;
      var pv = $('#partyFlyerPreview'); if (pv) pv.innerHTML = '';
      var pi = $('#partyFlyerInput'); if (pi) pi.value = '';
      f.reset(); syncAddressForm('partyForm', 'partyAddressPreview'); renderFeed(); renderMapMarkers();
      if (partyPicker) partyPicker.reset(ARTEMISA_CENTER);
      clearLastError(); renderLastError();
      toast('¡Fiesta publicada! 🎉'); showTab('feed');
      geocodeAndSave('parties', 'pegaoxl_parties', obj);
      ensureThumbForPost('fiesta', obj);
      if (isCloud()) {
        var p = cloudPut('parties', obj);
        if (p && p.catch) p.catch(function () {
          /* Si la nube rechaza (p. ej. flyer muy grande), reintenta sin flyer. */
          try {
            var o2 = toCloud(obj); delete o2.flyer; delete o2.flyerAt;
            db.collection('parties').doc(obj.id).set(o2).catch(function () {});
          } catch (err) {}
        });
      }
    } catch (err) { reportError('publicar fiesta', err); }
  });
  $('#bizForm').addEventListener('submit', function (e) {
    e.preventDefault();
    try {
      if (!guardAction()) return;
      var u = currentUser(); if (!u) { toast('Primero regístrate en Cuenta'); showTab('cuenta'); return; }
      if (!guardSuspended()) return;
      var f = e.target;
      /* Validación en JS (el form lleva novalidate): la validación
         nativa del navegador bloqueaba el envío en silencio. */
      var name = (f.elements['name'].value || '').trim();
      var services = (f.elements['services'].value || '').trim();
      var place = (f.elements['place'].value || '').trim();
      var af = addressFieldsOf(f);
      var address = composeAddress(af.country, af.city, af.street, af.between1, af.between2, af.number) || (f.elements['address'] ? (f.elements['address'].value || '').trim() : '');
      if (!name) { toast('Pon el nombre del negocio'); return; }
      if (!services) { toast('Pon los servicios del negocio'); return; }
      if (!place) { toast('Pon el lugar del negocio'); return; }
      /* Dirección: vale la compuesta por los campos guiados o una ya
         escrita en el campo de dirección (compatibilidad). */
      if (!address) {
        if (!af.street) { toast('Pon la calle del negocio'); return; }
        if (!af.city) { toast('Pon la ciudad del negocio'); return; }
        if (!af.country) { toast('Pon el país del negocio'); return; }
        toast('Pon la dirección del negocio'); return;
      }
      var description = (f.elements['description'] ? (f.elements['description'].value || '') : '').trim();
      var obj = { id: uid(), name: name, services: services, description: description, place: place, address: address, contact: (f.elements['contact'].value || '').trim(), category: f.elements['category'].value || 'Otro', by: u.name, byId: profileIdOf(u), at: Date.now(), pending: isCloud(),
        reservePhone: normalizePhone(f.elements['reservePhone'] ? f.elements['reservePhone'].value : ''),
        reserveIg: (f.elements['reserveIg'] ? (f.elements['reserveIg'].value || '') : '').trim(),
        openTime: (f.elements['openTime'] ? (f.elements['openTime'].value || '') : '').trim(),
        closeTime: (f.elements['closeTime'] ? (f.elements['closeTime'].value || '') : '').trim(),
        addrStreet: af.street, addrCity: af.city, addrCountry: af.country };
      if (bizFlyerData) { obj.flyer = bizFlyerData; obj.flyerAt = Date.now(); if (bizFlyerThumb) obj.flyerThumb = bizFlyerThumb; }
      if (bizPhotosData.length) { obj.photos = bizPhotosData.slice(); if (bizPhotosThumbs[0]) obj.photoThumb = bizPhotosThumbs[0]; }
      if (bizServicesData.length) obj.servicesList = bizServicesData.map(function (s) { return { id: s.id, name: s.name, price: s.price, desc: s.desc, photo: s.photo || null }; });
      var pinPos = bizPicker && bizPicker.getPos();
      if (pinPos) { obj.lat = pinPos.lat; obj.lng = pinPos.lng; }
      var list = businesses(); list.unshift(obj);
      var ok = saveSync('pegaoxl_businesses', list);
      if (!ok && (obj.photos || obj.servicesList)) {
        /* Las fotos no caben en este teléfono: se publican el negocio
           y sus productos, sin las fotos (el flyer ya tiene su propio
           plan de retirada más abajo). */
        delete obj.photos; delete obj.photoThumb;
        if (obj.servicesList) obj.servicesList.forEach(function (s) { delete s.photo; });
        saveSync('pegaoxl_businesses', list);
        ok = true;
        toast('Las fotos no cabían en este teléfono, se publicó sin fotos');
      }
      if (!ok && obj.flyer) {
        /* El flyer fallido nunca bloquea la publicación: sale sin flyer. */
        delete obj.flyer; delete obj.flyerAt; delete obj.flyerThumb;
        saveSync('pegaoxl_businesses', list);
        toast('El flyer no cabía en este teléfono, se publicó sin flyer');
      }
      bizFlyerData = null; bizFlyerThumb = null; bizPhotosData = []; bizPhotosThumbs = []; bizServicesData = [];
      renderBizPhotosPreview(); renderBizServicesList();
      var pv = $('#bizFlyerPreview'); if (pv) pv.innerHTML = '';
      var pi = $('#bizFlyerInput'); if (pi) pi.value = '';
      f.reset(); syncAddressForm('bizForm', 'bizAddressPreview'); renderFeed(); renderMapMarkers();
      if (bizPicker) bizPicker.reset(ARTEMISA_CENTER);
      clearLastError(); renderLastError();
      toast('¡Negocio publicado! 🏪'); showTab('feed');
      geocodeAndSave('businesses', 'pegaoxl_businesses', obj);
      ensureThumbForPost('negocio', obj);
      if (isCloud()) {
        var p = cloudPut('businesses', obj);
        if (p && p.catch) p.catch(function () {
          try {
            /* Firestore no acepta documentos de más de 1 MB: si el
               negocio con fotos no entra, se reintenta sin ninguna
               imagen (los productos quedan con nombre y precio). */
            var o2 = toCloud(obj); delete o2.flyer; delete o2.flyerAt; delete o2.photos;
            if (o2.servicesList) o2.servicesList.forEach(function (s) { delete s.photo; });
            db.collection('businesses').doc(obj.id).set(o2).catch(function () {});
          } catch (err) {}
        });
      }
    } catch (err) { reportError('publicar negocio', err); }
  });

  /* ---------- Reseñas (estrellas), comentarios y compartir ----------
     Una reseña por usuario y publicación: guardar de nuevo la actualiza.
     Los comentarios son libres, uno por publicación. Compartir abre un
     panel con WhatsApp, Facebook, Instagram, Más opciones y Copiar
     texto; todo gratis, sin plugins nuevos, solo enlaces web. */
  function ratingFor(kind, id) {
    var list = reviews().filter(function (r) { return r.targetKind === kind && r.targetId === id; });
    if (!list.length) return { avg: 0, count: 0 };
    var sum = 0; list.forEach(function (r) { sum += r.stars || 0; });
    return { avg: sum / list.length, count: list.length };
  }
  function ratingLine(kind, id) {
    var r = ratingFor(kind, id);
    if (!r.count) return 'Sin reseñas aún';
    return '★ ' + r.avg.toFixed(1) + ' · ' + r.count + (r.count === 1 ? ' reseña' : ' reseñas');
  }
  function myReview(kind, id) {
    var u = currentUser(); if (!u) return null;
    return reviews().find(function (r) { return r.targetKind === kind && r.targetId === id && r.by === u.name; }) || null;
  }
  /* Reseña optimista: se ve al instante; la nube va por detrás. */
  function saveReview(kind, id, stars, text) {
    if (!guardAction()) return;
    if (!guardSuspended()) return;
    var u = currentUser();
    if (!u) { toast('Regístrate con Google para dejar tu reseña'); showTab('cuenta'); return; }
    var mine = myReview(kind, id);
    var obj = mine || { id: uid(), targetKind: kind, targetId: id, by: u.name, byId: profileIdOf(u) };
    obj.stars = stars; obj.text = text; obj.at = Date.now(); obj.pending = isCloud();
    var list = reviews();
    if (!mine) list.unshift(obj);
    save('pegaoxl_reviews', list);
    renderFeed(); renderReputation();
    toast(mine ? 'Reseña actualizada' : 'Reseña guardada');
    recordTasteForTarget(kind, id, stars);
    if (isCloud()) cloudPut('reviews', obj);
  }
  /* Comentario optimista: se ve al instante; la nube va por detrás. */
  function saveComment(kind, id, text) {
    if (!guardAction()) return;
    if (!guardSuspended()) return;
    var u = currentUser();
    if (!u) { toast('Regístrate con Google para comentar'); showTab('cuenta'); return; }
    var obj = { id: uid(), targetKind: kind, targetId: id, by: u.name, byId: profileIdOf(u), text: text, at: Date.now(), pending: isCloud() };
    var list = comments();
    list.unshift(obj);
    save('pegaoxl_comments', list);
    renderFeed();
    toast('Comentario publicado');
    recordTasteForTarget(kind, id, 2);
    if (isCloud()) cloudPut('comments', obj);
  }
  /* Enlace para compartir: la página del Worker
     https://pegao-xl-feed.pegaonysupernova.workers.dev/post/<id> sirve
     esa publicación con sus etiquetas Open Graph (título, fecha, lugar
     y la imagen del flyer), así al compartir se ve la foto de lo que
     se comparte y no el logo genérico. El enlace viejo de GitHub Pages
     (?post=<id>) sigue funcionando al abrirlo (ver postIdFromUrl). */
  var PEGAO_SHARE_WORKER = 'https://pegao-xl-feed.pegaonysupernova.workers.dev/post/';
  function shareLinkFor(kind, id) {
    if (!id) return window.PEGAO_SHARE_BASE || window.PEGAO_WEB_URL || '';
    return PEGAO_SHARE_WORKER + encodeURIComponent(id);
  }
  /* El texto compartido: nombre, fecha y lugar, y el enlace. Se lee
     natural, no como un anuncio. */
  function shareTextFor(kind, id) {
    var base = null, link = shareLinkFor(kind, id);
    if (kind === 'fiesta') {
      var p = parties().find(function (x) { return x.id === id; }); if (!p) return null;
      base = p.desc + '\n📍 ' + p.place + (p.date ? ' · ' + fmtDateEs(p.date) : '') + (p.time ? ', ' + p.time : '') + (p.price ? ' · ' + p.price : '');
      return link ? (base + '\nMírala en PEGAO XL: ' + link) : base;
    } else if (kind === 'negocio') {
      var b = businesses().find(function (x) { return x.id === id; }); if (!b) return null;
      base = b.name + '\n📍 ' + b.place + (b.services ? ' · ' + b.services : '');
      return link ? (base + '\nMíralo en PEGAO XL: ' + link) : base;
    }
    return null;
  }
  /* ¿Puede este teléfono compartir archivos (p. ej. el flyer como
     imagen) con navigator.share? Si no, se comparte solo texto. */
  function canShareFiles(file) {
    try { return !!(navigator.share && navigator.canShare && file && navigator.canShare({ files: [file] })); } catch (e) { return false; }
  }
  /* Comparte la publicación COMPLETA: el archivo del flyer + el texto
     con enlace. Devuelve una promesa que resuelve true si se compartió
     con archivos, false si hay que usar el camino de solo texto. */
  function shareWithFiles(kind, id) {
    try {
      var text = shareTextFor(kind, id);
      if (!text) return Promise.resolve(false);
      var target = targetOf(kind, id);
      /* La caducidad del flyer manda solo en lo que se MUESTRA en el
         feed: la imagen sigue siendo válida para enviarla por WhatsApp,
         así que aquí basta con que la publicación tenga flyer. */
      if (!target || !target.flyer) return Promise.resolve(false);
      if (!navigator.share) return Promise.resolve(false);
      return dataUrlToFile(target.flyer, 'flyer-pegaoxl.jpg').then(function (file) {
        if (!file || !canShareFiles(file)) return false;
        return navigator.share({ title: 'PEGAO XL', text: text, files: [file] }).then(function () { return true; }).catch(function () { return false; });
      });
    } catch (e) { return Promise.resolve(false); }
  }
  /* El archivo del flyer como File (para adjuntarlo al compartir).
     null si la publicación no tiene flyer o no se pudo convertir. */
  function flyerFile(kind, id) {
    try {
      var target = targetOf(kind, id);
      if (!target || !target.flyer) return Promise.resolve(null);
      return dataUrlToFile(target.flyer, 'flyer-pegaoxl.jpg');
    } catch (e) { return Promise.resolve(null); }
  }
  function shareTarget(kind, id) {
    /* "Más opciones": la hoja del sistema con todas las apps instaladas.
       Si el teléfono no la tiene, se dice claro y se sugiere Copiar texto. */
    var text = shareTextFor(kind, id); if (!text) return;
    if (navigator.share) { navigator.share({ title: 'PEGAO XL', text: text }).catch(function () {}); return; }
    toast('Tu teléfono no tiene la hoja de compartir, usa Copiar texto');
  }
  function copyText(text, msg) {
    var done = msg || 'Copiado para compartir';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { toast(done); })
        .catch(function () { legacyCopy(text, done); });
      return;
    }
    legacyCopy(text, done);
  }
  function legacyCopy(text, msg) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(msg || 'Copiado para compartir'); }
    catch (e) { toast('No se pudo copiar, inténtalo de nuevo'); }
    document.body.removeChild(ta);
  }
  /* Compartir en una red concreta, desde el panel de la tarjeta.
     El enlace compartido es el del Worker (shareLinkFor): la página
     lleva las etiquetas Open Graph de ESA publicación, así se ve su
     flyer. WhatsApp, Estado de WhatsApp, Instagram y "Más opciones"
     adjuntan el ARCHIVO del flyer cuando la publicación lo tiene y el
     teléfono lo permite; si no, comparten solo texto + enlace, sin
     romper. Facebook comparte el enlace con el texto como cita.
     Instagram no acepta texto directo por enlace: sin imagen se copia
     el texto y se abre Instagram para pegarlo ahí. */
  var PEGAO_INSTAGRAM_URL = 'https://www.instagram.com/pegaoxl';
  function handleShareOption(kind, id, option) {
    recordTasteForTarget(kind, id, 2);
    var text = shareTextFor(kind, id); if (!text) return;
    if (option === 'whatsapp') {
      /* Con flyer y si el teléfono lo permite: imagen + texto + enlace.
         Si no: texto + enlace por wa.me, como antes. */
      shareWithFiles(kind, id).then(function (shared) {
        if (!shared) window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      });
    } else if (option === 'whatsapp-status') {
      /* Estado de WhatsApp: la imagen del flyer + texto + enlace por la
         hoja del sistema (ahí se elige "WhatsApp Status"). Sin imagen
         o sin soporte, la hoja con solo texto + enlace. */
      flyerFile(kind, id).then(function (file) {
        if (file && canShareFiles(file)) {
          navigator.share({ title: 'PEGAO XL', text: text, files: [file] }).catch(function () {});
        } else {
          shareTarget(kind, id);
        }
      });
    } else if (option === 'facebook') {
      var url = shareLinkFor(kind, id) || PEGAO_INSTAGRAM_URL;
      window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url) + '&quote=' + encodeURIComponent(text), '_blank');
    } else if (option === 'instagram') {
      /* Con flyer y si el teléfono lo permite: la imagen + texto por la
         hoja del sistema (ahí se elige Instagram). Si no: se copia el
         texto y se abre Instagram, como antes. */
      flyerFile(kind, id).then(function (file) {
        if (file && canShareFiles(file)) {
          navigator.share({ title: 'PEGAO XL', text: text, files: [file] }).catch(function () {});
        } else {
          copyText(text, 'Texto copiado, pégalo en Instagram');
          window.open('https://www.instagram.com/', '_blank');
        }
      });
    } else if (option === 'system') {
      shareWithFiles(kind, id).then(function (shared) {
        if (!shared) shareTarget(kind, id);
      });
    } else if (option === 'copy') {
      copyText(text);
    }
    openPanels[kind + ':' + id] = undefined;
    renderPanel(kind, id);
  }

  /* ---------- Enlace profundo: abrir la publicación compartida ----------
     Un enlace https://pegaony.github.io/pegao-xl/?post=<id> abre la app
     (App Link) pero la app lo ignoraba y solo abría el Feed. Ahora se
     lee el ?post=, se guarda la id pendiente y, cuando el feed ya tiene
     los datos, se baja hasta esa tarjeta y se marca un momento.
     Si aún no hay registro, la app sigue abriendo el registro primero
     (la id queda guardada) y al registrarse se muestra la publicación.
     Si la publicación no aparece al cabo de unos segundos, se avisa y
     se sigue con el feed normal. Todo va con try/catch: sin el plugin
     App la app arranca igual. */
  var PENDING_POST_KEY = 'pegaoxl_pending_post';
  var PENDING_POST_WAIT_MS = 10000; /* lo que tarda la nube en un teléfono nuevo */
  var PENDING_POST_MAX_AGE_MS = 10 * 60 * 1000; /* enlaces viejos no roban la pantalla */
  var pendingPostId = null, pendingPostSince = 0, pendingPostDone = false, highlightedPost = null;
  function capacitorApp() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null; }
    catch (e) { return null; }
  }
  function postIdFromUrl(url) {
    try {
      if (!url) return null;
      var s = String(url);
      /* Enlace nuevo del Worker: /post/<id>. */
      var m = s.match(/\/post\/([^?&#\/]+)/);
      if (m) {
        var id2 = decodeURIComponent(m[1] || '').trim();
        if (id2) return id2;
      }
      /* Enlace viejo de GitHub Pages: ?post=<id>. */
      var q = s.split('?')[1] || '';
      var m2 = q.match(/(?:^|&)post=([^&#]*)/);
      if (!m2) return null;
      var id = decodeURIComponent(m2[1] || '').trim();
      return id || null;
    } catch (e) { return null; }
  }
  function setPendingPost(id) {
    try {
      if (!id) return;
      pendingPostId = id; pendingPostSince = Date.now(); pendingPostDone = false;
      save(PENDING_POST_KEY, { id: id, at: Date.now() });
    } catch (e) {}
  }
  function clearPendingPost() {
    try { pendingPostId = null; pendingPostDone = false; removeStored(PENDING_POST_KEY); } catch (e) {}
  }
  function loadPendingPost() {
    try {
      var rec = load(PENDING_POST_KEY, null);
      if (!rec || !rec.id) return;
      if (rec.at && (Date.now() - rec.at) > PENDING_POST_MAX_AGE_MS) { removeStored(PENDING_POST_KEY); return; }
      pendingPostId = rec.id; pendingPostSince = rec.at || Date.now(); pendingPostDone = false;
    } catch (e) {}
  }
  function findPostKind(id) {
    try {
      if (parties().some(function (x) { return x.id === id; })) return 'fiesta';
      if (businesses().some(function (x) { return x.id === id; })) return 'negocio';
    } catch (e) {}
    return null;
  }
  function highlightPostCard(kind, id) {
    try {
      var el = document.getElementById('post-' + kind + '-' + id);
      if (!el) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('post-highlight');
      highlightedPost = { kind: kind, id: id, until: Date.now() + 4000 };
      setTimeout(function () {
        try {
          var cur = document.getElementById('post-' + kind + '-' + id);
          if (cur) cur.classList.remove('post-highlight');
        } catch (e) {}
        if (highlightedPost && highlightedPost.id === id) highlightedPost = null;
      }, 4000);
      return true;
    } catch (e) { return false; }
  }
  /* Un repintado del feed (otro snapshot llegando tarde) no debe borrar
     el resaltado: mientras dura la ventana de 4 s, cada render vuelve a
     marcar la tarjeta, sin volver a hacer scroll. */
  function reapplyHighlight() {
    try {
      if (!highlightedPost || Date.now() > highlightedPost.until) return;
      var el = document.getElementById('post-' + highlightedPost.kind + '-' + highlightedPost.id);
      if (el) el.classList.add('post-highlight');
    } catch (e) {}
  }
  function tryShowPendingPost() {
    try {
      if (!pendingPostId || pendingPostDone) return;
      if (!currentUser()) return; /* sin registro, se espera: la id queda guardada */
      var kind = findPostKind(pendingPostId);
      if (kind) {
        var el = document.getElementById('post-' + kind + '-' + pendingPostId);
        if (!el) {
          /* La publicación existe pero un filtro la esconde: se quitan
             los filtros y se pinta el feed de nuevo. */
          var s = $('#feedSearch'); if (s) s.value = '';
          var f = $('#feedFilter'); if (f) f.value = 'todo';
          var c = $('#feedCategory'); if (c) c.value = 'todas';
          renderFeed();
          el = document.getElementById('post-' + kind + '-' + pendingPostId);
        }
        if (el) {
          showTab('feed');
          var k2 = kind, id2 = pendingPostId;
          setTimeout(function () { highlightPostCard(k2, id2); }, 120);
          clearPendingPost();
          return;
        }
        /* La tarjeta no apareció ni sin filtros: se sigue esperando. */
      }
      /* Aún no llegó: se espera al snapshot (la nube tarda unos segundos
         en un teléfono nuevo). Pasado el plazo, se avisa y se sigue con
         el feed normal. */
      if (Date.now() - pendingPostSince > PENDING_POST_WAIT_MS) {
        pendingPostDone = true;
        toast('Esa publicación ya no está disponible');
        clearPendingPost();
      }
    } catch (e) {}
  }
  function handleIncomingUrl(url) {
    try {
      var id = postIdFromUrl(url);
      if (id) setPendingPost(id);
      tryShowPendingPost();
    } catch (e) {}
  }
  function initDeepLink() {
    try {
      loadPendingPost(); /* sobrevive al registro: primero Cuenta, luego el post */
      var app = capacitorApp();
      if (app) {
        if (app.addListener) app.addListener('appUrlOpen', function (data) {
          try { handleIncomingUrl(data && data.url); } catch (e) {}
        });
        if (app.getLaunchUrl) app.getLaunchUrl().then(function (res) {
          try { handleIncomingUrl(res && res.url); } catch (e) {}
        }).catch(function () {});
      }
      /* Sin plugin (navegador): el enlace también puede llegar como URL
         de la página. */
      handleIncomingUrl(window.location && window.location.href);
    } catch (e) {}
  }

  /* Paneles dentro de la tarjeta: un solo panel abierto por publicación
     ('review', 'comment' o 'share'). Se reconstruyen al re-renderizar. */
  var openPanels = {}; /* "fiesta:<id>" -> 'review' | 'comment' | 'share' */
  var panelStars = {}; /* "fiesta:<id>" -> 1..5 elegidas */
  function togglePanel(kind, id, mode) {
    if ((mode === 'review' || mode === 'comment') && !guardAction()) return;
    var k = kind + ':' + id;
    var opening = openPanels[k] !== mode;
    openPanels[k] = opening ? mode : undefined;
    if (opening) recordTasteForTarget(kind, id, 2); /* abrir una publicación enseña gustos */
    renderPanel(kind, id);
  }
  function renderPanel(kind, id) {
    var box = document.getElementById('panel-' + kind + '-' + id);
    if (!box) return;
    var mode = openPanels[kind + ':' + id];
    if (!mode) { box.innerHTML = ''; return; }
    if (mode === 'review') box.innerHTML = reviewPanelHtml(kind, id);
    else if (mode === 'comment') box.innerHTML = commentPanelHtml(kind, id);
    else box.innerHTML = sharePanelHtml(kind, id);
    bindPanel(kind, id, mode);
  }
  function restorePanels() {
    Object.keys(openPanels).forEach(function (k) {
      if (!openPanels[k]) return;
      var parts = k.split(':');
      renderPanel(parts[0], parts[1]);
    });
  }
  function reviewPanelHtml(kind, id) {
    var u = currentUser();
    if (!u) return '<p class="muted">Regístrate con Google para dejar tu reseña.</p>';
    var mine = myReview(kind, id);
    var sel = panelStars[kind + ':' + id] || (mine ? mine.stars : 0);
    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<button type="button" class="star-btn' + (i <= sel ? ' on' : '') + '" data-star="' + i + '" aria-label="' + i + ' estrellas">★</button>';
    }
    return '<p class="panel-title">' + (mine ? 'Tu reseña (puedes actualizarla)' : 'Deja tu reseña') + '</p>' +
      '<div class="stars-row">' + stars + '</div>' +
      '<textarea class="panel-text" rows="2" maxlength="300" placeholder="Cuenta tu experiencia (opcional)">' + esc(mine ? mine.text : '') + '</textarea>' +
      '<button type="button" class="btn-primary panel-save" data-save-review="' + kind + ':' + id + '">' + (mine ? 'Actualizar reseña' : 'Guardar reseña') + '</button>';
  }
  function commentPanelHtml(kind, id) {
    var u = currentUser();
    var list = comments().filter(function (c) { return c.targetKind === kind && c.targetId === id; });
    var html = '<p class="panel-title">Comentarios</p>';
    if (!list.length) html += '<p class="muted">Sé el primero en comentar.</p>';
    else html += '<div class="comment-list">' + list.map(function (c) {
      return '<p class="comment-item"><strong>' + esc(c.by) + ':</strong> ' + esc(c.text) + '</p>';
    }).join('') + '</div>';
    if (u) {
      html += '<textarea class="panel-text" rows="2" maxlength="300" placeholder="Escribe tu comentario"></textarea>' +
        '<button type="button" class="btn-primary panel-save" data-publish-comment="' + kind + ':' + id + '">Publicar comentario</button>';
    } else {
      html += '<p class="muted">Regístrate con Google para comentar.</p>';
    }
    return html;
  }
  /* Código QR del enlace profundo (librería qrcode-generator vendida
     en www/qrcode.min.js, sin CDN: funciona sin conexión). Dibuja el
     QR en un <canvas> con fondo blanco. Devuelve true si se pudo. */
  function drawQR(canvas, text) {
    try {
      if (!canvas || !text || typeof qrcode === 'undefined') return false;
      var qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      var n = qr.getModuleCount();
      var size = 200, cell = size / n;
      canvas.width = size; canvas.height = size;
      var ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
        }
      }
      return true;
    } catch (e) { return false; }
  }
  function sharePanelHtml(kind, id) {
    var t = kind + ':' + id;
    var btn = function (opt, label) {
      return '<button type="button" class="btn-secondary" data-share-option="' + opt + '" data-share-target="' + t + '">' + label + '</button>';
    };
    return '<p class="panel-title">Compartir en</p>' +
      '<div class="share-options">' +
      btn('whatsapp', 'WhatsApp') +
      btn('whatsapp-status', '📱 Estado de WhatsApp') +
      btn('facebook', 'Facebook') +
      btn('instagram', 'Instagram') +
      btn('system', 'Más opciones') +
      btn('copy', 'Copiar texto') +
      '</div>' +
      '<button type="button" class="btn-secondary" data-share-qr="' + t + '" style="margin-top:8px">📷 Código QR</button>' +
      '<div class="qr-box hidden" id="qr-panel-' + kind + '-' + id + '"><canvas width="200" height="200"></canvas><p>Escanea con la cámara para abrir esta publicación en PEGAO XL.</p></div>';
  }
  function bindPanel(kind, id, mode) {
    var box = document.getElementById('panel-' + kind + '-' + id);
    if (!box) return;
    Array.prototype.slice.call(box.querySelectorAll('[data-share-option]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-share-target').split(':');
        handleShareOption(p[0], p[1], b.getAttribute('data-share-option'));
      });
    });
    var qrBtn = box.querySelector('[data-share-qr]');
    if (qrBtn) qrBtn.addEventListener('click', function () {
      var p = qrBtn.getAttribute('data-share-qr').split(':');
      var qrBox = document.getElementById('qr-panel-' + p[0] + '-' + p[1]);
      if (!qrBox) return;
      var showing = !qrBox.classList.contains('hidden');
      qrBox.classList.toggle('hidden', showing);
      if (!showing) {
        var cv = qrBox.querySelector('canvas');
        if (!drawQR(cv, shareLinkFor(p[0], p[1]))) qrBox.innerHTML = '<p class="muted">No se pudo generar el código QR en este teléfono.</p>';
      }
    });
    Array.prototype.slice.call(box.querySelectorAll('[data-star]')).forEach(function (b) {
      b.addEventListener('click', function () {
        panelStars[kind + ':' + id] = parseInt(b.getAttribute('data-star'), 10);
        renderPanel(kind, id);
      });
    });
    var saveBtn = box.querySelector('[data-save-review]');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var mine = myReview(kind, id);
      var stars = panelStars[kind + ':' + id] || (mine ? mine.stars : 0);
      if (!stars) { toast('Elige de 1 a 5 estrellas'); return; }
      var ta = box.querySelector('.panel-text');
      saveReview(kind, id, stars, ta ? ta.value.trim() : '');
    });
    var pubBtn = box.querySelector('[data-publish-comment]');
    if (pubBtn) pubBtn.addEventListener('click', function () {
      var ta = box.querySelector('.panel-text');
      var text = ta ? ta.value.trim() : '';
      if (!text) { toast('Escribe tu comentario'); return; }
      saveComment(kind, id, text);
    });
  }
  function bindCardButtons(root) {
    /* Con ámbito: cada render enlaza solo sus propias tarjetas, si no
       el mismo botón quedaría con dos listeners y el panel se
       abriría y se cerraría en el mismo clic. */
    var scope = root || document;
    Array.prototype.slice.call(scope.querySelectorAll('[data-review]')).forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-review').split(':'); togglePanel(p[0], p[1], 'review'); }); });
    Array.prototype.slice.call(scope.querySelectorAll('[data-comment]')).forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-comment').split(':'); togglePanel(p[0], p[1], 'comment'); }); });
    Array.prototype.slice.call(scope.querySelectorAll('[data-share]')).forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-share').split(':'); togglePanel(p[0], p[1], 'share'); }); });
  }

  /* ---------- Mapa (carga perezosa) ----------
     Leaflet solo se descarga la primera vez que se abre la pestaña
     Mapa, nunca al arrancar: el arranque no espera al mapa. Antes de
     eso hay un placeholder con un botón para cargarlo. */
  var leafletState = 'idle', leafletWaiters = [];
  function loadLeaflet() {
    if (typeof L !== 'undefined') { leafletState = 'ready'; return Promise.resolve(true); } /* ya cargado: no se descarga otra vez */
    if (leafletState === 'ready') return Promise.resolve(true);
    if (leafletState === 'loading') return new Promise(function (res) { leafletWaiters.push(res); });
    leafletState = 'loading';
    return new Promise(function (resolve) {
      var done = function (ok) {
        leafletState = ok ? 'ready' : 'failed';
        var w = leafletWaiters; leafletWaiters = [];
        w.forEach(function (f) { try { f(ok); } catch (e) {} });
        resolve(ok);
      };
      try {
        var link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
        var s = document.createElement('script');
        s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        s.onload = function () { done(typeof L !== 'undefined'); };
        s.onerror = function () { done(false); };
        document.head.appendChild(s);
        setTimeout(function () { if (leafletState === 'loading') done(typeof L !== 'undefined'); }, 15000);
      } catch (e) { done(false); }
    });
  }
  function ensureMap() {
    if (mapReady) { if (map) setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 100); return; }
    loadLeaflet().then(function (ok) {
      if (ok) { try { initMapInternal(); } catch (e) { showMapError(); } }
      else showMapError();
    });
  }
  function showMapError() {
    try {
      var el = $('#map');
      if (!el) return;
      el.innerHTML = '<div class="map-placeholder"><p>El mapa necesita internet para cargar. Revisa tu conexión y toca de nuevo.</p><button class="btn-primary" type="button" id="loadMapBtn2">Reintentar</button></div>';
      var b = $('#loadMapBtn2');
      if (b) b.addEventListener('click', function () { leafletState = 'idle'; ensureMap(); });
    } catch (e) {}
  }
  var loadMapBtn = $('#loadMapBtn');
  if (loadMapBtn) loadMapBtn.addEventListener('click', ensureMap);
  /* Capa base por zoom (gratis, sin clave): Esri para vista de mundo /
     país / ciudad (zoom <= 10, rápido y completo) y OpenTopoMap para
     calles de cerca (zoom > 10, donde Esri sale en blanco en Artemisa).
     OpenTopoMap llega hasta zoom 17 nativo; más allá se amplía la tesela. */
  function baseLayerForZoom(z) { return z <= 10 ? esriLayer : topoLayer; }
  function updateBaseLayer() {
    if (!map || !topoLayer || !esriLayer) return;
    var want = baseLayerForZoom(Math.round(map.getZoom()));
    if (baseLayer === want) return;
    if (baseLayer && map.hasLayer(baseLayer)) map.removeLayer(baseLayer);
    baseLayer = want;
    baseLayer.addTo(map);
  }
  /* Último recurso si la capa actual falla: se pasa a la otra, como mucho
     una vez cada 5 s (sin rebotes); el siguiente cambio de zoom vuelve a
     la capa que toca por zoom. */
  function swapBaseLayerOnError(layer) {
    if (!map || !baseLayer || layer !== baseLayer) return;
    var now = Date.now();
    if (now - baseLayerSwapAt < 5000) return;
    baseLayerSwapAt = now;
    var other = baseLayer === topoLayer ? esriLayer : topoLayer;
    if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer);
    baseLayer = other;
    baseLayer.addTo(map);
  }
  function currentBaseLayer() {
    if (baseLayer === esriLayer) return 'esri';
    if (baseLayer === topoLayer) return 'topo';
    return null;
  }
  function initMapInternal() {
    if (mapReady) return;
    if (typeof L === 'undefined') { showMapError(); return; }
    var el = $('#map');
    if (el) el.innerHTML = '';
    mapReady = true;
    map = L.map('map', { minZoom: 2, maxZoom: 19, worldCopyJump: true, zoomControl: false }).setView(ARTEMISA_CENTER, 12); // Artemisa, Cuba — vista inicial; al alejar se ve el mundo entero (zoom 2, sin límites)
    topoLayer = L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 17, attribution: '&copy; OpenStreetMap, SRTM' });
    esriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' });
    topoLayer.on('tileerror', function () { swapBaseLayerOnError(topoLayer); });
    esriLayer.on('tileerror', function () { swapBaseLayerOnError(esriLayer); });
    updateBaseLayer(); /* capa según el zoom inicial */
    L.control.zoom({ position: 'bottomright' }).addTo(map); /* abajo a la derecha, fuera del buscador y los chips */
    map.on('zoomend', updateBaseLayer);
    markersLayer = L.layerGroup().addTo(map);
    renderMapMarkers();
    locateMe(false);
  }
  /* ---------- Mapa estilo referencias (v15) ----------
     Pines con foto (círculo con la foto del negocio/fiesta, como en
     las referencias) en vez del pin genérico; al tocar un pin se abre
     la tarjeta flotante sobre el mapa, y "Ver" abre el detalle del
     negocio o baja hasta la fiesta en el feed. Los chips filtran qué
     publicaciones se ven. La fuente de datos, la geocodificación y
     las capas (Esri mundo / OpenTopoMap calles) no cambian. */
  var mapCatFilter = 'todas';
  var myLatLng = null;
  var mapCardKind = null, mapCardId = null;
  function pinPhotoFor(kind, x) {
    /* El pin y la tarjeta flotante usan la MINIATURA (≤96 px), nunca el
       flyer completo. Sin miniatura (publicación vieja), la letra
       inicial: el fallback ya existe en pinIconFor. */
    if (kind === 'negocio') {
      if (x.photoThumb) return x.photoThumb;
      if (x.flyerThumb) return x.flyerThumb;
      return null;
    }
    return x.flyerThumb || null;
  }
  function pinIconFor(kind, x) {
    var photo = pinPhotoFor(kind, x);
    var letter = esc(((kind === 'negocio' ? (x.name || 'N') : (x.desc || 'F')) + '').trim().charAt(0).toUpperCase() || '•');
    var inner = photo
      ? '<span class="map-pin-photo" style="background-image:url(\'' + esc(photo) + '\')"></span>'
      : '<span class="map-pin-letter">' + letter + '</span>';
    return L.divIcon({ className: 'map-pin-wrap', html: '<div class="map-pin ' + (kind === 'fiesta' ? 'pin-party' : 'pin-biz') + '">' + inner + '</div>', iconSize: [44, 54], iconAnchor: [22, 52], popupAnchor: [0, -50] });
  }
  function mapCatOf(kind, x) { return catOf(x, kind === 'fiesta' ? 'Fiesta' : 'Otro'); }
  function mapItemVisible(kind, x) {
    if (mapCatFilter === 'todas') return true;
    return mapCatOf(kind, x) === mapCatFilter;
  }
  function mapCardDistance(x) {
    if (!myLatLng || !isFinite(x.lat) || !isFinite(x.lng)) return null;
    var m = distMeters(myLatLng.lat, myLatLng.lng, x.lat, x.lng);
    return m < 1000 ? Math.round(m) + ' m de ti' : (m / 1000).toFixed(1) + ' km de ti';
  }
  function showMapCard(kind, x) {
    var card = $('#mapCard'); if (!card) return;
    mapCardKind = kind; mapCardId = x.id;
    var r = ratingFor(kind, x.id);
    var title = kind === 'fiesta' ? (x.desc || 'Fiesta') : (x.name || 'Negocio');
    var photo = pinPhotoFor(kind, x);
    var dist = mapCardDistance(x);
    var sub = [x.address || x.place || '', dist].filter(function (s) { return !!s; }).join(' · ');
    var html = '<button class="map-card-close" id="mapCardClose" type="button" aria-label="Cerrar">×</button>' +
      (photo ? '<img class="map-card-photo" src="' + esc(photo) + '" alt="">' : '') +
      '<div class="map-card-body"><strong>' + esc(title) + '</strong>' +
      '<span class="map-card-tags"><span class="tag tag-cat">' + esc(mapCatOf(kind, x)) + '</span>' +
      '<span class="map-card-stars">★ ' + (r.count ? r.avg.toFixed(1) + ' · ' + r.count + (r.count === 1 ? ' reseña' : ' reseñas') : 'Sin reseñas') + '</span></span>' +
      (sub ? '<span class="map-card-sub">' + esc(sub) + '</span>' : '') +
      '<button class="btn-primary map-card-view" id="mapCardView" type="button">Ver</button></div>';
    card.innerHTML = html;
    card.classList.remove('hidden');
    $('#mapCardClose').addEventListener('click', hideMapCard);
    $('#mapCardView').addEventListener('click', function () {
      var k = mapCardKind, id = mapCardId;
      hideMapCard();
      if (k === 'negocio') { openBizDetail(id); return; }
      showTab('feed');
      setTimeout(function () {
        var el = document.getElementById('post-fiesta-' + id);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('post-highlight'); setTimeout(function () { el.classList.remove('post-highlight'); }, 3200); }
      }, 300);
    });
  }
  function hideMapCard() {
    var card = $('#mapCard'); if (!card) return;
    card.classList.add('hidden'); card.innerHTML = '';
    mapCardKind = null; mapCardId = null;
  }
  function renderMapMarkers() {
    if (!map || !markersLayer) return;
    markersLayer.clearLayers();
    /* El mapa muestra TODOS los lugares guardados, de cualquier país:
       no hay filtro por país. Solo publicaciones CON coordenadas
       reales van al mapa; las que aún no tienen ubicación no se
       muestran. Un pin en el centro de Artemisa era una ubicación
       falsa. Al alejar (zoom 2) se ve el mundo entero y se puede
       desplazar a cualquier país. */
    parties().forEach(function (p) {
      if (!mapItemVisible('fiesta', p)) return;
      if (!isFinite(p.lat) || !isFinite(p.lng)) return;
      L.marker([p.lat, p.lng], { icon: pinIconFor('fiesta', p) }).addTo(markersLayer).on('click', function () { showMapCard('fiesta', p); });
    });
    businesses().forEach(function (b) {
      if (!mapItemVisible('negocio', b)) return;
      if (!isFinite(b.lat) || !isFinite(b.lng)) return;
      L.marker([b.lat, b.lng], { icon: pinIconFor('negocio', b) }).addTo(markersLayer).on('click', function () { showMapCard('negocio', b); });
    });
    if (!parties().length && !businesses().length) {
      L.marker(ARTEMISA_CENTER).addTo(markersLayer).bindPopup('<b>Artemisa</b><br>Aquí aparecerán las fiestas.');
    }
    /* Si la tarjeta abierta era de un lugar que ya no se ve (borrado o
       filtrado por los chips), se cierra. */
    if (mapCardId) {
      var all = parties().map(function (p) { return { kind: 'fiesta', x: p }; }).concat(businesses().map(function (b) { return { kind: 'negocio', x: b }; }));
      var found = null;
      for (var i = 0; i < all.length; i++) { if (all[i].x.id === mapCardId) { found = all[i]; break; } }
      if (!found || !mapItemVisible(found.kind, found.x)) hideMapCard();
    }
  }
  function locateMe(announce) {
    if (!map) return;
    var done = function (lat, lng) {
      myLatLng = { lat: lat, lng: lng };
      map.setView([lat, lng], 14);
      L.marker([lat, lng], { icon: L.divIcon({ className: 'map-me-wrap', html: '<span class="map-me-dot"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(markersLayer).bindPopup('Estás aquí');
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (pos) { done(pos.coords.latitude, pos.coords.longitude); }, function () { if (announce) toast('No se pudo obtener tu ubicación'); }, { timeout: 8000 });
    } else if (announce) { toast('Tu teléfono no comparte ubicación'); }
  }
  /* ---------- Dirección obligatoria: geocodificar con Nominatim ----------
     Al publicar, la dirección escrita se convierte a coordenadas para
     poner el lugar en el mapa. Nunca bloquea la publicación: si no hay
     internet, no se encuentra o se acaba el tiempo, la publicación sale
     igual con la dirección escrita y un aviso honesto. */
  var GEOCODE_TIMEOUT_MS = 8000;
  /* Descompone una dirección en sus partes. Sirve tanto para la
     dirección compuesta del formulario guiado ("Calle Martí entre 12
     y 14, #45, Artemisa, Cuba") como para texto libre. Devuelve
     {street, city, country} (o null si no hay nada útil). */
  function parseAddressParts(address) {
    try {
      if (!address) return null;
      if (typeof address === 'object') {
        var s = String(address.street || '').trim(), c = String(address.city || '').trim(), co = String(address.country || '').trim();
        if (!s && !c && !co) return null;
        return { street: s, city: c, country: co };
      }
      var parts = String(address).split(',').map(function (p) { return p.trim(); }).filter(function (p) { return !!p; });
      if (!parts.length) return null;
      var country = parts.length >= 2 ? parts[parts.length - 1] : '';
      var city = parts.length >= 2 ? parts[parts.length - 2] : '';
      var streetPart = parts[0] || '';
      /* "Calle Martí entre 12 y 14" -> "Calle Martí"; "#45" aparte. */
      streetPart = streetPart.replace(/\s+entre\s+.*$/i, '').replace(/^#\s*\d+\s*/i, '').trim();
      if (!streetPart && parts.length > 1) streetPart = parts[1].replace(/\s+entre\s+.*$/i, '').trim();
      if (!streetPart && !city) return null;
      return { street: streetPart, city: city, country: country };
    } catch (e) { return null; }
  }
  /* ¿El resultado de Nominatim es nivel calle o mejor? Se rechaza
     todo lo que sea ciudad, provincia, país o frontera: un pin en el
     centro de la ciudad NO es la dirección que dio el usuario. */
  function nominatimStreetResult(r) {
    try {
      if (!r || !isFinite(parseFloat(r.lat)) || !isFinite(parseFloat(r.lon))) return null;
      var cls = String(r.class || '');
      var type = String(r.type || '');
      var at = String(r.addresstype || '');
      if (cls === 'boundary') return null;
      if (type === 'administrative') return null;
      if (['country', 'state', 'county', 'city', 'town', 'village', 'municipality', 'region', 'island'].indexOf(at) >= 0) return null;
      if (cls === 'highway') return { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
      if (['road', 'house', 'residential', 'neighbourhood', 'suburb', 'amenity', 'building'].indexOf(at) >= 0) return { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
      return null;
    } catch (e) { return null; }
  }
  function nominatimFetch(params, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v); } };
      var ms = timeoutMs || GEOCODE_TIMEOUT_MS;
      var timer = setTimeout(function () { finish(null); }, ms);
      try {
        if (!window.fetch) { clearTimeout(timer); finish(null); return; }
        fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=es&' + params)
          .then(function (r) { return r.json(); })
          .then(function (res) { clearTimeout(timer); finish(Array.isArray(res) ? res : null); })
          .catch(function () { clearTimeout(timer); finish(null); });
      } catch (e) { clearTimeout(timer); finish(null); }
    });
  }
  /* Geocodificación ESTRUCTURADA: solo Calle + Ciudad + País.
     "entre X y Y" y el número NO van en la consulta (Nominatim no los
     entiende y el número casi nunca está en OpenStreetMap para Cuba).
     Devuelve coordenadas SOLO si el resultado es nivel calle o mejor;
     si solo hay coincidencia de ciudad, devuelve null (el pin lo pone
     el usuario a mano, nunca se inventa una ubicación). */
  function geocodeAddress(address, timeoutMs) {
    var parts = parseAddressParts(address);
    if (!parts) return Promise.resolve(null);
    var q = [];
    if (parts.street) q.push('street=' + encodeURIComponent(parts.street));
    if (parts.city) q.push('city=' + encodeURIComponent(parts.city));
    if (parts.country) q.push('country=' + encodeURIComponent(parts.country));
    if (!q.length) return Promise.resolve(null);
    return nominatimFetch(q.join('&'), timeoutMs).then(function (res) {
      if (!res) return null;
      for (var i = 0; i < res.length; i++) {
        var c = nominatimStreetResult(res[i]);
        if (c) return c;
      }
      return null;
    });
  }
  /* Centro de la ciudad (solo para centrar el mapa o el selector de
     pin, NUNCA como ubicación de una publicación). */
  function geocodeCity(address, timeoutMs) {
    var parts = parseAddressParts(address);
    if (!parts || !parts.city) return Promise.resolve(null);
    var q = 'city=' + encodeURIComponent(parts.city) + (parts.country ? '&country=' + encodeURIComponent(parts.country) : '');
    return nominatimFetch(q, timeoutMs).then(function (res) {
      if (!res) return null;
      for (var i = 0; i < res.length; i++) {
        var r = res[i];
        if (r && isFinite(parseFloat(r.lat)) && isFinite(parseFloat(r.lon))) return { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
      }
      return null;
    });
  }
  /* Búsqueda del mapa (solo para CENTRAR LA VISTA, no para poner
     pines): calle si se puede, ciudad si no, texto libre al final. */
  function geocodeView(q) {
    return geocodeAddress(q).then(function (c) {
      if (c) return { lat: c.lat, lng: c.lng, zoom: 16 };
      return geocodeCity(q).then(function (cc) {
        if (cc) return { lat: cc.lat, lng: cc.lng, zoom: 12 };
        return nominatimFetch('q=' + encodeURIComponent(q)).then(function (res) {
          if (res) for (var i = 0; i < res.length; i++) {
            var r = res[i];
            if (r && isFinite(parseFloat(r.lat)) && isFinite(parseFloat(r.lon))) return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), zoom: 13 };
          }
          return null;
        });
      });
    });
  }
  /* Después de la publicación optimista: ubica la dirección en segundo
     plano, guarda las coordenadas en el caché y en la nube (mismo id, sin
     duplicar) y repinta el mapa. Si no se pudo ubicar a nivel calle, la
     publicación queda con la dirección escrita y sin pin: el dueño la
     ubica luego con el botón "Ubicar en el mapa" del feed. */
  function geocodeAndSave(coll, key, obj) {
    if (!obj || !obj.address) return;
    if (isFinite(obj.lat) && isFinite(obj.lng)) return; /* el selector de pin ya la ubicó */
    var parts = (obj.addrStreet || obj.addrCity) ? { street: obj.addrStreet || '', city: obj.addrCity || '', country: obj.addrCountry || '' } : obj.address;
    geocodeAddress(parts).then(function (coords) {
      try {
        if (!coords) { toast('No se pudo ubicar la dirección en el mapa: usa el botón "Ubicar en el mapa" en tu publicación'); return; }
        obj.lat = coords.lat; obj.lng = coords.lng;
        var list = load(key, []);
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === obj.id) { list[i].lat = coords.lat; list[i].lng = coords.lng; break; }
        }
        save(key, list);
        renderFeed(); renderMapMarkers();
        if (isCloud()) cloudPut(coll, obj);
      } catch (e) {}
    });
  }
  $('#myLocationBtn').addEventListener('click', function () { locateMe(true); });
  $('#mapSearchBtn').addEventListener('click', function () {
    var q = $('#mapSearch').value.trim(); if (!q) { toast('Escribe un lugar'); return; }
    geocodeView(q).then(function (v) {
      if (v) { map.setView([v.lat, v.lng], v.zoom); toast('Lugar encontrado'); }
      else toast('No encontré ese lugar');
    }).catch(function () { toast('Sin internet, no puedo buscar lugares'); });
  });

  /* ---------- Selector de pin (ubicación manual) ----------
     Un mini-mapa Leaflet con un pin ARRASTRABLE. Lo usan los dos
     formularios de publicar y el botón "Ubicar en el mapa" del feed.
     La posición solo vale si está confirmada: geocódigo a nivel calle,
     GPS del usuario, o el usuario movió el pin. Sin confirmación no
     hay coordenadas y no hay pin (nunca se inventa una ubicación). */
  function createPinPicker(opts) {
    var st = { map: null, marker: null, ready: false, started: false, confirmed: false, userMoved: false, pos: null };
    function status(t) { try { var el = opts.statusEl && document.getElementById(opts.statusEl); if (el) el.textContent = t || ''; } catch (e) {} }
    function placePin(lat, lng, confirmed, msg) {
      try {
        st.pos = { lat: lat, lng: lng };
        if (confirmed) st.confirmed = true;
        if (st.marker) { try { st.marker.setLatLng([lat, lng]); } catch (e) {} }
        if (st.map) { try { st.map.setView([lat, lng], Math.max(st.map.getZoom(), 15)); } catch (e) {} }
        if (msg) status(msg);
      } catch (e) {}
    }
    function init(center) {
      if (st.ready) { try { st.map.invalidateSize(); } catch (e) {} return Promise.resolve(true); }
      if (st.started) return Promise.resolve(false);
      st.started = true;
      return loadLeaflet().then(function (ok) {
        if (!ok || typeof L === 'undefined') { status('El mapa necesita internet para cargar'); st.started = false; return false; }
        try {
          var el = document.getElementById(opts.mapEl);
          if (!el) return false;
          var c = (st.pos ? [st.pos.lat, st.pos.lng] : center) || ARTEMISA_CENTER;
          st.map = L.map(el, { zoomControl: false, attributionControl: false }).setView(c, 15);
          L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 17 }).addTo(st.map);
          st.marker = L.marker(c, { draggable: true }).addTo(st.map);
          st.marker.on('dragend', function () {
            try {
              var ll = st.marker.getLatLng();
              st.pos = { lat: ll.lat, lng: ll.lng };
              st.confirmed = true; st.userMoved = true;
              status('Pin movido — ubicación lista ✓');
            } catch (e) {}
          });
          st.pos = { lat: c[0], lng: c[1] };
          st.ready = true;
          setTimeout(function () { try { st.map.invalidateSize(); } catch (e) {} }, 120);
          return true;
        } catch (e) { st.started = false; return false; }
      });
    }
    var gpsBtn = opts.gpsBtn && document.getElementById(opts.gpsBtn);
    if (gpsBtn) gpsBtn.addEventListener('click', function () {
      status('Buscando tu ubicación…');
      getCurrentPositionOnce().then(function (p) {
        if (!p) { status('No se pudo obtener tu ubicación'); toast('No se pudo obtener tu ubicación'); return; }
        if (!st.ready) { st.pos = { lat: p.lat, lng: p.lng }; st.confirmed = true; init([p.lat, p.lng]); }
        placePin(p.lat, p.lng, true, 'Pin en tu ubicación actual ✓');
      });
    });
    return {
      init: init, placePin: placePin, status: status,
      centerOn: function (lat, lng, zoom) { try { if (st.map) st.map.setView([lat, lng], zoom || 12); } catch (e) {} },
      getPos: function () { return st.confirmed ? st.pos : null; },
      isConfirmed: function () { return st.confirmed; },
      hasUserMoved: function () { return st.userMoved; },
      reset: function (center) {
        st.confirmed = false; st.userMoved = false; st.pos = null;
        if (st.ready && center) placePin(center[0], center[1], false);
        status('Mueve el pin al sitio exacto');
      },
      refreshSize: function () { try { if (st.map) st.map.invalidateSize(); } catch (e) {} }
    };
  }
  /* Posición inicial del selector según la dirección escrita: solo
     mueve el pin si el usuario aún no lo movió a mano. */
  var addressGeocodeTimers = {};
  function scheduleAddressGeocode(formId) {
    try { clearTimeout(addressGeocodeTimers[formId]); } catch (e) {}
    addressGeocodeTimers[formId] = setTimeout(function () { updatePickerFromAddress(formId); }, 900);
  }
  function updatePickerFromAddress(formId) {
    try {
      var picker = formId === 'partyForm' ? partyPicker : bizPicker;
      if (!picker) return;
      var f = document.getElementById(formId); if (!f) return;
      var a = addressFieldsOf(f);
      if (!a.street || !a.city) return;
      geocodeAddress(a).then(function (c) {
        try {
          if (!c) {
            geocodeCity(a).then(function (cc) { try { if (cc && picker && !picker.hasUserMoved()) picker.centerOn(cc.lat, cc.lng, 12); } catch (e) {} });
            return;
          }
          if (picker.hasUserMoved()) { picker.status('Ubicación aproximada por tu dirección — mueve el pin si no es exacta'); return; }
          picker.placePin(c.lat, c.lng, true, 'Ubicación aproximada por tu dirección — mueve el pin si no es exacta');
        } catch (e) {}
      });
    } catch (e) {}
  }
  function initPublishPickers() {
    try {
      var start = myLatLng ? [myLatLng.lat, myLatLng.lng] : ARTEMISA_CENTER;
      if (partyPicker) {
        partyPicker.init(start).then(function () { updatePickerFromAddress('partyForm'); });
        partyPicker.refreshSize();
      }
      if (bizPicker) {
        bizPicker.init(start).then(function () { updatePickerFromAddress('bizForm'); });
        bizPicker.refreshSize();
      }
    } catch (e) {}
  }
  /* "Ubicar en el mapa" desde el feed: el dueño de una publicación sin
     coordenadas abre el mismo selector y guarda la posición (mismo id,
     sin duplicar; en la nube si hay conexión). */
  function openLocatePicker(kind, id) {
    try {
      var list = kind === 'fiesta' ? parties() : businesses();
      var x = null;
      for (var i = 0; i < list.length; i++) { if (list[i].id === id) { x = list[i]; break; } }
      if (!x) { toast('Esa publicación ya no está'); return; }
      if (!guardAction()) return;
      var u = currentUser();
      if (!u || x.by !== u.name) { toast('Solo puedes ubicar tus publicaciones'); return; }
      locateTarget = { kind: kind, id: id };
      var ov = document.getElementById('locateOverlay');
      if (ov) ov.classList.remove('hidden');
      if (!locatePicker) locatePicker = createPinPicker({ mapEl: 'locatePinMap', statusEl: 'locatePinStatus', gpsBtn: 'locatePinGps' });
      locatePicker.reset(ARTEMISA_CENTER);
      var start = myLatLng ? [myLatLng.lat, myLatLng.lng] : ARTEMISA_CENTER;
      locatePicker.init(start).then(function () { try { locatePicker.refreshSize(); } catch (e) {} });
      if (x.address) {
        geocodeAddress(x.address).then(function (c) {
          try {
            if (!locateTarget || locateTarget.id !== id) return;
            if (c) { locatePicker.placePin(c.lat, c.lng, true, 'Ubicación aproximada por tu dirección — mueve el pin si no es exacta'); return; }
            geocodeCity(x.address).then(function (cc) { try { if (cc && locateTarget && locateTarget.id === id) locatePicker.centerOn(cc.lat, cc.lng, 12); } catch (e) {} });
          } catch (e) {}
        });
      }
    } catch (e) {}
  }
  function closeLocatePicker() {
    try {
      var ov = document.getElementById('locateOverlay');
      if (ov) ov.classList.add('hidden');
      locateTarget = null;
    } catch (e) {}
  }
  function confirmLocatePicker() {
    try {
      if (!locateTarget) return;
      var pos = locatePicker && locatePicker.getPos();
      if (!pos) { toast('Mueve el pin al sitio exacto primero'); return; }
      var kind = locateTarget.kind, id = locateTarget.id;
      var key = kind === 'fiesta' ? 'pegaoxl_parties' : 'pegaoxl_businesses';
      var coll = kind === 'fiesta' ? 'parties' : 'businesses';
      var list = load(key, []);
      var obj = null;
      for (var i = 0; i < list.length; i++) { if (list[i].id === id) { obj = list[i]; obj.lat = pos.lat; obj.lng = pos.lng; break; } }
      if (!obj) { toast('Esa publicación ya no está'); closeLocatePicker(); return; }
      save(key, list);
      if (isCloud()) cloudPut(coll, obj);
      closeLocatePicker();
      renderFeed(); renderMapMarkers();
      toast('Ubicación guardada ✓');
    } catch (e) {}
  }
  var locateSaveBtn = document.getElementById('locatePinSave');
  if (locateSaveBtn) locateSaveBtn.addEventListener('click', confirmLocatePicker);
  var locateCancelBtn = document.getElementById('locatePinCancel');
  if (locateCancelBtn) locateCancelBtn.addEventListener('click', closeLocatePicker);
  /* Los mini-mapas de los formularios se crean aquí (perezosos: solo se
     inicializan cuando se abre la pestaña Publicar). */
  partyPicker = createPinPicker({ mapEl: 'partyPinMap', statusEl: 'partyPinStatus', gpsBtn: 'partyPinGps' });
  bizPicker = createPinPicker({ mapEl: 'bizPinMap', statusEl: 'bizPinStatus', gpsBtn: 'bizPinGps' });

  /* Chips de categoría del mapa (v15): filtran qué publicaciones se
     ven en el mapa (fiestas y negocios). */
  $$('.map-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $$('.map-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      mapCatFilter = chip.getAttribute('data-map-cat');
      hideMapCard();
      renderMapMarkers();
    });
  });
  /* Enter en el buscador del mapa busca igual que el botón. */
  $('#mapSearch').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('#mapSearchBtn').click(); }
  });

  /* ---------- Ubicación del dispositivo ----------
     Helpers de ubicación para el mapa y el selector de pin: el plugin
     Capacitor Geolocation si existe y, si no, el geolocation del
     navegador. Sin GPS real no hay pin: nada inventado. */
  function geoPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) || null; }
    catch (e) { return null; }
  }
  function distMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  /* Una sola lectura de la posición actual (para el punto de recogida).
     Devuelve {lat, lng} o null si no se pudo obtener. Nunca rechaza. */
  function getCurrentPositionOnce() {
    return new Promise(function (resolve) {
      var done = false;
      var ok = function (pos) {
        if (done) return; done = true;
        if (pos && pos.coords && isFinite(pos.coords.latitude) && isFinite(pos.coords.longitude)) {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        } else resolve(null);
      };
      var fail = function () { if (!done) { done = true; resolve(null); } };
      var gp = geoPlugin();
      if (gp && gp.getCurrentPosition) {
        try {
          gp.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 }).then(ok).catch(fail);
          setTimeout(fail, 12000);
          return;
        } catch (e) { /* cae al geolocation del navegador */ }
      }
      if (navigator.geolocation) {
        try { navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 10000 }); }
        catch (e) { fail(); }
        return;
      }
      fail();
    });
  }
  /* ---------- 3D interactivo: las tarjetas y el hero siguen al dedo/mouse ---------- */
  function addTilt(el, max) {
    if (!el) return;
    try { if (!window.matchMedia('(hover:hover)').matches) return; } catch (e) { return; }
    el.addEventListener('mousemove', function (e) {
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5;
      var y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = 'translateY(-6px) rotateX(' + (-y * max) + 'deg) rotateY(' + (x * max) + 'deg) translateZ(10px)';
    });
    el.addEventListener('mouseleave', function () { el.style.transform = ''; });
  }
  document.querySelectorAll('.hero').forEach(function (h) { addTilt(h, 6); });
  document.addEventListener('mouseover', function (e) {
    var c = e.target.closest && e.target.closest('.party-card,.biz-card');
    if (c && !c.dataset.tilt) { c.dataset.tilt = '1'; addTilt(c, 8); }
  });

  /* ---------- Versión y actualización dentro de la app ----------
     APP_VERSION es la versión de ESTA compilación. Al arrancar (y al
     volver a primer plano) la app pide version.json de GitHub Pages
     (un solo fetch pequeño, con timeout corto, en segundo plano). Si
     la versión de ahí es mayor, sale el banner en el Feed y el botón
     en Cuenta. Al tocar Actualizar, la app descarga el APK nuevo y
     dispara la instalación: si existe el puente nativo ApkInstaller
     (se añade en Datar al compilar, ver reporte) usa Filesystem +
     ApkInstaller.installApk; si no, abre la descarga con window.open
     para que el sistema la baje y el usuario toque Instalar. Nunca se
     descarga nada sin que el usuario toque el botón. */
  var APP_VERSION = 'v18';
  var VERSION_URL = 'https://pegaony.github.io/pegao-xl/version.json';
  var UPDATE_CHECK_TIMEOUT_MS = 5000;
  var updateInfo = null, updateLastCheck = 0;
  function versionNumber(v) {
    var m = String(v || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function updateInfoOf() { return updateInfo; }
  function updateUpdateUI() {
    try {
      var banner = document.getElementById('updateBanner');
      var txt = document.getElementById('updateBannerText');
      var btn = document.getElementById('updateBtn');
      var ver = document.getElementById('appVersionText');
      if (ver) ver.textContent = APP_VERSION;
      if (!updateInfo) { if (banner) banner.classList.add('hidden'); if (btn) btn.classList.add('hidden'); return; }
      var label = 'Actualización disponible — ' + updateInfo.version;
      if (txt) txt.textContent = '⬆ ' + label;
      if (banner) banner.classList.remove('hidden');
      if (btn) { btn.textContent = '⬆ ' + label; btn.classList.remove('hidden'); }
    } catch (e) {}
  }
  function checkForUpdate() {
    try {
      var now = Date.now();
      if (now - updateLastCheck < 60000) return; /* como mucho 1 vez por minuto */
      updateLastCheck = now;
      if (!window.fetch) return;
      var timedOut = false;
      var timer = setTimeout(function () { timedOut = true; }, UPDATE_CHECK_TIMEOUT_MS);
      Promise.resolve().then(function () { return fetch(VERSION_URL); }).then(function (r) {
        if (!r || !r.ok) throw new Error('no version.json');
        return r.json();
      }).then(function (data) {
        clearTimeout(timer);
        if (timedOut) return;
        if (!data || !data.version) return;
        if (versionNumber(data.version) > versionNumber(APP_VERSION)) {
          updateInfo = { version: String(data.version), apkUrl: data.apkUrl || '' };
          updateUpdateUI();
        }
      }).catch(function () { clearTimeout(timer); /* sin version.json: no pasa nada */ });
    } catch (e) {}
  }
  function startUpdate() {
    try {
      if (!updateInfo || !updateInfo.apkUrl) { toast('No hay actualización disponible'); return; }
      var apkUrl = updateInfo.apkUrl;
      var fs = null, installer = null;
      try {
        fs = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) || null;
        installer = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ApkInstaller) || null;
      } catch (e) {}
      /* Camino nativo: bajar a la caché y disparar el instalador. */
      if (fs && fs.downloadFile && installer && installer.installApk) {
        toast('Descargando la actualización…');
        var dir = null;
        try { dir = window.Capacitor.FilesystemDirectory ? window.Capacitor.FilesystemDirectory.Cache : 'CACHE'; } catch (e) { dir = 'CACHE'; }
        Promise.resolve(fs.downloadFile({ url: apkUrl, path: 'pegao-xl-update.apk', directory: dir })).then(function (res) {
          var uri = (res && (res.uri || res.path)) || null;
          if (!uri) throw new Error('sin uri');
          return installer.installApk({ path: uri });
        }).then(function () {
          toast('Abriendo el instalador…');
        }).catch(function () {
          /* Si el camino nativo falla, cae al de siempre. */
          window.open(apkUrl, '_blank');
        });
        return;
      }
      /* Fallback (el que funciona hoy): el sistema descarga el APK y
         el usuario toca Instalar cuando termine. */
      toast('Descargando la actualización…');
      window.open(apkUrl, '_blank');
    } catch (e) { toast('No se pudo abrir la actualización, inténtalo de nuevo'); }
  }
  var updateNowBtn = document.getElementById('updateNowBtn');
  if (updateNowBtn) updateNowBtn.addEventListener('click', startUpdate);
  var updateBtnEl = document.getElementById('updateBtn');
  if (updateBtnEl) updateBtnEl.addEventListener('click', startUpdate);

  /* ---------- Favoritos (privado, sin seguidores) ----------
     Cada fiesta y cada negocio tiene su botón "Favorito" (estrella).
     Es solo para este usuario: localStorage y, si hay nube, en su
     perfil (campo `favorites`). Nada público, nada de seguidores ni
     contadores. Arriba del feed sale "Tus favoritos" y en "Para ti"
     pesan mucho más, sin esconder nunca el resto. */
  function favoriteItems() { return load('pegaoxl_favorites', []); }
  function isFavorite(kind, id) {
    return favoriteItems().some(function (f) { return f.kind === kind && f.id === id; });
  }
  function toggleFavorite(kind, id) {
    if (!guardAction()) return;
    var list = favoriteItems();
    var i = -1;
    for (var k = 0; k < list.length; k++) { if (list[k].kind === kind && list[k].id === id) { i = k; break; } }
    var added;
    if (i >= 0) { list.splice(i, 1); added = false; }
    else { list.unshift({ kind: kind, id: id, at: Date.now() }); added = true; }
    save('pegaoxl_favorites', list);
    syncFavoritesToProfile();
    if (kind === 'fiesta') refreshEventRemindersFor(kind, id); /* v18: aviso el día del evento */
    renderFeed();
    if (partyDetailId) renderPartyDetail(partyDetailId);
    toast(added ? 'Agregado a favoritos ⭐' : 'Quitado de favoritos');
  }
  function syncFavoritesToProfile() {
    try {
      var u = currentUser(); if (!u || !isCloud()) return;
      var prof = getMyProfile(); if (!prof || !prof.id) return;
      db.collection('profiles').doc(prof.id).set({ favorites: favoriteItems(), updatedAt: Date.now() }, { merge: true }).catch(function () {});
    } catch (e) {}
  }
  function adoptFavoritesFromProfile() {
    try {
      if (favoriteItems().length) return;
      var prof = getMyProfile();
      if (prof && Array.isArray(prof.favorites) && prof.favorites.length) save('pegaoxl_favorites', prof.favorites.slice());
    } catch (e) {}
  }

  /* ---------- Guardados ----------
     Botón "Guardar" en cada publicación; la lista sale en Cuenta.
     localStorage primero; en la nube, colección `saved` (un doc por
     guardado), sin bloquear si falla. */
  function savedItems() { return load('pegaoxl_saved', []); }
  function isSaved(kind, id) {
    return savedItems().some(function (s) { return s.kind === kind && s.id === id; });
  }
  function toggleSaved(kind, id) {
    if (!guardAction()) return;
    var list = savedItems();
    var i = -1;
    for (var k = 0; k < list.length; k++) { if (list[k].kind === kind && list[k].id === id) { i = k; break; } }
    var added;
    if (i >= 0) { list.splice(i, 1); added = false; }
    else { list.unshift({ kind: kind, id: id, at: Date.now() }); added = true; }
    save('pegaoxl_saved', list);
    if (isCloud()) {
      try {
        var u = currentUser();
        var docId = (u ? profileIdOf(u) : 'anon') + '_' + kind + '_' + id;
        if (added) db.collection('saved').doc(docId).set({ kind: kind, id: id, by: u ? u.name : null, byId: u ? profileIdOf(u) : null, at: Date.now() }).catch(function () {});
        else db.collection('saved').doc(docId).delete().catch(function () {});
      } catch (e) {}
    }
    renderFeed(); renderSaved();
    if (kind === 'fiesta') refreshEventRemindersFor(kind, id); /* v18: aviso el día del evento */
    if (partyDetailId) renderPartyDetail(partyDetailId);
    toast(added ? 'Guardado ✓' : 'Quitado de Guardados');
  }

  /* ---------- Me interesa y recordatorio de fiesta ----------
     "Me interesa" en cada fiesta, y desde v18 también las favoritas
     y las guardadas. El día del evento la app avisa: con el plugin de
     notificaciones locales (si está instalado) se programa el aviso;
     sin plugin, al abrir la app ese día sale el aviso en pantalla.
     Todo local, sin servidor. */
  function interestedMap() { return load('pegaoxl_interested', {}); }
  function isInterested(id) { return !!interestedMap()[id]; }
  function toggleInterest(id) {
    if (!guardAction()) return;
    var p = parties().filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var map = interestedMap();
    var added;
    if (map[id]) { delete map[id]; added = false; }
    else { map[id] = { title: p.desc, date: p.date, time: p.time, place: p.place }; added = true; }
    save('pegaoxl_interested', map);
    refreshEventRemindersFor('fiesta', id); /* v18: mismo aviso, una sola vez aunque sea favorita/guardada */
    renderFeed();
    if (partyDetailId) renderPartyDetail(partyDetailId);
    toast(added ? 'Te avisaremos el día de la fiesta 🔔' : 'Ya no te interesa esta fiesta');
  }
  function localNotifPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null; }
    catch (e) { return null; }
  }
  function interestNotifId(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) { h = ((h << 5) - h + id.charCodeAt(i)) | 0; }
    return Math.abs(h) % 2000000000;
  }
  function scheduleInterestReminder(id, info) {
    try {
      var ln = localNotifPlugin(); if (!ln || !ln.schedule || !info || !info.date) return;
      var when = new Date(info.date + 'T' + (info.time || '10:00') + ':00');
      if (isNaN(when.getTime()) || when.getTime() < Date.now()) return;
      var doSchedule = function () {
        try {
          ln.schedule({ notifications: [{ id: interestNotifId(id), title: 'Hoy: ' + (info.title || 'Fiesta'), body: (info.place || '') + (info.time ? ' · ' + info.time : '') + ' · en PEGAO XL', schedule: { at: when } }] }).catch(function () {});
        } catch (e) {}
      };
      if (ln.requestPermissions) ln.requestPermissions().then(doSchedule).catch(doSchedule);
      else doSchedule();
    } catch (e) {}
  }
  /* Aviso del día sin plugin: al abrir la app, si una fiesta que te
     interesa es hoy, sale el aviso una sola vez ese día. */
  function checkInterests() {
    /* v18: el aviso del día cubre fiestas que te interesan, favoritas
       y guardadas (la fecha se lee de la fiesta, no del apunte viejo). */
    try {
      var map = interestedMap();
      var today = todayStr(new Date());
      var reminded = load('pegaoxl_reminded_days', {});
      var shown = [];
      var consider = function (id, title) {
        if (!id || reminded[id] === today) return;
        var p = parties().filter(function (x) { return x.id === id; })[0];
        if (!p || p.date !== today) return;
        reminded[id] = today;
        shown.push(title || p.desc || 'Fiesta');
      };
      Object.keys(map).forEach(function (id) { var info = map[id]; consider(id, info && info.title); });
      favoriteItems().forEach(function (f) { if (f.kind === 'fiesta') consider(f.id); });
      savedItems().forEach(function (s) { if (s.kind === 'fiesta') consider(s.id); });
      save('pegaoxl_reminded_days', reminded);
      if (shown.length) toast('🔔 Hoy: ' + shown.join(' · '));
    } catch (e) {}
  }

  /* ---------- Notificaciones push (FCM, parte www) ----------
     Solo la parte web: pide permiso, registra el token y lo guarda en
     el perfil (campo `fcmToken`) para que el servidor pueda avisarte
     de publicaciones nuevas y del día del evento. Si el plugin no está
     instalado todavía, no pasa nada y la app sigue igual. El paso nativo
     (instalar el plugin en Datar) está en el reporte. */
  function pushPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) || null; }
    catch (e) { return null; }
  }
  function saveFcmTokenToProfile() {
    try {
      var token = load('pegaoxl_fcm_token', null);
      if (!token) return;
      var u = currentUser(); if (!u || !isCloud()) return;
      var prof = getMyProfile(); if (!prof || !prof.id) return;
      db.collection('profiles').doc(prof.id).set({ fcmToken: token, updatedAt: Date.now() }, { merge: true }).catch(function () {});
    } catch (e) {}
  }
  function initPush() {
    try {
      var pn = pushPlugin(); if (!pn) return;
      if (pn.requestPermissions) {
        pn.requestPermissions().then(function (res) {
          try { if (res && res.receive === 'granted' && pn.register) pn.register(); } catch (e) {}
        }).catch(function () {});
      } else if (pn.register) { try { pn.register(); } catch (e) {} }
      if (pn.addListener) {
        pn.addListener('registration', function (token) {
          try {
            if (token && token.value) { save('pegaoxl_fcm_token', token.value); saveFcmTokenToProfile(); }
          } catch (e) {}
        });
        pn.addListener('pushNotificationReceived', function (n) {
          try { toast((n && (n.title || n.body)) ? String(n.title || n.body) : 'Nueva notificación de PEGAO XL'); } catch (e) {}
        });
        pn.addListener('pushNotificationActionPerformed', function () { try { showTab('feed'); } catch (e) {} });
      }
    } catch (e) {}
  }

  /* ---------- Permisos del dispositivo (v18) ----------
     La app pide lo que necesita y explica para qué, en español, en
     Cuenta > Permisos. Nada se pide en silencio: cada permiso muestra
     su estado (Permitido / Denegado / Sin pedir / No disponible /
     Se activa en Ajustes). La ubicación en segundo plano y la exención
     de batería NO se pueden pedir dentro de la app en Android 11+:
     solo se activan desde Ajustes del sistema, y la app abre esa
     pantalla con un botón. Sin plugin instalado, el permiso se muestra
     como "No disponible" y nada se rompe: la función que lo necesita
     usa su alternativa (selector de archivos, compartir el enlace). */
  function isNative() {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
    catch (e) { return false; }
  }
  function contactsPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Contacts) || null; }
    catch (e) { return null; }
  }
  function cameraPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) || null; }
    catch (e) { return null; }
  }
  /* Estados guardados (lo último que supimos de cada permiso). */
  function permStates() { return load('pegaoxl_perm_state', {}); }
  function savePermStates(s) { save('pegaoxl_perm_state', s || {}); }
  var PERM_DEFS = [
    { key: 'location', icon: '📍', name: 'Ubicación', why: 'Para ubicarte en el mapa, ver qué hay cerca de ti y poner el pin exacto al publicar.' },
    { key: 'background', icon: '🌙', name: 'Ubicación en segundo plano', why: 'Para que los recordatorios del día del evento suenen aunque la app esté cerrada. Android 11+ no deja pedirlo dentro de la app: solo se activa desde Ajustes del sistema.', manual: true, nativeOnly: true },
    { key: 'notifications', icon: '🔔', name: 'Notificaciones', why: 'Para avisarte de publicaciones nuevas, nuevos negocios y el día de tus eventos, incluso con la app cerrada.' },
    { key: 'contacts', icon: '👥', name: 'Contactos', why: 'Para invitar a tus amigos directamente desde tus contactos, sin copiar el enlace a mano.' },
    { key: 'camera', icon: '📷', name: 'Cámara y fotos', why: 'Para subir el flyer de tu fiesta o las fotos de tu negocio desde la cámara o la galería.' },
    { key: 'battery', icon: '🔋', name: 'Sin optimización de batería', why: 'Android duerme las apps en segundo plano. Sin esta exención, los recordatorios del día del evento pueden no sonar a tiempo. Se activa en Ajustes → Apps → PEGAO XL → Batería → Sin restricciones.', manual: true, nativeOnly: true }
  ];
  function permStateLabel(s) {
    if (s === 'granted') return 'Permitido';
    if (s === 'denied') return 'Denegado';
    if (s === 'manual') return 'Se activa en Ajustes';
    if (s === 'unavailable') return 'No disponible';
    return 'Sin pedir';
  }
  var permLastCheck = 0;
  function checkAllPermissions() {
    /* Lee el estado real de cada permiso (plugins si existen, web si
       no). Devuelve una promesa con {key: estado}. Nunca rompe nada. */
    var out = {};
    var jobs = [];
    var gp = geoPlugin();
    if (gp && gp.checkPermissions) {
      jobs.push(gp.checkPermissions().then(function (r) {
        var v = (r && (r.location || r.coarseLocation)) || null;
        out.location = v === 'granted' ? 'granted' : (v === 'denied' ? 'denied' : 'prompt');
      }).catch(function () {}));
    } else if (!isNative() && navigator.permissions && navigator.permissions.query) {
      jobs.push(navigator.permissions.query({ name: 'geolocation' }).then(function (r) {
        out.location = r.state === 'granted' ? 'granted' : (r.state === 'denied' ? 'denied' : 'prompt');
      }).catch(function () {}));
    } else { out.location = isNative() ? 'prompt' : 'unavailable'; }
    var pn = pushPlugin();
    if (pn && pn.checkPermissions) {
      jobs.push(pn.checkPermissions().then(function (r) {
        var v = (r && r.receive) || null;
        out.notifications = v === 'granted' ? 'granted' : (v === 'denied' ? 'denied' : 'prompt');
      }).catch(function () {}));
    } else if (!isNative() && window.Notification) {
      out.notifications = Notification.permission === 'granted' ? 'granted' : (Notification.permission === 'denied' ? 'denied' : 'prompt');
    } else { out.notifications = 'unavailable'; }
    var cp = contactsPlugin();
    if (cp && cp.checkPermissions) {
      jobs.push(cp.checkPermissions().then(function (r) {
        var v = (r && (r.contacts || r.display)) || null;
        out.contacts = v === 'granted' ? 'granted' : (v === 'denied' ? 'denied' : 'prompt');
      }).catch(function () {}));
    } else { out.contacts = 'unavailable'; }
    var cm = cameraPlugin();
    if (cm && cm.checkPermissions) {
      jobs.push(cm.checkPermissions().then(function (r) {
        var v = (r && (r.camera || r.photos)) || null;
        out.camera = v === 'granted' ? 'granted' : (v === 'denied' ? 'denied' : 'prompt');
      }).catch(function () {}));
    } else { out.camera = 'unavailable'; }
    out.background = isNative() ? 'manual' : 'unavailable';
    out.battery = isNative() ? 'manual' : 'unavailable';
    permLastCheck = Date.now();
    if (window.Promise && Promise.all) {
      return Promise.all(jobs).then(function () { var cur = permStates(); var k; for (k in out) cur[k] = out[k]; savePermStates(cur); return out; });
    }
    var cur2 = permStates(); var k2; for (k2 in out) cur2[k2] = out[k2]; savePermStates(cur2);
    return { then: function (fn) { try { fn(out); } catch (e) {} return this; } };
  }
  function refreshPermStates() {
    permLastCheck = 0;
    try { checkAllPermissions().then(function () { try { renderPermissions(); } catch (e) {} }); } catch (e) {}
  }
  function requestPermission(key) {
    try {
      if (key === 'location') {
        var gp = geoPlugin();
        if (gp && gp.requestPermissions) { gp.requestPermissions().then(function () { refreshPermStates(); }).catch(function () { refreshPermStates(); }); return; }
        if (navigator.geolocation) { navigator.geolocation.getCurrentPosition(function () { refreshPermStates(); }, function () { refreshPermStates(); }, { timeout: 10000 }); return; }
        toast('La ubicación no está disponible en este navegador'); return;
      }
      if (key === 'notifications') {
        var pn = pushPlugin();
        if (pn && pn.requestPermissions) { pn.requestPermissions().then(function (res) { if (res && res.receive === 'granted') initPush(); refreshPermStates(); }).catch(function () { refreshPermStates(); }); return; }
        if (window.Notification && Notification.requestPermission) { Notification.requestPermission().then(function () { refreshPermStates(); }).catch(function () {}); return; }
        toast('Las notificaciones no están disponibles aquí'); return;
      }
      if (key === 'contacts') {
        var cp = contactsPlugin();
        if (cp && cp.requestPermissions) { cp.requestPermissions().then(function () { refreshPermStates(); }).catch(function () { refreshPermStates(); }); return; }
        toast('Los contactos solo se pueden pedir dentro de la APK (falta instalar el plugin)'); return;
      }
      if (key === 'camera') {
        var cm = cameraPlugin();
        if (cm && cm.requestPermissions) { cm.requestPermissions().then(function () { refreshPermStates(); }).catch(function () { refreshPermStates(); }); return; }
        toast('La cámara y las fotos se piden solas al subir un flyer o una foto'); return;
      }
      if (key === 'background' || key === 'battery') { openAppSettings(); return; }
    } catch (e) {}
  }
  function openAppSettings() {
    /* Abre los Ajustes de la app en Android (intent:// a la pantalla de
       la app, donde están Permisos y Batería). Si no se abre, el texto
       del permiso explica el camino a mano. En web no aplica. Si el
       intent no dispara en algún teléfono, la vía segura es añadir
       openAppSettings al plugin nativo ApkInstallerPlugin (ver reporte). */
    try {
      if (!isNative()) { toast('Esto solo aplica dentro de la APK en el teléfono'); return; }
      window.location.href = 'intent://#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:com.pegaoxl.app;end';
      toast('Si no se abrió Ajustes, ve a Ajustes → Apps → PEGAO XL');
    } catch (e) { toast('Ve a Ajustes → Apps → PEGAO XL para cambiarlo'); }
  }
  var permListBound = false;
  function renderPermissions() {
    try {
      var box = document.getElementById('permList'); if (!box) return;
      var states = permStates();
      var native = isNative();
      var html = '';
      PERM_DEFS.forEach(function (d) {
        if (d.nativeOnly && !native) return;
        var st = states[d.key] || (d.manual ? 'manual' : 'prompt');
        var btn = '';
        if (d.manual) btn = '<button type="button" class="btn-secondary" data-perm-act="' + d.key + '">Abrir ajustes</button>';
        else if (st === 'granted') btn = '<span class="perm-ok">✓ Permitido</span>';
        else if (st === 'unavailable') btn = '<span class="muted small">No disponible</span>';
        else btn = '<button type="button" class="btn-secondary" data-perm-act="' + d.key + '">Permitir</button>';
        html += '<div class="perm-row"><span class="perm-icon">' + d.icon + '</span><div class="perm-info"><strong>' + d.name + '</strong><span class="perm-why">' + d.why + '</span></div><span class="perm-state perm-' + st + '">' + permStateLabel(st) + '</span>' + btn + '</div>';
      });
      box.innerHTML = html;
      renderPushPrefs();
      if (!permListBound) {
        permListBound = true;
        box.addEventListener('click', function (e) {
          var b = e.target && e.target.closest ? e.target.closest('[data-perm-act]') : null;
          if (!b) return;
          requestPermission(b.getAttribute('data-perm-act'));
        });
      }
      /* Refresca los estados reales como mucho una vez por minuto:
         si se preguntara en cada render, cada snapshot de la nube
         gastaría llamadas a los plugins. */
      if (Date.now() - permLastCheck > 60000) {
        try { checkAllPermissions().then(function () { try { renderPermissions(); } catch (e) {} }); } catch (e) {}
      }
    } catch (e) {}
  }

  /* ---------- Avisos push: qué quiere recibir el usuario (v18) ----------
     Tres interruptores en Cuenta. Se guardan en localStorage y, si hay
     nube, en el perfil (campo `pushPrefs`), que es lo que lee el cron
     del servidor para decidir a quién avisa. Si falta, todo es true:
     el que no tocó nada recibe todo. */
  function pushPrefs() {
    var p = load('pegaoxl_push_prefs', null);
    if (p && typeof p === 'object') return { newPosts: p.newPosts !== false, eventDay: p.eventDay !== false, newBusinesses: p.newBusinesses !== false };
    var prof = null;
    try { prof = getMyProfile(); } catch (e) {}
    if (prof && prof.pushPrefs && typeof prof.pushPrefs === 'object') return { newPosts: prof.pushPrefs.newPosts !== false, eventDay: prof.pushPrefs.eventDay !== false, newBusinesses: prof.pushPrefs.newBusinesses !== false };
    return { newPosts: true, eventDay: true, newBusinesses: true };
  }
  function savePushPrefs(p) {
    try {
      save('pegaoxl_push_prefs', p);
      var u = currentUser(); if (!u || !isCloud()) return;
      var prof = getMyProfile(); if (!prof || !prof.id) return;
      db.collection('profiles').doc(prof.id).set({ pushPrefs: p, updatedAt: Date.now() }, { merge: true }).catch(function () {});
    } catch (e) {}
  }
  var pushPrefsBound = false;
  function renderPushPrefs() {
    try {
      var box = document.getElementById('pushPrefsBox'); if (!box) return;
      var p = pushPrefs();
      box.innerHTML =
        '<label class="push-pref"><input type="checkbox" data-push-pref="newPosts"' + (p.newPosts ? ' checked' : '') + '> Nuevas publicaciones <span class="muted small">— fiestas que se publiquen</span></label>' +
        '<label class="push-pref"><input type="checkbox" data-push-pref="eventDay"' + (p.eventDay ? ' checked' : '') + '> Día del evento <span class="muted small">— aviso el día de tus fiestas favoritas o guardadas</span></label>' +
        '<label class="push-pref"><input type="checkbox" data-push-pref="newBusinesses"' + (p.newBusinesses ? ' checked' : '') + '> Nuevos negocios <span class="muted small">— negocios que se registren</span></label>';
      if (!pushPrefsBound) {
        pushPrefsBound = true;
        box.addEventListener('change', function (e) {
          var t = e.target || null;
          if (!t || !t.getAttribute || !t.getAttribute('data-push-pref')) return;
          var cur = pushPrefs();
          cur[t.getAttribute('data-push-pref')] = !!t.checked;
          savePushPrefs(cur);
          toast('Preferencia guardada');
        });
      }
    } catch (e) {}
  }

  /* ---------- Aviso de permisos al primer inicio (v18) ----------
     Una sola vez, después de la bienvenida: un aviso corto con dos
     botones (Revisar permisos / Ahora no). No vuelve a salir aunque
     se toque "Ahora no": la sección Permisos queda siempre en Cuenta. */
  function maybeShowPermPrompt() {
    try {
      if (load('pegaoxl_perms_asked_v18', false)) return;
      var ov = document.getElementById('welcomeOverlay');
      if (ov && !ov.classList.contains('hidden')) return; /* la bienvenida va primero */
      var p = document.getElementById('permPrompt');
      if (p) p.classList.remove('hidden');
    } catch (e) {}
  }
  function closePermPrompt() {
    try { save('pegaoxl_perms_asked_v18', true); var p = document.getElementById('permPrompt'); if (p) p.classList.add('hidden'); } catch (e) {}
  }
  var permPromptReviewBtn = document.getElementById('permPromptReview');
  if (permPromptReviewBtn) permPromptReviewBtn.addEventListener('click', function () {
    closePermPrompt(); showTab('cuenta');
    setTimeout(function () { var s = document.getElementById('permSection'); if (s && s.scrollIntoView) s.scrollIntoView(); }, 150);
  });
  var permPromptLaterBtn = document.getElementById('permPromptLater');
  if (permPromptLaterBtn) permPromptLaterBtn.addEventListener('click', closePermPrompt);

  /* ---------- Recordatorio del día del evento: favoritas y guardadas (v18) ----------
     "Me interesa" ya avisaba el día del evento; ahora también lo hacen
     las fiestas favoritas y guardadas. Las tres fuentes usan la MISMA
     notificación local (mismo id), así una fiesta que es favorita y te
     interesa suena una sola vez. Si deja de ser favorita, guardada o
     de interesarte, el aviso se cancela. */
  function cancelEventDayReminder(id) {
    try {
      var ln = localNotifPlugin(); if (!ln || !ln.cancel) return;
      ln.cancel({ notifications: [{ id: interestNotifId(id) }] }).catch(function () {});
    } catch (e) {}
  }
  function scheduleEventDayReminder(kind, id) {
    /* Alias claro para los tests y para el cron futuro: programa el
       aviso del día del evento de una fiesta (usa el mismo id que
       scheduleInterestReminder, así no se duplica). */
    try {
      if (kind !== 'fiesta') return;
      var p = parties().filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      scheduleInterestReminder(id, { title: p.desc, date: p.date, time: p.time, place: p.place });
    } catch (e) {}
  }
  function refreshEventRemindersFor(kind, id) {
    try {
      if (kind !== 'fiesta') return;
      var p = parties().filter(function (x) { return x.id === id; })[0];
      if (!p) { cancelEventDayReminder(id); return; }
      var want = isFavorite('fiesta', id) || isSaved('fiesta', id) || isInterested(id);
      if (!want) { cancelEventDayReminder(id); return; }
      scheduleInterestReminder(id, { title: p.desc, date: p.date, time: p.time, place: p.place });
    } catch (e) {}
  }
  function rescheduleEventReminders() {
    /* Al arrancar: reprograma los avisos del día de todas las fiestas
       favoritas, guardadas o que te interesan que todavía no pasaron.
       Solo local, sin lecturas de red, una vez por arranque. */
    try {
      var seen = {};
      var add = function (id) {
        if (!id || seen[id]) return; seen[id] = true;
        refreshEventRemindersFor('fiesta', id);
      };
      favoriteItems().forEach(function (f) { if (f.kind === 'fiesta') add(f.id); });
      savedItems().forEach(function (s) { if (s.kind === 'fiesta') add(s.id); });
      Object.keys(interestedMap()).forEach(add);
    } catch (e) {}
  }

  /* ---------- Invitar desde contactos (v18) ----------
     Elige un contacto del teléfono y le manda tu enlace por WhatsApp
     (si tiene teléfono) o por correo (si solo tiene email). Solo
     funciona dentro de la APK con el plugin de contactos instalado;
     si no, el botón ni aparece. Los números cubanos sin código de
     país (8 dígitos que empiezan por 5) llevan +53. */
  function inviteFromContacts() {
    try {
      var cp = contactsPlugin();
      if (!cp || !cp.pickContact) { toast('Invitar desde contactos solo funciona dentro de la APK'); return; }
      cp.pickContact().then(function (c) {
        try {
          var phone = null;
          if (c && c.phoneNumbers && c.phoneNumbers.length) phone = c.phoneNumbers[0].number || c.phoneNumbers[0].value || null;
          var link = myInviteLink();
          var text = 'Entra a PEGAO XL con mi enlace: ' + link;
          if (phone) {
            var digits = String(phone).replace(/[^0-9+]/g, '');
            if (digits.charAt(0) !== '+') {
              var d = digits.replace(/^0+/, '');
              digits = (d.length === 8 && d.charAt(0) === '5') ? ('+53' + d) : d;
            }
            window.open('https://wa.me/' + digits.replace('+', '') + '?text=' + encodeURIComponent(text), '_blank');
            return;
          }
          var email = (c && c.emails && c.emails.length) ? (c.emails[0].address || c.emails[0].value) : null;
          if (email) { window.location.href = 'mailto:' + email + '?subject=' + encodeURIComponent('Entra a PEGAO XL') + '&body=' + encodeURIComponent(text); return; }
          toast('Ese contacto no tiene teléfono ni correo');
        } catch (e) { toast('No se pudo invitar a ese contacto'); }
      }).catch(function () { /* canceló la selección */ });
    } catch (e) {}
  }

  /* ---------- Limpieza v18: restos de la versión anterior ----------
     Al arrancar, borra los cachés locales de la pestaña eliminada y
     quita sus entradas de favoritos y guardados. La nube NO se toca:
     las colecciones viejas quedan ahí, sin uso, por si algún día hace
     falta mirarlas. */
  function cleanupLegacyDriverData() {
    try {
      removeStored('pegaoxl_drivers');
      removeStored('pegaoxl_rides');
      var favs = favoriteItems().filter(function (f) { return f.kind === 'fiesta' || f.kind === 'negocio'; });
      if (favs.length !== favoriteItems().length) save('pegaoxl_favorites', favs);
      var svd = savedItems().filter(function (s) { return s.kind === 'fiesta' || s.kind === 'negocio'; });
      if (svd.length !== savedItems().length) save('pegaoxl_saved', svd);
    } catch (e) {}
  }

  /* ---------- Ayudas del feed: precio, distancia, filtros ----------
     Precio en texto libre ("Gratis", "$5", "300"): "gratis" es 0, si
     no el primer número que aparezca; sin número no se sabe. */
  function parsePrice(priceText) {
    try {
      var s = String(priceText || '').toLowerCase();
      if (!s.trim()) return null;
      if (s.indexOf('gratis') >= 0 || s.indexOf('free') >= 0) return 0;
      var m = s.match(/(\d+(?:[.,]\d+)?)/);
      if (!m) return null;
      return parseFloat(m[1].replace(',', '.'));
    } catch (e) { return null; }
  }
  function priceMatches(priceText, filter) {
    var v = parsePrice(priceText);
    if (filter === 'gratis') return v === 0;
    if (filter === 'hasta5') return v !== null && v <= 5;
    if (filter === 'hasta10') return v !== null && v <= 10;
    if (filter === 'mas10') return v !== null && v > 10;
    return true;
  }
  function feedDist(x) {
    if (!myLatLng || !isFinite(x.lat) || !isFinite(x.lng)) return Infinity;
    return distMeters(myLatLng.lat, myLatLng.lng, x.lat, x.lng);
  }
  function clearFeedFilters() {
    try {
      var s = $('#feedSearch'); if (s) s.value = '';
      var f = $('#feedFilter'); if (f) f.value = 'todo';
      var c = $('#feedCategory'); if (c) c.value = 'todas';
      var p = $('#feedPrice'); if (p) p.value = 'cualquiera';
      setFeedNear(false);
      setFeedOpenOnly(false);
      $$('.feed-chip').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-feed-cat') === 'todas'); });
      renderFeed();
      toast('Filtros quitados');
    } catch (e) {}
  }
  /* Chips de categoría del feed (como los del mapa). "Abierto ahora"
     es un filtro aparte: solo negocios abiertos en este momento. */
  $$('.feed-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var cat = chip.getAttribute('data-feed-cat');
      if (cat === 'abierto') { setFeedOpenOnly(!feedOpenOnly); renderFeed(); return; }
      setFeedOpenOnly(false);
      $$('.feed-chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      var sel = $('#feedCategory'); if (sel) sel.value = (cat === 'todas') ? 'todas' : cat;
      renderFeed();
    });
  });
  var feedPriceEl = $('#feedPrice');
  if (feedPriceEl) feedPriceEl.addEventListener('change', renderFeed);
  var feedNear = false;
  var feedOpenOnly = false;
  function setFeedOpenOnly(on) {
    feedOpenOnly = !!on;
    $$('.feed-chip').forEach(function (c) { if (c.getAttribute('data-feed-cat') === 'abierto') c.classList.toggle('active', feedOpenOnly); });
  }
  function setFeedNear(on) {
    feedNear = !!on;
    var b = $('#feedNearBtn');
    if (b) { b.classList.toggle('active', feedNear); b.setAttribute('aria-pressed', feedNear ? 'true' : 'false'); }
  }
  var feedNearBtn = $('#feedNearBtn');
  if (feedNearBtn) feedNearBtn.addEventListener('click', function () {
    if (feedNear) { setFeedNear(false); renderFeed(); return; }
    if (myLatLng) { setFeedNear(true); renderFeed(); toast('Ordenado por lo más cercano 📍'); return; }
    toast('Buscando tu ubicación…');
    getCurrentPositionOnce().then(function (pos) {
      if (pos) { myLatLng = pos; setFeedNear(true); renderFeed(); toast('Ordenado por lo más cercano 📍'); }
      else toast('No se pudo obtener tu ubicación');
    });
  });
  var feedCalendarBtn = $('#feedCalendarBtn');
  if (feedCalendarBtn) feedCalendarBtn.addEventListener('click', function () {
    var cal = $('#calendarView');
    if (!cal) return;
    var showing = cal.classList.contains('hidden');
    cal.classList.toggle('hidden', !showing);
    feedCalendarBtn.classList.toggle('active', showing);
    feedCalendarBtn.setAttribute('aria-pressed', showing ? 'true' : 'false');
    renderFeed();
  });

  /* ---------- Secciones del feed: favoritos, hoy, top, calendario ----------
     "Tus favoritos" va primero; debajo, todo lo demás normal y
     completo, en el orden de siempre. Nada se esconde. */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fmtDateEs(dateStr) {
    try {
      var p = String(dateStr).split('-');
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (e) { return String(dateStr || ''); }
  }
  function sectionCardHtml(kind, x, title, sub) {
    return '<button type="button" class="today-card" data-section-open="' + kind + ':' + x.id + '">' +
      '<strong>' + esc(title) + '</strong><span>' + esc(sub) + '</span></button>';
  }
  function bindSectionCards(root) {
    try {
      (root || document).querySelectorAll('[data-section-open]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = b.getAttribute('data-section-open').split(':');
          if (p[0] === 'fiesta') openPartyDetail(p[1]);
          else openBizDetail(p[1]);
        });
      });
    } catch (e) {}
  }
  function renderFavSection() {
    try {
      var box = document.getElementById('favSection'); if (!box) return;
      var favs = favoriteItems();
      if (!favs.length) { box.innerHTML = ''; return; }
      var cards = [];
      favs.forEach(function (f) {
        var x = f.kind === 'fiesta'
          ? parties().filter(function (p) { return p.id === f.id; })[0]
          : businesses().filter(function (b) { return b.id === f.id; })[0];
        if (!x) return;
        var title = f.kind === 'fiesta' ? (x.desc || 'Fiesta') : (x.name || 'Negocio');
        var sub = (f.kind === 'fiesta' ? ((x.date || '') + ' · ') : '') + (x.place || '');
        cards.push(sectionCardHtml(f.kind, x, '⭐ ' + title, sub));
      });
      if (!cards.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<h2 class="today-title">⭐ Tus favoritos</h2><div class="today-row">' + cards.join('') + '</div>';
      bindSectionCards(box);
    } catch (e) {}
  }
  function todayParties() {
    var today = todayStr(new Date());
    return parties().filter(function (p) { return p.date === today; });
  }
  function weekParties() {
    var today = todayStr(new Date());
    var end = todayStr(new Date(Date.now() + 7 * 24 * 3600 * 1000));
    return parties().filter(function (p) { return p.date && p.date > today && p.date <= end; });
  }
  function renderTodaySection() {
    try {
      var box = document.getElementById('todaySection'); if (!box) return;
      var todays = todayParties();
      var week = weekParties();
      if (!todays.length && !week.length) { box.innerHTML = ''; return; }
      var html = '';
      if (todays.length) {
        html += '<h2 class="today-title">🔥 Hoy</h2><div class="today-row">' + todays.map(function (p) {
          return sectionCardHtml('fiesta', p, p.desc || 'Fiesta', (p.place || '') + ' · ' + (p.time || ''));
        }).join('') + '</div>';
      }
      if (week.length) {
        html += '<h2 class="today-title">📅 Esta semana</h2><div class="today-row">' + week.map(function (p) {
          return sectionCardHtml('fiesta', p, p.desc || 'Fiesta', fmtDateEs(p.date) + ' · ' + (p.time || ''));
        }).join('') + '</div>';
      }
      box.innerHTML = html;
      bindSectionCards(box);
    } catch (e) {}
  }
  function topWeekly() {
    var items = [];
    parties().forEach(function (p) { items.push({ kind: 'fiesta', x: p }); });
    businesses().forEach(function (b) { items.push({ kind: 'negocio', x: b }); });
    var scored = items.map(function (it) { return { it: it, r: ratingFor(it.kind, it.x.id) }; })
      .filter(function (o) { return o.r.count > 0; });
    scored.sort(function (a, b) { return (b.r.avg - a.r.avg) || (b.r.count - a.r.count); });
    return scored.slice(0, 5);
  }
  function renderTopSection() {
    try {
      var box = document.getElementById('topSection'); if (!box) return;
      var top = topWeekly();
      if (!top.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<h2 class="top-title">🏆 Top de la semana</h2><div class="top-row">' + top.map(function (o, i) {
        var x = o.it.x;
        var title = o.it.kind === 'fiesta' ? (x.desc || 'Fiesta') : (x.name || 'Negocio');
        return '<button type="button" class="top-card" data-section-open="' + o.it.kind + ':' + x.id + '">' +
          '<span class="top-rank">' + (i + 1) + '</span><strong>' + esc(title) + '</strong>' +
          '<span>★ ' + o.r.avg.toFixed(1) + ' · ' + o.r.count + (o.r.count === 1 ? ' reseña' : ' reseñas') + '</span></button>';
      }).join('') + '</div>';
      bindSectionCards(box);
    } catch (e) {}
  }
  function calendarGroups() {
    var byDate = {};
    parties().forEach(function (p) {
      if (!p.date) return;
      if (!byDate[p.date]) byDate[p.date] = [];
      byDate[p.date].push(p);
    });
    var dates = Object.keys(byDate).sort();
    return dates.map(function (d) { return { date: d, parties: byDate[d] }; });
  }
  function renderCalendar() {
    try {
      var box = document.getElementById('calendarView'); if (!box) return;
      if (box.classList.contains('hidden')) return;
      var groups = calendarGroups();
      if (!groups.length) { box.innerHTML = '<p class="muted">No hay fiestas con fecha todavía. Cuando alguien publique una con fecha, sale aquí.</p>'; return; }
      box.innerHTML = '<h2 class="today-title">📅 Calendario de eventos</h2>' + groups.map(function (g) {
        return '<div class="cal-day"><h3>' + esc(fmtDateEs(g.date)) + '</h3>' + g.parties.map(function (p) {
          return '<button type="button" data-cal-open="' + p.id + '">' + esc(p.desc || 'Fiesta') + ' · ' + esc(p.time || '') + ' · ' + esc(p.place || '') + '</button>';
        }).join('') + '</div>';
      }).join('');
      box.querySelectorAll('[data-cal-open]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-cal-open');
          box.classList.add('hidden');
          var cb = document.getElementById('feedCalendarBtn');
          if (cb) { cb.classList.remove('active'); cb.setAttribute('aria-pressed', 'false'); }
          renderFeed();
          setTimeout(function () { highlightPostCard('fiesta', id); }, 150);
        });
      });
    } catch (e) {}
  }

  /* ---------- Vistas: una por usuario, por publicación, por día ----------
     El contador "👁 X" sale en cada tarjeta. Solo cuenta con nube
     conectada (el número vive en Firestore) y una sola vez al día por
     teléfono y publicación. */
  function countViews(items) {
    try {
      if (mirrorMode || !isCloud() || typeof firebase === 'undefined') return;
      var seen = load('pegaoxl_viewed', {});
      var today = todayStr(new Date());
      var changed = false;
      items.forEach(function (it) {
        var key = it.kind + ':' + it.x.id;
        if (seen[key] === today) return;
        seen[key] = today; changed = true;
        var coll = it.kind === 'fiesta' ? 'parties' : 'businesses';
        var key2 = CACHE_KEYS[coll];
        var list = load(key2, []);
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === it.x.id) { list[i].views = (typeof list[i].views === 'number' ? list[i].views : 0) + 1; break; }
        }
        save(key2, list);
        try {
          db.collection(coll).doc(it.x.id).update({ views: firebase.firestore.FieldValue.increment(1) }).catch(function () {});
        } catch (e) {}
      });
      if (changed) save('pegaoxl_viewed', seen);
    } catch (e) {}
  }

  /* ---------- Reportar publicación ----------
     "Reportar" en cada tarjeta escribe en la colección `reports`
     (escritura autenticada, ya permitida por las reglas). Solo el
     dueño (OWNER_UID) ve la lista en Cuenta y puede borrar la
     publicación reportada. */
  function reportPost(kind, id) {
    if (!guardAction()) return;
    var u = currentUser();
    if (!u) { toast('Regístrate con Google para reportar'); showTab('cuenta'); return; }
    var reason = prompt('¿Por qué reportas esta publicación? (spam, contenido inapropiado, otro)', 'Contenido inapropiado');
    if (reason === null) return;
    var obj = { id: uid(), targetKind: kind, targetId: id, by: u.name, byId: profileIdOf(u), reason: (reason || '').trim() || 'Sin motivo', at: Date.now(), pending: isCloud() };
    var list = load('pegaoxl_reports', []);
    list.unshift(obj);
    save('pegaoxl_reports', list);
    if (isCloud()) cloudPut('reports', obj);
    toast('Reporte enviado, lo revisaremos');
  }
  var reportsStarted = false;
  function isOwner() {
    var u = currentUser(); if (!u) return false;
    return profileIdOf(u) === OWNER_UID;
  }
  function startReportsListener() {
    try {
      if (reportsStarted || !isCloud() || !isOwner()) return;
      reportsStarted = true;
      var rq = db.collection('reports').orderBy('at', 'desc');
      if (rq.limit) rq = rq.limit(50);
      rq.onSnapshot(function (snap) {
        var arr = [];
        snap.forEach(function (doc) { var o = doc.data() || {}; o.id = doc.id; arr.push(o); });
        save('pegaoxl_reports', arr);
        renderReports();
      }, function () { /* sigue en local */ });
    } catch (e) {}
  }
  function renderReports() {
    try {
      var sec = document.getElementById('reportsSection');
      if (!sec) return;
      sec.classList.toggle('hidden', !isOwner());
      if (!isOwner()) return;
      var list = load('pegaoxl_reports', []);
      var box = document.getElementById('reportsList');
      if (!box) return;
      if (!list.length) { box.innerHTML = '<p class="muted">No hay reportes. Cuando alguien reporte una publicación, sale aquí.</p>'; return; }
      box.innerHTML = list.slice(0, 20).map(function (r) {
        var target = r.targetKind === 'fiesta'
          ? (parties().filter(function (p) { return p.id === r.targetId; })[0] || null)
          : (businesses().filter(function (b) { return b.id === r.targetId; })[0] || null);
        var title = target ? (r.targetKind === 'fiesta' ? target.desc : target.name) : '(publicación borrada)';
        return '<div class="report-item"><p><strong>' + esc(title) + '</strong> <span class="tag">' + esc(r.targetKind === 'fiesta' ? 'Fiesta' : 'Negocio') + '</span></p>' +
          '<p class="muted">Reportado por ' + esc(r.by || '') + ': ' + esc(r.reason || '') + '</p>' +
          (target ? '<button type="button" class="btn-danger" data-report-del="' + r.targetKind + ':' + r.targetId + ':' + r.id + '">Borrar publicación</button>' : '') + '</div>';
      }).join('');
      box.querySelectorAll('[data-report-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = b.getAttribute('data-report-del').split(':');
          if (!confirm('¿Borrar esta publicación reportada?')) return;
          deleteListing(p[0], p[1]);
          var l2 = load('pegaoxl_reports', []).filter(function (r) { return r.id !== p[2]; });
          save('pegaoxl_reports', l2);
          if (isCloud()) { try { db.collection('reports').doc(p[2]).delete().catch(function () {}); } catch (e) {} }
          renderReports();
        });
      });
    } catch (e) {}
  }

  /* ---------- Guardados en Cuenta ---------- */
  function renderSaved() {
    try {
      var box = document.getElementById('savedList'); if (!box) return;
      var items = savedItems();
      if (!items.length) { box.innerHTML = '<p class="muted saved-empty">Nada guardado todavía. Toca 🔖 Guardar en cualquier fiesta o negocio.</p>'; return; }
      var cards = [];
      items.forEach(function (s) {
        var x = s.kind === 'fiesta'
          ? parties().filter(function (p) { return p.id === s.id; })[0]
          : businesses().filter(function (b) { return b.id === s.id; })[0];
        if (!x) return;
        var title = s.kind === 'fiesta' ? (x.desc || 'Fiesta') : (x.name || 'Negocio');
        cards.push('<button type="button" class="profile-post-card" data-section-open="' + s.kind + ':' + x.id + '">' +
          '<span class="profile-post-thumb"><span class="profile-post-thumb-letter">' + esc((title || '?').trim().charAt(0).toUpperCase()) + '</span></span>' +
          '<span class="profile-post-title">' + esc(title) + '</span>' +
          '<span class="tag">' + (s.kind === 'fiesta' ? 'Fiesta' : 'Negocio') + '</span></button>');
      });
      box.innerHTML = cards.length ? cards.join('') : '<p class="muted saved-empty">Los guardados ya no están disponibles.</p>';
      bindSectionCards(box);
    } catch (e) {}
  }

  /* ---------- Reservar ----------
     Botón "Reservar" en cada fiesta y negocio. El que publica pone su
     WhatsApp (reservePhone) y/o su Instagram (reserveIg) en el
     formulario. El Instagram se guarda TAL CUAL lo escribe el usuario,
     con o sin @; al mostrar siempre lleva la @ delante
     ("@elpegaony_") y el enlace nunca lleva @
     (https://www.instagram.com/elpegaony_/). El teléfono se guarda
     solo con dígitos y con código de país: si escribe 5xxxxxxx (Cuba)
     queda 535xxxxxxx. El campo viejo "contact" sigue funcionando: si
     empieza por @ es Instagram, si son dígitos es WhatsApp. Sin
     ningún contacto no sale el botón. Una reserva = UNA escritura en
     la colección `reservations` (local + nube si hay), nunca en bucle
     ni por render; el que publicó la ve en su Cuenta y la confirma o
     cancela. Las reservas pendientes suben solas al reconectar
     (flushPending, por estar en CACHE_KEYS). */
  function normalizePhone(raw) {
    try {
      var d = String(raw || '').replace(/\D/g, '');
      if (!d) return '';
      if (d.length === 8 && d.charAt(0) === '5') return '53' + d; /* Cuba: 5xxxxxxx -> 535xxxxxxx */
      return d;
    } catch (e) { return ''; }
  }
  function igHandle(raw) {
    try { return String(raw || '').trim().replace(/^@+/, ''); } catch (e) { return ''; }
  }
  function displayIg(raw) {
    var h = igHandle(raw);
    return h ? '@' + h : '';
  }
  function reserveContactsOf(x) {
    try {
      var phone = normalizePhone(x.reservePhone || '');
      var ig = igHandle(x.reserveIg || '');
      if (!phone && !ig) {
        var c = String(x.contact || '').trim();
        if (c.charAt(0) === '@') ig = igHandle(c);
        else if (/^\+?[\d\s().-]+$/.test(c) && c.replace(/\D/g, '').length >= 7) phone = normalizePhone(c);
      }
      return { phone: phone, ig: ig };
    } catch (e) { return { phone: '', ig: '' }; }
  }
  function reserveUrlFor(kind, x, via) {
    try {
      var c = reserveContactsOf(x);
      var title = kind === 'fiesta' ? (x.desc || 'Fiesta') : (x.name || 'Negocio');
      if (via === 'whatsapp' && c.phone) return 'https://wa.me/' + c.phone + '?text=' + encodeURIComponent('Hola, quiero reservar para ' + title);
      if (via === 'instagram' && c.ig) return 'https://www.instagram.com/' + c.ig + '/';
      return null;
    } catch (e) { return null; }
  }
  function reservations() { return load('pegaoxl_reservations', []); }
  /* Lugares que quedan: capacidad menos las reservas CONFIRMADAS
     (las pendientes no restan hasta que el que publicó las confirma).
     null = sin capacidad puesta. */
  function remainingSeats(p) {
    try {
      if (!p || !p.capacity) return null;
      var cap = parseInt(p.capacity, 10);
      if (!isFinite(cap) || cap <= 0) return null;
      var used = 0;
      reservations().forEach(function (r) {
        if (r.postId === p.id && r.status === 'confirmada') used += (parseInt(r.people, 10) || 1);
      });
      return Math.max(0, cap - used);
    } catch (e) { return null; }
  }
  function seatsLineHtml(p) {
    var left = remainingSeats(p);
    if (left === null) return '';
    return '<p class="seats-line">' + (left > 0 ? 'Quedan ' + left + ' lugares' : 'Completo') + '</p>';
  }
  function reserveLineHtml(x) {
    /* Solo si puso los campos nuevos: el contacto viejo ya se muestra
       en la línea "Contacto" de la tarjeta. */
    if (!x.reservePhone && !x.reserveIg) return '';
    var c = reserveContactsOf(x);
    if (!c.phone && !c.ig) return '';
    var parts = [];
    if (c.phone) parts.push('WhatsApp ' + esc(c.phone));
    if (c.ig) parts.push('Instagram ' + esc(displayIg(c.ig)));
    return '<p>Reservas: ' + parts.join(' · ') + '</p>';
  }
  function reserveBtnHtml(kind, x) {
    var c = reserveContactsOf(x);
    if (!c.phone && !c.ig) return '';
    if (kind === 'fiesta') {
      var left = remainingSeats(x);
      if (left !== null && left <= 0) return '<button type="button" class="reserve-btn" disabled>Completo</button>';
    }
    return '<button type="button" class="reserve-btn" data-reserve="' + kind + ':' + x.id + '">📋 Reservar</button>';
  }
  /* Horario del negocio: true = abierto ahora, false = cerrado,
     null = no puso horario. Si cierra después de medianoche
     (ej. 18:00-02:00) el rango cruza la medianoche. */
  function isOpenNow(b) {
    try {
      if (!b || !b.openTime || !b.closeTime) return null;
      var now = new Date();
      var mins = now.getHours() * 60 + now.getMinutes();
      var op = b.openTime.split(':');
      var cl = b.closeTime.split(':');
      var open = parseInt(op[0], 10) * 60 + parseInt(op[1], 10);
      var close = parseInt(cl[0], 10) * 60 + parseInt(cl[1], 10);
      if (close <= open) return mins >= open || mins < close;
      return mins >= open && mins < close;
    } catch (e) { return null; }
  }
  function openStatusHtml(b) {
    var st = isOpenNow(b);
    if (st === null) return '';
    if (st) return '<span class="open-badge open">🟢 Abierto ahora</span>';
    return '<span class="open-badge closed">🔴 Cerrado · abre a las ' + esc(b.openTime || '') + '</span>';
  }
  var pendingReserve = null;
  function openReserveContact(kind, x) {
    try {
      var c = reserveContactsOf(x);
      if (!c.phone && !c.ig) { toast('Este anuncio no tiene contacto para reservar'); return; }
      if (c.phone && !c.ig) { window.open(reserveUrlFor(kind, x, 'whatsapp')); return; }
      if (c.ig && !c.phone) { window.open(reserveUrlFor(kind, x, 'instagram')); return; }
      /* Los dos: chooser pequeño, el usuario elige por dónde. */
      pendingReserve = { kind: kind, id: x.id };
      var t = document.getElementById('reserveChooserTitle');
      if (t) t.textContent = kind === 'fiesta' ? (x.desc || 'Fiesta') : (x.name || 'Negocio');
      var box = document.getElementById('reserveChooser');
      if (box) box.classList.remove('hidden');
    } catch (e) {}
  }
  function hideReserveChooser() {
    try { var box = document.getElementById('reserveChooser'); if (box) box.classList.add('hidden'); pendingReserve = null; } catch (e) {}
  }
  /* Confirmar reserva: pregunta cuántas personas (1-10), guarda UNA
     reserva en `reservations` y abre el contacto. Si no está
     registrado, queda como anónimo (solo fecha y marcador). */
  function saveReservation(kind, id) {
    try {
      if (!guardAction()) return;
      var x = kind === 'fiesta'
        ? parties().filter(function (p) { return p.id === id; })[0]
        : businesses().filter(function (b) { return b.id === id; })[0];
      if (!x) return;
      var c = reserveContactsOf(x);
      if (!c.phone && !c.ig) { toast('Este anuncio no tiene contacto para reservar'); return; }
      if (kind === 'fiesta') {
        var left0 = remainingSeats(x);
        if (left0 !== null && left0 <= 0) { toast('Ya está completo'); return; }
      }
      if (!confirm('¿Confirmar reserva?')) return;
      var peopleRaw = prompt('¿Cuántas personas? (1-10)', '2');
      if (peopleRaw === null) return;
      var people = parseInt(peopleRaw, 10);
      if (!isFinite(people) || people < 1) people = 1;
      if (people > 10) people = 10;
      if (kind === 'fiesta') {
        var left = remainingSeats(x);
        if (left !== null && people > left) { toast('Solo quedan ' + left + ' lugares'); return; }
      }
      var u = currentUser();
      var obj = { id: uid(), postId: id, postKind: kind, title: kind === 'fiesta' ? (x.desc || 'Fiesta') : (x.name || 'Negocio'), byUid: u ? profileIdOf(u) : null, byName: u ? u.name : 'Anónimo', people: people, status: 'pendiente', at: Date.now(), pending: isCloud() };
      var list = reservations();
      list.unshift(obj);
      save('pegaoxl_reservations', list);
      if (isCloud()) cloudPut('reservations', obj);
      toast('Reserva registrada ✓');
      openReserveContact(kind, x);
      renderFeed();
      renderReservations();
    } catch (e) {}
  }
  function setReservationStatus(id, status) {
    try {
      var list = reservations();
      var r = null;
      list.forEach(function (x) { if (x.id === id) r = x; });
      if (!r) return;
      r.status = status;
      save('pegaoxl_reservations', list);
      if (isCloud()) { try { db.collection('reservations').doc(id).update({ status: status }).catch(function () {}); } catch (e) {} }
      toast(status === 'confirmada' ? 'Reserva confirmada ✓' : 'Reserva cancelada');
      renderReservations();
      renderFeed(); /* los lugares que quedan cambian */
    } catch (e) {}
  }
  /* Reservas de MIS publicaciones: solo el que publicó las ve, en su
     Cuenta. Acotado a 50. */
  function renderReservations() {
    try {
      var sec = document.getElementById('reservationsSection');
      if (!sec) return;
      var u = currentUser();
      if (!u) { sec.classList.add('hidden'); return; }
      var myTitles = {};
      parties().forEach(function (p) { if (p.by === u.name) myTitles[p.id] = p.desc || 'Fiesta'; });
      businesses().forEach(function (b) { if (b.by === u.name) myTitles[b.id] = b.name || 'Negocio'; });
      var mine = reservations().filter(function (r) { return !!myTitles[r.postId]; });
      sec.classList.toggle('hidden', !mine.length);
      var box = document.getElementById('reservationsList');
      if (!box) return;
      if (!mine.length) { box.innerHTML = '<p class="muted">Nadie reservó todavía.</p>'; return; }
      box.innerHTML = mine.slice(0, 50).map(function (r) {
        var statusTxt = r.status === 'confirmada' ? '✅ Confirmada' : r.status === 'cancelada' ? '❌ Cancelada' : '⏳ Pendiente';
        return '<div class="reservation-item"><p><strong>' + esc(r.byName || 'Anónimo') + '</strong> · ' + esc(String(r.people || 1)) + (parseInt(r.people, 10) === 1 ? ' persona' : ' personas') + '</p>' +
          '<p class="muted">' + esc(myTitles[r.postId] || '') + ' · ' + esc(statusTxt) + '</p>' +
          (r.status === 'pendiente'
            ? '<div class="reservation-actions"><button type="button" class="btn-primary" data-res-confirm="' + r.id + '">Confirmar</button> <button type="button" class="btn-secondary" data-res-cancel="' + r.id + '">Cancelar</button></div>'
            : '') + '</div>';
      }).join('');
      box.querySelectorAll('[data-res-confirm]').forEach(function (b) {
        b.addEventListener('click', function () { setReservationStatus(b.getAttribute('data-res-confirm'), 'confirmada'); });
      });
      box.querySelectorAll('[data-res-cancel]').forEach(function (b) {
        b.addEventListener('click', function () { setReservationStatus(b.getAttribute('data-res-cancel'), 'cancelada'); });
      });
    } catch (e) {}
  }
  /* ---------- Panel administrativo ----------
     Usuarios (suspender/reactivar + planes), moderación (borrar
     publicaciones) y aviso para todos (broadcasts). */
  function renderAdminPanel() {
    try {
      var sec = document.getElementById('adminPanel'); if (!sec) return;
      sec.classList.toggle('hidden', !isAdmin());
      if (!isAdmin()) return;
      var map = profilesMap();
      var ids = Object.keys(map).sort(function (a, b) {
        var na = (map[a] && (map[a].displayName || map[a].username || '')) || '';
        var nb = (map[b] && (map[b].displayName || map[b].username || '')) || '';
        return na.localeCompare(nb);
      });
      var box = document.getElementById('adminUsersList');
      if (box) {
        if (!ids.length) { box.innerHTML = '<p class="muted">No hay usuarios registrados todavía.</p>'; }
        else {
          box.innerHTML = ids.slice(0, 50).map(function (id) {
            var p = map[id] || {};
            var name = esc(p.displayName || p.ownerName || p.username || id);
            var plan = activePlanOf(p);
            var planTxt = plan ? ' · ⭐ Plan ' + planLabel(plan.type) + (plan.until ? ' hasta ' + fmtDateShort(plan.until) : '') : '';
            var suspTxt = p.suspended ? ' · 🚫 Suspendido' : '';
            var me = id === profileIdOf(currentUser());
            var suspendBtn = me ? '' : (p.suspended
              ? '<button type="button" class="btn-secondary" data-admin-suspend="' + esc(id) + ':0">Reactivar</button>'
              : '<button type="button" class="btn-secondary" data-admin-suspend="' + esc(id) + ':1">Suspender</button>');
            var planBtns = '<button type="button" class="btn-secondary" data-admin-plan="' + esc(id) + ':premium">Premium</button> <button type="button" class="btn-secondary" data-admin-plan="' + esc(id) + ':mensual">Mensual</button> <button type="button" class="btn-secondary" data-admin-plan="' + esc(id) + ':anual">Anual</button>' +
              (p.plan ? ' <button type="button" class="btn-secondary" data-admin-plan-remove="' + esc(id) + '">Quitar plan</button>' : '');
            return '<div class="admin-user-item"><p><strong>' + name + '</strong> <span class="muted">' + esc(p.email || '') + '</span>' + planTxt + suspTxt + '</p><div class="admin-actions">' + suspendBtn + ' ' + planBtns + '</div></div>';
          }).join('');
        }
      }
      var mod = document.getElementById('adminModList');
      if (mod) {
        var posts = [];
        parties().forEach(function (p) { posts.push({ kind: 'fiesta', id: p.id, title: p.desc || 'Fiesta', by: p.by || '', at: p.at || 0 }); });
        businesses().forEach(function (b) { posts.push({ kind: 'negocio', id: b.id, title: b.name || 'Negocio', by: b.by || '', at: b.at || 0 }); });
        posts.sort(function (a, b) { return b.at - a.at; });
        posts = posts.slice(0, 20);
        mod.innerHTML = posts.length ? posts.map(function (it) {
          return '<div class="admin-mod-item"><p><strong>' + esc(it.title) + '</strong> <span class="tag">' + (it.kind === 'fiesta' ? 'Fiesta' : 'Negocio') + '</span> <span class="muted">por ' + esc(it.by) + '</span></p><button type="button" class="btn-danger" data-admin-del="' + it.kind + ':' + it.id + '">Eliminar</button></div>';
        }).join('') : '<p class="muted">No hay publicaciones todavía.</p>';
      }
    } catch (e) {}
  }
  function saveAdminProfile(uid, mutate, doneMsg) {
    try {
      if (!isAdmin()) return false;
      var map = profilesMap();
      var prof = map[uid];
      if (!prof) return false;
      mutate(prof);
      prof.updatedAt = Date.now();
      map[uid] = prof;
      save('pegaoxl_profiles', map);
      if (uid === profileIdOf(currentUser())) save('pegaoxl_profile', prof);
      if (isCloud()) cloudPut('profiles', prof);
      renderAdminPanel();
      if (doneMsg) toast(doneMsg);
      return true;
    } catch (e) { return false; }
  }
  function setSuspended(uid, value) {
    var map = profilesMap();
    var name = (map[uid] && (map[uid].displayName || map[uid].username)) || uid;
    return saveAdminProfile(uid, function (prof) { prof.suspended = !!value; }, value ? 'Usuario suspendido: ' + name : 'Usuario reactivado: ' + name);
  }
  function setPlan(uid, type) {
    if (['premium', 'mensual', 'anual'].indexOf(type) < 0) return false;
    var map = profilesMap();
    var name = (map[uid] && (map[uid].displayName || map[uid].username)) || uid;
    var since = Date.now();
    var until = type === 'mensual' ? since + 30 * 24 * 3600 * 1000 : type === 'anual' ? since + 365 * 24 * 3600 * 1000 : null;
    return saveAdminProfile(uid, function (prof) { prof.plan = { type: type, since: since, until: until }; }, 'Plan ' + planLabel(type) + ' activado para ' + name);
  }
  function removePlan(uid) {
    return saveAdminProfile(uid, function (prof) { delete prof.plan; }, 'Plan quitado');
  }
  /* Aviso para todos: un solo documento pequeño en `broadcasts`. Todas
     las apps lo muestran al momento por el listener (límite 1). Sin
     nube se guarda en local y se sube al reconectar (pending). */
  function sendBroadcast() {
    try {
      if (!isAdmin()) return false;
      var titleEl = document.getElementById('broadcastTitle');
      var msgEl = document.getElementById('broadcastMessage');
      var title = titleEl ? (titleEl.value || '').trim() : '';
      var message = msgEl ? (msgEl.value || '').trim() : '';
      if (!title && !message) { toast('Escribe el título y el mensaje del aviso'); return false; }
      var obj = { id: uid(), title: title, message: message, at: Date.now(), pending: isCloud() };
      var list = load('pegaoxl_broadcasts', []);
      list.unshift(obj);
      save('pegaoxl_broadcasts', list.slice(0, 5));
      if (isCloud()) cloudPut('broadcasts', obj);
      if (titleEl) titleEl.value = '';
      if (msgEl) msgEl.value = '';
      renderBroadcast();
      toast('Aviso enviado a todos ✓');
      return true;
    } catch (e) { return false; }
  }
  /* Banner del aviso arriba del feed. Se puede cerrar: queda guardado
     el id descartado y solo vuelve a salir con un aviso nuevo. */
  function renderBroadcast() {
    try {
      var banner = document.getElementById('broadcastBanner'); if (!banner) return;
      var list = load('pegaoxl_broadcasts', []);
      var latest = list && list.length ? list[0] : null;
      var dismissed = load('pegaoxl_broadcast_dismissed', null);
      if (!latest || (dismissed && dismissed === latest.id)) { banner.classList.add('hidden'); return; }
      var t = document.getElementById('broadcastBannerTitle');
      var m = document.getElementById('broadcastBannerText');
      if (t) t.textContent = latest.title || 'Aviso';
      if (m) m.textContent = latest.message || '';
      banner.classList.remove('hidden');
    } catch (e) {}
  }
  /* Botones del panel administrativo (delegación: las listas se repintan). */
  var adminPanelEl = document.getElementById('adminPanel');
  if (adminPanelEl) adminPanelEl.addEventListener('click', function (e) {
    try {
      var t = e.target && e.target.closest ? e.target.closest('[data-admin-suspend],[data-admin-plan],[data-admin-plan-remove],[data-admin-del]') : null;
      if (!t) return;
      var s = t.getAttribute('data-admin-suspend');
      if (s) { var sp = s.split(':'); setSuspended(sp[0], sp[1] === '1'); return; }
      var pl = t.getAttribute('data-admin-plan');
      if (pl) { var pp = pl.split(':'); setPlan(pp[0], pp[1]); return; }
      var pr = t.getAttribute('data-admin-plan-remove');
      if (pr) { removePlan(pr); return; }
      var del = t.getAttribute('data-admin-del');
      if (del) {
        var dp = del.split(':');
        if (!confirm('¿Eliminar esta publicación? Se borra el documento y su flyer.')) return;
        deleteListing(dp[0], dp[1]);
        renderAdminPanel();
        toast('Publicación eliminada');
      }
    } catch (err) {}
  });
  var broadcastSendBtn = document.getElementById('broadcastSendBtn');
  if (broadcastSendBtn) broadcastSendBtn.addEventListener('click', sendBroadcast);
  var broadcastCloseBtn = document.getElementById('broadcastBannerClose');
  if (broadcastCloseBtn) broadcastCloseBtn.addEventListener('click', function () {
    try {
      var list = load('pegaoxl_broadcasts', []);
      if (list.length) save('pegaoxl_broadcast_dismissed', list[0].id);
      renderBroadcast();
    } catch (e) {}
  });

  /* Botones del chooser (WhatsApp / Instagram / Cancelar). */
  $$('#reserveChooser [data-reserve-via]').forEach(function (b) {
    b.addEventListener('click', function () {
      try {
        if (!pendingReserve) { hideReserveChooser(); return; }
        var via = b.getAttribute('data-reserve-via');
        var x = pendingReserve.kind === 'fiesta'
          ? parties().filter(function (p) { return p.id === pendingReserve.id; })[0]
          : businesses().filter(function (b2) { return b2.id === pendingReserve.id; })[0];
        var url = x ? reserveUrlFor(pendingReserve.kind, x, via) : null;
        hideReserveChooser();
        if (url) window.open(url);
      } catch (e) { hideReserveChooser(); }
    });
  });
  var reserveChooserCancel = document.getElementById('reserveChooserCancel');
  if (reserveChooserCancel) reserveChooserCancel.addEventListener('click', hideReserveChooser);

  /* ---------- Invitar amigos ----------
     Enlace personal ?ref=<usuario> y contador de invitados
     (colección `referrals`, un documento por invitado). Al abrir la
     app con ?ref=, se guarda el referente y, si hay nube, se registra
     una sola vez. */
  function myInviteLink() {
    try {
      var prof = getMyProfile();
      var username = (prof && prof.username) || usernameFromEmail(currentUser() ? currentUser().email : '');
      return (window.PEGAO_SHARE_BASE || 'https://pegaony.github.io/pegao-xl/') + '?ref=' + encodeURIComponent(username);
    } catch (e) { return window.PEGAO_SHARE_BASE || 'https://pegaony.github.io/pegao-xl/'; }
  }
  var inviteCountLastFetch = 0;
  function refFromUrl(url) {
    try {
      var q = String(url || '').split('?')[1] || '';
      var m = q.match(/(?:^|&)ref=([^&#]*)/);
      if (!m) return null;
      var ref = decodeURIComponent(m[1] || '').trim();
      return ref || null;
    } catch (e) { return null; }
  }
  function handleRefParam() {
    try {
      var ref = refFromUrl(window.location && window.location.href);
      if (!ref) return;
      var me = currentUser() ? ((getMyProfile() && getMyProfile().username) || usernameFromEmail(currentUser().email)) : null;
      if (me && ref.toLowerCase() === String(me).toLowerCase()) return; /* no vale invitarse a uno mismo */
      save('pegaoxl_referred_by', ref);
      if (load('pegaoxl_ref_recorded', null) === ref) return;
      save('pegaoxl_ref_recorded', ref);
      if (isCloud()) {
        db.collection('referrals').doc(uid()).set({ ref: ref, by: currentUser() ? currentUser().name : 'anónimo', at: Date.now() }).catch(function () {});
      }
    } catch (e) {}
  }
  function renderInvite() {
    try {
      var linkEl = document.getElementById('inviteLinkText');
      var countEl = document.getElementById('inviteCountText');
      if (!linkEl) return;
      var u = currentUser();
      if (!u) { linkEl.textContent = 'Regístrate con Google para tener tu enlace personal.'; if (countEl) countEl.textContent = ''; return; }
      var link = myInviteLink();
      linkEl.textContent = link;
      var cb = document.getElementById('inviteContactsBtn');
      if (cb) cb.classList.toggle('hidden', !contactsPlugin()); /* v18: solo si el plugin de contactos está instalado */
      var savedCount = load('pegaoxl_referral_count', 0);
      if (countEl) countEl.textContent = savedCount > 0 ? (savedCount + (savedCount === 1 ? ' amigo entró con tu enlace.' : ' amigos entraron con tu enlace.')) : 'Todavía nadie entró con tu enlace.';
      var prof = getMyProfile();
      var username = (prof && prof.username) || usernameFromEmail(u.email);
      /* El contador se consulta como mucho una vez cada 10 minutos: el
         resto del tiempo vale el número guardado. Si se consultara en
         cada render, cada snapshot de la nube gastaría una lectura. */
      if (isCloud() && username && Date.now() - inviteCountLastFetch > 600000) {
        inviteCountLastFetch = Date.now();
        db.collection('referrals').where('ref', '==', username).get().then(function (snap) {
          try {
            var n = snap.size || 0;
            save('pegaoxl_referral_count', n);
            if (countEl) countEl.textContent = n > 0 ? (n + (n === 1 ? ' amigo entró con tu enlace.' : ' amigos entraron con tu enlace.')) : 'Todavía nadie entró con tu enlace.';
          } catch (e) {}
        }).catch(function () {});
      }
    } catch (e) {}
  }
  var inviteCopyBtn = document.getElementById('inviteCopyBtn');
  if (inviteCopyBtn) inviteCopyBtn.addEventListener('click', function () { copyText(myInviteLink(), 'Enlace copiado, compártelo con tus amigos'); });
  var inviteShareBtn = document.getElementById('inviteShareBtn');
  if (inviteShareBtn) inviteShareBtn.addEventListener('click', function () {
    var link = myInviteLink();
    var text = 'Entra a PEGAO XL con mi enlace: ' + link;
    if (navigator.share) { navigator.share({ title: 'PEGAO XL', text: text }).catch(function () {}); return; }
    copyText(text, 'Enlace copiado, compártelo con tus amigos');
  });
  var inviteContactsBtn = document.getElementById('inviteContactsBtn');
  if (inviteContactsBtn) inviteContactsBtn.addEventListener('click', inviteFromContacts); /* v18 */

  /* ---------- Bienvenida de 3 pasos ----------
     La primera vez que alguien abre la app: qué es, cómo se publica,
     cómo se buscan fiestas. Se salta y no vuelve a salir. */
  var WELCOME_STEPS = [
    { icon: '🎉', title: 'Bienvenido a PEGAO XL', text: 'Las fiestas del mundo en un solo lugar: fiestas y negocios completos cerca de ti.' },
    { icon: '📣', title: 'Publicar es gratis', text: 'Toca el botón dorado + y publica tu fiesta o tu negocio. Llega a todo el mundo, sin pagar nada.' },
    { icon: '🔍', title: 'Buscar en el mapa', text: 'Busca por nombre, lugar o fecha y usa el mapa para ver dónde es cada fiesta y cada negocio.' }
  ];
  var welcomeStep = 0;
  function renderWelcomeStep() {
    try {
      var s = WELCOME_STEPS[welcomeStep];
      var icon = document.getElementById('welcomeSteps'); if (icon) icon.textContent = s.icon;
      var t = document.getElementById('welcomeTitle'); if (t) t.textContent = s.title;
      var tx = document.getElementById('welcomeText'); if (tx) tx.textContent = s.text;
      var dots = document.getElementById('welcomeDots');
      if (dots) dots.innerHTML = WELCOME_STEPS.map(function (_, i) { return '<span class="' + (i === welcomeStep ? 'on' : '') + '"></span>'; }).join('');
      var next = document.getElementById('welcomeNextBtn');
      if (next) next.textContent = welcomeStep === WELCOME_STEPS.length - 1 ? 'Empezar' : 'Siguiente';
    } catch (e) {}
  }
  function showWelcomeIfNeeded() {
    try {
      if (load('pegaoxl_welcome_seen', false)) return;
      var ov = document.getElementById('welcomeOverlay');
      if (!ov) return;
      welcomeStep = 0;
      renderWelcomeStep();
      ov.classList.remove('hidden');
    } catch (e) {}
  }
  function closeWelcome() {
    try {
      save('pegaoxl_welcome_seen', true);
      var ov = document.getElementById('welcomeOverlay');
      if (ov) ov.classList.add('hidden');
      maybeShowPermPrompt(); /* v18: la bienvenida va primero, los permisos después */
    } catch (e) {}
  }
  var welcomeNextBtn = document.getElementById('welcomeNextBtn');
  if (welcomeNextBtn) welcomeNextBtn.addEventListener('click', function () {
    if (welcomeStep < WELCOME_STEPS.length - 1) { welcomeStep++; renderWelcomeStep(); }
    else closeWelcome();
  });
  var welcomeSkipBtn = document.getElementById('welcomeSkipBtn');
  if (welcomeSkipBtn) welcomeSkipBtn.addEventListener('click', closeWelcome);

  /* ---------- Tirar hacia abajo para actualizar ----------
     En el Feed, con el dedo arriba del todo: al bajar más de 70 px
     sale "Suelta para actualizar" y al soltar repinta el feed y
     reintenta la nube. Solo un indicador, sin recargar la página. */
  var ptrStartY = null, ptrActive = false;
  document.addEventListener('touchstart', function (e) {
    try {
      if (e.touches && e.touches.length === 1 && window.scrollY === 0) ptrStartY = e.touches[0].clientY;
      else ptrStartY = null;
    } catch (err) { ptrStartY = null; }
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    try {
      if (ptrStartY === null) return;
      var feed = document.getElementById('tab-feed');
      if (!feed || !feed.classList.contains('active')) return;
      var dy = e.touches[0].clientY - ptrStartY;
      var ind = document.getElementById('pullRefresh');
      if (!ind) return;
      if (dy > 70) { ptrActive = true; ind.classList.add('show'); ind.classList.add('ready'); }
      else if (dy > 30) { ind.classList.add('show'); ind.classList.remove('ready'); }
      else { ind.classList.remove('show'); ind.classList.remove('ready'); ptrActive = false; }
    } catch (err) {}
  }, { passive: true });
  document.addEventListener('touchend', function () {
    try {
      var ind = document.getElementById('pullRefresh');
      if (ind) { ind.classList.remove('show'); ind.classList.remove('ready'); }
      if (ptrActive) {
        ptrActive = false;
        renderFeed();
        retryCloud();
        toast('Actualizado ✓');
      }
      ptrStartY = null;
    } catch (err) { ptrStartY = null; ptrActive = false; }
  }, { passive: true });

  /* ---------- Inicio ----------
     Cada paso va con try/catch: si un módulo falla (Firebase, mapa,
     geolocalización), los demás siguen funcionando. El feed ya se pintó
     desde el caché antes de que Firebase conecte. */
  function safeStep(fn) { try { fn(); } catch (e) {} }
  /* La limpieza de fiestas pasadas NO va en el camino crítico del
     arranque: se hace en segundo plano después del primer pintado. */
  safeStep(renderAccount); safeStep(renderFeed); safeStep(cleanupLegacyDriverData); /* v18: limpia datos viejos de la pestaña eliminada */
  setTimeout(function () { safeStep(cleanupPastEvents); }, 1500);
  setTimeout(function () { safeStep(rescheduleEventReminders); }, 2500); /* v18: reprograma los avisos del día de favoritos/guardados */
  setTimeout(function () { safeStep(migrateThumbs); }, 3000); /* miniaturas de pines viejos, en segundo plano */
  safeStep(initGoogleAuth); /* Google se inicializa en paralelo, sin bloquear */
  safeStep(initDeepLink); /* enlace compartido ?post=<id>: abrir esa publicación */
  safeStep(initPush); /* notificaciones push (si el plugin está instalado) */
  safeStep(showWelcomeIfNeeded); /* bienvenida de 3 pasos, solo la primera vez */
  safeStep(maybeShowPermPrompt); /* v18: pedir permisos solo la primera vez */
  safeStep(renderBroadcast); /* aviso del administrador, si hay uno guardado */
  safeStep(updateUpdateUI); /* versión en Cuenta y banner si ya hay aviso */
  safeStep(handleRefParam); /* ?ref= de invitar amigos */
  safeStep(checkInterests); /* aviso del día de las fiestas que te interesan */
  setInterval(function () { safeStep(checkInterests); }, 3600000);
  safeStep(function () {
    var go = function () { connectCloud(); }; /* con reintentos, no un solo intento */
    if (window.requestIdleCallback) requestIdleCallback(go);
    else setTimeout(go, 50);
  });
  safeStep(function () {
    /* Comprobación barata de actualización + espejo sin VPN, en
       segundo plano, sin frenar el arranque. */
    var go2 = function () { checkForUpdate(); fetchMirror(); };
    if (window.requestIdleCallback) requestIdleCallback(go2);
    else setTimeout(go2, 100);
  });
  safeStep(function () {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !cloudOn) connectCloud();
      if (!document.hidden) { checkForUpdate(); setTimeout(function () { safeStep(cleanupPastEvents); }, 800); /* al volver, fuera lo pasado */ }
    });
  });
  setTimeout(function () { safeStep(cleanupExpiredFlyers); }, 2500); /* fuera del arranque, después del primer pintado */
  setTimeout(function () { safeStep(cleanupExpiredFlyers); }, 8000); /* otra pasada cuando la nube ya conectó */
  /* Sin cuenta, la app abre en el registro: para usar PEGAO XL hay que
     registrarse con Google. El usuario puede ir al Feed desde ahí. */
  if (!currentUser()) { safeStep(function () { showTab('cuenta'); }); }

  /* Gancho para pruebas (no afecta a la app): expone funciones puras. */
  try {
    window.__pegaoxl = {
      flyerStatus: flyerStatus, compressImage: compressImage, dataUrlToFile: dataUrlToFile,
      timeAgo: timeAgo, feedScore: feedScore, getTastes: getTastes, hasTastes: hasTastes,
      recordTaste: recordTaste, recordTasteForTarget: recordTasteForTarget,
      feedMode: feedMode, currentUser: currentUser, getMyProfile: getMyProfile,
      parties: parties, businesses: businesses,
      reviews: reviews, comments: comments, isCloud: isCloud, syncCache: syncCache,
      eventEndMs: eventEndMs, usernameFromEmail: usernameFromEmail,
      shareTextFor: shareTextFor, shareWithFiles: shareWithFiles, canShareFiles: canShareFiles,
      shareLinkFor: shareLinkFor,
      loadLeaflet: loadLeaflet, ensureMap: ensureMap, cleanupExpiredFlyers: cleanupExpiredFlyers,
      geocodeAddress: geocodeAddress, geocodeAndSave: geocodeAndSave, renderMapMarkers: renderMapMarkers, locateMe: locateMe, initMapInternal: initMapInternal,
      renderFeed: renderFeed,
      /* v16: geocodificación estructurada, selector de pin, miniaturas, guardado diferido. */
      parseAddressParts: parseAddressParts, nominatimStreetResult: nominatimStreetResult, geocodeCity: geocodeCity, geocodeView: geocodeView,
      createPinPicker: createPinPicker, openLocatePicker: openLocatePicker, closeLocatePicker: closeLocatePicker, confirmLocatePicker: confirmLocatePicker,
      updatePickerFromAddress: updatePickerFromAddress, initPublishPickers: initPublishPickers, locateTarget: function () { return locateTarget; },
      thumbFromDataUrl: thumbFromDataUrl, ensureThumbForPost: ensureThumbForPost, migrateThumbs: migrateThumbs, pinPhotoFor: pinPhotoFor,
      flushSaves: flushSaves, saveSync: saveSync, save: save, ARTEMISA_CENTER: ARTEMISA_CENTER,
      handleShareOption: handleShareOption, postIdFromUrl: postIdFromUrl, setPendingPost: setPendingPost, tryShowPendingPost: tryShowPendingPost,
      openBizDetail: openBizDetail, closeBizDetail: closeBizDetail, renderBizDetail: renderBizDetail, bizGalleryPhotos: bizGalleryPhotos, renderMyPosts: renderMyPosts, renderMyReviews: renderMyReviews,
      applyTheme: applyTheme, showMapCard: showMapCard, hideMapCard: hideMapCard, pinIconFor: pinIconFor, mapItemVisible: mapItemVisible, mapCardDistance: mapCardDistance,
      mapCatFilter: function () { return mapCatFilter; }, currentTheme: function () { return document.body.getAttribute('data-theme'); },
      initFirebase: initFirebase, retryCloud: retryCloud, updateCloudStatus: updateCloudStatus, updateBaseLayer: updateBaseLayer, currentBaseLayer: currentBaseLayer,
      /* v16: espejo sin VPN + aviso VPN. */
      APP_VERSION: APP_VERSION, versionNumber: versionNumber, fetchMirror: fetchMirror, applyMirrorData: applyMirrorData,
      enterMirrorMode: enterMirrorMode, exitMirrorMode: exitMirrorMode, isMirrorMode: isMirrorMode, mirrorCountryOf: mirrorCountryOf,
      isRestrictedCountry: isRestrictedCountry, guardAction: guardAction, updateMirrorUI: updateMirrorUI,
      /* v16: favoritos, guardados, intereses, precio, vistas, reportes, referidos. */
      toggleFavorite: toggleFavorite, isFavorite: isFavorite, favoriteItems: favoriteItems, renderFavSection: renderFavSection,
      toggleSaved: toggleSaved, isSaved: isSaved, savedItems: savedItems, renderSaved: renderSaved,
      toggleInterest: toggleInterest, isInterested: isInterested, interestedMap: interestedMap, checkInterests: checkInterests,
      parsePrice: parsePrice, priceMatches: priceMatches, feedDist: feedDist, clearFeedFilters: clearFeedFilters,
      todayParties: todayParties, weekParties: weekParties, topWeekly: topWeekly, calendarGroups: calendarGroups,
      renderTodaySection: renderTodaySection, renderTopSection: renderTopSection, renderCalendar: renderCalendar,
      countViews: countViews, reportPost: reportPost, isOwner: isOwner, renderReports: renderReports, renderInvite: renderInvite,
      /* Panel administrativo. */
      isAdmin: isAdmin, isSuspended: isSuspended, guardSuspended: guardSuspended, activePlanOf: activePlanOf,
      setSuspended: setSuspended, setPlan: setPlan, removePlan: removePlan, sendBroadcast: sendBroadcast,
      renderBroadcast: renderBroadcast, renderAdminPanel: renderAdminPanel, profilesMap: profilesMap,
      renderAccount: renderAccount, renderProfile: renderProfile,
      myInviteLink: myInviteLink, refFromUrl: refFromUrl, handleRefParam: handleRefParam,
      drawQR: drawQR, openPartyDetail: openPartyDetail, closePartyDetail: closePartyDetail, renderPartyDetail: renderPartyDetail,
      showWelcomeIfNeeded: showWelcomeIfNeeded, closeWelcome: closeWelcome,
      /* v18: actualización dentro de la app. */
      checkForUpdate: checkForUpdate, updateInfoOf: updateInfoOf, startUpdate: startUpdate, updateUpdateUI: updateUpdateUI,
      initPush: initPush, saveFcmTokenToProfile: saveFcmTokenToProfile,
      /* v18: permisos, avisos push y recordatorios del día del evento. */
      renderPermissions: renderPermissions, checkAllPermissions: checkAllPermissions, requestPermission: requestPermission,
      maybeShowPermPrompt: maybeShowPermPrompt, openAppSettings: openAppSettings, cleanupLegacyDriverData: cleanupLegacyDriverData,
      pushPrefs: pushPrefs, savePushPrefs: savePushPrefs, scheduleEventDayReminder: scheduleEventDayReminder,
      cancelEventDayReminder: cancelEventDayReminder, refreshEventRemindersFor: refreshEventRemindersFor, rescheduleEventReminders: rescheduleEventReminders,
      isNative: isNative, inviteFromContacts: inviteFromContacts,
      /* Reservar: contactos, capacidad, horario y reservas. */
      normalizePhone: normalizePhone, igHandle: igHandle, displayIg: displayIg, reserveContactsOf: reserveContactsOf,
      reserveUrlFor: reserveUrlFor, reservations: reservations, remainingSeats: remainingSeats, isOpenNow: isOpenNow,
      saveReservation: saveReservation, setReservationStatus: setReservationStatus, renderReservations: renderReservations,
      openReserveContact: openReserveContact, hideReserveChooser: hideReserveChooser,
      /* Borrado de fiestas pasadas + dirección guiada + compartir con flyer. */
      cleanupPastEvents: cleanupPastEvents, isPastEvent: isPastEvent, eventDateTimeMs: eventDateTimeMs,
      flushTombstones: flushTombstones, deletePostChildren: deletePostChildren,
      deleteListing: deleteListing,
      composeAddress: composeAddress, flyerFile: flyerFile,
      /* Solo para pruebas: escribe un caché completo (localStorage + memCache). */
      _setCacheForTest: function (key, list) { save(key, list); },
      /* Solo para pruebas: fija la ubicación del usuario. */
      _setMyLatLngForTest: function (lat, lng) { myLatLng = { lat: lat, lng: lng }; },
      /* Solo para pruebas: inyecta datos del espejo sin hacer fetch. */
      _setMirrorForTest: function (data) { applyMirrorData(data); },
      /* Solo para pruebas: reinicia los frenos de reintento. */
      _resetUpdateCheckForTest: function () { updateLastCheck = 0; },
      _resetMirrorTryForTest: function () { mirrorLastTry = 0; },
      /* Solo para pruebas: fija los retrasos de reintento de la nube. */
      _setCloudRetryDelaysForTest: function (arr) { cloudRetryDelays = arr; },
      /* Solo para pruebas: reinicia el estado de la nube. */
      _resetCloudForTest: function () { cloudOn = false; db = null; cloudStarted = false; cloudRetryCount = 0; cloudHadFailure = false; firebaseSdkState = 'idle'; firebaseSdkPromise = null; if (cloudRetryTimer) { try { clearTimeout(cloudRetryTimer); } catch (e) {} cloudRetryTimer = null; } },
      /* Solo para pruebas: ¿hay un reintento de nube programado? */
      _cloudRetryPendingForTest: function () { return !!cloudRetryTimer; },
      pendingPostId: function () { return pendingPostId; },
      /* Solo para pruebas: fija el usuario sin pasar por Google. */
      _setUserForTest: function (u) { save('pegaoxl_user', u); },
      /* Solo para pruebas: envejece la publicación pendiente para probar el aviso. */
      _setPendingSinceForTest: function (ms) { pendingPostSince = ms; },
      /* Solo para pruebas: simula el modo nube con una base falsa. */
      _setCloudForTest: function (fakeDb) { db = fakeDb || null; cloudOn = !!fakeDb; }
    };
  } catch (e) {}
})();
