
// 効果音
const sounds = {
correct: new Audio("audio/correct.mp3"),
wrong: new Audio("audio/wrong.mp3"),
hint: new Audio("audio/hint.mp3")
}

function playSE(type){

const sound = sounds[type].cloneNode()
sound.play()

}



// タイマー

let time = 900
let timer = null

function updateDisplay(){

let m = Math.floor(time / 60)
let s = time % 60

if(s < 10) s = "0"+s

document.getElementById("time").innerText = m + ":" + s

}

function startTimer(){

if(timer) return

timer = setInterval(()=>{

time--

updateDisplay()

if(time <= 0){
clearInterval(timer)
timer = null
}

},1000)

}

function stopTimer(){

clearInterval(timer)
timer = null

}

function resetTimer(){

stopTimer()
time = 900
updateDisplay()

}

updateDisplay()