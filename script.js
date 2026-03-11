/* script.js — 頑強版：WebAudio + フォールバック + デバッグUI + 強制アンロック
   そのまま上書きしてください。
   必要な audio ファイル：audio/correct.mp3, wrong.mp3, hint.mp3, game.mp3, ending.mp3
*/

(() => {
  /* 設定 */
  const SE_FILES = { correct: 'audio/correct.mp3', wrong: 'audio/wrong.mp3', hint: 'audio/hint.mp3' };
  const BGM_FILES = { game: 'audio/game.mp3', ending: 'audio/ending.mp3' };
  const SE_GAIN_MULTIPLIER = 3.0;
  const FETCH_TIMEOUT = 9000;

  /* DOMショートカット */
  const byId = id => document.getElementById(id);
  const btnCorrect = byId('btnCorrect'), btnWrong = byId('btnWrong'), btnHint = byId('btnHint');
  const unlockOverlay = byId('unlockOverlay'), unlockBtn = byId('unlockBtn');
  const gameAudioEl = byId('gameAudio'), endingAudioEl = byId('endingAudio');
  const gameVol = byId('gameVol'), endingVol = byId('endingVol');
  const startBtn = byId('startBtn'), stopBtn = byId('stopBtn'), resetBtn = byId('resetBtn'), timeEl = byId('time');
  const stopAllBtn = byId('stopAll'), wakeBtn = byId('requestWake');

  /* デバッグUI */
  function ensureDebugUI(){
    let box = document.getElementById('__audio_debug_box');
    if(box) return box;
    box = document.createElement('div');
    box.id = '__audio_debug_box';
    Object.assign(box.style, {
      position: 'fixed', right: '10px', top: '120px', zIndex: 100000,
      background: 'rgba(0,0,0,0.75)', color:'#fff', padding:'8px', borderRadius:'8px',
      fontSize:'12px', maxWidth:'45vw', maxHeight:'60vh', overflow:'auto'
    });
    document.body.appendChild(box);
    return box;
  }
  const dbg = ensureDebugUI();
  function logDbg(...args){
    console.log(...args);
    const p = document.createElement('div');
    p.textContent = '[' + new Date().toLocaleTimeString() + '] ' + args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    dbg.appendChild(p);
    dbg.scrollTop = dbg.scrollHeight;
  }
  function setStatus(text){
    let s = document.getElementById('__audio_status');
    if(!s){
      s = document.createElement('div'); s.id='__audio_status';
      Object.assign(s.style, {position:'fixed',left:'10px',top:'10px',zIndex:100000,background:'#fff',color:'#111',padding:'10px',borderRadius:'8px',boxShadow:'0 6px 18px rgba(0,0,0,0.18)',fontSize:'14px'});
      document.body.appendChild(s);
      dbg.style.top = '120px';
    }
    s.innerHTML = '<strong>状態</strong><div style="margin-top:6px">'+text+'</div>';
  }

  /* 基本要素チェック */
  if(!btnCorrect || !btnWrong || !btnHint){
    setStatus('UI要素が見つかりません（btnCorrect 等）。index.html を確認してください。');
    logDbg('Missing UI elements. Aborting init.');
    return;
  }

  /* Timer */
  let time = 900, timer = null;
  function updateDisplay(){ let m = Math.floor(time/60), s = time%60; if(s<10) s='0'+s; timeEl.textContent = `${m}:${s}`; }
  startBtn && (startBtn.onclick = ()=>{ if(timer) return; timer = setInterval(()=>{ time--; updateDisplay(); if(time<=0){ clearInterval(timer); timer=null } },1000); });
  stopBtn && (stopBtn.onclick = ()=>{ clearInterval(timer); timer=null; });
  resetBtn && (resetBtn.onclick = ()=>{ clearInterval(timer); timer=null; time=900; updateDisplay(); });
  updateDisplay();

  /* WebAudio state */
  let audioCtx = null;
  let seBuffers = {}; // decoded SE buffers
  let bgmGain = { game: null, ending: null };
  let bgmSourcesConnected = false;
  let compressor = null;
  let activeSE = new Set();

  /* fetch + timeout helper */
  async function fetchArrayBufferWithTimeout(url, timeout = FETCH_TIMEOUT){
    const controller = new AbortController();
    const id = setTimeout(()=> controller.abort(), timeout);
    try{
      const r = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
      clearTimeout(id);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return await r.arrayBuffer();
    }catch(e){
      clearTimeout(id);
      throw e;
    }
  }

  /* Create / resume AudioContext & connect media elements */
  async function createAudioContextAndNodes(){
    if(audioCtx && audioCtx.state === 'running') return audioCtx;
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    try{ await audioCtx.resume(); logDbg('AudioContext resumed'); }catch(e){ logDbg('AudioContext resume failed', e); }
    // compressor for clipping protection
    try{
      compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-6, audioCtx.currentTime);
      compressor.knee.setValueAtTime(20, audioCtx.currentTime);
      compressor.ratio.setValueAtTime(6, audioCtx.currentTime);
      compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
      compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

      // try media element sources (works with GitHub Pages same-origin)
      const gSrc = audioCtx.createMediaElementSource(gameAudioEl);
      const eSrc = audioCtx.createMediaElementSource(endingAudioEl);
      const gGain = audioCtx.createGain(), eGain = audioCtx.createGain();
      gGain.gain.value = parseFloat(gameVol ? gameVol.value : 1);
      eGain.gain.value = parseFloat(endingVol ? endingVol.value : 1);
      gSrc.connect(gGain).connect(compressor).connect(audioCtx.destination);
      eSrc.connect(eGain).connect(compressor).connect(audioCtx.destination);
      bgmGain.game = gGain; bgmGain.ending = eGain;
      bgmSourcesConnected = true;
      logDbg('MediaElementSource connected to AudioContext');
    }catch(e){
      logDbg('MediaElementSource connection failed (CORS/same-origin?)', e);
      bgmSourcesConnected = false;
    }
    return audioCtx;
  }

  /* Preload & decode SEs */
  async function preloadSEs(){
    if(!audioCtx) return;
    setStatus('効果音をプリロード中...');
    const keys = Object.keys(SE_FILES);
    for(const k of keys){
      try{
        logDbg('fetching', SE_FILES[k]);
        const ab = await fetchArrayBufferWithTimeout(SE_FILES[k]);
        const decoded = await audioCtx.decodeAudioData(ab.slice(0));
        seBuffers[k] = decoded;
        logDbg('decoded', k, decoded.length + ' samples');
      }catch(e){
        seBuffers[k] = null;
        logDbg('SE preload failed for', k, e.toString());
      }
    }
    setStatus('プリロード完了（失敗したものはフォールバック再生になります）');
  }

  /* Play SE (buffer preferred, fallback element) */
  function playSE(name){
    if(audioCtx && seBuffers[name]){
      try{
        const src = audioCtx.createBufferSource();
        src.buffer = seBuffers[name];
        const gain = audioCtx.createGain(); gain.gain.value = SE_GAIN_MULTIPLIER;
        src.connect(gain).connect(compressor || audioCtx.destination);
        src.start(0);
        activeSE.add(src);
        src.onended = ()=> activeSE.delete(src);
        logDbg('SE played (buffer)', name);
        return;
      }catch(e){
        logDbg('buffer playback failed', e);
      }
    }
    // fallback
    try{
      const a = new Audio(SE_FILES[name]);
      a.volume = 1.0;
      a.play().then(()=> logDbg('SE played (element) fallback', name)).catch(err=> logDbg('SE element play rejected', err));
    }catch(e){
      logDbg('SE fallback creation failed', e);
    }
  }

  /* Bind UI buttons robustly (click + touchstart) */
  function bindButtons(){
    const bind = (elm, fn) => {
      if(!elm) return;
      elm.removeEventListener('click', fn); elm.addEventListener('click', fn);
      elm.removeEventListener('touchstart', fn); elm.addEventListener('touchstart', (ev)=>{ ev.preventDefault(); fn(); });
    };
    bind(btnCorrect, ()=> playSE('correct'));
    bind(btnWrong, ()=> playSE('wrong'));
    bind(btnHint, ()=> playSE('hint'));
    if(stopAllBtn) stopAllBtn.addEventListener('click', stopAllAudio);
    logDbg('buttons bound');
  }

  /* stop everything */
  function stopAllAudio(){
    try{ gameAudioEl.pause(); gameAudioEl.currentTime = 0; }catch(e){}
    try{ endingAudioEl.pause(); endingAudioEl.currentTime = 0; }catch(e){}
    activeSE.forEach(s => { try{ s.stop(); }catch(e){} });
    activeSE.clear();
    logDbg('stopAll invoked');
  }

  /* Volume sliders */
  if(gameVol){
    gameVol.addEventListener('input', (e)=>{
      const v = parseFloat(e.target.value);
      if(bgmSourcesConnected && bgmGain.game && audioCtx){
        bgmGain.game.gain.setValueAtTime(v, audioCtx.currentTime);
      }else{
        try{ gameAudioEl.volume = v; }catch(e){ logDbg('gameAudioEl.volume set failed', e); }
      }
    });
  }
  if(endingVol){
    endingVol.addEventListener('input', (e)=>{
      const v = parseFloat(e.target.value);
      if(bgmSourcesConnected && bgmGain.ending && audioCtx){
        bgmGain.ending.gain.setValueAtTime(v, audioCtx.currentTime);
      }else{
        try{ endingAudioEl.volume = v; }catch(e){ logDbg('endingAudioEl.volume set failed', e); }
      }
    });
  }

  /* Wake Lock support */
  let wakeLock = null;
  if(wakeBtn){
    wakeBtn.addEventListener('click', async ()=>{
      if(typeof navigator.wakeLock === 'undefined'){
        alert('Wake Lock API がサポートされていません。');
        return;
      }
      try{
        wakeLock = await navigator.wakeLock.request('screen');
        wakeBtn.textContent = 'スリープ防止：オン';
        wakeLock.addEventListener('release', ()=> { wakeBtn.textContent = '画面スリープ防止をオン'; });
      }catch(e){
        logDbg('WakeLock request failed', e);
        alert('Wake Lock 要求に失敗しました。ブラウザの許可設定を確認してください。');
      }
    });
  }

  /* Unlock flow (ユーザー操作要) */
  async function unlockFlow(){
    setStatus('音声有効化中...');
    try{
      await createAudioContextAndNodes();
      await preloadSEs();
      setStatus('音声が有効になりました。ボタンで再生を確認してください。');
      if(unlockOverlay) unlockOverlay.style.display = 'none';
      logDbg('unlockFlow finished');
    }catch(e){
      logDbg('unlockFlow error', e);
      setStatus('音声有効化に失敗しました（デバッグ参照）。フォールバックで試します。');
      if(unlockOverlay) unlockOverlay.style.display = 'none';
    }
  }

  /* unlock button handler with silent oscillator trick */
  if(unlockBtn){
    unlockBtn.addEventListener('click', async function(){
      this.disabled = true;
      try{
        // create/resume context and play silent oscillator to ensure mobile unlock
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();
        try{
          const osc = audioCtx.createOscillator();
          const g = audioCtx.createGain(); g.gain.value = 0;
          osc.connect(g); g.connect(audioCtx.destination);
          osc.start(); osc.stop(audioCtx.currentTime + 0.02);
        }catch(e){ logDbg('silent oscillator failed', e); }
        await unlockFlow();
      }catch(err){
        logDbg('unlockBtn handler failed', err);
        this.disabled = false;
        alert('音声有効化に失敗しました。コンソールのエラーを確認してください。');
      }
    });
  } else {
    logDbg('unlockBtn not found in DOM');
  }

  /* Auto attempt resume on first touch for UX (does not hide overlay) */
  window.addEventListener('touchstart', async function once(){
    if(!audioCtx || (audioCtx && audioCtx.state !== 'running')){
      try{
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();
        logDbg('background AudioContext resume attempted on touchstart');
      }catch(e){
        logDbg('background resume failed', e);
      }
    }
    window.removeEventListener('touchstart', once);
  });

  /* Strong-force snippet available via console for emergency (user can run if unlock button won't respond) */
  window.__forceUnlockAudio = async function(){
    try{
      window._forcedAudioCtx = window._forcedAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
      await window._forcedAudioCtx.resume();
      const o = window._forcedAudioCtx.createOscillator();
      const g = window._forcedAudioCtx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(window._forcedAudioCtx.destination);
      o.start(); o.stop(window._forcedAudioCtx.currentTime + 0.02);
      if(unlockOverlay) unlockOverlay.style.display = 'none';
      logDbg('force unlock succeeded');
      return true;
    }catch(e){
      logDbg('force unlock failed', e);
      return false;
    }
  };

  /* Debug quick test buttons (fetch test) */
  (function addTestButtons(){
    const box = dbg;
    const wrap = document.createElement('div');
    wrap.style.marginTop = '8px';
    wrap.innerHTML = '<div style="font-weight:bold;margin-bottom:6px">テスト操作</div>';
    Object.entries(SE_FILES).forEach(([k,url])=>{
      const b = document.createElement('button');
      b.textContent = 'fetch SE: ' + k;
      b.style.display='block'; b.style.margin='4px 0'; b.style.padding='6px';
      b.onclick = async ()=>{ logDbg('fetch test', url); try{ const ab = await fetchArrayBufferWithTimeout(url, 8000); logDbg('fetch ok, size=' + ab.byteLength); }catch(e){ logDbg('fetch failed', e.toString()); } };
      wrap.appendChild(b);
    });
    Object.entries(BGM_FILES).forEach(([k,url])=>{
      const b = document.createElement('button');
      b.textContent = 'fetch BGM: ' + k;
      b.style.display='block'; b.style.margin='4px 0'; b.style.padding='6px';
      b.onclick = async ()=>{ logDbg('fetch', url); try{ const ab = await fetchArrayBufferWithTimeout(url, 8000); logDbg('fetch ok, size=' + ab.byteLength); }catch(e){ logDbg('fetch failed', e.toString()); } };
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
  })();

  /* Final init */
  bindButtons();
  setStatus('準備完了。最初に「タップして音声を有効化」を押すか画面を一度タップしてください。デバッグ欄にログが出ます。');

  /* Utility export for debugging in console */
  window.__audioDebug = () => ({
    audioCtxState: audioCtx ? audioCtx.state : 'no-audioctx',
    bgmSourcesConnected,
    seBuffersLoaded: Object.keys(seBuffers).filter(k => seBuffers[k])
  });

})();
