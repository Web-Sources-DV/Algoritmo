import unittest
import numpy as np
import pandas as pd
from valuebet.data import synthetic,clean
from valuebet.model import features,walk_forward
from valuebet.backtest import simulate,kelly
import tempfile
from pathlib import Path

class CoreTests(unittest.TestCase):
    def test_kelly(self):
        self.assertAlmostEqual(float(kelly(.6,2,.25,1)),.05)
        self.assertEqual(float(kelly(.4,2)),0)
        self.assertEqual(float(kelly(.99,10)),.02)

    def test_temporal_features_and_folds(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'sample.csv'
            synthetic(path)
            matches = clean([path])
            original = features(matches)
            changed = matches.copy()
            cutoff = changed.Date.iloc[1000]
            changed.loc[changed.Date >= cutoff,['FTHG','FTAG','FTR']] = [8,0,'H']
            np.testing.assert_array_equal(original[matches.Date <= cutoff],
                                          features(changed)[changed.Date <= cutoff])
            pred,folds = walk_forward(matches)
            self.assertGreater(len(pred),0)
            for fold in folds:
                self.assertLess(fold['train_until'],fold['test_from'])
            np.testing.assert_allclose(pred[['pH','pD','pA']].sum(axis=1),1)

    def test_settlement_and_daily_limit(self):
        day = pd.DataFrame([dict(Date=pd.Timestamp('2024-01-01'),HomeTeam='A',AwayTeam='B',
            FTR='H',B365H=2.,B365D=3.,B365A=4.,pH=.8,pD=.1,pA=.1)]*10)
        result,bets,_ = simulate(day,bankroll=1000,commission=0,daily_cap=.1)
        self.assertAlmostEqual(bets.stake.sum(),100)
        self.assertAlmostEqual(result['final_bankroll'],1100)
        result,_,_ = simulate(day,threshold=5)
        self.assertEqual(result['bets'],0)
        self.assertIsNone(result['roi_on_stakes'])

if __name__ == '__main__':
    unittest.main()
