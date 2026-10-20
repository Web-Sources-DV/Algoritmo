"""Interfaz Streamlit: ejecutar con streamlit run app.py."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import URLError

import pandas as pd
import streamlit as st

from valuebet.data import clean, download, synthetic
from valuebet.model import scores, walk_forward
from valuebet.backtest import simulate

st.set_page_config(page_title='ValueBet · LaLiga', page_icon='⚽', layout='wide')
st.title('⚽ ValueBet')
st.caption('LaLiga · Análisis de probabilidades y simulación de apuestas 1X2')
st.warning('Herramienta de investigación. No garantiza ganancias y puedes perder todo el capital. No coloca apuestas.')

with st.sidebar:
    st.header('Prepara tu análisis')
    with st.form('analysis'):
        source = st.selectbox('Fuente de datos', ['Demostración', 'Subir CSV históricos', 'Descargar LaLiga'])
        st.caption('La demostración usa datos artificiales. Los CSV deben tener el formato football-data.co.uk.')
        uploads = st.file_uploader('Archivos históricos CSV', type=['csv'], accept_multiple_files=True)
        seasons = st.multiselect('Temporadas para descargar',
            ['1819','1920','2021','2122','2223','2324','2425','2526'],
            default=['1819','1920','2021','2122','2223','2324','2425'])
        bankroll = st.number_input('Capital inicial (unidades)', min_value=1., value=1000., step=100.)
        threshold = st.slider('EV mínimo (%)', 0., 50., 5., step=.5,
            help='Se apuesta sólo cuando el valor esperado supera este umbral después de costes.')
        with st.expander('Riesgo y costes'):
            fraction = st.slider('Fracción de Kelly (%)', 1.,100.,25.,step=1.)
            cap = st.slider('Máximo por apuesta (% del saldo)', .1,20.,2.,step=.1)
            daily_cap = st.slider('Máximo por fecha (% del saldo)', .1,100.,10.,step=.1)
            commission = st.slider('Comisión sobre ganancias (%)', 0.,20.,2.,step=.5)
            haircut = st.slider('Reducción de cuota por deslizamiento (%)',0.,20.,0.,step=.5)
        with st.expander('Validación temporal'):
            min_train = st.number_input('Partidos de entrenamiento inicial',min_value=100,value=760,step=100)
            block_days = st.number_input('Días entre reentrenamientos',min_value=1,value=90,step=10)
        submitted = st.form_submit_button('Analizar partidos',type='primary',width='stretch')

if submitted:
    # Evitar mostrar resultados anteriores como si correspondieran al intento nuevo.
    st.session_state.pop('result', None)
    if cap > daily_cap:
        st.error('El máximo por apuesta debe ser menor o igual al máximo por fecha.')
    elif source == 'Subir CSV históricos' and not uploads:
        st.error('Selecciona al menos un CSV en el panel lateral.')
    elif source == 'Descargar LaLiga' and not seasons:
        st.error('Selecciona al menos una temporada para descargar.')
    else:
        try:
            with st.spinner('Preparando datos, validación temporal y simulación…'):
                with TemporaryDirectory() as directory:
                    if source == 'Demostración':
                        path = Path(directory)/'demo.csv'
                        synthetic(path)
                        paths = [path]
                    elif source == 'Subir CSV históricos':
                        paths = []
                        for i, upload in enumerate(uploads):
                            path = Path(directory)/f'upload_{i}.csv'
                            path.write_bytes(upload.getvalue())
                            paths.append(path)
                    else:
                        # Caché propia de la aplicación, separada de los archivos subidos.
                        paths = download(seasons, 'data/web')
                    matches = clean(paths)
                predictions, folds = walk_forward(matches,int(min_train),int(block_days))
                report, bets, equity = simulate(predictions,bankroll=bankroll,
                    threshold=threshold/100,fraction=fraction/100,cap=cap/100,
                    daily_cap=daily_cap/100,commission=commission/100,haircut=haircut/100)
                parameters = dict(source=source,seasons=seasons if source == 'Descargar LaLiga' else [],
                    bankroll=bankroll,threshold=threshold/100,kelly_fraction=fraction/100,
                    cap=cap/100,daily_cap=daily_cap/100,commission=commission/100,
                    haircut=haircut/100,min_train=int(min_train),block_days=int(block_days))
                summary = dict(synthetic=source == 'Demostración',parameters=parameters,
                    validation=scores(predictions),folds=folds,backtest=report,
                    warning='Sin garantía de ganancias. Riesgo de pérdida total. Intervalo condicional, no prospectivo.')
                st.session_state.result = dict(summary=summary,predictions=predictions,
                    bets=bets,equity=equity,rows=len(matches),start=str(matches.Date.min().date()),
                    end=str(matches.Date.max().date()))
        except (ValueError,OSError,URLError,UnicodeError,pd.errors.ParserError) as error:
            st.error(f'No se pudo completar el análisis: {error}')
            st.info('Si la descarga falla, usa CSV locales de football-data.co.uk o prueba la demostración. '
                    'Se necesitan Date, HomeTeam, AwayTeam, FTHG, FTAG, FTR y B365H/B365D/B365A.')

if 'result' not in st.session_state:
    st.subheader('De los datos a una decisión informada')
    st.write('Elige una fuente en el panel lateral y pulsa **Analizar partidos**. '
             'Para empezar sin archivos, usa **Demostración**.')
    a,b,c = st.columns(3)
    a.info('1 · Probabilidades\n\nForma reciente y rendimiento local/visitante.')
    b.info('2 · Valor esperado\n\nComparación del modelo con las cuotas y los costes.')
    c.info('3 · Riesgo\n\nSimulación de capital, Kelly y pérdidas históricas.')
else:
    result = st.session_state.result
    summary = result['summary']
    report = summary['backtest']
    if summary['synthetic']:
        st.error('DEMOSTRACIÓN · Datos artificiales. Estas cifras no representan LaLiga ni rentabilidad real.')
    st.caption(f"Resultado calculado · {result['rows']:,} partidos · {result['start']} a {result['end']} · "
               'Para aplicar cambios del panel, vuelve a pulsar Analizar partidos.')
    a,b,c,d = st.columns(4)
    a.metric('Saldo final',f"{report['final_bankroll']:,.2f} u.",f"{report['bankroll_return']:.1%}")
    b.metric('ROI sobre lo apostado', 'Sin apuestas' if report['roi_on_stakes'] is None else f"{report['roi_on_stakes']:.2%}")
    c.metric('Pérdida máxima desde un pico',f"{report['max_drawdown']:.2%}")
    d.metric('Apuestas simuladas',report['bets'])
    overview, validation, selections, exports = st.tabs(['Capital y riesgo','Calidad del modelo','Apuestas históricas','Descargas'])
    with overview:
        st.subheader('Evolución del capital')
        equity = result['equity'].copy()
        # El saldo inicial precede a la primera liquidación de la serie.
        equity.loc[0,'Date'] = str((pd.Timestamp(equity.iloc[1].Date)-pd.Timedelta(days=1)).date())
        equity['Fecha'] = pd.to_datetime(equity.Date)
        st.line_chart(equity.set_index('Fecha')[['bankroll']].rename(columns={'bankroll':'Saldo (unidades)'}))
        interval = report['roi_95pct_week_block_bootstrap']
        if interval:
            st.info(f'Intervalo descriptivo del ROI al 95%: {interval[0]:.2%} a {interval[1]:.2%}. '
                    'Bootstrap semanal de apuestas realizadas; no es una predicción ni una garantía.')
        else:
            st.info('No hubo apuestas que superasen el umbral. No hay ROI ni intervalo que estimar.')
        st.write('El ROI divide el beneficio por el total apostado. El retorno del saldo compara el capital final '
                 'con el inicial. El drawdown mide caídas desde máximos al cierre de cada fecha.')
    with validation:
        metrics = summary['validation']
        st.subheader('Modelo frente al mercado')
        st.dataframe(pd.DataFrame({
            'Referencia':['Modelo','Mercado sin margen'],
            'Log-loss':[metrics['model']['log_loss'],metrics['market_no_vig']['log_loss']],
            'Brier (0–2)':[metrics['model']['brier_multiclass_sum'],metrics['market_no_vig']['brier_multiclass_sum']]
        }),hide_index=True,width='stretch')
        st.caption(f"Menor es mejor en ambas métricas · {metrics['matches']:,} partidos fuera de muestra · "
                   f"Margen medio implícito: {metrics['mean_market_overround']:.2%}")
        st.write('Entrenamiento sólo con fechas anteriores al bloque evaluado. Las probabilidades del mercado '
                 'se normalizan para retirar su margen proporcionalmente.')
        st.dataframe(pd.DataFrame(summary['folds']),hide_index=True,width='stretch')
    with selections:
        st.caption('H = local · D = empate · A = visitante. Selecciones retrospectivas, no recomendaciones para partidos futuros.')
        if result['bets'].empty:
            st.info('Ninguna apuesta superó el umbral configurado.')
        else:
            st.dataframe(result['bets'],hide_index=True,width='stretch')
    with exports:
        st.download_button('Descargar informe JSON',json.dumps(summary,indent=2,allow_nan=False),
                           file_name='valuebet_report.json',mime='application/json')
        for key,label in [('predictions','Probabilidades'),('bets','Apuestas'),('equity','Evolución del capital')]:
            st.download_button(f'Descargar {label}',result[key].to_csv(index=False),
                               file_name=f'{key}.csv',mime='text/csv')
        st.json(summary['parameters'])

with st.expander('Cómo interpretar y usar con cautela'):
    st.write('EV = probabilidad × cuota efectiva − 1. Un EV estimado positivo depende de que la probabilidad '
             'sea correcta. Kelly fraccionado reduce la exposición, pero no elimina el riesgo. '
             'El margen ya está incluido en las cuotas; la comisión configurada es un coste adicional sobre ganancias.')
    st.write('Sobreajuste, mala calibración, varianza y cambios de régimen pueden generar pérdidas. '
             'Los precios históricos no certifican disponibilidad en el instante de decisión. '
             'El intervalo no reentrena el modelo ni estima la probabilidad de ruina. '
             'No ajustes parámetros buscando maximizar el resultado del mismo periodo de prueba.')
