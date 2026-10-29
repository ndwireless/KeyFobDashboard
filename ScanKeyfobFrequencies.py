from spec0 import scan, sweep_beta
import numpy as np

node_mac_address = 'f4b898874967'
gain = 23
power_threshold_dBm = -75

# range_MHz: where the keyfob transmits (power integrated here is compared to
# the threshold). plot_range_MHz: the slice of the 24 MHz capture to plot.
keyfob_bands = {
    "315 MHz": {"range_MHz": (314, 316), "plot_range_MHz": (312, 318)},
    # 433 MHz ISM band, centered on 433.92 where most keyfobs transmit
    "433 MHz": {"range_MHz": (433.05, 434.79), "plot_range_MHz": (430.92, 436.92)},
}

# The whole band is swept and plotted, but integrating all 100 MHz reads about
# -69 dBm on noise alone (always above threshold). So detection only looks at
# BLE advertising channels 37/38/39, where devices announce themselves.
ble_range_MHz = (2400, 2500)
ble_advertising_channels_MHz = [(2401, 2403), (2425, 2427), (2479, 2481)]


def to_dBm(watts):
    return 10 * np.log10(np.maximum(watts, 1e-20)) + 30


def summarize(result, detect_ranges_MHz):
    """
    (freqs_MHz, periodogram_dBm, detected) for one ScanResult. detected is
    True if power integrated over any detect range in the capture is above
    threshold.
    """
    freqs = result.frequencies
    detected = False
    for fmin, fmax in detect_ranges_MHz:
        in_range = (freqs > fmin * 1e6) & (freqs < fmax * 1e6)
        if in_range.any() and to_dBm(np.sum(result.data[in_range])) > power_threshold_dBm:
            detected = True
    return freqs / 1e6, to_dBm(result.data), detected


def scan_keyfob(band_name):
    fmin, fmax = keyfob_bands[band_name]["range_MHz"]
    result = scan(node_mac_address, freq=(fmin + fmax) / 2 * 1e6, gain=gain)
    return summarize(result, [(fmin, fmax)])


def sweep_ble():
    """
    sweep_beta over the BLE band with doBlock=False, so each 24 MHz capture
    can be shown (and keyfob scans slotted in) as soon as it arrives.
    """
    fmin, fmax = ble_range_MHz
    return sweep_beta(node_mac_address, fmin * 1e6, fmax * 1e6, gain=gain, doBlock=False)


def summarize_ble(result):
    return summarize(result, ble_advertising_channels_MHz)
