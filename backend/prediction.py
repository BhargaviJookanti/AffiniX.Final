import json
from functools import lru_cache
from pathlib import Path
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / 'models'


@lru_cache(maxsize=2)
def load_model(dataset: str):
    if dataset not in {'davis', 'kiba'}:
        raise ValueError('Dataset must be davis or kiba.')
    model_path = MODEL_DIR / f'{dataset}.onnx'
    config_path = MODEL_DIR / f'{dataset}.preprocessing_config.json'
    if not model_path.exists() or not config_path.exists():
        raise FileNotFoundError(f'Model or preprocessing configuration missing for {dataset}.')
    config = json.loads(config_path.read_text(encoding='utf-8'))
    session = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
    inputs = {item.name: item for item in session.get_inputs()}
    if 'drug_input' not in inputs or 'protein_input' not in inputs:
        raise RuntimeError(f'Unexpected ONNX inputs for {dataset}: {list(inputs)}')
    return session, config


def _input_array(values, input_meta):
    dtype = np.int64 if 'int64' in input_meta.type else np.int32
    return np.asarray([values], dtype=dtype)


def predict_affinity(dataset: str, smiles: str, protein_sequence: str):
    session, config = load_model(dataset)
    drug_vocab = config['drug_vocab']
    protein_vocab = config['protein_vocab']
    pad_id, unk_id = int(config.get('pad_id', 0)), int(config.get('unk_id', 1))
    max_smi_len = int(config['max_smi_len'])
    max_seq_len = int(config['max_seq_len'])

    # This matches the training notebook: character lookup, unknown ID 1,
    # truncate from the right, then pad with ID 0 to the configured length.
    drug_tokens = [int(drug_vocab.get(ch, unk_id)) for ch in smiles[:max_smi_len]]
    protein_tokens = [int(protein_vocab.get(ch, unk_id)) for ch in protein_sequence[:max_seq_len]]
    drug_tokens += [pad_id] * (max_smi_len - len(drug_tokens))
    protein_tokens += [pad_id] * (max_seq_len - len(protein_tokens))

    input_meta = {item.name: item for item in session.get_inputs()}
    feed = {
        'drug_input': _input_array(drug_tokens, input_meta['drug_input']),
        'protein_input': _input_array(protein_tokens, input_meta['protein_input']),
    }
    output = session.run(None, feed)[0]
    value = float(np.asarray(output).reshape(-1)[0])
    if not np.isfinite(value):
        raise RuntimeError('The model returned a non-finite prediction.')

    if dataset == 'davis':
        strength = 'Weak' if value < 6.0 else ('Moderate' if value < 7.0 else 'Strong')
        unit = 'pKd'
    else:
        strength = 'Weak' if value < 11.0 else ('Moderate' if value < 12.1 else 'Strong')
        unit = 'KIBA score'
    return {
        'dataset': dataset,
        'prediction': value,
        'unit': unit,
        'binding_strength': f'{strength} binding (illustrative range)',
        'smiles_truncated': len(smiles) > max_smi_len,
        'protein_truncated': len(protein_sequence) > max_seq_len,
    }
