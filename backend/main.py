import re
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .prediction import predict_affinity

ROOT = Path(__file__).resolve().parents[1]
app = FastAPI(title='AffiniX Binding Affinity API', version='2.1.0')
app.mount('/performance_data', StaticFiles(directory=ROOT / 'performance_data'), name='performance_data')
app.mount('/static', StaticFiles(directory=ROOT / 'frontend'), name='static')


class PredictionRequest(BaseModel):
    dataset: str
    smiles: str = Field(min_length=1, max_length=500)
    protein_sequence: str = Field(min_length=1, max_length=1200)


@app.get('/')
def index():
    return FileResponse(ROOT / 'frontend' / 'index.html')


@app.get('/style.css')
def stylesheet():
    return FileResponse(ROOT / 'frontend' / 'style.css', media_type='text/css')


@app.get('/app.js')
def javascript():
    return FileResponse(ROOT / 'frontend' / 'app.js', media_type='application/javascript')


@app.get('/api/health')
def health():
    return {'status': 'ok', 'app': 'AffiniX'}


@app.post('/api/predict')
def predict(payload: PredictionRequest):
    dataset = payload.dataset.lower().strip()
    if dataset not in {'davis', 'kiba'}:
        raise HTTPException(status_code=400, detail='Choose either Davis or KIBA.')
    smiles = re.sub(r'\s+', '', payload.smiles)
    protein = re.sub(r'\s+', '', payload.protein_sequence).upper()
    if not smiles or not protein:
        raise HTTPException(status_code=400, detail='Both SMILES and protein sequence are required.')
    try:
        result = predict_affinity(dataset, smiles, protein)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Model inference failed: {exc}')
    result.update({'smiles': smiles, 'protein_sequence': protein,
                   'created_at': datetime.now(timezone.utc).isoformat(), 'saved': False})
    return result
