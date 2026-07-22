// [不要玩弄我的鸡吧-forge] 控制中心 v1.0
// 功能：悬浮球入口 + 功能开关I/O + 主题持久化 + 开局页触发
// 设计参考：星月私立高等学院 控制中心 v3.9.6（简化为卡内自包含，不依赖远程Loader）
// 持久化：使用酒馆助手 getVariables({type:'script'}) 存储开关状态

$(async () => {
  'use strict';

  // ===== 常量 =====
  var NS = 'dildo_cc'; // 命名空间
  var BALL_ID = 'fjb-floating-ball';
  var PANEL_ID = 'fjb-cc-panel';
  var OPENING_FLAG_ATTR = 'data-fjb-opening';

  // 默认开关状态
  var DEFAULT_SWITCHES = {
    floatball: true,      // 悬浮球
    opening: true,        // 开局页
    media_lib: false,     // 媒体库（预留）
    diy: false,           // DIY设置（预留）
    auto_refresh: true,   // 状态栏自动刷新
    event_notify: true    // 事件通知
  };

  // 默认主题
  var DEFAULT_THEME = 'pink';

  // ===== 持久化层 =====
  // 使用酒馆助手脚本变量存储（不污染chat变量）
  function readPersisted() {
    try {
      var getVar = (typeof getVariables === 'function') ? getVariables : (window.getVariables);
      if (typeof getVar !== 'function') return null;
      var v = getVar({ type: 'script' });
      if (!v || typeof v !== 'object') return null;
      var cc = v[NS];
      if (!cc || typeof cc !== 'object') return null;
      return cc;
    } catch (e) { return null; }
  }

  function writePersisted(patch) {
    try {
      var getVar = (typeof getVariables === 'function') ? getVariables : (window.getVariables);
      if (typeof getVar !== 'function') return false;
      var setVar = (typeof setVariables === 'function') ? setVariables : (window.setVariables);
      if (typeof setVar !== 'function') return false;
      var v = getVar({ type: 'script' });
      if (!v || typeof v !== 'object') v = {};
      var cc = v[NS] || {};
      var keys = Object.keys(patch);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        cc[k] = patch[k];
      }
      v[NS] = cc;
      setVar({ type: 'script' }, v);
      return true;
    } catch (e) { return false; }
  }

  // 读取开关状态（带默认值回退）
  function getSwitches() {
    var cc = readPersisted();
    if (!cc || !cc.switches) return Object.assign({}, DEFAULT_SWITCHES);
    return Object.assign({}, DEFAULT_SWITCHES, cc.switches);
  }

  function setSwitch(key, val) {
    var sw = getSwitches();
    sw[key] = !!val;
    return writePersisted({ switches: sw });
  }

  function getTheme() {
    var cc = readPersisted();
    if (!cc || !cc.theme) return DEFAULT_THEME;
    return cc.theme;
  }

  function setTheme(theme) {
    return writePersisted({ theme: theme });
  }

  // ===== 悬浮球 =====
  function ensureBall() {
    var sw = getSwitches();
    if (!sw.floatball) { removeBall(); return; }

    var existing = document.getElementById(BALL_ID);
    if (existing) return;

    var ball = document.createElement('div');
    ball.id = BALL_ID;
    ball.setAttribute('aria-label', '控制中心');
    ball.title = '控制中心';
    ball.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:80px',
      'width:52px', 'height:52px', 'border-radius:50%',
      'z-index:99998', 'cursor:pointer',
      'background:radial-gradient(circle at 35% 30%, #ffb6d9, #ff1493)',
      'box-shadow:0 4px 18px rgba(255,20,147,.45)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'color:#fff', 'font-size:22px', 'font-weight:700',
      'user-select:none', '-webkit-tap-highlight-color:transparent',
      'transition:transform .2s, box-shadow .2s'
    ].join(';') + ';';
    ball.innerHTML = '<span style="pointer-events:none">✦</span>';

    ball.addEventListener('mouseenter', function () {
      ball.style.transform = 'scale(1.08)';
      ball.style.boxShadow = '0 6px 24px rgba(255,20,147,.6)';
    });
    ball.addEventListener('mouseleave', function () {
      ball.style.transform = 'scale(1)';
      ball.style.boxShadow = '0 4px 18px rgba(255,20,147,.45)';
    });
    ball.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    // 挂载到顶层document（穿透iframe）
    var root = getRootDoc();
    root.body.appendChild(ball);
  }

  function removeBall() {
    var root = getRootDoc();
    var ball = root.getElementById(BALL_ID);
    if (ball) ball.remove();
  }

  function getRootDoc() {
    try {
      if (window.parent && window.parent.document) return window.parent.document;
    } catch (e) {}
    return document;
  }

  // ===== 控制中心面板 =====
  function togglePanel() {
    var root = getRootDoc();
    var existing = root.getElementById(PANEL_ID);
    if (existing) { existing.remove(); return; }

    var sw = getSwitches();
    var theme = getTheme();

    var overlay = document.createElement('div');
    overlay.id = PANEL_ID;
    overlay.style.cssText = [
      'position:fixed', 'inset:0',
      'z-index:99999',
      'background:rgba(255,182,193,.35)',
      'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:16px'
    ].join(';') + ';';

    var panel = document.createElement('div');
    panel.style.cssText = [
      'background:linear-gradient(135deg,#fff0f5,#ffe4ec)',
      'backdrop-filter:blur(20px)', '-webkit-backdrop-filter:blur(20px)',
      'border:1px solid rgba(255,105,180,.3)',
      'border-radius:18px',
      'max-width:440px', 'width:100%',
      'max-height:80vh', 'overflow-y:auto',
      'padding:16px',
      'box-shadow:0 8px 32px rgba(255,105,180,.3)',
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
      'color:#8b3a52'
    ].join(';') + ';';

    var html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,182,193,.3)">';
    html += '<span style="font-size:16px;font-weight:700;color:#ff69b4">✦ 控制中心</span>';
    html += '<button id="fjb-cc-close" style="min-width:44px;min-height:44px;background:rgba(255,192,203,.25);border:1px solid rgba(255,105,180,.3);color:#ff69b4;border-radius:12px;cursor:pointer;font-size:18px">×</button>';
    html += '</div>';

    // 主题切换
    html += '<div style="font-size:12px;color:rgba(139,58,82,.7);margin:10px 0 6px;font-weight:600">主题切换</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';
    [['pink', '粉色'], ['purple', '紫色'], ['dark', '深色']].forEach(function (t) {
      var active = (t[0] === theme) ? ';background:rgba(255,105,180,.25);border-color:#ff69b4;color:#ff69b4;font-weight:700' : '';
      html += '<button class="fjb-cc-theme" data-val="' + t[0] + '" style="min-height:44px;background:rgba(255,192,203,.12);border:1px solid rgba(255,182,193,.3);color:rgba(139,58,82,.7);border-radius:12px;padding:8px;cursor:pointer;font-size:13px' + active + '">' + t[1] + '</button>';
    });
    html += '</div>';

    // 功能开关
    html += '<div style="font-size:12px;color:rgba(139,58,82,.7);margin:14px 0 6px;font-weight:600">功能开关</div>';
    var switchList = [
      ['floatball', '悬浮球'],
      ['opening', '开局页'],
      ['media_lib', '媒体库（预留）'],
      ['diy', 'DIY设置（预留）'],
      ['auto_refresh', '状态栏自动刷新'],
      ['event_notify', '事件通知']
    ];
    switchList.forEach(function (s) {
      var checked = sw[s[0]] ? 'checked' : '';
      html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,192,203,.1);border:1px solid rgba(255,182,193,.25);border-radius:12px;font-size:13px;color:rgba(139,58,82,.85);cursor:pointer;min-height:44px;margin-bottom:4px">';
      html += '<input type="checkbox" class="fjb-cc-switch" data-key="' + s[0] + '" ' + checked + ' style="margin:0;width:18px;height:18px;accent-color:#ff69b4">';
      html += '<span>' + s[1] + '</span>';
      html += '</label>';
    });

    // 关于
    html += '<div style="font-size:12px;color:rgba(139,58,82,.7);margin:14px 0 6px;font-weight:600">关于</div>';
    html += '<div style="font-size:11px;color:rgba(139,58,82,.6);padding:8px 10px;line-height:1.6;background:rgba(255,192,203,.08);border-radius:10px">';
    html += '不要玩弄我的鸡吧-forge · 控制中心 v1.0<br>';
    html += '当前主题：' + theme + ' · 悬浮球：' + (sw.floatball ? '开' : '关') + ' · 开局页：' + (sw.opening ? '开' : '关');
    html += '</div>';

    panel.innerHTML = html;
    overlay.appendChild(panel);
    root.body.appendChild(overlay);

    // 绑定事件
    panel.querySelector('#fjb-cc-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    var themeBtns = panel.querySelectorAll('.fjb-cc-theme');
    for (var i = 0; i < themeBtns.length; i++) {
      themeBtns[i].addEventListener('click', function () {
        var val = this.getAttribute('data-val');
        setTheme(val);
        applyThemeToStatusBars(val);
        overlay.remove();
        togglePanel(); // 重新打开以刷新UI
      });
    }

    var switches = panel.querySelectorAll('.fjb-cc-switch');
    for (var j = 0; j < switches.length; j++) {
      switches[j].addEventListener('change', function () {
        var key = this.getAttribute('data-key');
        var val = this.checked;
        setSwitch(key, val);
        if (key === 'floatball') {
          if (val) ensureBall(); else removeBall();
        }
      });
    }
  }

  // ===== 主题应用 =====
  function applyThemeToStatusBars(theme) {
    // 通过 postMessage 通知所有状态栏iframe
    var payload = { type: 'fjb-set-theme', theme: theme };
    var origin = window.location.origin || '*';
    try { window.postMessage(payload, origin); } catch (e) {}
    try { window.parent.postMessage(payload, origin); } catch (e) {}

    // 直接操作iframe内的root元素
    var docs = [document];
    try { if (window.parent && window.parent.document) docs.push(window.parent.document); } catch (e) {}
    docs.forEach(function (doc) {
      var roots = doc.querySelectorAll('#sb-root, .sb');
      var themeVars = getThemeVars(theme);
      for (var i = 0; i < roots.length; i++) {
        var el = roots[i];
        var keys = Object.keys(themeVars);
        for (var k = 0; k < keys.length; k++) {
          el.style.setProperty(keys[k], themeVars[k]);
        }
      }
    });
  }

  function getThemeVars(theme) {
    var themes = {
      pink: {
        '--c-accent': '#ff69b4', '--c-pink': '#ff1493',
        '--c-danger': '#ff6b8a', '--c-warn': '#ff9ec4',
        '--c-orange': '#ff85a2', '--c-safe': '#ffb6d9',
        '--c-blue': '#ff85a2', '--c-silver': '#ffc0cb'
      },
      purple: {
        '--c-accent': '#9b59b6', '--c-pink': '#8e44ad',
        '--c-danger': '#9b59b6', '--c-warn': '#b388d1',
        '--c-orange': '#a569bd', '--c-safe': '#c39bd3',
        '--c-blue': '#a569bd', '--c-silver': '#d2b4de'
      },
      dark: {
        '--c-accent': '#e74c3c', '--c-pink': '#c0392b',
        '--c-danger': '#e74c3c', '--c-warn': '#f39c12',
        '--c-orange': '#e67e22', '--c-safe': '#2ecc71',
        '--c-blue': '#3498db', '--c-silver': '#95a5a6'
      }
    };
    return themes[theme] || themes.pink;
  }

  // ===== 开局页触发 =====
  function triggerOpeningPage() {
    var sw = getSwitches();
    if (!sw.opening) return;

    var root = getRootDoc();
    var mounts = root.querySelectorAll('[' + OPENING_FLAG_ATTR + ']');
    if (mounts.length === 0) return;

    // 标记为已加载，状态栏会替换占位
    for (var i = 0; i < mounts.length; i++) {
      mounts[i].setAttribute('data-fjb-remote-state', 'loaded');
    }
  }

  // ===== 监听状态栏主题切换请求 =====
  window.addEventListener('message', function (event) {
    if (!event || !event.data) return;
    var data = event.data;
    if (data.type === 'fjb-set-theme' && data.theme) {
      setTheme(data.theme);
      applyThemeToStatusBars(data.theme);
    }
    if (data.type === 'fjb-cc-get-state') {
      // 状态栏请求当前开关状态
      var state = { switches: getSwitches(), theme: getTheme() };
      try {
        event.source.postMessage({ type: 'fjb-cc-state', state: state }, event.origin || '*');
      } catch (e) {}
    }
    if (data.type === 'fjb-cc-set-switch' && data.key) {
      setSwitch(data.key, !!data.value);
    }
  });

  // ===== 初始化 =====
  async function init() {
    // 等待DOM就绪
    if (document.readyState === 'loading') {
      await new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); });
    }

    // 延迟初始化，确保酒馆环境就绪
    await new Promise(function (r) { setTimeout(r, 300); });

    // 应用主题
    applyThemeToStatusBars(getTheme());

    // 挂载悬浮球
    ensureBall();

    // 触发开局页
    triggerOpeningPage();

    // 定期检查悬浮球是否存在（防止被其他脚本清除）
    setInterval(function () {
      var sw = getSwitches();
      if (sw.floatball) {
        var root = getRootDoc();
        if (!root.getElementById(BALL_ID)) ensureBall();
      }
    }, 2000);
  }

  await init();
});

// 导出空对象（酒馆助手脚本规范）
export {};
