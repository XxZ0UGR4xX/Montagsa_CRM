// Administración · Contabilidad: pólizas (partida doble), balanza y estado de resultados.
// Casi todas las pólizas se generan solas desde facturas, pagos, compras, servicios y nómina.
const TIPOS_CTA = { activo: 'Activo', pasivo: 'Pasivo', capital: 'Capital', ingreso: 'Ingreso', costo: 'Costo', gasto: 'Gasto' };
let pestana = 'polizas';

window.iniciar = async (cont) => {
    const ini = new Date(); ini.setDate(1);
    cont.innerHTML = encabezado('Contabilidad', 'Pólizas automáticas y manuales, balanza de comprobación y estado de resultados.',
        '<button class="btn btn-primario" type="button" id="btn-poliza">Póliza manual</button>') + `
        <div class="filtros" style="margin-bottom:14px">
            <label class="tenue" for="desde">Desde</label><input type="date" id="desde" value="${new Date(ini.getFullYear(), 0, 1).toISOString().slice(0, 10)}">
            <label class="tenue" for="hasta">Hasta</label><input type="date" id="hasta" value="${hoy()}">
        </div>
        <div class="pestanas" role="tablist">
            <button type="button" class="activa" data-p="polizas">Pólizas</button>
            <button type="button" data-p="balanza">Balanza de comprobación</button>
            <button type="button" data-p="resultados">Estado de resultados</button>
            <button type="button" data-p="cuentas">Catálogo de cuentas</button>
        </div>
        <div class="panel" id="panel"></div>`;
    cont.querySelectorAll('.pestanas button').forEach((b) => {
        b.onclick = () => { pestana = b.dataset.p; cont.querySelectorAll('.pestanas button').forEach((x) => x.classList.toggle('activa', x === b)); pintar(); };
    });
    ['desde', 'hasta'].forEach((id) => document.getElementById(id).addEventListener('change', pintar));
    document.getElementById('btn-poliza').onclick = polizaManual;
    await pintar();
};

const rango = () => `?desde=${document.getElementById('desde').value}&hasta=${document.getElementById('hasta').value}`;

async function pintar() {
    const panel = document.getElementById('panel');
    if (pestana === 'polizas') {
        const pol = await api(`/contabilidad/polizas${rango()}`);
        panel.innerHTML = pol.length ? pol.map((p) => `
            <details style="border-bottom:1px solid var(--linea)">
                <summary style="padding:10px 16px;cursor:pointer;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
                    <strong>${esc(p.folio)}</strong><span>${fecha(p.fecha)}</span>${tag(p.tipo === 'ingreso' ? 'pagada' : p.tipo === 'egreso' ? 'pendiente' : 'borrador', p.tipo)}
                    <span style="flex:1">${esc(p.concepto)}</span><span class="tenue">${esc(p.referencia || '')}${p.automatica ? '' : ' · manual'}</span><strong class="num">${dinero(p.total)}</strong>
                </summary>
                <div style="padding:0 16px 12px">${tabla({ filas: p.movimientos, columnas: [
                    { t: 'Cuenta', r: (m) => `${esc(m.codigo)} ${esc(m.nombre)}` },
                    { t: 'Cargo', num: true, r: (m) => (m.cargo ? dinero(m.cargo) : '') },
                    { t: 'Abono', num: true, r: (m) => (m.abono ? dinero(m.abono) : '') }] })}</div>
            </details>`).join('') : '<div class="vacio">Sin pólizas en el periodo</div>';
    } else if (pestana === 'balanza') {
        const b = await api(`/contabilidad/balanza${rango()}`);
        panel.innerHTML = tabla({
            filas: b.filas.filter((f) => f.cargos || f.abonos),
            vacio: 'Sin movimientos en el periodo',
            columnas: [
                { t: 'Cuenta', r: (f) => `<strong>${esc(f.codigo)}</strong> ${esc(f.nombre)}` },
                { t: 'Tipo', r: (f) => esc(TIPOS_CTA[f.tipo]) },
                { t: 'Cargos', num: true, r: (f) => dinero(f.cargos) },
                { t: 'Abonos', num: true, r: (f) => dinero(f.abonos) },
                { t: 'Saldo', num: true, r: (f) => `<strong>${dinero(f.saldo)}</strong>` },
            ],
            pie: `<td colspan="2">${b.cuadra ? 'Sumas iguales: la balanza cuadra' : 'La balanza NO cuadra'}</td><td class="num">${dinero(b.totales.cargos)}</td><td class="num">${dinero(b.totales.abonos)}</td><td></td>`,
        });
    } else if (pestana === 'resultados') {
        const r = await api(`/contabilidad/resultados${rango()}`);
        const linea = (t, v, fuerte) => `<tr><td>${fuerte ? `<strong>${t}</strong>` : t}</td><td class="num">${fuerte ? `<strong>${dinero(v)}</strong>` : dinero(v)}</td></tr>`;
        const det = (tipo) => r.detalle.filter((d) => d.tipo === tipo).map((d) => `<tr><td style="padding-left:28px" class="tenue">${esc(d.codigo)} ${esc(d.nombre)}</td><td class="num tenue">${dinero(d.importe)}</td></tr>`).join('');
        panel.innerHTML = `<div class="tabla-caja"><table style="max-width:640px">
            ${linea('Ingresos', r.ingresos, true)}${det('ingreso')}
            ${linea('Costos', r.costos, true)}${det('costo')}
            ${linea('Utilidad bruta', r.utilidad_bruta, true)}
            ${linea('Gastos de operación', r.gastos, true)}${det('gasto')}
            <tr><td><strong>Utilidad neta</strong></td><td class="num"><strong style="color:${r.utilidad_neta >= 0 ? 'var(--verde)' : 'var(--rojo)'}">${dinero(r.utilidad_neta)}</strong></td></tr>
        </table></div>`;
    } else {
        const c = await api('/contabilidad/cuentas');
        panel.innerHTML = tabla({ filas: c, columnas: [{ t: 'Código', k: 'codigo' }, { t: 'Cuenta', k: 'nombre' }, { t: 'Tipo', r: (x) => esc(TIPOS_CTA[x.tipo]) }] });
    }
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
