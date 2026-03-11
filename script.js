/* script.js — 完全再構築版（WebAudio + フォールバック） */

/* 目的：
 - スマホで確実に音量制御が動作する（unlock required）
 - SE はデコード済みバッファを再生、かつ 3x 増幅（コンプレッサでクリップ防止）
 - BGM/ENDING は MediaElementSource + GainNode で制御（シークバーあり）
 - フォールバック：AudioContext が使えない / MediaElementSource が使えない場合は element.volume を使う
 - 全停止、WakeLock サポート
*/

/* --- 設定 --- */
const SE_GAIN_MULTIPLIER = 3.0; // 正解/不正解/ヒント を何倍にするか（3.0 = 3倍）
const SE_FILES = { correct: 'audio/correct.mp3', wrong: 'audio/wrong.mp3', hint: 'audio/hint.mp3' };
const BGM_FILES = { game: 'audio/game.mp3', ending: 'audio/ending.mp3' };

/* --- DOM --- */
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
const wakeBtn = document.getElementById('requestWake');

/* --- Timer --- */
let time = 900;
let timer = null;
function updateDisplay(){ let m = Math.floor(time/60), s = time%60; if(s<10) s='0'+s; timeEl.textContent = `${m}:${s}`; }
startBtn.onclick = ()=>{ if(timer) return; timer = setInterval(()=>{ time--; updateDisplay(); if(time<=0){ clearInterval(timer); timer=null } },1000) };
stopBtn.onclick = ()=>{ clearInterval(timer); timer=null };
resetBtn.onclick = ()=>{ clearInterval(timer); timer=null; time=900; updateDisplay(); };
updateDisplay();

/* --- WebAudio 状態 --- */
let audioCtx = null;
let seBuffers = {}; // decoded SEs
let bgmGain = { game: null, ending: null };
let bgmSourcesConnected = false;
let compressorNode = null; // global compressor used for SE/bgm chain if desired
let activeSESources = new Set();

/* WakeLock */
let wakeLock = null;

/* --- Helpers --- */
async function fetchArrayBuffer(url){
  const r = await fetch(url, {cache: "no-cache"});
  if(!r.ok) throw new Error('fetch failed: ' + url);
  return await r.arrayBuffer();
}

/* Create / resume AudioContext and setup nodes */
async function createAudioContextAndNodes(){
  if(audioCtx && audioCtx.state === 'running') return;
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  try{ await audioCtx.resume(); }catch(e){ console.warn('resume error', e); }

  // compressor to prevent clipping after gain >1
  compressorNode = audioCtx.createDynamicsCompressor();
  // gentle settings — tuned to avoid harsh limiting but prevent clip
  compressorNode.threshold.setValueAtTime(-6, audioCtx.currentTime);
  compressorNode.knee.setValueAtTime(20, audioCtx.currentTime);
  compressorNode.ratio.setValueAtTime(6, audioCtx.currentTime);
  compressorNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
  compressorNode.release.setValueAtTime(0.25, audioCtx.currentTime);

  // Try to create media element sources for bgm (requires same-origin -> works on GH Pages)
  try{
    const gameSrc = audioCtx.createMediaElementSource(gameAudioEl);
    const endingSrc = audioCtx.createMediaElementSource(endingAudioEl);
    const gameGain = audioCtx.createGain(); gameGain.gain.value = parseFloat(gameVol.value);
    const endingGain = audioCtx.createGain(); endingGain.gain.value = parseFloat(endingVol.value);

    // chain: media -> gain -> compressor -> destination
    gameSrc.connect(gameGain).connect(compressorNode).connect(audioCtx.destination);
    endingSrc.connect(endingGain).connect(compressorNode).connect(audioCtx.destination);

    bgmGain.game = gameGain;
    bgmGain.ending = endingGain;
    bgmSourcesConnected = true;
  }catch(e){
    console.warn('createMediaElementSource failed (CORS/same-origin?). Falling back to element.volume', e);
    bgmSourcesConnected = false;
    // fallback: sliders will set element.volume later
  }
}

/* Preload & decode SEs (called on unlock) */
async function preloadSEs(){
  if(!audioCtx) return;
  const keys = Object.keys(SE_FILES);
  await Promise.all(keys.map(async (k)=>{
    try{
      const ab = await fetchArrayBuffer(SE_FILES[k]);
      const decoded = await audioCtx.decodeAudioData(ab);
      seBuffers[k] = decoded;
    }catch(e){
      console.warn('SE preload failed', k, e);
      seBuffers[k] = null;
    }
  }));
}

/* Play SE via buffer (low-latency, simultaneous) */
function playSEBuffer(key){
  if(audioCtx && seBuffers[key]){
    try{
      const src = audioCtx.createBufferSource();
      src.buffer = seBuffers[key];

      // create gain for this source, multiplied
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = SE_GAIN_MULTIPLIER;

      src.connect(gainNode).connect(compressorNode || audioCtx.destination);

      // start and add to active set so we can stop if needed
      src.start(0);
      activeSESources.add(src);
      // remove when ended
      src.onended = ()=> activeSESources.delete(src);
    }catch(e){
      console.warn('play buffer failed, fallback to element audio', e);
      const a = new Audio(SE_FILES[key]); a.volume = 1.0; a.play().catch(()=>{});
    }
  }else{
    // fallback: play as element (may be delayed on mobile)
    const a = new Audio(SE_FILES[key]);
    // we cannot set >1 volume on elements; amplifier won't work here
    a.volume = 1.0;
    a.play().catch(()=>{});
  }
}

/* Public SE handlers (used by UI) */
btnCorrect.addEventListener('click', ()=> playSEBuffer('correct'));
btnWrong.addEventListener('click', ()=> playSEBuffer('wrong'));
btnHint.addEventListener('click', ()=> playSEBuffer('hint'));

/* Volume sliders: update either GainNode or element.volume */
gameVol.addEventListener('input', (e)=>{
  const v = parseFloat(e.target.value);
  if(bgmSourcesConnected && bgmGain.game && audioCtx){
    bgmGain.game.gain.setValueAtTime(v, audioCtx.currentTime);
  }else{
    gameAudioEl.volume = v;
  }
});
endingVol.addEventListener('input', (e)=>{
  const v = parseFloat(e.target.value);
  if(bgmSourcesConnected && bgmGain.ending && audioCtx){
    bgmGain.ending.gain.setValueAtTime(v, audioCtx.currentTime);
  }else{
    endingAudioEl.volume = v;
  }
});

/* 全停止 */
stopAllBtn.addEventListener('click', ()=>{
  try{ gameAudioEl.pause(); gameAudioEl.currentTime = 0;}catch(e){}
  try{ endingAudioEl.pause(); endingAudioEl.currentTime = 0;}catch(e){}

  // stop active buffer sources
  activeSESources.forEach(src => {
    try{ src.stop(0);}catch(e){}
  });
  activeSESources.clear();

  // quick mute trick if audioCtx running
  if(audioCtx && audioCtx.state === 'running'){
    const tmpGain = audioCtx.createGain();
    tmpGain.gain.value = 0;
    tmpGain.connect(audioCtx.destination);
    setTimeout(()=>{ tmpGain.disconnect(); }, 150);
  }
});

/* Wake Lock request */
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
    console.warn('WakeLock failed', e);
    alert('Wake Lock 要求に失敗しました。ブラウザの許可設定を確認してください。');
  }
});

/* Unlock button handler — must be user gesture */
unlockBtn.addEventListener('click', async ()=>{
  unlockBtn.disabled = true;
  try{
    await createAudioContextAndNodes();
    await preloadSEs();
    // hide overlay only if audio context resumed or fallback
    unlockOverlay.style.display = 'none';
    // ensure sliders effect even if bgmSources not connected
    if(!bgmSourcesConnected){
      gameVol.dispatchEvent(new Event('input'));
      endingVol.dispatchEvent(new Event('input'));
    }
  }catch(e){
    console.warn('unlock flow error', e);
    unlockBtn.disabled = false;
  }
});

/* Also attempt a background unlock on first touch for UX (won't hide overlay) */
window.addEventListener('touchstart', function onceTouch(){
  if(!audioCtx || audioCtx.state !== 'running'){
    createAudioContextAndNodes().catch(()=>{});
  }
  window.removeEventListener('touchstart', onceTouch);
});

/* Fallback for browsers without AudioContext — hide overlay and wire sliders to element.volume */
(function checkFallback(){
  if(!window.AudioContext && !window.webkitAudioContext){
    unlockOverlay.style.display = 'none';
    audioCtx = null;
    bgmSourcesConnected = false;
    // wire sliders to element.volume
    gameVol.addEventListener('input', (e)=> { gameAudioEl.volume = parseFloat(e.target.value); });
    endingVol.addEventListener('input', (e)=> { endingAudioEl.volume = parseFloat(e.target.value); });
  }
})();

/* Optional debug helper */
window.__audioDebug = ()=>({
  audioCtxState: audioCtx ? audioCtx.state : 'no-audioctx',
  bgmSourcesConnected,
  seBuffersLoaded: Object.keys(seBuffers).filter(k => seBuffers[k])
});
