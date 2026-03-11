/**
 * CannoliBot Script v3
 * UTM-Based Tracking with Custom Parameter Mapping
 *
 * Spec: cannolibot-v3-spec-v2.1
 * Separator: cXnXl (fixed, positional)
 * Storage: localStorage, 30 days (fixed)
 */
!function () {

  // ── Constants ────────────────────────────────────────────────
  const SEPARATOR    = "cXnXl";
  const STORAGE_KEY  = "cnl_params";
  const STORAGE_DAYS = 30;
  const ID_TOKEN_DEFAULT = "[cnlid]";

  const UTMS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"
  ];

  const CLICK_IDS = [
    "gclid", "msclkid", "fbclid", "ttclid", "gbraid", "wbraid"
  ];

  const KNOWN_PARAMS = new Set([...UTMS, ...CLICK_IDS]);

  // ── Read config ──────────────────────────────────────────────
  const cfg = Object.assign(
    { map: {}, idToken: ID_TOKEN_DEFAULT, passthrough: [], debug: false },
    window.cnl || {}
  );

  const log = cfg.debug
    ? function () { console.log("[cnl]", ...arguments); }
    : function () {};

  // ── Storage helpers ──────────────────────────────────────────

  function loadStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() > data.expiry) {
        localStorage.removeItem(STORAGE_KEY);
        log("Storage expired, cleared");
        return null;
      }
      return data.params;
    } catch (e) {
      return null;
    }
  }

  function saveStorage(params) {
    var data = {
      params: params,
      timestamp: Date.now(),
      expiry: Date.now() + STORAGE_DAYS * 864e5
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      log("Storage saved", params);
    } catch (e) { }
  }

  // ── Capture phase ────────────────────────────────────────────

  var storedParams = loadStorage() || {};
  var capturedParams = {};

  // Merge: stored first, then URL overwrites
  Object.keys(storedParams).forEach(function (k) {
    capturedParams[k] = storedParams[k];
  });

  var urlSearch = new URLSearchParams(window.location.search);
  var hasRelevantParam = false;

  urlSearch.forEach(function (val, key) {
    if (val !== "" && val !== "null" && val !== "undefined") {
      capturedParams[key] = val;
      if (KNOWN_PARAMS.has(key)) hasRelevantParam = true;
    }
  });

  // Also pull passthrough params from storage even if not in URL
  cfg.passthrough.forEach(function (p) {
    if (!capturedParams[p] && storedParams[p]) {
      capturedParams[p] = storedParams[p];
    }
  });

  // Persist if we got at least one UTM or click ID
  if (hasRelevantParam) {
    saveStorage(capturedParams);
  }

  log("Captured params:", capturedParams);

  // ── Resolve primary click ID (for [cnlid]) ──────────────────

  var primaryClickId = "desconhecido";
  for (var i = 0; i < CLICK_IDS.length; i++) {
    if (capturedParams[CLICK_IDS[i]]) {
      primaryClickId = capturedParams[CLICK_IDS[i]];
      break;
    }
  }
  log("Primary click ID:", primaryClickId);

  // ── Mapping engine ───────────────────────────────────────────

  /**
   * Build the output params object from the map config.
   *
   * For each key in map:
   *   - If array has 1 source: use value directly (skip if empty)
   *   - If array has N sources: concatenate with SEPARATOR,
   *     preserving empty slots. Only skip if ALL empty.
   */
  var outputParams = {};

  Object.keys(cfg.map).forEach(function (destParam) {
    var sources = cfg.map[destParam];
    if (!sources || !sources.length) return;

    if (sources.length === 1) {
      // Single source — include only if present
      var val = capturedParams[sources[0]] || "";
      if (val) {
        outputParams[destParam] = val;
      }
    } else {
      // Multiple sources — positional concatenation
      var hasAny = false;
      var parts = sources.map(function (src) {
        var v = capturedParams[src] || "";
        if (v) hasAny = true;
        return v;
      });
      if (hasAny) {
        outputParams[destParam] = parts.join(SEPARATOR);
      }
    }
  });

  log("Output params:", outputParams);

  // ── Injection helpers ────────────────────────────────────────

  var idTokenRe = new RegExp(
    escapeRegex(cfg.idToken) + "|" + escapeRegex(encodeURIComponent(cfg.idToken)),
    "g"
  );

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Apply [cnlid] replacement + mapped params to a URL string.
   * Returns the modified URL.
   */
  function buildUrl(href) {
    // Separate hash
    var hashIdx = href.indexOf("#");
    var hash = hashIdx >= 0 ? href.slice(hashIdx) : "";
    var base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;

    // Replace [cnlid] token in the full base (before parsing)
    base = base.replace(idTokenRe, encodeURIComponent(primaryClickId));

    try {
      var url = new URL(base, document.location.href);
      var sp  = url.searchParams;

      // Inject/overwrite mapped params
      Object.keys(outputParams).forEach(function (key) {
        sp.set(key, outputParams[key]);
      });

      // Also pass through any captured params not already in URL
      // (preserves v2 behaviour of forwarding all URL params)
      Object.keys(capturedParams).forEach(function (key) {
        if (!sp.has(key) && !outputParams.hasOwnProperty(key)) {
          sp.set(key, capturedParams[key]);
        }
      });

      return url.toString() + hash;
    } catch (e) {
      return href;
    }
  }

  // ── Process links ────────────────────────────────────────────

  function processLinks() {
    var links = document.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.href;

      // Skip non-navigating links
      if (!href ||
          href.startsWith("mailto:") ||
          href.startsWith("tel:") ||
          href.startsWith("javascript:") ||
          href === "#" ||
          (href.indexOf("#") >= 0 && href.split("#")[0] === "")) {
        continue;
      }

      a.href = buildUrl(href);
    }
    log("Links processed:", links.length);
  }

  // ── Process buttons ──────────────────────────────────────────

  function processButtons() {
    var buttons = document.getElementsByTagName("button");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!btn.onclick) continue;

      var src = btn.onclick.toString();
      var locMatch = src.match(/location\.href\s*=\s*['"`]([^'"`]+)['"`]/);
      var winMatch = src.match(/window\.open\s*\(\s*['"`]([^'"`]+)['"`]/);

      var url = null;
      var isWindowOpen = false;

      if (locMatch) {
        url = locMatch[1];
      } else if (winMatch) {
        url = winMatch[1];
        isWindowOpen = true;
      }

      if (url) {
        try {
          var newUrl = buildUrl(url);
          if (isWindowOpen) {
            btn.onclick = new Function("window.open('" + newUrl + "')");
          } else {
            btn.onclick = new Function("location.href='" + newUrl + "'");
          }
        } catch (e) { }
      }
    }
    log("Buttons processed:", buttons.length);
  }

  // ── Process forms ────────────────────────────────────────────

  function processForms() {
    var forms = document.getElementsByTagName("form");
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];

      // Inject/overwrite mapped params as hidden inputs
      Object.keys(outputParams).forEach(function (key) {
        var existing = form.querySelector('input[name="' + key + '"]');
        if (existing) {
          existing.value = outputParams[key];
        } else {
          var input = document.createElement("input");
          input.type  = "hidden";
          input.name  = key;
          input.value = outputParams[key];
          form.appendChild(input);
        }
      });

      // Also add captured params not in map
      Object.keys(capturedParams).forEach(function (key) {
        if (outputParams.hasOwnProperty(key)) return;
        var existing = form.querySelector('input[name="' + key + '"]');
        if (!existing) {
          var input = document.createElement("input");
          input.type  = "hidden";
          input.name  = key;
          input.value = capturedParams[key];
          form.appendChild(input);
        }
      });
    }
    log("Forms processed:", forms.length);
  }

  // ── Run all injection ────────────────────────────────────────

  function processAll() {
    processLinks();
    processButtons();
    processForms();
  }

  // ── MutationObserver ─────────────────────────────────────────

  function setupObserver() {
    if (typeof MutationObserver === "undefined") return;

    var observer = new MutationObserver(function (mutations) {
      var shouldProcess = mutations.some(function (m) {
        return Array.from(m.addedNodes).some(function (n) {
          if (n.nodeType !== Node.ELEMENT_NODE) return false;
          var el = n;
          return el.tagName === "A" ||
                 el.tagName === "BUTTON" ||
                 el.tagName === "FORM" ||
                 el.querySelector && (
                   el.querySelector("a") ||
                   el.querySelector("button") ||
                   el.querySelector("form")
                 );
        });
      });

      if (shouldProcess) {
        log("DOM mutation detected, reprocessing");
        processAll();
      }
    });

    observer.observe(document.body, { subtree: true, childList: true });
    log("MutationObserver active");
  }

  // ── Bootstrap ────────────────────────────────────────────────

  function boot() {
    processAll();
    setupObserver();

    // Retries for slow-loading page builders
    setTimeout(processAll, 1000);
    setTimeout(processAll, 3000);
    setTimeout(processAll, 5000);

    log("CannoliBot v3 initialized");
  }

  if (document.readyState === "complete") {
    boot();
  } else {
    window.addEventListener("load", boot);
  }

}();
