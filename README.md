# ValueBet — app web en HTML, CSS y JavaScript

Aplicación de investigación de value betting para fútbol, **LaLiga, mercado 1X2**. Versión 2: el procesamiento, el modelo y la interfaz están escritos en JavaScript. No requiere Python, Streamlit, claves, frameworks, CDN ni un servidor de aplicación.

Estima probabilidades, compara con el mercado y simula una estrategia. **No coloca apuestas ni garantiza ganancias. Puedes perder todo el capital.**

## Abrir la app

La forma más sencilla:

1. Descarga el repositorio con **Code → Download ZIP** y descomprímelo.
2. Abre `index.html` en tu navegador.
3. Pulsa **Explorar la demo**.

La demo y los CSV locales funcionan sin conexión a Internet y sin instalar nada. `index.html` tiene que conservar a su lado `styles.css` y la carpeta `js/`. El modo demostración usa 2.400 partidos **artificiales** deterministas, identificados como tales en pantalla y en las exportaciones. No constituyen resultados históricos reales ni evidencia de rentabilidad.

Opcionalmente, para servir la app por HTTP con Node.js 20 o superior:

```bash
npm start
```

El servidor usa el puerto 8080 o la variable `PORT`. No necesita `npm install` para arrancar: sólo utiliza módulos nativos de Node. Es un servidor estático de desarrollo, no un backend de predicción ni un sistema de usuarios. Sólo sirve los archivos de la app, sin exponer datos locales, `.git` o dependencias.

## Uso

1. **Fuente:** demostración, CSV locales o descarga de LaLiga.
2. **Estrategia:** capital inicial y EV mínimo. En las opciones avanzadas se ajustan Kelly, límites por apuesta/fecha, comisión, deslizamiento y separación temporal.
3. **Ejecutar análisis:** los controles se bloquean mientras se calcula. Los cambios posteriores se señalan y sólo se aplican al ejecutar nuevamente.
4. **Capital y riesgo:** curva de saldo, ROI, retorno del capital, drawdown e intervalo descriptivo.
5. **Calidad del modelo:** log-loss, Brier y comparación con mercado sin margen, detalle de folds y filas descartadas.
6. **Apuestas históricas:** paginación y filtro ganadas/perdidas; selecciones retrospectivas, no apuestas futuras.
7. **Descargas:** informe JSON, probabilidades, apuestas y saldo en CSV. Los parámetros utilizados quedan en el informe.

Los archivos se procesan en tu navegador y no se envían a un backend. Los resultados permanecen en memoria hasta recargar; descarga lo que quieras conservar. La descarga externa de temporadas sí hace solicitudes HTTPS al proveedor.

## Datos históricos gratuitos

[Football-data.co.uk, España](https://www.football-data.co.uk/spainm.php) ofrece resultados, estadísticas y cuotas en CSV por temporada. [Notas de columnas](https://www.football-data.co.uk/notes.txt). Endpoint de ejemplo:

```
https://www.football-data.co.uk/mmz4281/2425/SP1.csv
```

`2425` significa 2024/25; el código SP1 corresponde a primera división española. La app permite descargar varias temporadas, pero el navegador puede bloquearlo por CORS y la red de alojamiento puede impedir el acceso. **No se desactiva CORS ni se usan proxies sin autorización.** Si falla, descarga los archivos desde la página del proveedor y cárgalos con **Mis archivos CSV**. No hay sustitución silenciosa por datos sintéticos.

Columnas obligatorias:

```text
Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A
```

H/D/A significan victoria local, empate y victoria visitante. La app acepta CSV con comas o punto y coma, campos entre comillas, BOM y fechas `dd/mm/aaaa`, `dd/mm/aa` o `aaaa-mm-dd`. Rechaza archivos mal formados, columnas ausentes, partidos duplicados y elimina filas sin datos válidos. Verifica goles enteros no negativos, resultado coherente y cuotas finitas > 1. Muestra los descartes por archivo, sin imputar precios. Máximo 20 MB de archivos subidos y 15.000 partidos por análisis.

Aunque los archivos contienen otras estadísticas, esta versión usa goles/puntos históricos y cuotas para conservar una cobertura consistente. No usa estadísticas del propio partido a predecir como entrada. Revisar siempre las condiciones de uso del proveedor antes de redistribuir datos.

Alternativa: [football-data.org](https://www.football-data.org/) ofrece API con plan gratuito y clave para calendarios y resultados (revisar cobertura vigente). No se implementa esa API; tampoco se presupone que incluya histórico gratuito de cuotas.

## Motor predictivo y prevención de fuga de datos

Regresión logística softmax multiclase implementada en `js/core.js`. Estandarización aprendida únicamente del entrenamiento. Descenso de gradiente determinista: 180 épocas, tasa 0.12, penalización L2 0.01 sobre coeficientes, sin penalizar interceptos. Son valores fijados de antemano, sin optimizarlos sobre las pruebas. No es una réplica numérica de la antigua versión scikit-learn; las salidas pueden diferir.

Variables de cada equipo: medias de puntos, goles a favor y en contra en sus últimos cinco partidos; las mismas medias en condición local/visitante; cantidad de partidos en el historial reciente. Se añaden Elo (base 1500, K=20, ventaja local 60), días de descanso hasta un máximo de 30 con indicador de historial, carga observada de 14 días y últimos cinco enfrentamientos directos. xG y posesión en último tercio se incorporan como medias rezagadas sólo si el CSV aporta las columnas opcionales. Ver [contrato y referencia](REFERENCE.md). Al no existir historial se usan priors fijos: 1 punto y 1.2 goles a favor/en contra. Se mantiene historia entre temporadas. El modelo no incorpora lesiones, alineaciones ni calibración posterior. Elo aporta una medida de fuerza relativa. Las probabilidades estimadas no deben asumirse perfectamente calibradas.

Como alternativa seleccionable, `Gradient boosting` utiliza 70 rondas de árboles de un nivel (stumps) por clase, tasa 0.15 y regularización 1. Las divisiones candidatas son cuantiles aprendidos sólo en entrenamiento, con al menos 15 registros por hoja. No es la librería XGBoost ni un modelo neuronal, y no implica que mejore al baseline. Ambos modelos usan las mismas variables y validación; el informe identifica el elegido.

Walk-forward de ventana expansiva: 760 partidos iniciales, bloques de 90 días por defecto. Entrena sólo con fechas estrictamente anteriores al bloque. Dentro del bloque los coeficientes permanecen fijos y las variables se actualizan con resultados conocidos de fechas anteriores. Todos los partidos de una misma fecha usan el estado anterior a esa fecha, sin reinversión de información intradía. Los folds, límites y tamaños se exportan. Nunca se divide aleatoriamente. Se limita a 100 bloques ocupados por análisis para evitar cargas excesivas en el navegador.

**Log-loss** penaliza especialmente la confianza errónea; **Brier** es la media de la suma de tres errores cuadrados, con rango 0–2. Menor es mejor. El mercado se compara en los mismos partidos: `q_i = (1/cuota_i) / sum(1/cuota_j)`. El overround es `sum(1/cuota)-1`. La normalización proporcional no convierte automáticamente el precio en la probabilidad verdadera.

No se incluyen cuotas como variables del modelo. Se utilizan B365H/D/A para comparar y liquidar, no cuotas de cierre B365CH/CD/CA. Sin timestamp preciso no se certifica que el precio estuviera disponible después de los resultados usados en las variables. La separación temporal de resultados **no demuestra ejecutabilidad histórica de las cuotas**.

## EV, costes y gestión de capital

```
cuota_efectiva = 1 + (cuota - 1) × (1 - comisión) × (1 - deslizamiento)
EV = p_modelo × cuota_efectiva - 1
Kelly = max(0, (p_modelo × cuota_efectiva - 1) / (cuota_efectiva - 1))
fracción = min(tope_por_apuesta, Kelly × fracción_Kelly)
```

Como máximo una selección por partido, la de EV máximo; sólo si supera estrictamente el umbral. Por defecto: 1.000 unidades, EV > 5%, 1/4 de Kelly, tope individual 2%, exposición agregada diaria 10%. Si se supera la exposición diaria, todas las apuestas del día se reducen proporcionalmente. Los importes usan el saldo al inicio de la fecha; se liquidan juntos sin reinvertir ganancias intradía.

El margen de la casa ya está incluido en los precios ofrecidos y no se resta dos veces. La comisión adicional por defecto, 2% de ganancias, es una hipótesis conservadora configurable; **no** una tarifa atribuida a Bet365. Para una casa sin comisión adicional selecciona 0%. Deslizamiento reduce la parte de beneficio de la cuota. No se modelan impuestos, apuestas anuladas, rechazos, límites de cuentas ni fluctuaciones intradía.

ROI = beneficio / total apostado. Retorno del capital = saldo final / saldo inicial − 1. Drawdown máximo = mayor caída desde un máximo previo, al cierre de las fechas, incluyendo el saldo inicial. Sin apuestas, ROI e intervalo son nulos. El drawdown no es el peor riesgo futuro ni incluye variaciones intradía.

## Incertidumbre y límites

El informe exportado incluye fecha de generación, especificación del modelo y hashes SHA-256 del texto de entrada cuando Web Crypto está disponible. Se incluyen todas las apuestas, aunque la tabla visual esté filtrada. La fecha de generación de un backtest no es una prueba de predicción anterior al partido; el archivo descargado es mutable.

Intervalo descriptivo del ROI al 95% mediante 2.000 remuestreos de bloques semanales, incluyendo semanas sin apuestas. Conserva importes realizados: no reentrena ni recalcula Kelly para cada remuestreo. Presupone intercambiabilidad de bloques y puede subestimar dependencias largas, cambios de régimen, incertidumbre del modelo y selección de parámetros. **No es un intervalo predictivo ni una estimación de la probabilidad de ruina.**

Un intervalo que cruza cero indica evidencia insuficiente de ventaja; uno positivo tampoco prueba rentabilidad futura. No seleccionar umbrales/variables buscando el mejor ROI sobre los mismos datos de prueba. Congelar decisiones y evaluar una temporada intacta o realizar una evaluación prospectiva antes de usar dinero real.

Sobreajuste, datos deficientes, mala calibración, margen, varianza y costes pueden provocar pérdidas sostenidas y pérdida total del capital. Usar para investigación y respetar la legislación aplicable. No apostar dinero necesario para gastos esenciales.

## Referencia solicitada: DeepBetting

Se analizaron los extractos del artículo pegados por el usuario. Se integraron Elo, descanso, densidad del calendario, enfrentamientos previos, métricas avanzadas opcionales y un modelo de árboles potenciados. [REFERENCE.md](REFERENCE.md) detalla la correspondencia, los contratos de datos y las afirmaciones que no se pueden verificar. No se reproduce ni se atribuye a esta app el motor propietario de DeepBetting.

## Pruebas

Las pruebas del motor no requieren dependencias:

```bash
npm test
```

Comprueban parsing/limpieza, fechas y duplicados; causalidad temporal, incluidas fechas compartidas; entrenamiento real y probabilidades; Kelly, costes, topes y liquidación; métricas con valores conocidos; escape de CSV y demo walk-forward completa.

Pruebas de navegador con Playwright:

```bash
npm ci --cache /tmp/valuebet-npm-cache
# Linux con Chromium instalado:
npm run test:web
# Para otra instalación, indicar CHROMIUM_PATH con la ruta al ejecutable.
```

El runner usa `/usr/bin/chromium` por defecto y levanta su propio servidor en el puerto 8099. Verifica demo por HTTP y abriendo `index.html` directamente, CSV, errores de configuración, exportación real, paginación, tratamiento seguro de nombres de equipos y vista móvil. La prueba de apertura directa puede quedar omitida si la política administrada de Chromium bloquea `file://`; el runner lo declara expresamente y no desactiva esa política. Capturas en `outputs/web/`. El puerto 8099 debe estar libre.

## Publicación como sitio web

Todos los archivos son estáticos. Puedes alojar `index.html`, `styles.css` y `js/` en GitHub Pages, Netlify o un servicio equivalente. No hay compilación ni backend Python. En GitHub, configura **Settings → Pages → Deploy from a branch → main → /(root)** y guarda. Esta operación requiere acceso a la configuración del repositorio; el código subido por sí solo no garantiza que Pages esté activado. No se afirma una URL pública hasta verificar el despliegue.

En este entorno, las instrucciones de arranque y configuración se guardan para revisión; los procesos no sobreviven necesariamente a restauraciones. Abrir el archivo local es independiente de que exista o no una vista previa pública del entorno.

## Estructura

- `index.html`: estructura accesible y controles en español.
- `styles.css`: interfaz responsive, estados y tema visual.
- `js/core.js`: CSV, variables, softmax, walk-forward, EV, Kelly, backtest y bootstrap; reutilizable en Node.
- `js/app.js`: interacción, tablas, gráfica SVG y exportaciones, sin frameworks.
- `server.js`: servidor estático opcional de desarrollo.
- `tests/`: pruebas del motor y navegador.

La migración retira la aplicación Python/Streamlit del árbol actual; su código permanece en el historial Git anterior a la versión 2.
