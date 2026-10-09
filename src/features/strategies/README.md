# Operaciones de estrategias — Etapas 1 y 2

Modelo, cálculo, persistencia en Firestore y pantallas para registrar compras, ventas parciales y movimientos de efectivo en cada estrategia. Los saldos globales de brokers siguen independientes y se actualizan manualmente.

## Uso

1. Abrir una estrategia activa y seleccionar **Habilitar historial**.
2. Elegir la fecha del saldo de apertura y revisar las cantidades y costos actualmente guardados. Confirmar que corresponden al saldo previo a las operaciones que se van a cargar.
3. Seleccionar **+ Operación**. Completar tipo, fecha, moneda, cantidad y precio. Se puede ingresar gastos totales o el neto asignado del boleto.
4. Revisar el saldo resultante y confirmar el guardado. El historial registra también boleto, broker, fecha de liquidación y nota, si se completaron.
5. Para corregir una operación, anularla con un motivo y cargar la correcta. Se conserva el registro original. Si otras operaciones posteriores dependen de ella, se deben revisar primero: la anulación no puede dejar cantidades o efectivo negativos.

Las estrategias existentes conservan su edición anterior hasta habilitar el historial. La apertura se guarda una sola vez. Desde entonces, cantidades y costo se calculan desde las operaciones. La edición manual anterior y el borrado quedan bloqueados en la aplicación para esa estrategia, incluso desde una pestaña desactualizada. Se puede cerrar y reabrir la estrategia conservando su historial.

Las ventas del comprobante no se cargan automáticamente: primero se debe confirmar la asignación a cada estrategia y los saldos de apertura. No se deduce la atribución de una venta solamente por el ticker.

## Archivos

- `strategyModel.js`: esquema normalizado y validaciones; `StrategyValidationError` incluye `code` estable.
- `strategyEngine.js`: cálculo puro de saldos y valuación.
- `strategyLegacy.js`: adaptador de los campos existentes a un saldo de apertura explícito.
- `strategyLedger.js`: operaciones activas, secuencia, vista previa de alta y anulación.
- `strategyUi.js`: importes argentinos sin pérdida por conversión a `Number`, formatos y métricas compartidas entre detalle y resumen.
- `strategyRepository.js`: lectura consistente y escrituras transaccionales, exclusivamente en `rotations`.
- `StrategyLedgerActivation.jsx`: revisión y confirmación de la apertura.
- `StrategyOperationForm.jsx`: carga y vista previa de compras, ventas, aportes y retiros.
- `StrategyOperationHistory.jsx`: historial y anulación con motivo.
- `StrategyLedgerDetail.jsx` y `StrategyLedgerCard.jsx`: detalle y resumen de estrategias que ya usan operaciones.

Integración en `EventDetail.jsx`, `Dashboard.jsx` y `NewEvent.jsx`. No se agregaron dependencias.

## Almacenamiento en Firestore

Documento `rotations/{strategyId}`:

- `ledgerOpening`: versión `strategy-v1`, `asOfDate`, `positions` (ticker, moneda, cantidad, costo total y divisor), `cash` separado en ARS/USD.
- `ledgerOpeningRecordedAt` / `ledgerOpeningRecordedBy`: fecha de registro y usuario de la apertura.
- `ledgerBalances`: proyección calculada de posiciones, efectivo, resultado realizado y aportes netos. Permite mostrar el resumen sin leer una subcolección por tarjeta. No se edita directamente desde la aplicación.
- `ledgerRevision`: cambia con cada operación, anulación o actualización de precios/estado.
- `ledgerOperationCount`, `ledgerActiveCount`, `ledgerUpdatedAt`: cantidad de registros, cantidad vigente y fecha de actualización.

Subcolección `rotations/{strategyId}/operations/{operationId}`:

- Operación normalizada: identificador, tipo, fecha de concertación, orden del día, moneda y datos de compra/venta o importe del movimiento de efectivo.
- `status`: `active` o `cancelled`.
- `recordedAt` / `recordedBy`: auditoría de la carga.
- Al anular: `cancelledAt`, `cancelledBy`, `cancellationReason`. Se conservan cantidad, precio, gastos y neto originales.

El alta y el saldo se guardan en la misma transacción. La anulación y el nuevo saldo también. El repositorio lee el historial entre dos lecturas de la revisión para evitar combinar versiones. Antes de escribir, la transacción vuelve a comprobar la revisión: una vista desactualizada debe refrescarse y revisar la operación. Los reintentos con el mismo identificador y datos no duplican una carga.

No se escribe en `brokerPositions`. Se mantiene el modelo de acceso autenticado compartido que ya tenía `rotations`; las reglas publicadas admiten estas rutas y no requieren un despliegue nuevo. Las protecciones de edición y anulación descritas son del flujo de la aplicación.

## Reglas de cálculo

- Cantidades, precios, costos e importes se devuelven como strings decimales con punto, sin separadores de miles ni notación científica. La pantalla acepta formato argentino, por ejemplo `1.234,56`. Para evitar ambigüedad entre miles y decimales, conviene usar coma decimal al pegar importes.
- Monedas ARS/USD separadas en el motor. No hay conversión implícita entre posiciones. La conversión para mostrar el patrimonio usa el dólar de valuación y no genera una operación de cambio.
- Una compra consume efectivo por el neto y agrega cantidad y costo, incluidos los gastos. Requiere efectivo suficiente en esa moneda.
- Una venta descuenta cantidad, libera costo por promedio ponderado y agrega el neto al efectivo. Resultado realizado = neto recibido menos costo liberado. Una venta total elimina la posición.
- Los aportes y retiros afectan efectivo y aportes netos; no son ganancia de trading.
- No se permiten cantidades o efectivo negativos, fechas inválidas, concertaciones futuras, operaciones anteriores a la apertura, identificadores repetidos ni órdenes repetidos en la misma fecha.
- Si se completa el boleto, se detecta una carga activa repetida del mismo boleto, tipo, ticker y moneda dentro de la estrategia. Para un boleto compartido, cargar una sola parte por estrategia y asignarle el mismo número de boleto.
- El orden automático avanza de a 1000 dentro del día para permitir insertar operaciones intermedias. El orden manual debe ser un entero libre. Todas las operaciones se validan cronológicamente, también al registrar una fecha retroactiva.
- Bruto = cantidad × precio / `priceDivisor`, redondeado a centavos. Neto y gastos tienen hasta dos decimales. Con neto explícito, los gastos se deducen de bruto y neto; si se suministran ambos deben coincidir.
- `priceDivisor` es 1 para precios por unidad y 100 para cotizaciones por 100 nominales. Debe ser consistente para el mismo ticker y moneda. `averageCost` expresa costo monetario por unidad nominal.
- Se usa `decimal.js` con 40 dígitos de precisión. No se redondean cantidades ni costo proporcional a centavos.
- El efectivo cambia en la fecha de concertación. La fecha de liquidación se registra, pero aún no se diferencia efectivo pendiente de efectivo disponible.

## Métricas y valuaciones

El patrimonio actual suma títulos y efectivo. Los resultados realizados empiezan en cero en el saldo de apertura y se muestran por moneda. El resultado de la estrategia desde su inicio conserva la base original de `soldAssets`, e incluye el efectivo de ventas nuevas. El costo original de apertura no pretende reconstruir resultados pasados ausentes del historial.

El resumen y el detalle comparten el cálculo. Los rendimientos son simples: se descuentan los aportes/retiros netos al tipo de cambio actual. No son rendimientos ponderados por tiempo o dinero. Cuando hay aportes/retiros netos se omite Alfa para evitar una comparación engañosa con la posición vendida original.

Cotizaciones de títulos en ARS: BYMA, precio guardado y, si falta ambos, costo como referencia explícitamente señalado. Las posiciones en USD usan su cotización guardada en esa moneda. No se reutiliza un precio de BYMA en pesos como si fueran dólares. El detalle pide completar una cotización faltante antes de registrar una valuación.

Los registros nuevos de `priceHistory` guardan saldos, efectivo, cotizaciones, dólar y patrimonio de ese momento. Los registros anteriores se conservan y se muestran con los datos que ya tenían.

## Ejemplo de venta parcial

```js
const opening = {
  version: 'strategy-v1', asOfDate: '2026-09-30',
  positions: [{ ticker: 'AMD', currency: 'ARS', quantity: '100', costBasis: '1000', priceDivisor: '1' }],
  cash: { ARS: '0', USD: '0' },
};
const operations = [{
  id: 'venta-001', type: 'sell', tradeDate: '2026-10-01', settlementDate: '2026-10-02', sequence: 1000,
  ticker: 'AMD', currency: 'ARS', quantity: '40', price: '15', fees: '2',
}];
const balances = calculateStrategyBalances({ opening, operations });
const valuation = valueStrategyBalances({ balances, prices: { 'AMD:ARS': '15' } });
```

Quedan 60 unidades con costo de 600, efectivo de 598 y ganancia realizada de 198. Las unidades restantes valen 900; el patrimonio es 1498. La ganancia total es 498: 198 realizados + 300 en posición.

## Compatibilidad y alcance

La apertura toma `boughtAssetsFromDb` si existe, incluso si está vacío; en su ausencia toma `boughtAssets`. `ARS` / `PESOS` pasan a efectivo en pesos y `USD` a efectivo en dólares. Se ignoran filas con cantidad cero y se normalizan los tickers.

Los títulos existentes se interpretan en ARS como la pantalla anterior. Costo = cantidad × `priceAtTrade` / divisor. Si el costo guardado necesita corrección, se debe revisar antes de habilitar el historial. No se reconstruyen compras, ventas ni gastos históricos desconocidos. Los campos originales permanecen en el documento.

Quedan fuera de esta etapa: importación automática del comprobante, asignación automática entre estrategias, cambio de moneda mediante operaciones, saldos globales automáticos y reconstrucción de rendimiento histórico ponderado. La activación puede hacerse una estrategia por vez.

Revisión realizada: lint y compilación. El 09/10/2026 se aplicó la rotación confirmada por el usuario en Firebase (36 escrituras atómicas: cinco estrategias y 31 operaciones). La lectura posterior y el recálculo coincidieron con el plan y los saldos guardados; las versiones de brokers y de la estrategia no afectada permanecieron iguales. No se ejecutó una prueba automática de interacción en el navegador.

## Importación de ventas confirmadas

`scripts/import-strategy-sales.mjs` permite preparar una carga de ventas históricas con el mismo motor que usa la aplicación. Los comprobantes, propuestas y respaldos se guardan en `local-data/strategy-sales/`, excluido de Git. No contiene credenciales; utiliza la sesión existente de Firebase CLI.

```powershell
node scripts/import-strategy-sales.mjs --preview local-data/strategy-sales/comprobante.json
node scripts/import-strategy-sales.mjs --apply local-data/strategy-sales/plan-confirmado.json
```

El modo `--preview` sólo lee Firebase. Crea un respaldo, un plan y un resumen para revisar antes de confirmar las cantidades por estrategia y el saldo de apertura. La distribución del boleto no se deduce automáticamente.

El modo `--apply` vuelve a leer los datos y rechaza un plan desactualizado. Las aperturas necesarias, operaciones y saldos se guardan juntos, con precondiciones sobre la versión de cada documento e identificadores de operaciones que no pueden existir previamente. Se usa la API [Commit de Firestore](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit), cuyas escrituras se ejecutan de forma atómica. Los campos anteriores de cada estrategia se conservan mediante una máscara de actualización.

El bruto y neto se prorratean por cantidad, incluyendo la porción sin estrategia. Los centavos se reparten por mayor resto para conservar exactamente el total de cada boleto. El precio equivalente de cada parte se calcula desde su bruto asignado, y se conservan los totales originales del boleto en `sourceReceipt`. La auditoría identifica la carga como `codex-import`, sin atribuirla falsamente a un usuario de la aplicación.

Después de guardar se vuelven a leer y calcular los saldos para comprobar que coincidan con el plan y con el saldo guardado. Se guardan también el resultado del commit y un respaldo posterior. El script no escribe en brokers y compara sus versiones antes y después. Ante una respuesta de red incierta, primero se revisan los registros existentes; no se repite la importación a ciegas.

## Rotación financiada con ventas y caución

La nueva rotación conserva capital inicial neto en `initialCapitalARS` y efectivo contrafactual en `benchmarkCash` (ARS/USD). El nominal USD de referencia permanece fijo y se convierte sólo para la valuación actual. Delta es patrimonio actual menos la referencia de títulos vendidos y efectivo; Alfa expresa esa diferencia como puntos de rendimiento sobre el capital inicial. El capital asignado incluye financiación y no representa patrimonio propio neto de deuda; los intereses de caución y los saldos globales siguen independientes.

`scripts/import-strategy-rotation.mjs` prepara y aplica ventas, retiros vinculados en estrategias origen, apertura de la nueva estrategia y todos los boletos de compra en un commit con precondiciones. Preserva fuentes, liquidaciones y la convención de fecha común confirmada. Las operaciones con `linkedTransferId` no se pueden anular aisladamente desde la pantalla: la corrección debe conservar los dos extremos de la transferencia. Las compras nuevas sí conservan el flujo normal de anulación.

`local-data/` y los scripts de importación están excluidos también de la publicación mediante `.vercelignore`.

## Ajustes de la referencia por acciones corporativas

`benchmarkAdjustments` conserva ajustes con identificador único, ticker, `effectiveDate`, `quantityNumerator` y `quantityDenominator`, más nota y fuente. Sólo modifica las unidades equivalentes de `soldAssets` para la referencia desde la fecha efectiva, posterior a `tradeDate`. Los comprobantes, operaciones, capital inicial, títulos comprados y efectivo permanecen intactos. Los splits se componen sin redondear unidades; una cotización de referencia suministrada debe corresponder a las unidades de la fecha de valuación. Sin cotización se utiliza el precio inicial equivalente para conservar el valor histórico.

`strategyMetrics` acepta `asOfDate` para reconstruir comparaciones con cotizaciones de esa fecha; las estrategias activas usan la fecha de Buenos Aires y las cerradas conservan `valuationDate`. Guardar una valuación persiste esa fecha. Alfa se muestra en puntos porcentuales. Este cambio no automatiza acciones corporativas sobre posiciones reales ni la carga de futuros ajustes.

## Comparaciones con retiros y cartera inicial sin cambios

Los aportes y retiros guardan `usdRateAtTrade` y `benchmarkValueARSAtTrade`: dólar y valor completo de la referencia original en la fecha del movimiento, antes de escalar por movimientos anteriores. `ledgerCashFlows` conserva el índice derivado de movimientos activos para calcular las tarjetas sin consultar todas las operaciones. Se regenera al agregar o anular; el detalle lo deriva también de los registros originales.

La referencia recibe los mismos movimientos proporcionalmente: factor = 1 + suma(movimiento ARS de su fecha / referencia completa ARS de esa fecha). Cada retiro reduce las unidades virtuales, y cada aporte las aumenta. Delta compara patrimonio remanente real contra referencia remanente; Alfa = Delta USD / capital inicial USD, en puntos porcentuales. El rendimiento simple acumula retirado o aportado al dólar de cada movimiento, sin atribuir rendimientos de las estrategias destino. No es TWR ni XIRR. Si faltan datos históricos no se inventa el dólar o el precio de la referencia. Un retiro que agotaría más del 100% de la referencia se muestra como comparación no calculable.

`initialPortfolio` guarda una copia de `boughtAssets` originales, consolidando lotes, más efectivo original, dólar y fecha del alta. Nunca se reconstruye desde `boughtAssetsFromDb`, apertura de septiembre ni saldos actuales. `initialPortfolioPricesFromDb` y las cotizaciones BYMA valúan esa cartera sin aplicar operaciones, aportes ni retiros. Las acciones corporativas se registran separadamente en `initialPortfolio.adjustments`. La sección muestra valor inicial registrado y valor actual; no incorpora dividendos, intereses de efectivo ni diferencias de financiación no registradas. Se congela al habilitar el historial y por una migración explícita para historiales previos.
