"""python -m valuebet --help"""
import argparse
import json
from pathlib import Path
from urllib.error import URLError
from .data import download,clean,synthetic
from .model import walk_forward,scores
from .backtest import simulate

def main():
    parser = argparse.ArgumentParser(description='Investigación 1X2 LaLiga; no coloca apuestas')
    parser.add_argument('--seasons',nargs='+',default=['1819','1920','2021','2122','2223','2324','2425'])
    parser.add_argument('--csv',nargs='+',help='CSV locales football-data con B365H/D/A')
    parser.add_argument('--demo',action='store_true',help='Datos artificiales, sin evidencia económica')
    parser.add_argument('--data-dir',default='data')
    parser.add_argument('--output',default='outputs')
    parser.add_argument('--min-train',type=int,default=760)
    parser.add_argument('--block-days',type=int,default=90)
    parser.add_argument('--threshold',type=float,default=.05)
    parser.add_argument('--bankroll',type=float,default=1000)
    parser.add_argument('--kelly',type=float,default=.25)
    parser.add_argument('--cap',type=float,default=.02)
    parser.add_argument('--daily-cap',type=float,default=.10)
    parser.add_argument('--commission',type=float,default=.02)
    parser.add_argument('--haircut',type=float,default=0)
    args = parser.parse_args()
    if not (args.min_train > 0 and args.block_days > 0 and args.bankroll > 0
            and 0 <= args.threshold and 0 < args.kelly <= 1
            and 0 < args.cap <= args.daily_cap <= 1
            and 0 <= args.commission < 1 and 0 <= args.haircut < 1):
        parser.error('Parámetros fuera de rango')
    if args.demo and args.csv:
        parser.error('--demo y --csv son excluyentes')
    try:
        if args.demo:
            Path(args.data_dir).mkdir(parents=True,exist_ok=True)
            path = Path(args.data_dir)/'synthetic.csv'
            synthetic(path)
            paths = [path]
        else:
            paths = args.csv or download(args.seasons,args.data_dir)
        matches = clean(paths)
        pred, folds = walk_forward(matches,args.min_train,args.block_days)
        report,bets,curve = simulate(pred, args.bankroll,args.threshold,args.kelly,
            args.cap,args.daily_cap,args.commission,args.haircut)
    except (URLError, ValueError, OSError) as error:
        parser.exit(1,f'No se completó el análisis: {error}\n')
    output = Path(args.output)
    output.mkdir(parents=True,exist_ok=True)
    summary = {'synthetic':args.demo,'parameters':vars(args),'validation':scores(pred),
               'folds':folds,'backtest':report,
               'warning':'Sin garantía de ganancias. Riesgo de pérdida total. Intervalo condicional, no prospectivo.'}
    (output/'report.json').write_text(json.dumps(summary,indent=2,allow_nan=False))
    pred.to_csv(output/'predictions.csv',index=False)
    bets.to_csv(output/'bets.csv',index=False)
    curve.to_csv(output/'equity.csv',index=False)
    print(json.dumps({'synthetic':args.demo,'validation':summary['validation'],
                      'backtest':report},indent=2,allow_nan=False))

if __name__ == '__main__':
    main()
