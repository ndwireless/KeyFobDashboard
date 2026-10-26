from spec0 import scan, is_online, sweep_beta
import numpy as np

wireless_key_frequency_ranges_MHz = [(314, 316), (433.5, 434.5), (868, 869)]
wireless_key_frequency_power_thresholds_dBm = [-75, -75, -75]
node_mac_address = 'f4b898874967'

# is_node_online = is_online(node)
# print(f'is_node_online: {is_node_online}')

def retrieve_keyfob_periodograms():
    keyfob_tuples = []
    for (fmin, fmax), power_threshold_dBm in zip(wireless_key_frequency_ranges_MHz, wireless_key_frequency_power_thresholds_dBm):
        fmin, fmax = fmin * 1e6, fmax * 1e6
        fc = (fmin + fmax) / 2
        result = scan(node_mac_address, freq=fc, gain=23)
        freqs = result.frequencies
        periodogram_dBm = 10 * np.log10(result.data) + 30
        integrated_keyfob_power_dBm = 10 * np.log10(np.sum(result.data[(freqs > fmin) & (freqs < fmax)])) + 30
        print(f'Range: {fmin / 1e6}, {fmax / 1e6}, Integrated Keyfob Power: {integrated_keyfob_power_dBm}')
        keyfob_tuples.append((freqs, periodogram_dBm, int(integrated_keyfob_power_dBm > power_threshold_dBm)))
    return keyfob_tuples

