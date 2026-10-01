// routes/colaboracion.js — Bitácora por registro (notas, adjuntos y cambios de
// estado), actividades (recordatorios), auditoría y embudo de oportunidades.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, tx, uno, todos, ruta, ErrorNegocio } = require('../lib/db');
const { puede, ENTIDADES, puedeEntidad } = require('../lib/auth');
const N = require('../lib/negocio');
const { insertar, actualizar } = require('./comun');

const router = express.Router();

// Los archivos viven fuera de public/ para que solo se bajen por la API,
// que vuelve a revisar el permiso de la entidad.
const DIR_ADJUNTOS = path.join(__dirname, '..', 'uploads');
const MAX_ADJUNTO = 5 * 1024 * 1024;

const TABLA = {
    cliente: 'clientes', renta: 'rentas', ot: 'ordenes_trabajo',
    factura: 'facturas', orden_compra: 'ordenes_compra', equipo: 'equipos',
};

/** Valida entidad + permiso del rol + existencia del registro. Devuelve el id numérico. */
async function validarEntidad(req, entidad, entidadId) {
    if (!ENTIDADES[entidad]) throw new ErrorNegocio(400, `Entidad inválida: ${entidad}`);
    if (!puedeEntidad(req.usuario.rol, entidad)) throw new ErrorNegocio(403, 'Tu rol no tiene acceso a la bitácora de este registro');
    const id = Number(entidadId);
    if (!Number.isInteger(id) || id < 1) throw new ErrorNegocio(400, 'Registro inválido');
    const r = await uno(pool, `SELECT id FROM ${TABLA[entidad]} WHERE id = $1`, [id]);
    if (!r) throw new ErrorNegocio(404, 'El registro no existe');
    return id;
}

/**
 * "Cambios de estado" de la bitácora. No hay una tabla de historial: se
 * derivan de las fechas que cada registro ya guarda, para no duplicar datos.
 */
async function eventosDe(entidad, id) {
    const ev = [];
    const agrega = (fecha, texto) => { if (fecha) ev.push({ fecha, texto }); };
    if (entidad === 'cliente') {
        const c = await uno(pool, 'SELECT creado, etapa FROM clientes WHERE id = $1', [id]);
        agrega(c.creado, 'Alta del cliente');
        const inter = await todos(pool,
            `SELECT i.fecha, i.tipo, i.descripcion, u.nombre AS usuario FROM interacciones i
             LEFT JOIN usuarios u ON u.id = i.usuario_id WHERE i.cliente_id = $1 ORDER BY i.fecha DESC LIMIT 30`, [id]);
        inter.forEach((i) => ev.push({ fecha: i.fecha, texto: `Interacción (${i.tipo}): ${i.descripcion}`, usuario: i.usuario }));
    } else if (entidad === 'renta') {
        const r = await uno(pool, 'SELECT * FROM rentas WHERE id = $1', [id]);
        agrega(r.creado, `Renta creada · ${r.folio}`);
        agrega(r.fecha_devolucion, 'Equipo devuelto (renta finalizada)');
        if (r.estado === 'cancelada') agrega(r.creado, 'Renta cancelada');
        if (r.factura_id) {
            const f = await uno(pool, 'SELECT folio, creado FROM facturas WHERE id = $1', [r.factura_id]);
            if (f) agrega(f.creado, `Facturada · ${f.folio}`);
        }
    } else if (entidad === 'ot') {
        const o = await uno(pool, 'SELECT * FROM ordenes_trabajo WHERE id = $1', [id]);
        agrega(o.creado, `Orden creada (${o.tipo}) · ${o.folio}`);
        agrega(o.fecha_autorizacion, `Autorizada por ${o.autorizado_por || 'el cliente'}`);
        agrega(o.fecha_cierre, 'Orden cerrada');
        if (o.factura_id) {
            const f = await uno(pool, 'SELECT folio, creado FROM facturas WHERE id = $1', [o.factura_id]);
            if (f) agrega(f.creado, `Facturada · ${f.folio}`);
        }
    } else if (entidad === 'factura') {
        const f = await uno(pool, 'SELECT * FROM facturas WHERE id = $1', [id]);
        agrega(f.creado, `Factura emitida · ${f.folio} · ${f.total}`);
        const pagos = await todos(pool,
            `SELECT p.*, u.nombre AS usuario FROM pagos p LEFT JOIN usuarios u ON u.id = p.usuario_id
             WHERE p.factura_id = $1 ORDER BY p.id`, [id]);
        pagos.forEach((p) => {
            ev.push({ fecha: p.creado, texto: `Pago registrado: ${p.monto} (${p.metodo})`, usuario: p.usuario });
            if (p.cancelado) ev.push({ fecha: p.fecha_cancelacion, texto: `Pago anulado: ${p.motivo_cancelacion}` });
        });
        if (f.estado === 'cancelada') ev.push({ fecha: f.creado, texto: 'Factura cancelada' });
    } else if (entidad === 'orden_compra') {
        const o = await uno(pool, 'SELECT * FROM ordenes_compra WHERE id = $1', [id]);
        agrega(o.creado, `Orden de compra creada · ${o.folio}`);
        agrega(o.fecha_recepcion, 'Mercancía recibida (entra a inventario)');
        agrega(o.fecha_pago, 'Pagada al proveedor');
        if (o.estado === 'cancelada') agrega(o.creado, 'Orden cancelada');
    } else if (entidad === 'equipo') {
        const traspasos = await todos(pool,
            `SELECT t.fecha, t.estado_origen, t.estado_destino, t.motivo, t.referencia, u.nombre AS usuario FROM traspasos t
             LEFT JOIN usuarios u ON u.id = t.usuario_id WHERE t.equipo_id = $1 ORDER BY t.fecha DESC LIMIT 30`, [id]);
        traspasos.forEach((t) => ev.push({
            fecha: t.fecha, usuario: t.usuario,
            texto: `Traspaso ${t.estado_origen} → ${t.estado_destino}${t.referencia ? ` (${t.referencia})` : ''}${t.motivo ? ': ' + t.motivo : ''}`,
        }));
    }
    return ev;
}

// =====================================================================
//  BITÁCORA (estilo chatter: notas + adjuntos + cambios de estado)
// =====================================================================
router.get('/bitacora/:entidad/:id', ruta(async (req, res) => {
    const { entidad } = req.params;
    const id = await validarEntidad(req, entidad, req.params.id);
    const [notas, adjuntos, actividades, eventos] = await Promise.all([
        todos(pool,
            `SELECT n.*, u.nombre AS usuario FROM notas n LEFT JOIN usuarios u ON u.id = n.usuario_id
             WHERE n.entidad = $1 AND n.entidad_id = $2 ORDER BY n.fecha DESC`, [entidad, id]),
        todos(pool,
            `SELECT a.id, a.nombre, a.tipo, a.tamano, a.fecha, u.nombre AS usuario FROM adjuntos a
             LEFT JOIN usuarios u ON u.id = a.usuario_id
             WHERE a.entidad = $1 AND a.entidad_id = $2 ORDER BY a.fecha DESC`, [entidad, id]),
        todos(pool,
            `SELECT ac.*, u.nombre AS asignado_nombre FROM actividades ac JOIN usuarios u ON u.id = ac.asignado_a
             WHERE ac.entidad = $1 AND ac.entidad_id = $2 ORDER BY ac.hecha, ac.fecha_limite`, [entidad, id]),
        eventosDe(entidad, id),
    ]);
    res.json({ entidad, entidad_id: id, notas, adjuntos, actividades, eventos });
}));

router.post('/notas', ruta(async (req, res) => {
    const b = req.body || {};
    const id = await validarEntidad(req, b.entidad, b.entidad_id);
    if (!b.texto || !String(b.texto).trim()) throw new ErrorNegocio(400, 'La nota no puede estar vacía');
    res.status(201).json(await uno(pool,
        'INSERT INTO notas (entidad, entidad_id, usuario_id, texto) VALUES ($1,$2,$3,$4) RETURNING *',
        [b.entidad, id, req.usuario.id, String(b.texto).trim()]));
}));

// El archivo llega en base64 dentro del JSON (no hay dependencia de multer);
// server.js le da a esta ruta un límite de cuerpo más alto que al resto.
router.post('/adjuntos', ruta(async (req, res) => {
    const b = req.body || {};
    const id = await validarEntidad(req, b.entidad, b.entidad_id);
    if (!b.nombre || !b.contenido) throw new ErrorNegocio(400, 'Falta el archivo');
    const datos = Buffer.from(String(b.contenido).split(',').pop(), 'base64');
    if (!datos.length) throw new ErrorNegocio(400, 'El archivo está vacío');
    if (datos.length > MAX_ADJUNTO) throw new ErrorNegocio(413, 'El archivo pasa de 5 MB');
    // El nombre que manda el navegador nunca toca el disco: solo la extensión.
    const ext = path.extname(String(b.nombre)).slice(0, 10).replace(/[^.\w]/g, '');
    const archivo = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    await fs.promises.mkdir(DIR_ADJUNTOS, { recursive: true });
    await fs.promises.writeFile(path.join(DIR_ADJUNTOS, archivo), datos);
    res.status(201).json(await uno(pool,
        `INSERT INTO adjuntos (entidad, entidad_id, nombre, ruta, tipo, tamano, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nombre, tipo, tamano, fecha`,
        [b.entidad, id, String(b.nombre).slice(0, 200), archivo, b.tipo || null, datos.length, req.usuario.id]));
}));

router.get('/adjuntos/:id', ruta(async (req, res) => {
    const a = await uno(pool, 'SELECT * FROM adjuntos WHERE id = $1', [req.params.id]);
    if (!a) throw new ErrorNegocio(404, 'Adjunto no encontrado');
    await validarEntidad(req, a.entidad, a.entidad_id);
    const ruta = path.join(DIR_ADJUNTOS, path.basename(a.ruta));
    if (!fs.existsSync(ruta)) throw new ErrorNegocio(404, 'El archivo ya no está en el servidor');
    res.setHeader('Content-Type', a.tipo || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.nombre)}"`);
    res.sendFile(ruta);
}));

// =====================================================================
//  ACTIVIDADES (recordatorios)
// =====================================================================
const TIPOS_ACTIVIDAD = ['llamada', 'visita', 'correo', 'tarea', 'recoger_equipo', 'entregar_equipo'];

/** Solo se ven las actividades propias; el admin ve las de todos. */
router.get('/actividades', puede('actividades'), ruta(async (req, res) => {
    const params = [];
    const w = ['TRUE'];
    if (req.query.todas === '1' && req.usuario.rol === 'admin') { /* sin filtro de usuario */ } else {
        params.push(req.usuario.id);
        w.push(`ac.asignado_a = $${params.length}`);
    }
    if (req.query.hechas !== '1') w.push('NOT ac.hecha');
    const filas = await todos(pool,
        `SELECT ac.*, u.nombre AS asignado_nombre, cr.nombre AS creado_por_nombre,
                (ac.fecha_limite - CURRENT_DATE) AS dias
         FROM actividades ac JOIN usuarios u ON u.id = ac.asignado_a
         LEFT JOIN usuarios cr ON cr.id = ac.creado_por
         WHERE ${w.join(' AND ')} ORDER BY ac.hecha, ac.fecha_limite, ac.id LIMIT 300`, params);
    // Solo se devuelven las de entidades que el rol puede ver.
    const visibles = filas.filter((f) => puedeEntidad(req.usuario.rol, f.entidad));
    res.json({
        vencidas: visibles.filter((f) => !f.hecha && f.dias < 0),
        hoy: visibles.filter((f) => !f.hecha && f.dias === 0),
        proximas: visibles.filter((f) => !f.hecha && f.dias > 0),
        hechas: visibles.filter((f) => f.hecha),
    });
}));

/** Contador para el menú (actividades propias pendientes, vencidas aparte). */
router.get('/actividades/pendientes', puede('actividades'), ruta(async (req, res) => {
    const r = await uno(pool,
        `SELECT COUNT(*)::int AS pendientes,
                COUNT(*) FILTER (WHERE fecha_limite < CURRENT_DATE)::int AS vencidas
         FROM actividades WHERE asignado_a = $1 AND NOT hecha`, [req.usuario.id]);
    res.json(r);
}));

router.post('/actividades', puede('actividades'), ruta(async (req, res) => {
    const b = req.body || {};
    const id = await validarEntidad(req, b.entidad, b.entidad_id);
    if (!TIPOS_ACTIVIDAD.includes(b.tipo)) throw new ErrorNegocio(400, 'Tipo de actividad inválido');
    if (!b.fecha_limite) throw new ErrorNegocio(400, 'La fecha límite es obligatoria');
    res.status(201).json(await uno(pool,
        `INSERT INTO actividades (entidad, entidad_id, tipo, asignado_a, fecha_limite, nota, creado_por)
         VALUES ($1,$2,$3,$4,$5::date,$6,$7) RETURNING *`,
        [b.entidad, id, b.tipo, b.asignado_a || req.usuario.id, b.fecha_limite, b.nota || null, req.usuario.id]));
}));

router.post('/actividades/:id/hecha', puede('actividades'), ruta(async (req, res) => {
    const a = await uno(pool, 'SELECT * FROM actividades WHERE id = $1', [req.params.id]);
    if (!a) throw new ErrorNegocio(404, 'Actividad no encontrada');
    if (a.asignado_a !== req.usuario.id && req.usuario.rol !== 'admin') {
        throw new ErrorNegocio(403, 'Solo puedes cerrar tus propias actividades');
    }
    const hecha = req.body && req.body.hecha === false ? false : true;
    res.json(await uno(pool,
        `UPDATE actividades SET hecha = $2, fecha_hecha = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = $1 RETURNING *`, [req.params.id, hecha]));
}));

// =====================================================================
//  AUDITORÍA (solo admin)
// =====================================================================
router.get('/auditoria', puede('auditoria'), ruta(async (req, res) => {
    const params = [];
    const w = ['TRUE'];
    if (req.query.usuario_id) { params.push(req.query.usuario_id); w.push(`a.usuario_id = $${params.length}`); }
    if (req.query.entidad) { params.push(req.query.entidad); w.push(`a.entidad = $${params.length}`); }
    if (req.query.accion) { params.push(req.query.accion); w.push(`a.accion = $${params.length}`); }
    if (req.query.desde) { params.push(req.query.desde); w.push(`a.fecha >= $${params.length}::date`); }
    if (req.query.hasta) { params.push(req.query.hasta); w.push(`a.fecha < $${params.length}::date + 1`); }
    res.json(await todos(pool,
        `SELECT a.*, u.nombre AS usuario, u.rol FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
         WHERE ${w.join(' AND ')} ORDER BY a.fecha DESC, a.id DESC LIMIT 500`, params));
}));

// =====================================================================
//  CRM · EMBUDO DE OPORTUNIDADES
// =====================================================================
const ETAPAS_OP = ['nuevo', 'calificado', 'cotizado', 'negociacion', 'ganado', 'perdido'];
const CAMPOS_OP = ['cliente_id', 'prospecto', 'titulo', 'valor_estimado', 'probabilidad',
    'responsable_id', 'fecha_cierre_estimada', 'notas'];

router.get('/oportunidades', puede('embudo'), ruta(async (req, res) => {
    const filas = await todos(pool,
        `SELECT o.*, c.razon_social, u.nombre AS responsable FROM oportunidades o
         LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN usuarios u ON u.id = o.responsable_id
         ORDER BY o.fecha_cierre_estimada NULLS LAST, o.id`);
    const porEtapa = {};
    ETAPAS_OP.forEach((e) => {
        const dela = filas.filter((f) => f.etapa === e);
        porEtapa[e] = { oportunidades: dela, total: dela.reduce((s, f) => s + Number(f.valor_estimado), 0) };
    });
    res.json({ etapas: ETAPAS_OP, por_etapa: porEtapa, total: filas.reduce((s, f) => s + Number(f.valor_estimado), 0) });
}));

router.post('/oportunidades', puede('embudo'), ruta(async (req, res) => {
    const b = req.body || {};
    if (!b.titulo) throw new ErrorNegocio(400, 'El título es obligatorio');
    if (!b.cliente_id && !b.prospecto) throw new ErrorNegocio(400, 'Elige un cliente o escribe el nombre del prospecto');
    res.status(201).json(await insertar(pool, 'oportunidades',
        CAMPOS_OP, { responsable_id: req.usuario.id, ...b }));
}));

router.put('/oportunidades/:id', puede('embudo'), ruta(async (req, res) => {
    res.json(await actualizar(pool, 'oportunidades', req.params.id, CAMPOS_OP, req.body));
}));

/** Mover de columna en el embudo. 'perdido' exige motivo. */
router.post('/oportunidades/:id/etapa', puede('embudo'), ruta(async (req, res) => {
    const b = req.body || {};
    if (!ETAPAS_OP.includes(b.etapa)) throw new ErrorNegocio(400, 'Etapa inválida');
    if (b.etapa === 'perdido' && !(b.motivo_perdida && String(b.motivo_perdida).trim())) {
        throw new ErrorNegocio(400, 'Indica el motivo de la pérdida');
    }
    // $2 se castea a text: sin el cast, Postgres deduce varchar en "etapa = $2"
    // y text en la comparación del CASE, y rechaza la consulta (42P08).
    const o = await uno(pool,
        `UPDATE oportunidades SET etapa = $2::text, motivo_perdida = CASE WHEN $2::text = 'perdido' THEN $3 ELSE NULL END
         WHERE id = $1 RETURNING *`,
        [req.params.id, b.etapa, b.motivo_perdida ? String(b.motivo_perdida).trim() : null]);
    if (!o) throw new ErrorNegocio(404, 'Oportunidad no encontrada');
    res.json(o);
}));

module.exports = router;
