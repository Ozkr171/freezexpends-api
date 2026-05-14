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
            data: {
                user_id: usuario.user_id, 
                nombre: usuario.nombre_s,
                premium: usuario.premium
            }
        });
    });
});

// ==========================================
// USUARIOS
// ==========================================

app.get('/api/usuarios/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `SELECT user_id, nombre_s, correo_electronico, premium FROM Usuario WHERE user_id = ?`;
    
    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ mensaje: 'Error interno del servidor.' });
        if (results.length === 0) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
        
        res.status(200).json({ mensaje: "Perfil obtenido", data: results[0] });
    });
});

app.put('/api/usuarios/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const { nombre_s, correo_electronico, contrasena } = req.body;

    if (!nombre_s || !correo_electronico) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios (nombre o correo)." });
    }

    let sql = `UPDATE Usuario SET nombre_s = ?, correo_electronico = ?`;
    let params = [nombre_s, correo_electronico];

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
    const { user_id, categoria_id, fecha_gasto, nombre_gasto, descripcion, plazo, monto_gasto } = req.body;

    if (!user_id || !fecha_gasto || !nombre_gasto || !monto_gasto) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios." });
    }

    // Le quitamos imagen_uri a la petición SQL
    const sql = `INSERT INTO Gasto (user_id, categoria_id, fecha_gasto, nombre_gasto, descripcion, plazo, monto_gasto) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    db.query(sql, [user_id, categoria_id || null, fecha_gasto, nombre_gasto, descripcion || null, plazo || null, monto_gasto], (err, result) => {
        if (err) {
            console.error("🚨 ERROR FATAL DE MYSQL EN GASTO:", err);
            return res.status(500).json({ mensaje: "Error interno al guardar el gasto." });
        }
        res.status(201).json({ mensaje: "¡Gasto registrado!", data: { gasto_id: result.insertId } });
    });
});

app.put('/api/gastos/:gasto_id', (req, res) => {
    const gastoId = req.params.gasto_id;
    const { nombre_gasto, monto_gasto, fecha_gasto, descripcion, imagen_uri } = req.body;

    if (!nombre_gasto || !monto_gasto || !fecha_gasto) {
        return res.status(400).json({ mensaje: "Faltan datos para actualizar." });
    }

    const sql = `UPDATE Gasto SET nombre_gasto = ?, monto_gasto = ?, fecha_gasto = ?, descripcion = ?, imagen_uri = ? WHERE gasto_id = ?`;

    db.query(sql, [nombre_gasto, monto_gasto, fecha_gasto, descripcion || null, imagen_uri || null, gastoId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "Gasto no encontrado." });
        res.status(200).json({ mensaje: "¡Gasto actualizado!" });
    });
});

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
    const { user_id, categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido } = req.body;

    if (!user_id || !fecha_ingreso || !nombre_ingreso || !monto) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios." });
    }

    // Le quitamos imagen_uri a la petición SQL
    const sql = `INSERT INTO Ingreso (user_id, categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    db.query(sql, [user_id, categoria_id || 1, fecha_ingreso, nombre_ingreso, descripcion || null, monto, recibido || 1], (err, result) => {
        if (err) {
            console.error("🚨 ERROR FATAL DE MYSQL EN INGRESO:", err);
            return res.status(500).json({ mensaje: "Error interno al guardar el ingreso." });
        }
        res.status(201).json({ mensaje: "¡Ingreso registrado!", data: { ingreso_id: result.insertId } });
    });
});

app.put('/api/ingresos/:ingreso_id', (req, res) => {
    const ingresoId = req.params.ingreso_id;
    const { categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido, imagen_uri } = req.body;

    if (!nombre_ingreso || !monto || !fecha_ingreso) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios para actualizar el ingreso." });
    }

    const sql = `UPDATE Ingreso SET categoria_id = ?, fecha_ingreso = ?, nombre_ingreso = ?, descripcion = ?, monto = ?, recibido = ?, imagen_uri = ? WHERE ingreso_id = ?`;

    db.query(sql, [categoria_id || null, fecha_ingreso, nombre_ingreso, descripcion || null, monto, recibido, imagen_uri || null, ingresoId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno del servidor." });
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "Ingreso no encontrado." });
        res.status(200).json({ mensaje: "¡Ingreso actualizado!" });
    });
});

app.delete('/api/ingresos/:ingreso_id', (req, res) => {
    const ingresoId = req.params.ingreso_id;
    const sql = `DELETE FROM Ingreso WHERE ingreso_id = ?`;

    db.query(sql, [ingresoId], (err, result) => {
        if (err) return res.status(500).json({ mensaje: "Error interno." });
        if (result.affectedRows === 0) return res.status(404).json({ mensaje: "Ingreso no encontrado." });
        res.status(200).json({ mensaje: "¡Ingreso eliminado!" });
    });
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor de Freeze-Xpends corriendo en el puerto ${PORT}`);
});