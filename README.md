# Montagsa · CRM + ERP + SCM

Sistema interno para una empresa de **renta, venta y servicio de montacargas**, organizado por las áreas de la empresa: Almacén, Comercial, Producción y Administración, más el CRM de clientes. La separación por área es estricta: el backend (`puede()` en cada ruta) es la barrera real, no solo el menú.

Es una versión aparte de TiendaTech (proyecto de Negocios Electrónicos) con el mismo stack: **Node.js + Express + PostgreSQL**, front en HTML/CSS/JS sin frameworks.

> Supuesto de giro: los módulos (rentas, servicios, traspasos a reparación/venta) corresponden a una arrendadora de montacargas. Si Montagsa se dedica a otro tipo de equipo, basta con cambiar los datos de ejemplo de `db/database.sql`; la lógica es la misma.

## Áreas y módulos

| Área | Módulo | Qué hace |
|---|---|---|
| **Almacén** | Equipos (flota) | Montacargas, patines, apiladores y plataformas con número económico, horómetro y tarifas. |
| | Inventario | Refacciones y consumibles con stock, costo, precio, proveedor y ubicación. Entradas, salidas y ajustes manuales. |
| | Máximos y mínimos | Detecta lo que está agotado, bajo mínimo o sobre máximo, sugiere cuánto pedir (máximo − stock) y genera órdenes de compra por proveedor. |
| | Movimientos | Kardex con referencia a la compra, la orden de servicio o el ajuste que lo originó. |
| | Requisiciones | Refacciones que pide Producción para una orden de trabajo. Al surtirlas se descuenta el inventario y se genera la póliza de costo. |
| **Comercial** | Rentas | Contratos diarios, semanales o mensuales. Al crearla el equipo pasa a *renta*; al finalizarla regresa a *disponible* o a *reparación* (abre una OT de servicio en evaluación). |
| | Cotizaciones | Bandeja de OT de servicio en *cotización comercial*: agrega el margen, fija el precio al cliente y autoriza o rechaza. |
| | Facturación | Facturas de rentas, servicios/maniobras/refacciones (OT), venta de equipo y manuales, con IVA 16 % y vencimiento según los días de crédito. Muestra qué OT cerradas faltan por facturar. Cancelación con póliza de reversa. |
| | Traspasos | Tablero de la flota en **disponible · renta · venta · reparación** y su historial. |
| **Producción** | Órdenes de trabajo | Vista general de rondas, preventivos, servicios, maniobras y refacciones, con pestañas por tipo y estado. El flujo completo de servicios (evaluación → cotización interna → envío a Comercial → ejecución → cierre) se gestiona aquí. |
| | Rondas | Equipos en renta con su última lectura de horómetro y días sin visita. Registrar una lectura cierra una OT tipo *ronda*. |
| | Preventivos | Por equipo: horómetro actual, horas restantes y estado (vencido / próximo / en rango) según un intervalo y una secuencia de servicios configurables. |
| | Maniobras | Movimiento de equipos entre ubicaciones: programada → en ruta → entregada → cerrada → facturada. |
| | Refacciones | Venta/surtido de refacciones a un cliente: partidas, requisición a Almacén y factura al cerrar. |
| **Administración** | Compras | Órdenes de compra: borrador → enviada → recibida (sube inventario) → pagada. |
| | Proveedores | Catálogo con tiempo de entrega y saldo por pagar. |
| | Cobranza | Cartera por antigüedad (por vencer, 1-30, 31-60, 61-90, +90 días) y registro de pagos. |
| | Créditos | Límite, plazo y estado (contado / activo / suspendido) por cliente. |
| | RRHH | Plantilla por área; los técnicos de Taller se asignan a las órdenes de trabajo. Registro de nómina mensual. |
| | Contabilidad | Pólizas de partida doble (automáticas y manuales), balanza de comprobación y estado de resultados. |
| **CRM** | Clientes e interacciones | Ficha del cliente con etapa (prospecto, activo, frecuente, inactivo), saldo, rentas, facturas y bitácora de contactos. |

## Reglas de negocio principales

- **Traspasos permitidos:** disponible → renta / venta / reparación / baja · renta → disponible / reparación · venta → disponible / reparación / vendido · reparación → disponible / venta / baja. A *renta* solo se entra creando una renta y a *vendido* solo vendiendo (así siempre hay contrato o factura detrás).
- **Crédito:** si el cliente tiene el crédito suspendido o la operación rebasa su límite, la renta o factura se bloquea. Solo el rol **admin** puede autorizarla.
- **Contabilidad automática:** cada factura, pago, consumo de refacción, requisición surtida, recepción y pago de compra, venta de equipo, maniobra, venta de refacciones y nómina genera su póliza. La balanza siempre debe cuadrar.
- **CRM automático:** un prospecto pasa a activo con su primera renta o factura, y a frecuente con 5 facturas.
- **Flujo de servicios (OT):** `evaluacion` → `requiere_cotizacion` → `cotizacion_interna` → `cotizacion_comercial` → `autorizada` (o `rechazada`) → `en_ejecucion` → `cerrada` → `facturada` (o `cancelada` antes de cerrarse). Producción evalúa y cotiza al costo (refacciones + horas de mano de obra); Comercial agrega el margen, fija el precio al cliente y autoriza; al ejecutarse se genera una requisición que Almacén surte; al cerrarse, Comercial factura.
- **Preventivos:** cada equipo lleva un paso dentro de una secuencia configurable (`secuencia_preventivo`) y un intervalo en horas (`config_preventivo`, 250 h por defecto). Vencido = ya pasó el intervalo; próximo = faltan menos de 25 h; en rango = el resto.

## Roles

| Rol | Ve |
|---|---|
| `admin` | Todo, incluidos usuarios y autorizaciones de crédito |
| `almacen` | Equipos (solo lectura), inventario, máximos/mínimos, movimientos, requisiciones |
| `comercial` | Clientes, interacciones, equipos (solo lectura), rentas, cotizaciones, facturación y traspasos |
| `produccion` | Equipos (solo lectura), órdenes de trabajo, rondas, preventivos, maniobras, refacciones |
| `administracion` | Clientes, facturación, compras, proveedores, cobranza, créditos, RRHH, contabilidad y máximos/mínimos |

Los permisos están en un solo lugar: `lib/auth.js` (`PERMISOS`); el `admin` aparece en todos los arreglos porque ve todo. Cada ruta del backend exige `puede('<seccion>')`, así que escribir la URL a mano no da acceso. El menú (`layout.js`) y el dashboard (`GET /dashboard`) solo muestran lo que el rol puede ver, y `GET /catalogos` recorta los campos según el rol (por ejemplo, Producción no recibe saldos ni límites de crédito de los clientes).

## Usuarios de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Admin | admin@montagsa.mx | Admin#MG2026 |
| Almacén | almacen@montagsa.mx | Almacen#MG2026 |
| Comercial | comercial@montagsa.mx | Comercial#MG2026 |
| Producción | produccion@montagsa.mx | Produccion#MG2026 |
| Administración | admon@montagsa.mx | Admon#MG2026 |

## Instalación rápida

```bash
psql -U postgres -c "CREATE DATABASE montagsa;"
psql -U postgres -d montagsa -f db/database.sql   # esquema + datos maestros
npm install
npm run demo                                      # rentas, facturas, pagos, compras de ejemplo
npm start                                         # http://localhost:3000
```

En Windows ver **Comandos para ejecutar Montagsa.txt** (paso a paso en PowerShell).

Para reiniciar los datos: volver a correr `database.sql` y luego `npm run demo`.

## Estructura

```
montagsa/
├── server.js              arranque, rutas y manejo de errores
├── db.config.js           conexión a PostgreSQL (contraseña aquí)
├── db/database.sql        esquema completo + datos maestros (re-ejecutable)
├── lib/
│   ├── db.js              pool, transacciones, helpers
│   ├── auth.js            JWT y permisos por sección
│   └── negocio.js         reglas: traspasos, inventario, crédito, facturas, rentas, órdenes de trabajo, compras, nómina, pólizas
├── routes/
│   ├── comun.js           login, usuarios, catálogos (recortados por rol)
│   ├── crm-almacen.js     clientes, interacciones, equipos, inventario, máximos/mínimos, requisiciones
│   ├── comercial.js       rentas, facturación, traspasos, venta de equipo
│   ├── produccion.js      órdenes de trabajo, cotizaciones (acción de Comercial), rondas, preventivos, maniobras, refacciones
│   └── administracion.js  proveedores, compras, cobranza, créditos, RRHH, contabilidad, dashboard
├── scripts/demo.js        datos de ejemplo usando las mismas reglas de negocio
└── public/
    ├── login.html, dashboard.html
    ├── almacen/  comercial/  produccion/  administracion/  crm/  config/
    ├── css/app.css
    └── js/ core.js, layout.js, crud.js, paginas/*.js
```

## Base de datos (26 tablas)

`usuarios`, `clientes`, `interacciones`, `empleados`, `proveedores`, `equipos`, `traspasos`, `productos`, `movimientos_inventario`, `ordenes_compra`, `orden_compra_items`, `rentas`, `ordenes_trabajo`, `ot_refacciones`, `lecturas_horometro`, `config_preventivo`, `secuencia_preventivo`, `equipo_preventivo`, `requisiciones`, `requisicion_items`, `facturas`, `factura_conceptos`, `pagos`, `cuentas_contables`, `polizas`, `poliza_movimientos`.

`ordenes_trabajo` reemplaza a la antigua `servicios`: una sola tabla para rondas, preventivos, servicios, maniobras y refacciones (`tipo`), con el flujo de estados válido por tipo controlado en `lib/negocio.js`.

Los folios se generan solos: `R-1001` (rentas), `OT-1001` (órdenes de trabajo), `RQ-1001` (requisiciones), `F-1001` (facturas), `OC-1001` (compras), `P-1001` (pólizas), `EMP-001` (empleados).

## API (resumen)

Todas bajo `/api`, con `Authorization: Bearer <token>` excepto login y salud.

- Auth: `POST /auth/login`, `GET /auth/me`, `PUT /auth/password`
- CRM: `GET|POST /clientes`, `GET|PUT /clientes/:id`, `GET|POST /interacciones`
- Almacén: `GET|POST /equipos`, `GET|PUT /equipos/:id`, `GET|POST /productos`, `PUT /productos/:id`, `POST /productos/:id/movimiento`, `GET /movimientos`, `GET /maxmin`, `POST /maxmin/generar-oc`, `GET /requisiciones`, `GET /requisiciones/:id`, `POST /requisiciones/:id/surtir`
- Comercial: `GET|POST /rentas`, `POST /rentas/:id/{finalizar|cancelar|facturar}`, `GET|POST /facturas`, `GET /facturas/:id`, `POST /facturas/:id/cancelar`, `GET|POST /traspasos`, `POST /equipos/:id/vender`, `GET /cotizaciones`, `POST /servicios/:id/{cotizacion-comercial|autorizar|rechazar}`, `GET /ot/pendientes-facturar`
- Producción: `GET /ot`, `GET /ot/:id`, `GET|POST /servicios`, `POST /servicios/:id/{evaluacion|cotizacion-interna|refacciones|enviar-cotizacion|iniciar-ejecucion}`, `POST /ot/:id/{cerrar|cancelar|facturar}`, `GET|POST /rondas`, `GET /preventivos`, `POST /preventivos/:equipoId/generar`, `POST /preventivos/:id/cerrar`, `GET|PUT /config/preventivo`, `GET /config/secuencia-preventivo`, `PUT /config/secuencia-preventivo/:id`, `GET|POST /maniobras`, `POST /maniobras/:id/estado`, `GET|POST /refacciones-ot`, `GET /refacciones-ot/:id`
- Administración: `GET|POST /proveedores`, `PUT /proveedores/:id`, `GET|POST /compras`, `GET /compras/:id`, `POST /compras/:id/{estado|pagar}`, `GET /cobranza`, `GET|POST /pagos`, `GET /creditos`, `PUT /creditos/:id`, `GET|POST /empleados`, `PUT /empleados/:id`, `POST /nomina`, `GET /contabilidad/{cuentas|polizas|balanza|resultados}`, `POST /contabilidad/polizas`
- Otros: `GET /dashboard` (contenido según el rol), `GET /catalogos` (recortado según el rol), `GET /salud`

## Seguridad (mejoras respecto a TiendaTech)

- Token **JWT firmado** con expiración de 8 h (antes era Base64 predecible). Cambia el secreto con la variable `JWT_SECRET`.
- Todas las rutas de datos exigen sesión y permiso por sección.
- Contraseñas con bcrypt y consultas parametrizadas.
- La contraseña de la BD se puede dar con `PGPASSWORD` en lugar de dejarla en `db.config.js`.

## Ideas para las siguientes etapas

- Timbrado CFDI 4.0 con un PAC (hoy la factura es un documento interno).
- Cotizaciones que se convierten en renta, y renovación automática de rentas mensuales.
- Checklist de entrega/recepción con fotos del equipo.
- Portal del cliente para ver sus rentas y facturas.
- Depreciación mensual de la flota en contabilidad.
- Confirmar con el taller el significado exacto de la secuencia de preventivos ("4C / 1 / 4C / 1"; ver `> [!warning] Por verificar` en `db/database.sql`).
