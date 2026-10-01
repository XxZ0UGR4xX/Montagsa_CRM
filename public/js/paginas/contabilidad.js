// Administración · Contabilidad: catálogo de cuentas, pólizas (partida doble) y reportes.
// Casi todas las pólizas se generan solas desde facturas, pagos, compras, servicios y nómina.
// Administración solo lee reportes y captura pólizas manuales; el resto (catálogo, cancelar
// pólizas, depreciación) es exclusivo de Contabilidad/admin — igual que lo valida el backend.
const TIPOS_CTA = { activo: 'Activo', pasivo: 'Pasivo', capital: 'Capital', ingreso: 'Ingreso', costo: 'Costo', gasto: 'Gasto' };
const TABS = [
    ['polizas', 'Pólizas'], ['balanza', 'Balanza de comprobación'], ['mayor', 'Libro mayor'],
    ['resultados', 'Estado de resultados'], ['balance', 'Balance general'], ['iva', 'IVA del mes'],
    ['cuentas', 'Catálogo de cuentas'],
];
const esContabilidad = () => ['admin', 'contabilidad'].includes(window.USUARIO.rol);
let pestana = 'polizas';
let cuentasCache = [];

window.iniciar = async (cont) => {
    const ini = new Date(); ini.setDate(1);
    cuentasCache = await api('/contabilidad/cuentas');
    cont.innerHTML = encabezado('Contabilidad', 'Pólizas automáticas y manuales, catálogo de cuentas y reportes contables.',
        `${esContabilidad() ? '<button class="btn" type="button" id="btn-dep">Calcular depreciación del mes</button>' : ''}
         <button class="btn btn-primario" type="button" id="btn-poliza">Póliza manual</button>`) + `
        <div class="filtros" style="margin-bottom:14px">
            <span id="grupo-fecha"><label class="tenue" for="desde">Desde</label><input type="date" id="desde" value="${new Date(ini.getFullYear(), 0, 1).toISOString().slice(0, 10)}">
            <label class="tenue" for="hasta">Hasta</label><input type="date" id="hasta" value="${hoy()}"></span>
            <span id="f-polizas" style="display:none">
                <label class="tenue" for="f-tipo">Tipo</label><select id="f-tipo"><option value="">Todos</option><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option><option value="diario">Diario</option></select>
                <label class="tenue" for="f-ref">Referencia</label><input type="search" id="f-ref" placeholder="p. ej. OC-1003">
            </span>
            <span id="f-mayor" style="display:none">
                <label class="tenue" for="f-cuenta">Cuenta</label><select id="f-cuenta">${cuentasCache.map((c) => `<option value="${c.codigo}">${c.codigo} ${esc(c.nombre)}</option>`).join('')}</select>
            </span>
            <span id="f-iva" style="display:none"><label class="tenue" for="f-periodo">Periodo</label><input type="month" id="f-periodo" value="${hoy().slice(0, 7)}"></span>
        </div>
        <div class="pestanas" role="tablist">${TABS.map(([v, t], i) => `<button type="button" class="${i === 0 ? 'activa' : ''}" data-p="${v}">${t}</button>`).join('')}</div>
        <div class="panel" id="panel"></div>`;
    cont.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => { pestana = b.dataset.p; cont.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b)); pintar(); };
    });
    ['desde', 'hasta', 'f-tipo', 'f-cuenta', 'f-periodo'].forEach((id) => document.getElementById(id).addEventListener('change', pintar));
    document.getElementById('f-ref').addEventListener('input', pintar);
    document.getElementById('btn-poliza').onclick = polizaManual;
    if (esContabilidad()) document.getElementById('btn-dep').onclick = depreciacion;
    await pintar();
};

function actualizarFiltros() {
    const mostrar = (id, cond) => { document.getElementById(id).style.display = cond ? '' : 'none'; };
    mostrar('grupo-fecha', !['iva', 'cuentas'].includes(pestana));
    mostrar('f-polizas', pestana === 'polizas');
    mostrar('f-mayor', pestana === 'mayor');
    mostrar('f-iva', pestana === 'iva');
}

async function pintar() {
    actualizarFiltros();
    const panel = document.getElementById('panel');
    const desde = document.getElementById('desde').value;
    const hasta = document.getElementById('hasta').value;

    if (pestana === 'polizas') {
        const qs = new URLSearchParams({ desde, hasta });
        const tipo = document.getElementById('f-tipo').value;
        const ref = document.getElementById('f-ref').value.trim();
        if (tipo) qs.set('tipo', tipo);
        if (ref) qs.set('referencia', ref);
        const pol = await api(`/contabilidad/polizas?${qs}`);
        panel.innerHTML = (pol.length ? pol.map((p) => `
            <details style="border-bottom:1px solid var(--linea)">
                <summary style="padding:10px 16px;cursor:pointer;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
                    <strong>${esc(p.folio)}</strong><span>${fecha(p.fecha)}</span>${tag(p.tipo === 'ingreso' ? 'pagada' : p.tipo === 'egreso' ? 'pendiente' : 'borrador', p.tipo)}
                    ${p.cancelada ? tag('cancelada') : ''}
                    <span style="flex:1">${esc(p.concepto)}</span><span class="tenue">${esc(p.referencia || '')}${p.automatica ? '' : ' · manual'}</span><strong class="num">${dinero(p.total)}</strong>
                    ${!p.automatica && !p.cancelada && esContabilidad() ? `<button class="btn btn-chico btn-peligro" type="button" data-cancelar="${p.id}">Cancelar</button>` : ''}
                </summary>
                <div style="padding:0 16px 12px">${tabla({ filas: p.movimientos, columnas: [
                    { t: 'Cuenta', r: (m) => `${esc(m.codigo)} ${esc(m.nombre)}` },
                    { t: 'Cargo', num: true, r: (m) => (m.cargo ? dinero(m.cargo) : '') },
                    { t: 'Abono', num: true, r: (m) => (m.abono ? dinero(m.abono) : '') }] })}</div>
            </details>`).join('') : '<div class="vacio">Sin pólizas en el periodo</div>')
            + (pol.length ? '<div style="padding:12px 16px"><button class="btn btn-chico" type="button" id="btn-csv-pol">Exportar CSV</button></div>' : '');
        if (pol.length) {
            document.getElementById('btn-csv-pol').onclick = () => exportarCSV('polizas', [
                { t: 'Folio', k: 'folio' }, { t: 'Fecha', k: 'fecha' }, { t: 'Tipo', k: 'tipo' }, { t: 'Concepto', k: 'concepto' },
                { t: 'Referencia', k: 'referencia' }, { t: 'Total', k: 'total' }], pol);
        }
        panel.querySelectorAll('button[data-cancelar]').forEach((b) => {
            b.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                if (!(await confirmar('¿Cancelar esta póliza? Se generará una póliza de reversa; no se borra.', 'Cancelar'))) return;
                try {
                    await api(`/contabilidad/polizas/${b.dataset.cancelar}/cancelar`, { method: 'POST' });
                    aviso('Póliza cancelada con su reversa', 'ok');
                    await pintar();
                } catch (err) { avisoError(err); }
            };
        });
    } else if (pestana === 'balanza') {
        const b = await api(`/contabilidad/balanza?desde=${desde}&hasta=${hasta}`);
        const filas = b.filas.filter((f) => f.cargos || f.abonos);
        panel.innerHTML = tabla({
            filas, vacio: 'Sin movimientos en el periodo',
            columnas: [
                { t: 'Cuenta', r: (f) => `<strong>${esc(f.codigo)}</strong> ${esc(f.nombre)}` },
                { t: 'Tipo', r: (f) => esc(TIPOS_CTA[f.tipo]) },
                { t: 'Cargos', num: true, r: (f) => dinero(f.cargos) },
                { t: 'Abonos', num: true, r: (f) => dinero(f.abonos) },
                { t: 'Saldo', num: true, r: (f) => `<strong>${dinero(f.saldo)}</strong>` },
            ],
            pie: `<td colspan="2">${b.cuadra ? 'Sumas iguales: la balanza cuadra' : 'La balanza NO cuadra'}</td><td class="num">${dinero(b.totales.cargos)}</td><td class="num">${dinero(b.totales.abonos)}</td><td></td>`,
        }) + '<div style="padding:12px 0"><button class="btn btn-chico" type="button" id="btn-csv-bza">Exportar CSV</button></div>';
        document.getElementById('btn-csv-bza').onclick = () => exportarCSV('balanza', [
            { t: 'Código', k: 'codigo' }, { t: 'Cuenta', k: 'nombre' }, { t: 'Tipo', k: 'tipo' },
            { t: 'Cargos', k: 'cargos' }, { t: 'Abonos', k: 'abonos' }, { t: 'Saldo', k: 'saldo' }], filas);
    } else if (pestana === 'mayor') {
        const cuentaCod = document.getElementById('f-cuenta').value;
        const r = await api(`/contabilidad/mayor?cuenta=${cuentaCod}&desde=${desde}&hasta=${hasta}`);
        const filas = [{ inicial: true, folio: 'Saldo inicial', saldo: r.saldo_inicial }, ...r.movimientos];
        panel.innerHTML = `<h3 style="margin:4px 16px 10px">${esc(r.cuenta.codigo)} ${esc(r.cuenta.nombre)}</h3>` + tabla({
            filas, vacio: 'Sin movimientos en el periodo',
            columnas: [
                { t: 'Fecha', r: (m) => (m.fecha ? fecha(m.fecha) : '—') },
                { t: 'Póliza', r: (m) => esc(m.folio) },
                { t: 'Concepto', r: (m) => esc(m.concepto || '') },
                { t: 'Referencia', r: (m) => esc(m.referencia || '') },
                { t: 'Cargo', num: true, r: (m) => (m.cargo ? dinero(m.cargo) : '') },
                { t: 'Abono', num: true, r: (m) => (m.abono ? dinero(m.abono) : '') },
                { t: 'Saldo', num: true, r: (m) => `<strong>${dinero(m.saldo)}</strong>` },
            ],
            pie: `<td colspan="6">Saldo final</td><td class="num"><strong>${dinero(r.saldo_final)}</strong></td>`,
        }) + '<div style="padding:12px 0"><button class="btn btn-chico" type="button" id="btn-csv-mayor">Exportar CSV</button></div>';
        document.getElementById('btn-csv-mayor').onclick = () => exportarCSV(`mayor-${cuentaCod}`, [
            { t: 'Fecha', k: 'fecha' }, { t: 'Póliza', k: 'folio' }, { t: 'Concepto', k: 'concepto' },
            { t: 'Cargo', k: 'cargo' }, { t: 'Abono', k: 'abono' }, { t: 'Saldo', k: 'saldo' }], filas);
    } else if (pestana === 'resultados') {
        const r = await api(`/contabilidad/resultados?desde=${desde}&hasta=${hasta}`);
        const linea = (t, v, fuerte) => `<tr><td>${fuerte ? `<strong>${t}</strong>` : t}</td><td class="num">${fuerte ? `<strong>${dinero(v)}</strong>` : dinero(v)}</td></tr>`;
        const det = (tipo) => r.detalle.filter((d) => d.tipo === tipo).map((d) => `<tr><td style="padding-left:28px" class="tenue">${esc(d.codigo)} ${esc(d.nombre)}</td><td class="num tenue">${dinero(d.importe)}</td></tr>`).join('');
        panel.innerHTML = `<div class="tabla-caja"><table style="max-width:640px">
            ${linea('Ingresos', r.ingresos, true)}${det('ingreso')}
            ${linea('Costos', r.costos, true)}${det('costo')}
            ${linea('Utilidad bruta', r.utilidad_bruta, true)}
            ${linea('Gastos de operación', r.gastos, true)}${det('gasto')}
            <tr><td><strong>Utilidad neta</strong></td><td class="num"><strong style="color:${r.utilidad_neta >= 0 ? 'var(--verde)' : 'var(--rojo)'}">${dinero(r.utilidad_neta)}</strong></td></tr>
        </table></div><div style="padding:12px 0"><button class="btn btn-chico" type="button" id="btn-csv-res">Exportar CSV</button></div>`;
        document.getElementById('btn-csv-res').onclick = () => exportarCSV('estado-de-resultados', [
            { t: 'Tipo', k: 'tipo' }, { t: 'Cuenta', k: 'nombre' }, { t: 'Importe', k: 'importe' }], r.detalle);
    } else if (pestana === 'balance') {
        const b = await api(`/contabilidad/balance?hasta=${hasta || hoy()}`);
        const grupo = (tipo, titulo, total) => {
            const filas = b.detalle.filter((f) => f.tipo === tipo && (f.cargos || f.abonos));
            return `<h4 style="margin:16px 0 6px">${titulo}</h4>${filas.length ? tabla({ filas, columnas: [
                { t: 'Cuenta', r: (f) => `${esc(f.codigo)} ${esc(f.nombre)}` }, { t: 'Saldo', num: true, r: (f) => dinero(f.saldo) }] })
                : '<div class="vacio">Sin saldo</div>'}<p class="tenue" style="padding:0 16px">Total: <strong>${dinero(total)}</strong></p>`;
        };
        panel.innerHTML = `<div style="padding:12px 16px 0">
            ${grupo('activo', 'Activo', b.activo)}
            ${grupo('pasivo', 'Pasivo', b.pasivo)}
            ${grupo('capital', 'Capital', b.capital)}
            <p>Resultado del ejercicio (acumulado): <strong style="color:${b.resultado_ejercicio >= 0 ? 'var(--verde)' : 'var(--rojo)'}">${dinero(b.resultado_ejercicio)}</strong></p>
            <p class="tenue">Pasivo + Capital + Resultado: <strong>${dinero(b.pasivo_mas_capital)}</strong></p>
            <p style="margin-top:10px"><strong>${b.cuadra ? 'El balance cuadra: Activo = Pasivo + Capital + Resultado' : 'El balance NO cuadra'}</strong></p>
            <button class="btn btn-chico" type="button" id="btn-csv-gral" style="margin:8px 0 16px">Exportar CSV</button>
        </div>`;
        document.getElementById('btn-csv-gral').onclick = () => exportarCSV('balance-general', [
            { t: 'Tipo', k: 'tipo' }, { t: 'Cuenta', k: 'nombre' }, { t: 'Saldo', k: 'saldo' }], b.detalle);
    } else if (pestana === 'iva') {
        const periodo = document.getElementById('f-periodo').value || hoy().slice(0, 7);
        const r = await api(`/contabilidad/iva-mes?periodo=${periodo}`);
        panel.innerHTML = `<div class="kpis" style="padding:16px">
            ${kpi('IVA trasladado cobrado', pesos(r.iva_trasladado_cobrado))}
            ${kpi('IVA acreditable', pesos(r.iva_acreditable))}
            ${kpi(r.resultado >= 0 ? 'IVA a pagar' : 'IVA a favor', pesos(Math.abs(r.resultado)), '', r.resultado >= 0 ? 'alerta' : 'bien')}
        </div>`;
    } else {
        cuentasCache = await api('/contabilidad/cuentas');
        panel.innerHTML = (esContabilidad() ? '<div style="padding:12px 16px"><button class="btn btn-chico btn-primario" type="button" id="btn-nueva-cuenta">Nueva cuenta</button></div>' : '')
            + tabla({
                filas: cuentasCache, vacio: 'Sin cuentas',
                columnas: [
                    { t: 'Código', r: (x) => (x.nivel > 1 ? `<span class="tenue">↳</span> ${esc(x.codigo)}` : `<strong>${esc(x.codigo)}</strong>`) },
                    { t: 'Cuenta', k: 'nombre' },
                    { t: 'Tipo', r: (x) => esc(TIPOS_CTA[x.tipo]) },
                    { t: 'Naturaleza', r: (x) => (x.naturaleza === 'deudora' ? 'Deudora' : 'Acreedora') },
                    { t: 'Agrupador SAT', r: (x) => esc(x.codigo_agrupador_sat || '—') },
                    { t: 'Estado', r: (x) => (x.activa ? tag('activo') : tag('inactivo')) },
                    { t: '', clase: 'acciones', r: (x) => (esContabilidad() ? `<button class="btn btn-chico" type="button" data-editar="${x.id}">Editar</button>` : '') },
                ],
            });
        if (esContabilidad()) {
            document.getElementById('btn-nueva-cuenta').onclick = () => editarCuenta(null);
            panel.querySelectorAll('button[data-editar]').forEach((b) => {
                b.onclick = () => editarCuenta(cuentasCache.find((x) => String(x.id) === b.dataset.editar));
            });
        }
    }
}

function editarCuenta(cta) {
    const campos = [
        { k: 'codigo', etiqueta: 'Código', requerido: true },
        { k: 'nombre', etiqueta: 'Nombre', requerido: true, ancho: true },
        { k: 'tipo', etiqueta: 'Tipo', tipo: 'select', vacio: false, requerido: true, opciones: Object.entries(TIPOS_CTA) },
        { k: 'naturaleza', etiqueta: 'Naturaleza', tipo: 'select', vacio: false, requerido: true, opciones: [['deudora', 'Deudora'], ['acreedora', 'Acreedora']] },
        { k: 'padre_id', etiqueta: 'Cuenta de mayor (si es subcuenta)', tipo: 'select', opciones: opciones(cuentasCache.filter((x) => !cta || x.id !== cta.id), 'id', (x) => `${x.codigo} ${x.nombre}`) },
        { k: 'nivel', etiqueta: 'Nivel', tipo: 'number', defecto: 1 },
        { k: 'codigo_agrupador_sat', etiqueta: 'Código agrupador SAT' },
        { k: 'activa', etiqueta: 'Activa', tipo: 'checkbox', defecto: true },
    ];
    modal({
        titulo: cta ? `Editar cuenta ${cta.codigo}` : 'Nueva cuenta', ancho: 640,
        cuerpo: formulario(campos, cta || { nivel: 1, activa: true }),
        acciones: [
            { texto: 'Cancelar' },
            ...(cta && !cta.con_movimientos ? [{ texto: 'Eliminar', clase: 'btn-peligro', onClick: async () => {
                if (!(await confirmar(`¿Eliminar la cuenta ${cta.codigo}? Esta acción no se puede deshacer.`, 'Eliminar'))) return false;
                await api(`/contabilidad/cuentas/${cta.id}`, { method: 'DELETE' });
                aviso('Cuenta eliminada', 'ok');
                await pintar();
            } }] : []),
            { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
                const datos = leerFormulario(m, campos);
                await api(cta ? `/contabilidad/cuentas/${cta.id}` : '/contabilidad/cuentas', { method: cta ? 'PUT' : 'POST', body: datos });
                aviso('Cuenta guardada', 'ok');
                await pintar();
            } },
        ],
    });
}

function depreciacion() {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const campos = [{ k: 'periodo', etiqueta: 'Periodo a depreciar', tipo: 'month', requerido: true, defecto: d.toISOString().slice(0, 7) }];
    modal({
        titulo: 'Calcular depreciación del mes',
        cuerpo: '<p class="tenue" style="margin-bottom:14px">Depreciación en línea recta de toda la flota activa (no vendida ni de baja). Una sola póliza por mes (referencia DEP-AAAA-MM).</p>' + formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Calcular', clase: 'btn-primario', onClick: async (m) => {
            const r = await api('/contabilidad/depreciacion', { method: 'POST', body: leerFormulario(m, campos) });
            aviso(`Depreciación registrada: ${dinero(r.total)} (${r.detalle.length} equipos)`, 'ok');
            await pintar();
        } }],
    });
}

async function polizaManual() {
    const cuentas = await api('/contabilidad/cuentas');
    const m = modal({
        titulo: 'Póliza manual', ancho: 820,
        cuerpo: `<div class="form">
                <div class="campo"><label for="p-tipo">Tipo</label><select id="p-tipo"><option value="egreso">Egreso</option><option value="ingreso">Ingreso</option><option value="diario">Diario</option></select></div>
                <div class="campo"><label for="p-fecha">Fecha</label><input id="p-fecha" type="date" value="${hoy()}"></div>
                <div class="campo ancho"><label for="p-concepto">Concepto *</label><input id="p-concepto" placeholder="p. ej. Pago de renta de la nave"></div>
                <div class="campo ancho"><label for="p-ref">Referencia</label><input id="p-ref"></div>
            </div>
            <h4 style="margin:16px 0 8px">Movimientos</h4><div id="movs"></div>
            <button class="btn btn-chico" type="button" id="mas" style="margin-top:8px">Agregar movimiento</button>
            <div class="aviso-caja" id="tot" style="margin-top:14px"></div>`,
        acciones: [{ texto: 'Cancelar' }, { texto: 'Registrar póliza', clase: 'btn-primario', onClick: async (el) => {
            const concepto = el.querySelector('#p-concepto').value.trim();
            if (!concepto) throw new Error('Escribe el concepto');
            const movimientos = [...el.querySelectorAll('.mov')].map((r) => ({
                codigo: r.querySelector('.m-cta').value, cargo: Number(r.querySelector('.m-cargo').value) || 0, abono: Number(r.querySelector('.m-abono').value) || 0,
            })).filter((x) => x.codigo && (x.cargo || x.abono));
            const p = await api('/contabilidad/polizas', { method: 'POST', body: {
                tipo: el.querySelector('#p-tipo').value, fecha: el.querySelector('#p-fecha').value, concepto, referencia: el.querySelector('#p-ref').value, movimientos } });
            aviso(`Póliza ${p.folio} registrada`, 'ok');
            await pintar();
        } }],
    });
    const cont = m.el.querySelector('#movs');
    const total = () => {
        let c = 0; let a = 0;
        cont.querySelectorAll('.mov').forEach((r) => { c += Number(r.querySelector('.m-cargo').value) || 0; a += Number(r.querySelector('.m-abono').value) || 0; });
        const cuadra = Math.abs(c - a) < 0.01 && c > 0;
        m.el.querySelector('#tot').innerHTML = `Cargos <strong>${dinero(c)}</strong> · Abonos <strong>${dinero(a)}</strong> · ${cuadra ? 'Cuadra' : `<span style="color:var(--rojo)">Diferencia ${dinero(c - a)}</span>`}`;
    };
    const fila = () => {
        const d = document.createElement('div');
        d.className = 'mov form';
        d.style.cssText = 'grid-template-columns: 3fr 1.2fr 1.2fr auto; margin-bottom:8px; align-items:end';
        d.innerHTML = `<div class="campo"><label>Cuenta</label><select class="m-cta"><option value="">— Cuenta —</option>${cuentas.map((c) => `<option value="${c.codigo}">${c.codigo} ${esc(c.nombre)}</option>`).join('')}</select></div>
            <div class="campo"><label>Cargo</label><input class="m-cargo" type="number" min="0" step="0.01"></div>
            <div class="campo"><label>Abono</label><input class="m-abono" type="number" min="0" step="0.01"></div>
            <button class="btn btn-chico btn-peligro" type="button">Quitar</button>`;
        d.querySelector('button').onclick = () => { d.remove(); total(); };
        d.addEventListener('input', total);
        cont.appendChild(d);
        total();
    };
    m.el.querySelector('#mas').onclick = fila;
    fila(); fila();
}
