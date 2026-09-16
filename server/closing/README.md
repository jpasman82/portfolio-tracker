# B1 — captura durable de daily last traded price

Baseline exclusivo: `20b3980288dc7d65b52c36098b528194c0532c3f`.
Rama: `codex/b1-durable-close-capture`. Sin merge, push, deploy ni backfill.
El commit local de préstamos `5656e44` y el WIP del repositorio original no
fueron incorporados. No hay nuevas dependencias npm ni infraestructura cloud.

## Alcance y límite de activación

B1 persiste observaciones normalizadas relevantes en Firestore, retoma pendientes,
protege escrituras con lease y permite publicar sólo con insumos completos.
Conserva el cálculo del baseline; no introduce un motor nuevo ni migra el frontend.

**Decisión funcional vigente:** se conserva el último operado observado después
de la rueda, NO el fixing/cierre oficial BYMA. Contrato completo, evidencia y
límites: [LAST_TRADE_POLICY.md](./LAST_TRADE_POLICY.md).

Política `b1-snapshot-last-trade-v3`: sólo TRADE positivo, contador de operaciones
positivo, Date = valuationDate e identidad completa, capturado desde las 18:00 ART
del mismo día hábil. El cutoff puede retrasarse, nunca adelantarse, mediante
PORTFOLIO_CAPTURE_CUTOFF_ART. Sin precio/operaciones: NO_TRADE y PARTIAL si requerido.
CLOSING_PRICE y PREVIOUS_CLOSE son referencias rechazadas, sin sustitución.

La publicación se identifica como BYMA_SNAPSHOT_LAST_TRADE / daily last traded
price. EOD: NOT REQUIRED FOR CURRENT BUSINESS POLICY. No hay deploy ni activación
de publish; estos cambios quedan para revisión. Los tests usan la política real,
sin resolver fechas con un contrato sintético. Las fixtures reales son intradiarias;
las pruebas post-cutoff están marcadas explícitamente como simuladas.

Se conserva la investigación previa B1A/B1B en LAST_TRADE_POLICY.md: el contrato
de closing_price no fue homologado y el acceso EOD no fue concedido. La nueva
política no convierte esas conclusiones en falsas ni presenta TRADE como cierre BYMA.

## Flujo y modos

La ruta y las dos ventanas cron de `vercel.json` no cambian; `maxDuration` sigue en
60 segundos. Cada invocación fija la fecha argentina al inicio, verifica el cutoff, adquiere lease,
lee/congela insumos, vuelve a descargar todos los grupos requeridos concurrentemente y persiste cada
respuesta relevante antes del archivo raw opcional. Después reconcilia lo durable,
valida, calcula y, sólo si está habilitado, publica atómicamente.

`PORTFOLIO_CLOSE_MODE` es una variable **server-only**:

| Modo | Comportamiento |
| --- | --- |
| `capture` (default) | Captura durable; nunca escribe `portfolioDailySnapshots`. |
| `publish` | Captura y publica únicamente con todos los TRADE diarios requeridos válidos. No habilitado por este cambio. |
| `off` | No ejecuta captura ni publicación. |
| `legacy` | Rollback explícito al handler baseline; recupera también sus limitaciones conocidas. |

No hay fallback automático a legacy ante fallas. `CRON_SECRET` es obligatorio en
todos los modos; faltante/incorrecto da 401. Sólo GET/POST. B1 no permite `force`,
fecha arbitraria ni backfill; fines de semana se omiten. No hay calendario de
feriados nuevo. Un resultado parcial devuelve 503 con estado explícito; lease
ocupado devuelve 409. HTTP 200 en captura no significa snapshot UI publicado:
`publicationStatus` lo distingue.

Las peticiones BYMA tienen timeout (token 6 s, grupo 10 s), Firestore 8 s y Google
OAuth 6 s. Se chequea presupuesto antes de construir. No se extiende el runtime
con trabajo de publicación en segundo plano. Un corte duro puede dejar stage
intermedio y lease; la siguiente ventana puede retomarlo al expirar el lease.
No se garantiza completar dentro de 60 s ante degradación sostenida de Firestore.

## Modelo realmente implementado

Todos los **instantes nuevos son strings ISO-8601 UTC** (`toISOString`); las fechas
económicas son `YYYY-MM-DD`. No se mezclan timestamps nativos nuevos y strings.

`marketPriceRuns/{valuationDate}`:

- `valuationDate`, `timezone`, `version`, `policyVersion`.
- `status`: PENDING / PARTIAL / COMPLETE / FAILED; `stage`.
- `startedAt`, `lastAttemptAt`, `completedAt`, `lastDurableProgressAt`, `attemptCount`.
- `expectedQuoteKeys`: claves del requerimiento (no confundir con identidad del instrumento).
- `valid`, `missing`: listas de requerimientos; `rejected`: clave y motivo.
- `selected`: requerimiento → ID de observación durable elegida.
- `reconciliation`: selección, contador, último resultado, último cambio de selección
  y anomalías durables por requerimiento; `reconciliationAnomalies` las resume.
- `inputHash`, `b1BuildId`, `b1SnapshotHash`, `publicationStatus` (NOT_REQUESTED / PUBLISHED).
- `endpointResults`: estado, filas, instante e intento más reciente por grupo.
- `lastError`: código, etapa, intento y HTTP status, sin cuerpo de proveedor/secretos.
- `archiveStatus`: COMPLETE / DEGRADED / FAILED / NOT_CONFIGURED; `archiveResults` por grupo.
- `lease`: owner (attemptId), token creciente, expiresAt.

`marketPriceRuns/{date}/observations/{contentHash}` (inmutables):

- `providerSymbol`, `securityId`, `segment`, `currency`, `market`, `settlement`,
  `operativeForm`, `requestedMarket`, `requestedOperativeForm`, `quoteUnit`, `quoteKey`, `group`.
- `valuationDate`, `priceDate` nullable, `capturedAt`, `price`, `priceType`
  (CLOSING_PRICE / PREVIOUS_CLOSE / TRADE), `source: BYMA_SNAPSHOT`, `status`, `reason`, `stale`.
- `pricePolicy`, `providerDate`, `tradeCount`, `category`, `captureCutoffART`.
- `dateEvidence`: versión, referencia, base de evidencia, fecha/contador y broadcastTime (última novedad, no operación).
- `attemptId`, `normalizerVersion`, `id`. El hash excluye el instante local y el
  intento: recapturar la misma observación no crea duplicados lógicos.

Se conserva la identidad de respuesta sin sustituir sus códigos por los del
request: se observó `operativeForm=C`, `market=CT` con queries CONTADO/PPT.
Identidad completa, categoría, mercado, forma, moneda y plazo incompatibles se
rechazan. Identidades distintas son AMBIGUOUS_QUOTE. Para la misma identidad,
gana la observación elegible con mayor `tradeCount`: una posterior sólo reemplaza
si el contador acumulado creció. Un contador menor se registra como
TRADE_COUNT_REGRESSION sin retroceder; igual contador con distinto precio es
TRADE_COUNT_PRICE_CONFLICT y bloquea COMPLETE/publicación hasta que evidencia
posterior con contador mayor lo resuelva. Un reinicio puede reconstruir esta
selección desde observaciones durables.

`marketPriceRuns/{date}/inputs/frozen` (una copia inmutable, no historial completo):

- `positions`: broker, updateTime observado, cantidades, flags y deuda normalizados.
- `bindings`, `requirements`, `capturedAt`, `inputHash`, `policyVersion`.
- `source: first-successful-read-not-market-close`.

No incluye precios ni usdRate cacheados. Es la primera lectura exitosa, **no una
reconstrucción as-of del cierre**. Reintentar no usa cantidades actuales nuevas.
Posiciones distintas de cero, incluso negativas, requieren precio; cero exacto no.
Entradas numéricas inválidas fallan explícitamente. Se preservan exclusiones
Brasil del baseline y alias TFU27→TU27D para bonos USD. Otros mapeos ambiguos fallan
cerrado; no se convierte una especie EXT en USD silenciosamente.

MEP requiere AL30 ARS y AL30D (o AL30) USD válidos de la misma sesión, con idéntica
unidad nominal. No hay fallback a usdRate, dólar externo ni 1. Cable no es obligatorio
para el cálculo actual y queda `null` (no una cotización inventada); B1 no incorpora
valuación nueva de especies cable. El diagnóstico read-only sí consulta los cinco
endpoints para observar el contrato completo.

`portfolioDailySnapshots/{date}` conserva el payload consumido por UI, más
`isComplete`, `economicStatus`, `policyVersion`, `marketPriceRunRef`, `inputHash`,
`b1BuildId`, `pricePolicy`, `priceSource`, `dailyPriceDefinition` y `priceObservations`
con referencias a las observaciones seleccionadas. Las filas marketPrices distinguen representación ARS/USD del mismo
ticker. No hay snapshot provisional; un snapshot existente ajeno/diferente da
EXISTING_SNAPSHOT_CONFLICT y se conserva intacto. Un overwrite posterior por un
writer legacy/cliente se detecta al reintentar (PUBLISHED_SNAPSHOT_CHANGED), incluso
si un merge conserva el b1BuildId: se compara el hash canónico del payload completo.

## Durabilidad, concurrencia y archivo opcional

Firestore REST `Commit` escribe atómicamente; la precondición `updateTime` del run
actúa como compare-and-swap. Cada escritura de observaciones, insumos o snapshot
incluye ese fencing record. Un worker con token viejo no puede consolidar tras
otro acquire. Lease: 70 s (mayor que maxDuration actual), liberado al terminar.
No se usan callbacks transaccionales con llamadas BYMA dentro.

Fuentes: [Commit atómico](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit),
[precondiciones updateTime/exists](https://firebase.google.com/docs/firestore/reference/rest/v1/Precondition).

Las observaciones se crean por hash en lotes acotados; jamás se borran al fallar
otro grupo o el builder. La selección ya válida no se degrada en retries. Los
grupos se refrescan completos sólo para requerimientos pendientes (no se presume
API por ticker). Se relee tras conflictos o ACK incierto antes de reintentar.
Publicación y consolidación de COMPLETE/PUBLISHED usan el mismo Commit.

El adaptador opcional es `archive.put({ group, valuationDate, capturedAt, attemptId,
body, signal })`. Debe respetar AbortSignal y ser idempotente; presupuesto 1 s.
No existe implementación Cloud Storage ni bucket nuevo. Su fallo afecta sólo
archiveStatus, nunca invalida datos económicos ya validados y persistidos.

Límites honestos: una caída antes de la primera persistencia aún puede perder la
respuesta en memoria; no hay archivo alternativo si Firestore está totalmente
inaccesible. Un día sin ninguna invocación no se recupera solo. Ambos problemas
requieren fases posteriores. Los guards rechazan documentos >900 KB/commits >9 MB;
no se implementó un sistema distribuido de gran escala.

## Seguridad y compatibilidad

Las nuevas rutas bajo `marketPriceRuns/**` deniegan read/write a clientes, incluso
autenticados. El servidor opera con OAuth de service account e IAM; el emulador
verifica reglas, pero **no acredita permisos IAM actuales de producción**.
No se cambiaron permisos legacy, credenciales remotas, frontend ni posiciones
productivas. El código B1 no ejecuta los callbacks positionUpdates del baseline.
Writers cliente permanecen y todavía pueden modificar la colección histórica.
`src/utils/portfolioSnapshots.js` expone `saveDailyPortfolioSnapshot` y
`saveManualPortfolioSnapshot`, ambas con `setDoc(..., { merge: true })`. Se invocan
desde el auto-refresh/post-close de `src/pages/Home.jsx` y desde las acciones
manuales de `src/pages/PortfolioHistory.jsx`. `firestore.rules` permite hoy
read/write de `portfolioDailySnapshots/**` a cualquier usuario autenticado.
Antes de habilitar publish hay que migrar/deshabilitar esos writers y cambiar las
reglas para que clientes no puedan crear/actualizar/borrar la colección, conservando
las lecturas estrictamente necesarias. También debe asegurarse que el primer cron
sea capture-only y que sólo una invocación final reconciliada solicite publicación;
el modo global actual no distingue los dos cron. Nada de esto bloquea capture-only.

El servidor puede reutilizar las credenciales existentes. No hacer env pull ni
subir `.env`; ningún secreto nuevo pertenece a este cambio. El wrapper legacy
conserva el cálculo/flujo anterior, salvo auth fail-closed y timeout/sanitización
del token Google compartido. Volver a legacy reactiva riesgos conocidos de ese flujo.

## Revisión y eventual rollout (NO ejecutado)

1. Revisar este diff, aceptar la política last-trade y confirmar ventana/mapeos antes de publicación.
2. Verificar IAM/CRON_SECRET y aplicar rules aditivas mediante una autorización futura.
3. Desplegar en capture y validar datos/volumen con autorización futura; no hay escrituras de prueba productivas en B1.
4. Habilitar publish sólo después de cerrar writers/reglas cliente y separar de
   forma verificable la captura inicial de la invocación final que publica.
5. Rollback: off detiene B1; legacy restaura el flujo anterior de manera explícita.
   No borrar observaciones para revertir. Cambiar configuración no cancela una
   invocación ya iniciada: esperar su fin/maxDuration antes de activar otro writer.

No desplegar esta rama a través de un push accidental si GitHub dispara previews.

## Verificación local

Desde el clon B1:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run test:b1
npm test
npx eslint api/portfolio-snapshot.js server/closing scripts/b1-byma-readonly.mjs test/b1/firestore.test.js
npm run build
git diff --check
```

Emulador B1 (proyecto demo, nunca producción):

```powershell
$env:PATH = 'C:\Users\dell\Documents\apps\portfolio-tracker-b1\.b1-tools\java21\jdk-21.0.12.1+1-jre\bin;' + $env:PATH
npm run test:b1:firestore
```

El JRE portable oficial Temurin 21 está sólo en `.b1-tools/` ignorado; no es dependencia
productiva. ZIP SHA256: `d35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636`.
Los tests Firestore exigen localhost y proyecto `demo-b1-close`; una ruta distinta
falla antes de acceder a datos. Prueban REST/CAS real, atomicidad y reglas denegatorias.

Captura BYMA de diagnóstico (no importa Firestore ni escribe archivos/datos):

```powershell
node scripts/b1-byma-readonly.mjs --allow-network
```

Resultado 2026-09-15 17:40:12Z / 14:40 ART: acciones 103, CEDEARs 532,
bonos ARS 199, USD 149, EXT 143. Cero closing_price positivos en los cinco grupos
(captura intradiaria). Previous_close positivo se conservó como PREVIOUS_CLOSE,
priceDate=null, stale=true, REJECTED. No se afirmó que perteneciera al día anterior:
su fecha exacta tampoco está probada. Cero escrituras de producción.

## Fuera de B1

Calendario completo, monitor/alertas externos, Cloud Scheduler/Tasks, proveedor
histórico, backfill, reconstrucción histórica, versionado completo de posiciones,
migración de Home/PortfolioHistory, prohibición definitiva de writers cliente,
archivo raw implementado y nuevo motor de valuación permanecen fuera de alcance.
