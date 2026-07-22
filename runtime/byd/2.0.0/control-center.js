// [不要玩弄我的鸡吧-forge] 控制中心 v2.0.0
// 功能：悬浮球入口 + 功能开关I/O + 主题持久化 + 开局页 + OMNI + Bubble + 提示词注入
// 设计参考：星月私立高等学院 控制中心 v3.9.6（完全对齐云端 runtime 多源容错架构）
// 持久化：使用酒馆助手 getVariables({type:'script'}) 存储开关状态
// v2.0.0 变更：14 tab 状态栏 / 3 视图开局页 / OMNI 三态 UI / 气泡 CSS / 生成前提示词注入

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

  // ===== 云端 runtime 配置（对齐星月多源容错架构） =====
  var RT_VERSION = '2.0.0';
  var RT_REVISION = '20260722-202-r5';
  var REPO = 'fkgzs123321/sillytavern';
  var RT_PATH = '/runtime/byd/' + RT_VERSION;
  var CDN_SOURCES = [
    'https://cdn.jsdelivr.net/gh/' + REPO + '@main' + RT_PATH,
    'https://testingcf.jsdelivr.net/gh/' + REPO + '@main' + RT_PATH,
    'https://raw.githubusercontent.com/' + REPO + '/main' + RT_PATH
  ];
  var cachedStatusBarHTML = null;
  var cachedOpeningPageHTML = null;
  var cachedOmniAnalysisHTML = null;
  var cachedOmniDoneHTML = null;
  var cachedOmniProgressHTML = null;
  var cachedBubbleCSS = null;

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

  // ===== 云端加载（多源容错，对齐星月 fetchHudBody） =====
  async function fetchFromCDN(filename, timeoutMs) {
    timeoutMs = timeoutMs || 6000;
    for (var i = 0; i < CDN_SOURCES.length; i++) {
      var url = CDN_SOURCES[i] + '/' + filename;
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
        var resp = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok) {
          var text = await resp.text();
          if (text && text.length > 100) {
            console.log('[假阴茎卡] CDN加载成功:', filename, '源:', i, '大小:', text.length);
            return text;
          }
        }
      } catch (e) {
        console.warn('[假阴茎卡] CDN源' + i + '失败:', filename, e.message);
      }
    }
    return null;
  }

  // 加载云端状态栏 HTML（带缓存）
  async function loadStatusBarHTML() {
    if (cachedStatusBarHTML) return cachedStatusBarHTML;
    var html = await fetchFromCDN('status-bar.html', 6000);
    if (html) {
      cachedStatusBarHTML = html;
      return html;
    }
    console.warn('[假阴茎卡] 云端状态栏加载失败，使用卡内兜底');
    return getFallbackStatusBarHTML();
  }

  // 检查云端版本
  async function checkRemoteVersion() {
    var raw = await fetchFromCDN('manifest.json', 4000);
    if (raw) {
      try {
        var m = JSON.parse(raw);
        console.log('[假阴茎卡] 云端版本:', m.version, m.revision);
        return m;
      } catch (e) {}
    }
    return null;
  }

  // ===== 状态栏注入（找到挂载点，创建 iframe） =====
  async function injectStatusBars() {
    var html = await loadStatusBarHTML();
    if (!html) return;

    var docs = [document];
    try { if (window.parent && window.parent.document) docs.push(window.parent.document); } catch (e) {}

    docs.forEach(function (doc) {
      var mounts = doc.querySelectorAll('[data-fjb-status-mount]');
      for (var i = 0; i < mounts.length; i++) {
        var mount = mounts[i];
        if (mount.getAttribute('data-fjb-injected')) continue;
        mount.setAttribute('data-fjb-injected', '1');
        mount.innerHTML = '';

        var iframe = doc.createElement('iframe');
        iframe.style.cssText = 'width:100%;border:none;border-radius:12px;min-height:320px;background:transparent';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('data-fjb-status-iframe', '1');
        iframe.srcdoc = html;
        mount.appendChild(iframe);
        console.log('[假阴茎卡] 状态栏iframe已注入');
      }
    });
  }

  // ===== 开局页注入（将 <OpeningPage> 占位替换为云端开局页） =====
  async function injectOpeningPages() {
    var sw = getSwitches();
    if (!sw.opening) return;

    var docs = [document];
    try { if (window.parent && window.parent.document) docs.push(window.parent.document); } catch (e) {}

    var hasMount = false;
    docs.forEach(function (doc) {
      var mounts = doc.querySelectorAll('[data-fjb-opening]');
      if (mounts.length > 0) hasMount = true;
    });
    if (!hasMount) return;

    if (!cachedOpeningPageHTML) {
      cachedOpeningPageHTML = await fetchFromCDN('opening-page.html', 8000);
    }
    if (!cachedOpeningPageHTML) {
      console.warn('[假阴茎卡] 开局页加载失败');
      return;
    }

    docs.forEach(function (doc) {
      var mounts = doc.querySelectorAll('[data-fjb-opening]');
      for (var i = 0; i < mounts.length; i++) {
        var mount = mounts[i];
        if (mount.getAttribute('data-fjb-opening-injected')) continue;
        mount.setAttribute('data-fjb-opening-injected', '1');
        mount.innerHTML = '';

        var iframe = doc.createElement('iframe');
        iframe.style.cssText = 'width:100%;border:none;border-radius:16px;min-height:500px;background:transparent';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('data-fjb-opening-iframe', '1');
        iframe.srcdoc = cachedOpeningPageHTML;
        mount.appendChild(iframe);
        console.log('[假阴茎卡] 开局页iframe已注入');
      }
    });
  }

  // ===== OMNI 变量流 UI 注入 =====
  async function injectOmniUI() {
    var docs = [document];
    try { if (window.parent && window.parent.document) docs.push(window.parent.document); } catch (e) {}

    docs.forEach(function (doc) {
      // omni-progress 占位
      var progMounts = doc.querySelectorAll('[data-fjb-omni-progress]');
      if (progMounts.length > 0 && !cachedOmniProgressHTML) {
        fetchFromCDN('omni-progress.html', 4000).then(function (h) { cachedOmniProgressHTML = h; injectOmniUI(); });
        return;
      }
      progMounts.forEach(function (m) {
        if (m.getAttribute('data-fjb-omni-injected')) return;
        m.setAttribute('data-fjb-omni-injected', '1');
        m.innerHTML = cachedOmniProgressHTML || '';
      });

      // omni-done 占位
      var doneMounts = doc.querySelectorAll('[data-fjb-omni-done]');
      if (doneMounts.length > 0 && !cachedOmniDoneHTML) {
        fetchFromCDN('omni-done.html', 4000).then(function (h) { cachedOmniDoneHTML = h; injectOmniUI(); });
        return;
      }
      doneMounts.forEach(function (m) {
        if (m.getAttribute('data-fjb-omni-injected')) return;
        m.setAttribute('data-fjb-omni-injected', '1');
        m.innerHTML = cachedOmniDoneHTML || '';
      });

      // omni-analysis 占位
      var anaMounts = doc.querySelectorAll('[data-fjb-omni-analysis]');
      if (anaMounts.length > 0 && !cachedOmniAnalysisHTML) {
        fetchFromCDN('omni-analysis.html', 4000).then(function (h) { cachedOmniAnalysisHTML = h; injectOmniUI(); });
        return;
      }
      anaMounts.forEach(function (m) {
        if (m.getAttribute('data-fjb-omni-injected')) return;
        m.setAttribute('data-fjb-omni-injected', '1');
        m.innerHTML = cachedOmniAnalysisHTML || '';
      });
    });
  }

  // ===== Bubble CSS 注入（对话气泡样式） =====
  async function injectBubbleCSS() {
    if (cachedBubbleCSS) return;
    var css = await fetchFromCDN('bubble.css', 4000);
    if (!css) return;
    cachedBubbleCSS = css;

    var docs = [document];
    try { if (window.parent && window.parent.document) docs.push(window.parent.document); } catch (e) {}

    docs.forEach(function (doc) {
      var existing = doc.getElementById('fjb-bubble-css');
      if (existing) return;
      var style = doc.createElement('style');
      style.id = 'fjb-bubble-css';
      style.textContent = css.replace(/^```css\n?/, '').replace(/\n?```$/, '');
      doc.head.appendChild(style);
      console.log('[假阴茎卡] bubble.css已注入');
    });
  }

  // ===== 生成前提示词注入（对齐星月 injectPrompts） =====
  function injectGenerationPrompts() {
    try {
      if (typeof eventOn !== 'function') return;
      // 在生成前注入环境刷新提示词
      eventOn('generation_started', function () {
        try {
          var prompts = [];
          // 事件通知提示词
          var sw = getSwitches();
          if (sw.event_notify) {
            prompts.push('【系统提示】请检查近期事件是否有变化，如有新事件请在<UpdateVariable>中更新recent_events数组，包含id/type/desc/importance/impact/hooks字段。');
          }
          // 环境刷新提示词
          prompts.push('【环境刷新】请根据当前时段和日期，更新environment字段（weather/temperature/location/activities/news）。');
          if (prompts.length > 0 && typeof injectPrompt === 'function') {
            injectPrompt(prompts.join('\n'), { position: 'before' });
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  // ===== 卡内兜底状态栏 HTML（简化版，CDN 全部失败时使用） =====
  function getFallbackStatusBarHTML() {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:rgba(255,240,245,.6);color:#8b3a52;padding:8px;font-size:13px}' +
      '.hdr{display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px;background:rgba(255,182,193,.15);border-radius:10px;margin-bottom:6px}' +
      '.hdr span{font-size:11px;color:#ff69b4}.stat{display:flex;gap:8px;flex-wrap:wrap}.stat div{background:rgba(255,182,193,.1);border:1px solid rgba(255,105,180,.15);border-radius:8px;padding:4px 8px;font-size:11px}' +
      '</style></head><body><div id="sb-root">' +
      '<div class="hdr"><span>📊 状态栏（卡内兜底版）</span></div>' +
      '<div class="stat" id="stat-display">等待数据…</div>' +
      '<script>' +
      'window.addEventListener("message",function(e){' +
      'if(!e.data)return;' +
      'if(e.data.type==="fjb-mvu-stat-data"&&e.data.stat_data){' +
      'var s=e.data.stat_data;var d=document.getElementById("stat-display");d.innerHTML="";' +
      'if(s.stats){' +
      'd.innerHTML+="<div>⚡精力:"+(s.stats.energy||0)+"/"+(s.stats.energy_max||0)+"</div>";' +
      'd.innerHTML+="<div>🧠理智:"+(s.stats.sanity||0)+"</div>";' +
      'd.innerHTML+="<div>🔍疑心:"+(s.stats.suspicion||0)+"</div>";' +
      'd.innerHTML+="<div>🌑沉沦:"+(s.stats.corruption||0)+"</div>";' +
      'd.innerHTML+="<div>💰金钱:"+(s.stats.money||0)+"</div>";' +
      'd.innerHTML+="<div>📊阶段:"+(s.use_stage?s.use_stage.current:1)+"/5</div>";' +
      '}' +
      'if(s.time){d.innerHTML+="<div>📅第"+(s.time.day||1)+"天 "+(s.time.hour||8)+":00</div>"}' +
      '}' +
      '});' +
      'window.parent.postMessage({type:"fjb-mvu-stat-request",messageId:-1},"*");' +
      '<\/script></div></body></html>';
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
    html += '不要玩弄我的鸡吧-forge · 控制中心 v2.0.0<br>';
    html += 'Runtime: ' + RT_VERSION + ' / ' + RT_REVISION + '<br>';
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

    // 1. 注入状态栏（14 tab 云端加载 + iframe 注入）
    await injectStatusBars();

    // 2. 注入开局页（3 视图：boot/wizard/workshop）
    await injectOpeningPages();

    // 3. 注入 OMNI 变量流 UI（预分析/同步中/完成 三态）
    await injectOmniUI();

    // 4. 注入对话气泡 CSS（粉色磨砂玻璃主题）
    await injectBubbleCSS();

    // 5. 注册生成前提示词注入（监听 generation_started 事件）
    injectGenerationPrompts();

    console.log('[假阴茎卡] 控制中心 v2.0.0 初始化完成，runtime:', RT_VERSION);

    // 检查云端版本（异步，不阻塞）
    checkRemoteVersion().then(function (m) {
      if (m && m.version && m.version !== RT_VERSION) {
        console.log('[假阴茎卡] 云端有新版本:', m.version, '当前:', RT_VERSION);
      }
    });

    // 定期检查悬浮球 + 状态栏注入（防止被其他脚本清除或新消息渲染后需要重新注入）
    setInterval(function () {
      var sw = getSwitches();
      if (sw.floatball) {
        var root = getRootDoc();
        if (!root.getElementById(BALL_ID)) ensureBall();
      }
      // 重新注入未处理的状态栏挂载点（新消息渲染后可能出现新的挂载点）
      injectStatusBars();
      // 重新注入开局页 / OMNI 挂载点
      injectOpeningPages();
      injectOmniUI();
    }, 2000);
  }

  await init();
});

// 导出空对象（酒馆助手脚本规范）
export {};
