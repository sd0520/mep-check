/* 職人百寶箱 — 現場清點
   資料只存在這台裝置：IndexedDB（紀錄、照片、基準）＋ localStorage（案場設定、清點人）。
   標單基準與密碼都由「案場設定檔」帶入，不寫在這個公開的網站程式裡。 */

/* ---------- 小工具 ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pad = (n, w) => String(n).padStart(w, "0");
const todayISO = () => { const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2); };
const roc = (iso) => { const p = String(iso).split("-"); if (p.length !== 3) return "";
  return String(+p[0] - 1911) + pad(p[1], 2) + pad(p[2], 2); };
const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]/g, "");
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const fmt = (n) => (Math.round(n * 1000) / 1000).toString();

let toastT;
function toast(m) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = m; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3400);
}

async function sha256(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------- 本機設定 ---------- */
const CFG_KEY = "mepcheck.me";
let CFG = { by: "" };
try { Object.assign(CFG, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); } catch (e) {}
function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) {} }

/* 這台裝置已經輸入過密碼的案場（案場密碼只問第一次） */
const OPEN_KEY = "mepcheck.opened";
let OPENED = {};
try { OPENED = JSON.parse(localStorage.getItem(OPEN_KEY) || "{}"); } catch (e) {}
function saveOpened() {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(OPENED)); } catch (e) {}
}

/* ---------- 橫幅時間 ---------- */
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
function greet(h) {
  if (h < 5) return "夜深了";
  if (h < 11) return "早安";
  if (h < 13) return "午安";
  if (h < 18) return "午後好";
  return "晚安";
}
function paintClock() {
  const d = new Date();
  $("heroWhen").textContent =
    d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日（" +
    WEEKDAY[d.getDay()] + "）　" + pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2);
  $("heroHi").textContent = greet(d.getHours()) + "，現場辛苦了";
}

/* ---------- IndexedDB ---------- */
let idb = null;
function openDB() {
  return new Promise((res, rej) => {
    const q = indexedDB.open("mepcheck", 2);
    q.onupgradeneeded = () => {
      const db = q.result;
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" });
      if (!db.objectStoreNames.contains("baseline")) db.createObjectStore("baseline", { keyPath: "k" });
    };
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
const tx = (store, mode) => idb.transaction(store, mode).objectStore(store);
const dbPut = (store, v) => new Promise((res, rej) => {
  const r = tx(store, "readwrite").put(v); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
const dbGet = (store, k) => new Promise((res, rej) => {
  const r = tx(store, "readonly").get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbAll = (store) => new Promise((res, rej) => {
  const r = tx(store, "readonly").getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
const dbClear = (store) => new Promise((res, rej) => {
  const r = tx(store, "readwrite").clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

/* ---------- 狀態 ---------- */
let records = [];        // 清點紀錄
let base = [];           // 標單基準（記憶體快取）
let draft = null, editingId = null;
const photoURL = new Map();
function urlFor(id) {
  if (photoURL.has(id)) return Promise.resolve(photoURL.get(id));
  return dbGet("photos", id).then((p) => {
    if (!p) return "";
    const u = URL.createObjectURL(p.blob); photoURL.set(id, u); return u;
  });
}

/* ---------- 畫面切換 ---------- */
const views = ["vList", "vMenu", "vCheck", "vForm", "vAdmin"];
function show(v) {
  views.forEach((x) => { $(x).hidden = x !== v; });
  $("hero").hidden = v === "vForm" || v === "vCheck";
  $("tabSite").setAttribute("aria-pressed", String(v !== "vAdmin"));
  $("tabAdmin").setAttribute("aria-pressed", String(v === "vAdmin"));
  window.scrollTo(0, 0);
}
$("tabSite").onclick = () => { show("vList"); renderList(); };
$("tabAdmin").onclick = () => { renderAdmin(); show("vAdmin"); };
$("btnBack").onclick = () => { show("vList"); renderList(); };

const fill = (el, arr, cur) => { el.innerHTML = arr.map((v) =>
  `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join(""); };

/* ---------- 案場 ----------
   清單放在 cases.json（只有名稱與功能），標單基準與密碼一律來自匯入的設定檔。
   這樣卡片永遠看得到，沒有設定檔時也知道該找誰要。 */
let CASES = [];
let pendingCase = null;

async function loadCases() {
  try {
    const r = await fetch("cases.json", { cache: "no-cache" });
    CASES = (await r.json()).案場 || [];
  } catch (e) { CASES = []; }
}

function renderCases() {
  const box = $("caseBox");
  if (!CASES.length) {
    box.innerHTML = `<div class="card pad tiny muted" style="text-align:center">
      還沒有任何案場</div>`;
    return;
  }
  box.innerHTML = CASES.map((c, i) => {
    const unlocked = !c.案場密碼雜湊 || OPENED[c.代號];
    return `<button class="case" data-i="${i}">
      <span class="ic">${esc(c.圖示 || "🏗")}</span>
      <span class="tx"><b>${esc(c.名稱)}</b><span>${esc(c.副標 || "")}</span></span>
      <span class="go">${unlocked ? "›" : "🔒"}</span>
    </button>`;
  }).join("");

  box.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => openCase(CASES[+b.dataset.i]);
  });
}

/* 第一步：密碼。這台裝置開過就跳過，直接問姓名。 */
function openCase(c) {
  pendingCase = c;
  if (c.案場密碼雜湊 && !OPENED[c.代號]) {
    $("passCase").textContent = c.名稱;
    $("casePass").value = "";
    $("dlgPass").showModal();
    return;
  }
  askWho(c);
}

/* 第二步：檢查人員 */
function askWho(c) {
  pendingCase = c;
  $("whoCase").textContent = c.名稱;
  $("whoName").value = CFG.by || "";
  $("dlgWho").showModal();
}

$("dlgPass").addEventListener("close", async () => {
  if ($("dlgPass").returnValue !== "ok" || !pendingCase) return;
  const c = pendingCase;
  const v = $("casePass").value; $("casePass").value = "";
  if (!v) { toast("請輸入案場密碼"); openCase(c); return; }
  if (await sha256(c.鹽 + ":" + v) !== c.案場密碼雜湊) {
    toast("案場密碼不正確"); openCase(c); return;
  }
  OPENED[c.代號] = true; saveOpened();
  renderCases();
  askWho(c);
});

$("dlgWho").addEventListener("close", async () => {
  if ($("dlgWho").returnValue !== "ok" || !pendingCase) return;
  const who = $("whoName").value.trim();
  if (!who) { toast("請填檢查人員姓名"); askWho(pendingCase); return; }
  CFG.by = who; saveCfg();
  activeCase = pendingCase;
  renderMenu();
  show("vMenu");
});

/* ---------- 功能選單 ---------- */
let activeCase = null;
const FUNCS = {
  "自檢": { icon: "📋", note: "逐項目視檢查、填實際情形、拍照", go: startCheck },
  "清查": { icon: "📊", note: "清點數量、比對標單、算完成率", go: startTally },
};
function renderMenu() {
  const c = activeCase;
  $("menuCase").textContent = c ? c.名稱 : "案場";
  $("menuWho").textContent = CFG.by ? CFG.by : "";
  const list = (c && c.功能 && c.功能.length) ? c.功能 : ["清查"];
  $("menuBox").innerHTML = list.map((f) => {
    const d = FUNCS[f];
    if (!d) return "";
    return `<button class="case" data-f="${esc(f)}">
      <span class="ic">${d.icon}</span>
      <span class="tx"><b>${esc(f)}</b><span>${esc(d.note)}</span></span>
      <span class="go">›</span></button>`;
  }).join("");
  $("menuBox").querySelectorAll("[data-f]").forEach((b) => {
    b.onclick = () => FUNCS[b.dataset.f].go();
  });
}
$("btnMenuBack").onclick = () => { show("vList"); renderList(); };

async function startTally() {
  if (!(await ensureBase(activeCase))) return;
  newDraft(CFG.by);
  await renderForm();
  show("vForm");
}
function startCheck() {
  newCheck(CFG.by);
  renderCheck();
  show("vCheck");
}

/* ---------- 自檢 ----------
   工項範本沿用本案既有的自主檢查表。現場可按「修改標準」臨時調整；
   要永久增修，改下面的 TEMPLATES。 */
const TEMPLATES = {
  "電氣配管工程": [
    ["施工前", "管路廠牌", "億豐"],
    ["施工前", "管路規格", "PVC-E管"],
    ["施工中", "放樣", "依施工圖"],
    ["施工中", "管路配設位置", "管路配設於雙層鋼筋中間"],
    ["施工中", "埋設間距", "管路並排至少應有最大管徑2D間隔"],
    ["施工中", "管路接頭", "確實插入深度足夠"],
    ["施工中", "管路接頭、彎頭之固定", "綁紮固定"],
    ["施工後", "管路出口保護", "管路出口以管口塞或膠布防護"],
    ["施工後", "清潔", "剩餘材料及雜物清除"]],
  "弱電配管工程": [
    ["施工前", "管路廠牌", "億豐"],
    ["施工前", "管路規格、尺寸", "PVC-E管"],
    ["施工中", "放樣", "依施工圖"],
    ["施工中", "管路配設位置", "管路配設於雙層鋼筋中間"],
    ["施工中", "埋設間距", "管路並排至少應有最大管徑2D間隔"],
    ["施工中", "管路接頭", "確實插入深度足夠"],
    ["施工中", "管路接頭、彎頭之固定", "綁紮固定"],
    ["施工後", "管路出口保護", "管路出口以管口塞或膠布防護"],
    ["施工後", "清潔", "剩餘材料及雜物清除"]],
  "給排水配管工程": [
    ["施工前", "管路廠牌", "億豐"],
    ["施工前", "管路規格", "PVC-B管"],
    ["施工中", "放樣", "依施工圖"],
    ["施工中", "管路配設位置", "管路配設於雙層鋼筋中間"],
    ["施工中", "埋設間距", "管路並排至少應有最大管徑2D間隔"],
    ["施工中", "管路接頭", "確實插入深度足夠"],
    ["施工中", "管路接頭、彎頭之固定", "綁紮固定"],
    ["施工後", "管路出口保護", "管路出口以管口塞或膠布防護"],
    ["施工後", "清潔", "剩餘材料及雜物清除"]],
  "避雷及接地設備工程（SUS304雙連出線盒）": [
    ["施工前", "廠牌", "凰榮(SUS304雙連出線盒)、億豐(管材)、伸泰(線材)"],
    ["施工前", "規格、尺寸", "SUS304雙連出線盒 205×128×63mm 厚0.6mm"],
    ["施工中", "管路配設", "依施工圖"],
    ["施工中", "外觀", "無破損、劣化"],
    ["施工中", "管路接頭、彎頭之固定", "綁紮固定"],
    ["施工中", "彎頭", "二出線口間彎頭不超過4個"],
    ["施工中", "直管", "二出線口間距離不得超過50M"],
    ["施工後", "接地線保護", "線頭應用膠布包覆保護"],
    ["施工後", "清潔", "剩餘材料及雜物清除"]],
  "接地工程": [
    ["施工前", "開挖面檢視", "開挖面之積水或地下水應予控制並清除"],
    ["施工前", "施作位置", "與地下管線及基礎不相衝突之處或未來不致開挖之場所"],
    ["施工中", "放樣", "依核准之施工圖"],
    ["施工中", "接地銅棒", "頂部埋設深度應在地面下至少1.0m 或地下水位以下；接地極間隔應在2m以上"],
    ["施工中", "接地銅網", "導線標稱截面積30mm²以上，並以熱熔接方法接續"],
    ["施工中", "接地導線", "標稱截面積須大於5.5mm²"],
    ["施工中", "接地引上線", "通過混凝土或地板者，須設套管及止水板"],
    ["施工中", "電阻值測試", "須在10Ω以下"],
    ["施工後", "接地箱安裝", "箱底離地30CM"],
    ["施工後", "接地電阻", "接地電阻應在10Ω以下"],
    ["施工後", "避雷針位置", "依設計圖"],
    ["施工後", "避雷針高度", "尖端至少須高出其保護區域3M以上"]]
};

const ZONES = ["A區", "B區", "C區", "全區"];
const FLOORS = ["筏基層", "B1F", "1F", "2F", "3F", "4F", "R1F", "RF", "全區"];
const STAGES = ["施工前", "施工中", "施工後"];
const TIMINGS = ["檢驗停留點", "不定期抽查"];
const RES = [["pass", "○ 合格"], ["fail", "╳ 缺失"], ["na", "／ 無此項"]];
const MARK = { pass: "○ 合格", fail: "╳ 缺失", na: "／ 無此項", "": "" };
const ctally = (r) => { const c = { pass: 0, fail: 0, na: 0 };
  (r.items || []).forEach((i) => { if (c[i.result] !== undefined) c[i.result]++; }); return c; };
const itemsFor = (sub) => (TEMPLATES[sub] || []).map(([stage, item, std]) =>
  ({ stage, item, std, result: "", actual: "", photos: [] }));

let check = null, editingCheck = null;

function seg(el, arr, cur, cb) {
  el.innerHTML = arr.map((v) =>
    '<button type="button" aria-pressed="' + (v === cur) + '">' + esc(v) + "</button>").join("");
  el.querySelectorAll("button").forEach((b, i) => { b.onclick = () => {
    el.querySelectorAll("button").forEach((x, j) => x.setAttribute("aria-pressed", String(i === j)));
    cb(arr[i]); }; });
}

function newCheck(who) {
  const s = Object.keys(TEMPLATES)[0];
  editingCheck = null;
  check = { subproject: s, zone: "B區", floor: "B1F", location: "", date: todayISO(),
    stage: "施工中", timing: "不定期抽查", inspector: who || CFG.by || "", items: itemsFor(s) };
}

function renderCheck() {
  fill($("kSub"), Object.keys(TEMPLATES), check.subproject);
  fill($("kZone"), ZONES, check.zone);
  fill($("kFloor"), FLOORS, check.floor);
  $("kLoc").value = check.location; $("kDate").value = check.date; $("kBy").value = check.inspector;
  seg($("kStage"), STAGES, check.stage, (v) => { check.stage = v; });
  seg($("kTiming"), TIMINGS, check.timing, (v) => { check.timing = v; });
  $("kCode").textContent = check.code || roc(check.date);
  renderCheckItems();
}

async function renderCheckItems() {
  const parts = [];
  for (let i = 0; i < check.items.length; i++) {
    const it = check.items[i];
    const shots = [];
    for (let pi = 0; pi < it.photos.length; pi++) {
      shots.push('<div class="shot"><img src="' + esc(await urlFor(it.photos[pi])) + '" alt="">' +
        '<button type="button" data-del="' + pi + '" aria-label="刪除照片">×</button></div>');
    }
    parts.push('<div class="item" data-i="' + i + '">' +
      '<h4><span class="chip">' + esc(it.stage) + "</span>" + (i + 1) + ". " + esc(it.item) + "</h4>" +
      '<div class="std">規定標準：<span class="stdtext">' + esc(it.std) + "</span>" +
        '<button type="button" class="edit" data-edit>修改標準</button></div>' +
      '<div class="res">' + RES.map(([k, l]) =>
        '<button type="button" data-r="' + k + '" aria-pressed="' + (it.result === k) + '">' +
        esc(l) + "</button>").join("") + "</div>" +
      '<input type="text" class="actual" placeholder="實際檢查情形（可空白）" value="' +
        esc(it.actual) + '">' +
      '<div class="shots">' + shots.join("") +
        '<button type="button" class="addshot" data-add><span style="font-size:1.3rem">＋</span>照片</button>' +
      "</div></div>");
  }
  $("kItemBox").innerHTML = parts.join("");
  $("kItemBox").querySelectorAll(".item").forEach((box) => {
    const i = +box.dataset.i, it = check.items[i];
    box.querySelectorAll(".res button").forEach((b) => { b.onclick = () => {
      it.result = it.result === b.dataset.r ? "" : b.dataset.r;
      box.querySelectorAll(".res button").forEach((x) =>
        x.setAttribute("aria-pressed", String(x.dataset.r === it.result)));
      paintCheckProgress(); }; });
    box.querySelector(".actual").oninput = (e) => { it.actual = e.target.value; };
    box.querySelector("[data-add]").onclick = () => pickCheck(i);
    box.querySelector("[data-edit]").onclick = () => {
      const cur = it.std;
      const span = box.querySelector(".stdtext");
      const inp = document.createElement("input");
      inp.type = "text"; inp.value = cur; inp.style.marginTop = ".25rem";
      span.replaceWith(inp); inp.focus();
      inp.onblur = () => { it.std = inp.value.trim() || cur;
        const s2 = document.createElement("span"); s2.className = "stdtext"; s2.textContent = it.std;
        inp.replaceWith(s2); };
    };
    box.querySelectorAll("[data-del]").forEach((b) => { b.onclick = async () => {
      it.photos.splice(+b.dataset.del, 1); await renderCheckItems(); }; });
  });
  paintCheckProgress();
}

function paintCheckProgress() {
  const n = check.items.filter((i) => i.result).length;
  $("kProgress").textContent = "已標記 " + n + "/" + check.items.length + " 項";
}

function pickCheck(i) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment"; inp.multiple = true;
  inp.onchange = async () => {
    const fs = Array.from(inp.files || []); if (!fs.length) return;
    toast("處理照片中…");
    for (const f of fs) {
      const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await dbPut("photos", { id, blob: await shrink(f) });
      check.items[i].photos.push(id);
    }
    await renderCheckItems(); toast("已加入照片");
  };
  inp.click();
}

$("kSub").onchange = (e) => { check.subproject = e.target.value;
  check.items = itemsFor(check.subproject); renderCheckItems(); };
$("kZone").onchange = (e) => { check.zone = e.target.value; };
$("kFloor").onchange = (e) => { check.floor = e.target.value; };
$("kLoc").oninput = (e) => { check.location = e.target.value; };
$("kBy").oninput = (e) => { check.inspector = e.target.value; };
$("kDate").onchange = (e) => { check.date = e.target.value;
  if (!editingCheck) $("kCode").textContent = roc(check.date); };
$("kBack").onclick = () => { renderMenu(); show("vMenu"); };

$("kSave").onclick = async () => {
  if (!check.location.trim()) { toast("請填檢查位置"); $("kLoc").focus(); return; }
  if (!check.inspector.trim()) { toast("請填檢查人"); $("kBy").focus(); return; }
  if (!check.items.filter((i) => i.result).length) { toast("至少要標記一項檢查結果"); return; }
  const day = roc(check.date);
  let code = check.code;
  if (!editingCheck) {
    const n = records.filter((r) => String(r.code || "").startsWith(day)).length + 1;
    code = day + "-" + pad(n, 2);
  }
  const c = ctally(check);
  const rec = Object.assign({}, check, {
    id: editingCheck || ("r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    kind: "check", code,
    caseName: (activeCase && activeCase.名稱) || "",
    caseId: (activeCase && activeCase.代號) || "",
    result: c.fail > 0 ? "fail" : "pass",
    savedAt: Date.now(), cloudAt: 0,
  });
  await dbPut("records", rec);
  records = await dbAll("records");
  toast("已儲存 " + code);
  show("vList"); renderList();
};

$("kPrint").onclick = async () => {
  const c = ctally(check);
  const rows = check.items.map((it, i) =>
    '<tr><td style="text-align:center">' + (i + 1) + "</td><td>" + esc(it.stage) +
    "</td><td>" + esc(it.item) + "</td><td>" + esc(it.std) + "</td><td>" +
    esc(it.actual || "") + '</td><td style="text-align:center">' +
    esc(MARK[it.result] || "") + "</td></tr>").join("");
  const shots = [];
  for (const it of check.items) for (const pid of it.photos) {
    shots.push('<div class="ph"><img src="' + esc(await urlFor(pid)) + '" alt="">' +
      '<div style="font-size:8pt">' + esc(it.item) + "　" + esc(it.actual || "") + "</div></div>");
  }
  $("printArea").innerHTML =
    '<div class="phd"><div class="t"><b>施 工 自 主 檢 查 表</b>' +
    "<div>SELF-INSPECTION CHECKLIST</div></div>" +
    '<div class="n">' + esc(check.code || roc(check.date)) + "</div></div>" +
    "<table><tbody>" +
    '<tr><th style="width:18%">案場</th><td colspan="3">' +
      esc((activeCase && activeCase.名稱) || "") + "</td></tr>" +
    "<tr><th>分項工程</th><td>" + esc(check.subproject) +
      '</td><th style="width:18%">檢查日期</th><td>民國 ' + esc(roc(check.date)) + "</td></tr>" +
    "<tr><th>檢查位置</th><td>" + esc(check.zone) + " " + esc(check.floor) + " " +
      esc(check.location) + "</td><th>檢查人</th><td>" + esc(check.inspector) + "</td></tr>" +
    "<tr><th>施工流程</th><td>" + esc(check.stage) + "</td><th>抽查時機</th><td>" +
      esc(check.timing) + "</td></tr>" +
    '<tr><th>檢查結果</th><td colspan="3">合格 ' + c.pass + "　缺失 " + c.fail +
      "　無此項 " + c.na + "</td></tr>" +
    "</tbody></table>" +
    '<p style="margin:6pt 0 3pt">結果標記：○ 檢查合格　╳ 有缺失需改正　／ 無此檢查項目</p>' +
    "<table><thead><tr><th>項次</th><th>施工流程</th><th>管理項目</th>" +
    "<th>規定標準</th><th>實際檢查情形</th><th>檢查結果</th></tr></thead><tbody>" +
    rows + "</tbody></table>" +
    '<table style="margin-top:8pt"><tbody><tr><th style="width:25%">檢查人簽名</th>' +
    '<td style="height:46pt"></td><th style="width:25%">複核</th><td></td></tr></tbody></table>' +
    (shots.length ? '<h3 style="margin-top:10pt">自檢照片</h3>' + shots.join("") : "");
  window.print();
};

/* ---------- 基準 ----------
   標單數量放在 repo 的資料檔，cases.json 的「基準」欄位指過去。
   首次用到時抓下來存進 IndexedDB，之後離線照常。 */
let baseCase = "";

async function ensureBase(c) {
  if (!c || !c.基準) { toast("這個案場沒有設定標單基準"); return false; }
  if (baseCase === c.代號 && base.length) return true;
  try {
    base = (await dbAll("baseline")).filter((r) => r.case === c.代號);
    if (base.length) { baseCase = c.代號; return true; }
  } catch (e) {}
  toast("第一次使用，正在下載標單基準…");
  try {
    const r = await fetch(c.基準, { cache: "force-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const store = idb.transaction("baseline", "readwrite").objectStore("baseline");
    for (const x of d.項目) store.put({ k: c.代號 + "|" + x.b + "|" + x.f + "|" + x.c, case: c.代號, ...x });
    await new Promise((res, rej) => {
      store.transaction.oncomplete = res;
      store.transaction.onerror = () => rej(store.transaction.error);
    });
    base = (await dbAll("baseline")).filter((x) => x.case === c.代號);
    baseCase = c.代號;
    toast("標單基準已就緒　" + base.length + " 項");
    return true;
  } catch (e) {
    toast(navigator.onLine ? "下載標單基準失敗：" + e.message
                           : "第一次使用清查需要網路，下載過就能離線用");
    return false;
  }
}

/* ---------- 基準 ---------- */
const bKey = (b, f, c) => b + "|" + f + "|" + c;
const uniq = (a) => Array.from(new Set(a));

function bldgs() { return uniq(base.map((r) => r.b)).sort(); }
function floorsOf(b) { return uniq(base.filter((r) => r.b === b).map((r) => r.f)).sort(floorSort); }
function sysOf(b, f) { return uniq(base.filter((r) => r.b === b && r.f === f).map((r) => r.s)).sort(); }

const FLOOR_ORDER = ["筏基層", "B1F", "1F", "1F&2F", "2F", "3F", "4F", "R1F", "R1F~RRF", "RF"];
function floorSort(a, b) {
  const ia = FLOOR_ORDER.indexOf(a), ib = FLOOR_ORDER.indexOf(b);
  if (ia < 0 && ib < 0) return a.localeCompare(b);
  if (ia < 0) return 1;
  if (ib < 0) return -1;
  return ia - ib;
}

/* 這台裝置累計已清點的量：b|f|c -> 數量 */
function tallyMap() {
  const m = new Map();
  for (const r of records) for (const l of (r.lines || [])) {
    const k = bKey(r.bldg, r.floor, l.c);
    m.set(k, (m.get(k) || 0) + num(l.got));
  }
  return m;
}

/* ---------- 清點表單 ---------- */
function newDraft(who) {
  editingId = null;
  const b = bldgs()[0] || "";
  const f = floorsOf(b)[0] || "";
  draft = { bldg: b, floor: f, sys: sysOf(b, f)[0] || "", date: todayISO(),
    by: who || CFG.by || "", note: "", got: {}, photos: [] };
}

async function renderForm() {
  $("formCode").textContent = editingId ? (draft.code || "") : roc(draft.date);
  fill($("fBldg"), bldgs(), draft.bldg);
  fill($("fFloor"), floorsOf(draft.bldg), draft.floor);
  fill($("fSys"), sysOf(draft.bldg, draft.floor), draft.sys);
  $("fDate").value = draft.date;
  $("fBy").value = draft.by;
  $("fNote").value = draft.note || "";
  renderItems();
  await renderShots();
}

function currentItems() {
  const q = ($("srch").value || "").trim().toLowerCase();
  const only = $("onlyFilled").checked;
  return base.filter((r) =>
    r.b === draft.bldg && r.f === draft.floor && r.s === draft.sys &&
    (!q || r.n.toLowerCase().includes(q) || r.c.toLowerCase().includes(q)) &&
    (!only || num(draft.got[r.c]) > 0));
}

function renderItems() {
  const acc = tallyMap();
  const list = currentItems();
  const all = base.filter((r) => r.b === draft.bldg && r.f === draft.floor && r.s === draft.sys);
  const filled = all.filter((r) => num(draft.got[r.c]) > 0).length;
  $("sumInfo").textContent = `顯示 ${list.length} / ${all.length} 項　本次已填 ${filled} 項`;

  if (!list.length) {
    $("itemBox").innerHTML = `<div class="empty tiny">沒有符合的項目</div>`;
    return;
  }
  $("itemBox").innerHTML = list.map((r) => {
    const done = acc.get(bKey(r.b, r.f, r.c)) || 0;
    const v = draft.got[r.c];
    return `<div class="cnt">
      <div class="nm">${esc(r.n)}<i>${esc(r.c)}</i></div>
      <div class="ln">
        <span class="fig">標單 <b>${fmt(r.q)}</b>　已清點 <b>${fmt(done)}</b></span>
        <input type="number" inputmode="decimal" step="any" min="0"
          data-c="${esc(r.c)}" data-q="${r.q}" placeholder="0"
          value="${v == null ? "" : esc(v)}">
        <span class="un">${esc(r.u)}</span>
      </div></div>`;
  }).join("");

  $("itemBox").querySelectorAll("input[data-c]").forEach((el) => {
    const mark = () => el.classList.toggle("over", num(el.value) > num(el.dataset.q));
    mark();
    el.oninput = () => {
      const t = el.value.trim();
      if (t === "") delete draft.got[el.dataset.c];
      else draft.got[el.dataset.c] = t;
      mark();
    };
  });
}

$("fBldg").onchange = (e) => {
  draft.bldg = e.target.value;
  draft.floor = floorsOf(draft.bldg)[0] || "";
  draft.sys = sysOf(draft.bldg, draft.floor)[0] || "";
  draft.got = {};
  fill($("fFloor"), floorsOf(draft.bldg), draft.floor);
  fill($("fSys"), sysOf(draft.bldg, draft.floor), draft.sys);
  renderItems();
};
$("fFloor").onchange = (e) => {
  draft.floor = e.target.value;
  draft.sys = sysOf(draft.bldg, draft.floor)[0] || "";
  draft.got = {};
  fill($("fSys"), sysOf(draft.bldg, draft.floor), draft.sys);
  renderItems();
};
$("fSys").onchange = (e) => { draft.sys = e.target.value; renderItems(); };
$("fDate").onchange = (e) => { draft.date = e.target.value;
  if (!editingId) $("formCode").textContent = roc(draft.date); };
$("fBy").oninput = (e) => { draft.by = e.target.value; };
$("fNote").oninput = (e) => { draft.note = e.target.value; };
$("srch").oninput = renderItems;
$("onlyFilled").onchange = renderItems;

/* ---------- 照片 ---------- */
function shrink(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const m = 1600, sc = Math.min(1, m / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => res(b || file), "image/jpeg", 0.8);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => res(file);
    img.src = URL.createObjectURL(file);
  });
}

async function renderShots() {
  const box = $("shots");
  const kids = [];
  for (const pid of draft.photos) {
    kids.push(`<div class="shot"><img src="${esc(await urlFor(pid))}" alt="">
      <button data-del="${esc(pid)}" aria-label="刪除">×</button></div>`);
  }
  kids.push(`<button class="addshot" id="addShot"><span>＋</span>照片</button>`);
  box.innerHTML = kids.join("");
  box.querySelectorAll("[data-del]").forEach((b) => { b.onclick = async () => {
    draft.photos = draft.photos.filter((x) => x !== b.dataset.del);
    await renderShots();
  }; });
  $("addShot").onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment"; inp.multiple = true;
    inp.onchange = async () => {
      for (const f of Array.from(inp.files || [])) {
        const id = "p" + Date.now() + Math.random().toString(36).slice(2, 7);
        await dbPut("photos", { id, blob: await shrink(f) });
        draft.photos.push(id);
      }
      await renderShots();
    };
    inp.click();
  };
}

/* ---------- 儲存 ---------- */
$("btnSave").onclick = async () => {
  if (!base.length) { toast("尚未匯入案場設定檔"); return; }
  const by = ($("fBy").value || "").trim();
  if (!by) { toast("請填清點人"); return; }

  const lines = [];
  for (const r of base) {
    if (r.b !== draft.bldg || r.f !== draft.floor || r.s !== draft.sys) continue;
    const g = draft.got[r.c];
    if (g == null || String(g).trim() === "") continue;
    lines.push({ c: r.c, n: r.n, u: r.u, q: r.q, got: num(g) });
  }
  if (!lines.length) { toast("至少填一個項目的數量"); return; }

  let code = draft.code;
  if (!editingId) {
    const day = roc(draft.date);
    const n = records.filter((r) => String(r.code || "").startsWith(day)).length + 1;
    code = day + "-" + pad(n, 2);
  }
  const rec = {
    id: editingId || ("r" + Date.now() + Math.random().toString(36).slice(2, 6)),
    code, caseName: (activeCase && activeCase.名稱) || "",
    caseId: (activeCase && activeCase.代號) || "",
    bldg: draft.bldg, floor: draft.floor, sys: draft.sys,
    date: draft.date, by, note: draft.note || "",
    lines, photos: draft.photos.slice(), savedAt: Date.now(), cloudAt: 0,
  };
  await dbPut("records", rec);
  records = await dbAll("records");
  toast("已儲存 " + code);
  show("vList"); renderList();
};

/* ---------- 清單 ---------- */
function sortRecs() { records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)); }
/* 舊紀錄沒有 kind 欄位：有 lines 的是清查，有 items 的是自檢 */
const kindOf = (r) => r.kind || (r.lines ? "tally" : "check");

function renderList() {
  sortRecs();
  const box = $("listBox");
  if (!records.length) {
    box.innerHTML = '<div class="empty"><div class="big">📋</div><div>尚未有紀錄</div>' +
      '<div class="tiny" style="margin-top:.3rem">按上方的案場開始第一筆</div></div>';
    return;
  }
  box.innerHTML = records.map((r) => {
    const k = kindOf(r);
    let title, sub, pill, nph;
    if (k === "tally") {
      title = esc(r.bldg) + " " + esc(r.floor) + "・" + esc(r.sys);
      sub = esc(r.note || "");
      const over = (r.lines || []).some((l) => num(l.got) > num(l.q));
      pill = over ? '<span class="pill bad">有超量</span>'
                  : '<span class="pill ok">' + (r.lines || []).length + " 項</span>";
      nph = (r.photos || []).length;
    } else {
      const c = ctally(r);
      title = esc(r.subproject || "自檢");
      sub = esc(r.zone || "") + " " + esc(r.floor || "") + "・" + esc(r.location || "");
      pill = c.fail ? '<span class="pill bad">缺失 ' + c.fail + "</span>"
                    : '<span class="pill ok">合格</span>';
      nph = (r.items || []).reduce((n, i) => n + (i.photos || []).length, 0);
    }
    return '<div class="rec" data-id="' + esc(r.id) + '"><div style="min-width:0;flex:1">' +
      '<div style="font-weight:700"><span class="chip">' + (k === "tally" ? "清查" : "自檢") +
        "</span>" + title + "</div>" +
      '<div class="tiny muted">' + sub + "</div>" +
      '<div class="tiny mono muted">' + esc(r.code) + "　" + esc(r.date) + "　" +
        esc(r.by || r.inspector || "") + (nph ? "　📷" + nph : "") + "</div>" +
      "</div><div>" + pill + "</div></div>";
  }).join("");
  box.querySelectorAll(".rec").forEach((el) => { el.onclick = () => editRecord(el.dataset.id); });
}

async function editRecord(id) {
  const r = records.find((x) => x.id === id); if (!r) return;
  activeCase = CASES.find((c) => c.代號 === r.caseId) || activeCase;
  if (kindOf(r) === "tally") {
    editingId = id;
    draft = { code: r.code, bldg: r.bldg, floor: r.floor, sys: r.sys, date: r.date,
      by: r.by, note: r.note || "", got: {}, photos: (r.photos || []).slice() };
    for (const l of r.lines || []) draft.got[l.c] = String(l.got);
    await renderForm();
    show("vForm");
  } else {
    editingCheck = id;
    check = JSON.parse(JSON.stringify(r));
    renderCheck();
    show("vCheck");
  }
}

/* ---------- 列印：清點統計表 ---------- */
$("btnPrint").onclick = async () => {
  const acc = tallyMap();
  const rows = base.filter((r) =>
    r.b === draft.bldg && r.f === draft.floor && r.s === draft.sys &&
    draft.got[r.c] != null && String(draft.got[r.c]).trim() !== "");
  if (!rows.length) { toast("這張還沒有填任何數量"); return; }

  const body = rows.map((r, i) => {
    const g = num(draft.got[r.c]);
    const done = acc.get(bKey(r.b, r.f, r.c)) || 0;
    const d = done - r.q;
    return `<tr><td style="text-align:center">${i + 1}</td>
      <td>${esc(r.n)}<br><span style="font-size:8pt;color:#555">${esc(r.c)}</span></td>
      <td style="text-align:center">${esc(r.u)}</td>
      <td style="text-align:right">${fmt(r.q)}</td>
      <td style="text-align:right">${fmt(g)}</td>
      <td style="text-align:right">${fmt(done)}</td>
      <td style="text-align:right">${d > 0 ? "+" : ""}${fmt(d)}</td></tr>`;
  }).join("");

  const shots = [];
  for (const pid of draft.photos) {
    shots.push(`<div class="ph"><img src="${esc(await urlFor(pid))}" alt=""></div>`);
  }

  $("printArea").innerHTML = `
    <div class="phd"><div class="t"><b>現 場 清 點 統 計 表</b>
      <div>SITE QUANTITY TALLY</div></div>
      <div class="n">${esc(draft.code || roc(draft.date))}</div></div>
    <table><tbody>
      <tr><th style="width:18%">案場</th><td colspan="3">${esc((activeCase && activeCase.名稱) || "")}</td></tr>
      <tr><th>棟別樓層</th><td>${esc(draft.bldg)} ${esc(draft.floor)}</td>
          <th style="width:18%">系統</th><td>${esc(draft.sys)}</td></tr>
      <tr><th>清點日期</th><td>民國 ${esc(roc(draft.date))}</td>
          <th>清點人</th><td>${esc(draft.by)}</td></tr>
      ${draft.note ? `<tr><th>備註</th><td colspan="3">${esc(draft.note)}</td></tr>` : ""}
    </tbody></table>
    <p style="margin:6pt 0 3pt">「已清點」為本機累計；差異為已清點減標單，正值表示超出標單數量。</p>
    <table><thead><tr><th>項次</th><th>項目及說明</th><th>單位</th>
      <th>標單</th><th>本次</th><th>已清點</th><th>差異</th></tr></thead>
      <tbody>${body}</tbody></table>
    <table style="margin-top:8pt"><tbody><tr>
      <th style="width:25%">清點人簽名</th><td style="height:46pt"></td>
      <th style="width:25%">複核</th><td></td></tr></tbody></table>
    ${shots.length ? '<h3 style="margin-top:10pt">現場照片</h3>' + shots.join("") : ""}`;
  window.print();
};

/* ---------- 備份 / 匯入 ---------- */
function saveFile(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
$("btnBackup").onclick = async () => {
  if (!records.length) { toast("還沒有資料可備份"); return; }
  toast("打包中…");
  const zip = new JSZip();
  zip.file("records.json", JSON.stringify({ me: CFG, records }, null, 1));
  const pf = zip.folder("photos");
  const photos = await dbAll("photos");
  const used = new Set();
  records.forEach((r) => {
    (r.photos || []).forEach((p) => used.add(p));
    (r.items || []).forEach((i) => (i.photos || []).forEach((p) => used.add(p)));
  });
  photos.forEach((p) => { if (used.has(p.id)) pf.file(p.id + ".jpg", p.blob); });
  saveFile("清點備份_" + (CFG.by || "現場") + "_" + todayISO() + ".zip",
    await zip.generateAsync({ type: "blob" }));
  toast("備份完成，請用 LINE 或 Email 傳回工務所");
};
$("btnImport").onclick = () => {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".zip"; inp.multiple = true;
  inp.onchange = async () => {
    const fs = Array.from(inp.files || []); if (!fs.length) return;
    let added = 0;
    for (const f of fs) {
      try {
        const zip = await JSZip.loadAsync(f);
        const meta = JSON.parse(await zip.file("records.json").async("string"));
        for (const r of meta.records || []) {
          if (!records.some((x) => x.id === r.id)) { await dbPut("records", r); added++; }
        }
        const folder = zip.folder("photos");
        const jobs = [];
        folder.forEach((path, entry) => { jobs.push([path, entry]); });
        for (const [path, entry] of jobs) {
          const id = path.replace(/\.jpg$/i, "");
          if (!(await dbGet("photos", id))) await dbPut("photos", { id, blob: await entry.async("blob") });
        }
      } catch (e) { toast("這個檔案讀不出來：" + f.name); }
    }
    records = await dbAll("records");
    renderAdmin(); renderList();
    toast("已匯入 " + added + " 筆清點");
  };
  inp.click();
};

/* ---------- 案場設定檔 ---------- */
/* ---------- 管理者 ----------
   密碼雜湊來自案場設定檔，不在這個網站的程式裡。 */
let adminOn = false;
function paintAdminTab() {
  $("tabAdmin").hidden = !adminOn;
  if (!adminOn && !$("vAdmin").hidden) show("vList");
}
const adminCase = () => CASES.find((c) => c.管理者密碼雜湊) || null;
$("btnAdmin").onclick = () => {
  if (!adminCase()) { toast("這個網站還沒有設定管理者密碼"); return; }
  $("admPass").value = "";
  $("dlgAdmin").showModal();
};
$("dlgAdmin").addEventListener("close", async () => {
  if ($("dlgAdmin").returnValue !== "ok") return;
  const v = $("admPass").value; $("admPass").value = "";
  if (!v) { toast("請輸入密碼"); return; }
  const ac = adminCase();
  if (!ac || await sha256(ac.鹽 + ":" + v) !== ac.管理者密碼雜湊) {
    toast("密碼不正確"); return;
  }
  adminOn = true; paintAdminTab(); renderAdmin(); show("vAdmin");
  toast("已登入管理者");
});
$("btnAdminOut").onclick = () => {
  adminOn = false; paintAdminTab(); show("vList"); renderList();
  toast("已登出管理者");
};

/* ---------- 線上空間 ---------- */
const CLOUD_KEY = "mepcheck.cloud";
let CLOUD = null;
try { CLOUD = JSON.parse(localStorage.getItem(CLOUD_KEY) || "null"); } catch (e) {}
function saveCloud() {
  try {
    if (CLOUD) localStorage.setItem(CLOUD_KEY, JSON.stringify(CLOUD));
    else localStorage.removeItem(CLOUD_KEY);
  } catch (e) {}
}
function sayWhy(err) {
  const m = String(err && err.message ? err.message : err);
  if (err && err.name === "AbortError") return "連線逾時。網路太慢，或照片太多單筆跑不完";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return navigator.onLine
      ? "連不上這個網址。請確認網址沒打錯，且部署時「誰可以存取」選的是「所有人」"
      : "目前沒有網路，連不上線上空間";
  }
  return m;
}
async function cloudCall(body, ms) {
  if (!CLOUD) throw new Error("尚未設定線上空間");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms || 20000);
  try {
    const res = await fetch(CLOUD.url, {
      method: "POST", signal: ac.signal, redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ pass: CLOUD.pass }, body)),
    });
    const txt = await res.text();
    let out; try { out = JSON.parse(txt); } catch (e) {
      throw new Error("伺服器回應不是預期格式，請確認網址是 /exec 結尾且部署為「所有人」");
    }
    if (!out.ok) throw new Error(out.error || "伺服器拒絕");
    return out;
  } catch (err) { throw new Error(sayWhy(err)); } finally { clearTimeout(t); }
}
function paintCloud(note) {
  $("cloudBox").hidden = !CLOUD;
  if (!CLOUD) return;
  $("cloudUrl").textContent = CLOUD.url;
  const done = records.filter((r) => r.cloudAt).length;
  $("cloudState").className = "pill " + (done === records.length ? "ok" : "draft");
  $("cloudState").textContent = "已上傳 " + done + "/" + records.length;
  $("cloudNote").textContent = note || (CLOUD.lastAt
    ? "最後上傳：" + new Date(CLOUD.lastAt).toLocaleString("zh-TW")
    : "尚未上傳過。按「存入線上空間」把本機紀錄與照片送上去。");
}
$("btnCloudSetup").onclick = () => {
  $("cUrl").value = CLOUD ? CLOUD.url : "";
  $("cPass").value = CLOUD ? CLOUD.pass : "";
  $("dlgCloud").showModal();
};
$("dlgCloud").addEventListener("close", async () => {
  if ($("dlgCloud").returnValue !== "ok") return;
  const url = $("cUrl").value.trim(), pass = $("cPass").value.trim();
  if (!url || !pass) { toast("網址與通行碼都要填"); return; }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    toast("網址格式不對，應該是 .../exec 結尾"); return;
  }
  const keep = CLOUD;
  CLOUD = { url, pass };
  toast("測試連線中…");
  try {
    const out = await cloudCall({ action: "ping" }, 25000);
    CLOUD.lastAt = keep && keep.url === url ? keep.lastAt : 0;
    saveCloud(); paintCloud(); renderAdmin();
    toast("已連線　線上已有 " + (out.count || 0) + " 筆");
  } catch (e) {
    CLOUD = keep; saveCloud(); paintCloud();
    toast("連線失敗：" + e.message);
  }
});
$("btnCloudOut").onclick = () => { CLOUD = null; saveCloud(); paintCloud(); toast("已移除線上空間設定"); };
$("btnCloudTest").onclick = async () => {
  toast("測試中…");
  try { const o = await cloudCall({ action: "ping" }); paintCloud("連線正常　線上 " + (o.count || 0) + " 筆"); }
  catch (e) { paintCloud("連線失敗：" + e.message); }
};
function blobToB64(b) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.onerror = rej; fr.readAsDataURL(b);
  });
}
$("btnCloudPush").onclick = async () => {
  if (!records.length) { toast("沒有資料可上傳"); return; }
  const btn = $("btnCloudPush"); btn.disabled = true;
  let ok = 0, fail = 0, lastErr = "";
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    paintCloud("上傳中… " + (i + 1) + "/" + records.length + "　" + r.code);
    try {
      const photos = [];
      if (kindOf(r) === "tally") {
        for (const pid of (r.photos || [])) {
          const ph = await dbGet("photos", pid); if (!ph) continue;
          photos.push({ id: pid, b64: await blobToB64(ph.blob) });
        }
      } else {
        for (const it of (r.items || [])) for (const pid of (it.photos || [])) {
          const ph = await dbGet("photos", pid); if (!ph) continue;
          photos.push({ id: pid, item: it.item, b64: await blobToB64(ph.blob) });
        }
      }
      await cloudCall({ action: "push", record: r, photos }, 120000);
      r.cloudAt = Date.now(); await dbPut("records", r); ok++;
    } catch (e) { fail++; lastErr = e.message; }
  }
  CLOUD.lastAt = Date.now(); saveCloud();
  btn.disabled = false; renderAdmin();
  paintCloud(fail ? ("完成 " + ok + " 筆，失敗 " + fail + " 筆：" + lastErr)
    : ("全部 " + ok + " 筆已存入線上空間"));
  toast(fail ? ("有 " + fail + " 筆失敗") : "已存入線上空間");
};

/* ---------- 後台 ---------- */
/* 以 棟別×樓層×系統 為單位：標單項數、已清點項數、完成率 */
function groupStats() {
  const acc = tallyMap();
  const g = new Map();
  for (const r of base) {
    const k = r.b + "|" + r.f + "|" + r.s;
    if (!g.has(k)) g.set(k, { b: r.b, f: r.f, s: r.s, total: 0, done: 0 });
    const o = g.get(k);
    o.total++;
    if ((acc.get(bKey(r.b, r.f, r.c)) || 0) > 0) o.done++;
  }
  return Array.from(g.values()).sort((x, y) =>
    x.b.localeCompare(y.b) || floorSort(x.f, y.f) || x.s.localeCompare(y.s));
}

function renderAdmin() {
  if (!base.length && CASES.length) {
    dbAll("baseline").then((all) => {
      if (!all.length) return;
      base = all; baseCase = all[0].case || ""; renderAdmin();
    }).catch(() => {});
  }
  const acc = tallyMap();
  const counted = base.filter((r) => (acc.get(bKey(r.b, r.f, r.c)) || 0) > 0).length;
  const over = base.filter((r) => (acc.get(bKey(r.b, r.f, r.c)) || 0) > r.q).length;
  const pct = base.length ? Math.round(counted / base.length * 1000) / 10 : 0;
  const tallyRecs = records.filter((r) => kindOf(r) === "tally");
  const checkRecs = records.filter((r) => kindOf(r) === "check");
  const failItems = checkRecs.reduce((n, r) => n + ctally(r).fail, 0);
  $("stats").innerHTML =
    `<div class="stat"><b>${tallyRecs.length}</b><span>清查筆數</span></div>
     <div class="stat"><b>${base.length}</b><span>標單項數</span></div>
     <div class="stat ok"><b>${counted}</b><span>已清點項數</span></div>
     <div class="stat${over ? " bad" : ""}"><b>${over}</b><span>超出標單項數</span></div>
     <div class="stat"><b>${pct}%</b><span>完成率</span></div>
     <div class="stat"><b>${checkRecs.length}</b><span>自檢筆數</span></div>
     <div class="stat${failItems ? " bad" : ""}"><b>${failItems}</b><span>自檢缺失項次</span></div>`;

  $("cfgInfo").textContent = base.length
    ? `標單基準：${baseCase || "—"}　${base.length} 項（已存在這台裝置）`
    : "標單基準會在第一次進入清查時自動下載。";

  const rows = groupStats();
  $("tblEmpty").hidden = rows.length > 0;
  $("tbody").innerHTML = rows.map((o) => {
    const p = o.total ? Math.round(o.done / o.total * 1000) / 10 : 0;
    return `<tr><td>${esc(o.b)}</td><td>${esc(o.f)}</td><td>${esc(o.s)}</td>
      <td class="num">${o.total}</td><td class="num">${o.done}</td>
      <td class="num">${p}%</td></tr>`;
  }).join("");

  $("ctblEmpty").hidden = checkRecs.length > 0;
  $("ctbody").innerHTML = checkRecs.map((r) => {
    const c = ctally(r);
    const st = c.fail ? '<span class="pill bad">有缺失</span>'
                      : '<span class="pill ok">合格</span>';
    return `<tr><td class="num">${esc(r.code)}</td><td class="num">${esc(r.date)}</td>
      <td>${esc(r.zone || "")} ${esc(r.floor || "")}</td><td>${esc(r.subproject || "")}</td>
      <td>${esc(r.location || "")}</td><td>${esc(r.inspector || "")}</td>
      <td class="num">${c.pass}</td><td class="num">${c.fail}</td><td>${st}</td></tr>`;
  }).join("");

  paintCloud();
}

/* ---------- 匯出 ---------- */
function book(sheet, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
$("exXlsx").onclick = () => {
  if (!base.length) { toast("尚未匯入案場設定檔"); return; }
  const acc = tallyMap();
  const head = ["棟別", "樓層", "系統", "項次", "項目及說明", "單位",
    "標單數量", "已清點數量", "差異", "完成"];
  const rows = base.map((r) => {
    const done = acc.get(bKey(r.b, r.f, r.c)) || 0;
    return [r.b, r.f, r.s, r.c, r.n, r.u, r.q, done,
      Math.round((done - r.q) * 1000) / 1000, done > 0 ? (done >= r.q ? "足量" : "部分") : ""];
  });
  saveFile("清點統計表_" + todayISO() + ".xlsx", book("清點統計", [head].concat(rows)));
  toast("清點統計表已下載");
};
$("exDetail").onclick = () => {
  if (!records.length) { toast("沒有資料"); return; }
  const head = ["編號", "清點日期", "民國", "案場", "棟別", "樓層", "系統",
    "項次", "項目及說明", "單位", "標單數量", "本次清點", "清點人", "備註", "照片數"];
  const rows = [];
  for (const r of records) for (const l of (r.lines || [])) {
    rows.push([r.code, r.date, roc(r.date), r.caseName || "", r.bldg, r.floor, r.sys,
      l.c, l.n, l.u, l.q, l.got, r.by, r.note || "", (r.photos || []).length]);
  }
  saveFile("清點明細_" + todayISO() + ".xlsx", book("清點明細", [head].concat(rows)));
  toast("清點明細已下載");
};
$("exCheck").onclick = () => {
  const rs = records.filter((r) => kindOf(r) === "check");
  if (!rs.length) { toast("沒有自檢紀錄"); return; }
  const head = ["編號", "檢查日期", "民國", "案場", "區域", "樓層", "檢查位置",
    "分項工程", "施工流程", "抽查時機", "檢查人", "合格", "缺失", "無此項", "結果", "照片數"];
  const rows = rs.map((r) => {
    const c = ctally(r);
    return [r.code, r.date, roc(r.date), r.caseName || "", r.zone || "", r.floor || "",
      r.location || "", r.subproject || "", r.stage || "", r.timing || "", r.inspector || "",
      c.pass, c.fail, c.na, c.fail ? "有缺失" : "全部合格",
      (r.items || []).reduce((n, i) => n + (i.photos || []).length, 0)];
  });
  saveFile("自檢總表_" + todayISO() + ".xlsx", book("自檢總表", [head].concat(rows)));
  toast("自檢總表已下載");
};
$("exFix").onclick = () => {
  const head = ["編號", "檢查日期", "區域樓層", "檢查位置", "分項工程", "施工流程",
    "管理項目", "規定標準", "實際檢查情形", "檢查人", "照片數"];
  const rows = [];
  for (const r of records) {
    if (kindOf(r) !== "check") continue;
    for (const it of (r.items || [])) {
      if (it.result !== "fail") continue;
      rows.push([r.code, r.date, (r.zone || "") + " " + (r.floor || ""), r.location || "",
        r.subproject || "", it.stage || "", it.item || "", it.std || "", it.actual || "",
        r.inspector || "", (it.photos || []).length]);
    }
  }
  if (!rows.length) { toast("沒有缺失項目"); return; }
  saveFile("缺失追蹤表_" + todayISO() + ".xlsx", book("缺失追蹤", [head].concat(rows)));
  toast("缺失追蹤表已下載");
};
$("exZip").onclick = async () => {
  if (!records.length) { toast("沒有資料"); return; }
  toast("照片打包中…");
  const zip = new JSZip();
  let total = 0;
  for (const r of records) {
    const isT = kindOf(r) === "tally";
    const name = isT ? (r.code + "_" + r.bldg + r.floor + "-" + r.sys)
                     : (r.code + "_" + (r.zone || "") + (r.floor || "") + "-" + (r.subproject || ""));
    const dir = zip.folder(safe(name));
    let k = 0;
    if (isT) {
      for (const pid of (r.photos || [])) {
        const p = await dbGet("photos", pid); if (!p) continue;
        k++; total++; dir.file(pad(k, 2) + ".jpg", p.blob);
      }
    } else {
      for (const it of (r.items || [])) for (const pid of (it.photos || [])) {
        const p = await dbGet("photos", pid); if (!p) continue;
        k++; total++; dir.file(pad(k, 2) + "_" + safe(it.item) + ".jpg", p.blob);
      }
    }
  }
  if (!total) { toast("這些清點沒有照片"); return; }
  saveFile("清點照片_" + todayISO() + ".zip", await zip.generateAsync({ type: "blob" }));
  toast("已打包 " + total + " 張照片");
};

/* ---------- 啟動 ---------- */
(async function boot() {
  paintClock();
  setInterval(paintClock, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) paintClock(); });
  try {
    idb = await openDB();
    records = await dbAll("records");
    /* 舊版的 baseline 沒有 case 欄位，留著只會干擾統計 */
    const all = await dbAll("baseline");
    const legacy = all.filter((x) => !x.case);
    if (legacy.length) { await dbClear("baseline"); }
    else if (all.length) { base = all; baseCase = all[0].case || ""; }
  } catch (e) {
    $("offTip").hidden = false;
    $("offTip").textContent = "這個瀏覽器不支援本機儲存，資料無法保存。請改用 Chrome 或 Safari。";
  }
  await loadCases();
  renderCases(); renderList(); paintAdminTab();
  const showOff = () => { $("offTip").hidden = navigator.onLine; };
  window.addEventListener("online", showOff); window.addEventListener("offline", showOff); showOff();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
