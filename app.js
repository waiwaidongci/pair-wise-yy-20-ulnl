const storageKey = "wxyy-4-luogujing-desk-v2";
const legacyStorageKey = "wxyy-4-luogujing-grid";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const modes = ["慢板", "原板", "快板", "流水", "摇板", "散板"];
const steps = 16;

// ---- 数据模型 ----------------------------------------------------------
// state.segments：每段由「剧目 + 板式」唯一确定
//   key: {
//     piece, mode,
//     locked:  演出稿（锁定后存在）—— 播放 / 段落统计 / 已存方案一律以此为准
//     pending: 待确认试排稿，至多一份；重复试排沿用首次记录
//     archive: 每次确认替换时，旧锁定稿原样留档
//     version: 演出稿版本号
//   }
// ctx：当前入口（持久化，保证刷新后各入口一致）
let state = loadState();
let ctx = state.ctx;

function defaultPattern() {
  return instruments.map((instrument) =>
    Array.from({ length: steps }, (_, index) => index % 4 === 0 ? instrument.token : "")
  );
}

function freshDraft(extra = {}) {
  return {
    bpm: 96,
    loop: "",
    notes: [],
    pattern: defaultPattern(),
    ...extra
  };
}

function segmentKey(piece, mode) {
  return `${piece}@@${mode}`;
}

function loadState() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(storageKey) || "null");
  } catch {
    stored = null;
  }
  if (stored && stored.segments) {
    stored.ctx ||= { piece: "", mode: modes[0], view: "working" };
    return stored;
  }

  // 迁移旧版单一全局草稿：作为尚未锁定的工作稿
  let legacy = null;
  try {
    legacy = JSON.parse(localStorage.getItem(legacyStorageKey) || "null");
  } catch {
    legacy = null;
  }

  const piece = (legacy?.pieceName || "出场锣鼓-慢起").split("-")[0] || "出场锣鼓";
  const mode = modes.includes(legacy?.pieceName?.split("-")[1])
    ? legacy.pieceName.split("-")[1]
    : modes[0];
  const draft = freshDraft({
    bpm: legacy?.bpm || 96,
    loop: legacy?.loop ?? "",
    notes: legacy?.notes || [],
    pattern: legacy?.pattern || defaultPattern()
  });

  return {
    segments: {
      [segmentKey(piece, mode)]: {
        piece,
        mode,
        working: draft,
        locked: null,
        pending: null,
        archive: [],
        version: 0
      }
    },
    ctx: { piece, mode, view: "working" }
  };
}

function save() {
  state.ctx = ctx;
  localStorage.setItem(storageKey, JSON.stringify(state));
}

// ---- 视图选择 ----------------------------------------------------------
const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const archiveList = document.querySelector("#archiveList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceInput = document.querySelector("#pieceInput");
const modeSelect = document.querySelector("#modeSelect");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const statusBadge = document.querySelector("#statusBadge");
const playSource = document.querySelector("#playSource");
const viewBanner = document.querySelector("#viewBanner");
const structureSource = document.querySelector("#structureSource");
const notesSource = document.querySelector("#notesSource");
const pieceList = document.querySelector("#pieceList");
const messageBox = document.querySelector("#message");

const lockBtn = document.querySelector("#lockBtn");
const trialBtn = document.querySelector("#trialBtn");
const confirmBtn = document.querySelector("#confirmBtn");
const discardBtn = document.querySelector("#discardBtn");

function currentSegment() {
  return state.segments[segmentKey(ctx.piece, ctx.mode)] || null;
}

// 当前屏幕上看到的草稿（可能未锁定 / 待确认 / 锁定稿只读）
function viewDraft() {
  const segment = currentSegment();
  if (!segment) return null;
  if (ctx.view === "pending") return segment.pending;
  if (segment.locked) return segment.locked;
  return segment.working;
}

// 演出口径：锁定稿优先；尚未锁定的新段落退回工作稿，避免无谱可播
function performanceDraft() {
  const segment = currentSegment();
  if (!segment) return null;
  return segment.locked || segment.working;
}

function isEditable() {
  const segment = currentSegment();
  if (!segment) return true;
  if (!segment.locked) return true;            // 未锁定：工作稿可编
  return ctx.view === "pending" && segment.pending; // 锁定后：只有待确认稿可编
}

// ---- 通用渲染 ----------------------------------------------------------
function beatLabel(index) {
  return `${Math.floor(index / 4) + 1}-${(index % 4) + 1}`;
}

function loopLabel(loop) {
  return loop === "" ? "全段" : `第${Number(loop) + 1}小节`;
}

function cloneDraft(draft) {
  return {
    ...draft,
    notes: [...draft.notes],
    pattern: draft.pattern.map((row) => [...row])
  };
}

function flashMessage(text, type = "info") {
  messageBox.textContent = text;
  messageBox.className = `message ${type}`;
  messageBox.hidden = false;
  clearTimeout(flashMessage.timer);
  flashMessage.timer = setTimeout(() => {
    messageBox.hidden = true;
  }, 3600);
}

function renderGrid() {
  const draft = viewDraft();
  const editable = isEditable();
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) header.push(`<div class="beat-cell">${beatLabel(i)}</div>`);

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    for (let step = 0; step < steps; step += 1) {
      const value = draft ? draft.pattern[rowIndex][step] : "";
      row.push(
        `<button class="cell ${value ? "filled" : ""}" type="button" ` +
        `data-row="${rowIndex}" data-step="${step}" ${editable ? "" : "disabled"}>${value}</button>`
      );
    }
    return row;
  });

  grid.classList.toggle("readonly", !editable);
  grid.innerHTML = [...header, ...rows].join("");
}

function measureCounts(draft) {
  return [0, 1, 2, 3].map((measure) => {
    const start = measure * 4;
    const count = draft.pattern
      .flatMap((row) => row.slice(start, start + 4))
      .filter(Boolean).length;
    return { measure: measure + 1, count };
  });
}

function renderStructure() {
  // 段落统计永远沿用锁定演出稿
  const perf = performanceDraft();
  const segment = currentSegment();
  structureSource.textContent = segment?.locked
    ? `（${segment.locked.bpm}BPM · ${loopLabel(segment.locked.loop)} · 锁定演出稿）`
    : "（尚未锁定，暂按工作稿统计）";
  structure.innerHTML = measureCounts(perf).map((item) => `
    <div class="structure-row"><span>第${item.measure}小节</span><strong>${item.count}个口令</strong></div>
  `).join("");
}

function renderNotes() {
  const segment = currentSegment();
  const draft = viewDraft();
  notesSource.textContent = segment?.locked
    ? (ctx.view === "pending" ? "（试排稿，未进演出）" : "（锁定演出稿）")
    : "";
  notesList.innerHTML = draft?.notes?.length
    ? draft.notes.map((note) => `<article class="note"><p>${note}</p></article>`).join("")
    : "<p>暂无批注。</p>";
}

function renderSaved() {
  // 已存方案：每段一份，取锁定演出稿
  const list = Object.values(state.segments)
    .filter((segment) => segment.locked)
    .sort((a, b) => a.piece.localeCompare(b.piece, "zh") || a.mode.localeCompare(b.mode, "zh"));

  pieceList.innerHTML = Object.values(state.segments)
    .map((segment) => `<option value="${segment.piece}"></option>`)
    .join("");

  savedList.innerHTML = list.length ? list.map((segment) => {
    const active = segmentKey(segment.piece, segment.mode) === segmentKey(ctx.piece, ctx.mode);
    return `
      <button class="saved-item ${active ? "active" : ""}" type="button" data-load="${segmentKey(segment.piece, segment.mode)}">
        <strong>${segment.piece} · ${segment.mode}</strong>
        <span>v${segment.version} · ${segment.locked.bpm}BPM · ${loopLabel(segment.locked.loop)} · ${segment.locked.notes.length}条批注${segment.pending ? " · 有试排" : ""}</span>
      </button>`;
  }).join("") : "<p>还没有锁定的演出稿。</p>";
}

function renderArchive() {
  const segment = currentSegment();
  const records = segment?.archive || [];
  archiveList.innerHTML = records.length ? records.map((record) => `
    <div class="archive-item">
      <strong>v${record.version}</strong>
      <span>${record.bpm}BPM · ${loopLabel(record.loop)}</span>
      <time>${formatTime(record.archivedAt)}</time>
    </div>
  `).join("") : "<p>暂无替换留档。</p>";
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderChrome() {
  const segment = currentSegment();
  pieceInput.value = ctx.piece;
  modeSelect.value = modes.includes(ctx.mode) ? ctx.mode : modes[0];

  const draft = viewDraft();
  bpmInput.value = draft ? draft.bpm : 96;
  loopSelect.value = draft ? draft.loop : "";

  const editable = isEditable();
  bpmInput.disabled = !editable;
  loopSelect.disabled = !editable;
  noteInput.disabled = !editable;
  noteInput.placeholder = editable
    ? "如：第2小节小锣晚半拍，回车提交"
    : "锁定稿只读；如需调整请先新增试排";

  // 状态徽标 / 横幅 / 按钮
  lockBtn.hidden = true;
  trialBtn.hidden = true;
  confirmBtn.hidden = true;
  discardBtn.hidden = true;

  if (!segment) {
    statusBadge.textContent = "新段落（未锁定）";
    statusBadge.className = "badge working";
    viewBanner.textContent = "新段落工作稿：编辑后锁定为演出稿，锁定前不进入演出口径。";
    viewBanner.className = "view-banner working";
    lockBtn.hidden = false;
  } else if (!segment.locked) {
    statusBadge.textContent = "工作稿（未锁定）";
    statusBadge.className = "badge working";
    viewBanner.textContent = `${segment.piece} · ${segment.mode} 工作稿——尚未锁定，演出不会以此开场。`;
    viewBanner.className = "view-banner working";
    lockBtn.hidden = false;
  } else if (ctx.view === "pending" && segment.pending) {
    statusBadge.textContent = "待确认试排稿";
    statusBadge.className = "badge pending";
    viewBanner.textContent =
      `${segment.piece} · ${segment.mode} 试排稿——播放 / 统计 / 已存方案仍按锁定稿 v${segment.version} 执行；` +
      `确认时若速度或循环小节冲突，将整段拒绝并保留原稿。`;
    viewBanner.className = "view-banner pending";
    confirmBtn.hidden = false;
    discardBtn.hidden = false;
  } else {
    statusBadge.textContent = `锁定演出稿 v${segment.version}`;
    statusBadge.className = "badge locked";
    viewBanner.textContent = segment.pending
      ? `正在查看锁定演出稿 v${segment.version}；存在一份待确认试排稿，播放与统计仍用本稿。`
      : `锁定演出稿 v${segment.version}：播放、段落统计、已存方案以此为准。`;
    viewBanner.className = "view-banner locked";
    trialBtn.hidden = false;
  }

  const perf = performanceDraft();
  playSource.textContent = segment?.locked
    ? `播放来源：锁定稿 v${segment.locked.version}（${segment.locked.bpm}BPM）`
    : "播放来源：工作稿（尚未锁定）";

  lockBtn.disabled = !!(draft && (!ctx.piece.trim() || !ctx.mode));
}

function render() {
  renderChrome();
  renderGrid();
  renderStructure();
  renderNotes();
  renderSaved();
  renderArchive();
}

// ---- 入口切换 ----------------------------------------------------------
function openSegment(piece, mode, view = null) {
  stopPlayback();
  const trimmed = piece.trim();
  if (!trimmed) {
    flashMessage("请先填写剧目，段落由剧目与板式唯一确定。", "error");
    return;
  }
  const key = segmentKey(trimmed, mode);
  if (!state.segments[key]) {
    state.segments[key] = {
      piece: trimmed,
      mode,
      working: freshDraft(),
      locked: null,
      pending: null,
      archive: [],
      version: 0
    };
  }
  ctx.piece = trimmed;
  ctx.mode = mode;
  const segment = state.segments[key];
  ctx.view = view || (segment.locked ? "locked" : "working");
  save();
  render();
}

document.querySelector("#openSegmentBtn").addEventListener("click", () => {
  openSegment(pieceInput.value, modeSelect.value);
});

[pieceInput, modeSelect].forEach((el) => {
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter") openSegment(pieceInput.value, modeSelect.value);
  });
});

modeSelect.addEventListener("change", () => openSegment(pieceInput.value, modeSelect.value));

savedList.addEventListener("click", (event) => {
  const key = event.target.closest("[data-load]")?.dataset.load;
  if (!key) return;
  const [piece, mode] = key.split("@@");
  openSegment(piece, mode, "locked");
});

// ---- 版本操作 ----------------------------------------------------------
lockBtn.addEventListener("click", () => {
  const key = segmentKey(ctx.piece, ctx.mode);
  let segment = state.segments[key];
  if (!segment) {
    openSegment(ctx.piece, ctx.mode);
    segment = state.segments[key];
  }
  if (segment.locked) return;
  const source = segment.working;
  segment.locked = { ...cloneDraft(source), version: 1, lockedAt: new Date().toISOString() };
  segment.version = 1;
  segment.working = null;
  ctx.view = "locked";
  save();
  render();
  flashMessage(`已锁定《${segment.piece} · ${segment.mode}》演出稿 v1，播放 / 统计 / 已存方案统一改用此稿。`, "ok");
});

trialBtn.addEventListener("click", () => {
  const segment = currentSegment();
  if (!segment?.locked) return;
  if (segment.pending) {
    // 重复试排沿用首次记录，不再生成新稿
    ctx.view = "pending";
    save();
    render();
    flashMessage("已存在待确认稿，沿用首次试排记录继续修改；确认前演出稿不受影响。", "info");
    return;
  }
  // 锁定后新增试排：只生成一份待确认稿（从锁定稿复制）
  segment.pending = cloneDraft(segment.locked);
  segment.pending.createdAt = new Date().toISOString();
  ctx.view = "pending";
  save();
  render();
  flashMessage("已生成一份待确认试排稿；播放与统计仍按锁定演出稿执行。", "info");
});

confirmBtn.addEventListener("click", () => {
  const segment = currentSegment();
  if (!segment?.locked || !segment.pending) return;
  const locked = segment.locked;
  const pending = segment.pending;

  // 合并校验：速度或循环小节任一冲突，整段拒绝并保留原稿
  if (pending.bpm !== locked.bpm || pending.loop !== locked.loop) {
    const conflicts = [];
    if (pending.bpm !== locked.bpm) conflicts.push(`速度 ${locked.bpm}BPM → ${pending.bpm}BPM`);
    if (pending.loop !== locked.loop) conflicts.push(`循环小节 ${loopLabel(locked.loop)} → ${loopLabel(pending.loop)}`);
    flashMessage(`合并被整段拒绝：${conflicts.join("、")} 与锁定稿冲突，已保留原稿与试排稿，请调整后再确认。`, "error");
    return;
  }

  // 旧锁定稿原样留档，再以待确认稿替换
  const archived = { ...cloneDraft(locked), archivedAt: new Date().toISOString() };
  segment.archive.unshift(archived);
  const nextVersion = segment.version + 1;
  segment.locked = {
    ...cloneDraft(pending),
    version: nextVersion,
    lockedAt: new Date().toISOString()
  };
  segment.version = nextVersion;
  segment.pending = null;
  ctx.view = "locked";
  save();
  render();
  flashMessage(`试排已确认，演出稿更新为 v${nextVersion}；旧稿 v${archived.version} 已留档。`, "ok");
});

discardBtn.addEventListener("click", () => {
  const segment = currentSegment();
  if (!segment?.pending) return;
  segment.pending = null;
  ctx.view = "locked";
  save();
  render();
  flashMessage("已放弃试排稿，锁定演出稿保持不变。", "info");
});

// ---- 编辑（只作用于可编草稿：工作稿 / 待确认稿） -------------------------
grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || !isEditable()) return;
  const draft = viewDraft();
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  draft.pattern[row][step] = draft.pattern[row][step] ? "" : instruments[row].token;
  save();
  renderGrid();
  renderStructure(); // 未锁定时统计随工作稿；锁定后统计取锁定稿，不受影响
});

bpmInput.addEventListener("input", () => {
  if (!isEditable()) return;
  const draft = viewDraft();
  draft.bpm = Number(bpmInput.value || 96);
  save();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / performanceDraft().bpm);
  }
});

loopSelect.addEventListener("change", () => {
  if (!isEditable()) return;
  const draft = viewDraft();
  draft.loop = loopSelect.value;
  playhead = draftRange()[0];
  save();
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim() || !isEditable()) return;
  const draft = viewDraft();
  draft.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  save();
  renderNotes();
});

// ---- 播放（始终按演出口径） ---------------------------------------------
let timer = null;
let playhead = 0;
let audioContext = null;

function draftRange() {
  const draft = performanceDraft();
  if (!draft || draft.loop === "") return [0, steps - 1];
  const start = Number(draft.loop) * 4;
  return [start, start + 3];
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

function tick() {
  const [start, end] = draftRange();
  const draft = performanceDraft();
  if (playhead < start || playhead > end) playhead = start;
  highlight(playhead);
  instruments.forEach((instrument, rowIndex) => {
    if (draft.pattern[rowIndex][playhead]) playSound(instrument);
  });
  playhead = playhead >= end ? start : playhead + 1;
}

function stopPlayback() {
  if (timer) clearInterval(timer);
  timer = null;
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
}

document.querySelector("#playBtn").addEventListener("click", () => {
  if (timer) clearInterval(timer);
  playhead = draftRange()[0];
  tick();
  timer = setInterval(tick, 60000 / performanceDraft().bpm);
});

document.querySelector("#stopBtn").addEventListener("click", stopPlayback);

save();
render();
