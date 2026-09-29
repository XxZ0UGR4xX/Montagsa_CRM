// db.config.js
// Cambia estos valores según tu instalación local de PostgreSQL.
// También se pueden definir con variables de entorno (PGUSER, PGPASSWORD, etc.).
module.exports = {
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'montagsa',
    password: process.env.PGPASSWORD || '12345678',   // <-- cambia esto por tu contraseña
    port: Number(process.env.PGPORT || 5432),
};
