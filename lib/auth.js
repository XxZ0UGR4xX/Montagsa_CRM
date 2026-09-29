// lib/auth.js — JWT firmado con expiración + permisos por área
const jwt = require('jsonwebtoken');
const { pool, uno } = require('./db');

const SECRETO = process.env.JWT_SECRET || 'montagsa-dev-cambiar-en-produccion';
const DURACION = process.env.JWT_EXPIRES || '8h';

/**
 * Permisos por sección. El mismo mapa lo usa el menú del front
 * (GET /api/auth/permisos), así que solo se edita aquí.
 */
const PERMISOS = {
    dashboard:      ['admin', 'almacen', 'comercial', 'administracion'],
    // CRM
    clientes:       ['admin', 'comercial', 'administracion'],
    interacciones:  ['admin', 'comercial'],
    // Almacén
    equipos:        ['admin', 'almacen', 'comercial'],
    inventario:     ['admin', 'almacen'],
    maxmin:         ['admin', 'almacen', 'administracion'],
    movimientos:    ['admin', 'almacen'],
    // Comercial
    rentas:         ['admin', 'comercial'],
    servicios:      ['admin', 'comercial', 'almacen'],
    facturacion:    ['admin', 'comercial', 'administracion'],
    traspasos:      ['admin', 'comercial', 'almacen'],
    // Administración
    compras:        ['admin', 'administracion', 'almacen'],
    proveedores:    ['admin', 'administracion', 'almacen'],
    cobranza:       ['admin', 'administracion'],
    creditos:       ['admin', 'administracion'],
    rrhh:           ['admin', 'administracion'],
    contabilidad:   ['admin', 'administracion'],
    // Configuración
    usuarios:       ['admin'],
};

function firmar(usuario) {
    return jwt.sign({ id: usuario.id, rol: usuario.rol, nombre: usuario.nombre }, SECRETO, { expiresIn: DURACION });
}

/** Exige un token válido y un usuario activo. Deja req.usuario. */
async function requireAuth(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sesión requerida' });
    try {
        const datos = jwt.verify(token, SECRETO);
        const u = await uno(pool, 'SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = $1', [datos.id]);
        if (!u || !u.activo) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
        req.usuario = u;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Sesión expirada, vuelve a iniciar sesión' });
    }
}

/** Middleware: permite el acceso si el rol tiene permiso a alguna de las secciones. */
function puede(...secciones) {
    return (req, res, next) => {
        const rol = req.usuario && req.usuario.rol;
        const ok = secciones.some((s) => (PERMISOS[s] || []).includes(rol));
        if (!ok) return res.status(403).json({ error: 'Tu rol no tiene acceso a esta sección' });
        next();
    };
}

function seccionesDe(rol) {
    return Object.keys(PERMISOS).filter((s) => PERMISOS[s].includes(rol));
}

module.exports = { firmar, requireAuth, puede, PERMISOS, seccionesDe };
