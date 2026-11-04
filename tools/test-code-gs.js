/* 在 node 裡假造 Apps Script 環境，實跑 push_ 檢查欄位對不對得上。
 *
 * 用法：在專案根目錄執行  node tools/test-code-gs.js
 *
 * 為什麼要有這支：Code.gs 只能在 Google 上跑，改完無法立刻驗證。
 * 之前就發生過紀錄結構換了、Code.gs 沒跟上，上傳不報錯但寫出空白資料。
 * 這支把 SpreadsheetApp / DriveApp 等換成假的，直接檢查每一列的欄數
 * 是否與表頭一致、重傳會不會變成兩筆。
 */
const fs = require("fs");
const src = fs.readFileSync("cloud/Code.gs", "utf8");

const sheets = {};
function mkSheet(name) {
  return {
    name, rows: [],
    getName: () => name,
    getLastRow() { return this.rows.length; },
    setFrozenRows() {},
    appendRow(r) { this.rows.push(r.slice()); },
    deleteRow(i) { this.rows.splice(i - 1, 1); },
    getRange(r, c, nr, nc) {
      const sh = this;
      return {
        setValues(vals) {
          vals.forEach((v, k) => {
            if (v.length !== nc) {
              throw new Error(`[${name}] 第 ${k + 1} 列有 ${v.length} 欄，但 setValues 宣告 ${nc} 欄`);
            }
            sh.rows[r - 1 + k] = v.slice();
          });
          return this;
        },
        getValues() {
          const out = [];
          for (let k = 0; k < nr; k++) {
            const row = sh.rows[r - 1 + k] || [];
            out.push(row.slice(c - 1, c - 1 + nc));
          }
          return out;
        },
        setFontWeight() { return this; },
      };
    },
  };
}

const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = mkSheet(n)),
  getSheets: () => Object.values(sheets),
  getId: () => "sheet1",
  getUrl: () => "http://sheet",
  deleteSheet() {},
};

global.SpreadsheetApp = { openById: () => ss, create: () => ss };
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => ({ PASSCODE: "pw", SHEET_ID: "s", FOLDER_ID: "f" }[k]),
    setProperty() {},
  }),
};
const made = [];
const folder = {
  getFoldersByName: () => ({ hasNext: () => false }),
  createFolder(n) { made.push(n); return folder; },
  getFiles: () => ({ hasNext: () => false }),
  getFolders: () => ({ hasNext: () => false }),
  createFile(b) { made.push("file:" + b.name); return {}; },
  getId: () => "fid",
};
global.DriveApp = { getFolderById: () => folder, createFolder: () => folder };
global.Utilities = {
  newBlob: (bytes, type, name) => ({ name }),
  base64Decode: () => [1, 2, 3],
};
global.ContentService = {
  MimeType: { JSON: "json" },
  createTextOutput: (t) => ({ setMimeType: () => t }),
};
global.HtmlService = { createHtmlOutput: (h) => h };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.Logger = { log() {} };

eval(src);

/* ---- 資料 ---- */
const tally = {
  kind: "tally", code: "1151104-02", date: "2026-11-04", caseName: "淡水高生物案",
  bldg: "B棟", floor: "筏基層", sys: "弱電設備工程", by: "黃工程師", note: "北側已完成",
  lines: [
    { c: "壹.一.3.1.3.1.3", n: "金屬塑線槽", u: "M", q: 7.866, got: 3.933 },
    { c: "壹.一.3.2.1.1.1.2", n: "出線盒", u: "式", q: 0.029, got: 3.029 },
  ],
  photos: ["p1"],
};
const check = {
  kind: "check", code: "1151104-01", date: "2026-11-04", caseName: "淡水高生物案",
  zone: "B區", floor: "B1F", location: "B1F 電氣室上方橋架", subproject: "電氣配管工程",
  stage: "施工中", timing: "不定期抽查", inspector: "黃工程師",
  items: [
    { stage: "施工前", item: "管路廠牌", std: "億豐", result: "pass", actual: "", photos: [] },
    { stage: "施工中", item: "放樣", std: "依施工圖", result: "fail",
      actual: "支架間距 2.4m 超出圖說", photos: ["p2"] },
  ],
};

const fails = [];
function run(label, rec, photos) {
  try {
    const out = push_(rec, photos);
    console.log(`  ${label}：ok kind=${out.kind} count=${out.count} photos=${out.photos}`);
  } catch (e) {
    fails.push(label + "：" + e.message);
    console.log(`  ${label}：失敗 ${e.message}`);
  }
}

console.log("第一次上傳");
run("清查", tally, [{ id: "p1", b64: "x" }]);
run("自檢", check, [{ id: "p2", item: "放樣", b64: "x" }]);
console.log("重傳同一筆（應覆蓋不重複）");
run("清查", tally, [{ id: "p1", b64: "x" }]);
run("自檢", check, [{ id: "p2", item: "放樣", b64: "x" }]);

console.log("\n分頁內容");
for (const [n, sh] of Object.entries(sheets)) {
  console.log(`  ${n}：表頭 ${sh.rows[0].length} 欄，資料 ${sh.rows.length - 1} 列`);
  for (let i = 1; i < sh.rows.length; i++) {
    if (sh.rows[i].length !== sh.rows[0].length) {
      fails.push(`${n} 第 ${i} 列欄數 ${sh.rows[i].length} ≠ 表頭 ${sh.rows[0].length}`);
    }
  }
}
console.log("\n建立的雲端硬碟項目");
made.forEach((m) => console.log("  " + m));

console.log("\n清查紀錄第一列：", JSON.stringify(sheets["清查紀錄"].rows[1]));
console.log("自檢紀錄第一列：", JSON.stringify(sheets["自檢紀錄"].rows[1]));
console.log("自檢明細第一列：", JSON.stringify(sheets["自檢明細"].rows[1]));

if (fails.length) {
  console.log("\n失敗：");
  fails.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\n全部通過");
