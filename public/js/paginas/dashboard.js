// Tablero general: los KPIs que ve cada quien dependen de su rol (los arma el backend).
const COLOR_ESTADO = { disponible: 'verde', renta: 'azul', venta: 'violeta', reparacion: 'naranja', vendido: 'gris', baja: 'gris' };

window.iniciar = async (cont) => {
    const d = await api('/dashboard');
    const kpis = [];
    let paneles = '';

    // --- Almacén ---------------------------------------------------------
    if (d.flota) {
        const operativos = ['disponible', 'renta', 'reparacion', 'venta'];
        const totalOp = operativos.reduce((s, k) => s + (d.flota[k] || 0), 0);
        kpis.push(kpi('Utilización de flota', `${d.utilizacion}%`, `${d.flota.renta || 0} de ${totalOp} equipos en renta`));
        kpis.push(kpi('Refacciones bajo mínimo', d.bajo_minimo.length, '', d.bajo_minimo.length ? 'aviso' : 'bien'));
        if (d.requisiciones_pendientes != null) {
            kpis.push(kpi('Requisiciones pendientes', d.requisiciones_pendientes, '', d.requisiciones_pendientes ? 'aviso' : ''));
        }
        const totalFlota = Object.values(d.flota).reduce((a, b) => a + b, 0);
        paneles += `
        <div class="panel">
            <div class="panel-cab"><h2>Flota por estado</h2>${puedeVer('traspasos') ? '<a href="/comercial/traspasos.html">Ir a traspasos</a>' : ''}</div>
            <div class="panel-cuerpo">
                <div class="barras">${operativos.concat(['vendido']).filter((k) => d.flota[k]).map((k) =>
                    `<span style="--c: var(--${COLOR_ESTADO[k]}); width:${(d.flota[k] / totalFlota) * 100}%" title="${etiqueta(k)}: ${d.flota[k]}"></span>`).join('')}</div>
                <div class="leyenda">${Object.keys(COLOR_ESTADO).filter((k) => d.flota[k]).map((k) =>
                    `<span><i style="--c: var(--${COLOR_ESTADO[k]})"></i>${etiqueta(k)}: <strong>${d.flota[k]}</strong></span>`).join('')}</div>
            </div>
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
        </div>`;
    }

    // --- Comercial ---------------------------------------------------------
    if (d.rentas) {
        kpis.push(kpi('Rentas activas', d.rentas.activas, `${pesos(d.rentas.importe)} contratados`));
        kpis.push(kpi('Rentas por vencer (7 días)', d.rentas_por_vencer.length, '', d.rentas_por_vencer.length ? 'aviso' : ''));
        kpis.push(kpi('Cartera por cobrar', pesos(d.cartera.total), `${pesos(d.cartera.vencida)} vencida`, d.cartera.vencida > 0 ? 'alerta' : ''));
        kpis.push(kpi('Facturado este mes', pesos(d.mes.facturado), `Cobrado: ${pesos(d.mes.cobrado)}`));
        kpis.push(kpi('Cotizaciones por autorizar', d.cotizaciones_pendientes, '', d.cotizaciones_pendientes ? 'aviso' : ''));
        paneles += `
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
            <div class="panel-cab"><h2>Clientes con más facturación</h2></div>
            ${tabla({
                vacio: 'Aún no hay facturas',
                columnas: [{ t: 'Cliente', k: 'razon_social' }, { t: 'Facturado', num: true, r: (c) => dinero(c.total) }],
                filas: d.top_clientes,
            })}
        </div>`;
    }

    // --- Producción ---------------------------------------------------------
    if (d.ot_abiertas) {
        const total = d.ot_abiertas.reduce((s, r) => s + r.n, 0);
        const enEjecucion = d.ot_abiertas.filter((r) => r.estado === 'en_ejecucion').reduce((s, r) => s + r.n, 0);
        kpis.push(kpi('Órdenes de trabajo abiertas', total, `${enEjecucion} en ejecución`));
        kpis.push(kpi('Preventivos vencidos', d.preventivos.vencidos, `${d.preventivos.proximos} próximos`, d.preventivos.vencidos ? 'alerta' : 'bien'));
        kpis.push(kpi('Rondas pendientes', d.rondas_pendientes, 'Equipos en renta sin visita en 7 días', d.rondas_pendientes ? 'aviso' : 'bien'));
        kpis.push(kpi('Maniobras pendientes', d.maniobras_pendientes));
        paneles += `
        <div class="panel">
            <div class="panel-cab"><h2>Órdenes de trabajo abiertas</h2>${puedeVer('ordenes_trabajo') ? '<a href="/produccion/ordenes-trabajo.html">Ver órdenes</a>' : ''}</div>
            ${tabla({
                vacio: 'No hay órdenes abiertas',
                columnas: [
                    { t: 'Tipo', r: (r) => esc({ servicio: 'Servicio', maniobra: 'Maniobra', refaccion: 'Refacciones' }[r.tipo] || r.tipo) },
                    { t: 'Estado', r: (r) => tag(r.estado) },
                    { t: 'Cantidad', num: true, k: 'n' },
                ],
                filas: d.ot_abiertas,
            })}
        </div>`;
    }

    // --- Administración ---------------------------------------------------------
    if (d.compras_pendientes != null) {
        kpis.push(kpi('Compras pendientes', d.compras_pendientes, '', d.compras_pendientes ? 'aviso' : ''));
        kpis.push(kpi('Por pagar a proveedores', pesos(d.por_pagar_proveedores)));
        kpis.push(kpi('Balanza de comprobación', d.balanza_cuadra ? 'Cuadra' : 'No cuadra', '', d.balanza_cuadra ? 'bien' : 'alerta'));
        if (d.ultima_nomina) kpis.push(kpi('Última nómina', d.ultima_nomina.referencia.replace('NOM-', ''), fecha(d.ultima_nomina.fecha)));
    }

    cont.innerHTML = encabezado('Tablero general', `Resumen al ${fecha(hoy())}`)
        + `<div class="kpis">${kpis.join('')}</div>`
        + (paneles ? `<div class="rejilla">${paneles}</div>` : '');
};
