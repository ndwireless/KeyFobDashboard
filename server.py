"""
Backend for the React dashboard in frontend/. Runs a scanner thread for each
node (up to MAX_NODES, all drawn on the same three radios), pushes every
capture to connected browsers over a WebSocket at /ws, and serves the built
frontend (frontend/dist) at /.

    python3 server.py    # then open http://localhost:8000

Nodes added from the dashboard are kept in memory only: every server start
begins with just the default node. The primary node is the one whose
threshold the knobs set and whose spectrum fills the waterfall; a detection
from any node lights the panel and counts.
"""
import asyncio
import re
import threading
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import requests
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from spec0 import is_online
from ScanKeyfobFrequencies import (
    ble_advertising_channels_MHz, ble_range_MHz, keyfob_bands, node_mac_address,
    power_threshold_dBm, scan_keyfob, summarize_ble, sweep_ble,
)

PORT = 8000
# Keyfob scans per BLE capture. Higher = faster keyfob panels, slower BLE sweep.
KEYFOB_ROUNDS_PER_BLE_CAPTURE = 2
ERROR_BACKOFF_S = [1, 2, 5, 10]
# Spectrum plot y-axis: 8 divisions of 10 dB, like an analyzer screen
Y_RANGE_dBm = (-120, -40)
# Range of the threshold dials on the dashboard
THRESHOLD_RANGE_dBm = (-100, -40)
# Nodes scanned at once; each gets one of this many colors on the dashboard
MAX_NODES = 4
# Detections from any node within this long of a counted one don't count again,
# so one press heard by every node counts about once
MERGE_S = 1.0

bands = [
    {
        "key": "315 MHz",
        "title": "315 MHz Keyfob",
        "plot_range_MHz": keyfob_bands["315 MHz"]["plot_range_MHz"],
        "detect_ranges_MHz": [keyfob_bands["315 MHz"]["range_MHz"]],
    },
    {
        "key": "433 MHz",
        "title": "433 MHz Keyfob",
        "plot_range_MHz": keyfob_bands["433 MHz"]["plot_range_MHz"],
        "detect_ranges_MHz": [keyfob_bands["433 MHz"]["range_MHz"]],
    },
    {
        "key": "BLE",
        "title": "BLE Device",
        "plot_range_MHz": ble_range_MHz,
        "detect_ranges_MHz": ble_advertising_channels_MHz,
    },
]
plot_ranges = {band["key"]: band["plot_range_MHz"] for band in bands}

# nodes: MAC -> that node's state, in the order they were added. Per band,
# segments keeps the latest capture message per segment (BLE has one per 24 MHz
# sweep step), so a newly opened tab can be caught up immediately.
# bands: count and detection times shared by all nodes.
# stop_events: MAC -> Event that stops its scanner.
state = {
    "lock": threading.Lock(),
    "nodes": {},
    "bands": {band["key"]: {"count": 0, "last_detected": None, "last_counted": None} for band in bands},
    "primary": node_mac_address,
}
stop_events = {}
clients = set()
event_loop = None


def new_node_state():
    """Call with the lock held: takes the lowest color slot no other node uses."""
    used = {node["color"] for node in state["nodes"].values()}
    return {
        "color": min(set(range(MAX_NODES)) - used),
        "bands": {
            band["key"]: {"level": None, "threshold": power_threshold_dBm, "segments": {}}
            for band in bands
        },
        "error": None,
    }


def node_snapshot(mac):
    """Everything a browser needs to draw one node. Call with the lock held."""
    node = state["nodes"][mac]
    return {
        "mac": mac,
        "color": node["color"],
        "error": node["error"],
        "bands": {
            key: {
                "level": b["level"],
                "threshold": b["threshold"],
                "segments": list(b["segments"].values()),
            } for key, b in node["bands"].items()
        },
    }


# --- PUSHING TO BROWSERS ---
async def broadcast(message):
    for ws in list(clients):
        try:
            await ws.send_json(message)
        except Exception:
            clients.discard(ws)


def publish(message):
    """Send a message to every connected browser (safe to call from scanner threads)."""
    if event_loop is not None:
        asyncio.run_coroutine_threadsafe(broadcast(message), event_loop)


# --- BACKGROUND SCANNER THREADS ---
def record_capture(mac, band_key, freqs_MHz, power_dBm, level_dBm):
    """Count the capture if detected, keep it for new tabs, and push it to browsers."""
    fmin, fmax = plot_ranges[band_key]
    in_plot = (freqs_MHz >= fmin) & (freqs_MHz <= fmax)
    if not in_plot.any():
        return
    # Bins are evenly spaced, so start/stop frequency is enough to place them
    message = {
        "type": "capture",
        "node": mac,
        "band": band_key,
        "segment": round(float(freqs_MHz[0]), 3),
        "f_start": float(freqs_MHz[in_plot][0]),
        "f_stop": float(freqs_MHz[in_plot][-1]),
        "power": np.round(power_dBm[in_plot], 1).tolist(),
        "level": None if level_dBm is None else round(level_dBm, 1),
        "time": time.time(),
    }
    with state["lock"]:
        node = state["nodes"].get(mac)
        if node is None:  # removed while this scan was running
            return
        node_band = node["bands"][band_key]
        shared = state["bands"][band_key]
        detected = level_dBm is not None and level_dBm > node_band["threshold"]
        message["detected"] = detected
        if detected:
            shared["last_detected"] = message["time"]
            if shared["last_counted"] is None or message["time"] - shared["last_counted"] >= MERGE_S:
                shared["count"] += 1
                shared["last_counted"] = message["time"]
        if level_dBm is not None:
            node_band["level"] = message["level"]
        message["count"] = shared["count"]
        message["last_detected"] = shared["last_detected"]
        node_band["segments"][message["segment"]] = message
        error_cleared = node["error"] is not None
        node["error"] = None
    if error_cleared:
        publish({"type": "status", "node": mac, "error": None})
    publish(message)


def rf_receiver_thread(mac, stop):
    """
    Scans one node until `stop` is set. After each BLE capture, runs
    KEYFOB_ROUNDS_PER_BLE_CAPTURE rounds of keyfob scans, so keyfob panels keep
    updating while the BLE sweep fills in. Errors are pushed to the dashboard
    and retried with backoff.
    """
    failures = 0
    while not stop.is_set():
        try:
            for ble_result in sweep_ble(mac):
                if stop.is_set():
                    return
                record_capture(mac, "BLE", *summarize_ble(ble_result))
                for _ in range(KEYFOB_ROUNDS_PER_BLE_CAPTURE):
                    for band_key in keyfob_bands:
                        if stop.is_set():
                            return
                        record_capture(mac, band_key, *scan_keyfob(band_key, mac))
            failures = 0
        except Exception as exc:
            backoff_s = ERROR_BACKOFF_S[min(failures, len(ERROR_BACKOFF_S) - 1)]
            if isinstance(exc, requests.exceptions.RequestException):
                message = (f"Can't reach sensor {mac}. Retrying in {backoff_s} s. "
                           f"Check that it's powered on and connected.")
            else:
                traceback.print_exc()
                message = f"Scanner error ({type(exc).__name__}: {exc}). Retrying in {backoff_s} s."
            print(f"[{mac}] {message} ({exc})")
            with state["lock"]:
                if mac in state["nodes"]:
                    state["nodes"][mac]["error"] = message
            publish({"type": "status", "node": mac, "error": message})
            stop.wait(backoff_s)
            failures += 1


def start_scanning(mac):
    stop = threading.Event()
    stop_events[mac] = stop
    threading.Thread(target=rf_receiver_thread, args=(mac, stop), daemon=True).start()


def stop_scanning(mac):
    """The thread finishes the scan it's in (under a second) and exits."""
    stop = stop_events.pop(mac, None)
    if stop is not None:
        stop.set()


def normalize_mac(text):
    """'F4:B8:98:87:49:67' -> 'f4b898874967', or None if it isn't a MAC address."""
    mac = re.sub(r"[\s:.-]", "", str(text)).lower()
    return mac if re.fullmatch(r"[0-9a-f]{12}", mac) else None


async def add_node(raw_mac):
    """Checks the node is online, then adds and shows it. Returns an error message, or None."""
    mac = normalize_mac(raw_mac)
    if mac is None:
        return f'"{raw_mac}" isn\'t a MAC address. It should be 12 hex digits, like {node_mac_address}.'
    with state["lock"]:
        if mac in state["nodes"]:
            return f"Sensor {mac} is already added."
        if len(state["nodes"]) >= MAX_NODES:
            return f"Up to {MAX_NODES} sensors. Remove one to add another."
    try:
        online = await asyncio.to_thread(is_online, mac)
    except Exception:
        return f"Couldn't find sensor {mac}. Check the MAC address."
    if not online:
        return f"Sensor {mac} is offline. Check that it's powered on and connected."
    with state["lock"]:
        if mac in state["nodes"]:  # added by another tab meanwhile
            return None
        if len(state["nodes"]) >= MAX_NODES:
            return f"Up to {MAX_NODES} sensors. Remove one to add another."
        state["nodes"][mac] = new_node_state()
        start_scanning(mac)
        message = {"type": "node_added", "node": node_snapshot(mac)}
    await broadcast(message)
    return None


# --- WEB SERVER ---
@asynccontextmanager
async def lifespan(app):
    global event_loop
    event_loop = asyncio.get_running_loop()
    with state["lock"]:
        state["nodes"][node_mac_address] = new_node_state()
        start_scanning(node_mac_address)
    yield


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    with state["lock"]:
        init = {
            "type": "init",
            "default_node": node_mac_address,
            "max_nodes": MAX_NODES,
            "y_range_dBm": Y_RANGE_dBm,
            "threshold_range_dBm": THRESHOLD_RANGE_dBm,
            "bands": bands,
            "nodes": [node_snapshot(mac) for mac in state["nodes"]],
            "primary": state["primary"],
            "band_state": {
                key: {"count": b["count"], "last_detected": b["last_detected"]} for key, b in state["bands"].items()
            },
        }
    await ws.send_json(init)
    clients.add(ws)
    try:
        while True:
            # From the browser: threshold, primary, add, remove (see useScanner.js)
            message = await ws.receive_json()
            kind = message.get("type")
            mac = message.get("node")
            if kind == "add":
                error = await add_node(message.get("mac", ""))
                if error:
                    await ws.send_json({"type": "add_failed", "error": error})
                continue
            with state["lock"]:
                if mac not in state["nodes"]:
                    continue
                if kind == "threshold" and message.get("band") in plot_ranges:
                    low, high = THRESHOLD_RANGE_dBm
                    value = min(high, max(low, float(message["value"])))
                    state["nodes"][mac]["bands"][message["band"]]["threshold"] = value
                    reply = {"type": "threshold", "node": mac, "band": message["band"], "value": value}
                elif kind == "primary":
                    state["primary"] = mac
                    reply = {"type": "primary", "node": mac}
                elif kind == "remove" and mac != node_mac_address:
                    stop_scanning(mac)
                    del state["nodes"][mac]
                    if state["primary"] == mac:
                        state["primary"] = node_mac_address
                    reply = {"type": "node_removed", "node": mac, "primary": state["primary"]}
                else:
                    continue
            await broadcast(reply)
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


app.mount("/resources", StaticFiles(directory=Path(__file__).parent / "resources"), name="resources")
frontend_dist = Path(__file__).parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
else:
    print("frontend/dist not found: run `npm install && npm run build` in frontend/ "
          "(or `npm run dev` there and open http://localhost:5173)")


if __name__ == "__main__":
    print(f"Dashboard: http://localhost:{PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
