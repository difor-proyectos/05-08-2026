# Difor Comercial V16.57 — acceso resiliente y sincronización central

Esta versión funciona de dos maneras:

- **Cloudflare disponible:** carga y guarda la información central en D1.
- **Cloudflare/API no disponible:** permite ingresar igualmente y trabajar con la información guardada en el dispositivo. Los cambios quedan en cola y la aplicación vuelve a intentar la sincronización.

La clave de acceso actual es `Difor.chiloe`, salvo que la cambies desde la aplicación y en el secreto de Cloudflare.

## Estructura para GitHub

Todos estos archivos deben quedar en la raíz del repositorio:

```text
index.html
_worker.js
_headers
_routes.json
schema.sql
README.md
CHECKSUMS.sha256
.gitignore
```

`_worker.js` contiene la API `/api/sync` y sirve también los archivos estáticos. Se usa el modo avanzado de Cloudflare Pages para evitar depender de la carpeta `functions`, que puede perderse al subir archivos manualmente a GitHub.

## Cloudflare Pages

- Framework preset: `None`
- Build command: vacío
- Build output directory: `.`
- Root directory: vacío
- Production branch: `main`

## Variables y vinculaciones

En **Configuración > Variables y secretos**:

```text
DIFOR_APP_KEY = Difor.chiloe
```

En **Configuración > Vinculaciones**, agrega una base D1. Se acepta cualquiera de estos nombres:

```text
DIFOR_DB
```

También se acepta `DB` como respaldo, aunque se recomienda conservar solo `DIFOR_DB`.

Después de cambiar variables o vinculaciones, vuelve a implementar el proyecto.

## Comprobación

Abre:

```text
https://TU-DOMINIO.pages.dev/api/health
```

Debe mostrar `ok: true`, `d1: true` y `keyConfigured: true`.

Después abre:

```text
https://TU-DOMINIO.pages.dev/api/sync
```

Sin encabezado de autenticación debe responder `UNAUTHORIZED`. Eso confirma que la API está activa.

## Uso sin API

Si `/api/sync` responde 405, falla D1 o Cloudflare no responde, la pantalla de acceso ya no bloquea la aplicación. Con una clave local válida permite entrar en **Modo local**. En la barra superior aparece el indicador correspondiente y puede tocarse para reintentar la sincronización.
