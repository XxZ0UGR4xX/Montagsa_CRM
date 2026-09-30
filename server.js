// server.js — Montagsa · CRM + ERP + SCM
// Renta, venta y servicio de montacargas.
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, ErrorNegocio } = require('./lib/db');
const { requireAuth } = require('./lib/auth');
const config = require('./db.config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || `http://localhost:${PORT}` }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------- API
app.get('/api/salud', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true, bd: 'conectada' });
    } catch (e) {
        res.status(503).json({ ok: false, bd: 'sin conexión' });
    }
});

const comun = require('./routes/comun');
app.use('/api', comun.router);                                     // /auth/*, /usuarios, /catalogos
app.use('/api', requireAuth, require('./routes/crm-almacen'));     // CRM + Almacén
app.use('/api', requireAuth, require('./routes/comercial'));       // Comercial
app.use('/api', requireAuth, require('./routes/administracion'));  // Administración + Dashboard
app.use('/api', requireAuth, require('./routes/produccion'));      // Producción

app.use('/api', (req, res) => res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` }));

// ---------------------------------------------------------------- Errores
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err instanceof ErrorNegocio) return res.status(err.status).json({ error: err.message });
    // Errores de PostgreSQL más comunes, en español
    const pg = {
        '23505': [409, 'Ya existe un registro con ese valor (duplicado)'],
        '23503': [409, 'El registro está relacionado con otros datos'],
        '23514': [400, 'Algún valor no cumple las reglas (revisa los campos)'],
        '22P02': [400, 'Formato de dato inválido'],
    }[err.code];
    if (pg) return res.status(pg[0]).json({ error: pg[1], detalle: err.detail || err.constraint });
    console.error(`${req.method} ${req.originalUrl} ->`, err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// ---------------------------------------------------------------- Arranque
app.listen(PORT, async () => {
    console.log(`Montagsa escuchando en http://localhost:${PORT}`);
    try {
        const r = await pool.query('SELECT COUNT(*)::int AS n FROM equipos');
        console.log(`Base de datos: conectada (${config.database}@${config.host}:${config.port}) - ${r.rows[0].n} equipos`);
    } catch (e) {
        if (e.code === '42P01') console.log('Base de datos: conectada pero SIN TABLAS. Ejecuta db/database.sql');
        else console.log(`Base de datos: SIN CONEXION (${e.message}). Revisa PostgreSQL y db.config.js`);
    }
});
