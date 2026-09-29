// Almacén · Inventario de refacciones y consumibles.
let productos = [];
let cat = null;

function camposProducto() {
    return [
        { k: 'sku', etiqueta: 'SKU', requerido: true },
        { k: 'categoria', etiqueta: 'Categoría', defecto: 'Refacciones' },
        { k: 'nombre', etiqueta: 'Nombre', requerido: true, ancho: true },
        { k: 'unidad', etiqueta: 'Unidad', defecto: 'pza' },
        { k: 'ubicacion', etiqueta: 'Ubicación en almacén' },
        { k: 'minimo', etiqueta: 'Mínimo', tipo: 'number', defecto: 0, ayuda: 'Al llegar aquí se sugiere comprar' },
        { k: 'maximo', etiqueta: 'Máximo', tipo: 'number', defecto: 0, ayuda: 'Cantidad hasta la que se repone' },
        { k: 'costo', etiqueta: 'Costo', tipo: 'number', paso: '0.01' },
        { k: 'precio', etiqueta: 'Precio de venta', tipo: 'number', paso: '0.01' },
        { k: 'proveedor_id', etiqueta: 'Proveedor habitual', tipo: 'select', ancho: true, opciones: opciones(cat.proveedores, 'id', 'nombre') },
    ];
}

window.iniciar = async (cont) => {
    cat = await catalogos();
    cont.innerHTML = encabezado('Inventario', 'Refacciones y consumibles del taller. Las salidas por servicio y las entradas por compra se registran solas.',
        `<button class="btn" type="button" id="btn-csv">Exportar CSV</button>
         <button class="btn btn-primario" type="button" id="btn-nuevo">Nuevo producto</button>`) + `
        <div class="filtros" style="margin-bottom:14px"><input type="search" id="q" placeholder="Buscar por SKU o nombre" aria-label="Buscar"></div>
        <div class="panel" id="tabla"></div>`;
    document.getElementById('btn-nuevo').onclick = () => editar(null);
    document.getElementById('q').addEventListener('input', pintar);
    document.getElementById('btn-csv').onclick = () => exportarCSV('inventario', [
        { t: 'SKU', k: 'sku' }, { t: 'Nombre', k: 'nombre' }, { t: 'Categoría', k: 'categoria' }, { t: 'Stock', k: 'stock' },
        { t: 'Mínimo', k: 'minimo' }, { t: 'Máximo', k: 'maximo' }, { t: 'Costo', k: 'costo' }, { t: 'Precio', k: 'precio' }, { t: 'Proveedor', k: 'proveedor' }], productos);
    document.getElementById('tabla').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const p = productos.find((x) => String(x.id) === (b.dataset.mov || b.dataset.editar));
        if (b.dataset.mov) movimiento(p);
        if (b.dataset.editar) editar(p);
    });
    await cargar();
};

async function cargar() { productos = await api('/productos'); pintar(); }

function pintar() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const filas = q ? productos.filter((p) => `${p.sku} ${p.nombre}`.toLowerCase().includes(q)) : productos;
    const valor = filas.reduce((s, p) => s + p.stock * p.costo, 0);
    document.getElementById('tabla').innerHTML = tabla({
        vacio: 'Sin productos',
        columnas: [
            { t: 'Producto', r: (p) => `<strong>${esc(p.nombre)}</strong><div class="sub">${esc(p.sku)} · ${esc(p.categoria)}</div>` },
            { t: 'Stock', num: true, r: (p) => {
                const color = p.stock <= p.minimo ? 'var(--rojo)' : p.maximo && p.stock > p.maximo ? 'var(--violeta)' : 'inherit';
                return `<strong style="color:${color}">${p.stock}</strong> <span class="tenue">${esc(p.unidad)}</span>`;
            } },
            { t: 'Mín / Máx', num: true, r: (p) => `${p.minimo} / ${p.maximo}` },
            { t: 'Costo', num: true, r: (p) => dinero(p.costo) },
            { t: 'Precio', num: true, r: (p) => dinero(p.precio) },
            { t: 'Valor', num: true, r: (p) => dinero(p.stock * p.costo) },
            { t: 'Proveedor', r: (p) => `<span class="tenue">${esc(p.proveedor || '—')}</span>` },
            { t: 'Ubicación', k: 'ubicacion' },
            { t: '', clase: 'acciones', r: (p) => `<button class="btn btn-chico" type="button" data-mov="${p.id}">Movimiento</button> <button class="btn btn-chico" type="button" data-editar="${p.id}">Editar</button>` },
        ],
        filas,
        pie: `<td>Valor del inventario mostrado</td><td></td><td></td><td></td><td></td><td class="num">${dinero(valor)}</td><td></td><td></td><td></td>`,
    });
}

function editar(p) {
    const campos = camposProducto();
    if (!p) campos.splice(5, 0, { k: 'stock', etiqueta: 'Stock inicial', tipo: 'number', defecto: 0 });
    modal({
        titulo: p ? `Editar ${p.sku}` : 'Nuevo producto', ancho: 700,
        cuerpo: formulario(campos, p || {}),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
            const d = leerFormulario(m, campos);
            if (d.maximo && d.maximo < d.minimo) throw new Error('El máximo no puede ser menor que el mínimo');
            await api(p ? `/productos/${p.id}` : '/productos', { method: p ? 'PUT' : 'POST', body: d });
            aviso('Producto guardado', 'ok');
            await cargar();
        } }],
    });
}

function movimiento(p) {
    const campos = [
        { k: 'tipo', etiqueta: 'Tipo', tipo: 'select', vacio: false, opciones: [['entrada', 'Entrada (suma)'], ['salida', 'Salida (resta)'], ['ajuste', 'Ajuste por conteo físico']] },
        { k: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', requerido: true, ayuda: 'En ajuste, escribe el stock contado' },
        { k: 'motivo', etiqueta: 'Motivo', requerido: true, ancho: true },
    ];
    modal({
        titulo: `Movimiento · ${p.sku}`,
        cuerpo: `<p style="margin-bottom:14px">${esc(p.nombre)} · stock actual <strong>${p.stock} ${esc(p.unidad)}</strong></p>` + formulario(campos),
        acciones: [{ texto: 'Cancelar' }, { texto: 'Registrar', clase: 'btn-primario', onClick: async (m) => {
            const r = await api(`/productos/${p.id}/movimiento`, { method: 'POST', body: leerFormulario(m, campos) });
            aviso(`Stock de ${p.sku}: ${r.stock}`, 'ok');
            await cargar();
        } }],
    });
}
