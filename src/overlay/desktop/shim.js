/* 把渲染器的 petBridge 接到安卓壳的 JS 接口上。
   渲染器的坐标是 CSS px（scale=1），安卓侧负责乘屏幕密度去挪窗。 */
(function () {
  function log(msg) {
    try {
      if (window.AndroidPetHost && window.AndroidPetHost.log) window.AndroidPetHost.log(String(msg));
    } catch (e) {}
  }
  window.__petLog = log;
  window.addEventListener('error', function (e) {
    log('onerror: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    log('unhandled: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
  log('shim-loaded ' + location.href);
  // 壳里就是纯触屏：没有悬停/移出事件。页面据此决定悬浮提示要不要定时收（见 sprite.js 的 TOUCH_ONLY）。
  if (window.AndroidPetHost) window.__petTouchOnly = true;
  // 页面里的未捕获异常/未处理 rejection 也要能落到宿主日志：否则壳里一片空白时无从排查。
  window.addEventListener('error', function (ev) {
    log('ERR ' + (ev && ev.message) + ' @' + ((ev && ev.filename) || '') + ':' + ((ev && ev.lineno) || 0));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    log('REJ ' + ((r && (r.message || r)) || 'unknown'));
  });
  var H = window.AndroidPetHost || null;
  function call(name, args) {
    try {
      if (H && typeof H[name] === 'function') H[name].apply(H, args);
    } catch (e) {
      if (window.console) console.warn('[petBridge] ' + name + ' failed: ' + e);
    }
  }

  /* 关键修复：安卓 WebView 的 e.screenX 恒等于 clientX（窗口以为自己在 0,0），
     而渲染器拖拽/抛掷全靠 screenX 算增量 —— 不修就会"自己挪窗的位移被再算一遍"。
     这里把屏幕坐标重写成 clientX + 窗口在屏幕上的偏移（由安卓侧每次 setBounds 注入）。 */
  var H = window.AndroidPetHost || null;
  window.__petWin = window.__petWin || { x: 0, y: 0 };
  function offX() {
    try { return H && H.winX ? H.winX() : window.__petWin.x || 0; } catch (e) { return window.__petWin.x || 0; }
  }
  function offY() {
    try { return H && H.winY ? H.winY() : window.__petWin.y || 0; } catch (e) { return window.__petWin.y || 0; }
  }
  try {
    Object.defineProperty(MouseEvent.prototype, 'screenX', {
      configurable: true,
      get: function () {
        return (this.clientX || 0) + offX();
      }
    });
    Object.defineProperty(MouseEvent.prototype, 'screenY', {
      configurable: true,
      get: function () {
        return (this.clientY || 0) + offY();
      }
    });
    Object.defineProperty(window, 'screenX', {
      configurable: true,
      get: function () { return offX(); }
    });
    Object.defineProperty(window, 'screenY', {
      configurable: true,
      get: function () { return offY(); }
    });
    log('screen-offset patched');
  } catch (e) {
    log('screen-offset patch failed: ' + e);
  }


  /* 把渲染器自己打的 workStatus / dsh-pet 日志转发出去（节流，避免刷屏） */
  (function () {
    var orig = console.log;
    var lastAt = 0;
    console.log = function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
        var line = parts.join(' ');
        if (/workStatus|dsh-pet/.test(line)) {
          var now = Date.now();
          if (now - lastAt > 500) {
            lastAt = now;
            log('console: ' + line.slice(0, 220));
          }
        }
      } catch (e) {}
      return orig.apply(console, arguments);
    };
  })();

  window.petBridge = {
    setBounds: function (x, y, w, h, boxX, boxY, size, bottomPad, vx, vy, marginL, marginT) {
      // 安卓侧 setBounds(int x,int y,int w,int h,int boxX,int boxY,int size) —— 严格 7 个参数，
      // 多传一个都会落成 "Method not found"，整窗就不跟手了。
      call('setBounds', [
        Math.round(x), Math.round(y), Math.round(w), Math.round(h),
        Math.round(boxX || 0), Math.round(boxY || 0), Math.round(size || 0), Math.round(bottomPad || 0)
      ]);
    },
    setInteractive: function (v) {
      call('setInteractive', [!!v]);
    },
    setInputBusy: function () {},
    setInputRegions: function () {},
    openDshSite: function (url) {
      call('openUrl', [String(url)]);
    },
    reportFlight: function () {},
    onFlightStates: function () {},
    reportCollide: function () {},
    onPetHit: function () {},
    onDisplays: function () {}
  };
})();

/* 安卓壳把触摸窗上的手势合成成指针事件送回来（渲染窗本身不可触摸，靠这个实现"只有鱼身可交互"） */
window.__petFwd = function (type, cx, cy, sx, sy) {
  try {
    var el = document.elementFromPoint(cx, cy) || document.body;
    var down = type === 'pointerdown';
    var up = type === 'pointerup';
    var opts = {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      screenX: sx,
      screenY: sy,
      button: up ? -1 : 0,
      buttons: up ? 0 : 1
    };
    el.dispatchEvent(new PointerEvent(type, opts));
    if (up) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, screenX: sx, screenY: sy }));
    }
  } catch (e) {
    log('fwd fail ' + type + ': ' + e);
  }
};

/* 长按：触摸层识别出来后合成 contextmenu（渲染器的右键菜单就是监听这个事件） */
window.__petMenu = function (cx, cy, sx, sy) {
  try {
    var el = document.elementFromPoint(cx, cy) || document.body;
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: cx, clientY: cy, screenX: sx, screenY: sy,
      button: 2, buttons: 2
    }));
  } catch (e) {
    log('menu fail: ' + e);
  }
};

/* 每帧主动从安卓侧取最新触摸，避免 evaluateJavascript 排队 */
(function () {
  function pull() {
    requestAnimationFrame(pull);
    var raw = '';
    try {
      raw = window.AndroidPetHost && window.AndroidPetHost.pollTouch ? window.AndroidPetHost.pollTouch() : '';
    } catch (e) {
      return;
    }
    if (!raw) return;
    var p = String(raw).split(',');
    var type = p[0];
    var cx = Number(p[1]), cy = Number(p[2]), sx = Number(p[3]), sy = Number(p[4]);
    if (type === 'menu') {
      if (window.__petMenu) window.__petMenu(cx, cy, sx, sy);
      return;
    }
    if (window.__petFwd) window.__petFwd(type, cx, cy, sx, sy);
  }
  requestAnimationFrame(pull);
})();

/* 渲染器在"没有桌面宠物"时会调 window.close()——WebView 里它什么也不做，
   于是安卓窗口会留一块透明但可触摸的区域。这里把它转告壳，让壳立刻收窗。 */
(function () {
  var rawClose = window.close;
  window.close = function () {
    try {
      if (window.AndroidPetHost && window.AndroidPetHost.closeSelf) window.AndroidPetHost.closeSelf();
    } catch (e) {}
    try {
      if (rawClose) rawClose.call(window);
    } catch (e) {}
  };
})();