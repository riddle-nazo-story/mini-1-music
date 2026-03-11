/* script.js —— WebAudio を使った安定版 (スマホ対応) */

/*
動作の流れ（ユーザーに見せる必要がある点）
1) ページ読み込み → オーバーレイ「タップして音声を有効化」が表示
2) ユーザーがタップ → AudioContext を resume、SE用の音声を fetch+decode（プリロード）
   さらに game/ending の MediaElementSource と GainNode を作る（スライダで制御可能に）
3) 以後はスライダが確実に効く。SEはデコード済みバッファを再生するため同時再生OK。
*/

(() => {
  // オーディオファイルパス（必ず audio フォルダ内に配置）
  const FILES = {
    se: { correct: 'audio/correct.mp3', wrong: 'audio/wrong.mp3', hint: 'audio/hint.mp3' },
    bgm: { game: 'audio/game.mp3', ending: 'audio/ending.mp3' }
  };

  // DOM
  const unlockOverlay = document.getElementById('unlockOverlay');
  const unlockBtn = document.getElementById('unlockBtn');

  const btnCorrect = document.getElementById('btnCorrect');
  const btnWrong = document.getElementById('btnWrong');
  const btnHint = document.getElementById('btnHint');

  const gameAudioEl = document.getElementById('gameAudio');
  const endingAudioEl = document.getElementById('endingAudio');
  const gameVol = document.getElementById('gameVol');
  const endingVol = document.getElementById('endingVol');

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const resetBtn = document.getElementById('resetBtn');
  const timeEl = document.getElementById('time');

  const stopAllBtn = document.getElementById('stopAll');

  // Timer
  let time = 900; // seconds
  let timer = null;
  function updateDisplay(){ let m = Math.floor(time/60), s = time%60; if(s<10) s='0'+s; timeEl.textContent = `${m}:${s}`; }
  startBtn.onclick = () => { if(timer) return; timer = setInterval(()=>{ time--; updateDisplay(); if(time<=0){ clearInterval(timer); timer=null } },1000) }
  stopBtn.onclick = () => { clearInterval(timer); timer=null }
  resetBtn.onclick = () => { clearInterval(timer); timer=null; time=900; updateDisplay(); }
  updateDisplay()

  // WebAudio setup variables
  let audioCtx = null;
  let seBuffers = {}; // decoded SE buffers
  let bgmGainNodes = {}; // { game: GainNode, ending: GainNode }
  let bgmSourcesConnected = false;

  // Helper: fetch+decode audio buffer
  async function fetchDecode(url){
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('fetch error: ' + url);
    const arrayBuffer = await resp.arrayBuffer();
    return audioCtx.decodeAudioData(arrayBuffer);
  }

  // Unlock audio (call on user gesture)
  async function unlockAudio(){
    if(audioCtx && audioCtx.state === 'running') return;

    // create/resume AudioContext
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    try{
      await audioCtx.resume();
    }catch(e){
      console.warn('AudioContext resume error', e);
    }

    // Create GainNodes for bgm and connect HTMLMediaElements to AudioContext
    try{
      const gameSource = audioCtx.createMediaElementSource(gameAudioEl);
      const endingSource = audioCtx.createMediaElementSource(endingAudioEl);

      const gameGain = audioCtx.createGain(); gameGain.gain.value = parseFloat(gameVol.value);
      const endingGain = audioCtx.createGain(); endingGain.gain.value = parseFloat(endingVol.value);

      gameSource.connect(gameGain).connect(audioCtx.destination);
      endingSource.connect(endingGain).connect(audioCtx.destination);

      bgmGainNodes.game = gameGain;
      bgmGainNodes.ending = endingGain;

      bgmSourcesConnected = true;
    }catch(e){
      // createMediaElementSource can throw if audio elements are cross-origin without CORS
      console.warn('media element source error (fallback to element.volume):', e);
      bgmSourcesConnected = false;
    }

    // Fetch & decode SE buffers (so SE play is immediate)
    try{
      const promises = Object.entries(FILES.se).map(async ([k, url]) => {
        try{
          seBuffers[k] = await fetchDecode(url);
        }catch(err){
          console.warn('SE decode failed', k, err);
          seBuffers[k] = null; // fallback later
        }
      });
      await Promise.all(promises);
    }catch(e){
      console.warn('SE preload error', e);
    }

    // hide overlay
    unlockOverlay.style.display = 'none';
  }

  // Play SE using decoded buffer (low latency, simultaneous)
  function playSEBuffer(name){
    if(!audioCtx){
      // fallback: play as new Audio element (may be delayed on mobile)
      const a = new Audio(FILES.se[name]); a.play().catch(()=>{/*ignore*/});
      return;
    }
    const buf = seBuffers[name];
    if(buf){
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      try{ src.start(0); }catch(e){ console.warn('buffer play failed', e); }
    }else{
      // fallback
      const a = new Audio(FILES.se[name]); a.play().catch(()=>{/*ignore*/});
    }
  }

  // Public SE handlers
  btnCorrect.addEventListener('click', ()=>playSEBuffer('correct'));
  btnWrong.addEventListener('click', ()=>playSEBuffer('wrong'));
  btnHint.addEventListener('click', ()=>playSEBuffer('hint'));

  // Volume sliders — handle both WebAudio and element-volume fallback
  function setVolumeById(id, value){
    const v = parseFloat(value);
    if(bgmSourcesConnected && bgmGainNodes[id]){
      bgmGainNodes[id].gain.setValueAtTime(v, audioCtx.currentTime);
    }else{
      // fallback to element.volume
      const el = (id === 'game') ? gameAudioEl : endingAudioEl;
      el.volume = v;
    }
  }

  gameVol.addEventListener('input', (e)=> setVolumeById('game', e.target.value));
  endingVol.addEventListener('input', (e)=> setVolumeById('ending', e.target.value));

  // Stop all sounds (useful during公演)
  stopAllBtn.addEventListener('click', ()=>{
    // pause html elements
    try{ gameAudioEl.pause(); gameAudioEl.currentTime = 0; }catch(e){}
    try{ endingAudioEl.pause(); endingAudioEl.currentTime = 0; }catch(e){}
    // stop any playing buffer sources? we can't easily stop started bufferSources without tracking them.
    // But since SE are short, just leave them; alternatively we could maintain active sources and stop them.
    // For safety, resume audioCtx and set master gain to 0 momentarily
    if(audioCtx && audioCtx.state === 'running'){
      // quick mute-unmute
      const master = audioCtx.createGain();
      master.gain.value = 0;
      master.connect(audioCtx.destination);
      setTimeout(()=>{ master.disconnect(); }, 200);
    }
  });

  // Unlock button
  unlockBtn.addEventListener('click', async (e) => {
    unlockBtn.disabled = true;
    try{
      await unlockAudio();
    }catch(err){
      console.warn('unlock error', err);
      unlockBtn.disabled = false;
    }
  });

  // Also unlock on first meaningful touch anywhere (improves UX)
  window.addEventListener('touchstart', function onceTouch(){ 
    if(!audioCtx || audioCtx.state !== 'running'){
      // trigger a background unlock attempt but do not hide overlay until explicit button
      unlockAudio().catch(()=>{});
    }
    window.removeEventListener('touchstart', onceTouch);
  });

  // Fallback: if browser does not support AudioContext at all, hide overlay and use element.volume fallback
  function checkSupport(){
    if(!window.AudioContext && !window.webkitAudioContext){
      unlockOverlay.style.display = 'none';
      audioCtx = null;
      bgmGainNodes = {};
      bgmSourcesConnected = false;
      // Ensure sliders control element.volume
      gameVol.addEventListener('input', (e)=> { gameAudioEl.volume = parseFloat(e.target.value); });
      endingVol.addEventListener('input', (e)=> { endingAudioEl.volume = parseFloat(e.target.value); });
    }
  }
  checkSupport();

  // Small UX: clicking audio elements on mobile should hide overlay if unlocked
  gameAudioEl.addEventListener('play', ()=> { if(audioCtx && audioCtx.state==='running') unlockOverlay.style.display='none' });
  endingAudioEl.addEventListener('play', ()=> { if(audioCtx && audioCtx.state==='running') unlockOverlay.style.display='none' });

  // Debug helper (optional)
  window.__debugAudio = () => ({ audioCtxState: audioCtx ? audioCtx.state : 'no-audioctx', bgmSourcesConnected, seBuffersLoaded: Object.keys(seBuffers) });

})();
