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

const PACK_KEY = "mepcheck.pack";          // 案場設定檔的檔頭（不含項目）
let PACK = null;
try { PACK = JSON.parse(localStorage.getItem(PACK_KEY) || "null"); } catch (e) {}
function savePack() {
  try {
    if (PACK) localStorage.setItem(PACK_KEY, JSON.stringify(PACK));
    else localStorage.removeItem(PACK_KEY);
  } catch (e) {}
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
const views = ["vList", "vForm", "vAdmin"];
function show(v) {
  views.forEach((x) => { $(x).hidden = x !== v; });
  $("hero").hidden = v === "vForm";
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
  if (PACK && !CASES.some((c) => c.代號 === PACK.案場代號)) {
    CASES.push({ 代號: PACK.案場代號, 名稱: PACK.案場, 副標: PACK.說明 || "",
      圖示: "🏗", 功能: ["清查"] });
  }
}

/* 這個案場的設定檔進來了沒 */
const packOf = (c) => (PACK && PACK.案場代號 === c.代號) ? PACK : null;

function renderCases() {
  const box = $("caseBox");
  if (!CASES.length) {
    box.innerHTML = `<div class="card pad tiny muted" style="text-align:center">
      還沒有任何案場</div>`;
    return;
  }
  box.innerHTML = CASES.map((c, i) => {
    const p = packOf(c);
    const sub = p ? `${esc(c.副標 || "")}・${p.項目數} 項`
                  : `${esc(c.副標 || "")}・尚未匯入設定檔`;
    return `<button class="case" data-i="${i}">
      <span class="ic">${esc(c.圖示 || "🏗")}</span>
      <span class="tx"><b>${esc(c.名稱)}</b><span>${sub}</span></span>
      <span class="go">${p ? "🔒" : "⬇"}</span>
    </button>`;
  }).join("");

  box.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => {
      const c = CASES[+b.dataset.i];
      const p = packOf(c);
      if (!p) {
        toast("「" + c.名稱 + "」還沒有設定檔，請管理者在後台匯入");
        return;
      }
      pendingCase = p;
      $("whoCase").textContent = c.名稱;
      $("whoPassRow").hidden = !p.案場密碼雜湊;
      $("whoPass").value = "";
      $("whoName").value = CFG.by || "";
      $("dlgWho").showModal();
    };
  });
}

$("dlgWho").addEventListener("close", async () => {
  if ($("dlgWho").returnValue !== "ok" || !pendingCase) return;
  const who = $("whoName").value.trim();
  if (!who) { toast("請填清點人員姓名"); return; }
  if (pendingCase.案場密碼雜湊) {
    const p = $("whoPass").value; $("whoPass").value = "";
    if (!p) { toast("請輸入案場密碼"); return; }
    if (await sha256(pendingCase.鹽 + ":" + p) !== pendingCase.案場密碼雜湊) {
      toast("案場密碼不正確"); return;
    }
  }
  CFG.by = who; saveCfg();
  newDraft(who);
  await renderForm();
  show("vForm");
});

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
    code, caseName: (PACK && PACK.案場) || "", caseId: (PACK && PACK.案場代號) || "",
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

function renderList() {
  sortRecs();
  const box = $("listBox");
  if (!records.length) {
    box.innerHTML = `<div class="empty"><div class="big">📋</div><div>尚未有清點紀錄</div>
      <div class="tiny" style="margin-top:.3rem">按上方的案場開始第一筆</div></div>`;
    return;
  }
  box.innerHTML = records.map((r) => {
    const over = (r.lines || []).some((l) => num(l.got) > num(l.q));
    const pill = over ? '<span class="pill bad">有超量</span>'
      : `<span class="pill ok">${(r.lines || []).length} 項</span>`;
    return `<div class="rec" data-id="${esc(r.id)}"><div style="min-width:0;flex:1">
      <div style="font-weight:700">${esc(r.bldg)} ${esc(r.floor)}・${esc(r.sys)}</div>
      <div class="tiny muted">${esc(r.note || "")}</div>
      <div class="tiny mono muted">${esc(r.code)}　${esc(r.date)}　${esc(r.by)}
        ${(r.photos || []).length ? "　📷" + r.photos.length : ""}</div>
      </div><div>${pill}</div></div>`;
  }).join("");
  box.querySelectorAll(".rec").forEach((el) => { el.onclick = () => editRecord(el.dataset.id); });
}

async function editRecord(id) {
  const r = records.find((x) => x.id === id); if (!r) return;
  editingId = id;
  draft = { code: r.code, bldg: r.bldg, floor: r.floor, sys: r.sys, date: r.date,
    by: r.by, note: r.note || "", got: {}, photos: (r.photos || []).slice() };
  for (const l of r.lines || []) draft.got[l.c] = String(l.got);
  await renderForm();
  show("vForm");
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
      <tr><th style="width:18%">案場</th><td colspan="3">${esc((PACK && PACK.案場) || "")}</td></tr>
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
  zip.file("records.json", JSON.stringify({ me: CFG, pack: PACK, records }, null, 1));
  const pf = zip.folder("photos");
  const photos = await dbAll("photos");
  const used = new Set();
  records.forEach((r) => (r.photos || []).forEach((p) => used.add(p)));
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
async function loadPack(obj) {
  if (!obj || !Array.isArray(obj.項目)) throw new Error("不是案場設定檔");
  await dbClear("baseline");
  const store = idb.transaction("baseline", "readwrite").objectStore("baseline");
  for (const r of obj.項目) store.put({ k: bKey(r.b, r.f, r.c), ...r });
  await new Promise((res, rej) => {
    store.transaction.oncomplete = res; store.transaction.onerror = () => rej(store.transaction.error);
  });
  PACK = { 版本: obj.版本, 案場: obj.案場, 案場代號: obj.案場代號, 說明: obj.說明,
    來源: obj.來源, 產生日期: obj.產生日期, 鹽: obj.鹽,
    案場密碼雜湊: obj.案場密碼雜湊 || "", 管理者密碼雜湊: obj.管理者密碼雜湊 || "",
    項目數: obj.項目.length };
  savePack();
  base = await dbAll("baseline");
}
$("btnCfgIn").onclick = () => {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = async () => {
    const f = (inp.files || [])[0]; if (!f) return;
    toast("匯入中…");
    try {
      await loadPack(JSON.parse(await f.text()));
      await loadCases();
      renderCases(); renderAdmin();
      toast("已匯入 " + PACK.案場 + "　" + PACK.項目數 + " 項");
    } catch (e) { toast("匯入失敗：" + e.message); }
  };
  inp.click();
};
$("btnCfgOut").onclick = async () => {
  if (!PACK || !base.length) { toast("還沒有案場設定檔"); return; }
  const obj = Object.assign({}, PACK);
  delete obj.項目數;
  obj.項目 = base.map(({ k, ...r }) => r);
  saveFile("職人百寶箱_案場設定檔_" + safe(PACK.案場) + ".json",
    new Blob([JSON.stringify(obj)], { type: "application/json" }));
  toast("已匯出，請用 LINE 傳給同仁");
};

/* ---------- 管理者 ----------
   密碼雜湊來自案場設定檔，不在這個網站的程式裡。 */
let adminOn = false;
function paintAdminTab() {
  $("tabAdmin").hidden = !adminOn;
  if (!adminOn && !$("vAdmin").hidden) show("vList");
}
$("btnAdmin").onclick = () => {
  if (!PACK || !PACK.管理者密碼雜湊) {
    toast("這台裝置還沒有案場設定檔，無法驗證管理者密碼"); return;
  }
  $("admPass").value = "";
  $("dlgAdmin").showModal();
};
$("dlgAdmin").addEventListener("close", async () => {
  if ($("dlgAdmin").returnValue !== "ok") return;
  const v = $("admPass").value; $("admPass").value = "";
  if (!v) { toast("請輸入密碼"); return; }
  if (await sha256(PACK.鹽 + ":" + v) !== PACK.管理者密碼雜湊) { toast("密碼不正確"); return; }
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
      for (const pid of (r.photos || [])) {
        const ph = await dbGet("photos", pid); if (!ph) continue;
        photos.push({ id: pid, b64: await blobToB64(ph.blob) });
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
  const acc = tallyMap();
  const counted = base.filter((r) => (acc.get(bKey(r.b, r.f, r.c)) || 0) > 0).length;
  const over = base.filter((r) => (acc.get(bKey(r.b, r.f, r.c)) || 0) > r.q).length;
  const pct = base.length ? Math.round(counted / base.length * 1000) / 10 : 0;
  $("stats").innerHTML =
    `<div class="stat"><b>${records.length}</b><span>清點筆數</span></div>
     <div class="stat"><b>${base.length}</b><span>標單項數</span></div>
     <div class="stat ok"><b>${counted}</b><span>已清點項數</span></div>
     <div class="stat${over ? " bad" : ""}"><b>${over}</b><span>超出標單項數</span></div>
     <div class="stat"><b>${pct}%</b><span>完成率</span></div>`;

  $("cfgInfo").textContent = PACK
    ? `案場設定檔：${PACK.案場}　${PACK.項目數} 項　產生於 ${PACK.產生日期 || "—"}`
    : "尚未匯入案場設定檔，現場無法開始清點。";

  const rows = groupStats();
  $("tblEmpty").hidden = rows.length > 0;
  $("tbody").innerHTML = rows.map((o) => {
    const p = o.total ? Math.round(o.done / o.total * 1000) / 10 : 0;
    return `<tr><td>${esc(o.b)}</td><td>${esc(o.f)}</td><td>${esc(o.s)}</td>
      <td class="num">${o.total}</td><td class="num">${o.done}</td>
      <td class="num">${p}%</td></tr>`;
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
$("exZip").onclick = async () => {
  if (!records.length) { toast("沒有資料"); return; }
  toast("照片打包中…");
  const zip = new JSZip();
  let total = 0;
  for (const r of records) {
    const dir = zip.folder(safe(r.code + "_" + r.bldg + r.floor + "-" + r.sys));
    let k = 0;
    for (const pid of (r.photos || [])) {
      const p = await dbGet("photos", pid); if (!p) continue;
      k++; total++;
      dir.file(pad(k, 2) + ".jpg", p.blob);
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
    base = await dbAll("baseline");
    if (PACK) PACK.項目數 = base.length;
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
