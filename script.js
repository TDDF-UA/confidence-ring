// Points at the model.json/weights.bin/metadata.json committed in
// this repo's /model folder.
const MODEL_URL = "./model/";

const CONFIDENCE_THRESHOLD = 0.75;   // don't announce low-confidence guesses
const STABLE_FRAMES_NEEDED = 5;      // require a few consistent frames before speaking
const REPEAT_COOLDOWN_MS = 2500;     // don't re-announce the same class too often

const RING_CIRCUMFERENCE = 2 * Math.PI * 88; // matches the r=88 circle in index.html

const startScreen = document.getElementById("start-screen");
const startBtn = document.getElementById("start-btn");
const startError = document.getElementById("start-error");
const restartBtn = document.getElementById("restart-btn");
const repeatBtn = document.getElementById("repeat-btn");
const guessEl = document.getElementById("guess");
const confidenceEl = document.getElementById("confidence");
const hintText = document.getElementById("hint-text");
const statusText = document.getElementById("status-text");
const dot = document.getElementById("dot");
const webcam = document.getElementById("webcam");
const ringFill = document.getElementById("ring-fill");
const srAnnounce = document.getElementById("sr-announce");

let model, running = false, currentStream = null;
let candidateClass = null, candidateStreak = 0;
let lastSpokenClass = null, lastSpokenAt = 0;

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
  srAnnounce.textContent = text;
}

function describeError(err) {
  if (err && err.name === "NotAllowedError") {
    return "Camera access was blocked. Allow camera access in your browser settings, then try again.";
  }
  if (err && err.name === "NotFoundError") {
    return "No camera was found on this device.";
  }
  if (err && err.name === "NotReadableError") {
    return "The camera is being used by another app. Close it, then try again.";
  }
  return "Something went wrong starting the camera. Try again.";
}

function stopCamera() {
  running = false;
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
}

// Fills the ring from empty (streak 0) to full (streak >= STABLE_FRAMES_NEEDED).
// Called on every frame of loop() so the user can see "how close" the
// system is, not just a binary sure/not-sure state.
function updateRing(streak, confirmed) {
  const progress = Math.max(0, Math.min(1, streak / STABLE_FRAMES_NEEDED));
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  ringFill.style.strokeDashoffset = String(offset);
  ringFill.classList.toggle("confirmed", confirmed);
}

function resetRing() {
  ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
  ringFill.classList.remove("confirmed");
}

async function init() {
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";
  startError.textContent = "";
  statusText.textContent = "Loading model…";

  try {
    if (!model) {
      model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
    }

    // "ideal" (not "exact") so this still works on a laptop with only
    // one camera — it just falls back gracefully there.
    currentStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });
    webcam.srcObject = currentStream;
    await webcam.play();

    try {
      if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
    } catch (e) { /* not critical if unsupported — screen may just dim on long use */ }

    running = true;
    dot.classList.add("live");
    statusText.textContent = "Listening…";
    repeatBtn.hidden = false;
    restartBtn.hidden = false;
    startScreen.hidden = true;

    requestAnimationFrame(loop);
  } catch (err) {
    dot.classList.remove("live");
    statusText.textContent = "Point your camera at an object";
    startBtn.disabled = false;
    startBtn.textContent = "Start listening";
    startError.textContent = describeError(err);
  }
}

async function loop() {
  if (!running) return;
  const predictions = await model.predict(webcam);
  predictions.sort((a, b) => b.probability - a.probability);
  const top = predictions[0];

  const confident = top.probability >= CONFIDENCE_THRESHOLD;
  guessEl.textContent = confident ? top.className : "…";
  confidenceEl.textContent = confident
    ? Math.round(top.probability * 100) + "% sure"
    : "Not sure yet — hold it steadier or closer";

  if (confident) {
    if (top.className === candidateClass) {
      candidateStreak++;
    } else {
      candidateClass = top.className;
      candidateStreak = 1;
    }

    const now = Date.now();
    const stableEnough = candidateStreak >= STABLE_FRAMES_NEEDED;
    const changedOrCooldownPassed =
      candidateClass !== lastSpokenClass || now - lastSpokenAt > REPEAT_COOLDOWN_MS * 4;

    updateRing(candidateStreak, stableEnough);

    if (stableEnough) {
      hintText.textContent = "";
    } else if (candidateStreak > 0) {
      hintText.textContent = "Hold steady, almost there…";
    }

    if (stableEnough && changedOrCooldownPassed) {
      speak(candidateClass);
      lastSpokenClass = candidateClass;
      lastSpokenAt = now;
      candidateStreak = 0;
      updateRing(0, false);
    }
  } else {
    candidateClass = null;
    candidateStreak = 0;
    hintText.textContent = "";
    updateRing(0, false);
  }

  requestAnimationFrame(loop);
}

startBtn.addEventListener("click", init);

restartBtn.addEventListener("click", () => {
  stopCamera();
  dot.classList.remove("live");
  guessEl.textContent = "…";
  confidenceEl.textContent = "";
  hintText.textContent = "";
  resetRing();
  candidateClass = null;
  candidateStreak = 0;
  init();
});

repeatBtn.addEventListener("click", () => {
  if (lastSpokenClass) speak(lastSpokenClass);
  else if (guessEl.textContent !== "…") speak(guessEl.textContent);
});

window.addEventListener("DOMContentLoaded", () => startBtn.focus());
