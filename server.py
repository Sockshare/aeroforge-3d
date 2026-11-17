#!/usr/bin/env python3
"""
AeroForge 3D — Supersonic Fighter Jet & Drone CAD, 3D Wind-Tunnel CFD & Dogfight Simulator.
Flask Server (Port 8106) with REST API and SQLite / JSON Hangar persistence.
"""
import argparse
import json
from pathlib import Path
from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
HANGAR_FILE = DATA_DIR / "hangar.json"

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0   # browsers always fetch the current scripts
app.config["TEMPLATES_AUTO_RELOAD"] = True


def load_hangar():
    if HANGAR_FILE.exists():
        try:
            return json.loads(HANGAR_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_hangar(data):
    HANGAR_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


@app.after_request
def no_store(resp):
    # The page and its scripts are never cached, so a reload always shows the current build
    resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "app": "AeroForge 3D // Supersonic Fighter Jet & Drone CAD, 3D Wind-Tunnel CFD & Dogfight Simulator",
        "port": 8106,
    })


@app.route("/api/hangar", methods=["GET", "POST", "DELETE"])
def hangar():
    h = load_hangar()
    if request.method == "GET":
        return jsonify({"ok": True, "hangar": h})
    body = request.get_json(force=True, silent=True) or {}
    name = (body.get("name") or "").strip()
    if request.method == "POST" and name and body.get("cfg"):
        h[name] = body["cfg"]
        save_hangar(h)
        return jsonify({"ok": True, "hangar": h})
    if request.method == "DELETE" and name in h:
        del h[name]
        save_hangar(h)
        return jsonify({"ok": True, "hangar": h})
    return jsonify({"ok": False, "error": "Invalid hangar request"}), 400


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AeroForge 3D Server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8106)
    args = parser.parse_args()
    app.run(host=args.host, port=args.port, debug=False)
