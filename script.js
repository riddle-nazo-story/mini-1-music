// AudioContext作成（スマホ対応）
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// SE再生（3倍音量）
async function playSE(type){

const response = await fetch("audio/"+type+".mp3");

const arrayBuffer = await response.arrayBuffer();

const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

const source = audioContext.createBufferSource();
source.buffer = audioBuffer;

const gainNode = audioContext.createGain();
gainNode.gain.value = 3; // ← 3倍

source.connect(gainNode);
gainNode.connect(audioContext.destination);

source.start();

}


// 音量変更
function setVolume(id,value){

const audio = document.getElementById(id);

audio.volume = parseFloat(value);

}


// タイマー
let time = 900;
let timer = null;

function updateDisplay(){

let m = Math.floor(time/60);
let s = time%60;

if(s<10)s="0"+s;

document.getElementById("time").innerText = m + ":" + s;

}

function startTimer(){

if(timer)return;

timer = setInterval(()=>{

time--;

updateDisplay();

if(time<=0){

clearInterval(timer);
timer=null;

}

},1000);

}

function stopTimer(){

clearInterval(timer);
timer=null;

}

function resetTimer(){

stopTimer();
time=900;
updateDisplay();

}

updateDisplay();
