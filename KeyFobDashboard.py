import time
import threading
import random
import numpy as np
import pandas as pd
import streamlit as st
from ScanKeyfobFrequencies import retrieve_keyfob_periodograms

# Page configuration for wide layout
st.set_page_config(page_title="RF Periodogram Showcase", layout="wide")

# --- MODULE-LEVEL GLOBALS (Safe for background threads) ---
if "initialized" not in globals():
    global_lock = threading.Lock()
    shared_rf_data = {
        "315 MHz": {"count": 0, "freqs": [], "powers": []},
        "433 MHz": {"count": 0, "freqs": [], "powers": []},
        "BLE": {"count": 0, "freqs": [], "powers": []}
    }
    initialized = True


# --- BACKGROUND SIGNAL & SPECTRUM INGESTION THREAD ---
def rf_receiver_thread_fake():
    """Simulates background hardware generating periodogram spectrum sweeps."""
    bands = {
        "315 MHz": (310.0, 320.0, 315.0),
        "433 MHz": (430.0, 440.0, 433.92),
        "BLE": (2400.0, 2480.0, 2440.0)
    }

    while True:
        band_name = random.choice(list(bands.keys()))
        min_f, max_f, center_f = bands[band_name]

        # Generate periodogram frequency sweep (30 bins)
        freqs = np.linspace(min_f, max_f, 30)
        powers = -80 + np.random.normal(0, 2, size=30)
        peak_idx = np.argmin(np.abs(freqs - center_f))
        powers[peak_idx] += random.uniform(35, 55)

        # Safely update shared data using the module-level global lock
        with global_lock:
            shared_rf_data[band_name]["count"] += 1
            shared_rf_data[band_name]["freqs"] = freqs.tolist()
            shared_rf_data[band_name]["powers"] = powers.tolist()
            print(f"[Thread] Updated {band_name} | Count: {shared_rf_data[band_name]['count']}")

        time.sleep(1.0)  # Update every 1 second

def rf_receiver_thread():
    """Simulates background hardware generating periodogram spectrum sweeps."""
    print(f'updating rf receiver data')
    bands = {
        "315 MHz": (310.0, 320.0, 315.0),
        "433 MHz": (430.0, 440.0, 433.92),
        "BLE": (2400.0, 2480.0, 2440.0)
    }
    while True:
        keyfob_tuple = retrieve_keyfob_periodograms()
        for iband, band_name in enumerate(bands):
            print(f'keyfob tuple[iband]: {band_name}')
            freqs, powers, count = keyfob_tuple[iband]

            freqs /= 1e6

            # Safely update shared data using the module-level global lock
            with global_lock:
                shared_rf_data[band_name]["count"] += count
                shared_rf_data[band_name]["freqs"] = freqs.tolist()
                shared_rf_data[band_name]["powers"] = powers.tolist()
                print(f"[Thread] Updated {band_name} | Count: {shared_rf_data[band_name]['count']}")

            # time.sleep(0.5)  # Update every 1 second


# --- START BACKGROUND THREAD ONCE ---
if "thread_started" not in st.session_state:
    st.session_state.thread_started = True
    t = threading.Thread(target=rf_receiver_thread, daemon=True)
    t.start()

# --- UI LAYOUT (Static Header) ---
header_col1, header_col2 = st.columns([1, 6])
with header_col1:
    # st.markdown(
    #     """<div style="background-color:#e5e7eb; padding:20px; text-align:center; font-weight:bold; border-radius:8px; color:#374151;">LOGO</div>""",
    #     unsafe_allow_html=True
    # )
    st.image("resources/generalWhite-clear.png", width=140)
with header_col2:
    st.title("RF Periodogram Telemetry Showcase")
    st.markdown("Real-time frequency spectrum analysis per wireless protocol.")

st.markdown("---")


# --- LIVE TELEMETRY DASHBOARD (Auto-refreshes every 1s using a Fragment) ---
@st.fragment(run_every=0.1)
def render_live_telemetry():
    # Pull snapshot under the global thread lock
    with global_lock:
        current_data = {
            k: {
                "count": v["count"],
                "freqs": list(v["freqs"]),
                "powers": list(v["powers"])
            } for k, v in shared_rf_data.items()
        }

    # Three columns layout matching your sketch
    col1, col2, col3 = st.columns(3)
    panels = [
        {"container": col1, "title": "315 MHz Keyfob", "key": "315 MHz"},
        {"container": col2, "title": "433 MHz Keyfob", "key": "433 MHz"},
        {"container": col3, "title": "BLE Device", "key": "BLE"}
    ]

    for panel in panels:
        with panel["container"]:
            st.subheader(panel["title"])

            band_key = panel["key"]
            panel_info = current_data[band_key]

            # 1. Times Seen Metric Box
            st.metric(label="Times Detected", value=panel_info["count"])

            # 2 & 3. Periodogram Plot: Frequency (X-axis) vs Power Estimate dB (Y-axis)
            if panel_info["freqs"] and panel_info["powers"]:
                df_spectrum = pd.DataFrame({
                    "Frequency (MHz)": panel_info["freqs"],
                    "Power (dB)": panel_info["powers"]
                })
                st.line_chart(df_spectrum.set_index("Frequency (MHz)")["Power (dB)"], height=220)
            else:
                st.info("Awaiting spectrum capture...")


# Render the live fragment
render_live_telemetry()