import time
import threading
import traceback
from collections import deque

import altair as alt
import numpy as np
import pandas as pd
import requests
import streamlit as st
from ScanKeyfobFrequencies import (
    ble_advertising_channels_MHz, ble_range_MHz, keyfob_bands, node_mac_address,
    scan_keyfob, summarize_ble, sweep_ble,
)

# Page configuration for wide layout
st.set_page_config(page_title="RF Periodogram Showcase", layout="wide")

# Fixed y-axis so the plot stops rescaling every update. Noise sits around
# -100 to -110 dBm per bin; a keyfob near the node peaks well above -60.
Y_MIN_dBm, Y_MAX_dBm = -115, -40
# Keyfob scans per BLE capture. Higher = faster keyfob panels, slower BLE sweep.
KEYFOB_ROUNDS_PER_BLE_CAPTURE = 2
PEAK_HOLD_DECAY_dB_PER_S = 15  # how fast the dashed peak trace falls back to the live one
DETECTION_GLOW_S = 2.0         # how long a panel stays lit after a detection
MAX_PLOT_POINTS = 800          # the BLE sweep is max-pooled down to this many points
ERROR_BACKOFF_S = [1, 2, 5, 10]

# Tech Innovation theme (skills/skills/theme-factory/themes/tech-innovation.md)
ELECTRIC_BLUE = "#0066ff"
NEON_CYAN = "#00ffff"
DARK_GRAY = "#1e1e1e"
WHITE = "#ffffff"
SURFACE = "#262626"
MUTED = "#a0a4ab"
ERROR_RED = "#ff5c5c"

panels = {
    "315 MHz": {
        "title": "315 MHz Keyfob",
        "plot_range_MHz": keyfob_bands["315 MHz"]["plot_range_MHz"],
        "detect_ranges_MHz": [keyfob_bands["315 MHz"]["range_MHz"]],
    },
    "433 MHz": {
        "title": "433 MHz Keyfob",
        "plot_range_MHz": keyfob_bands["433 MHz"]["plot_range_MHz"],
        "detect_ranges_MHz": [keyfob_bands["433 MHz"]["range_MHz"]],
    },
    "BLE": {
        "title": "BLE Device",
        "plot_range_MHz": ble_range_MHz,
        "detect_ranges_MHz": ble_advertising_channels_MHz,
    },
}


# --- BACKGROUND SCANNER THREAD ---
def record_capture(state, band_name, freqs_MHz, power_dBm, detected):
    """Store one capture, update its peak hold, and count it if detected."""
    now = time.time()
    with state["lock"]:
        band_state = state["bands"][band_name]
        # BLE arrives one 24 MHz capture (segment) at a time; key by start freq.
        segment_key = round(float(freqs_MHz[0]), 3)
        previous = band_state["segments"].get(segment_key)
        hold = power_dBm
        if previous is not None and previous["hold"].shape == power_dBm.shape:
            decayed = previous["hold"] - PEAK_HOLD_DECAY_dB_PER_S * (now - previous["time"])
            hold = np.maximum(power_dBm, decayed)
        band_state["segments"][segment_key] = {"freqs": freqs_MHz, "dBm": power_dBm, "hold": hold, "time": now}

        if detected:
            band_state["count"] += 1
            band_state["last_detected"] = now
        state["capture_times"].append(now)
        state["error"] = None


def rf_receiver_thread(state):
    """
    After each BLE capture, runs KEYFOB_ROUNDS_PER_BLE_CAPTURE rounds of keyfob
    scans, so keyfob panels keep updating while the BLE sweep fills in.
    Never exits: errors are shown on the dashboard and retried with backoff.
    """
    failures = 0
    while True:
        try:
            for ble_result in sweep_ble():
                record_capture(state, "BLE", *summarize_ble(ble_result))
                for _ in range(KEYFOB_ROUNDS_PER_BLE_CAPTURE):
                    for band_name in keyfob_bands:
                        record_capture(state, band_name, *scan_keyfob(band_name))
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
            time.sleep(backoff_s)
            failures += 1


@st.cache_resource
def start_scanner():
    """One shared state and scanner thread per server, however many tabs or reruns."""
    state = {
        "lock": threading.Lock(),
        "bands": {band_name: {"count": 0, "last_detected": None, "segments": {}} for band_name in panels},
        "capture_times": deque(maxlen=20),
        "error": None,
    }
    threading.Thread(target=rf_receiver_thread, args=(state,), daemon=True).start()
    return state


state = start_scanner()


# --- STYLING ---
def rgba(hex_color, alpha):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return f"rgba({r},{g},{b},{alpha})"


st.markdown(
    f"""
    <style>
    @font-face {{
        font-family: 'DejaVu Sans';
        src: url('https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf') format('truetype');
        font-weight: 400;
    }}
    @font-face {{
        font-family: 'DejaVu Sans';
        src: url('https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf') format('truetype');
        font-weight: 700;
    }}
    .stApp, .stApp p, .stApp h1, .stApp h2, .stApp h3 {{ font-family: 'DejaVu Sans', Verdana, sans-serif; }}
    .stApp {{ background: {DARK_GRAY}; }}
    [data-testid="stHeader"] {{ background: transparent; }}
    .block-container {{ padding-top: 2.5rem; max-width: 1600px; }}

    /* .stApp prefix outranks Streamlit's own markdown paragraph styles */
    .stApp .title {{ font-weight: 700; font-size: 2.6rem; line-height: 1.1; letter-spacing: -0.02em; color: {WHITE}; margin: 0; }}
    .stApp .subtitle {{ font-size: 1.1rem; color: {MUTED}; margin: 0.6rem 0 0; max-width: 60ch; }}

    .stApp .status {{ font-size: 0.9rem; color: {MUTED}; margin: 0.25rem 0 1.25rem; }}
    .status::before {{
        content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%;
        background: {ELECTRIC_BLUE}; margin-right: 0.5rem; vertical-align: 1px;
    }}
    .status.error {{ color: {ERROR_RED}; }}
    .status.error::before {{ background: {ERROR_RED}; }}

    [class*="st-key-panel-"] {{
        background: {SURFACE}; border-radius: 12px !important;
        border-color: {rgba(WHITE, 0.08)} !important;
        transition: border-color 0.25s, box-shadow 0.25s;
    }}
    [class*="st-key-panel-"][class*="-hot"] {{
        border-color: {NEON_CYAN} !important;
        box-shadow: 0 0 0 1px {NEON_CYAN}, 0 0 32px {rgba(NEON_CYAN, 0.35)};
    }}
    @media (prefers-reduced-motion: reduce) {{
        [class*="st-key-panel-"] {{ transition: none; }}
    }}

    .stApp .panel-title {{ font-weight: 700; font-size: 1.25rem; color: {WHITE}; margin: 0 0 1rem; }}
    .panel-row {{ display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; }}
    .count {{ font-weight: 700; font-size: 3.4rem; line-height: 1; font-variant-numeric: tabular-nums; }}
    .count-label {{ font-size: 0.9rem; color: {MUTED}; margin-top: 0.3rem; }}
    .badge {{
        font-size: 0.85rem; padding: 0.3rem 0.75rem; border-radius: 999px;
        border: 1px solid {rgba(WHITE, 0.15)}; color: {MUTED}; white-space: nowrap;
    }}
    .badge.hot {{ color: {DARK_GRAY}; background: {NEON_CYAN}; border-color: {NEON_CYAN}; font-weight: 700; }}
    </style>
    """,
    unsafe_allow_html=True,
)

# --- UI LAYOUT (Static Header) ---
header_col1, header_col2 = st.columns([1, 7], vertical_alignment="center")
with header_col1:
    st.image("resources/generalWhite-clear.png", width=140)
with header_col2:
    st.markdown(
        """<p class="title">RF Periodogram Telemetry Showcase</p>
        <p class="subtitle">Real-time frequency spectrum analysis per wireless protocol.</p>""",
        unsafe_allow_html=True,
    )


# --- PANEL HELPERS ---
def spectrum_frame(segments, plot_range_MHz):
    """Join a band's segments into one frame cropped to plot_range_MHz, max-pooled for plotting."""
    segments = sorted(segments, key=lambda s: s["freqs"][0])
    freqs = np.concatenate([s["freqs"] for s in segments])
    live = np.concatenate([s["dBm"] for s in segments])
    hold = np.concatenate([s["hold"] for s in segments])

    in_view = (freqs >= plot_range_MHz[0]) & (freqs <= plot_range_MHz[1])
    freqs, live, hold = freqs[in_view], live[in_view], hold[in_view]
    if freqs.size > MAX_PLOT_POINTS:
        # Max-pool (not average) so narrow spikes survive the downsampling.
        starts = np.linspace(0, freqs.size, MAX_PLOT_POINTS, endpoint=False).astype(int)
        freqs = freqs[starts]
        live = np.maximum.reduceat(live, starts)
        hold = np.maximum.reduceat(hold, starts)

    return pd.DataFrame({
        "freq": freqs,
        "live": np.clip(live, Y_MIN_dBm, Y_MAX_dBm),
        "hold": np.clip(hold, Y_MIN_dBm, Y_MAX_dBm),
    })


def spectrum_chart(df, panel, color):
    x_scale = alt.Scale(domain=list(panel["plot_range_MHz"]), nice=False)
    y_scale = alt.Scale(domain=[Y_MIN_dBm, Y_MAX_dBm], nice=False)
    x = alt.X("freq:Q", title="Frequency (MHz)", scale=x_scale)

    # Shaded columns where we listen for a transmission
    zones = alt.Chart(pd.DataFrame(panel["detect_ranges_MHz"], columns=["lo", "hi"])).mark_rect(
        color=WHITE, opacity=0.06
    ).encode(x=alt.X("lo:Q", scale=x_scale), x2="hi:Q")

    hold = alt.Chart(df).mark_line(color=color, strokeDash=[3, 3], strokeWidth=1, opacity=0.5).encode(
        x=x, y=alt.Y("hold:Q", scale=y_scale)
    )

    live = alt.Chart(df).mark_area(
        line={"color": color, "strokeWidth": 1.6},
        color=alt.Gradient(
            gradient="linear", x1=1, x2=1, y1=1, y2=0,
            stops=[alt.GradientStop(color=rgba(color, 0), offset=0), alt.GradientStop(color=rgba(color, 0.4), offset=1)],
        ),
    ).encode(x=x, y=alt.Y("live:Q", title="Signal strength (dBm)", scale=y_scale), y2=alt.datum(Y_MIN_dBm))

    return (
        alt.layer(zones, hold, live)
        .properties(height=240, background="transparent")
        .configure_view(strokeWidth=0)
        .configure_axis(
            gridColor=rgba(WHITE, 0.07), domainColor=rgba(WHITE, 0.2), tickColor=rgba(WHITE, 0.2),
            labelColor=MUTED, titleColor=MUTED, labelFont="DejaVu Sans", titleFont="DejaVu Sans",
            titleFontWeight="normal", labelFontSize=11, titleFontSize=12,
        )
    )


# --- LIVE TELEMETRY DASHBOARD ---
# How often a plot actually changes is set by the scans (~0.25 s each), not
# by run_every; redrawing faster than that only repeats the same data.
@st.fragment(run_every=0.25)
def render_live_telemetry():
    # Pull snapshot under the thread lock (arrays are replaced, never mutated)
    with state["lock"]:
        snapshot = {
            band_name: {
                "count": b["count"],
                "last_detected": b["last_detected"],
                "segments": list(b["segments"].values()),
            } for band_name, b in state["bands"].items()
        }
        has_data = bool(state["capture_times"])
        error = state["error"]
    now = time.time()

    if error:
        st.markdown(f'<p class="status error">{error}</p>', unsafe_allow_html=True)
    elif has_data:
        st.markdown(f'<p class="status">Live from sensor {node_mac_address}</p>', unsafe_allow_html=True)
    else:
        st.markdown(f'<p class="status">Connecting to sensor {node_mac_address}…</p>', unsafe_allow_html=True)

    for i, (column, (band_name, panel)) in enumerate(zip(st.columns(3), panels.items())):
        info = snapshot[band_name]
        last = info["last_detected"]
        active = last is not None and now - last < DETECTION_GLOW_S
        color = NEON_CYAN if active else ELECTRIC_BLUE

        if active:
            badge = '<span class="badge hot">Signal detected</span>'
        elif last is not None:
            seconds = now - last
            ago = f"{seconds:.0f} s" if seconds < 60 else f"{seconds / 60:.0f} min"
            badge = f'<span class="badge">Last seen {ago} ago</span>'
        else:
            badge = '<span class="badge">Listening</span>'

        with column, st.container(border=True, key=f"panel-{i}-{'hot' if active else 'idle'}"):
            st.markdown(
                f"""<p class="panel-title">{panel['title']}</p>
                <div class="panel-row">
                    <div><div class="count" style="color:{color}">{info['count']}</div>
                    <div class="count-label">Times Detected</div></div>
                    {badge}
                </div>""",
                unsafe_allow_html=True,
            )
            if info["segments"]:
                df = spectrum_frame(info["segments"], panel["plot_range_MHz"])
                st.altair_chart(spectrum_chart(df, panel, color), use_container_width=True, theme=None)
            else:
                st.info("Awaiting spectrum capture...")


# Render the live fragment
render_live_telemetry()
