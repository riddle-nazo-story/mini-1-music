// SE再生

function playSE(type){

const audio = new Audio("audio/"+type+".mp3")

audio.currentTime = 0

audio.play()

}


// 音量変更（スマホ対応）

function setVolume(id,value){

const audio = document.getElementById(id)

audio.volume = parseFloat(value)

}


// タイマー

let time = 900
let timer = null

function updateDisplay(){

let m = Math.floor(time/60)
let s = time%60

if(s<10)s="0"+s

document.getElementById("time").innerText = m + ":" + s

}

function startTimer(){

if(timer)return

timer = setInterval(()=>{

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
