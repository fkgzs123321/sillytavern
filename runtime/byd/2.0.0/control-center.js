// [不要玩弄我的鸡吧-forge] 控制中心 v3.0.0
// 完全对齐星月私立高等学院 控制中心 v3.9.6 云端 runtime 架构
// 核心架构：IIFE 生命周期 / Blob URL 注入 / 桥接握手 4 条件 / 看门狗超时
//          HUD 面板拖拽缩放 + 几何持久化 / 13+ 事件系统 / 4 事件提示词注入
//          依赖预取（jquery+lodash）/ 多源 CDN 容错 / 主题持久化 / 卡内兜底

(() => {
  'use strict';

  // ========================================================================
  // 第一章 常量与命名空间
  // ========================================================================
  const VERSION = '3.0.0';
  const GIT_REVISION = '3.0.0-stability-r1-20260722';
  const REPO = 'fkgzs123321/sillytavern';
  const RT_VERSION = '2.0.0';
  const RT_PATH = '/runtime/byd/' + RT_VERSION;
  // CDN @main 多源容错（与星月 fetchHudBody 同构）
  const CDN_SOURCES = [
    'https://cdn.jsdelivr.net/gh/' + REPO + '@main' + RT_PATH,
    'https://testingcf.jsdelivr.net/gh/' + REPO + '@main' + RT_PATH,
    'https://raw.githubusercontent.com/' + REPO + '/main' + RT_PATH,
  ];
  // 开局页完整性校验常量（对齐星月 OPENING_PAGE_SHA256 / OPENING_PAGE_REVISION）
  // SHA-256 留空表示跳过哈希校验（开发阶段），生产环境应填入开局页.html 的 SHA-256
  // 计算方式：crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  const OPENING_PAGE_REVISION = '20260722-200-offline-r1';
  const OPENING_PAGE_SHA256 = '';
  const OPENING_PAGE_SOURCE_TIMEOUT_MS = 12000;
  const OPENING_PAGE_TOTAL_TIMEOUT_MS = 22000;
  const OPENING_PAGE_STRUCTURE_VERSION = '2.0.0';
  // 依赖库 CDN（与星月 fetchHudLibSource 同构）
  const LIB_CDNS = ['https://cdn.jsdelivr.net', 'https://testingcf.jsdelivr.net'];
  const LIB_PATHS = {
    jquery: '/npm/jquery@3.7.1/dist/jquery.min.js',
    lodash: '/npm/lodash@4.17.21/lodash.min.js',
  };
  // DOM 命名
  const NS = 'dildo_cc';
  const BALL_ID = 'fjb-floating-ball';
  const PANEL_ID = 'fjb-cc-panel';
  const HUD_PANEL_ID = 'fjb-hud-panel';
  const HUD_PANEL_STYLE_ID = 'fjb-hud-panel-style';
  const HUD_PANEL_STORE_KEY = 'fjb-hud-panel-v3';
  const OPENING_FLAG_ATTR = 'data-fjb-opening';
  // 桥接命名
  const BRIDGE_KEY = '__FJB_HUD_BRIDGE';
  const BRIDGE_READY_ATTR = 'data-fjb-hud-ready';
  const BRIDGE_DEPS_ATTR = 'data-fjb-hud-deps';
  const BRIDGE_BIND_ATTR = 'data-fjb-hud-bridge';
  // 默认开关
  const DEFAULT_SWITCHES = {
    floatball: true,
    opening: true,
    media_lib: false,
    diy: false,
    auto_refresh: true,
    event_notify: true,
  };
  const DEFAULT_THEME = 'pink';
  // 生成前提示词注入 id（与星月 GENERATION_INJECTION_IDS 同构）
  const ENV_PROMPT_ID = 'fjb-env-refresh';
  const EVENT_PROMPT_ID = 'fjb-event-notify';
  const GENERATION_INJECTION_IDS = [ENV_PROMPT_ID, EVENT_PROMPT_ID];

  // ========================================================================
  // 第二章 跨 iframe 工具 + 生命周期管理
  // ========================================================================
  // hostWindow/hostDocument：与星月同构，穿透 iframe 边界
  function hostWindow() {
    try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (_) {}
    return window;
  }
  function hostDocument() {
    try { return hostWindow().document || document; } catch (_) { return document; }
  }

  // runtimeOwner：每次实例化生成唯一 id，防止旧实例残留干扰
  const runtimeOwner = { id: null };
  function createRuntimeOwnerId() {
    try {
      const uuid = window.crypto?.randomUUID?.();
      if (uuid) return GIT_REVISION + ':' + uuid;
    } catch (_) {}
    return GIT_REVISION + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8);
  }
  runtimeOwner.id = createRuntimeOwnerId();

  // disposers：销毁时回收所有副作用（事件监听/定时器/DOM 节点）
  const disposers = [];
  function addDisposer(fn) { if (typeof fn === 'function') disposers.push(fn); return fn; }
  function runAllDisposers() {
    while (disposers.length > 0) {
      const fn = disposers.pop();
      try { fn(); } catch (_) {}
    }
  }

  // destroyPreviousRuntime：销毁旧实例（与星月同构）
  function destroyPreviousRuntime() {
    const targets = [window];
    try { const host = hostWindow(); if (host && !targets.includes(host)) targets.push(host); } catch (_) {}
    const seen = new Set();
    targets.forEach(target => {
      const previous = target?.FjbControlCenter;
      if (!previous || seen.has(previous) || typeof previous.destroy !== 'function') return;
      seen.add(previous);
      try { previous.destroy(); } catch (_) {}
    });
  }

  // ========================================================================
  // 第三章 持久化层（酒馆助手 script 作用域变量）
  // ========================================================================
  function readPersisted() {
    try {
      const getVar = (typeof getVariables === 'function') ? getVariables : (window.getVariables);
      if (typeof getVar !== 'function') return null;
      const v = getVar({ type: 'script' });
      if (!v || typeof v !== 'object') return null;
      const cc = v[NS];
      if (!cc || typeof cc !== 'object') return null;
      return cc;
    } catch (e) { return null; }
  }
  function writePersisted(patch) {
    try {
      const getVar = (typeof getVariables === 'function') ? getVariables : (window.getVariables);
      const setVar = (typeof setVariables === 'function') ? setVariables : (window.setVariables);
      if (typeof getVar !== 'function' || typeof setVar !== 'function') return false;
      const v = getVar({ type: 'script' }) || {};
      const cc = v[NS] || {};
      Object.keys(patch).forEach(k => { cc[k] = patch[k]; });
      v[NS] = cc;
      setVar({ type: 'script' }, v);
      return true;
    } catch (e) { return false; }
  }
  function getSwitches() {
    const cc = readPersisted();
    if (!cc || !cc.switches) return Object.assign({}, DEFAULT_SWITCHES);
    return Object.assign({}, DEFAULT_SWITCHES, cc.switches);
  }
  function setSwitch(key, val) {
    const sw = getSwitches();
    sw[key] = !!val;
    return writePersisted({ switches: sw });
  }
  function getTheme() {
    const cc = readPersisted();
    return (cc && cc.theme) || DEFAULT_THEME;
  }
  function setTheme(theme) {
    return writePersisted({ theme: theme });
  }

  // ========================================================================
  // 第四章 悬浮球（Canvas 渲染预备，先以 div 实现）
  // ========================================================================
  function ensureBall() {
    const sw = getSwitches();
    if (!sw.floatball) { removeBall(); return; }
    const root = hostDocument();
    if (root.getElementById(BALL_ID)) return;
    const ball = root.createElement('div');
    ball.id = BALL_ID;
    ball.setAttribute('aria-label', '控制中心');
    ball.title = '控制中心（点击打开 HUD 状态栏，长按打开设置面板）';
    ball.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:80px',
      'width:52px', 'height:52px', 'border-radius:50%',
      'z-index:2147483546', 'cursor:pointer',
      'background:radial-gradient(circle at 35% 30%, #ffb6d9, #ff1493)',
      'box-shadow:0 4px 18px rgba(255,20,147,.45)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'color:#fff', 'font-size:22px', 'font-weight:700',
      'user-select:none', '-webkit-tap-highlight-color:transparent',
      'transition:transform .2s, box-shadow .2s',
      'touch-action:none',
    ].join(';') + ';';
    ball.innerHTML = '<span style="pointer-events:none">✦</span>';

    let pressTimer = null;
    let longPressed = false;
    ball.addEventListener('pointerdown', (ev) => {
      longPressed = false;
      pressTimer = setTimeout(() => {
        longPressed = true;
        ev.preventDefault();
        togglePanel();
      }, 500);
    });
    ball.addEventListener('pointerup', (ev) => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (longPressed) return;
      ev.preventDefault();
      ev.stopPropagation();
      openHudPanel();
    });
    ball.addEventListener('pointercancel', () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });
    ball.addEventListener('mouseenter', () => {
      ball.style.transform = 'scale(1.08)';
      ball.style.boxShadow = '0 6px 24px rgba(255,20,147,.6)';
    });
    ball.addEventListener('mouseleave', () => {
      ball.style.transform = 'scale(1)';
      ball.style.boxShadow = '0 4px 18px rgba(255,20,147,.45)';
    });

    root.body.appendChild(ball);
    addDisposer(() => { try { ball.remove(); } catch (_) {} });
  }
  function removeBall() {
    const root = hostDocument();
    const ball = root.getElementById(BALL_ID);
    if (ball) ball.remove();
  }

  // ========================================================================
  // 第五章 云端 runtime 加载（多源容错，对齐星月 fetchHudBody）
  // ========================================================================
  const hudLibCache = { jquery: null, lodash: null };
  async function fetchHudLibSource(kind, signal) {
    if (hudLibCache[kind]) return hudLibCache[kind];
    const urls = LIB_CDNS.map(base => base + LIB_PATHS[kind]);
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: 'force-cache', signal });
        if (!res.ok) continue;
        const src = await res.text();
        if (src && src.length > 1000) { hudLibCache[kind] = src; return src; }
      } catch (e) {
        if (signal?.aborted) return null;
      }
    }
    return null;
  }
  // 转义内联脚本里的 </script>，防止提前闭合 blob 里的 script 标签
  function escapeInlineScript(src) {
    return String(src || '').replace(/<\/script>/gi, '<\\/script>');
  }
  // 通用 CDN fetch（剥离 markdown 围栏）
  async function fetchFromCDN(filename, timeoutMs) {
    timeoutMs = timeoutMs || 6000;
    for (const base of CDN_SOURCES) {
      const url = base + '/' + filename;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const resp = await fetch(url, { signal: ctrl.signal, cache: 'force-cache' });
        clearTimeout(timer);
        if (resp.ok) {
          const text = await resp.text();
          if (text && text.length > 100) {
            // 自动剥离 markdown 围栏（```html/```css/```）
            const stripped = text.replace(/^```(?:html|css)?\s*\n/i, '').replace(/\n?```\s*$/i, '').trim();
            console.log('[假阴茎卡] CDN 加载成功:', filename, '大小:', stripped.length);
            return stripped;
          }
        }
      } catch (e) {
        console.warn('[假阴茎卡] CDN 源失败:', filename, e.message);
      }
    }
    return null;
  }

  // ========================================================================
  // 第六章 桥接发布（函数对象桥，对齐星月 publishHudBridge）
  // ========================================================================
  // 星月用 __XY_HUD_BRIDGE，本项目用 __FJB_HUD_BRIDGE
  // 11 个方法：getCurrentMessageId/getCurrentChatId/waitForMvu/getVariables/
  //           updateVariablesWith/applyCraftSettlement/subscribeHud/getVisibility/
  //           closeHud/onCollapse/resolveCurrentPlayerName
  let hudBridge = null;
  function publishHudBridge() {
    const host = hostWindow();
    const fns = {};
    ['$', 'jQuery', '_', 'toastr', 'TavernHelper'].forEach(k => {
      try { if (typeof window[k] !== 'undefined') fns[k] = window[k]; else if (typeof host[k] !== 'undefined') fns[k] = host[k]; } catch (_) {}
    });
    hudBridge = {
      fns,
      getCurrentMessageId: () => hudCurrentMsgId(),
      getCurrentChatId: () => hudCurrentChatId(),
      waitForMvu: (timeoutMs) => waitForHudMvu(timeoutMs),
      getVariables: () => hudGetVariables(),
      updateVariablesWith: (updater, options) => hudUpdateVariablesWith(updater, options),
      subscribeHud,
      getVisibility: () => hudSession.visible,
      closeHud: () => { try { closeHudPanel(); } catch (_) {} },
      onCollapse: (v) => { try { const el = currentHudHost(); if (el) el.classList.toggle('fjb-hud-collapsed', !!v); } catch (_) {} },
      resolveCurrentPlayerName: () => resolveCurrentPlayerName(),
    };
    host[BRIDGE_KEY] = hudBridge;
    return hudBridge;
  }
  // MVU API 动态获取（不快照，避免早开面板时 Mvu 未就绪）
  function getMvuApi() {
    try {
      if (typeof Mvu !== 'undefined' && Mvu) return Mvu;
      if (window.Mvu) return window.Mvu;
      const host = hostWindow();
      if (host.Mvu) return host.Mvu;
    } catch (_) {}
    return null;
  }
  function getHostGetVariables() {
    try {
      if (typeof getVariables === 'function') return getVariables;
      if (window.getVariables) return window.getVariables;
      const host = hostWindow();
      if (typeof host.getVariables === 'function') return host.getVariables;
    } catch (_) {}
    return null;
  }
  function getLastMessageIdSafe() {
    try {
      if (typeof getLastMessageId === 'function') return getLastMessageId();
      if (window.getLastMessageId) return window.getLastMessageId();
      const host = hostWindow();
      if (typeof host.getLastMessageId === 'function') return host.getLastMessageId();
    } catch (_) {}
    return -1;
  }
  function hudCurrentMsgId() { return getLastMessageIdSafe(); }
  function hudCurrentChatId() {
    try {
      if (typeof getContext === 'function') {
        const ctx = getContext();
        if (ctx && ctx.chatId != null) return ctx.chatId;
      }
    } catch (_) {}
    return -1;
  }
  async function waitForHudMvu(timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const mvu = getMvuApi();
      if (mvu && typeof mvu.getMvuData === 'function') return mvu;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }
  function hudGetVariables() {
    const gv = getHostGetVariables();
    if (!gv) return null;
    try {
      const maxId = getLastMessageIdSafe();
      if (maxId < 0) return null;
      // 同步获取最新 assistant 消息的变量
      for (let i = 0; i < 15; i++) {
        const cid = maxId - i;
        if (cid < 0) break;
        let msg = null;
        try {
          if (typeof getChatMessages === 'function') msg = getChatMessages(cid);
          else if (window.getChatMessages) msg = window.getChatMessages(cid);
          else { const host = hostWindow(); if (typeof host.getChatMessages === 'function') msg = host.getChatMessages(cid); }
        } catch (_) { continue; }
        if (Array.isArray(msg)) msg = msg[0];
        if (!msg || msg.role !== 'assistant') continue;
        const mid = msg.message_id;
        if (typeof mid !== 'number' || mid < 0) continue;
        try {
          const v = gv({ type: 'message', message_id: mid });
          if (v && v.stat_data) return v;
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }
  async function hudUpdateVariablesWith(updater, options = {}) {
    if (options.type && options.type !== 'message') throw new Error('HUD bridge 只允许写入 message 变量');
    const mvu = await waitForHudMvu();
    if (!mvu) throw new Error('MVU API 不可用');
    const messageId = options.message_id == null ? hudCurrentMsgId() : options.message_id;
    const mvuOptions = { type: 'message', message_id: messageId };
    const oldData = JSON.parse(JSON.stringify(mvu.getMvuData(mvuOptions) || { stat_data: {} }));
    let nextData = JSON.parse(JSON.stringify(oldData)) || { stat_data: {} };
    const returned = await updater(nextData);
    if (returned !== undefined) nextData = returned;
    await mvu.replaceMvuData(nextData, mvuOptions);
    emitHudSignal('data-changed', { force: true });
    return nextData;
  }
  function resolveCurrentPlayerName() {
    try {
      if (typeof getContext === 'function') {
        const ctx = getContext();
        if (ctx && ctx.name1) return ctx.name1;
      }
      if (window.name1) return window.name1;
      const host = hostWindow();
      if (host.name1) return host.name1;
    } catch (_) {}
    return '玩家';
  }

  // ========================================================================
  // 第七章 HUD 信号订阅系统（对齐星月 subscribeHud/emitHudSignal）
  // ========================================================================
  const hudSubscribers = [];
  function subscribeHud(fn) {
    if (typeof fn !== 'function') return () => {};
    hudSubscribers.push(fn);
    return () => {
      const idx = hudSubscribers.indexOf(fn);
      if (idx >= 0) hudSubscribers.splice(idx, 1);
    };
  }
  function emitHudSignal(signal, payload) {
    hudSubscribers.forEach(fn => {
      try { fn(signal, payload); } catch (_) {}
    });
  }

  // ========================================================================
  // 第八章 Blob HTML 构造（对齐星月 buildHudBlobHtml）
  // ========================================================================
  function buildHudBlobHtml(html, libSources) {
    const jqSrc = escapeInlineScript(libSources?.jquery);
    const lodashSrc = escapeInlineScript(libSources?.lodash);
    // libs：先借桥的 fns._，借不到才用内联 lodash（与星月同构）
    const libs = '<script>(function(){var B=(window.parent&&window.parent.' + BRIDGE_KEY + ')||null;var f=B&&B.fns||{};'
      + 'if(!window._&&f._)window._=f._;'
      + '})();<\/script>'
      + (jqSrc ? '<script>' + jqSrc + '<\/script>' : '')
      + (lodashSrc ? '<script>if(!window._){' + lodashSrc + '}<\/script>' : '');
    // shellFit：真身文档撑满 iframe 视口（与星月同构，必须 !important）
    const shellFit = '<style>'
      + 'html,body{height:100% !important;margin:0 !important;overflow:hidden !important;}'
      + '.sb{height:100% !important;box-sizing:border-box !important;display:flex !important;flex-direction:column !important;}'
      + '.sb-pages{flex:1 1 auto !important;min-height:0 !important;overflow-y:auto !important;}'
      + '.sb-nav{flex:0 0 auto !important;}'
      + '<\/style>';
    // boot：桥接握手 + 透明表面补偿 + ✕ 收起按钮 + 折叠监听（与星月同构）
    const boot = '<script>(function(){try{'
      + 'var B=(window.parent&&window.parent.' + BRIDGE_KEY + ')||null;if(!B)return;'
      + 'Object.keys(B.fns||{}).forEach(function(k){try{if(typeof window[k]==="undefined")window[k]=B.fns[k];}catch(e){}});'
      + 'window.FjbHudBridge=B;window.' + BRIDGE_KEY + '=B;'
      + 'try{document.documentElement.setAttribute("' + BRIDGE_BIND_ATTR + '","ready");}catch(e){}'
      + 'try{document.documentElement.setAttribute("' + BRIDGE_DEPS_ATTR + '",(typeof window.jQuery)+":"+(typeof window._));}catch(e){}'
      + 'window.getCurrentMessageId=function(){return B.getCurrentMessageId();};'
      + 'window.getVariables=function(){return B.getVariables();};'
      + 'window.updateVariablesWith=function(updater,o){return B.updateVariablesWith(updater,o||{});};'
      + 'window.waitGlobalInitialized=function(n){return n==="Mvu"?B.waitForMvu():Promise.resolve(window[n]);};'
      // ✕ 收起按钮注入（与星月 mkX 同构）
      + 'var mkX=function(){try{if(document.getElementById("fjb-hud-shell-x"))return;var c=document.querySelector(".rfr");if(!c||!c.parentNode)return;'
      + 'var b=document.createElement("button");b.type="button";b.id="fjb-hud-shell-x";b.className="hud-collapse-btn";b.textContent="✕";b.title="收起浮窗";'
      + 'b.style.cssText="min-width:44px;min-height:44px;background:rgba(255,192,203,.25);border:1px solid var(--c-border);color:var(--c-accent);border-radius:12px;cursor:pointer;font-size:14px;padding:4px 10px;margin-left:4px";'
      + 'b.addEventListener("click",function(ev){ev.preventDefault();ev.stopPropagation();try{if(B.closeHud)B.closeHud();}catch(e){}});c.parentNode.appendChild(b);}catch(e){}};'
      + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mkX);else mkX();'
      // 桥接就绪标记
      + 'try{document.documentElement.setAttribute("' + BRIDGE_READY_ATTR + '","1");}catch(e){}'
      + '}catch(e){}})();<\/script>';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + libs + shellFit + boot);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + libs + shellFit + boot);
    return libs + shellFit + boot + html;
  }

  // ========================================================================
  // 第九章 HUD 面板系统（对齐星月 hudPanelGeometry/ensureHudPanelStyle）
  // ========================================================================
  let hudPanel = null;
  const hudSession = {
    iframe: null,
    host: null,
    blobUrl: null,
    phase: 'idle',        // idle/loading/ready/failed
    visible: false,
    mode: 'orb',          // orb/drawer
    generation: 0,
    abortController: null,
    readyTimer: null,
    watchdog: null,
  };
  function setHudPhase(phase) { hudSession.phase = phase; }
  function setHudVisibility(v) { hudSession.visible = !!v; }
  function currentHudHost() { return hudSession.host; }
  function abortHudLoad() {
    if (hudSession.abortController) { try { hudSession.abortController.abort(); } catch (_) {} hudSession.abortController = null; }
    if (hudSession.readyTimer) { clearTimeout(hudSession.readyTimer); hudSession.readyTimer = null; }
  }
  function resetHudLoad() {
    abortHudLoad();
    if (hudSession.watchdog) { clearTimeout(hudSession.watchdog); hudSession.watchdog = null; }
    if (hudSession.iframe) { try { hudSession.iframe.remove(); } catch (_) {} hudSession.iframe = null; }
    if (hudSession.blobUrl) { try { URL.revokeObjectURL(hudSession.blobUrl); } catch (_) {} hudSession.blobUrl = null; }
    setHudPhase('idle');
  }

  function hudPanelSizeBounds(vw, vh, left, top) {
    const maxW = Math.max(1, Number(vw || 0) - Number(left || 0) - 8);
    const maxH = Math.max(1, Number(vh || 0) - Number(top || 0) - 8);
    return {
      minW: Math.min(280, maxW),
      minH: Math.min(320, maxH),
      maxW, maxH,
    };
  }
  function hudPanelGeometry() {
    const vw = hostWindow().innerWidth || 1200;
    const vh = hostWindow().innerHeight || 800;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(HUD_PANEL_STORE_KEY) || 'null'); } catch (_) {}
    let w = saved && typeof saved.w === 'number' ? saved.w : 430;
    let h = saved && typeof saved.h === 'number' ? saved.h : 640;
    const bounds = hudPanelSizeBounds(vw, vh, 8, 8);
    w = Math.min(Math.max(bounds.minW, w), bounds.maxW);
    h = Math.min(Math.max(bounds.minH, h), bounds.maxH);
    let left = saved && typeof saved.x === 'number' ? saved.x : Math.round((vw - w) / 2);
    let top = saved && typeof saved.y === 'number' ? saved.y : Math.round((vh - h) / 2);
    left = Math.max(8, Math.min(vw - w - 8, left));
    top = Math.max(8, Math.min(vh - h - 8, top));
    return { left, top, w, h };
  }
  function saveHudPanelRect() {
    try {
      if (!hudPanel || !hudPanel.isConnected) return;
      const r = hudPanel.getBoundingClientRect();
      localStorage.setItem(HUD_PANEL_STORE_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }));
    } catch (_) {}
  }
  function ensureHudPanelStyle(doc) {
    if (doc.getElementById(HUD_PANEL_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = HUD_PANEL_STYLE_ID;
    // 粉色磨砂玻璃浮窗（本项目主题）+ clip-path 切角 + 拖拽/缩放把手
    style.textContent = [
      '#' + HUD_PANEL_ID + '{--fjb-hud-cut:14px;position:fixed;z-index:2147483540;background:rgba(255,182,193,.32);backdrop-filter:blur(14px) saturate(1.12);-webkit-backdrop-filter:blur(14px) saturate(1.12);border:none;border-radius:0;clip-path:polygon(var(--fjb-hud-cut) 0,100% 0,100% calc(100% - var(--fjb-hud-cut)),calc(100% - var(--fjb-hud-cut)) 100%,0 100%,0 var(--fjb-hud-cut));transform-origin:center center;transition:transform .22s cubic-bezier(.34,1.56,.64,1),opacity .18s;}',
      '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){#' + HUD_PANEL_ID + '{background:rgba(255,182,193,.92);}}',
      '#' + HUD_PANEL_ID + ' .fjb-hud-body{position:absolute;inset:0;}',
      '#' + HUD_PANEL_ID + ' .fjb-hud-body iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}',
      '#' + HUD_PANEL_ID + '.fjb-hud-busy .fjb-hud-body iframe{pointer-events:none;}',
      '#' + HUD_PANEL_ID + ' .fjb-hud-drag{position:absolute;top:0;left:0;width:calc(100% - 170px);height:26px;cursor:move;z-index:3;background:transparent;touch-action:none;}',
      '#' + HUD_PANEL_ID + '.fjb-hud-collapsed{background:transparent !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}',
      '#' + HUD_PANEL_ID + '.fjb-hud-collapsed .fjb-hud-resize{display:none !important;opacity:0 !important;pointer-events:none !important;}',
      '#' + HUD_PANEL_ID + ' .fjb-hud-resize{position:absolute;right:0;bottom:0;width:32px;height:32px;cursor:nwse-resize;z-index:3;opacity:0;transition:opacity .15s;border:none;border-radius:0;background:transparent;touch-action:none;}',
      '#' + HUD_PANEL_ID + ' .fjb-hud-resize::before{content:"";position:absolute;right:3px;bottom:3px;width:24px;height:24px;background:rgba(255,105,180,.76);clip-path:polygon(100% 0,100% 6px,6px 100%,0 100%,0 calc(100% - 3px),calc(100% - 3px) 0);filter:drop-shadow(0 0 6px rgba(255,105,180,.38));}',
      '#' + HUD_PANEL_ID + ' .fjb-hud-resize::after{content:"";position:absolute;right:9px;bottom:9px;width:13px;height:13px;background:rgba(255,240,245,.34);clip-path:polygon(100% 0,100% 3px,3px 100%,0 100%,0 calc(100% - 2px),calc(100% - 2px) 0);}',
      '#' + HUD_PANEL_ID + ':hover .fjb-hud-resize{opacity:1;}',
      '#' + HUD_PANEL_ID + ' .fjb-hud-loading{position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;color:#8b3a52;font:12px/1.6 Consolas,monospace;letter-spacing:1px;background:rgba(255,240,245,.9);border:1px solid rgba(255,105,180,.3);border-radius:0;clip-path:inherit;}',
    ].join('');
    (doc.head || doc.body).appendChild(style);
  }
  function failHudLoad(hostEl, message) {
    setHudPhase('failed');
    if (hudSession.watchdog) { clearTimeout(hudSession.watchdog); hudSession.watchdog = null; }
    const loading = hostEl?.querySelector?.('.fjb-hud-loading');
    if (loading) loading.textContent = message || '状态栏远程组件加载失败，请检查网络后重试。';
  }

  // ========================================================================
  // 第十章 Blob URL 注入 + 4 条件握手 + 看门狗（对齐星月 mountHudBody）
  // ========================================================================
  let cachedStatusBarHTML = null;
  function mountHudBody(html, expectedHost, generation, signal, libSources) {
    const hostEl = currentHudHost();
    if (!hostEl || hostEl !== expectedHost || signal?.aborted || generation !== hudSession.generation) return false;
    const bridge = publishHudBridge();
    html = buildHudBlobHtml(html, libSources);
    try {
      if (hudSession.blobUrl) URL.revokeObjectURL(hudSession.blobUrl);
      hudSession.blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    } catch (error) {
      failHudLoad(hostEl, '状态栏面板挂载失败：' + (error.message || error));
      return false;
    }
    const body = hostEl.querySelector('.fjb-hud-body');
    if (!body) { failHudLoad(hostEl, '状态栏宿主已失效，请重试。'); return false; }
    const doc = hostEl.ownerDocument;
    const frame = doc.createElement('iframe');
    frame.title = '不要玩弄我的鸡吧 状态栏';
    frame.src = hudSession.blobUrl;
    frame.addEventListener('load', () => {
      if (signal?.aborted || generation !== hudSession.generation || currentHudHost() !== expectedHost || hudSession.iframe !== frame) return;
      const deadline = Date.now() + 12000;
      const checkReady = () => {
        if (signal?.aborted || generation !== hudSession.generation || currentHudHost() !== expectedHost || hudSession.iframe !== frame) return;
        let healthy = false;
        try {
          const fw = frame.contentWindow;
          // 4 条件握手：bridge === + jQuery + lodash + data-ready
          healthy = fw?.FjbHudBridge === bridge
            && typeof fw?.jQuery === 'function'
            && !!fw?._
            && fw.document?.documentElement?.getAttribute(BRIDGE_READY_ATTR) === '1';
        } catch (_) {}
        if (healthy) {
          hudSession.readyTimer = null;
          hudSession.abortController = null;
          if (hudSession.watchdog) { clearTimeout(hudSession.watchdog); hudSession.watchdog = null; }
          expectedHost.querySelector?.('.fjb-hud-loading')?.remove();
          setHudPhase('ready');
          emitHudSignal('data-changed', { force: true });
          return;
        }
        if (Date.now() >= deadline) {
          hudSession.readyTimer = null;
          hudSession.abortController = null;
          failHudLoad(expectedHost, '状态栏初始化或桥接握手失败，请重试。');
          return;
        }
        hudSession.readyTimer = setTimeout(checkReady, 50);
      };
      checkReady();
    }, { once: true });
    frame.addEventListener('error', () => {
      if (generation !== hudSession.generation || hudSession.iframe !== frame) return;
      failHudLoad(expectedHost, '状态栏面板加载失败（iframe error），请重试。');
    }, { once: true });

    hudSession.iframe = frame;
    hudSession.host = hostEl;
    let loading = body.querySelector('.fjb-hud-loading');
    body.replaceChildren(frame);
    if (!loading) {
      loading = doc.createElement('div');
      loading.className = 'fjb-hud-loading';
      loading.textContent = '〔 不要玩弄我的鸡吧 〕状态栏加载中…';
    }
    body.appendChild(loading);
    // 看门狗：不挂 load 回调，即便 iframe load 永不触发也一定会超时报错
    if (hudSession.watchdog) clearTimeout(hudSession.watchdog);
    hudSession.watchdog = setTimeout(() => {
      hudSession.watchdog = null;
      if (signal?.aborted || generation !== hudSession.generation || currentHudHost() !== expectedHost || hudSession.iframe !== frame) return;
      if (hudSession.phase === 'ready') return;
      failHudLoad(expectedHost, '状态栏加载超时：远程组件或依赖未能就绪，请检查网络后重试。');
    }, 20000);
    return true;
  }
  async function fetchHudBody() {
    const hostEl = currentHudHost();
    if (!hostEl) return;
    abortHudLoad();
    const generation = hudSession.generation;
    const controller = new AbortController();
    hudSession.abortController = controller;
    hudSession.host = hostEl;
    setHudPhase('loading');
    // 多源 fetch status-bar.html
    for (const base of CDN_SOURCES) {
      if (controller.signal.aborted || generation !== hudSession.generation || currentHudHost() !== hostEl) return;
      const url = base + '/status-bar.html';
      try {
        const response = await fetch(url, { cache: 'force-cache', signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        let html = await response.text();
        // 剥离 markdown 围栏
        html = html.replace(/^```(?:html)?\s*\n/i, '').replace(/\n?```\s*$/i, '').trim();
        if (controller.signal.aborted || generation !== hudSession.generation || currentHudHost() !== hostEl) return;
        cachedStatusBarHTML = html;
        // 并行预取依赖源码（双 CDN 兜底），内联进 blob
        const libSources = {
          jquery: await fetchHudLibSource('jquery', controller.signal),
          lodash: await fetchHudLibSource('lodash', controller.signal),
        };
        if (controller.signal.aborted || generation !== hudSession.generation || currentHudHost() !== hostEl) return;
        if (mountHudBody(html, hostEl, generation, controller.signal, libSources)) return;
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
      }
    }
    // 所有 CDN 失败 → 卡内兜底
    if (generation === hudSession.generation && currentHudHost() === hostEl) {
      hudSession.abortController = null;
      const fallbackHtml = getFallbackStatusBarHTML();
      const libSources = {
        jquery: await fetchHudLibSource('jquery', null),
        lodash: await fetchHudLibSource('lodash', null),
      };
      mountHudBody(fallbackHtml, hostEl, generation, null, libSources);
    }
  }

  function openHudPanel() {
    const doc = hostDocument();
    ensureHudPanelStyle(doc);
    const geo = hudPanelGeometry();
    if (hudPanel && hudPanel.isConnected) {
      const isHidden = hudPanel.dataset.fjbHudOpen === '0' || hudPanel.style.opacity === '0';
      if (!isHidden) { closeHudPanel(); return; }
      hudPanel.style.left = geo.left + 'px'; hudPanel.style.top = geo.top + 'px';
      hudPanel.style.width = geo.w + 'px'; hudPanel.style.height = geo.h + 'px';
      hudPanel.dataset.fjbHudOpen = '1';
      hudPanel.style.transform = 'scale(1)'; hudPanel.style.opacity = '1'; hudPanel.style.pointerEvents = 'auto';
      hudSession.host = hudPanel;
      setHudVisibility(true);
      if (hudSession.phase === 'idle' || hudSession.phase === 'failed') fetchHudBody();
      return;
    }
    hudPanel = doc.createElement('div');
    hudPanel.id = HUD_PANEL_ID;
    hudPanel.dataset.fjbHudOpen = '0';
    hudPanel.style.cssText = 'left:' + geo.left + 'px;top:' + geo.top + 'px;width:' + geo.w + 'px;height:' + geo.h + 'px;transform:scale(0.88);opacity:0;';
    hudPanel.innerHTML = '<div class="fjb-hud-body"><div class="fjb-hud-loading">〔 不要玩弄我的鸡吧 〕状态栏加载中…</div></div>'
      + '<div class="fjb-hud-drag" title="拖动移动"></div>'
      + '<div class="fjb-hud-resize" title="拖动调整大小"></div>';
    doc.body.appendChild(hudPanel);
    // 拖动移动 + 右下角缩放（与星月 onHudMove/onHudUp/startHudPtr 同构）
    const dragBar = hudPanel.querySelector('.fjb-hud-drag');
    const resizer = hudPanel.querySelector('.fjb-hud-resize');
    let hudPtr = null;
    const onHudMove = (ev) => {
      if (!hudPtr) return;
      const vw = hostWindow().innerWidth || 1200;
      const vh = hostWindow().innerHeight || 800;
      if (hudPtr.mode === 'move') {
        hudPanel.style.left = Math.max(8, Math.min(vw - hudPtr.base.w - 8, hudPtr.base.left + ev.clientX - hudPtr.startX)) + 'px';
        hudPanel.style.top = Math.max(8, Math.min(vh - 48, hudPtr.base.top + ev.clientY - hudPtr.startY)) + 'px';
      } else {
        const bounds = hudPanelSizeBounds(vw, vh, hudPtr.base.left, hudPtr.base.top);
        hudPanel.style.width = Math.max(bounds.minW, Math.min(bounds.maxW, hudPtr.base.w + ev.clientX - hudPtr.startX)) + 'px';
        hudPanel.style.height = Math.max(bounds.minH, Math.min(bounds.maxH, hudPtr.base.h + ev.clientY - hudPtr.startY)) + 'px';
      }
    };
    const onHudUp = () => {
      if (!hudPtr) return;
      hudPtr = null;
      hudPanel.classList.remove('fjb-hud-busy');
      saveHudPanelRect();
    };
    const startHudPtr = (mode) => (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const r = hudPanel.getBoundingClientRect();
      hudPtr = { mode, startX: ev.clientX, startY: ev.clientY, base: { left: r.left, top: r.top, w: r.width, h: r.height } };
      hudPanel.classList.add('fjb-hud-busy');
      try { ev.target.setPointerCapture(ev.pointerId); } catch (_) {}
    };
    [[dragBar, 'move'], [resizer, 'resize']].forEach(([el, mode]) => {
      el.addEventListener('pointerdown', startHudPtr(mode));
      el.addEventListener('pointermove', onHudMove);
      el.addEventListener('pointerup', onHudUp);
      el.addEventListener('pointercancel', onHudUp);
    });
    hudSession.host = hudPanel;
    setHudVisibility(true);
    (hostWindow().requestAnimationFrame || requestAnimationFrame)(() => {
      try { hudPanel.dataset.fjbHudOpen = '1'; hudPanel.style.transform = 'scale(1)'; hudPanel.style.opacity = '1'; hudPanel.style.pointerEvents = 'auto'; } catch (_) {}
    });
    fetchHudBody();
    addDisposer(() => { try { hudPanel?.remove(); } catch (_) {} hudPanel = null; });
  }
  function closeHudPanel() {
    if (!hudPanel) return;
    hudPanel.dataset.fjbHudOpen = '0';
    hudPanel.style.transform = 'scale(0.88)';
    hudPanel.style.opacity = '0';
    hudPanel.style.pointerEvents = 'none';
    setHudVisibility(false);
  }

  // ========================================================================
  // 第十一章 MVU 数据桥接（pushStatDataToStatusBars 仍保留作为兼容通道）
  // ========================================================================
  async function fetchLatestStatData() {
    const mvuApi = getMvuApi();
    const gv = getHostGetVariables();
    if (!mvuApi && !gv) return null;
    const maxId = getLastMessageIdSafe();
    if (maxId < 0) return null;
    for (let i = 0; i < 15; i++) {
      const cid = maxId - i;
      if (cid < 0) break;
      let msg = null;
      try {
        if (typeof getChatMessages === 'function') msg = getChatMessages(cid);
        else if (window.getChatMessages) msg = window.getChatMessages(cid);
        else { const host = hostWindow(); if (typeof host.getChatMessages === 'function') msg = host.getChatMessages(cid); }
      } catch (_) { continue; }
      if (Array.isArray(msg)) msg = msg[0];
      if (!msg || msg.role !== 'assistant') continue;
      const mid = msg.message_id;
      if (typeof mid !== 'number' || mid < 0) continue;
      let v = null;
      try {
        if (mvuApi && typeof mvuApi.getMvuData === 'function') v = await mvuApi.getMvuData({ type: 'message', message_id: mid });
        else if (gv) v = await gv({ type: 'message', message_id: mid });
      } catch (_) { continue; }
      if (v && v.stat_data && typeof v.stat_data === 'object') return v.stat_data;
    }
    try {
      if (gv) { const chatVar = await gv({ type: 'chat' }); if (chatVar && chatVar.stat_data) return chatVar.stat_data; }
    } catch (_) {}
    return null;
  }
  // 向所有 HUD iframe + 老式状态栏 iframe 推送 stat_data
  async function pushStatDataToStatusBars() {
    const stat = await fetchLatestStatData();
    if (!stat) return;
    const payload = { type: 'fjb-mvu-stat-data', stat_data: stat, messageId: -1 };
    emitHudSignal('data-changed', { stat_data: stat });
    // 老式 srcdoc 状态栏 iframe 兼容通道
    const docs = [document];
    try { if (hostWindow().document) docs.push(hostWindow().document); } catch (_) {}
    docs.forEach(doc => {
      const iframes = doc.querySelectorAll('[data-fjb-status-iframe]');
      for (let i = 0; i < iframes.length; i++) {
        try { iframes[i].contentWindow.postMessage(payload, '*'); } catch (_) {}
      }
      try { doc.defaultView.postMessage(payload, '*'); } catch (_) {}
    });
  }

  // ========================================================================
  // 第十二章 老式 srcdoc 状态栏注入（兼容保留 + 新消息自动重注入）
  // ========================================================================
  async function injectStatusBars() {
    if (cachedStatusBarHTML == null) {
      const html = await fetchFromCDN('status-bar.html', 6000);
      cachedStatusBarHTML = html || getFallbackStatusBarHTML();
    }
    if (!cachedStatusBarHTML) return;
    const docs = [document];
    try { if (hostWindow().document) docs.push(hostWindow().document); } catch (_) {}
    docs.forEach(doc => {
      const mounts = doc.querySelectorAll('[data-fjb-status-mount]');
      for (let i = 0; i < mounts.length; i++) {
        const mount = mounts[i];
        if (mount.getAttribute('data-fjb-injected')) continue;
        mount.setAttribute('data-fjb-injected', '1');
        mount.innerHTML = '';
        const iframe = doc.createElement('iframe');
        iframe.style.cssText = 'width:100%;border:none;border-radius:12px;min-height:600px;background:transparent';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('data-fjb-status-iframe', '1');
        iframe.srcdoc = cachedStatusBarHTML;
        mount.appendChild(iframe);
      }
    });
  }

  // ========================================================================
  // 第十三章 开局页注入（完整性校验 + DOMParser 消毒 + 结构校验 + 卡内兜底）
  // 对齐星月 verifyOpeningPageHtml / sanitizeOpeningPageHtml / consumeOpeningEmbeddedFallback
  // ========================================================================
  let cachedOpeningPageHTML = null;
  let cachedOpeningSanitized = null;
  const openingRemoteAttempts = new Map();

  // SHA-256 纯 JS 回退实现（对齐星月 sha256HexFallback）
  function sha256HexFallback(value, Encoder) {
    let bytes;
    if (Encoder) bytes = new Encoder().encode(String(value));
    else {
      const encoded = unescape(encodeURIComponent(String(value)));
      bytes = Uint8Array.from(encoded, c => c.charCodeAt(0));
    }
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);
    const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const words = new Uint32Array(64);
    const rot = (w, b) => (w >>> b) | (w << (32 - b));
    for (let off = 0; off < paddedLength; off += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(words[i-15],7) ^ rot(words[i-15],18) ^ (words[i-15] >>> 3);
        const s1 = rot(words[i-2],17) ^ rot(words[i-2],19) ^ (words[i-2] >>> 10);
        words[i] = (words[i-16] + s0 + words[i-7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,h] = state;
      for (let i = 0; i < 64; i++) {
        const S1 = rot(e,6) ^ rot(e,11) ^ rot(e,25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + words[i]) >>> 0;
        const S0 = rot(a,2) ^ rot(a,13) ^ rot(a,22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      state[0]=(state[0]+a)>>>0; state[1]=(state[1]+b)>>>0; state[2]=(state[2]+c)>>>0; state[3]=(state[3]+d)>>>0;
      state[4]=(state[4]+e)>>>0; state[5]=(state[5]+f)>>>0; state[6]=(state[6]+g)>>>0; state[7]=(state[7]+h)>>>0;
    }
    return state.map(w => w.toString(16).padStart(8, '0')).join('');
  }

  // SHA-256 校验（对齐星月 verifyOpeningPageHtml）
  async function verifyOpeningPageHtml(html) {
    if (!OPENING_PAGE_SHA256) return; // 开发阶段跳过
    const subtle = window.crypto?.subtle;
    const Encoder = window.TextEncoder;
    const canonical = String(html || '').replace(/\r\n?/g, '\n');
    let actual;
    if (subtle && Encoder) {
      const digest = await subtle.digest('SHA-256', new Encoder().encode(canonical));
      actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    } else {
      actual = sha256HexFallback(canonical, Encoder);
    }
    if (actual !== OPENING_PAGE_SHA256) throw new Error('远程开局页完整性校验失败');
  }

  // 安全 URL 判定（对齐星月 safeOpeningUrl）
  function safeOpeningUrl(value) {
    const url = String(value || '').trim();
    if (!url || url[0] === '#' || url[0] === '/') return true;
    return /^(?:https?:|blob:|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(url);
  }

  // DOMParser 消毒 + 结构校验（对齐星月 sanitizeOpeningPageHtml）
  function sanitizeOpeningPageHtml(html) {
    const Parser = window.DOMParser;
    if (!Parser) throw new Error('DOMParser 不可用');
    const parsed = new Parser().parseFromString(String(html || ''), 'text/html');
    const root = parsed.querySelector('[data-fjb-opening-page="' + OPENING_PAGE_STRUCTURE_VERSION + '"]');
    if (!root
      || !root.querySelector('[data-fjb-opening-action="enter-entry"]')
      || !root.querySelector('[data-fjb-view-name="boot"]')
      || !root.querySelector('[data-fjb-view-name="wizard"]')) {
      throw new Error('远程开局页结构或版本不匹配');
    }
    // 移除危险元素
    parsed.querySelectorAll('script,iframe,object,embed,base,link,meta,form').forEach(n => n.remove());
    // 清理危险属性
    parsed.querySelectorAll('*').forEach(node => {
      Array.from(node.attributes || []).forEach(attr => {
        const name = String(attr.name || '').toLowerCase();
        const value = String(attr.value || '');
        if (name.startsWith('on')) { node.removeAttribute(attr.name); return; }
        if (['href','src','xlink:href','action','formaction','poster'].includes(name) && !safeOpeningUrl(value)) {
          node.removeAttribute(attr.name); return;
        }
        if (name === 'style' && /(?:javascript\s*:|expression\s*\(|url\s*\(\s*["']?\s*(?!https?:|blob:|data:image\/|\/|#))/i.test(value)) {
          node.removeAttribute(attr.name);
        }
      });
    });
    // 清理 style 中的 @import 和 javascript:
    parsed.querySelectorAll('style').forEach(style => {
      style.textContent = String(style.textContent || '')
        .replace(/@import[\s\S]*?;/gi, '')
        .replace(/url\s*\(\s*(["']?)\s*javascript:[\s\S]*?\1\s*\)/gi, 'none');
    });
    return root.outerHTML;
  }

  // 卡内兜底（对齐星月 consumeOpeningEmbeddedFallback）
  function consumeOpeningEmbeddedFallback(mount) {
    let html = '';
    try { html = String(window.__fjbOpeningFallbackHtml || ''); } catch (_) {}
    if (!html) return false;
    try {
      const sanitized = sanitizeOpeningPageHtml(html);
      mount.innerHTML = sanitized;
      mount.setAttribute('data-fjb-remote-state', 'loaded');
      mount.setAttribute('data-fjb-opening-injected', '1');
      return true;
    } catch (_) { return false; }
  }

  // 渲染加载/错误状态
  function renderOpeningPhase(mount, phase, message) {
    if (!mount) return;
    mount.setAttribute('data-fjb-opening-phase', phase);
    mount.setAttribute('aria-busy', phase === 'loading' ? 'true' : 'false');
    const existing = mount.querySelector('[data-fjb-opening-phase-ui]');
    if (existing) existing.remove();
    if (phase === 'loading' || phase === 'error') {
      const ui = document.createElement('div');
      ui.setAttribute('data-fjb-opening-phase-ui', '1');
      ui.style.cssText = 'padding:24px;text-align:center;font-family:-apple-system,"PingFang SC",sans-serif;color:#8b3a52;background:linear-gradient(180deg,#fff0f5,#ffe4ec);border-radius:16px;min-height:200px;display:grid;place-items:center';
      ui.innerHTML = '<div>' + (message || '') + '</div>'
        + (phase === 'error' ? '<button type="button" data-fjb-opening-retry style="margin-top:14px;padding:10px 22px;border:1px solid #ff69b4;border-radius:9px;background:linear-gradient(180deg,#ff69b4,#ff1493);color:#fff;font-weight:700;cursor:pointer">重新加载开局页</button>' : '');
      mount.innerHTML = '';
      mount.appendChild(ui);
      const retry = ui.querySelector('[data-fjb-opening-retry]');
      if (retry) retry.addEventListener('click', () => {
        cachedOpeningPageHTML = null;
        cachedOpeningSanitized = null;
        mount.removeAttribute('data-fjb-opening-injected');
        mount.removeAttribute('data-fjb-opening-phase');
        injectOpeningPages();
      });
    }
  }

  // 多源轮询拉取（对齐星月 tryOpeningRemoteSource）
  async function fetchOpeningPageWithIntegrity() {
    const deadline = Date.now() + OPENING_PAGE_TOTAL_TIMEOUT_MS;
    let lastError = '';
    for (const base of CDN_SOURCES) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const sourceTimeout = Math.min(OPENING_PAGE_SOURCE_TIMEOUT_MS, remaining);
      const url = base + '/opening-page.html?v=' + OPENING_PAGE_REVISION;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), sourceTimeout);
        const resp = await fetch(url, { signal: ctrl.signal, cache: 'force-cache' });
        clearTimeout(timer);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const text = await resp.text();
        if (!text || text.length < 200) throw new Error('内容过短');
        // 剥离 markdown 围栏
        const stripped = text.replace(/^```(?:html|css)?\s*\n/i, '').replace(/\n?```\s*$/i, '').trim();
        // SHA-256 校验
        await verifyOpeningPageHtml(stripped);
        // DOMParser 消毒 + 结构校验
        const sanitized = sanitizeOpeningPageHtml(stripped);
        console.log('[假阴茎卡] 开局页校验+消毒成功，来源:', base);
        return sanitized;
      } catch (e) {
        console.warn('[假阴茎卡] 开局页源失败:', base, e.message);
        lastError = e.message || String(e);
      }
    }
    console.warn('[假阴茎卡] 开局页所有远程源失败:', lastError);
    return null;
  }

  async function injectOpeningPages() {
    const sw = getSwitches();
    if (!sw.opening) return;
    const docs = [document];
    try { if (hostWindow().document) docs.push(hostWindow().document); } catch (_) {}
    let hasMount = false;
    docs.forEach(doc => { if (doc.querySelectorAll('[' + OPENING_FLAG_ATTR + ']').length > 0) hasMount = true; });
    if (!hasMount) return;

    // 拉取 + 校验 + 消毒（带缓存）
    if (!cachedOpeningSanitized) {
      cachedOpeningSanitized = await fetchOpeningPageWithIntegrity();
      if (!cachedOpeningSanitized) {
        // 所有远程源失败，尝试卡内兜底
        docs.forEach(doc => {
          const mounts = doc.querySelectorAll('[' + OPENING_FLAG_ATTR + ']');
          mounts.forEach(mount => {
            if (mount.getAttribute('data-fjb-opening-injected')) return;
            if (consumeOpeningEmbeddedFallback(mount)) {
              console.log('[假阴茎卡] 开局页使用卡内兜底');
            } else {
              renderOpeningPhase(mount, 'error', '开局界面加载失败。<br>所有安全来源均无法连接或内容校验未通过。<br>请检查网络，恢复后点击下方按钮重试。');
            }
          });
        });
        return;
      }
    }

    docs.forEach(doc => {
      const mounts = doc.querySelectorAll('[' + OPENING_FLAG_ATTR + ']');
      for (let i = 0; i < mounts.length; i++) {
        const mount = mounts[i];
        if (mount.getAttribute('data-fjb-opening-injected')) continue;
        mount.setAttribute('data-fjb-opening-injected', '1');
        mount.setAttribute('data-fjb-remote-state', 'loaded');
        mount.innerHTML = '';
        const iframe = doc.createElement('iframe');
        iframe.style.cssText = 'width:100%;border:none;border-radius:16px;min-height:560px;background:transparent';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.setAttribute('data-fjb-opening-iframe', '1');
        iframe.srcdoc = cachedOpeningSanitized;
        mount.appendChild(iframe);
      }
    });
  }

  // ========================================================================
  // 第十四章 OMNI 三态 UI 注入（in-flight 去重 + 文档片段注入）
  // ========================================================================
  const cachedOmni = { progress: null, done: null, analysis: null };
  const inflightOmni = { progress: null, done: null, analysis: null };
  function fetchOmniTemplate(kind) {
    if (cachedOmni[kind]) return Promise.resolve(cachedOmni[kind]);
    if (inflightOmni[kind]) return inflightOmni[kind];
    inflightOmni[kind] = fetchFromCDN('omni-' + kind + '.html', 4000).then(h => {
      if (h) cachedOmni[kind] = h;
      inflightOmni[kind] = null;
      return h;
    }).catch(() => { inflightOmni[kind] = null; return null; });
    return inflightOmni[kind];
  }
  function mountFragment(mountEl, htmlStr) {
    if (!mountEl || !htmlStr) return;
    try {
      const range = document.createRange();
      range.selectNode(mountEl);
      const frag = range.createContextualFragment(htmlStr);
      mountEl.innerHTML = '';
      mountEl.appendChild(frag);
    } catch (_) { try { mountEl.innerHTML = htmlStr; } catch (e) {} }
  }
  async function injectOmniUI() {
    const docs = [document];
    try { if (hostWindow().document) docs.push(hostWindow().document); } catch (_) {}
    let needProg = false, needDone = false, needAna = false;
    docs.forEach(doc => {
      if (doc.querySelectorAll('[data-fjb-omni-progress]').length > 0) needProg = true;
      if (doc.querySelectorAll('[data-fjb-omni-done]').length > 0) needDone = true;
      if (doc.querySelectorAll('[data-fjb-omni-analysis]').length > 0) needAna = true;
    });
    const promises = [];
    if (needProg && !cachedOmni.progress) promises.push(fetchOmniTemplate('progress'));
    if (needDone && !cachedOmni.done) promises.push(fetchOmniTemplate('done'));
    if (needAna && !cachedOmni.analysis) promises.push(fetchOmniTemplate('analysis'));
    if (promises.length > 0) await Promise.all(promises);
    docs.forEach(doc => {
      doc.querySelectorAll('[data-fjb-omni-progress]').forEach(m => {
        if (m.getAttribute('data-fjb-omni-injected')) return;
        m.setAttribute('data-fjb-omni-injected', '1');
        mountFragment(m, cachedOmni.progress || '');
      });
      doc.querySelectorAll('[data-fjb-omni-done]').forEach(m => {
        if (m.getAttribute('data-fjb-omni-injected')) return;
        m.setAttribute('data-fjb-omni-injected', '1');
        mountFragment(m, cachedOmni.done || '');
      });
      doc.querySelectorAll('[data-fjb-omni-analysis]').forEach(m => {
        if (m.getAttribute('data-fjb-omni-injected')) return;
        m.setAttribute('data-fjb-omni-injected', '1');
        mountFragment(m, cachedOmni.analysis || '');
      });
    });
  }

  // ========================================================================
  // 第十五章 Bubble CSS 注入
  // ========================================================================
  let cachedBubbleCSS = null;
  async function injectBubbleCSS() {
    if (cachedBubbleCSS) return;
    const css = await fetchFromCDN('bubble.css', 4000);
    if (!css) return;
    cachedBubbleCSS = css;
    const docs = [document];
    try { if (hostWindow().document) docs.push(hostWindow().document); } catch (_) {}
    docs.forEach(doc => {
      if (doc.getElementById('fjb-bubble-css')) return;
      const style = doc.createElement('style');
      style.id = 'fjb-bubble-css';
      style.textContent = css;
      doc.head.appendChild(style);
    });
  }

  // ========================================================================
  // 第十六章 生成前提示词注入（对齐星月 GENERATION_INJECTION_IDS）
  // ========================================================================
  function injectGenerationPrompts() {
    try {
      if (typeof eventOn !== 'function') return;
      const inject = (id, text) => {
        try {
          if (typeof injectPrompt === 'function') {
            injectPrompt(text, { id, position: 'before' });
          }
        } catch (_) {}
      };
      eventOn('generation_started', () => {
        try {
          const sw = getSwitches();
          if (sw.event_notify) {
            inject(EVENT_PROMPT_ID, '【系统提示】请检查近期事件是否有变化，如有新事件请在<UpdateVariable>中更新 recent_events 数组，包含 id/type/desc/importance/impact/hooks 字段。');
          }
          inject(ENV_PROMPT_ID, '【环境刷新】请根据当前时段和日期，更新 environment 字段（weather/temperature/location/activities/news）。');
        } catch (_) {}
      });
      eventOn('generation_ended', () => {
        try {
          if (typeof removePrompt === 'function') {
            GENERATION_INJECTION_IDS.forEach(id => { try { removePrompt(id); } catch (_) {} });
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  // ========================================================================
  // 第十七章 主题系统
  // ========================================================================
  function getThemeVars(theme) {
    const themes = {
      pink: { '--c-accent': '#ff69b4', '--c-pink': '#ff1493', '--c-danger': '#ff6b8a', '--c-warn': '#ff9ec4', '--c-orange': '#ff85a2', '--c-safe': '#ffb6d9', '--c-blue': '#ff85a2', '--c-silver': '#ffc0cb' },
      purple: { '--c-accent': '#9b59b6', '--c-pink': '#8e44ad', '--c-danger': '#9b59b6', '--c-warn': '#b388d1', '--c-orange': '#a569bd', '--c-safe': '#c39bd3', '--c-blue': '#a569bd', '--c-silver': '#d2b4de' },
      dark: { '--c-accent': '#e74c3c', '--c-pink': '#c0392b', '--c-danger': '#e74c3c', '--c-warn': '#f39c12', '--c-orange': '#e67e22', '--c-safe': '#2ecc71', '--c-blue': '#3498db', '--c-silver': '#95a5a6' },
    };
    return themes[theme] || themes.pink;
  }
  function applyThemeToStatusBars(theme) {
    const payload = { type: 'fjb-set-theme', theme: theme };
    const origin = window.location.origin || '*';
    try { window.postMessage(payload, origin); } catch (_) {}
    try { hostWindow().postMessage(payload, origin); } catch (_) {}
    const docs = [document];
    try { if (hostWindow().document) docs.push(hostWindow().document); } catch (_) {}
    docs.forEach(doc => {
      const iframes = doc.querySelectorAll('[data-fjb-status-iframe]');
      for (let i = 0; i < iframes.length; i++) {
        try { iframes[i].contentWindow.postMessage(payload, '*'); } catch (_) {}
      }
      // HUD iframe
      if (hudSession.iframe) {
        try { hudSession.iframe.contentWindow.postMessage(payload, '*'); } catch (_) {}
      }
      const roots = doc.querySelectorAll('#sb-root, .sb');
      const themeVars = getThemeVars(theme);
      for (let j = 0; j < roots.length; j++) {
        const el = roots[j];
        Object.keys(themeVars).forEach(k => el.style.setProperty(k, themeVars[k]));
      }
    });
  }

  // ========================================================================
  // 第十八章 控制中心设置面板
  // ========================================================================
  function togglePanel() {
    const root = hostDocument();
    const existing = root.getElementById(PANEL_ID);
    if (existing) { existing.remove(); return; }
    const sw = getSwitches();
    const theme = getTheme();
    const overlay = document.createElement('div');
    overlay.id = PANEL_ID;
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483547',
      'background:rgba(255,182,193,.35)', 'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:16px',
    ].join(';') + ';';
    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:linear-gradient(135deg,#fff0f5,#ffe4ec)',
      'backdrop-filter:blur(20px)', '-webkit-backdrop-filter:blur(20px)',
      'border:1px solid rgba(255,105,180,.3)', 'border-radius:18px',
      'max-width:440px', 'width:100%', 'max-height:80vh', 'overflow-y:auto', 'padding:16px',
      'box-shadow:0 8px 32px rgba(255,105,180,.3)',
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif', 'color:#8b3a52',
    ].join(';') + ';';
    let html = '';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,182,193,.3)">';
    html += '<span style="font-size:16px;font-weight:700;color:#ff69b4">✦ 控制中心</span>';
    html += '<button id="fjb-cc-close" style="min-width:44px;min-height:44px;background:rgba(255,192,203,.25);border:1px solid rgba(255,105,180,.3);color:#ff69b4;border-radius:12px;cursor:pointer;font-size:18px">×</button>';
    html += '</div>';
    html += '<div style="font-size:12px;color:rgba(139,58,82,.7);margin:10px 0 6px;font-weight:600">主题切换</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';
    [['pink', '粉色'], ['purple', '紫色'], ['dark', '深色']].forEach(t => {
      const active = (t[0] === theme) ? ';background:rgba(255,105,180,.25);border-color:#ff69b4;color:#ff69b4;font-weight:700' : '';
      html += '<button class="fjb-cc-theme" data-val="' + t[0] + '" style="min-height:44px;background:rgba(255,192,203,.12);border:1px solid rgba(255,182,193,.3);color:rgba(139,58,82,.7);border-radius:12px;padding:8px;cursor:pointer;font-size:13px' + active + '">' + t[1] + '</button>';
    });
    html += '</div>';
    html += '<div style="font-size:12px;color:rgba(139,58,82,.7);margin:14px 0 6px;font-weight:600">功能开关</div>';
    [['floatball', '悬浮球'], ['opening', '开局页'], ['media_lib', '媒体库（预留）'], ['diy', 'DIY设置（预留）'], ['auto_refresh', '状态栏自动刷新'], ['event_notify', '事件通知']].forEach(s => {
      const checked = sw[s[0]] ? 'checked' : '';
      html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,192,203,.1);border:1px solid rgba(255,182,193,.25);border-radius:12px;font-size:13px;color:rgba(139,58,82,.85);cursor:pointer;min-height:44px;margin-bottom:4px">';
      html += '<input type="checkbox" class="fjb-cc-switch" data-key="' + s[0] + '" ' + checked + ' style="margin:0;width:18px;height:18px;accent-color:#ff69b4">';
      html += '<span>' + s[1] + '</span></label>';
    });
    html += '<div style="font-size:12px;color:rgba(139,58,82,.7);margin:14px 0 6px;font-weight:600">关于</div>';
    html += '<div style="font-size:11px;color:rgba(139,58,82,.6);padding:8px 10px;line-height:1.6;background:rgba(255,192,203,.08);border-radius:10px">';
    html += '不要玩弄我的鸡吧-forge · 控制中心 v' + VERSION + '<br>Runtime: ' + RT_VERSION + ' / ' + GIT_REVISION + '<br>';
    html += '当前主题：' + theme + ' · 悬浮球：' + (sw.floatball ? '开' : '关') + ' · 开局页：' + (sw.opening ? '开' : '关');
    html += '</div>';
    panel.innerHTML = html;
    overlay.appendChild(panel);
    root.body.appendChild(overlay);
    panel.querySelector('#fjb-cc-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    panel.querySelectorAll('.fjb-cc-theme').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-val');
        setTheme(val);
        applyThemeToStatusBars(val);
        overlay.remove();
        togglePanel();
      });
    });
    panel.querySelectorAll('.fjb-cc-switch').forEach(swEl => {
      swEl.addEventListener('change', () => {
        const key = swEl.getAttribute('data-key');
        const val = swEl.checked;
        setSwitch(key, val);
        if (key === 'floatball') { if (val) ensureBall(); else removeBall(); }
      });
    });
    addDisposer(() => { try { overlay.remove(); } catch (_) {} });
  }

  // ========================================================================
  // 第十九章 卡内兜底状态栏 HTML
  // ========================================================================
  function getFallbackStatusBarHTML() {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:rgba(255,240,245,.6);color:#8b3a52;padding:8px;font-size:13px}'
      + '.hdr{display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px;background:rgba(255,182,193,.15);border-radius:10px;margin-bottom:6px}'
      + '.hdr span{font-size:11px;color:#ff69b4}.stat{display:flex;gap:8px;flex-wrap:wrap}.stat div{background:rgba(255,182,193,.1);border:1px solid rgba(255,105,180,.15);border-radius:8px;padding:4px 8px;font-size:11px}'
      + '</style></head><body><div id="sb-root">'
      + '<div class="hdr"><span>📊 状态栏（卡内兜底版）</span></div>'
      + '<div class="stat" id="stat-display">等待数据…</div>'
      + '<script>'
      + 'window.addEventListener("message",function(e){'
      + 'if(!e.data)return;'
      + 'if(e.data.type==="fjb-mvu-stat-data"&&e.data.stat_data){'
      + 'var s=e.data.stat_data;var d=document.getElementById("stat-display");d.innerHTML="";'
      + 'if(s.stats){d.innerHTML+="<div>⚡精力:"+(s.stats.energy||0)+"/"+(s.stats.energy_max||0)+"</div>";d.innerHTML+="<div>🧠理智:"+(s.stats.sanity||0)+"</div>";d.innerHTML+="<div>🔍疑心:"+(s.stats.suspicion||0)+"</div>";d.innerHTML+="<div>🌑沉沦:"+(s.stats.corruption||0)+"</div>";d.innerHTML+="<div>💰金钱:"+(s.stats.money||0)+"</div>";d.innerHTML+="<div>📊阶段:"+(s.use_stage?s.use_stage.current:1)+"/5</div>";}'
      + 'if(s.time){d.innerHTML+="<div>📅第"+(s.time.day||1)+"天 "+(s.time.hour||8)+":00</div>"}'
      + '}'
      + '});'
      + 'try{window.parent.postMessage({type:"fjb-mvu-stat-request",messageId:-1},"*");}catch(e){}'
      + '<\/script></div></body></html>';
  }

  // ========================================================================
  // 第二十章 事件系统（13+ 事件，对齐星酒 GENERATION_ENDED 等）
  // ========================================================================
  function registerTavernEvents() {
    try {
      const eventOnFn = (typeof eventOn === 'function') ? eventOn :
                        (window.eventOn) ? window.eventOn :
                        (hostWindow().eventOn) ? hostWindow().eventOn : null;
      if (!eventOnFn) { console.warn('[假阴茎卡] eventOn 不可用'); return; }
      // 自动推送 stat_data + 重新注入
      const autoPush = () => {
        setTimeout(() => {
          pushStatDataToStatusBars();
          injectStatusBars().then(() => setTimeout(pushStatDataToStatusBars, 500));
          injectOpeningPages();
          injectOmniUI();
        }, 800);
      };
      // 13+ 事件注册
      const events = [
        'GENERATION_ENDED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED',
        'mag_variable_update_ended', 'generation_started',
        'chat_changed', 'chat_loaded', 'chat_created',
        'message_received', 'message_sent', 'message_deleted',
        'character_changed', 'app_ready',
      ];
      events.forEach(evt => {
        try { eventOnFn(evt, autoPush); } catch (_) {}
      });
      console.log('[假阴茎卡] 事件系统已注册 (' + events.length + ' 事件)');
    } catch (e) {
      console.warn('[假阴茎卡] 注册事件监听失败:', e.message);
    }
  }

  // ========================================================================
  // 第二十一章 postMessage 监听（老式状态栏兼容通道）
  // ========================================================================
  function registerMessageListener() {
    const handler = (event) => {
      if (!event || !event.data) return;
      const data = event.data;
      if (data.type === 'fjb-mvu-stat-request') { pushStatDataToStatusBars(); return; }
      if (data.type === 'fjb-set-theme' && data.theme) {
        setTheme(data.theme);
        applyThemeToStatusBars(data.theme);
      }
      if (data.type === 'fjb-cc-get-state') {
        const state = { switches: getSwitches(), theme: getTheme() };
        try { event.source.postMessage({ type: 'fjb-cc-state', state: state }, event.origin || '*'); } catch (_) {}
      }
      if (data.type === 'fjb-cc-set-switch' && data.key) setSwitch(data.key, !!data.value);
    };
    window.addEventListener('message', handler);
    addDisposer(() => window.removeEventListener('message', handler));
  }

  // ========================================================================
  // 第二十二章 检查云端版本
  // ========================================================================
  async function checkRemoteVersion() {
    const raw = await fetchFromCDN('manifest.json', 4000);
    if (raw) {
      try {
        const m = JSON.parse(raw);
        console.log('[假阴茎卡] 云端版本:', m.version, m.revision);
        return m;
      } catch (_) {}
    }
    return null;
  }

  // ========================================================================
  // 第二十三章 初始化
  // ========================================================================
  async function init() {
    // 销毁旧实例
    destroyPreviousRuntime();
    // DOM 就绪
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }
    await new Promise(r => setTimeout(r, 300));
    // 应用主题
    applyThemeToStatusBars(getTheme());
    // 悬浮球
    ensureBall();
    // 老式注入（兼容保留）
    await injectStatusBars();
    await injectOpeningPages();
    await injectOmniUI();
    await injectBubbleCSS();
    // 事件系统
    registerTavernEvents();
    registerMessageListener();
    injectGenerationPrompts();
    // 首次主动推送
    setTimeout(pushStatDataToStatusBars, 1500);
    // 检查云端版本
    checkRemoteVersion().then(m => {
      if (m && m.version && m.version !== RT_VERSION) console.log('[假阴茎卡] 云端有新版本:', m.version);
    });
    // 定期检查（悬浮球 + 新挂载点 + 数据推送兜底）
    const intervalId = setInterval(() => {
      const sw = getSwitches();
      if (sw.floatball) {
        const root = hostDocument();
        if (!root.getElementById(BALL_ID)) ensureBall();
      }
      injectStatusBars();
      injectOpeningPages();
      injectOmniUI();
      pushStatDataToStatusBars();
    }, 2000);
    addDisposer(() => clearInterval(intervalId));
    console.log('[假阴茎卡] 控制中心 v' + VERSION + ' 初始化完成, runtime:', RT_VERSION, 'owner:', runtimeOwner.id);
  }

  // ========================================================================
  // 第二十四章 导出 destroy 接口（供下次实例化时销毁旧实例）
  // ========================================================================
  const api = {
    version: VERSION,
    destroy() {
      runAllDisposers();
      resetHudLoad();
      try { delete hostWindow()[BRIDGE_KEY]; } catch (_) {}
      try { delete hostWindow().FjbControlCenter; } catch (_) {}
      console.log('[假阴茎卡] 控制中心 v' + VERSION + ' 已销毁');
    },
    openHudPanel,
    closeHudPanel,
    togglePanel,
    pushStatDataToStatusBars,
    getSwitches,
    setSwitch,
    getTheme,
    setTheme,
  };
  hostWindow().FjbControlCenter = api;

  // 启动
  init().catch(e => console.error('[假阴茎卡] 控制中心初始化失败:', e));
})();

// 导出空对象（酒馆助手脚本规范）
export {};
