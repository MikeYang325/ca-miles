#!/usr/bin/env python3
"""Serve the minimal PhoenixMiles calculator and proxy its official endpoint."""

from __future__ import annotations

import json
import re
import ast
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OFFICIAL_URL = "https://ffp.airchina.com.cn/apigateway/user/jsonp/mileageCumulateCalculation"
OFFICIAL_AIRPORTS_URL = "https://ffp.airchina.com.cn/resources/airport_code_me_me_mc_2_v3.js"
GRADES = {"Normal", "Junior", "Silver", "Gold", "Platinum", "LifetimePlatinum"}
SUPPLEMENTAL_AIRPORTS = [
    {"name": "萨格勒布机场", "pinyin": "Zagreb", "code": "ZAG", "initials": "sglb", "city": "萨格勒布"},
]


def query_official_airports() -> list[dict]:
    request = urllib.request.Request(
        OFFICIAL_AIRPORTS_URL,
        headers={
            "Accept": "*/*",
            "Referer": "https://ffp.airchina.com.cn/plan/mileage_accumulate_calculator.html",
            "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/151 Safari/537.36",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        source = response.read().decode("utf-8")
    match = re.search(r"airportcodes\s*=\s*(\[[\s\S]*?\])\s*;?\s*$", source)
    if not match:
        raise ValueError("国航机场数据格式异常")
    records = ast.literal_eval(match.group(1))
    airports = []
    for record in records:
        parts = str(record).split("|")
        if len(parts) < 5 or not re.fullmatch(r"[A-Z]{3}", parts[2].upper()):
            continue
        airports.append({"name": parts[0], "pinyin": parts[1], "code": parts[2].upper(), "initials": parts[3], "city": parts[4]})
    if not airports:
        raise ValueError("国航未返回机场数据")
    known_codes = {airport["code"] for airport in airports}
    airports.extend(airport for airport in SUPPLEMENTAL_AIRPORTS if airport["code"] not in known_codes)
    return airports


def clean_segment(raw: dict) -> dict:
    return {
        "flightDate": str(raw.get("flightDate", "")),
        "flightNo": re.sub(r"\s+", "", str(raw.get("flightNo", "")).upper()),
        "origin": re.sub(r"\s+", "", str(raw.get("origin", "")).upper()),
        "destination": re.sub(r"\s+", "", str(raw.get("destination", "")).upper()),
        "cabin": re.sub(r"\s+", "", str(raw.get("cabin", "")).upper()),
    }


def validate_segment(segment: dict, index: int) -> str:
    prefix = f"第 {index + 1} 段"
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", segment["flightDate"]):
        return f"{prefix}日期无效"
    if not re.fullmatch(r"[A-Z]{2}\d{1,4}[A-Z]?", segment["flightNo"]):
        return f"{prefix}航班号无效"
    if not re.fullmatch(r"[A-Z]{3}", segment["origin"]) or not re.fullmatch(r"[A-Z]{3}", segment["destination"]):
        return f"{prefix}机场三字码无效"
    if segment["origin"] == segment["destination"]:
        return f"{prefix}起点与终点不能相同"
    if not re.fullmatch(r"[A-Z]", segment["cabin"]):
        return f"{prefix}舱位代码无效"
    return ""


def request_official(payload: dict) -> list[dict]:
    request = urllib.request.Request(
        OFFICIAL_URL,
        data=urllib.parse.urlencode({"data": json.dumps(payload, separators=(",", ":"))}).encode(),
        method="POST",
        headers={
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": "https://ffp.airchina.com.cn",
            "Referer": "https://ffp.airchina.com.cn/plan/mileage_accumulate_calculator.html",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/151 Safari/537.36",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        official = json.loads(response.read())
    if not official.get("success") or not isinstance(official.get("body"), list):
        raise ValueError(official.get("message") or "国航未返回累计数据")
    return [
        {
            "subClassName": str(item.get("subClassName") or ""),
            "rate": str(item.get("gradingMilageRate") or ""),
            "availableMileage": int(item.get("availableMileage") or 0),
            "gradingMileage": int(item.get("gradingMileage") or 0),
            "gradingSegments": float(item.get("gradingSeq") or 0),
        }
        for item in official["body"]
    ]


def query_official(args: tuple[dict, str, int]) -> dict:
    segment, member_grade, index = args
    payload = {
        "org": segment["origin"],
        "des": segment["destination"],
        "flightDate": segment["flightDate"],
        "flightNo": segment["flightNo"],
        "memberGrade": member_grade,
    }
    try:
        tiers = request_official(payload)
    except ValueError as error:
        raise ValueError(f"第 {index + 1} 段：{error}") from error
    row = next((item for item in tiers if segment["cabin"] in item["subClassName"].split("/")), None)
    if not row:
        raise ValueError(f"第 {index + 1} 段：国航未返回 {segment['cabin']} 舱累计规则")
    return {
        **segment,
        "cabinGroup": row["subClassName"],
        "rate": row["rate"],
        "availableMileage": row["availableMileage"],
        "gradingMileage": row["gradingMileage"],
        "gradingSegments": row["gradingSegments"],
        "tiers": tiers,
        "genericRule": bool(re.fullmatch(r"[A-Z]{2}0", segment["flightNo"])),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path != "/api/airchina/airports":
            return super().do_GET()
        try:
            self.send_json(200, {"success": True, "source": "Air China", "airports": query_official_airports()})
        except Exception as error:
            self.send_json(502, {"success": False, "message": str(error) or "国航机场数据暂时不可用"})

    def do_POST(self):
        if self.path not in {"/api/airchina/mileage", "/api/airchina/tiers"}:
            self.send_json(404, {"success": False, "message": "接口不存在"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            request_data = json.loads(self.rfile.read(length) or b"{}")
            member_grade = str(request_data.get("memberGrade", "Normal"))
            if self.path == "/api/airchina/tiers":
                segment = clean_segment(request_data)
                if member_grade not in GRADES:
                    self.send_json(400, {"success": False, "message": "会员卡等无效"})
                    return
                message = validate_segment({**segment, "cabin": segment["cabin"] or "A"}, 0)
                if message:
                    self.send_json(400, {"success": False, "message": message})
                    return
                tiers = request_official({"org": segment["origin"], "des": segment["destination"], "flightDate": segment["flightDate"], "flightNo": segment["flightNo"], "memberGrade": member_grade})
                self.send_json(200, {"success": True, "source": "Air China PhoenixMiles", "tiers": tiers})
                return
            segments = [clean_segment(item) for item in request_data.get("segments", [])] if isinstance(request_data.get("segments"), list) else []
            if member_grade not in GRADES:
                self.send_json(400, {"success": False, "message": "会员卡等无效"})
                return
            if not 1 <= len(segments) <= 20:
                self.send_json(400, {"success": False, "message": "请输入 1–20 个航段"})
                return
            for index, segment in enumerate(segments):
                message = validate_segment(segment, index)
                if message:
                    self.send_json(400, {"success": False, "message": message})
                    return
            with ThreadPoolExecutor(max_workers=min(6, len(segments))) as executor:
                calculated = list(executor.map(query_official, [(segment, member_grade, index) for index, segment in enumerate(segments)]))
            totals = {
                "availableMileage": sum(item["availableMileage"] for item in calculated),
                "gradingMileage": sum(item["gradingMileage"] for item in calculated),
                "gradingSegments": sum(item["gradingSegments"] for item in calculated),
            }
            self.send_json(200, {"success": True, "source": "Air China PhoenixMiles", "memberGrade": member_grade, "segments": calculated, "totals": totals})
        except ValueError as error:
            self.send_json(422, {"success": False, "message": str(error)})
        except urllib.error.HTTPError as error:
            self.send_json(502, {"success": False, "message": f"国航接口返回 {error.code}"})
        except TimeoutError:
            self.send_json(502, {"success": False, "message": "国航官方接口查询超时，请稍后重试"})
        except Exception as error:
            self.send_json(502, {"success": False, "message": str(error) or "国航官方接口暂时不可用"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    print("Air China miles: http://127.0.0.1:8766/index.html", flush=True)
    server.serve_forever()
