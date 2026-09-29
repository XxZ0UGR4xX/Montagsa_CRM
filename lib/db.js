// lib/db.js — Pool de PostgreSQL, transacciones y errores de negocio
const { Pool, types } = require('pg');
const config = require('../db.config');

// NUMERIC llega como texto desde pg; lo convertimos a número para el front.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// DATE se deja como texto 'YYYY-MM-DD' (sin corrimientos de zona horaria).
types.setTypeParser(1082, (v) => v);

const pool = new Pool(config);

/** Error con código HTTP que el manejador global devuelve tal cual. */
class ErrorNegocio extends Error {
    constructor(status, mensaje) {
        super(mensaje);
        this.status = status;
    }
}

/** Ejecuta fn(client) dentro de BEGIN/COMMIT; hace ROLLBACK si algo falla. */
async function tx(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r = await fn(client);
        await client.query('COMMIT');
        return r;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function uno(db, sql, params = []) {
    const { rows } = await db.query(sql, params);
    return rows[0] || null;
}

async function todos(db, sql, params = []) {
    const { rows } = await db.query(sql, params);
    return rows;
}

/** Envuelve un handler async para que los errores lleguen al middleware global. */
const ruta = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = { pool, tx, uno, todos, ruta, ErrorNegocio, redondear };
