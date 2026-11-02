"use strict";
/* 機電施工查驗 — 離線版
   資料存在瀏覽器 IndexedDB（含照片），不上傳任何伺服器。 */

/* ---------- 檢查表範本：取自本案 13.施工查驗 既有自主檢查表 ---------- */
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

/* ---------- 小工具 ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = (n, w) => String(n).padStart(w, "0");
const todayISO = () => { const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2); };
const roc = (iso) => { const p = String(iso).split("-");
  return String(+p[0] - 1911) + pad(p[1], 2) + pad(p[2], 2); };
const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]/g, "");
let toastT;
function toast(m) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = m; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3400);
}
const tally = (r) => { const c = { pass: 0, fail: 0, na: 0 };
  (r.items || []).forEach((i) => { if (c[i.result] !== undefined) c[i.result]++; }); return c; };

/* ---------- 設定（localStorage） ---------- */
const CFG_KEY = "mepcheck.site";
let CFG = { name: "", vendor: "", by: "" };
try { Object.assign(CFG, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); } catch (e) {}
function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) {} }
function paintSite() { $("hdSite").textContent = CFG.name || "尚未設定工地"; }

/* ---------- IndexedDB ---------- */
let idb = null;
function openDB() {
  return new Promise((res, rej) => {
    const q = indexedDB.open("mepcheck", 1);
    q.onupgradeneeded = () => {
      const d = q.result;
      if (!d.objectStoreNames.contains("records")) d.createObjectStore("records", { keyPath: "id" });
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath: "id" });
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

/* ---------- 狀態 ---------- */
let records = [], draft = null, editingId = null, viewing = null;
const photoURL = new Map();                       // photoId -> objectURL（顯示用）
async function urlFor(pid) {
  if (photoURL.has(pid)) return photoURL.get(pid);
  const p = await dbGet("photos", pid);
  if (!p) return "";
  const u = URL.createObjectURL(p.blob); photoURL.set(pid, u); return u;
}

/* ---------- 畫面 ---------- */
const views = ["vList", "vForm", "vAdmin"];
function show(v) {
  views.forEach((x) => { $(x).hidden = x !== v; });
  $("tabSite").setAttribute("aria-pressed", String(v !== "vAdmin"));
  $("tabAdmin").setAttribute("aria-pressed", String(v === "vAdmin"));
  window.scrollTo(0, 0);
}
$("tabSite").onclick = () => show("vList");
$("tabAdmin").onclick = () => { renderAdmin(); show("vAdmin"); };
$("btnBack").onclick = () => { show("vList"); renderList(); };

/* ---------- 工地設定 ---------- */
$("btnSite").onclick = () => {
  $("sName").value = CFG.name; $("sVendor").value = CFG.vendor; $("sBy").value = CFG.by;
  $("dlgSite").showModal();
};
$("dlgSite").addEventListener("close", () => {
  if ($("dlgSite").returnValue !== "ok") return;
  CFG.name = $("sName").value.trim(); CFG.vendor = $("sVendor").value.trim();
  CFG.by = $("sBy").value.trim(); saveCfg(); paintSite(); toast("工地設定已儲存");
});

/* ---------- 表單 ---------- */
const fill = (el, arr, cur) => { el.innerHTML = arr.map((v) =>
  `<option${v === cur ? " selected" : ""}>${esc(v)}</option>`).join(""); };
function seg(el, arr, cur, cb) {
  el.innerHTML = arr.map((v) =>
    `<button type="button" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(v)}</button>`).join("");
  el.querySelectorAll("button").forEach((b) => { b.onclick = () => {
    el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true"); cb(b.dataset.v); }; });
}
const itemsFor = (sub) => (TEMPLATES[sub] || []).map(([stage, item, std]) =>
  ({ stage, item, std, result: "", actual: "", photos: [] }));

function newDraft() {
  const s = Object.keys(TEMPLATES)[0];
  editingId = null;
  draft = { subproject: s, zone: "B區", floor: "B1F", location: "", date: todayISO(),
    stage: "施工中", timing: "不定期抽查", inspector: CFG.by || "", items: itemsFor(s) };
}
function renderForm() {
  fill($("fSub"), Object.keys(TEMPLATES), draft.subproject);
  fill($("fZone"), ZONES, draft.zone); fill($("fFloor"), FLOORS, draft.floor);
  $("fLoc").value = draft.location; $("fDate").value = draft.date; $("fBy").value = draft.inspector;
  seg($("fStage"), STAGES, draft.stage, (v) => { draft.stage = v; });
  seg($("fTiming"), TIMINGS, draft.timing, (v) => { draft.timing = v; });
  $("formCode").textContent = roc(draft.date);
  renderItems();
}
async function renderItems() {
  const parts = [];
  for (let i = 0; i < draft.items.length; i++) {
    const it = draft.items[i];
    const shots = [];
    for (let pi = 0; pi < it.photos.length; pi++) {
      shots.push(`<div class="shot"><img src="${esc(await urlFor(it.photos[pi]))}" alt="">` +
        `<button type="button" data-del="${pi}" aria-label="刪除照片">×</button></div>`);
    }
    parts.push(`<div class="item" data-i="${i}">
      <h4><span class="chip">${esc(it.stage)}</span>${i + 1}. ${esc(it.item)}</h4>
      <div class="std">規定標準：<span class="stdtext">${esc(it.std)}</span>
        <button type="button" class="edit" data-edit>修改標準</button></div>
      <div class="res">${RES.map(([k, l]) =>
        `<button type="button" data-r="${k}" aria-pressed="${it.result === k}">${esc(l)}</button>`).join("")}</div>
      <input type="text" class="actual" placeholder="實際檢查情形（可空白）" value="${esc(it.actual)}">
      <div class="shots">${shots.join("")}
        <button type="button" class="addshot" data-add><span style="font-size:1.3rem">＋</span>照片</button>
      </div></div>`);
  }
  $("itemBox").innerHTML = parts.join("");
  $("itemBox").querySelectorAll(".item").forEach((box) => {
    const i = +box.dataset.i, it = draft.items[i];
    box.querySelectorAll(".res button").forEach((b) => { b.onclick = () => {
      it.result = it.result === b.dataset.r ? "" : b.dataset.r;
      box.querySelectorAll(".res button").forEach((x) =>
        x.setAttribute("aria-pressed", String(x.dataset.r === it.result)));
      paintProgress(); }; });
    box.querySelector(".actual").oninput = (e) => { it.actual = e.target.value; };
    box.querySelector("[data-add]").onclick = () => pick(i);
    box.querySelector("[data-edit]").onclick = () => {
      const cur = it.std;
      const v = window.prompt ? null : null;            // 行動裝置不用 prompt，改用內嵌輸入
      const span = box.querySelector(".stdtext");
      const inp = document.createElement("input");
      inp.type = "text"; inp.value = cur; inp.style.marginTop = ".25rem";
      span.replaceWith(inp); inp.focus();
      inp.onblur = () => { it.std = inp.value.trim() || cur;
        const s2 = document.createElement("span"); s2.className = "stdtext"; s2.textContent = it.std;
        inp.replaceWith(s2); };
    };
    box.querySelectorAll("[data-del]").forEach((b) => { b.onclick = async () => {
      it.photos.splice(+b.dataset.del, 1); await renderItems(); }; });
  });
  paintProgress();
}
function paintProgress() {
  const n = draft.items.filter((i) => i.result).length;
  $("progress").textContent = `已標記 ${n}/${draft.items.length} 項`;
}
$("fSub").onchange = (e) => { draft.subproject = e.target.value;
  draft.items = itemsFor(draft.subproject); renderItems(); };
$("fZone").onchange = (e) => { draft.zone = e.target.value; };
$("fFloor").onchange = (e) => { draft.floor = e.target.value; };
$("fLoc").oninput = (e) => { draft.location = e.target.value; };
$("fBy").oninput = (e) => { draft.inspector = e.target.value; };
$("fDate").onchange = (e) => { draft.date = e.target.value; $("formCode").textContent = roc(draft.date); };
$("btnNew").onclick = () => { newDraft(); renderForm(); show("vForm"); };

/* ---------- 照片 ---------- */
function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob((b) => b ? res(b) : rej(new Error("壓縮失敗")), "image/jpeg", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("讀不到這張照片")); };
    img.src = u;
  });
}
function pick(i) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment"; inp.multiple = true;
  inp.onchange = async () => {
    const fs = Array.from(inp.files || []); if (!fs.length) return;
    toast("處理照片中…");
    for (const f of fs) {
      try {
        const blob = await shrink(f);
        const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        await dbPut("photos", { id, blob });
        draft.items[i].photos.push(id);
      } catch (e) { toast("照片處理失敗：" + e.message); }
    }
    await renderItems(); toast("已加入照片");
  };
  inp.click();
}

/* ---------- 儲存 ---------- */
$("btnSave").onclick = async () => {
  if (!CFG.name) { toast("請先按右上「✎ 工地」設定工程名稱"); $("btnSite").click(); return; }
  if (!draft.location.trim()) { toast("請填檢查位置"); $("fLoc").focus(); return; }
  if (!draft.inspector.trim()) { toast("請填檢查人"); $("fBy").focus(); return; }
  if (!draft.items.filter((i) => i.result).length) { toast("至少要標記一項檢查結果"); return; }
  const day = roc(draft.date);
  let code;
  if (editingId) {
    code = records.find((r) => r.id === editingId).code;
  } else {
    const n = records.filter((r) => roc(r.date) === day).length + 1;
    code = day + "-" + pad(n, 2);
  }
  const c = tally(draft);
  const rec = Object.assign({}, draft, {
    id: editingId || ("r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    code, site: CFG.name, vendor: CFG.vendor,
    result: c.fail > 0 ? "fail" : "pass",
    fixed: editingId ? (records.find((r) => r.id === editingId).fixed || false) : false,
    savedAt: Date.now()
  });
  await dbPut("records", rec);
  records = await dbAll("records");
  toast("已儲存 " + code);
  show("vList"); renderList();
};

/* ---------- 清單 ---------- */
function sortRecs() {
  records.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
function renderList() {
  sortRecs();
  const box = $("listBox");
  if (!records.length) {
    box.innerHTML = `<div class="empty"><div class="big">📋</div><div>尚未有查驗紀錄</div>
      <div class="tiny" style="margin-top:.3rem">按上方「新增查驗」開始第一筆</div></div>`;
    return;
  }
  box.innerHTML = records.map((r) => {
    const c = tally(r);
    const pill = r.result === "fail"
      ? (r.fixed ? '<span class="pill fixed">已改善</span>' : `<span class="pill bad">缺失 ${c.fail}</span>`)
      : '<span class="pill ok">合格</span>';
    return `<div class="rec" data-id="${esc(r.id)}"><div style="min-width:0;flex:1">
      <div style="font-weight:500">${esc(r.subproject)}</div>
      <div class="tiny muted">${esc(r.zone)} ${esc(r.floor)}・${esc(r.location)}</div>
      <div class="tiny mono muted">${esc(r.code)}　${esc(r.date)}　${esc(r.stage)}　${esc(r.inspector)}</div>
      </div><div>${pill}</div></div>`;
  }).join("");
  box.querySelectorAll(".rec").forEach((el) => { el.onclick = () => editRecord(el.dataset.id); });
}
function editRecord(id) {
  const r = records.find((x) => x.id === id); if (!r) return;
  editingId = id;
  draft = JSON.parse(JSON.stringify(r));
  renderForm(); show("vForm");
}

/* ---------- 列印 ---------- */
$("btnPrint").onclick = async () => {
  const c = tally(draft);
  const rows = draft.items.map((it, i) => `<tr>
    <td style="text-align:center">${i + 1}</td><td>${esc(it.stage)}</td><td>${esc(it.item)}</td>
    <td>${esc(it.std)}</td><td>${esc(it.actual || "")}</td>
    <td style="text-align:center">${esc(MARK[it.result] || "")}</td></tr>`).join("");
  const shots = [];
  for (const it of draft.items) for (const pid of it.photos) {
    shots.push(`<div class="ph"><img src="${esc(await urlFor(pid))}" alt="">
      <div style="font-size:8pt">${esc(it.item)}　${esc(it.actual || "")}</div></div>`);
  }
  $("printArea").innerHTML = `
    <h2>施工自主檢查表</h2>
    <table><tbody>
      <tr><th style="width:18%">工程名稱</th><td colspan="3">${esc(draft.site || CFG.name)}</td></tr>
      <tr><th>承攬廠商</th><td>${esc(draft.vendor || CFG.vendor)}</td>
          <th style="width:18%">分項工程</th><td>${esc(draft.subproject)}</td></tr>
      <tr><th>檢查位置</th><td>${esc(draft.zone)} ${esc(draft.floor)} ${esc(draft.location)}</td>
          <th>檢查日期</th><td>民國 ${esc(roc(draft.date))}</td></tr>
      <tr><th>施工流程</th><td>${esc(draft.stage)}</td><th>抽查時機</th><td>${esc(draft.timing)}</td></tr>
      <tr><th>檢查人</th><td>${esc(draft.inspector)}</td>
          <th>檢查結果</th><td>合格 ${c.pass}　缺失 ${c.fail}　無此項 ${c.na}</td></tr>
    </tbody></table>
    <p style="margin:6pt 0 3pt">結果標記：○ 檢查合格　╳ 有缺失需改正　／ 無此檢查項目</p>
    <table><thead><tr><th>項次</th><th>施工流程</th><th>管理項目</th>
      <th>抽查標準（定量定性）</th><th>實際抽查情形</th><th>抽查結果</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <table style="margin-top:8pt"><tbody><tr>
      <th style="width:25%">檢查人簽名</th><td style="height:46pt"></td>
      <th style="width:25%">監造單位簽名</th><td></td></tr></tbody></table>
    ${shots.length ? '<h3 style="margin-top:10pt">自主檢查照片</h3>' + shots.join("") : ""}`;
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
  zip.file("records.json", JSON.stringify({ site: CFG, records }, null, 1));
  const pf = zip.folder("photos");
  const photos = await dbAll("photos");
  const used = new Set();
  records.forEach((r) => r.items.forEach((i) => (i.photos || []).forEach((p) => used.add(p))));
  photos.forEach((p) => { if (used.has(p.id)) pf.file(p.id + ".jpg", p.blob); });
  saveFile("機電查驗備份_" + (CFG.by || "現場") + "_" + todayISO() + ".zip",
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
    toast("已匯入 " + added + " 筆查驗");
  };
  inp.click();
};

/* ---------- 後台 ---------- */
function renderAdmin() {
  sortRecs();
  const openFail = records.filter((r) => r.result === "fail" && !r.fixed).length;
  const failItems = records.reduce((n, r) => n + tally(r).fail, 0);
  $("stats").innerHTML =
    `<div class="stat"><b>${records.length}</b><span>查驗總數</span></div>
     <div class="stat ok"><b>${records.filter((r) => r.result === "pass").length}</b><span>全部合格</span></div>
     <div class="stat bad"><b>${openFail}</b><span>缺失未改善</span></div>
     <div class="stat"><b>${failItems}</b><span>缺失項次</span></div>`;
  $("tblEmpty").hidden = records.length > 0;
  $("tbody").innerHTML = records.map((r) => {
    const c = tally(r);
    const st = r.result === "pass" ? '<span class="pill ok">合格</span>'
      : r.fixed ? '<span class="pill fixed">已改善</span>' : '<span class="pill bad">待改善</span>';
    return `<tr><td class="num">${esc(r.code)}</td><td class="num">${esc(r.date)}</td>
      <td>${esc(r.zone)} ${esc(r.floor)}</td><td>${esc(r.subproject)}</td><td>${esc(r.stage)}</td>
      <td>${esc(r.location)}</td><td>${esc(r.inspector)}</td>
      <td class="num">${c.pass}</td><td class="num">${c.fail}</td><td>${st}</td>
      <td><button class="btn sm" data-fix="${esc(r.id)}"${r.result === "fail" && !r.fixed ? "" : " hidden"}>標記已改善</button></td></tr>`;
  }).join("");
  $("tbody").querySelectorAll("[data-fix]").forEach((b) => { b.onclick = async () => {
    const r = records.find((x) => x.id === b.dataset.fix); if (!r) return;
    r.fixed = true; await dbPut("records", r); renderAdmin(); toast("已標記為改善完成"); }; });
}

/* ---------- 匯出 ---------- */
const book = (name, rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};
$("exXlsx").onclick = () => {
  if (!records.length) { toast("沒有資料"); return; }
  const head = ["編號", "檢查日期", "民國", "工程名稱", "區域", "樓層", "檢查位置", "分項工程",
    "施工流程", "抽查時機", "檢查人", "項目數", "合格", "缺失", "無此項", "結果", "改善狀態"];
  const body = records.map((r) => { const c = tally(r);
    return [r.code, r.date, roc(r.date), r.site || "", r.zone, r.floor, r.location, r.subproject,
      r.stage, r.timing, r.inspector, r.items.length, c.pass, c.fail, c.na,
      c.fail ? "有缺失" : "合格", c.fail ? (r.fixed ? "已改善" : "待改善") : "—"]; });
  saveFile("機電施工查驗_清查總表_" + todayISO() + ".xlsx", book("清查總表", [head].concat(body)));
  toast("清查總表已下載");
};
$("exFix").onclick = () => {
  const out = [];
  records.forEach((r) => r.items.forEach((it) => { if (it.result === "fail")
    out.push([r.code, r.date, r.zone + " " + r.floor, r.location, r.subproject, it.stage,
      it.item, it.std, it.actual || "", r.inspector, r.fixed ? "已改善" : "待改善",
      (it.photos || []).length]); }));
  if (!out.length) { toast("沒有缺失項目"); return; }
  const head = ["編號", "檢查日期", "區域樓層", "檢查位置", "分項工程", "施工流程",
    "管理項目", "抽查標準", "實際抽查情形", "檢查人", "改善狀態", "照片數"];
  saveFile("機電施工查驗_缺失追蹤表_" + todayISO() + ".xlsx", book("缺失追蹤", [head].concat(out)));
  toast("缺失追蹤表已下載");
};
$("exZip").onclick = async () => {
  if (!records.length) { toast("沒有資料"); return; }
  toast("照片打包中…");
  const zip = new JSZip();
  let total = 0;
  for (const r of records) {
    const dir = zip.folder(r.code + "_" + r.zone + r.floor + "-" + r.subproject).folder("自檢照片");
    let k = 0;
    for (const it of r.items) for (const pid of (it.photos || [])) {
      const p = await dbGet("photos", pid); if (!p) continue;
      k++; total++;
      dir.file(pad(k, 2) + "_" + safe(it.item) + ".jpg", p.blob);
    }
  }
  if (!total) { toast("這些查驗沒有照片"); return; }
  saveFile("機電施工查驗_自檢照片_" + todayISO() + ".zip", await zip.generateAsync({ type: "blob" }));
  toast("照片已打包（" + total + " 張）");
};
$("exDocx").onclick = async () => {
  if (typeof docx === "undefined") { toast("Word 元件未載入，請在有網路時再試"); return; }
  if (!records.length) { toast("沒有資料"); return; }
  const rows = records.slice(0, 20);
  toast("產生 Word 中…");
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, ImageRun } = docx;
  const F = "微軟正黑體";
  const tx2 = (t, o) => new TextRun(Object.assign({ text: String(t == null ? "" : t), font: F, size: 20 }, o || {}));
  const p = (t, o) => new Paragraph({ children: [tx2(t, o)] });
  const cell = (t, w, b) => new TableCell({ width: { size: w, type: WidthType.DXA },
    children: [new Paragraph({ children: [tx2(t, { bold: b, size: 18 })] })] });
  const secs = [];
  for (const r of rows) {
    const kids = [
      new Paragraph({ children: [tx2("施工自主檢查表", { bold: true, size: 30 })],
        alignment: AlignmentType.CENTER }),
      p("工程名稱：" + (r.site || "")),
      p("分項工程：" + r.subproject + "　承攬廠商：" + (r.vendor || "")),
      p("檢查位置：" + r.zone + " " + r.floor + " " + r.location + "　檢查日期：民國 " + roc(r.date)),
      p("施工流程：" + r.stage + "　抽查時機：" + r.timing + "　檢查人：" + r.inspector),
      p(""),
      new Table({ width: { size: 9360, type: WidthType.DXA },
        columnWidths: [1100, 1900, 2700, 2200, 1460],
        rows: [new TableRow({ tableHeader: true, children: [
          cell("施工流程", 1100, 1), cell("管理項目", 1900, 1), cell("抽查標準", 2700, 1),
          cell("實際抽查情形", 2200, 1), cell("抽查結果", 1460, 1)] })]
          .concat(r.items.map((it) => new TableRow({ children: [
            cell(it.stage, 1100), cell(it.item, 1900), cell(it.std, 2700),
            cell(it.actual || "", 2200), cell(MARK[it.result] || "", 1460)] }))) })];
    for (const it of r.items) for (const pid of (it.photos || [])) {
      const ph = await dbGet("photos", pid); if (!ph) continue;
      kids.push(new Paragraph({ children: [new ImageRun({ type: "jpg",
        data: await ph.blob.arrayBuffer(), transformation: { width: 300, height: 225 } })] }));
      kids.push(p(it.item + "　" + (it.actual || ""), { size: 16 }));
    }
    secs.push({ children: kids });
  }
  saveFile("自主檢查表_" + (rows.length === 1 ? rows[0].code : rows.length + "份") + ".docx",
    await Packer.toBlob(new Document({ sections: secs })));
  toast("自主檢查表已下載");
};

/* ---------- 啟動 ---------- */
(async function boot() {
  paintSite();
  try {
    idb = await openDB();
    records = await dbAll("records");
  } catch (e) {
    $("offTip").hidden = false;
    $("offTip").textContent = "這個瀏覽器不支援本機儲存，資料無法保存。請改用 Chrome 或 Safari。";
  }
  newDraft(); renderList();
  if (!CFG.name) setTimeout(() => $("btnSite").click(), 400);
  const showOff = () => { $("offTip").hidden = navigator.onLine; };
  window.addEventListener("online", showOff); window.addEventListener("offline", showOff); showOff();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
