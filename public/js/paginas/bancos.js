// Contabilidad · Bancos: cuentas bancarias (subcuentas de "Bancos"), sus movimientos
// (vienen de las pólizas) y conciliación simple contra un estado de cuenta.
let cuentas = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Bancos', 'Saldo por cuenta bancaria, movimientos desde las pólizas y conciliación contra el estado de cuenta.',
        '<button class="btn btn-primario" type="button" id="btn-nueva">Nueva cuenta</button>') + '<div class="panel" id="tabla"></div>';
    document.getElementById('btn-nueva').onclick = nueva;
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) movimientos(cuentas.find((c) => String(c.id) === b.dataset.id));
    });
    await cargar();
};

async function cargar() {
    cuentas = await api('/bancos');
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'Sin cuentas bancarias registradas',
        filas: cuentas,
        columnas: [
            { t: 'Banco', r: (c) => `<strong>${esc(c.banco)}</strong><div class="sub">${esc(c.numero_enmascarado)}</div>` },
            { t: 'Cuenta contable', r: (c) => `${esc(c.cuenta_codigo)} ${esc(c.cuenta_nombre)}` },
            { t: 'Saldo', num: true, r: (c) => `<strong>${dinero(c.saldo)}</strong>` },
            { t: 'Estado', r: (c) => (c.activa ? tag('activo') : tag('inactivo')) },
            { t: '', clase: 'acciones', r: (c) => `<button class="btn btn-chico" type="button" data-id="${c.id}">Movimientos</button>` },
        ],
    });
}

function nueva() {
    const campos = [
        { k: 'banco', etiqueta: 'Banco', requerido: true, ancho: true },
        { k: 'numero_enmascarado', etiqueta: 'Número (enmascarado)', requerido: true, ayuda: 'p. ej. **** 4821' },
        { k: 'saldo_inicial', etiqueta: 'Saldo inicial', tipo: 'number', paso: '0.01', defecto: 0 },
    ];
    modal({
        titulo: 'Nueva cuenta bancaria', cuerpo: formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Crear', clase: 'btn-primario', onClick: async (m) => {
            await api('/bancos', { method: 'POST', body: leerFormulario(m, campos) });
            aviso('Cuenta bancaria creada', 'ok');
            await cargar();
        } }],
    });
}

async function movimientos(cb) {
    const movs = await api(`/bancos/${cb.id}/movimientos`);
    const m = modal({
        titulo: `Movimientos · ${cb.banco} ${cb.numero_enmascarado}`, ancho: 880,
        cuerpo: `<div id="movs"></div>
            <h4 style="margin:18px 0 8px">Conciliar con estado de cuenta</h4>
            <p class="tenue" style="margin-bottom:8px">Pega filas del CSV del banco: fecha,concepto,cargo,abono (una por línea). Se compara por importe exacto contra lo no conciliado.</p>
            <textarea id="csv" rows="5" style="width:100%" placeholder="2026-09-01,Transferencia SPEI,,15000.00"></textarea>
            <button class="btn btn-chico" type="button" id="btn-comparar" style="margin-top:8px">Comparar</button>
            <div id="comparacion" style="margin-top:12px"></div>`,
        acciones: [{ texto: 'Cerrar' }],
    });
    const pintarMovs = () => {
        m.el.querySelector('#movs').innerHTML = tabla({
            vacio: 'Sin movimientos', filas: movs,
            columnas: [
                { t: 'Fecha', r: (x) => fecha(x.fecha) }, { t: 'Póliza', k: 'folio' }, { t: 'Concepto', k: 'concepto' },
                { t: 'Cargo', num: true, r: (x) => (x.cargo ? dinero(x.cargo) : '') }, { t: 'Abono', num: true, r: (x) => (x.abono ? dinero(x.abono) : '') },
                { t: 'Conciliado', r: (x) => (x.conciliado ? tag('activo', 'Sí') : tag('inactivo', 'No')) },
                { t: '', clase: 'acciones', r: (x) => `<button class="btn btn-chico" type="button" data-conc="${x.id}" data-v="${x.conciliado ? 0 : 1}">${x.conciliado ? 'Desconciliar' : 'Conciliar'}</button>` },
            ],
        });
    };
    pintarMovs();
    m.el.querySelector('#movs').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-conc]');
        if (!b) return;
        const conciliado = b.dataset.v === '1';
        await api(`/bancos/movimientos/${b.dataset.conc}/conciliar`, { method: 'PUT', body: { conciliado } });
        movs.find((x) => String(x.id) === b.dataset.conc).conciliado = conciliado;
        pintarMovs();
    });
    m.el.querySelector('#btn-comparar').onclick = async () => {
        const filas = m.el.querySelector('#csv').value.trim().split('\n').filter(Boolean).map((linea) => {
            const [f, concepto, cargo, abono] = linea.split(',');
            return { fecha: (f || '').trim(), concepto: (concepto || '').trim(), cargo: Number(cargo) || 0, abono: Number(abono) || 0 };
        });
        if (!filas.length) return aviso('Pega al menos una línea', 'error');
        const r = await api(`/bancos/${cb.id}/comparar`, { method: 'POST', body: { movimientos: filas } });
        m.el.querySelector('#comparacion').innerHTML = tabla({
            vacio: 'Sin filas', filas: r.comparadas,
            columnas: [
                { t: 'Fecha', k: 'fecha' }, { t: 'Concepto', k: 'concepto' },
                { t: 'Cargo', num: true, r: (x) => (x.cargo ? dinero(x.cargo) : '') }, { t: 'Abono', num: true, r: (x) => (x.abono ? dinero(x.abono) : '') },
                { t: 'Coincide en libro', r: (x) => (x.coincide ? tag('activo', 'Sí') : tag('inactivo', 'No')) },
            ],
        }) + (r.sin_coincidencia_en_libro.length
            ? `<p class="tenue" style="margin-top:10px">${r.sin_coincidencia_en_libro.length} movimiento(s) en el libro sin coincidencia en el estado de cuenta.</p>` : '');
    };
}
