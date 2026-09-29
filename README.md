# Montagsa · CRM + ERP + SCM

Sistema interno para una empresa de **renta, venta y servicio de montacargas**, organizado por las áreas de la empresa: Almacén, Comercial y Administración, más el CRM de clientes.

Es una versión aparte de TiendaTech (proyecto de Negocios Electrónicos) con el mismo stack: **Node.js + Express + PostgreSQL**, front en HTML/CSS/JS sin frameworks.

> Supuesto de giro: los módulos (rentas, servicios, traspasos a reparación/venta) corresponden a una arrendadora de montacargas. Si Montagsa se dedica a otro tipo de equipo, basta con cambiar los datos de ejemplo de `db/database.sql`; la lógica es la misma.

## Áreas y módulos

| Área | Módulo | Qué hace |
|---|---|---|
| **Almacén** | Equipos (flota) | Montacargas, patines, apiladores y plataformas con número económico, horómetro y tarifas. |
| | Inventario | Refacciones y consumibles con stock, costo, precio, proveedor y ubicación. Entradas, salidas y ajustes manuales. |
| | Máximos y mínimos | Detecta lo que está agotado, bajo mínimo o sobre máximo, sugiere cuánto pedir (máximo − stock) y genera órdenes de compra por proveedor. |
| | Movimientos | Kardex con referencia a la compra, la orden de servicio o el ajuste que lo originó. |
| **Comercial** | Rentas | Contratos diarios, semanales o mensuales. Al crearla el equipo pasa a *renta*; al finalizarla regresa a *disponible* o a *reparación* (abre una orden de servicio automática). |
| | Servicios | Órdenes de servicio (preventivo, correctivo, diagnóstico, instalación) a equipos del cliente o de la flota. Las refacciones se descuentan del inventario. |
| | Facturación | Facturas de rentas, servicios, venta de equipo y manuales, con IVA 16 % y vencimiento según los días de crédito. Cancelación con póliza de reversa. |
| | Traspasos | Tablero de la flota en **disponible · renta · venta · reparación** y su historial. |
| **Administración** | Compras | Órdenes de compra: borrador → enviada → recibida (sube inventario) → pagada. |
| | Proveedores | Catálogo con tiempo de entrega y saldo por pagar. |
| | Cobranza | Cartera por antigüedad (por vencer, 1-30, 31-60, 61-90, +90 días) y registro de pagos. |
| | Créditos | Límite, plazo y estado (contado / activo / suspendido) por cliente. |
| | RRHH | Plantilla por área; los técnicos de Taller se asignan a las órdenes de servicio. Registro de nómina mensual. |
| | Contabilidad | Pólizas de partida doble (automáticas y manuales), balanza de comprobación y estado de resultados. |
| **CRM** | Clientes e interacciones | Ficha del cliente con etapa (prospecto, activo, frecuente, inactivo), saldo, rentas, facturas y bitácora de contactos. |

## Reglas de negocio principales

- **Traspasos permitidos:** disponible → renta / venta / reparación / baja · renta → disponible / reparación · venta → disponible / reparación / vendido · reparación → disponible / venta / baja. A *renta* solo se entra creando una renta y a *vendido* solo vendiendo (así siempre hay contrato o factura detrás).
- **Crédito:** si el cliente tiene el crédito suspendido o la operación rebasa su límite, la renta o factura se bloquea. Solo el rol **admin** puede autorizarla.
- **Contabilidad automática:** cada factura, pago, consumo de refacción, recepción y pago de compra, venta de equipo y nómina genera su póliza. La balanza siempre debe cuadrar.
- **CRM automático:** un prospecto pasa a activo con su primera renta o factura, y a frecuente con 5 facturas.

## Roles

| Rol | Ve |
|---|---|
| `admin` | Todo, incluidos usuarios y autorizaciones de crédito |
| `almacen` | Equipos, inventario, máximos/mínimos, movimientos, servicios, traspasos, compras y proveedores |
| `comercial` | Clientes, interacciones, equipos, rentas, servicios, facturación y traspasos |
| `administracion` | Clientes, facturación, compras, proveedores, cobranza, créditos, RRHH, contabilidad y máximos/mínimos |

Los permisos están en un solo lugar: `lib/auth.js` (`PERMISOS`). El menú se arma con lo que regresa `/api/auth/me`.

## Usuarios de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Admin | admin@montagsa.mx | Admin#MG2026 |
| Almacén | almacen@montagsa.mx | Almacen#MG2026 |
| Comercial | comercial@montagsa.mx | Comercial#MG2026 |
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
│   └── negocio.js         reglas: traspasos, inventario, crédito, facturas, rentas, servicios, compras, nómina, pólizas
├── routes/
│   ├── comun.js           login, usuarios, catálogos
│   ├── crm-almacen.js     clientes, interacciones, equipos, inventario, máximos/mínimos
│   ├── comercial.js       rentas, servicios, facturación, traspasos, venta de equipo
│   └── administracion.js  proveedores, compras, cobranza, créditos, RRHH, contabilidad, dashboard
├── scripts/demo.js        datos de ejemplo usando las mismas reglas de negocio
└── public/
    ├── login.html, dashboard.html
    ├── almacen/  comercial/  administracion/  crm/  config/
    ├── css/app.css
    └── js/ core.js, layout.js, crud.js, paginas/*.js
```

## Base de datos (20 tablas)

`usuarios`, `clientes`, `interacciones`, `empleados`, `proveedores`, `equipos`, `traspasos`, `productos`, `movimientos_inventario`, `ordenes_compra`, `orden_compra_items`, `rentas`, `servicios`, `servicio_refacciones`, `facturas`, `factura_conceptos`, `pagos`, `cuentas_contables`, `polizas`, `poliza_movimientos`.

Los folios se generan solos: `R-1001` (rentas), `OS-1001` (servicios), `F-1001` (facturas), `OC-1001` (compras), `P-1001` (pólizas), `EMP-001` (empleados).

## API (resumen)

Todas bajo `/api`, con `Authorization: Bearer <token>` excepto login y salud.

- Auth: `POST /auth/login`, `GET /auth/me`, `PUT /auth/password`
- CRM: `GET|POST /clientes`, `GET|PUT /clientes/:id`, `GET|POST /interacciones`
- Almacén: `GET|POST /equipos`, `GET|PUT /equipos/:id`, `GET|POST /productos`, `PUT /productos/:id`, `POST /productos/:id/movimiento`, `GET /movimientos`, `GET /maxmin`, `POST /maxmin/generar-oc`
- Comercial: `GET|POST /rentas`, `POST /rentas/:id/{finalizar|cancelar|facturar}`, `GET|POST /servicios`, `GET|PUT /servicios/:id`, `POST /servicios/:id/{refacciones|estado|facturar}`, `GET|POST /facturas`, `GET /facturas/:id`, `POST /facturas/:id/cancelar`, `GET|POST /traspasos`, `POST /equipos/:id/vender`
- Administración: `GET|POST /proveedores`, `PUT /proveedores/:id`, `GET|POST /compras`, `GET /compras/:id`, `POST /compras/:id/{estado|pagar}`, `GET /cobranza`, `GET|POST /pagos`, `GET /creditos`, `PUT /creditos/:id`, `GET|POST /empleados`, `PUT /empleados/:id`, `POST /nomina`, `GET /contabilidad/{cuentas|polizas|balanza|resultados}`, `POST /contabilidad/polizas`
- Otros: `GET /dashboard`, `GET /catalogos`, `GET /salud`

## Seguridad (mejoras respecto a TiendaTech)

- Token **JWT firmado** con expiración de 8 h (antes era Base64 predecible). Cambia el secreto con la variable `JWT_SECRET`.
- Todas las rutas de datos exigen sesión y permiso por sección.
- Contraseñas con bcrypt y consultas parametrizadas.
- La contraseña de la BD se puede dar con `PGPASSWORD` en lugar de dejarla en `db.config.js`.

## Ideas para las siguientes etapas

- Timbrado CFDI 4.0 con un PAC (hoy la factura es un documento interno).
- Cotizaciones que se convierten en renta, y renovación automática de rentas mensuales.
- Calendario de mantenimientos preventivos por horómetro.
- Checklist de entrega/recepción con fotos del equipo.
- Portal del cliente para ver sus rentas y facturas.
- Depreciación mensual de la flota en contabilidad.
