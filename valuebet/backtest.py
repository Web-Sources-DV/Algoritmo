"""Kelly fraccionado y liquidación por fecha, sin reinversión intrajornada."""
import numpy as np
import pandas as pd
from .data import ODDS
from .model import LABELS

def kelly(p, odds, fraction=.25, cap=.02):
    return np.clip(fraction * (p*odds-1)/(odds-1), 0, cap)

def simulate(pred, bankroll=1000., threshold=.05, fraction=.25, cap=.02,
             daily_cap=.10, commission=.02, haircut=0., seed=42):
    initial = bankroll
    ledger, curve = [], [{'Date':'initial','bankroll':bankroll}]
    for date, group in pred.groupby('Date',sort=True):
        candidates = []
        opening = bankroll
        for _, match in group.iterrows():
            # Coste sobre ganancias; haircut simula peores cuotas ejecutables.
            odds = 1 + (match[ODDS].to_numpy(dtype=float)-1)*(1-haircut)*(1-commission)
            p = match[['pH','pD','pA']].to_numpy(dtype=float)
            ev = p * odds - 1
            choice = int(np.argmax(ev))  # Como máximo una selección por partido.
            if ev[choice] > threshold:
                weight = float(kelly(p[choice],odds[choice],fraction,cap))
                if weight > 0:
                    candidates.append((match, choice, odds[choice], p[choice], ev[choice], weight))
        total = sum(c[-1] for c in candidates)
        scale = min(1.,daily_cap/total) if total else 1.
        for match, choice, odds, probability, ev, weight in candidates:
            stake = opening * weight * scale
            won = match.FTR == LABELS[choice]
            profit = stake*(odds-1) if won else -stake
            bankroll += profit
            ledger.append({'Date':str(date.date()), 'HomeTeam':match.HomeTeam,
                'AwayTeam':match.AwayTeam, 'selection':LABELS[choice],
                'probability':probability,'effective_odds':odds,'ev':ev,
                'stake':stake,'won':won,'profit':profit})
        curve.append({'Date':str(date.date()),'bankroll':bankroll})
    bets = pd.DataFrame(ledger)
    equity = pd.DataFrame(curve)
    values = equity.bankroll.to_numpy()
    drawdown = 1 - values / np.maximum.accumulate(values)
    turnover = float(bets.stake.sum()) if len(bets) else 0.
    report = {'bets':len(bets), 'initial_bankroll':initial,'final_bankroll':bankroll,
              'total_staked':turnover,'profit':bankroll-initial,
              'roi_on_stakes':(bankroll-initial)/turnover if turnover else None,
              'bankroll_return':bankroll/initial-1, 'max_drawdown':float(drawdown.max()),
              'roi_95pct_week_block_bootstrap':None}
    if turnover:
        # Bloques de semanas completas: incluye jornadas sin apuestas.
        dates = pd.to_datetime(pred.Date)
        first = dates.min()
        nblocks = int((dates.max()-first).days//7)+1
        weekly = np.zeros((nblocks,2))
        for _, b in bets.iterrows():
            i = (pd.Timestamp(b.Date)-first).days//7
            weekly[i] += [b.profit,b.stake]
        rng = np.random.default_rng(seed)
        ratios = []
        for _ in range(2000):
            sampled = weekly[rng.integers(0,nblocks,nblocks)].sum(axis=0)
            if sampled[1] > 0:
                ratios.append(sampled[0]/sampled[1])
        report['roi_95pct_week_block_bootstrap'] = np.quantile(ratios,[.025,.975]).tolist()
    return report,bets,equity
