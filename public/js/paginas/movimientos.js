// Almacén · Kardex de movimientos de inventario.
window.iniciar = async (cont) => {
    const filas = await api('/movimientos');
    cont.innerHTML = encabezado('Movimientos de inventario', 'Entradas, salidas y ajustes con su referencia (compra, servicio o manual).') +
        `<div class="panel">${tabla({
            vacio: 'Sin movimientos',
            columnas: [
                { t: 'Fecha', r: (m) => fecha(m.fecha) },
                { t: 'Refacción', r: (m) => `${esc(m.nombre)}<div class="sub">${esc(m.sku)}</div>` },
                { t: 'Tipo', r: (m) => tag(m.tipo === 'entrada' ? 'recibida' : m.tipo === 'salida' ? 'pendiente' : 'borrador', m.tipo[0].toUpperCase() + m.tipo.slice(1)) },
                { t: 'Cantidad', num: true, r: (m) => `${m.tipo === 'salida' ? '−' : m.cantidad > 0 ? '+' : ''}${m.cantidad}` },
                { t: 'Stock final', num: true, k: 'stock_resultante' },
                { t: 'Referencia', r: (m) => `<strong>${esc(m.referencia || '—')}</strong>` },
                { t: 'Motivo', k: 'motivo' },
                { t: 'Usuario', r: (m) => `<span class="tenue">${esc(m.usuario || '—')}</span>` },
            ],
            filas,
        })}</div>`;
};
