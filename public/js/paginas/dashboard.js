// Tablero general: una vista de las tres áreas.
const COLOR_ESTADO = { disponible: 'verde', renta: 'azul', venta: 'violeta', reparacion: 'naranja', vendido: 'gris', baja: 'gris' };

window.iniciar = async (cont) => {
    const d = await api('/dashboard');
    const flota = d.flota;
    const operativos = ['disponible', 'renta', 'reparacion', 'venta'];
    const totalOp = operativos.reduce((s, k) => s + (flota[k] || 0), 0);
    const abiertos = (d.servicios.abierta || 0) + (d.servicios.en_proceso || 0);

    cont.innerHTML = encabezado('Tablero general', `Resumen al ${fecha(hoy())}`) + `
        <div class="kpis">
            ${kpi('Utilización de flota', `${d.utilizacion}%`, `${flota.renta || 0} de ${totalOp} equipos en renta`)}
            ${kpi('Rentas activas', d.rentas.activas, `${pesos(d.rentas.importe)} contratados`)}
            ${kpi('Rentas por vencer (7 días)', d.rentas_por_vencer.length, '', d.rentas_por_vencer.length ? 'aviso' : '')}
            ${kpi('Órdenes de servicio abiertas', abiertos, `${d.servicios.terminada || 0} terminadas sin facturar`)}
            ${kpi('Cartera por cobrar', pesos(d.cartera.total), `${pesos(d.cartera.vencida)} vencida`, d.cartera.vencida > 0 ? 'alerta' : '')}
            ${kpi('Facturado este mes', pesos(d.mes.facturado), `Cobrado: ${pesos(d.mes.cobrado)}`)}
            ${kpi('Refacciones bajo mínimo', d.bajo_minimo.length, '', d.bajo_minimo.length ? 'aviso' : 'bien')}
        </div>

        <div class="panel">
            <div class="panel-cab"><h2>Flota por estado</h2>${puedeVer('traspasos') ? '<a href="/comercial/traspasos.html">Ir a traspasos</a>' : ''}</div>
            <div class="panel-cuerpo">
                <div class="barras">${operativos.concat(['vendido']).filter((k) => flota[k]).map((k) =>
                    `<span style="--c: var(--${COLOR_ESTADO[k]}); width:${(flota[k] / Object.values(flota).reduce((a, b) => a + b, 0)) * 100}%" title="${etiqueta(k)}: ${flota[k]}"></span>`).join('')}</div>
                <div class="leyenda">${Object.keys(COLOR_ESTADO).filter((k) => flota[k]).map((k) =>
                    `<span><i style="--c: var(--${COLOR_ESTADO[k]})"></i>${etiqueta(k)}: <strong>${flota[k]}</strong></span>`).join('')}</div>
            </div>
        </div>

        <div class="rejilla">
            <div class="panel">
                <div class="panel-cab"><h2>Rentas por vencer</h2>${puedeVer('rentas') ? '<a href="/comercial/rentas.html">Ver rentas</a>' : ''}</div>
                ${tabla({
                    vacio: 'Ninguna renta vence en los próximos 7 días',
                    columnas: [
                        { t: 'Folio', r: (r) => `<strong>${esc(r.folio)}</strong>` },
                        { t: 'Cliente', k: 'razon_social' },
                        { t: 'Equipo', k: 'numero_economico' },
                        { t: 'Vence', r: (r) => `${fecha(r.fecha_fin)}<div class="sub">${r.dias < 0 ? `vencida hace ${-r.dias} d` : r.dias === 0 ? 'hoy' : `en ${r.dias} d`}</div>` },
                    ],
                    filas: d.rentas_por_vencer,
                })}
            </div>
            <div class="panel">
                <div class="panel-cab"><h2>Refacciones bajo mínimo</h2>${puedeVer('maxmin') ? '<a href="/almacen/maximos-minimos.html">Máximos y mínimos</a>' : ''}</div>
                ${tabla({
                    vacio: 'Todo el inventario está en rango',
                    columnas: [
                        { t: 'Refacción', r: (p) => `${esc(p.nombre)}<div class="sub">${esc(p.sku)}</div>` },
                        { t: 'Stock', num: true, r: (p) => `<strong style="color:var(--rojo)">${p.stock}</strong>` },
                        { t: 'Mín / Máx', num: true, r: (p) => `${p.minimo} / ${p.maximo}` },
                    ],
                    filas: d.bajo_minimo,
                })}
            </div>
            <div class="panel">
                <div class="panel-cab"><h2>Clientes con más facturación</h2></div>
                ${tabla({
                    vacio: 'Aún no hay facturas',
                    columnas: [{ t: 'Cliente', k: 'razon_social' }, { t: 'Facturado', num: true, r: (c) => dinero(c.total) }],
                    filas: d.top_clientes,
                })}
            </div>
        </div>`;
};
