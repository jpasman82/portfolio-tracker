# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

### Consolidado de brokers y cartera

Brokers y Cartera usan buildPortfolioValuation: incluyen todas las posiciones (también los CEDEARs de Brasil), valúan los bonos por 100 nominales y restan la deuda una sola vez. Cada posición utiliza el precio y el dólar guardados en su broker. El refresco de ambas pantallas actualiza precios y MEP antes de valuar, conservando cantidades, deuda y campos manuales.

El historial diario oficial lo publica el proceso de cierre del servidor, según su política de cotizaciones. El navegador solo lo consulta; los registros manuales se guardan en una colección separada.
