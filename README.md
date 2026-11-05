

https://github.com/user-attachments/assets/bde89710-391e-4ab2-90f8-fcc887d56875



# KeyFobDashboard
Demo showing off the v3.8.1 scanning common keyfob frequencies and displaying them :)

## Running

One-time setup:

Install node.js from https://nodejs.org/en/download
```
python3 -m pip install --user fastapi uvicorn numpy requests
cd frontend && npm install && npm run build
```

Then:

```
python3 server.py
```

and open http://localhost:8000.

Each panel's knob sets that band's detection threshold (drag up/down, scroll, or arrow keys). It's shared by every open tab and resets to −75 dBm when the server restarts.

To scan with more sensors, type a node's MAC address into the bar under the title and click "Add sensor" (up to 4). Every sensor scans at once and draws its own colored trace on each radio; a detection from any of them lights the panel and adds to the count (detections within 1 s of each other count once). Click a sensor to make it the primary: its trace is the bright one, the waterfall shows it, and the knobs set its thresholds. Added sensors are kept in the server's memory only, so each restart begins with just the default node (`node_mac_address` in `ScanKeyfobFrequencies.py`).

## Working on the frontend

Run `python3 server.py` and, in another terminal, `cd frontend && npm run dev`, then open http://localhost:5173. Changes to `frontend/src` show up immediately. Run `npm run build` when done so `server.py` serves the new version.

## Files

- `server.py`: scans the bands on the node and pushes each capture to the browser over a WebSocket
- `ScanKeyfobFrequencies.py`: which bands to scan and how detection works
- `spec0.py`: copy of the RadioHound module (`scan`, `sweep_beta`); don't edit here
- `frontend/`: the React dashboard
