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
// RUTA 1: REGISTRO DE USUARIO
// ==========================================
app.post('/api/registro', (req, res) => {
    // 1. Extraemos los datos que nos enviará Postman (o Kotlin en el futuro)
    const { nombre_s, correo_electronico, contrasena } = req.body;

    // Validación rápida: revisar que no falten datos
    if (!nombre_s || !correo_electronico || !contrasena) {
        return res.status(400).json({ mensaje: "Por favor, completa todos los campos." });
    }

    // 2. Preparamos la consulta SQL para insertar en la tabla que creamos
    const sql = `INSERT INTO Usuario (nombre_s, correo_electronico, contrasena) VALUES (?, ?, ?)`;

    // 3. Ejecutamos la consulta en MySQL
    db.query(sql, [nombre_s, correo_electronico, contrasena], (err, result) => {
        if (err) {
            console.error("Error en el registro:", err);
            // Si el correo ya existe, MySQL lanza un error 'ER_DUP_ENTRY' por la regla UNIQUE que le pusimos
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ mensaje: "Este correo electrónico ya está registrado." });
            }
            return res.status(500).json({ mensaje: "Error interno del servidor." });
        }
        
        // 4. Respondemos a la app que todo salió perfecto
        res.status(201).json({ 
            mensaje: "¡Usuario registrado exitosamente en FREEZE-XPENDS!",
            user_id: result.insertId 
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

// 4. Encender el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});