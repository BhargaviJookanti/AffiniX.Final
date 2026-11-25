# AffiniX — Drug–Target Binding Affinity Studio (Guest Edition)

FastAPI + ONNX Runtime app for predicting drug–target binding affinity with the DeepDTA Davis and KIBA models.
This edition has no login, sign-up, or database. Users enter as a guest and can run predictions immediately.

## Sections
- **Welcome** — "Continue as Guest" button.
- **Predict** — choose Davis or KIBA, enter a SMILES string and protein sequence, get a predicted affinity.
- **History** — predictions from the current browser tab (stored in sessionStorage; cleared when the tab closes).

## Run locally (Windows PowerShell, Python 3.12)

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000 (API docs at /docs, health check at /api/health).

## Deploy (Render)
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
- No environment variables are required.

## Notes
- Binding strength cutoffs are illustrative ranges, not clinically validated thresholds.
- Predictions are computational estimates, not laboratory measurements.
