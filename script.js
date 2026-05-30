// Desempaquetador · solver de anagramas en español (client-side, sin backend)
(function () {
  "use strict";

  document.getElementById("year").textContent = new Date().getFullYear();

  // ───── Constantes ─────
  // Índice de letra: a-z → 0..25, ñ → 26
  var NLET = 27;
  function letterIndex(c) {
    if (c === "ñ") return 26;
    var code = c.charCodeAt(0);
    return code >= 97 && code <= 122 ? code - 97 : -1;
  }

  // Valores Scrabble FISE (español). Sin K ni W en el set oficial → 0.
  var V_FISE = {
    a:1,e:1,o:1,i:1,s:1,n:1,r:1,u:1,l:1,t:1,
    d:2,g:2, c:3,b:3,m:3,p:3, h:4,f:4,v:4,y:4,
    q:5, j:8,"ñ":8,x:8, z:10, k:0,w:0
  };
  // Valores Apalabrados (español).
  var V_APAL = {
    a:1,e:1,o:1,i:1,s:1,n:1,r:1,u:1,t:1,l:1,
    d:2,g:2, c:3,b:3,m:3,p:3, h:4,f:4,v:4,w:4,
    y:5, "ñ":6, j:8,q:8,x:8, z:10, k:5
  };
  var ALPHA = "abcdefghijklmnopqrstuvwxyzñ";
  function buildValues(map) {
    var arr = new Uint8Array(NLET);
    for (var i = 0; i < ALPHA.length; i++) arr[letterIndex(ALPHA[i])] = map[ALPHA[i]] || 0;
    return arr;
  }
  var VALUES = { fise: buildValues(V_FISE), apal: buildValues(V_APAL) };

  // Normaliza texto del usuario: minúsculas, sin tildes, conserva ñ.
  function normalize(s) {
    return s.toLowerCase()
      .replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e").replace(/[íìîï]/g, "i")
      .replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u").replace(/ç/g, "c");
  }

  // ───── Estado del diccionario ─────
  var WORDS = null;   // array de palabras
  var SIG = null;     // Uint8Array plano: NLET por palabra
  var LEN = null;     // Uint8Array longitudes
  var ready = false;

  // ───── Estado de UI ─────
  var mode = "fise";
  var lastResults = [];
  var shown = 0;
  var PAGE = 300;

  var el = {
    form: document.getElementById("solver-form"),
    letters: document.getElementById("letters"),
    clear: document.getElementById("clear-btn"),
    preview: document.getElementById("tiles-preview"),
    results: document.getElementById("results"),
    statusText: document.getElementById("status-text"),
    fMin: document.getElementById("f-min"),
    fMax: document.getElementById("f-max"),
    fContains: document.getElementById("f-contains"),
    fStarts: document.getElementById("f-starts"),
    fEnds: document.getElementById("f-ends"),
    fPattern: document.getElementById("f-pattern")
  };

  // ───── Carga diferida del diccionario ─────
  function loadDictionary() {
    fetch("data/palabras.txt")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (txt) {
        var list = txt.split("\n");
        var words = [];
        for (var i = 0; i < list.length; i++) {
          var w = list[i].trim();
          if (w) words.push(w);
        }
        WORDS = words;
        var n = words.length;
        SIG = new Uint8Array(n * NLET);
        LEN = new Uint8Array(n);
        for (var j = 0; j < n; j++) {
          var word = words[j];
          var base = j * NLET;
          LEN[j] = word.length;
          for (var k = 0; k < word.length; k++) {
            var idx = letterIndex(word[k]);
            if (idx >= 0) SIG[base + idx]++;
          }
        }
        ready = true;
        renderInitial();
        if (el.letters.value.trim()) run();
      })
      .catch(function (err) {
        el.results.innerHTML =
          '<div class="empty"><strong>No se pudo cargar el diccionario</strong>' +
          "Recarga la página para volver a intentarlo. (" + (err.message || err) + ")</div>";
      });
  }

  function renderInitial() {
    el.results.innerHTML =
      '<div class="empty"><strong>Escribe tus letras para empezar</strong>' +
      "Más de " + (WORDS.length).toLocaleString("es-ES") + " palabras en español listas para buscar.</div>";
  }

  // ───── Parseo del rack ─────
  function parseRack(raw) {
    var s = normalize(raw);
    var counts = new Uint8Array(NLET);
    var blanks = 0;
    var tiles = []; // para la vista previa
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === "?" || c === " " || c === "*") { blanks++; tiles.push(null); continue; }
      var idx = letterIndex(c);
      if (idx >= 0) { counts[idx]++; tiles.push(c); }
    }
    return { counts: counts, blanks: blanks, tiles: tiles };
  }

  // ───── Vista previa de fichas ─────
  function renderTiles(tiles) {
    var v = VALUES[mode];
    var html = "";
    for (var i = 0; i < tiles.length; i++) {
      var c = tiles[i];
      if (c === null) {
        html += '<span class="tile blank">?<span class="pts">0</span></span>';
      } else {
        html += '<span class="tile">' + c + '<span class="pts">' + v[letterIndex(c)] + "</span></span>";
      }
    }
    el.preview.innerHTML = html;
  }

  // ───── Filtros ─────
  function buildFilters() {
    var min = parseInt(el.fMin.value, 10);
    var max = parseInt(el.fMax.value, 10);
    // Patrón: el usuario marca huecos con _, . o ? y el resto son letras fijas.
    var pat = normalize(el.fPattern.value.trim())
      .replace(/[.?]/g, "_")
      .replace(/[^a-zñ_]/g, "");
    return {
      min: isNaN(min) ? 0 : min,
      max: isNaN(max) ? 99 : max,
      contains: normalize(el.fContains.value.trim()).replace(/[^a-zñ]/g, ""),
      starts: normalize(el.fStarts.value.trim()).replace(/[^a-zñ]/g, ""),
      ends: normalize(el.fEnds.value.trim()).replace(/[^a-zñ]/g, ""),
      patternRaw: pat
    };
  }
  function passFilters(word, f) {
    if (word.length < f.min || word.length > f.max) return false;
    if (f.starts && word.indexOf(f.starts) !== 0) return false;
    if (f.ends && word.lastIndexOf(f.ends) !== word.length - f.ends.length) return false;
    if (f.contains && word.indexOf(f.contains) === -1) return false;
    if (f.patternRaw) {
      var p = f.patternRaw;
      if (word.length !== p.length) return false;
      for (var i = 0; i < p.length; i++) {
        if (p[i] !== "_" && p[i] !== word[i]) return false;
      }
    }
    return true;
  }

  // ───── Puntuación con el rack (los comodines suman 0) ─────
  function scoreWord(base, rack, v) {
    var score = 0;
    for (var l = 0; l < NLET; l++) {
      var need = SIG[base + l];
      if (!need) continue;
      var have = rack.counts[l];
      var paid = need <= have ? need : have; // las que faltan van con comodín → 0 pts
      score += paid * v[l];
    }
    return score;
  }

  // ───── Búsqueda principal ─────
  function run() {
    if (!ready) return;
    var rack = parseRack(el.letters.value);
    renderTiles(rack.tiles);

    var totalTiles = rack.blanks;
    for (var t = 0; t < NLET; t++) totalTiles += rack.counts[t];
    if (totalTiles === 0) { renderInitial(); return; }

    var f = buildFilters();
    var v = VALUES[mode];
    var blanks = rack.blanks;
    var rc = rack.counts;
    var n = WORDS.length;
    var out = [];

    for (var i = 0; i < n; i++) {
      var base = i * NLET;
      var deficit = 0;
      var ok = true;
      for (var l = 0; l < NLET; l++) {
        var d = SIG[base + l] - rc[l];
        if (d > 0) {
          deficit += d;
          if (deficit > blanks) { ok = false; break; }
        }
      }
      if (!ok) continue;
      var word = WORDS[i];
      if (!passFilters(word, f)) continue;
      out.push({ w: word, len: word.length, s: scoreWord(base, rack, v) });
    }

    out.sort(function (a, b) {
      if (b.len !== a.len) return b.len - a.len;
      if (b.s !== a.s) return b.s - a.s;
      return a.w < b.w ? -1 : 1;
    });

    lastResults = out;
    shown = 0;
    renderResults();
  }

  function renderResults() {
    if (lastResults.length === 0) {
      el.results.innerHTML =
        '<div class="empty"><strong>Sin resultados</strong>' +
        "Prueba con más letras, añade comodines con <kbd>?</kbd> o relaja los filtros.</div>";
      return;
    }
    var limit = Math.min(lastResults.length, shown + PAGE);
    var slice = lastResults.slice(0, limit);

    // Agrupa por longitud (desc)
    var groups = {};
    var order = [];
    for (var i = 0; i < slice.length; i++) {
      var L = slice[i].len;
      if (!groups[L]) { groups[L] = []; order.push(L); }
      groups[L].push(slice[i]);
    }

    var html =
      '<div class="results-head">' +
      '<span class="results-count"><strong>' + lastResults.length.toLocaleString("es-ES") +
      "</strong> palabra" + (lastResults.length === 1 ? "" : "s") + "</span>" +
      '<span class="results-note">Ordenadas por longitud y puntuación · toca para copiar</span>' +
      "</div>";

    for (var g = 0; g < order.length; g++) {
      var L2 = order[g];
      var items = groups[L2];
      html += '<div class="group"><h3>' + L2 + " letras · " + items.length + "</h3><div class=\"word-list\">";
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        html += '<button type="button" class="word" data-w="' + it.w + '">' +
          '<span class="w">' + it.w + '</span><span class="score">' + it.s + "</span></button>";
      }
      html += "</div></div>";
    }

    if (limit < lastResults.length) {
      html += '<button type="button" class="show-more" id="show-more">Mostrar más (' +
        (lastResults.length - limit).toLocaleString("es-ES") + " restantes)</button>";
    }
    el.results.innerHTML = html;
  }

  // ───── Eventos ─────
  var debounceTimer = null;
  function scheduleRun() {
    el.clear.hidden = el.letters.value.length === 0;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 120);
  }

  el.letters.addEventListener("input", scheduleRun);
  [el.fMin, el.fMax, el.fContains, el.fStarts, el.fEnds, el.fPattern].forEach(function (input) {
    input.addEventListener("input", scheduleRun);
  });

  el.clear.addEventListener("click", function () {
    el.letters.value = "";
    el.preview.innerHTML = "";
    el.clear.hidden = true;
    el.letters.focus();
    renderInitial();
  });

  // Modo de puntuación
  Array.prototype.forEach.call(document.querySelectorAll(".seg"), function (btn) {
    btn.addEventListener("click", function () {
      if (btn.classList.contains("is-active")) return;
      document.querySelectorAll(".seg").forEach(function (b) {
        b.classList.remove("is-active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-checked", "true");
      mode = btn.getAttribute("data-mode");
      run();
    });
  });

  el.form.addEventListener("submit", function (e) { e.preventDefault(); run(); });

  // Pills de ejemplo: rellenan el rack y disparan la búsqueda.
  Array.prototype.forEach.call(document.querySelectorAll(".pill[data-fill]"), function (p) {
    p.addEventListener("click", function () {
      el.letters.value = p.getAttribute("data-fill");
      el.clear.hidden = false;
      el.letters.focus();
      run();
    });
  });

  // ───── Randomizer ─────
  // Distribución aproximada de las 100 fichas FISE (Scrabble español) + 2 comodines.
  var TILE_WEIGHTS = {
    a:12, e:12, o:9, s:7, i:6, u:5, n:5, r:5, l:4, t:4,
    d:5, g:2, c:4, b:2, m:2, p:2,
    h:2, f:1, v:1, y:1, q:1, j:1, "ñ":1, x:1, z:1,
    "?":2
  };
  function buildBag() {
    var bag = [];
    for (var l in TILE_WEIGHTS) if (TILE_WEIGHTS.hasOwnProperty(l)) {
      for (var i = 0; i < TILE_WEIGHTS[l]; i++) bag.push(l);
    }
    return bag;
  }
  function randomLetters(n) {
    var bag = buildBag();
    // Fisher-Yates parcial: extrae sin reemplazo
    for (var i = bag.length - 1; i > 0 && i > bag.length - 1 - n; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
    }
    return bag.slice(bag.length - n, bag.length).join("");
  }
  var randCount = document.getElementById("rand-count");
  var randMinus = document.getElementById("rand-minus");
  var randPlus  = document.getElementById("rand-plus");
  var randBtn   = document.getElementById("rand-btn");
  function clampCount() {
    var n = parseInt(randCount.value, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 15) n = 15;
    randCount.value = n;
    return n;
  }
  randMinus.addEventListener("click", function () {
    randCount.value = Math.max(1, (parseInt(randCount.value, 10) || 7) - 1);
    clampCount();
  });
  randPlus.addEventListener("click", function () {
    randCount.value = Math.min(15, (parseInt(randCount.value, 10) || 7) + 1);
    clampCount();
  });
  randCount.addEventListener("change", clampCount);
  randBtn.addEventListener("click", function () {
    var n = clampCount();
    el.letters.value = randomLetters(n);
    el.clear.hidden = false;
    el.letters.focus();
    run();
  });

  // Delegación: copiar palabra al tocarla / mostrar más
  el.results.addEventListener("click", function (e) {
    var more = e.target.closest("#show-more");
    if (more) { shown += PAGE; renderResults(); return; }
    var word = e.target.closest(".word");
    if (word) {
      var text = word.getAttribute("data-w");
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      word.classList.add("is-copied");
      setTimeout(function () { word.classList.remove("is-copied"); }, 700);
    }
  });

  loadDictionary();
})();
