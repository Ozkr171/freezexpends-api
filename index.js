require('dotenv').config(); 
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// 1. Configurar la conexión a Aiven usando los datos del archivo .env
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// 2. Intentar conectarse a la base de datos
db.connect((err) => {
    if (err) {
        console.error('Error conectando a Aiven:', err);
        return;
    }
    console.log('¡Conectado exitosamente a la base de datos en Aiven!');
});

// 3. Crear una ruta de prueba básica
app.get('/', (req, res) => {
    res.send('¡Hola! El servidor de FREEZE-XPENDS está vivo.');
});

// ==========================================
// RUTA 1: REGISTRO DE USUARIO (Con Kit de Inicio de Categorías)
// ==========================================
app.post('/api/registro', (req, res) => {
    const { nombre_s, correo_electronico, contrasena } = req.body;

    if (!nombre_s || !correo_electronico || !contrasena) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios." });
    }

    // PASO 1: Creamos al usuario en la base de datos
    const sqlUsuario = `INSERT INTO Usuario (nombre_s, correo_electronico, contrasena) VALUES (?, ?, ?)`;
    
    db.query(sqlUsuario, [nombre_s, correo_electronico, contrasena], (err, resultUsuario) => {
        if (err) {
            console.error("Error al registrar usuario:", err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ mensaje: "Ese correo electrónico ya está en uso." });
            }
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        // ¡Aquí está la magia! Extraemos el ID del usuario que se acaba de registrar
        const nuevoUserId = resultUsuario.insertId;

        // PASO 2: Preparamos los "Kits de Inicio" usando el nuevo ID
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

        // PASO 3: Insertamos todas las categorías de gasto de un solo golpe
        const sqlGasto = `INSERT INTO Categoria_gasto (user_id, nombre_categoria) VALUES ?`;
        
        // Fíjate que [categoriasGastoPorDefecto] va entre corchetes, esto le dice a MySQL que es una inserción múltiple
        db.query(sqlGasto, [categoriasGastoPorDefecto], (errGasto) => {
            if (errGasto) {
                console.error("Error precargando categorías de gasto:", errGasto);
                // No detenemos la app si falla esto, pero lo registramos
            }

            // PASO 4: Insertamos todas las categorías de ingreso
            const sqlIngreso = `INSERT INTO Categoria_ingreso (user_id, nombre_categoria) VALUES ?`;
            db.query(sqlIngreso, [categoriasIngresoPorDefecto], (errIngreso) => {
                if (errIngreso) {
                    console.error("Error precargando categorías de ingreso:", errIngreso);
                }

                // PASO 5: Le respondemos a la aplicación en Android que todo fue un éxito
                res.status(201).json({ 
                    mensaje: "¡Usuario registrado y cuenta configurada con éxito!",
                    user_id: nuevoUserId
                });
            });
        });
    });
});
// ==========================================
// RUTA 2: INICIO DE SESIÓN (LOGIN)
// ==========================================
app.post('/api/login', (req, res) => {
    // 1. Extraemos el correo y la contraseña que envía la app
    const { correo_electronico, contrasena } = req.body;

    if (!correo_electronico || !contrasena) {
        return res.status(400).json({ mensaje: "Por favor ingresa tu correo y contraseña." });
    }

    // 2. Buscamos en la base de datos si existe un usuario con ese correo y esa misma contraseña
    const sql = `SELECT * FROM Usuario WHERE correo_electronico = ? AND contrasena = ?`;

    // 3. Ejecutamos la consulta
    db.query(sql, [correo_electronico, contrasena], (err, results) => {
        if (err) {
            console.error("Error en el login:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        // 4. Si 'results' está vacío, significa que las credenciales no coinciden
        if (results.length === 0) {
            return res.status(401).json({ mensaje: "Correo o contraseña incorrectos." });
        }

        // 5. Si todo coincide, tomamos los datos del usuario encontrado (results[0])
        const usuario = results[0];
        
        // Respondemos a la app con éxito y le mandamos el ID del usuario
        res.status(200).json({
            mensaje: "¡Inicio de sesión exitoso!",
            user_id: usuario.user_id,
            nombre: usuario.nombre_s,
            premium: usuario.premium
        });
    });
});

// ==========================================
// RUTA 3: REGISTRAR UN NUEVO GASTO
// ==========================================
app.post('/api/gastos', (req, res) => {
    // 1. Extraemos los datos del cuerpo de la petición
    // Nota: categoria_id, descripcion y plazo son opcionales según tu base de datos
    const { user_id, categoria_id, fecha_gasto, nombre_gasto, descripcion, plazo, monto_gasto } = req.body;

    // 2. Validación básica de campos obligatorios
    if (!user_id || !fecha_gasto || !nombre_gasto || !monto_gasto) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios (usuario, fecha, nombre o monto)." });
    }

    // 3. Preparamos la consulta SQL
    const sql = `INSERT INTO Gasto (user_id, categoria_id, fecha_gasto, nombre_gasto, descripcion, plazo, monto_gasto) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;

    // 4. Ejecutamos la consulta. Usamos '|| null' por si enviaron esos campos vacíos
    db.query(sql, [
        user_id, 
        categoria_id || null, 
        fecha_gasto, 
        nombre_gasto, 
        descripcion || null, 
        plazo || null, 
        monto_gasto
    ], (err, result) => {
        if (err) {
            console.error("Error al guardar el gasto:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor al guardar el gasto." });
        }

        // 5. Respondemos con éxito
        res.status(201).json({
            mensaje: "¡Gasto registrado exitosamente!",
            gasto_id: result.insertId
        });
    });
});

// ==========================================
// RUTA 4: OBTENER TODOS LOS GASTOS DE UN USUARIO
// ==========================================
app.get('/api/gastos/:user_id', (req, res) => {
    // 1. Extraemos el ID del usuario directamente de la URL
    const userId = req.params.user_id;

    // 2. Preparamos la consulta SQL
    // Usamos ORDER BY fecha_gasto DESC para que los gastos más recientes salgan primero
    const sql = `
        SELECT * FROM Gasto 
        WHERE user_id = ? 
        ORDER BY fecha_gasto DESC
    `;

    // 3. Ejecutamos la consulta
    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error("Error al obtener los gastos:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        // 4. Si el usuario no tiene gastos, 'results' será un arreglo vacío []
        if (results.length === 0) {
            return res.status(200).json({ 
                mensaje: "Este usuario aún no tiene gastos registrados.",
                gastos: [] 
            });
        }

        // 5. Respondemos enviando la lista completa de gastos
        res.status(200).json({
            mensaje: "Gastos obtenidos exitosamente",
            total_gastos: results.length,
            gastos: results
        });
    });
});

// ==========================================
// RUTA 5: ELIMINAR UN GASTO
// ==========================================
app.delete('/api/gastos/:gasto_id', (req, res) => {
    // 1. Extraemos el ID del gasto de la URL
    const gastoId = req.params.gasto_id;

    // 2. Preparamos la consulta SQL
    const sql = `DELETE FROM Gasto WHERE gasto_id = ?`;

    // 3. Ejecutamos la consulta
    db.query(sql, [gastoId], (err, result) => {
        if (err) {
            console.error("Error al eliminar el gasto:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        // 4. Verificamos si realmente se borró algo
        // affectedRows nos dice cuántas filas se borraron. Si es 0, el gasto no existía.
        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: "No se encontró el gasto a eliminar." });
        }

        // 5. Respondemos con éxito
        res.status(200).json({ mensaje: "¡Gasto eliminado exitosamente!" });
    });
});

// ==========================================
// RUTA 6: ELIMINAR UN USUARIO (Y toda su información)
// ==========================================
app.delete('/api/usuarios/:user_id', (req, res) => {
    const userId = req.params.user_id;

    const sql = `DELETE FROM Usuario WHERE user_id = ?`;

    db.query(sql, [userId], (err, result) => {
        if (err) {
            console.error("Error al eliminar el usuario:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado." });
        }

        // Al borrar el usuario, MySQL borra en cascada sus gastos automáticamente
        res.status(200).json({ mensaje: "Cuenta y todos los datos asociados eliminados correctamente." });
    });
});

// ==========================================
// RUTA 7: EDITAR/ACTUALIZAR UN GASTO
// ==========================================
app.put('/api/gastos/:gasto_id', (req, res) => {
    // 1. Extraemos el ID del gasto a modificar desde la URL
    const gastoId = req.params.gasto_id;

    // 2. Extraemos los nuevos datos desde el celular (Postman)
    const { nombre_gasto, monto_gasto, fecha_gasto, descripcion } = req.body;

    // Validación rápida
    if (!nombre_gasto || !monto_gasto || !fecha_gasto) {
        return res.status(400).json({ mensaje: "Faltan datos para actualizar el gasto." });
    }

    // 3. Preparamos la consulta SQL (UPDATE)
    const sql = `
        UPDATE Gasto 
        SET nombre_gasto = ?, monto_gasto = ?, fecha_gasto = ?, descripcion = ? 
        WHERE gasto_id = ?
    `;

    // 4. Ejecutamos la consulta
    db.query(sql, [nombre_gasto, monto_gasto, fecha_gasto, descripcion || null, gastoId], (err, result) => {
        if (err) {
            console.error("Error al actualizar el gasto:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        // Verificamos si el gasto realmente existía
        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: "No se encontró el gasto para editar." });
        }

        // 5. Éxito
        res.status(200).json({ mensaje: "¡Gasto actualizado correctamente!" });
    });
});

// ==========================================
// RUTA 8: EDITAR PERFIL DE USUARIO
// ==========================================
app.put('/api/usuarios/:user_id', (req, res) => {
    // 1. Extraemos el ID del usuario de la URL
    const userId = req.params.user_id;

    // 2. Extraemos los nuevos datos desde el celular
    const { nombre_s, correo_electronico, contrasena } = req.body;

    // Validación rápida
    if (!nombre_s || !correo_electronico || !contrasena) {
        return res.status(400).json({ mensaje: "Faltan datos para actualizar el perfil." });
    }

    // 3. Preparamos la consulta SQL
    const sql = `
        UPDATE Usuario 
        SET nombre_s = ?, correo_electronico = ?, contrasena = ? 
        WHERE user_id = ?
    `;

    // 4. Ejecutamos la consulta
    db.query(sql, [nombre_s, correo_electronico, contrasena, userId], (err, result) => {
        if (err) {
            console.error("Error al actualizar usuario:", err);
            // Si intenta usar un correo que ya le pertenece a otro usuario
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ mensaje: "Ese correo electrónico ya está en uso por otra cuenta." });
            }
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        // Verificamos si el usuario realmente existía
        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: "No se encontró el usuario." });
        }

        // 5. Éxito
        res.status(200).json({ mensaje: "¡Perfil de usuario actualizado correctamente!" });
    });
});

// ==========================================
// RUTA 9: CREAR UN INGRESO
// ==========================================
app.post('/api/ingresos', (req, res) => {
    const { user_id, categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido } = req.body;

    if (!user_id || !categoria_id || !fecha_ingreso || !nombre_ingreso || !monto) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios para el ingreso." });
    }

    const sql = `
        INSERT INTO Ingreso (user_id, categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    // Si 'recibido' no viene en la petición, por defecto será 0 (falso)
    const estatusRecibido = recibido !== undefined ? recibido : 0;

    db.query(sql, [user_id, categoria_id, fecha_ingreso, nombre_ingreso, descripcion || null, monto, estatusRecibido], (err, result) => {
        if (err) {
            console.error("Error al registrar el ingreso:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }
        res.status(201).json({ mensaje: "¡Ingreso registrado exitosamente!", ingreso_id: result.insertId });
    });
});

// ==========================================
// RUTA 10: LEER TODOS LOS INGRESOS DE UN USUARIO
// ==========================================
app.get('/api/ingresos/:user_id', (req, res) => {
    const userId = req.params.user_id;

    // Hacemos un JOIN para que la API devuelva el nombre de la categoría, no solo el número ID
    const sql = `
        SELECT i.*, c.nombre_categoria 
        FROM Ingreso i
        JOIN Categoria_ingreso c ON i.categoria_id = c.categoria_id
        WHERE i.user_id = ?
        ORDER BY i.fecha_ingreso DESC
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error("Error al obtener los ingresos:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }
        res.status(200).json(results);
    });
});

// ==========================================
// RUTA 11: ACTUALIZAR/EDITAR UN INGRESO
// ==========================================
app.put('/api/ingresos/:ingreso_id', (req, res) => {
    const ingresoId = req.params.ingreso_id;
    const { categoria_id, fecha_ingreso, nombre_ingreso, descripcion, monto, recibido } = req.body;

    const sql = `
        UPDATE Ingreso 
        SET categoria_id = ?, fecha_ingreso = ?, nombre_ingreso = ?, descripcion = ?, monto = ?, recibido = ?
        WHERE ingreso_id = ?
    `;

    db.query(sql, [categoria_id, fecha_ingreso, nombre_ingreso, descripcion || null, monto, recibido, ingresoId], (err, result) => {
        if (err) {
            console.error("Error al actualizar el ingreso:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: "No se encontró el ingreso." });
        }
        res.status(200).json({ mensaje: "¡Ingreso actualizado correctamente!" });
    });
});

// ==========================================
// RUTA 12: ELIMINAR UN INGRESO
// ==========================================
app.delete('/api/ingresos/:ingreso_id', (req, res) => {
    const ingresoId = req.params.ingreso_id;

    const sql = `DELETE FROM Ingreso WHERE ingreso_id = ?`;

    db.query(sql, [ingresoId], (err, result) => {
        if (err) {
            console.error("Error al eliminar el ingreso:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: "No se encontró el ingreso a eliminar." });
        }
        res.status(200).json({ mensaje: "¡Ingreso eliminado exitosamente!" });
    });
});

// ==========================================
// RUTA 13: ACTUALIZAR ESTATUS PREMIUM DEL USUARIO
// ==========================================
app.put('/api/usuarios/:user_id/premium', (req, res) => {
    const userId = req.params.user_id;
    
    // Recibimos el estatus (1 para Premium, 0 para Gratuito)
    const { premium } = req.body;

    // Validación para asegurarnos de que envíen un 1 o un 0
    if (premium === undefined) {
        return res.status(400).json({ mensaje: "Debes enviar el nuevo estatus premium (1 o 0)." });
    }

    const sql = `UPDATE Usuario SET premium = ? WHERE user_id = ?`;

    db.query(sql, [premium, userId], (err, result) => {
        if (err) {
            console.error("Error al actualizar estatus Premium:", err);
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado." });
        }

        const mensajeExito = premium === 1 
            ? "¡Felicidades! Ahora eres un usuario Premium." 
            : "Tu suscripción Premium ha sido cancelada.";

        res.status(200).json({ mensaje: mensajeExito });
    });
});

// 4. Encender el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});