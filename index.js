require('dotenv').config(); 
const express = require('express');
const mysql = require('mysql2'); 
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// CONFIGURACIÓN BASE DE DATOS (Fase 1: createPool)
// ==========================================
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Error conectando a Aiven:', err);
        return;
    }
    console.log('✅ ¡Conectado exitosamente al Pool de Aiven MySQL!');
    connection.release();
});

app.get('/', (req, res) => {
    res.send('¡Hola! El servidor de FREEZE-XPENDS está vivo.');
});

// ==========================================
// AUTENTICACIÓN
// ==========================================

app.post('/api/registro', (req, res) => {
    const { nombre_s, correo_electronico, contrasena } = req.body;

    if (!nombre_s || !correo_electronico || !contrasena) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios." });
    }

    const sqlUsuario = `INSERT INTO Usuario (nombre_s, correo_electronico, contrasena, premium) VALUES (?, ?, ?, 0)`;
    
    db.query(sqlUsuario, [nombre_s, correo_electronico, contrasena], (err, resultUsuario) => {
        if (err) {
            console.error("Error al registrar usuario:", err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ mensaje: "Ese correo electrónico ya está en uso." });
            }
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        const nuevoUserId = resultUsuario.insertId;

        const categoriasGastoPorDefecto = [
            [nuevoUserId, 'Alimentación'],
            [nuevoUserId, 'Transporte'],
            [nuevoUserId, 'Vivienda'],
            [nuevoUserId, 'Salud'],
            [nuevoUserId, 'Entretenimiento']
        ];

        const categoriasIngresoPorDefecto = [
            [nuevoUserId, 'Salario'],
            [nuevoUserId, 'Ventas'],
            [nuevoUserId, 'Inversiones'],
            [nuevoUserId, 'Otros']
        ];

        const sqlGasto = `INSERT INTO Categoria_gasto (user_id, nombre_categoria) VALUES ?`;
        db.query(sqlGasto, [categoriasGastoPorDefecto], (errGasto) => {
            if (errGasto) console.error("Error precargando categorías de gasto:", errGasto);

            const sqlIngreso = `INSERT INTO Categoria_ingreso (user_id, nombre_categoria) VALUES ?`;
            db.query(sqlIngreso, [categoriasIngresoPorDefecto], (errIngreso) => {
                if (errIngreso) console.error("Error precargando categorías de ingreso:", errIngreso);

                res.status(201).json({ 
                    mensaje: "¡Usuario registrado y cuenta configurada con éxito!",
                    data: { user_id: nuevoUserId }
                });
            });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { correo_electronico, contrasena } = req.body;

    if (!correo_electronico || !contrasena) {
        return res.status(400).json({ mensaje: "Por favor ingresa tu correo y contraseña." });
    }

    const sql = `SELECT * FROM Usuario WHERE correo_electronico = ? AND contrasena = ?`;

    db.query(sql, [correo_electronico, contrasena], (err, results) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        
        if (results.length === 0) {
            return res.status(401).json({ mensaje: "Correo o contraseña incorrectos." });
        }

        const usuario = results[0];
        
        res.status(200).json({
            mensaje: "¡Inicio de sesión exitoso!",
            user_id: usuario.user_id, 
            nombre: usuario.nombre_s,
            premium: usuario.premium
        });
    });
});

// ==========================================
// USUARIOS
// ==========================================

app.get('/api/usuarios/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `SELECT user_id, nombre_s, correo_electronico, premium, divisa, foto_perfil FROM Usuario WHERE user_id = ?`;
    
    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ mensaje: 'Error interno del servidor.' });
        if (results.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
        
        res.status(200).json({ mensaje: "Perfil obtenido", data: results[0] });
    });
});

app.put('/api/usuarios/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const { nombre_s, correo_electronico, contrasena, divisa, foto_perfil, formato_num } = req.body;

    if (!nombre_s || !correo_electronico) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios (nombre o correo)." });
    }

    let sql = `UPDATE Usuario SET nombre_s = ?, correo_electronico = ?, divisa = ?, foto_perfil = ?, formato_num = ?`;
    let params = [nombre_s, correo_electronico, divisa || 'MXN', foto_perfil || null, formato_num || 'US'];

    if (contrasena) {
        sql += `, contrasena = ?`;
        params.push(contrasena);
    }

    sql += ` WHERE user_id = ?`;
    params.push(userId);

    db.query(sql, params, (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ mensaje: "Ese correo ya está en uso." });
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "No se encontró el usuario." });
        res.status(200).json({ mensaje: "¡Perfil actualizado correctamente!" });
    });
});

app.delete('/api/usuarios/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `DELETE FROM Usuario WHERE user_id = ?`;

    db.query(sql, [userId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "Usuario no encontrado." });
        res.status(200).json({ mensaje: "Cuenta y datos eliminados correctamente." });
    });
});

app.put('/api/usuarios/:user_id/premium', (req, res) => {
    const userId = req.params.user_id;
    const { premium } = req.body;

    if (premium === undefined) return res.status(400).json({ mensaje: "Falta el estatus premium." });

    const sql = `UPDATE Usuario SET premium = ? WHERE user_id = ?`;

    db.query(sql, [premium, userId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "Usuario no encontrado." });
        res.status(200).json({ mensaje: premium === 1 ? "¡Ahora eres Premium!" : "Suscripción cancelada." });
    });
});

// ==========================================
// CATEGORÍAS
// ==========================================

app.get('/api/categorias/gastos/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `SELECT * FROM Categoria_gasto WHERE user_id = ?`;
    
    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ mensaje: 'Error al obtener categorías.' });
        res.status(200).json({ mensaje: 'Categorías obtenidas', data: results });
    });
});

app.get('/api/categorias/ingresos/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `SELECT * FROM Categoria_ingreso WHERE user_id = ?`;
    
    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ mensaje: 'Error al obtener categorías.' });
        res.status(200).json({ mensaje: 'Categorías obtenidas', data: results });
    });
});

app.post('/api/categorias/gastos', (req, res) => {
    const { user_id, nombre_categoria, limite_presupuesto } = req.body;
    
    if (!user_id || !nombre_categoria) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios." });
    }

    const sql = `INSERT INTO Categoria_gasto (user_id, nombre_categoria, limite_presupuesto) VALUES (?, ?, ?)`;
    db.query(sql, [user_id, nombre_categoria, limite_presupuesto || 0.00], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        res.status(201).json({ mensaje: "Categoría de gasto creada exitosamente" });
    });
});

app.post('/api/categorias/ingresos', (req, res) => {
    const { user_id, nombre_categoria } = req.body;
    
    if (!user_id || !nombre_categoria) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios." });
    }

    const sql = `INSERT INTO Categoria_ingreso (user_id, nombre_categoria) VALUES (?, ?)`;
    db.query(sql, [user_id, nombre_categoria], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        res.status(201).json({ mensaje: "Categoría de ingreso creada exitosamente" });
    });
});

// ==========================================
// GASTOS
// ==========================================

app.get('/api/gastos/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `SELECT * FROM Gasto WHERE user_id = ? ORDER BY fecha_gasto DESC`;

    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        res.status(200).json({ mensaje: "Gastos obtenidos", data: results });
    });
});

app.post('/api/gastos', (req, res) => {
    const { user_id, categoria_id, fecha_gasto, nombre_gasto, descripcion, plazo, monto_gasto, imagen_uri } = req.body; // [cite: 1]

    if (!user_id || !fecha_gasto || !nombre_gasto || !monto_gasto) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios." }); // [cite: 1]
    }

    const sql = `INSERT INTO Gasto (user_id, categoria_id, fecha_gasto, nombre_gasto, descripcion, plazo, monto_gasto, imagen_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`; // [cite: 1]

    db.query(sql, [user_id, categoria_id || null, fecha_gasto, nombre_gasto, descripcion || null, plazo || null, monto_gasto ,imagen_uri || null], (err, result) => { // [cite: 1, 2]
        if (err) {
            console.error("🚨 ERROR FATAL DE MYSQL EN GASTO:", err); // [cite: 2]
            return res.status(500).json({ mensaje: "Error interno al guardar el gasto." }); // [cite: 2]
        }
        res.status(201).json({ mensaje: "¡Gasto registrado!", data: { gasto_id: result.insertId } }); // [cite: 2]
    });
});

app.put('/api/gastos/:gasto_id', (req, res) => {
    const gastoId = req.params.gasto_id; // [cite: 3]
    
    const { categoria_id, fecha_gasto, nombre_gasto, descripcion, plazo, monto_gasto, imagen_uri } = req.body; 

    if (!nombre_gasto || !monto_gasto || !fecha_gasto) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios para actualizar." }); // [cite: 3]
    }

    const sql = `UPDATE Gasto SET categoria_id = ?, fecha_gasto = ?, nombre_gasto = ?, descripcion = ?, plazo = ?, monto_gasto = ?, imagen_uri = ? WHERE gasto_id = ?`;

    db.query(sql, [categoria_id || null, fecha_gasto, nombre_gasto, descripcion || null, plazo || 'ÚNICO', monto_gasto, imagen_uri || null, gastoId], (err, result) => {
        if (err) {
            console.error("🚨 ERROR EN BASE DE DATOS AL EDITAR GASTO:", err); // [cite: 4]
            return res.status(500).json({ mensaje: "Error interno del servidor." }); // [cite: 4]
        }
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "Gasto no encontrado." }); // [cite: 5]
        res.status(200).json({ mensaje: "¡Gasto actualizado!" }); // [cite: 6]
    });
})

app.delete('/api/gastos/:gasto_id', (req, res) => {
    const gastoId = req.params.gasto_id;
    const sql = `DELETE FROM Gasto WHERE gasto_id = ?`;

    db.query(sql, [gastoId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno." });
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "Gasto no encontrado." });
        res.status(200).json({ mensaje: "¡Gasto eliminado!" });
    });
});

// ==========================================
// INGRESOS
// ==========================================

app.get('/api/ingresos/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `
        SELECT i.*, c.nombre_categoria 
        FROM Ingreso i
        LEFT JOIN Categoria_ingreso c ON i.categoria_id = c.categoria_id
        WHERE i.user_id = ?
        ORDER BY i.fecha_ingreso DESC
    `;
    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        res.status(200).json({ mensaje: "Ingresos obtenidos", data: results });
    });
});

app.post('/api/ingresos', (req, res) => {
    const { user_id, categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido, plazo, imagen_uri } = req.body; // [cite: 6]
    
    if (!user_id || !fecha_ingreso || !nombre_ingreso || !monto) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios." }); // [cite: 6]
    }

    const sql = `INSERT INTO Ingreso (user_id, categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido, plazo, imagen_uri) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`; // [cite: 6, 7]

    db.query(sql, [user_id, categoria_id || null , fecha_ingreso, nombre_ingreso, descripcion || null, monto, recibido !== undefined ? recibido : 1, plazo || 'ÚNICO',imagen_uri || null], (err, result) => { // [cite: 7]
        if (err) {
            console.error("🚨 ERROR FATAL DE MYSQL EN INGRESO:", err); // [cite: 7]
            return res.status(500).json({ mensaje: "Error interno al guardar el ingreso." }); // [cite: 7]
        }
        res.status(201).json({ mensaje: "¡Ingreso registrado!", data: { ingreso_id: result.insertId } }); // [cite: 7, 8]
    });
});

app.put('/api/ingresos/:ingreso_id', (req, res) => {
    const ingresoId = req.params.ingreso_id; // [cite: 9]
    
    const { categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido, plazo, imagen_uri } = req.body;

    if (!nombre_ingreso || !monto || !fecha_ingreso) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios para actualizar el ingreso." }); // [cite: 9]
    }

    const sql = `UPDATE Ingreso SET categoria_id = ?, fecha_ingreso = ?, nombre_ingreso = ?, descripcion = ?, monto = ?, recibido = ?, plazo = ?, imagen_uri = ? WHERE ingreso_id = ?`;

    db.query(sql, [categoria_id || null, fecha_ingreso, nombre_ingreso, descripcion || null, monto, recibido !== undefined ? recibido : 1, plazo || 'ÚNICO', imagen_uri || null, ingresoId], (err, result) => {
        if (err) {
            console.error("🚨 ERROR EN BASE DE DATOS AL EDITAR INGRESO:", err); // [cite: 10]
            return res.status(500).json({ mensaje: "Error interno del servidor." }); // [cite: 10]
        }
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "Ingreso no encontrado." }); // [cite: 11]
        res.status(200).json({ mensaje: "¡Ingreso actualizado!" }); // [cite: 12]
    });
});

// ==========================================
// PRESUPUESTOS (Rutas faltantes añadidas)
// ==========================================

app.get('/api/usuarios/:user_id/presupuesto', (req, res) => {
    const userId = req.params.user_id;
    const sql = `SELECT presupuesto_global FROM Usuario WHERE user_id = ?`;
    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ mensaje: "Error interno" });
        if (results.length === 0) return res.status(404).json({ mensaje: "Usuario no encontrado" });
        res.status(200).json({ presupuesto_global: results[0].presupuesto_global });
    });
});

app.put('/api/usuarios/:user_id/presupuesto', (req, res) => {
    const userId = req.params.user_id;
    const { presupuesto_global } = req.body;

    const sql = `UPDATE Usuario SET presupuesto_global = ? WHERE user_id = ?`;
    db.query(sql, [presupuesto_global, userId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        res.status(200).json({ mensaje: "Presupuesto global actualizado" });
    });
});

app.put('/api/categorias/gastos/:categoria_id/presupuesto', (req, res) => {
    const categoriaId = req.params.categoria_id;
    const { limite_presupuesto } = req.body;

    const sql = `UPDATE Categoria_gasto SET limite_presupuesto = ? WHERE categoria_id = ?`;
    db.query(sql, [limite_presupuesto, categoriaId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        res.status(200).json({ mensaje: "Límite de categoría actualizado" });
    });
});

// ==========================================
// ESTATUS RÁPIDOS (PAGADO / RECIBIDO)
// ==========================================

app.put('/api/gastos/:gasto_id/estatus', (req, res) => {
    const gastoId = req.params.gasto_id;
    const { completado } = req.body; // 1 = Pagado, 0 = Pendiente

    db.query(`UPDATE Gasto SET completado = ? WHERE gasto_id = ?`, [completado, gastoId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        res.status(200).json({ mensaje: "Estatus de gasto actualizado" });
    });
});

app.put('/api/ingresos/:ingreso_id/estatus', (req, res) => {
    const ingresoId = req.params.ingreso_id;
    const { recibido } = req.body; // 1 = Recibido, 0 = No recibido

    db.query(`UPDATE Ingreso SET recibido = ? WHERE ingreso_id = ?`, [recibido, ingresoId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        res.status(200).json({ mensaje: "Estatus de ingreso actualizado" });
    });
});

// ==========================================
// RUTAS PARA NOTAS POR DÍA Y MES
// ==========================================

// --- NUEVA RUTA PARA LISTAR TODAS LAS NOTAS DE UN MES ---
app.get('/api/notas/:user_id/mes/:anio_mes', (req, res) => {
    const { user_id, anio_mes } = req.params;
    // anio_mes llega como '2024-05', usamos LIKE para agarrar todo el mes
    const sql = `SELECT * FROM Notas WHERE user_id = ? AND fecha LIKE ? ORDER BY fecha ASC`;
    db.query(sql, [user_id, `${anio_mes}-%`], (err, results) => {
        if (err) return res.status(500).json({ mensaje: "Error al obtener notas", data: [] });
        res.status(200).json({ mensaje: "Notas obtenidas", data: results });
    });
});

app.get('/api/notas/:user_id/:fecha', (req, res) => {
    const { user_id, fecha } = req.params;
    const sql = `SELECT * FROM Notas WHERE user_id = ? AND fecha = ?`;
    db.query(sql, [user_id, fecha], (err, results) => {
        if (err) return res.status(500).json({ mensaje: "Error al obtener notas", data: [] });
        res.status(200).json({ mensaje: "Notas obtenidas", data: results });
    });
});

app.post('/api/notas', (req, res) => {
    const { user_id, fecha, texto } = req.body;
    const sql = `INSERT INTO Notas (user_id, fecha, texto) VALUES (?, ?, ?)`;
    db.query(sql, [user_id, fecha, texto], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error al guardar la nota" });
        res.status(201).json({ mensaje: "Nota guardada", data: { nota_id: result.insertId } });
    });
});

app.delete('/api/notas/:nota_id', (req, res) => {
    const notaId = req.params.nota_id;
    const sql = `DELETE FROM Notas WHERE nota_id = ?`;
    db.query(sql, [notaId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error al eliminar la nota" });
        res.status(200).json({ mensaje: "Nota eliminada correctamente" });
    });
});

app.put('/api/notas/:nota_id', (req, res) => {
    const notaId = req.params.nota_id;
    const { texto } = req.body;
    const sql = `UPDATE Notas SET texto = ? WHERE nota_id = ?`;
    db.query(sql, [texto, notaId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error al actualizar la nota" });
        res.status(200).json({ mensaje: "Nota actualizada correctamente" });
    });
});

// ==========================================
// RECORDATORIOS (ALARMAS)
// ==========================================

app.post('/api/recordatorios', (req, res) => {
    const { user_id, fecha_y_hora, titulo_r } = req.body;
    
    if (!user_id || !fecha_y_hora || !titulo_r) {
        return res.status(400).json({ mensaje: "Faltan datos para el recordatorio." });
    }

    const sql = `INSERT INTO Recordatorios (user_id, fecha_y_hora, completado, titulo_r) VALUES (?, ?, 0, ?)`;
    
    db.query(sql, [user_id, fecha_y_hora, titulo_r], (err, result) => {
        if (err) {
            console.error("🚨 ERROR EN RECORDATORIO:", err);
            return res.status(500).json({ mensaje: "Error al guardar recordatorio." });
        }
        res.status(201).json({ mensaje: "Recordatorio guardado", data: { recordatorio_id: result.insertId } });
    });
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor de Freeze-Xpends corriendo en el puerto ${PORT}`);
});