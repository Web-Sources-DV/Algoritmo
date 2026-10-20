# Ideas del texto de DeepBetting aportado por el usuario

Fuente indicada: https://deepbetting.io/es/algoritmo-apuestas-deportivas/

El acceso directo devolvió HTTP 403. Este análisis se basa en los **extractos pegados por el usuario**, no en una auditoría del sitio, de sus datos ni de su rendimiento. No hay relación comercial ni integración con una API de DeepBetting.

## Qué dicen usar

El texto describe datos de equipos y jugadores de más de diez años, ingeniería de variables (Elo, xG, descanso, viajes, lesiones, casa/fuera, forma y calendario), XGBoost y redes neuronales, detección de apuestas simples con EV positivo y un registro temporal de predicciones y resultados.

El artículo también habla de aprendizaje profundo. XGBoost pertenece a árboles potenciados, no a redes neuronales. Podrían combinar ambos enfoques, pero el fragmento no explica arquitectura, hiperparámetros, calibración, combinación de modelos ni disponibilidad temporal de las entradas. Sin esos detalles y sus datos no se puede reproducir su motor propietario.

## Integración concreta en esta app

| Idea del extracto | Implementación | Alcance |
| --- | --- | --- |
| Elo | Rating secuencial, base 1500, K=20, ventaja local 60 puntos | Actualización al terminar cada fecha, conserva suma de ratings; no identifica popularidad |
| Forma/localía | Medias de puntos y goles de los cinco partidos previos, generales y por local/visitante | Sólo observaciones anteriores |
| Descanso | Días desde el último partido observado, tope 30, indicador de historial disponible | Sólo conoce partidos incluidos en los CSV |
| Densidad del calendario | Partidos observados en los 14 días previos | No incluye copas u otras ligas que no estén en los datos |
| Enfrentamientos directos | Últimos cinco encuentros de la pareja, orientados al equipo local del partido a estimar | No sustituye una validación de su utilidad incremental |
| xG | Medias previas de xG a favor/en contra, con indicadores de cobertura | Requiere columnas opcionales aportadas; no se estiman xG a partir del marcador |
| Posesión en último tercio | Medias previas a favor/en contra y cobertura | Requiere columnas opcionales porcentuales; no se confunde con posesión total |
| XGBoost/ML | Opción gradient boosting regularizado de árboles de un nivel (stumps) en JavaScript, además del baseline softmax L2 | No es la librería XGBoost ni reproduce su sistema; no se implementa una red neuronal |
| Detección +EV | Probabilidad × cuota efectiva − 1, umbral y apuestas simples | EV estimado, sujeto a error de modelo |
| Trazabilidad | Informe con fecha de generación, versión, parámetros, folds, resultados completos y SHA-256 del texto de entrada | Archivo local mutable, no registro inalterable ni predicción prospectiva verificada |

No se añaden viajes, lesiones, métricas de jugadores ni alineaciones sin datos trazables. La app permite cargar diez o más temporadas, pero no inventa ese historial ni afirma estar entrenada con diez años cuando no se han aportado. No se amplía a NBA/NFL/NHL/MLB: estas ligas requieren datos, mercados y validación propios.

## Métricas opcionales: contrato de CSV

Además de las columnas obligatorias, se reconocen:

- `xGH`, `xGA`: xG realizado del local y visitante en ese partido (números no negativos).
- `FinalThirdH`, `FinalThirdA`: posesión en el último tercio, expresada en porcentaje 0–100 según una definición consistente del proveedor.

Son nombres definidos por esta app, **no columnas garantizadas del CSV estándar football-data.co.uk**. Unir los datos por fecha, equipos e identidad del partido desde una fuente autorizada antes de subirlos. No sustituir por posesión total, goles o valores inventados. La posesión territorial tiene diferentes definiciones entre proveedores; no mezclar escalas o definiciones.

Las métricas de la propia fila nunca se usan para predecir ese partido: se incorporan al historial después de generar las variables de toda su fecha. Se promedian los valores disponibles de los cinco partidos anteriores y se incluye su cobertura (número disponible / 5). Si faltan, el valor neutral es cero con cobertura cero, lo que distingue ausencia de una observación real igual a cero. Se muestra cuántas filas tienen ambas métricas. No se incorporan valores futuros ni imputaciones aprendidas sobre pruebas.

El usuario debe comprobar cuándo estuvieron disponibles estas estadísticas: los datos revisados después pueden crear sesgo de disponibilidad aunque las fechas de partidos sean correctas. Tener xG no demuestra que mejore el modelo; hay que comparar en un periodo reservado antes de adoptarlo.

## Interpretación crítica

Una probabilidad estimada no es una «probabilidad estadística exacta». Quitar emociones del proceso no elimina sesgos de selección, medición, entrenamiento o calibración. Tampoco más variables o redes más grandes garantizan mejor generalización.

La condición correcta con cuota decimal `o` es `p > 1/o`, equivalente a `p × o − 1 > 0` antes de costes. No se compara una probabilidad de 0 a 1 directamente con la cuota decimal. Con costes se usa la cuota efectiva.

Si la probabilidad verdadera fuese conocida y el EV fuese positivo, habría beneficio **esperado** positivo. Eso no garantiza beneficio realizado ni verifica que la probabilidad estimada por una web sea correcta. Correlaciones, varianza, cambios de régimen, costes, límites y errores de calibración pueden destruir una ventaja aparente.

La implementación conserva walk-forward, log-loss, Brier, referencia del mercado, Kelly fraccionado y bootstrap semanal. No se alteran umbrales para presentar un resultado rentable. Debe seguirse con datos reales y evaluación prospectiva; los resultados de la demo artificial no acreditan ventaja deportiva.
