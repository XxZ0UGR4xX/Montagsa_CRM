// public/js/crud.js — Página de alta/edición genérica para catálogos sencillos.
//
// crudPagina(contenedor, {
//   titulo, subtitulo, ruta: '/proveedores', nombre: 'proveedor',
//   columnas: [...como tabla()...], campos: [...como formulario()...],
//   camposEdicion (opcional), filas: (json) => array, puedeEditar: true,
//   antesDeGuardar: (datos, esNuevo) => datos, csv: 'proveedores'
// })
async function crudPagina(cont, cfg) {
    let filas = [];
    const puedeEditar = cfg.puedeEditar !== false;

    cont.innerHTML = encabezado(cfg.titulo, cfg.subtitulo,
        `${cfg.csv ? '<button class="btn" id="crud-csv" type="button">Exportar CSV</button>' : ''}
         ${puedeEditar ? `<button class="btn btn-primario" id="crud-nuevo" type="button">Nuevo ${esc(cfg.nombre)}</button>` : ''}`)
        + `<div class="filtros" style="margin-bottom:14px"><input type="search" id="crud-buscar" placeholder="Buscar…" aria-label="Buscar"></div>
           <div class="panel" id="crud-tabla"></div>`;

    const columnas = puedeEditar
        ? [...cfg.columnas, { t: '', clase: 'acciones', r: (f) => `<button class="btn btn-chico" type="button" data-editar="${f.id}">Editar</button>` }]
        : cfg.columnas;

    function pintar() {
        const q = document.getElementById('crud-buscar').value.trim().toLowerCase();
        const vis = q ? filas.filter((f) => JSON.stringify(f).toLowerCase().includes(q)) : filas;
        document.getElementById('crud-tabla').innerHTML = tabla({ columnas, filas: vis, vacio: `No hay registros de ${cfg.nombre}` });
    }

    async function cargar() {
        const r = await api(cfg.ruta);
        filas = cfg.filas ? cfg.filas(r) : r;
        pintar();
    }

    function abrir(registro) {
        const esNuevo = !registro;
        const campos = !esNuevo && cfg.camposEdicion ? cfg.camposEdicion : cfg.campos;
        modal({
            titulo: esNuevo ? `Nuevo ${cfg.nombre}` : `Editar ${cfg.nombre}`,
            cuerpo: formulario(campos, registro || {}),
            acciones: [
                { texto: 'Cancelar' },
                { texto: 'Guardar', clase: 'btn-primario', onClick: async (m) => {
                    let datos = leerFormulario(m, campos);
                    if (cfg.antesDeGuardar) datos = cfg.antesDeGuardar(datos, esNuevo);
                    await api(esNuevo ? cfg.ruta : `${cfg.ruta}/${registro.id}`, { method: esNuevo ? 'POST' : 'PUT', body: datos });
                    aviso(esNuevo ? 'Registro creado' : 'Cambios guardados', 'ok');
                    await cargar();
                } },
            ],
        });
    }

    document.getElementById('crud-buscar').addEventListener('input', pintar);
    if (puedeEditar) document.getElementById('crud-nuevo').onclick = () => abrir(null);
    if (cfg.csv) document.getElementById('crud-csv').onclick = () => exportarCSV(cfg.csv, cfg.columnas.filter((c) => c.k || c.csv), filas);
    document.getElementById('crud-tabla').addEventListener('click', (e) => {
        const id = e.target.dataset.editar;
        if (id) abrir(filas.find((f) => String(f.id) === id));
    });
    await cargar();
    return { recargar: cargar };
}
