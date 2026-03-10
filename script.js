// 音声ファイル

const soundFiles = {
correct:"audio/correct.mp3",
wrong:"audio/wrong.mp3",
hint:"audio/hint.mp3"
}

const sounds = {}

// プリロード

window.addEventListener("load",()=>{

for(let key in soundFiles){

const audio = new Audio(soundFiles[key])
audio.preload="auto"

sounds[key]=audio

}

})


// 効果音再生（同時再生）

function playSE(type){

const audio = sounds[type].cloneNode()

audio.currentTime=0

audio.play()

}



// タイマー

let time = 900
let timer = null

function updateDisplay(){

let m = Math.floor(time/60)
let s = time%60

if(s<10)s="0"+s

document.getElementById("time").innerText=m+":"+s

}

function startTimer(){

if(timer)return

timer=setInterval(()=>{

time--

updateDisplay()

if(time<=0){

clearInterval(timer)
timer=null

}

},1000)

}

function stopTimer(){

clearInterval(timer)
timer=null

}

function resetTimer(){

stopTimer()

time=900

updateDisplay()

}

updateDisplay()
