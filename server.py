"""
Backend for the React dashboard in frontend/. Runs the scanner thread and
pushes every capture to connected browsers over a WebSocket at /ws, and
serves the built frontend (frontend/dist) at /.

    python3 server.py    # then open http://localhost:8000
"""
import asyncio
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

from ScanKeyfobFrequencies import (
    ble_advertising_channels_MHz, ble_range_MHz, keyfob_bands, node_mac_address,
    scan_keyfob, summarize_ble, sweep_ble,
)

PORT = 8000
# Keyfob scans per BLE capture. Higher = faster keyfob panels, slower BLE sweep.
KEYFOB_ROUNDS_PER_BLE_CAPTURE = 2
ERROR_BACKOFF_S = [1, 2, 5, 10]
# Spectrum plot y-axis: 8 divisions of 10 dB, like an analyzer screen
Y_RANGE_dBm = (-120, -40)

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

# segments: latest capture message per segment (BLE has one per 24 MHz sweep step),
# so a newly opened tab can be caught up immediately.
state = {
    "lock": threading.Lock(),
    "bands": {band["key"]: {"count": 0, "last_detected": None, "segments": {}} for band in bands},
    "error": None,
}
clients = set()
event_loop = None


# --- PUSHING TO BROWSERS ---
async def broadcast(message):
    for ws in list(clients):
        try:
            await ws.send_json(message)
        except Exception:
            clients.discard(ws)


def publish(message):
    """Send a message to every connected browser (safe to call from the scanner thread)."""
    if event_loop is not None:
        asyncio.run_coroutine_threadsafe(broadcast(message), event_loop)


# --- BACKGROUND SCANNER THREAD ---
def record_capture(band_key, freqs_MHz, power_dBm, detected):
    """Count the capture if detected, keep it for new tabs, and push it to browsers."""
    fmin, fmax = plot_ranges[band_key]
    in_plot = (freqs_MHz >= fmin) & (freqs_MHz <= fmax)
    if not in_plot.any():
        return
    # Bins are evenly spaced, so start/stop frequency is enough to place them
    message = {
        "type": "capture",
        "band": band_key,
        "segment": round(float(freqs_MHz[0]), 3),
        "f_start": float(freqs_MHz[in_plot][0]),
        "f_stop": float(freqs_MHz[in_plot][-1]),
        "power": np.round(power_dBm[in_plot], 1).tolist(),
        "detected": detected,
        "time": time.time(),
    }
    with state["lock"]:
        band_state = state["bands"][band_key]
        if detected:
            band_state["count"] += 1
            band_state["last_detected"] = message["time"]
        message["count"] = band_state["count"]
        message["last_detected"] = band_state["last_detected"]
        band_state["segments"][message["segment"]] = message
        error_cleared = state["error"] is not None
        state["error"] = None
    if error_cleared:
        publish({"type": "status", "error": None})
    publish(message)


def rf_receiver_thread():
    """
    After each BLE capture, runs KEYFOB_ROUNDS_PER_BLE_CAPTURE rounds of keyfob
    scans, so keyfob panels keep updating while the BLE sweep fills in.
    Never exits: errors are pushed to the dashboard and retried with backoff.
    """
    failures = 0
    while True:
        try:
            for ble_result in sweep_ble():
                record_capture("BLE", *summarize_ble(ble_result))
                for _ in range(KEYFOB_ROUNDS_PER_BLE_CAPTURE):
                    for band_key in keyfob_bands:
                        record_capture(band_key, *scan_keyfob(band_key))
            failures = 0
        except Exception as exc:
            backoff_s = ERROR_BACKOFF_S[min(failures, len(ERROR_BACKOFF_S) - 1)]
            if isinstance(exc, requests.exceptions.RequestException):
                message = (f"Can't reach sensor {node_mac_address}. Retrying in {backoff_s} s. "
                           f"Check that it's powered on and connected.")
            else:
                traceback.print_exc()
                message = f"Scanner error ({type(exc).__name__}: {exc}). Retrying in {backoff_s} s."
            print(f"[Thread] {message} ({exc})")
            with state["lock"]:
                state["error"] = message
            publish({"type": "status", "error": message})
            time.sleep(backoff_s)
            failures += 1


# --- WEB SERVER ---
@asynccontextmanager
async def lifespan(app):
    global event_loop
    event_loop = asyncio.get_running_loop()
    threading.Thread(target=rf_receiver_thread, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    with state["lock"]:
        init = {
            "type": "init",
            "node": node_mac_address,
            "y_range_dBm": Y_RANGE_dBm,
            "bands": bands,
            "state": {
                key: {
                    "count": b["count"],
                    "last_detected": b["last_detected"],
                    "segments": list(b["segments"].values()),
                } for key, b in state["bands"].items()
            },
            "error": state["error"],
        }
    await ws.send_json(init)
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # nothing is sent from the browser; this waits for disconnect
    except WebSocketDisconnect:
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
