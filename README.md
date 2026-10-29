

https://github.com/user-attachments/assets/bcf1c541-2a84-451e-9bc7-c4256f533dc6

# KeyFobDashboard
Demo showing off the v3.8.1 scanning common keyfob frequencies and displaying them :)

## Running

One-time setup:

```
python3 -m pip install --user fastapi uvicorn numpy requests
cd frontend && npm install && npm run build
```

Then:

```
python3 server.py
```

and open http://localhost:8000.

## Working on the frontend

Run `python3 server.py` and, in another terminal, `cd frontend && npm run dev`, then open http://localhost:5173. Changes to `frontend/src` show up immediately. Run `npm run build` when done so `server.py` serves the new version.

## Files

- `server.py`: scans the bands on the node and pushes each capture to the browser over a WebSocket
- `ScanKeyfobFrequencies.py`: which bands to scan and how detection works
- `spec0.py`: copy of the RadioHound module (`scan`, `sweep_beta`); don't edit here
- `frontend/`: the React dashboard
- `KeyFobDashboard.py`: the previous Streamlit version, kept until the React one has been through a demo
