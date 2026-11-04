#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""產生「案場設定檔」。

從標單的數量分配表產生 App 要用的基準資料，並把兩組密碼加鹽雜湊後寫進去。
產出的 json 用 LINE 或 Email 發給同仁，在 App 的後台匯入。

    python tools/make-pack.py 數量分配表.xlsx --案場 淡水高生物案 \
        --案場密碼 2024 --管理者密碼 你的密碼 -o 案場設定檔.json

產出的檔案裡**沒有明碼密碼**，也**沒有單價與複價**，只有清點要用的欄位。
這個檔不要放進版控：repo 的 .gitignore 已經擋掉了。
"""

import argparse
import datetime
import hashlib
import json
import os
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("需要 openpyxl：pip install openpyxl")


def grab(ws, cols):
    """照欄位名稱取值，不依賴欄位順序。"""
    it = ws.iter_rows(values_only=True)
    head = list(next(it))
    missing = [c for c in cols if c not in head]
    if missing:
        raise SystemExit("分頁「%s」缺少欄位：%s" % (ws.title, "、".join(missing)))
    idx = [head.index(c) for c in cols]
    for row in it:
        if row[idx[0]] is None:
            continue
        yield [row[i] for i in idx]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx", help="機電承攬項目數量分配表.xlsx")
    ap.add_argument("--案場", required=True)
    ap.add_argument("--案場代號", default="case1")
    ap.add_argument("--說明", default="現場清點・比對標單")
    ap.add_argument("--案場密碼", required=True)
    ap.add_argument("--管理者密碼", required=True)
    ap.add_argument("--鹽", default=None, help="預設由案場代號產生")
    ap.add_argument("-o", "--out", default="案場設定檔.json")
    a = ap.parse_args()

    salt = a.鹽 or ("mepcheck.v1." + a.案場代號)
    h = lambda p: hashlib.sha256((salt + ":" + p).encode("utf-8")).hexdigest()

    wb = openpyxl.load_workbook(a.xlsx, read_only=True, data_only=True)
    rows = []

    # 分層分攤的項目
    for sys_, bldg, code, name, unit, floor, qty in grab(
            wb["數量分配表"],
            ["系統", "棟別", "項次", "項目及說明", "單位", "樓層", "分攤數量"]):
        if not qty:
            continue
        rows.append({"s": sys_, "b": bldg, "f": floor, "c": code,
                     "n": name, "u": unit, "q": round(float(qty), 3)})
    n_alloc = len(rows)

    # 配電盤：只標位置，數量照原值
    if "配電盤項目" in wb.sheetnames:
        for sys_, bldg, code, name, unit, floor, qty in grab(
                wb["配電盤項目"],
                ["系統", "棟別", "項次", "項目及說明", "單位", "樓層位置", "數量"]):
            if not qty:
                continue
            rows.append({"s": sys_, "b": bldg, "f": floor or "未定", "c": code,
                         "n": name, "u": unit, "q": round(float(qty), 3)})
    wb.close()

    pack = {
        "版本": 1,
        "案場": a.案場,
        "案場代號": a.案場代號,
        "說明": a.說明,
        "來源": os.path.basename(a.xlsx),
        "產生日期": datetime.date.today().isoformat(),
        "鹽": salt,
        "案場密碼雜湊": h(a.案場密碼),
        "管理者密碼雜湊": h(a.管理者密碼),
        "項目": rows,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))

    kb = round(os.path.getsize(a.out) / 1024)
    print("分配表 %d 列、配電盤 %d 列，合計 %d 項" % (n_alloc, len(rows) - n_alloc, len(rows)))
    print("%s　%d KB" % (a.out, kb))
    print("提醒：這個檔含標單數量，不要放進公開的版控。")


if __name__ == "__main__":
    main()
