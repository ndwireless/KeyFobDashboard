"""
radiohound/core.py -- built against Randy's live API (real scans from
real nodes, as of Oct 2026)
"""

import base64
import time

import numpy
import requests

BASE_URL = "http://radiohound2.ee.nd.edu:8000/api"

# The server waits `timeout + 2` s for the node before answering 504; the
# HTTP request must outlast that. HTTP_MARGIN is our own pick, not from the API.
SERVER_GRACE = 2
HTTP_MARGIN = 3


def frequency_bins(xstart, xstop, xcount):
    """
    Frequency in Hz of each power value, lowest first -- for plotting.
    Assumes each value sits at its bin's center. Periodograms only.
    """
    return numpy.linspace(xstart, xstop, xcount)


class ScanResult:
    """Wraps one scan response into something easy to work with."""

    def __init__(self, response_json):
        self.raw = response_json
        # Power per frequency bin, watts (per Chris, Oct 2026). Nominal
        # only on nodes without calibration data.
        self.data = numpy.frombuffer(
            base64.b64decode(response_json["data"]),
            dtype=response_json["type"],
        )
        self.mac_address = response_json["mac_address"]
        self.timestamp = response_json["timestamp"]
        self.center_frequency = response_json["center_frequency"]
        self.sample_rate = response_json["sample_rate"]
        self.metadata = response_json["metadata"]      # fmin, fmax, xstart, xstop, nfft, xcount, gps_lock, scan_time, ...
        self.requested = response_json["requested"]     # what was actually asked for, echoed back
        self.gps_lock = response_json["metadata"].get("gps_lock")
        # Live-API fields; .get() since only seen from one node so far.
        self.latitude = response_json.get("latitude")
        self.longitude = response_json.get("longitude")
        self.altitude = response_json.get("altitude")
        self.batch = response_json.get("batch")
        self.software_version = response_json.get("software_version")

    @property
    def frequencies(self):
        """Frequency in Hz of each value in .data (see frequency_bins())."""
        m = self.metadata
        return frequency_bins(m["xstart"], m["xstop"], m["xcount"])

    def __repr__(self):
        m = self.metadata
        return (f"<ScanResult mac={self.mac_address} n={self.data.size} "
                f"fmin={m.get('fmin')} fmax={m.get('fmax')} gps_lock={self.gps_lock}>")


def _get_json(url, params=None, timeout=10):
    """
    GET `url`, return the JSON body. API errors ({"detail": ...}) are
    raised as requests.exceptions.HTTPError with the detail in the message.
    """
    resp = requests.get(url, params=params, timeout=timeout)
    try:
        body = resp.json()
    except ValueError:
        if resp.ok:
            raise
        body = {"detail": resp.text}
    if not resp.ok or (isinstance(body, dict) and "detail" in body):
        detail = body.get("detail") if isinstance(body, dict) else body
        raise requests.exceptions.HTTPError(
            f"{resp.status_code} from {resp.url}: {detail}", response=resp
        )
    return body


def _get_scan(mac_address, params, base_url, timeout):
    return ScanResult(_get_json(f"{base_url}/scan/{mac_address}", params, timeout))


def scan(mac_address, freq, gain=None, base_url=BASE_URL, timeout=10,
         rbw=None, batch=None):
    """
    Request one scan and return a ScanResult.

    freq: center frequency in Hz (converted to MHz for the API).
    gain, rbw, batch: omitted when None, so server defaults apply
        (gain=1, rbw=23437.5, batch=0 as of Oct 2026). gain and batch
        must be whole numbers.
    timeout: whole seconds the node gets to respond.

    Always zero-span: returns the node's native window centered on freq.
    """
    params = {"freq": freq / 1e6, "timeout": timeout}
    if gain is not None:
        params["gain"] = gain
    if rbw is not None:
        params["rbw"] = rbw
    if batch is not None:
        params["batch"] = batch
    return _get_scan(mac_address, params, base_url,
                     timeout + SERVER_GRACE + HTTP_MARGIN)


def get_node(mac_address, base_url=BASE_URL, timeout=10):
    """Fetch a node's raw status dict (active, last_update, sensors, ...)."""
    return _get_json(f"{base_url}/node/{mac_address}", timeout=timeout)


def is_online(mac_address, base_url=BASE_URL, timeout=10):
    """
    Convenience wrapper answering the Stage 2 "is the node online"
    question directly from the API's own `active` field, rather than
    inferring it from timeouts or connection errors.
    """
    return get_node(mac_address, base_url=base_url, timeout=timeout)["active"]


def sweep_beta(mac_address, fmin, fmax, gain=None, rbw=None, doBlock=True,
               base_url=BASE_URL, timeout=10):
    """
    Cover [fmin, fmax] Hz with back-to-back zero-span scans. Returns a
    list of ScanResult (doBlock=True) or a generator (doBlock=False).
    A failed step is printed and skipped.

    Beta: works with today's API, on these assumptions:
    - API is zero-span only: each scan is one capture centered on freq.
    - Capture width is read from a probe scan at fmin and assumed constant
      across the band (24 MHz at all four frequencies tried, 100 MHz-4.4 GHz).
    - Neighbouring captures share one edge point; results are not stitched.
    - Captures are sequential (~0.3 s apart), not simultaneous.
    - The last capture can extend past fmax.
    - The 0.1 s pause is copied from Icarus's sweep; need unconfirmed.
    - Only tested on node 3484e4f58836.
    """
    def _run():
        probe = scan(mac_address, fmin, gain=gain, base_url=base_url,
                     timeout=timeout, rbw=rbw)
        width = probe.metadata["fmax"] - probe.metadata["fmin"]
        edge = fmin
        while edge < fmax:
            try:
                yield scan(mac_address, edge + width / 2, gain=gain,
                           base_url=base_url, timeout=timeout, rbw=rbw)
            except requests.exceptions.RequestException as exc:
                print(f"WARNING: scan at {edge}-{edge + width} Hz "
                      f"failed ({exc}), skipping")
            edge += width
            time.sleep(0.1)

    if doBlock:
        return list(_run())
    return _run()


# ---------------------------------------------------------------------------
# sweep() -- the real one. NOT IMPLEMENTED: every "ASK RANDY" below is a
# decision about what the API should take in / send back.
# ---------------------------------------------------------------------------
# def sweep(mac_address, fmin, fmax, gain=None, rbw=None, doBlock=True,
#           base_url=BASE_URL, timeout=10):
#     """One spectrum covering [fmin, fmax] Hz."""
#
#     # ASK RANDY 1 -- request shape: fmin/fmax, freq/span, or a separate
#     #   /sweep endpoint? MHz (like freq today) or Hz (like everything returned)?
#     params = {"fmin": fmin, "fmax": fmax}
#
#     # ASK RANDY 2 -- who steps and stitches: node (Icarus's periodogram
#     #   already joins captures for wide spans), server, or this client?
#     #   Node/server -> one request, as below. Client -> needs 3.
#     # ASK RANDY 3 -- capture width per node: can capabilities report it?
#     #   (24 MHz on the RadioHound board, 2.56 MHz on an RTL-SDR; not
#     #   derivable from sample rate.)
#
#     # ASK RANDY 4 -- gain: valid values (node reports -10..35 step 3, API
#     #   accepted 1 and 99)? Default? One gain for the whole sweep?
#     # ANSWERED 5 -- batch is unused (dashboard code says so). Drop it?
#
#     # ASK RANDY 6 -- timing: timeout for a long sweep (server waits
#     #   timeout + 2)? Settle time between retunes? Node busy/locked?
#     result = _get_scan(mac_address, params, base_url, timeout)
#
#     # ASK RANDY 7 -- response shape: one array with xstart/xstop/xcount for
#     #   the whole span, or a list of segments? Per-segment timestamps?
#     #   Size limit for wide spans?
#     # ASK RANDY 8 -- units answered: watts per bin. Tag units/calibrated
#     #   in each payload? Gain-corrected?
#     # ASK RANDY 9 -- partial failure mid-sweep: what comes back?
#     # ASK RANDY 10 -- streaming results as they arrive (doBlock=False)?
#     return result


if __name__ == "__main__":
    import sys
    result = scan(sys.argv[1], freq=float(sys.argv[2]))
    print(result)
    print(result.data[:8])