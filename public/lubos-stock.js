(function () {
  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();
  var ORIGIN = (script && script.src) ? new URL(script.src).origin : 'https://app.lubos.com.ve';
  var API_STOCK = ORIGIN + '/api/public/stock';
  var API_CONFIG = ORIGIN + '/api/public/widget-config';

  var cfg = null;

  // Inject a single <style> tag for the out-of-stock dimming rules
  var styleEl = document.createElement('style');
  styleEl.setAttribute('data-lubos-dim', '');
  document.head.appendChild(styleEl);

  // "Clasico IND" -> "clasico-ind"
  function slugify(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function badgeText(stock) {
    var c = cfg || {};
    if (stock <= 0) return c.msg_out || 'Agotados';
    if (stock >= 1 && stock <= 5) {
      return c['msg_stock_' + stock] || ('Quedan ' + stock);
    }
    return ''; // more than 5: nothing
  }

  // Returns the state class to apply to the <span>: "agotado", "quedan-x", or "" (none)
  function badgeStateClass(stock) {
    if (stock <= 0) return 'agotado';
    if (stock >= 1 && stock <= 5) return 'quedan-x';
    return '';
  }

  var STATE_CLASSES = ['agotado', 'quedan-x'];

  function update(flavors) {
    var dimRules = [];

    flavors.forEach(function (f) {
      var text = badgeText(f.stock);
      var stateCls = badgeStateClass(f.stock);
      // 1) Insert plain text + state class inside every <span data-lubos="Name">
      var els = document.querySelectorAll('[data-lubos="' + f.name + '"]');
      for (var i = 0; i < els.length; i++) {
        els[i].textContent = text;
        // Reset previous state classes
        for (var k = 0; k < STATE_CLASSES.length; k++) {
          els[i].classList.remove(STATE_CLASSES[k]);
        }
        if (stateCls) els[i].classList.add(stateCls);
      }
      // 2) If out of stock, build a CSS rule for the slugified class
      if (f.stock <= 0) {
        var cls = slugify(f.name);
        if (cls) dimRules.push('.' + cls + '{opacity:.5;transition:opacity .3s ease}');
      }
    });

    styleEl.textContent = dimRules.join('\n');
  }

  function loadStock() {
    var x = new XMLHttpRequest();
    x.open('GET', API_STOCK, true);
    x.onload = function () { if (x.status === 200) { try { update(JSON.parse(x.responseText)); } catch (e) { console.warn('[Lubos widget] parse stock', e); } } };
    x.send();
  }

  function loadConfig() {
    var x = new XMLHttpRequest();
    x.open('GET', API_CONFIG, true);
    x.onload = function () {
      if (x.status === 200) {
        try { cfg = JSON.parse(x.responseText); } catch (e) { console.warn('[Lubos widget] parse config', e); }
      }
      loadStock();
    };
    x.onerror = loadStock;
    x.send();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadConfig);
  } else {
    loadConfig();
  }
  setInterval(loadStock, 60000);
})();
