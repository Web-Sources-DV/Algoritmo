"""Features disponibles antes del partido y evaluación con ventanas expansivas."""
from collections import defaultdict, deque
import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from .data import ODDS

LABELS = ['H', 'D', 'A']

def features(matches, window=5):
    history = defaultdict(lambda: deque(maxlen=window))
    venue = defaultdict(lambda: deque(maxlen=window))
    rows = []
    def summary(records):
        return np.mean(records, axis=0) if records else np.array([1., 1.2, 1.2])
    # Todos los partidos de una fecha ven únicamente fechas anteriores.
    for _, group in matches.groupby('Date', sort=True):
        for _, m in group.iterrows():
            rows.append(np.r_[summary(history[m.HomeTeam]), summary(history[m.AwayTeam]),
                              summary(venue[(m.HomeTeam,'H')]), summary(venue[(m.AwayTeam,'A')]),
                              len(history[m.HomeTeam]),len(history[m.AwayTeam])])
        for _, m in group.iterrows():
            hp, ap = (3,0) if m.FTR == 'H' else (0,3) if m.FTR == 'A' else (1,1)
            for team, side, record in [(m.HomeTeam,'H',(hp,m.FTHG,m.FTAG)),
                                       (m.AwayTeam,'A',(ap,m.FTAG,m.FTHG))]:
                history[team].append(record)
                venue[(team,side)].append(record)
    return np.asarray(rows)

def walk_forward(matches, min_train=760, block_days=90):
    x = features(matches)
    y = matches.FTR.map({label:i for i,label in enumerate(LABELS)}).to_numpy()
    dates = matches.Date
    eligible = np.flatnonzero(np.arange(len(matches)) >= min_train)
    if not len(eligible):
        raise ValueError('Datos insuficientes para entrenamiento inicial')
    start = dates.iloc[eligible[0]]
    predictions, folds = [], []
    while start <= dates.max():
        end = start + pd.Timedelta(days=block_days)
        train = (dates < start).to_numpy()
        test = ((dates >= start) & (dates < end)).to_numpy()
        if test.any() and train.sum() >= min_train:
            if len(np.unique(y[train])) != 3:
                raise ValueError('El entrenamiento necesita los tres resultados')
            model = make_pipeline(StandardScaler(), LogisticRegression(C=.1,max_iter=2000))
            model.fit(x[train], y[train])
            p = model.predict_proba(x[test])
            out = matches.loc[test].copy()
            out[['pH','pD','pA']] = p
            out['fold'] = len(folds)
            predictions.append(out)
            folds.append({'train_n':int(train.sum()), 'test_n':int(test.sum()),
                          'train_until':str(dates[train].max().date()), 'test_from':str(start.date()),
                          'test_until':str(dates[test].max().date())})
        start = end
    if not predictions:
        raise ValueError('No hay folds evaluables')
    return pd.concat(predictions).reset_index(drop=True), folds

def scores(pred):
    y = pred.FTR.map({label:i for i,label in enumerate(LABELS)}).to_numpy()
    truth = np.eye(3)[y]
    market = 1 / pred[ODDS].to_numpy()
    overround = market.sum(axis=1)
    market /= overround[:,None]
    result = {'matches':len(pred), 'mean_market_overround':float(overround.mean()-1)}
    for name, p in [('model',pred[['pH','pD','pA']].to_numpy()),('market_no_vig',market)]:
        result[name] = {'log_loss':float(log_loss(y,p,labels=[0,1,2])),
                        'brier_multiclass_sum':float(np.mean(np.sum((p-truth)**2,axis=1)))}
    return result
