const storageKey = "wxyy-5-luogujing-version-console";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const steps = 16;

function blankScore() {
  return {
    bpm: 96,
    loop: "",
    notes: [],
    pattern: instruments.map((instrument) => Array.from({ length: steps }, (_, index) => index % 4 === 0 ? instrument.token : ""))
  };
}

function cloneScore(score) {
  return {
    bpm: score.bpm,
    loop: score.loop,
    notes: [...score.notes],
    pattern: score.pattern.map((row) => [...row])
  };
}

function keyOf(piece, banshi) {
  return `${(piece || "").trim() || "未命名剧目"}::${banshi}`;
}

const state = JSON.parse(localStorage.getItem(storageKey) || "null") || {
  currentKey: keyOf("出场锣鼓-慢起", "慢板"),
  segments: {}
};

function ensureSegment(key) {
  if (!state.segments[key]) {
    state.segments[key] = { draft: blankScore(), locked: null, pending: null, archive: [] };
  }
  return state.segments[key];
}

ensureSegment(state.currentKey);

let timer = null;
let playhead = 0;
let audioContext = null;
let flash = "";

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const archiveList = document.querySelector("#archiveList");
const statusBanner = document.querySelector("#statusBanner");
const pieceName = document.querySelector("#pieceName");
const banshiSelect = document.querySelector("#banshiSelect");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const playBtn = document.querySelector("#playBtn");
const stopBtn = document.querySelector("#stopBtn");
const lockBtn = document.querySelector("#lockBtn");
const trialBtn = document.querySelector("#trialBtn");
const confirmBtn = document.querySelector("#confirmBtn");
const discardBtn = document.querySelector("#discardBtn");

function current() {
  return ensureSegment(state.currentKey);
}

// 编辑目标：有待确认试排稿则改试排稿；未锁定时改排演稿；已锁定且无试排稿时只读
function editTarget(seg) {
  if (seg.pending) return seg.pending;
  if (seg.locked) return null;
  return seg.draft;
}

// 谱面展示：试排稿 > 锁定稿 > 排演稿
function displayScore(seg) {
  return seg.pending || seg.locked || seg.draft;
}

// 演出口径：播放、段落统计、已存方案一律沿用锁定稿；未锁定时才用排演稿
function performanceScore(seg) {
  return seg.locked || seg.draft;
}

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function setFlash(message) {
  flash = message;
}

function beatLabel(index) {
  const measure = Math.floor(index / 4) + 1;
  const beat = (index % 4) + 1;
  return `${measure}-${beat}`;
}

function loopLabel(loop) {
  return loop === "" ? "全段" : `第${Number(loop) + 1}小节`;
}

function renderBanner(seg) {
  const [piece, banshi] = state.currentKey.split("::");
  const status = seg.pending
    ? `待确认试排（首排于 ${new Date(seg.pending.createdAt).toLocaleString()}，重复试排已沿用该稿）`
    : seg.locked
      ? `演出稿已锁定（${new Date(seg.locked.lockedAt).toLocaleString()}），谱面只读，新增试排后方可改动`
      : "排演中，尚未锁定演出稿";
  statusBanner.innerHTML = `
    <strong>${piece} · ${banshi}</strong><span>${status}</span>
    ${flash ? `<em>${flash}</em>` : ""}
  `;
  statusBanner.dataset.state = seg.pending ? "pending" : seg.locked ? "locked" : "draft";
}

function syncFields(seg) {
  const [piece, banshi] = state.currentKey.split("::");
  const score = displayScore(seg);
  const readonly = !editTarget(seg);
  pieceName.value = piece === "未命名剧目" ? "" : piece;
  banshiSelect.value = banshi;
  bpmInput.value = score.bpm;
  loopSelect.value = score.loop;
  bpmInput.disabled = readonly;
  loopSelect.disabled = readonly;
  noteInput.disabled = readonly;
}

function renderGrid(seg) {
  const score = displayScore(seg);
  const readonly = !editTarget(seg);
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) {
    header.push(`<div class="beat-cell">${beatLabel(i)}</div>`);
  }

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    for (let step = 0; step < steps; step += 1) {
      const value = score.pattern[rowIndex][step];
      row.push(`<button class="cell ${value ? "filled" : ""}" type="button" data-row="${rowIndex}" data-step="${step}" ${readonly ? "disabled" : ""}>${value}</button>`);
    }
    return row;
  });

  grid.innerHTML = [...header, ...rows].join("");
  grid.classList.toggle("readonly", readonly);
}

function renderSidebars(seg) {
  const perf = performanceScore(seg);
  const filledByMeasure = [0, 1, 2, 3].map((measure) => {
    const start = measure * 4;
    const count = perf.pattern.flatMap((row) => row.slice(start, start + 4)).filter(Boolean).length;
    return { measure: measure + 1, count };
  });
  structure.innerHTML = `
    <p class="source-tag">${seg.locked ? "按锁定演出稿统计" : "未锁定，按排演稿统计"}</p>
  ` + filledByMeasure.map((item) => `
    <div class="structure-row"><span>第${item.measure}小节</span><strong>${item.count}个口令</strong></div>
  `).join("");

  const shown = displayScore(seg);
  notesList.innerHTML = shown.notes.length ? shown.notes.map((note) => `
    <article class="note"><p>${note}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  archiveList.innerHTML = seg.archive.length ? seg.archive.map((item) => `
    <article class="note archive-item">
      <p>留档于 ${new Date(item.archivedAt).toLocaleString()}<br>${item.bpm}BPM · ${loopLabel(item.loop)} · ${item.notes.length}条批注</p>
    </article>
  `).join("") : "<p>暂无留档。</p>";

  const entries = Object.entries(state.segments);
  savedList.innerHTML = entries.length ? entries.map(([key, item]) => {
    const [piece, banshi] = key.split("::");
    const locked = item.locked;
    const meta = locked
      ? `${locked.bpm}BPM · ${loopLabel(locked.loop)} · ${locked.notes.length}条批注${item.pending ? " · 有待确认试排" : ""}`
      : "未锁定演出稿";
    return `
      <button class="saved-item ${key === state.currentKey ? "current" : ""}" type="button" data-load="${key}" ${locked ? "" : "disabled"}>
        <strong>${piece} · ${banshi}</strong><br><span>${meta}</span>
      </button>
    `;
  }).join("") : "<p>还没有保存方案。</p>";
}

function renderButtons(seg) {
  lockBtn.disabled = !!seg.locked;
  trialBtn.disabled = !seg.locked;
  confirmBtn.disabled = !seg.pending;
  discardBtn.disabled = !seg.pending;
}

function render() {
  const seg = current();
  renderBanner(seg);
  syncFields(seg);
  renderGrid(seg);
  renderSidebars(seg);
  renderButtons(seg);
}

function playSound(instrument) {
  audioContext ||= new AudioContext();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.frequency.value = instrument.freq;
  osc.type = instrument.name === "鼓" ? "sine" : "square";
  gain.gain.setValueAtTime(0.08, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
  osc.connect(gain).connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 0.09);
}

function highlight(step) {
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  document.querySelectorAll(`[data-step="${step}"]`).forEach((cell) => cell.classList.add("playing"));
}

function currentRange() {
  const loop = performanceScore(current()).loop;
  if (loop === "") return [0, steps - 1];
  const start = Number(loop) * 4;
  return [start, start + 3];
}

function tick() {
  const score = performanceScore(current());
  const [start, end] = currentRange();
  if (playhead < start || playhead > end) playhead = start;
  highlight(playhead);
  instruments.forEach((instrument, rowIndex) => {
    if (score.pattern[rowIndex][playhead]) playSound(instrument);
  });
  playhead = playhead >= end ? start : playhead + 1;
}

function stopPlayback() {
  clearInterval(timer);
  timer = null;
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
}

function switchSegment(key) {
  stopPlayback();
  state.currentKey = key;
  ensureSegment(key);
  playhead = 0;
  save();
  render();
}

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const seg = current();
  const target = editTarget(seg);
  if (!target) {
    setFlash("演出稿已锁定，请先「新增试排」再改动谱面。");
    renderBanner(seg);
    return;
  }
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  target.pattern[row][step] = target.pattern[row][step] ? "" : instruments[row].token;
  save();
  render();
});

pieceName.addEventListener("change", () => {
  switchSegment(keyOf(pieceName.value, banshiSelect.value));
});

banshiSelect.addEventListener("change", () => {
  switchSegment(keyOf(pieceName.value, banshiSelect.value));
});

bpmInput.addEventListener("input", () => {
  const target = editTarget(current());
  if (!target) return;
  target.bpm = Number(bpmInput.value || 96);
  save();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / performanceScore(current()).bpm);
  }
});

loopSelect.addEventListener("change", () => {
  const target = editTarget(current());
  if (!target) return;
  target.loop = loopSelect.value;
  playhead = currentRange()[0];
  save();
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim()) return;
  const target = editTarget(current());
  if (!target) return;
  target.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  save();
  renderSidebars(current());
});

playBtn.addEventListener("click", () => {
  if (timer) clearInterval(timer);
  playhead = currentRange()[0];
  tick();
  timer = setInterval(tick, 60000 / performanceScore(current()).bpm);
});

stopBtn.addEventListener("click", stopPlayback);

lockBtn.addEventListener("click", () => {
  const seg = current();
  if (seg.locked) return;
  seg.locked = { ...cloneScore(seg.draft), lockedAt: new Date().toISOString() };
  setFlash("演出稿已锁定，播放、统计与已存方案均以该稿为准。");
  save();
  render();
});

trialBtn.addEventListener("click", () => {
  const seg = current();
  if (!seg.locked) {
    setFlash("请先锁定演出稿，再新增试排。");
  } else if (seg.pending) {
    setFlash("已存在待确认试排稿，本次试排沿用首次记录。");
  } else {
    seg.pending = { ...cloneScore(seg.locked), createdAt: new Date().toISOString() };
    setFlash("已生成待确认试排稿，确认前演出仍按锁定稿开场。");
  }
  save();
  render();
});

confirmBtn.addEventListener("click", () => {
  const seg = current();
  if (!seg.pending) return;
  const conflict = seg.pending.bpm !== seg.locked.bpm || String(seg.pending.loop) !== String(seg.locked.loop);
  if (conflict) {
    seg.pending = null;
    setFlash("试排稿的速度或循环小节与锁定稿冲突，整段拒绝，已保留原演出稿。");
  } else {
    seg.archive.unshift({ ...cloneScore(seg.locked), archivedAt: new Date().toISOString() });
    seg.locked = { ...cloneScore(seg.pending), lockedAt: new Date().toISOString() };
    seg.pending = null;
    setFlash("试排稿已确认为新演出稿，原锁定稿已留档。");
  }
  save();
  render();
});

discardBtn.addEventListener("click", () => {
  const seg = current();
  if (!seg.pending) return;
  seg.pending = null;
  setFlash("已放弃本次试排稿，演出稿保持不变。");
  save();
  render();
});

savedList.addEventListener("click", (event) => {
  const key = event.target.closest("[data-load]")?.dataset.load;
  if (!key || key === state.currentKey) return;
  switchSegment(key);
});

render();
