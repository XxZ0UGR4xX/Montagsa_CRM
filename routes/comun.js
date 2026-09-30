// routes/comun.js — Auth, usuarios, catálogos para formularios y utilidades de rutas
const express = require('express');
const bcrypt = require('bcrypt');
const { pool, uno, todos, ruta, ErrorNegocio } = require('../lib/db');
const { firmar, requireAuth, puede, seccionesDe, PERMISOS } = require('../lib/auth');

/** INSERT con solo los campos permitidos que vengan en el body. */
async function insertar(db, tabla, campos, body) {
    const keys = campos.filter((k) => body[k] !== undefined);
    if (!keys.length) throw new ErrorNegocio(400, 'Sin datos');
    const vals = keys.map((k) => (body[k] === '' ? null : body[k]));
    const sql = `INSERT INTO ${tabla} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`;
    return uno(db, sql, vals);
}

/** UPDATE con solo los campos permitidos que vengan en el body. */
async function actualizar(db, tabla, id, campos, body) {
    const keys = campos.filter((k) => body[k] !== undefined);
    if (!keys.length) throw new ErrorNegocio(400, 'Sin cambios');
    const vals = keys.map((k) => (body[k] === '' ? null : body[k]));
    const sql = `UPDATE ${tabla} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING *`;
    const r = await uno(db, sql, [...vals, id]);
    if (!r) throw new ErrorNegocio(404, 'Registro no encontrado');
    return r;
}

/** Solo el admin puede usar "forzar" (autorizar crédito excedido o suspendido). */
const forzar = (req) => req.usuario.rol === 'admin' && req.body && req.body.forzar === true;

const router = express.Router();

// ------------------------------------------------------------- Auth
router.post('/auth/login', ruta(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw new ErrorNegocio(400, 'Correo y contraseña son obligatorios');
    const u = await uno(pool, 'SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (!u || !u.activo || !(await bcrypt.compare(password, u.password_hash))) {
        throw new ErrorNegocio(401, 'Correo o contraseña incorrectos');
    }
    res.json({
        token: firmar(u),
        usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol },
        secciones: seccionesDe(u.rol),
    });
}));

router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ usuario: req.usuario, secciones: seccionesDe(req.usuario.rol) });
});

router.put('/auth/password', requireAuth, ruta(async (req, res) => {
    const { actual, nueva } = req.body || {};
    if (!nueva || nueva.length < 8) throw new ErrorNegocio(400, 'La nueva contraseña debe tener al menos 8 caracteres');
    const u = await uno(pool, 'SELECT password_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (!(await bcrypt.compare(actual || '', u.password_hash))) throw new ErrorNegocio(401, 'La contraseña actual no coincide');
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(nueva, 10), req.usuario.id]);
    res.json({ ok: true });
}));

// ------------------------------------------------------------- Usuarios (solo admin)
router.get('/usuarios', requireAuth, puede('usuarios'), ruta(async (req, res) => {
    res.json(await todos(pool, 'SELECT id, nombre, email, rol, activo, creado FROM usuarios ORDER BY id'));
}));

router.post('/usuarios', requireAuth, puede('usuarios'), ruta(async (req, res) => {
    const { nombre, email, password, rol } = req.body || {};
    if (!nombre || !email || !password || password.length < 8) throw new ErrorNegocio(400, 'Nombre, correo y contraseña (mín. 8) son obligatorios');
    const u = await uno(pool,
        'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1,$2,$3,$4) RETURNING id, nombre, email, rol, activo',
        [nombre, email.trim().toLowerCase(), await bcrypt.hash(password, 10), rol || 'comercial']);
    res.status(201).json(u);
}));

router.put('/usuarios/:id', requireAuth, puede('usuarios'), ruta(async (req, res) => {
    const body = { ...req.body };
    if (Number(req.params.id) === req.usuario.id && (body.activo === false || (body.rol && body.rol !== 'admin'))) {
        throw new ErrorNegocio(409, 'No puedes desactivarte ni quitarte el rol de admin a ti mismo');
    }
    if (body.password) {
        if (body.password.length < 8) throw new ErrorNegocio(400, 'La contraseña debe tener al menos 8 caracteres');
        body.password_hash = await bcrypt.hash(body.password, 10);
    }
    const u = await actualizar(pool, 'usuarios', req.params.id, ['nombre', 'email', 'rol', 'activo', 'password_hash'], body);
    delete u.password_hash;
    res.json(u);
}));

// ------------------------------------------------------------- Catálogos para selects
// Cualquier usuario con sesión, pero cada rol solo recibe lo que su área necesita
// (p. ej. Producción no recibe saldos de clientes ni límites de crédito).
router.get('/catalogos', requireAuth, ruta(async (req, res) => {
    const rol = req.usuario.rol;
    const tiene = (...secciones) => rol === 'admin' || secciones.some((s) => (PERMISOS[s] || []).includes(rol));
    const out = {};

    if (tiene('clientes', 'rentas', 'cotizaciones')) {
        out.clientes = await todos(pool, `SELECT id, razon_social, etapa, credito_estado, dias_credito FROM clientes ORDER BY razon_social`);
    } else if (tiene('ordenes_trabajo', 'maniobras', 'refacciones_ot')) {
        out.clientes = await todos(pool, `SELECT id, razon_social FROM clientes ORDER BY razon_social`);
    }

    if (tiene('equipos')) {
        out.equipos = rol === 'produccion'
            ? await todos(pool, `SELECT id, numero_economico, tipo, marca, modelo, estado, horometro, ubicacion FROM equipos ORDER BY numero_economico`)
            : await todos(pool, `SELECT id, numero_economico, tipo, marca, modelo, estado, horometro, tarifa_diaria, tarifa_semanal,
                                        tarifa_mensual, precio_venta FROM equipos ORDER BY numero_economico`);
    }

    if (tiene('inventario', 'maxmin', 'ordenes_trabajo', 'refacciones_ot')) {
        out.productos = await todos(pool, `SELECT id, sku, nombre, unidad, stock, costo, precio, proveedor_id FROM productos WHERE activo ORDER BY sku`);
    }

    if (tiene('proveedores', 'compras', 'inventario')) {
        out.proveedores = await todos(pool, `SELECT id, nombre FROM proveedores WHERE activo ORDER BY nombre`);
    }

    if (tiene('ordenes_trabajo', 'rondas', 'preventivos', 'maniobras')) {
        out.tecnicos = await todos(pool, `SELECT id, nombre, puesto FROM empleados WHERE estado = 'activo' AND area = 'taller' ORDER BY nombre`);
    }

    res.json(out);
}));

module.exports = { router, insertar, actualizar, forzar };
