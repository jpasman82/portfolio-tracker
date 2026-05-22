# Portfolio Tracker — Contexto para Claude

## Qué hace la app

Herramienta personal de seguimiento de cartera de inversiones para mercados argentinos. Consolida posiciones de múltiples brokers, rastrea estrategias de trading ("rotaciones") y analiza la composición del portfolio por tipo de activo y sector. Maneja exposición multi-moneda (ARS/USD).

- **Nombre del proyecto:** "LatinBonos" / "Portfolio Manager"
- **Usuario objetivo:** uso personal (actualmente hardcodeado para "Marcos")
- **Desplegado en:** Vercel + Firebase

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + JSX |
| Build | Vite 8 |
| Routing | React Router DOM 6 |
| Base de datos | Firebase Firestore |
| Autenticación | Firebase Auth (email/password) + WebAuthn (biométrico) |
| Export | xlsx (Excel) |
| Estilos | CSS puro, sin framework (diseño responsive mobile-first) |
| Deploy | Vercel |

---

## Estructura de carpetas

```
src/
├── App.jsx                  # Routing principal, auth, biometric lock
├── main.jsx                 # Entry point React
├── firebase/config.js       # Inicialización Firebase
├── pages/
│   ├── Home.jsx             # Dashboard: posiciones por broker
│   ├── Login.jsx            # Autenticación
│   ├── BrokerDetail.jsx     # Editar posiciones de un broker
│   ├── Dashboard.jsx        # Lista de rotaciones (estrategias)
│   ├── EventDetail.jsx      # Detalle de una rotación
│   ├── NewEvent.jsx         # Crear/editar rotaciones
│   └── Unified.jsx          # Vista consolidada con gráficos
└── utils/
    ├── priceService.js      # Cotizaciones en tiempo real (BYMA)
    ├── bymaService.js       # Autenticación OAuth2 con BYMA
    ├── dictionary.js        # Taxonomía de activos
    └── biometricAuth.js     # Registro/verificación WebAuthn
```

---

## Páginas y funcionalidades

| Página | Ruta | Descripción |
|--------|------|-------------|
| Login | `/login` | Auth email/password + registro biométrico |
| Home / Brokers | `/` | Balance consolidado de 3 brokers: J.P. Morgan, One618, Latin Securities |
| Detalle Broker | `/broker/:id` | Editar posiciones y deuda de un broker |
| Portfolio Unificado | `/unificada` | Vista consolidada con torta, agrupado por clase y sector |
| Rotaciones | `/rotaciones` | Lista de estrategias de trading con P&L |
| Detalle Rotación | `/evento/:id` | Tracking de entrada/salida de una rotación |

---

## Modelos de datos (Firestore)

### `brokerPositions` (docs: `jpm`, `one`, `latin`)
```json
{
  "assets": [{ "ticker": "AL30", "quantity": 100, "price": 52.5, "isBond": true }],
  "debt": 5000,
  "usdRate": 1450,
  "lastUpdated": "ISO timestamp"
}
```

### `rotations`
```json
{
  "eventName": "Rotacion AL30 → GD30",
  "tradeDate": "2025-01-15",
  "initialUsdRate": 1380,
  "soldAssets": [{ "ticker": "AL30", "quantity": 100, "priceAtTrade": 50 }],
  "boughtAssets": [{ "ticker": "GD30", "quantity": 80, "priceAtTrade": 62 }],
  "currentPricesFromDb": { "GD30": 65.2 },
  "isClosed": false,
  "lastUpdated": "ISO timestamp"
}
```

---

## APIs externas

### BYMA (Bolsa de Valores de Buenos Aires)
- OAuth2 client credentials para obtener token
- `GET /api/byma/snapshot/v1/equity` — precios de acciones
- `GET /api/byma/snapshot/v1/fixed_income` — precios de bonos
- Proxied en dev via Vite: `/api/byma/* → https://apigw.byma.com.ar`

### MAE (Mercado Abierto Electrónico)
- `GET /api/mae/mercado/cotizaciones/rentafija` — datos de renta fija
- Proxied: `/api/mae/* → https://api.mae.com.ar`

**Cálculo de tipo de cambio:**
- MEP: cotización AL30/AL30D o GD30/GD30D
- CCL: fallback hardcodeado a 1450

---

## Variables de entorno (`.env`)

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN      # mi-cartera-tracker.firebaseapp.com
VITE_FIREBASE_PROJECT_ID       # mi-cartera-tracker
VITE_MAE_API_KEY
VITE_BYMA_CLIENT_ID
VITE_BYMA_CLIENT_SECRET
```

---

## Flujo de autenticación

1. Login email/password → Firebase Auth
2. Flag `justLoggedIn` dispara modal para registrar biométrico
3. Credencial WebAuthn guardada en el dispositivo
4. `sessionStorage.bioUnlocked` evita re-autenticación en la misma sesión
5. En nuevas sesiones muestra pantalla de bloqueo biométrico

---

## Características especiales

- **Biométrico (WebAuthn):** huella/Face ID como segundo factor de seguridad de sesión
- **Multi-moneda:** conversión ARS↔USD usando MEP/CCL calculado desde precios de bonos
- **Clasificación de activos:** diccionario en `utils/dictionary.js` con categorías (Bonos, Acciones, CEDEARs) y sectores (Soberanos, Energía, Financieras, Tecnología, etc.)
- **Export Excel:** portfolio completo a XLSX con broker, ticker, cantidad, precio y valuación USD
- **PWA:** instalable como app móvil (`manifest.json`, íconos, meta tags Apple)
- **Rotaciones:** tracking de estrategias de trading con P&L en ARS y USD, cálculo de alfa respecto al activo vendido

---

## Comandos

```bash
npm run dev      # Servidor de desarrollo (Vite)
npm run build    # Build de producción → dist/
npm run preview  # Simular producción local
npm run lint     # ESLint
```

---

## Estado actual del código (rama `main`)

Archivos modificados recientemente:
- `.env` — variables de entorno
- `src/utils/priceService.js` — servicio de precios
- `vite.config.js` — configuración proxies
- `src/utils/bymaService.js` — nuevo (integración BYMA)
