# Project Lens

Project Lens es una app local para inspeccionar visualmente una carpeta de proyecto desde VS Code. El backend escanea metadatos, clasifica archivos, estima complejidad estructural y ayuda a priorizar refactors.

No muestra contenido interno de archivos. Para metricas de refactor lee codigo de forma local y solo conserva conteos agregados como funciones, clases, imports, fan-in/fan-out y senales.

## Funciones principales

- Modo Banco Seguro: resalta que el analisis es local, offline y basado solo en metadatos.
- Presets por stack: agrega exclusiones sugeridas para Node/React, Python, Java/Spring, .NET, Data/ML y Mobile.
- Opciones Smart Ignore: `.gitignore`, ruido comun, patrones manuales, include overrides y reglas desactivables.
- Config local propia: guarda preferencias en `.project-lens.json` sin modificar `.gitignore`.
- Categorias: separa codigo productivo, tests, artefactos, configuracion, documentacion, dependencias/cache y desconocidos.
- Metricas de refactor: funciones, clases, funciones largas, clases grandes, imports, dependencias directas, fan-in/fan-out y senales de responsabilidades mezcladas.
- Snapshots: guarda estados del analisis para comparar antes/despues de un refactor.
- Dependencias: tabla de fan-in/fan-out, candidatos a dividir y ciclos de imports detectados.
- Mapa visual: vista separada tipo arbol horizontal para explorar carpetas y archivos por lineas, tamano o score, con color por `refactorScore`.

## Requisitos

- Windows 10/11
- Node.js 18 o superior
- npm
- VS Code

## Estructura

```text
project-lens/
  client/
  server/
  README.md
```

## Instalacion

Abre PowerShell en la carpeta `project-lens` y ejecuta:

```powershell
npm run setup
```

Esto instala dependencias del proyecto raiz, del servidor y del cliente.

## Ejecucion en desarrollo

Desde la carpeta `project-lens`:

```powershell
npm run dev
```

URLs locales:

- Frontend: http://127.0.0.1:5173
- Backend: http://127.0.0.1:3333
- Endpoint: http://127.0.0.1:3333/api/scan?root=C%3A%5CUsers%5CTuUsuario%5CDesktop%5Cmi-proyecto

En la interfaz, pega una ruta local de Windows, por ejemplo:

```text
C:\Users\TuUsuario\Desktop\mi-proyecto
```

Despues de escanear, usa el boton `Ver mapa visual` para abrir el mapa jerarquico del proyecto. En esa vista puedes enfocar carpetas o archivos, buscar rutas, expandir/colapsar el recorrido y volver al dashboard con `Volver`.

## Ejecutar servidor y cliente por separado

Terminal 1:

```powershell
npm run server
```

Terminal 2:

```powershell
npm run client
```

## API

### `GET /api/scan?root=<ruta>`

Escanea recursivamente la ruta indicada y devuelve:

- ruta relativa
- extension
- tamano en bytes
- numero de lineas
- lineas vacias
- carpeta padre
- fecha de modificacion
- profundidad de carpeta
- `refactorScore`

Parametros opcionales:

- `useGitignore=true|false`: lee el `.gitignore` de la raiz escaneada. Por defecto es `true`.
- `useGeneratedPreset=true|false`: ignora outputs comunes como `outputs/`, `out/`, `.cache/`, `.turbo/`, `.vite/`, `tmp/`, `logs/`, `playwright-report/` y `test-results/`. Por defecto es `true`.
- `ignore=<pattern>`: agrega patrones manuales estilo `.gitignore`. Se puede repetir varias veces.
- `include=<pattern>`: incluye archivos o carpetas aunque hayan sido ignorados por `.gitignore`, defaults o config.
- `disabledRule=<pattern>`: desactiva temporalmente una regla activa sin editar `.gitignore`.

Ejemplo:

```text
http://127.0.0.1:3333/api/scan?root=C%3A%5CUsers%5CTuUsuario%5CDesktop%5Cmi-proyecto&useGitignore=true&useGeneratedPreset=true&ignore=outputs%2F%2A%2A&ignore=reports%2F%2A%2A
```

Carpetas ignoradas por defecto:

```text
.git, .venv, venv, node_modules, __pycache__, .cache, outputs, inputs, dist, build, coverage, tmp, .tmp-tests, tests_artifacts_tmp, .project-lens, .next, bin, obj
```

La respuesta tambien incluye `scanOptions`, `activeIgnorePatterns`, `projectLensConfig`, `gitignoreLoaded`, `ignoredFiles`, `ignoredFolders`, `ignoreSummary`, `byCategory`, `dependencies`, `couplingAlerts` y `recommendations`.

### `GET /api/config?root=<ruta>`

Lee `.project-lens.json` de la raiz escaneada si existe.

### `PUT /api/config?root=<ruta>`

Guarda preferencias locales sin tocar `.gitignore`:

```json
{
  "exclude": ["outputs/**", ".venv/**"],
  "includeOverrides": ["outputs/case_demo9/report.md"],
  "categories": {
    "source": ["core/**", "web_scraping/**"],
    "tests": ["tests/**"],
    "artifacts": ["outputs/**", "inputs/**"]
  }
}
```

### Snapshots

- `GET /api/snapshots?root=<ruta>` lista snapshots guardados.
- `POST /api/snapshots` guarda un snapshot del scan actual.
- `GET /api/snapshots/compare?root=<ruta>&base=<id>&target=<id>` compara dos snapshots.

## Refactor score

`refactorScore` es una puntuacion de 0 a 100 que prioriza codigo productivo y combina:

- lineas del archivo
- tamano en bytes
- profundidad dentro de carpetas
- funciones, clases, imports y complejidad estimada
- fan-in/fan-out de dependencias internas
- senales como funciones largas, clases grandes, muchas funciones privadas o responsabilidades mezcladas

Es una senal para priorizar revision. No reemplaza una lectura humana del codigo.

## Build del frontend

```powershell
npm run build
```

El resultado queda en `client/dist`.

## Produccion local simple

Primero compila el frontend:

```powershell
npm run build
```

Luego inicia el backend:

```powershell
npm run start
```

Para servir el frontend compilado puedes usar cualquier servidor estatico local apuntando a `client/dist`.
