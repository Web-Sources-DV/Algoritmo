"""Descarga verificando TLS, limpieza explícita y datos sintéticos de prueba."""
from pathlib import Path
from urllib.request import urlopen
import hashlib
import json
import numpy as np
import pandas as pd

ODDS = ['B365H', 'B365D', 'B365A']

def download(seasons, folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for season in seasons:
        if len(season) != 4 or not season.isdigit():
            raise ValueError('Temporada esperada: 2324, 2425, etc.')
        path = folder / f'SP1_{season}.csv'
        if not path.exists():
            url = f'https://www.football-data.co.uk/mmz4281/{season}/SP1.csv'
            with urlopen(url, timeout=60) as response:
                payload = response.read()
            # No guardar páginas de error como CSV.
            if b'HomeTeam' not in payload or b'B365H' not in payload:
                raise ValueError(f'CSV sin columnas necesarias: {url}')
            path.write_bytes(payload)
            path.with_suffix('.source.json').write_text(json.dumps({
                'url': url, 'sha256': hashlib.sha256(payload).hexdigest()
            }, indent=2))
        paths.append(path)
    return paths

def clean(paths):
    frames = []
    for path in paths:
        frame = pd.read_csv(path)
        required = ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'FTR'] + ODDS
        missing = set(required) - set(frame.columns)
        if missing:
            raise ValueError(f'{path}: faltan {missing}')
        frame = frame[required].copy()
        frame['Date'] = pd.to_datetime(frame.Date, dayfirst=True, errors='coerce')
        for col in ['FTHG', 'FTAG'] + ODDS:
            frame[col] = pd.to_numeric(frame[col], errors='coerce')
        before = len(frame)
        frame = frame.dropna(subset=required)
        valid = (frame[ODDS] > 1).all(axis=1) & np.isfinite(frame[ODDS]).all(axis=1)
        valid &= (frame[['FTHG', 'FTAG']] >= 0).all(axis=1)
        valid &= (frame[['FTHG', 'FTAG']] % 1 == 0).all(axis=1)
        expected = np.where(frame.FTHG > frame.FTAG, 'H', np.where(frame.FTHG < frame.FTAG, 'A', 'D'))
        valid &= frame.FTR.eq(expected) & frame.HomeTeam.ne(frame.AwayTeam)
        frame = frame.loc[valid]
        print(f'{path}: {len(frame)} válidos; {before-len(frame)} descartados')
        frames.append(frame)
    result = pd.concat(frames, ignore_index=True)
    keys = ['Date', 'HomeTeam', 'AwayTeam']
    if result.duplicated(keys).any():
        raise ValueError('Partidos duplicados: revise archivos o temporadas solapadas')
    return result.sort_values(keys).reset_index(drop=True)

def synthetic(path):
    """Fixture artificial: nunca interpretar como evidencia deportiva."""
    rng = np.random.default_rng(42)
    rows = []
    teams = [f'Equipo{i:02}' for i in range(20)]
    strength = rng.normal(0, .3, 20)
    for day in range(240):
        order = rng.permutation(20)
        for h, a in order.reshape(-1, 2):
            hg = rng.poisson(np.exp(.35 + strength[h] - strength[a]))
            ag = rng.poisson(np.exp(.1 + strength[a] - strength[h]))
            # Mercado artificial independiente del resultado realizado.
            logits = np.array([.3+strength[h]-strength[a], -.35, strength[a]-strength[h]])
            probs = np.exp(logits) / np.exp(logits).sum()
            rows.append([ (pd.Timestamp('2018-08-01') + pd.Timedelta(days=7*day)).strftime('%d/%m/%Y'),
                teams[h], teams[a], hg, ag, 'H' if hg > ag else 'A' if hg < ag else 'D',
                *(1/(probs*1.06))])
    pd.DataFrame(rows, columns=['Date','HomeTeam','AwayTeam','FTHG','FTAG','FTR']+ODDS).to_csv(path,index=False)
