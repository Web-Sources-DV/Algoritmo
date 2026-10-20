# Value betting: LaLiga, mercado 1X2

Sistema de investigación en Python 3.12. Estima probabilidades de victoria local (H), empate (D) y victoria visitante (A), identifica EV positivo y simula apuestas. No coloca apuestas, no promete ganancias y no es un sistema listo para operar con dinero real.

## Ejecutar

Desde `/workspace/Algoritmo` (o la raíz de su clon):

```bash
python3 -m venv --system-site-packages .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m valuebet --demo --output outputs/demo
.venv/bin/python -m valuebet --seasons 1819 1920 2021 2122 2223 2324 2425 --output outputs/laliga
```

La demo usa datos artificiales deterministas y está etiquetada `synthetic: true`. Sus métricas **no constituyen resultados históricos deportivos**, ni estimaciones de rentabilidad futura. El comando real falla explícitamente ante problemas de acceso; nunca sustituye silenciosamente los datos por una demo.

Si la descarga está bloqueada, descargue los CSV en una máquina autorizada y cópielos a `data/`. Después:

```bash
.venv/bin/python -m valuebet --csv data/SP1_1819.csv data/SP1_1920.csv data/SP1_2021.csv data/SP1_2122.csv data/SP1_2223.csv data/SP1_2324.csv data/SP1_2425.csv --output outputs/laliga
```

Los ejemplos inicializan 760 partidos de entrenamiento; conjuntos menores necesitan `--min-train` apropiado y suficientes resultados de las tres clases. `--help` describe todos los parámetros. No se necesitan claves ni servidores persistentes.

## Fuentes y limpieza

- [Football-data.co.uk: España](https://www.football-data.co.uk/spainm.php): CSV gratuitos por temporada con resultados, estadísticas y cuotas. Endpoint usado: `https://www.football-data.co.uk/mmz4281/2425/SP1.csv`; `2425` corresponde a 2024/25. [Notas de campos y fuentes](https://www.football-data.co.uk/notes.txt). Verificar condiciones de uso, cobertura y calidad antes de redistribuir.
- Los CSV contienen también tiros y otras estadísticas según temporada; esta primera versión descarga el archivo completo pero utiliza goles, puntos y cuotas Bet365 para mantener columnas consistentes. Nunca usa estadísticas del partido a predecir como entrada.
- [football-data.org](https://www.football-data.org/): alternativa con plan gratuito y clave para resultados/calendarios; verificar la cobertura vigente. No se implementa aquí y no sustituye un archivo histórico de cuotas.
- Las cuotas históricas gratuitas no garantizan un historial de precios ejecutables ni marcas de tiempo precisas. Para uso prospectivo se necesita una fuente autorizada con instante de captura y disponibilidad real; no se presupone una API gratuita con ese historial.

`data.py` descarga con TLS normal y timeout; guarda URL y SHA-256 junto al CSV nuevo. Conserva caché local; para actualizar una temporada hay que retirar explícitamente su CSV y metadatos. El hash documenta los bytes, no certifica la exactitud de los datos del proveedor. Analiza fechas día/mes, convierte números, rechaza goles inválidos, cuotas no finitas o ≤1, campos ausentes y resultados inconsistentes; informa descartes y rechaza duplicados. Los registros sin las tres cuotas no entran en la comparación. No imputa precios ni combina casas para construir un precio imposible.

## Modelo y validación

Regresión logística multiclase con escalado y regularización fija `C=0.1`. Variables: media de puntos, goles a favor y en contra de los cinco partidos anteriores de cada equipo, las mismas medias en casa/fuera y número de observaciones recientes. Para equipos sin historia se usan priors fijos (1 punto, 1.2 goles a favor/en contra); no se estiman con datos futuros. Se conserva la historia entre temporadas, una simplificación explícita. El orden local/visitante y los historiales específicos reflejan la localía.

Walk-forward de ventana expansiva: entrenamiento únicamente con fechas anteriores al bloque de prueba, reentrenamiento cada 90 días (`--block-days`), sin particiones aleatorias. El escalador se ajusta sólo en entrenamiento. Durante un bloque se incorporan a las variables los resultados ya conocidos de fechas anteriores; los coeficientes del modelo permanecen fijos hasta el siguiente bloque. Todos los partidos de la misma fecha usan el historial previo a esa fecha, incluso si tienen horarios diferentes.

`report.json` guarda límites y tamaños de cada fold, parámetros y métricas agregadas fuera de muestra:

- **Log-loss**: menor es mejor; penaliza mucho la confianza errónea.
- **Brier multiclase**: media de la suma de tres errores cuadrados, rango 0–2; menor es mejor.
- **Mercado sin margen**: `q_i = (1/cuota_i) / sum(1/cuota_j)` usando las mismas cuotas y partidos. Es una normalización proporcional, no una probabilidad verdadera demostrada. El overround es `sum(1/cuota)-1`.

No se incluyen las cuotas en las variables del modelo. B365H/D/A se usan como precio de referencia; no se usan B365CH/CD/CA de cierre. La ausencia de timestamp exacto impide garantizar que el precio existiera después de todos los resultados usados en las variables: la validación de resultados es temporal, pero la ejecutabilidad histórica de las cuotas **no está certificada**. No interpretar este backtest como una prueba de ejecución real.

## EV, Kelly y costes

Para cada partido se considera sólo el resultado con EV máximo y se apuesta sólo si supera estrictamente `--threshold` (5% por defecto). Esto evita apuestas correlacionadas sobre varios resultados del mismo partido.

```
cuota_efectiva = 1 + (cuota - 1) × (1 - haircut) × (1 - comisión)
EV = p_modelo × cuota_efectiva - 1
Kelly = max(0, (p_modelo × cuota_efectiva - 1) / (cuota_efectiva - 1))
fracción = min(tope, Kelly × fracción_Kelly)
```

Valores iniciales: bankroll 1.000 unidades, 1/4 de Kelly, tope del 2% por apuesta y exposición agregada máxima del 10% por fecha. Si se supera el límite diario, las apuestas se reducen proporcionalmente. Se usa el saldo al inicio del día para todas sus apuestas y se liquida al final; no hay reinversión de ganancias intrajornada.

El margen de la casa ya está incluido en las cuotas ofrecidas: no se resta otra vez. La comisión adicional por defecto del 2% de ganancias es una hipótesis conservadora configurable, no una tarifa atribuida a Bet365. Use `--commission 0` para una casa sin comisión adicional. `--haircut .01` reduce un 1% la parte de beneficio de la cuota para estudiar deslizamiento. No modela impuestos, límites de cuenta, rechazos, apuestas anuladas ni cambios de precio intradía.

## Interpretación e incertidumbre

Salidas en el directorio elegido:

- `report.json`: métricas, parámetros, folds y resumen económico.
- `predictions.csv`: probabilidades fuera de muestra de cada resultado y cuotas.
- `bets.csv`: selección, probabilidad, EV neto de costes, importe y beneficio realizado.
- `equity.csv`: saldo por fecha; drawdown calculado respecto al máximo histórico, incluyendo el saldo inicial.

ROI = beneficio neto / importe total apostado; rentabilidad del bankroll = saldo final / inicial − 1. No confundir ambas. Sin apuestas el ROI y el intervalo son nulos. Se informa el número de apuestas y el drawdown máximo observado a cierre diario; no representa pérdidas intradía ni el peor escenario futuro.

Se calcula un intervalo descriptivo de ROI del 95% mediante 2.000 remuestreos de bloques semanales que incluyen semanas sin apuestas. Conserva las apuestas e importes realizados: **no** reentrena el modelo ni recalcula Kelly en cada remuestreo. Supone intercambiabilidad de bloques, puede subestimar dependencias largas, cambios de régimen, incertidumbre del modelo y selección de hiperparámetros. No es una garantía ni un intervalo predictivo; tampoco estima la probabilidad de ruina. Un intervalo que cruza cero es evidencia insuficiente de ventaja, y uno positivo tampoco la demuestra por sí solo.

No ajustar umbrales, variables o Kelly buscando el mejor ROI en estas mismas pruebas. Congelar decisiones y evaluar después en una temporada intacta o con evaluación prospectiva. La regularización no elimina el sobreajuste; probabilidades mal calibradas hacen que Kelly sobredimensione apuestas. Esta versión no incorpora lesiones, alineaciones, calidad del rival explícita, calibración anidada ni cambios de entrenador. Forma reciente y datos históricos pueden dejar de ser informativos.

El margen, la varianza, los errores de datos, el sobreajuste y los costes pueden causar pérdidas sostenidas y **pérdida total del capital**. No existe garantía de ganancia. Usar sólo para investigación, respetar la legislación y no arriesgar dinero necesario para gastos esenciales.

## Estructura

`valuebet/data.py`: datos y demo; `model.py`: variables/modelo/validación; `backtest.py`: staking, liquidación e incertidumbre; `__main__.py`: interfaz y artefactos. `tests/test_core.py` comprueba causalidad temporal (incluida la misma fecha), separación de folds, probabilidades, Kelly, límites y liquidación.
