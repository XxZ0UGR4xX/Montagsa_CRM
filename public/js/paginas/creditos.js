// Administración · Créditos: límite, plazo y estado del crédito de cada cliente.
let filas = [];

window.iniciar = async (cont) => {
    cont.innerHTML = encabezado('Créditos',
        'Si un cliente rebasa su límite o tiene el crédito suspendido, el sistema bloquea nuevas rentas y facturas hasta que un administrador lo autorice.') +
        '<div id="kpis"></div><div class="panel" id="tabla"></div>';
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b) editar(filas.find((c) => String(c.id) === b.dataset.id));
    });
    await cargar();
};

async function cargar() {
    filas = await api('/creditos');
    const conCredito = filas.filter((c) => c.credito_estado === 'activo');
    document.getElementById('kpis').innerHTML = `<div class="kpis" style="margin-bottom:18px">
        ${kpi('Crédito otorgado', pesos(conCredito.reduce((s, c) => s + c.limite_credito, 0)), `${conCredito.length} clientes con crédito activo`)}
        ${kpi('Saldo usado', pesos(filas.reduce((s, c) => s + c.saldo, 0)))}
        ${kpi('Saldo vencido', pesos(filas.reduce((s, c) => s + c.vencido, 0)), '', filas.some((c) => c.vencido > 0) ? 'alerta' : '')}
        ${kpi('Clientes al límite', filas.filter((c) => c.limite_credito > 0 && c.uso >= 90).length, '90% o más de uso')}
    </div>`;
    document.getElementById('tabla').innerHTML = tabla({
        filas,
        columnas: [
            { t: 'Cliente', r: (c) => `<strong>${esc(c.razon_social)}</strong><div class="sub">${esc(c.rfc || '')}</div>` },
            { t: 'Estado', r: (c) => tag(c.credito_estado) },
            { t: 'Límite', num: true, r: (c) => (c.credito_estado === 'sin_credito' ? '—' : dinero(c.limite_credito)) },
            { t: 'Plazo', num: true, r: (c) => (c.dias_credito ? `${c.dias_credito} días` : 'Contado') },
            { t: 'Saldo', num: true, r: (c) => dinero(c.saldo) },
            { t: 'Vencido', num: true, r: (c) => (c.vencido > 0 ? `<strong style="color:var(--rojo)">${dinero(c.vencido)}</strong>` : '—') },
            { t: 'Disponible', num: true, r: (c) => (c.credito_estado === 'activo' ? dinero(c.disponible) : '—') },
            { t: 'Uso', r: (c) => (c.limite_credito > 0 ? `<div class="uso ${c.uso >= 90 ? 'alto' : c.uso >= 70 ? 'medio' : ''}" title="${c.uso}%"><span style="width:${Math.min(c.uso, 100)}%"></span></div><div class="sub">${c.uso}%</div>` : '') },
            { t: '', clase: 'acciones', r: (c) => `<button class="btn btn-chico" type="button" data-id="${c.id}">Ajustar</button>` },
        ],
    });
}

function editar(c) {
    const campos = [
        { k: 'credito_estado', etiqueta: 'Estado del crédito', tipo: 'select', vacio: false, ancho: true,
          opciones: [['sin_credito', 'Contado (sin crédito)'], ['activo', 'Activo'], ['suspendido', 'Suspendido']] },
        { k: 'limite_credito', etiqueta: 'Límite de crédito', tipo: 'number', paso: '0.01' },
        { k: 'dias_credito', etiqueta: 'Días de crédito', tipo: 'number' },
    ];
    modal({
        titulo: `Crédito · ${c.razon_social}`,
        cuerpo: `<p style="margin-bottom:14px">Saldo actual: <strong>${dinero(c.saldo)}</strong>${c.vencido > 0 ? ` · vencido <strong style="color:var(--rojo)">${dinero(c.vencido)}</strong>` : ''}</p>` + formulario(campos, c),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
            const d = leerFormulario(m, campos);
            if (d.credito_estado === 'sin_credito') { d.dias_credito = 0; }
            await api(`/creditos/${c.id}`, { method: 'PUT', body: d });
            aviso('Crédito actualizado', 'ok');
            await cargar();
        } }],
    });
}
