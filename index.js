'use strict';

const express    = require('express');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const path       = require('path');
const mongoose   = require('mongoose');

// Cloudinary es opcional — si no está instalado el servidor igual arranca
let cloudinary = null;
try {
  cloudinary = require('cloudinary').v2;
} catch (_) {
  console.warn('⚠️   cloudinary no instalado — subida de fotos deshabilitada. Ejecuta: npm install cloudinary');
}

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;

if (!SECRET) {
  console.error('❌  JWT_SECRET no está definido. Agrega la variable de entorno.');
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error('❌  MONGODB_URI no está definido. Agrega la variable de entorno.');
  process.exit(1);
}

// Configurar cloudinary si está instalado y las variables están definidas
if (cloudinary && process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('✅  Cloudinary configurado');
} else if (cloudinary) {
  console.warn('⚠️   CLOUDINARY_* no configurado — subida de fotos deshabilitada');
}

app.use(express.json({ limit: '15mb' }));  // aumentado para fotos en base64
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// CONEXIÓN MONGODB
// ─────────────────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000
  })
  .then(() => console.log('✅  MongoDB Atlas conectado'))
  .catch(err => {
    console.error('❌  Error conectando MongoDB:', err.message);
    process.exit(1);
  });

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMAS + MODELOS
// ─────────────────────────────────────────────────────────────────────────────
const itemSchema = new mongoose.Schema({
  descripcion: { type: String, default: '' },
  tipo:        { type: String, enum: ['mano_obra', 'repuesto'], default: 'mano_obra' },
  valor:       { type: Number, default: 0, min: 0 }
}, { _id: false });

const presupuestoSchema = new mongoose.Schema({
  numero:   { type: Number, index: true },
  fecha:    { type: Date, default: Date.now },
  cliente:  { type: String, required: [true, 'El cliente es obligatorio'], trim: true },
  telefono: { type: String, trim: true, default: '' },
  marca:    { type: String, trim: true, default: '' },
  modelo:   { type: String, trim: true, default: '' },
  anio:     { type: String, trim: true, default: '' },
  patente:  { type: String, trim: true, uppercase: true, default: '' },
  km:       { type: String, trim: true, default: '' },
  notas:    { type: String, default: '' },
  items:    { type: [itemSchema], default: [] }
}, { timestamps: true });

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA REPARACIÓN - ESTADOS REORDENADOS PARA KANBAN
// ═══════════════════════════════════════════════════════════════════════════
// NUEVO ORDEN: 1. presupuesto_enviado → 2. en_reparacion → 3. entregado
// ─────────────────────────────────────────────────────────────────────────────
const reparacionSchema = new mongoose.Schema({
  numero:       { type: Number, index: true },
  fechaIngreso:   { type: Date, default: Date.now },
  cliente:      { type: String, required: [true, 'El cliente es obligatorio'], trim: true },
  telefono:     { type: String, trim: true, default: '' },
  marca:        { type: String, trim: true, default: '' },
  modelo:       { type: String, trim: true, default: '' },
  anio:         { type: String, trim: true, default: '' },
  patente:      { type: String, trim: true, uppercase: true, default: '' },
  km:           { type: String, trim: true, default: '' },
  tipo:         { type: String, required: [true, 'El tipo de reparación es obligatorio'], trim: true },
  descripcion:  { type: String, default: '' },
  
  // ESTADOS REORDENADOS - default ahora es 'presupuesto_enviado' (primera columna)
  estado: { 
    type: String, 
    enum: ['presupuesto_enviado', 'en_reparacion', 'entregado'], 
    default: 'presupuesto_enviado'  // ← CAMBIADO: primera columna del kanban
  },
  
  fechaEntrega: { type: Date, default: null },
  notas:        { type: String, default: '' },
  items:        { type: [itemSchema], default: [] }
}, { timestamps: true });

// Contador auto-incremental para números de presupuesto / reparación
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 }
});

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA FICHA HISTORIAL VEHÍCULO
// ═══════════════════════════════════════════════════════════════════════════
const fichaHistorialSchema = new mongoose.Schema({
  // Identificación del vehículo
  patente:          { type: String, trim: true, uppercase: true, index: true, default: '' },
  marca:            { type: String, trim: true, default: '' },
  modelo:           { type: String, trim: true, default: '' },
  anio:             { type: String, trim: true, default: '' },
  // Propietario
  cliente:          { type: String, trim: true, index: true, default: '' },
  telefono:         { type: String, trim: true, default: '' },
  // Referencia a reparación origen
  reparacionId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Reparacion', default: null },
  numeroReparacion: { type: Number, default: null },
  // Fechas y km
  fechaIngreso:     { type: Date, default: null },
  fechaEntrega:     { type: Date, default: Date.now },
  km:               { type: String, trim: true, default: '' },
  // Trabajo realizado
  tipo:             { type: String, trim: true, default: '' },        // título de la falla
  descripcion:      { type: String, default: '' },
  codigosDTC:       { type: [String], default: [] },                  // ej: ['P0301', 'P0420']
  items:            { type: [itemSchema], default: [] },              // piezas cambiadas
  // Evidencia fotográfica
  fotos:            { type: [String], default: [] },                  // URLs Cloudinary
  // Observaciones adicionales
  notas:            { type: String, default: '' },
}, { timestamps: true });

const Counter        = mongoose.model('Counter',        counterSchema);
const Presupuesto    = mongoose.model('Presupuesto',    presupuestoSchema);
const Reparacion     = mongoose.model('Reparacion',     reparacionSchema);
const FichaHistorial = mongoose.model('FichaHistorial', fichaHistorialSchema);

async function nextNumero(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc.seq;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH: USUARIOS + JWT
// ─────────────────────────────────────────────────────────────────────────────
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

// ⚠️  Cambia las contraseñas antes de subir a producción
const USUARIOS = [
  { id: 1, usuario: 'bastian', hash: sha256('Bgarage2024'), nombre: 'Bastian Espinoza', rol: 'admin'  },
  { id: 2, usuario: 'admin',   hash: sha256('admin123'),   nombre: 'Administrador',    rol: 'viewer' }
];

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No autorizado — falta token' });
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado. Inicia sesión nuevamente.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS: LOGIN
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { usuario, clave } = req.body || {};
  if (!usuario || !clave)
    return res.status(400).json({ error: 'Ingresa usuario y contraseña' });

  const user = USUARIOS.find(
    u => u.usuario === usuario.trim().toLowerCase() && u.hash === sha256(clave)
  );
  if (!user)
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const token = jwt.sign(
    { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol },
    SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, nombre: user.nombre, rol: user.rol });
});

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS: PRESUPUESTOS
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/presupuestos', authMiddleware, async (req, res) => {
  try {
    const docs = await Presupuesto.find().sort({ numero: -1 }).lean();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/presupuestos/:id', authMiddleware, async (req, res) => {
  try {
    const doc = await Presupuesto.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/presupuestos', authMiddleware, async (req, res) => {
  try {
    const numero = await nextNumero('presupuesto');
    const doc = await Presupuesto.create({ ...req.body, numero });
    res.status(201).json(doc.toObject());
  } catch (e) {
    const msg = e.name === 'ValidationError'
      ? Object.values(e.errors).map(x => x.message).join(', ')
      : e.message;
    res.status(400).json({ error: msg });
  }
});

app.put('/api/presupuestos/:id', authMiddleware, async (req, res) => {
  try {
    // Evitar que se sobreescriban numero y fecha originales
    const { numero, fecha, ...body } = req.body;
    const doc = await Presupuesto.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    res.json(doc);
  } catch (e) {
    const msg = e.name === 'ValidationError'
      ? Object.values(e.errors).map(x => x.message).join(', ')
      : e.message;
    res.status(400).json({ error: msg });
  }
});

app.delete('/api/presupuestos/:id', authMiddleware, async (req, res) => {
  try {
    await Presupuesto.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS: REPARACIONES
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/reparaciones', authMiddleware, async (req, res) => {
  try {
    const docs = await Reparacion.find().sort({ createdAt: -1 }).lean();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reparaciones/:id', authMiddleware, async (req, res) => {
  try {
    const doc = await Reparacion.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Reparación no encontrada' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reparaciones', authMiddleware, async (req, res) => {
  try {
    const numero = await nextNumero('reparacion');
    const doc = await Reparacion.create({ ...req.body, numero });
    res.status(201).json(doc.toObject());
  } catch (e) {
    const msg = e.name === 'ValidationError'
      ? Object.values(e.errors).map(x => x.message).join(', ')
      : e.message;
    res.status(400).json({ error: msg });
  }
});

app.put('/api/reparaciones/:id', authMiddleware, async (req, res) => {
  try {
    const { numero, fechaIngreso, ...body } = req.body;

    // Guardar estado anterior para detectar transición → entregado
    const anterior = await Reparacion.findById(req.params.id).lean();

    const doc = await Reparacion.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Reparación no encontrada' });

    // ── Auto-crear ficha historial al marcar como entregado ──────────────
    if (body.estado === 'entregado' && anterior?.estado !== 'entregado') {
      try {
        // Verificar que no exista ya una ficha para esta reparación
        const existe = await FichaHistorial.findOne({ reparacionId: doc._id });
        if (!existe) {
          await FichaHistorial.create({
            patente:          doc.patente,
            marca:            doc.marca,
            modelo:           doc.modelo,
            anio:             doc.anio,
            cliente:          doc.cliente,
            telefono:         doc.telefono,
            reparacionId:     doc._id,
            numeroReparacion: doc.numero,
            fechaIngreso:     doc.fechaIngreso,
            fechaEntrega:     new Date(),
            km:               doc.km,
            tipo:             doc.tipo,
            descripcion:      doc.descripcion,
            codigosDTC:       [],
            items:            doc.items || [],
            notas:            doc.notas || '',
          });
          console.log(`✅  Ficha historial creada — ${doc.patente || doc._id}`);
        }
      } catch (fichaErr) {
        console.error('⚠️  Error creando ficha historial:', fichaErr.message);
        // No falla la operación principal
      }
    }

    res.json(doc);
  } catch (e) {
    const msg = e.name === 'ValidationError'
      ? Object.values(e.errors).map(x => x.message).join(', ')
      : e.message;
    res.status(400).json({ error: msg });
  }
});

app.delete('/api/reparaciones/:id', authMiddleware, async (req, res) => {
  try {
    await Reparacion.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// RUTAS: HISTORIAL DE VEHÍCULOS
// ─────────────────────────────────────────────────────────────────────────────

// Listar fichas (con búsqueda opcional por ?q=)
app.get('/api/historial', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    const filtro = q
      ? { $or: [
          { patente:  { $regex: q, $options: 'i' } },
          { cliente:  { $regex: q, $options: 'i' } },
        ]}
      : {};
    const docs = await FichaHistorial.find(filtro).sort({ fechaEntrega: -1 }).lean();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Obtener una ficha por ID
app.get('/api/historial/:id', authMiddleware, async (req, res) => {
  try {
    const doc = await FichaHistorial.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Ficha no encontrada' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Actualizar ficha (DTC, notas, etc.)
app.put('/api/historial/:id', authMiddleware, async (req, res) => {
  try {
    const { reparacionId, patente, ...body } = req.body;   // proteger campos de origen
    const doc = await FichaHistorial.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Ficha no encontrada' });
    res.json(doc);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Subir foto (base64 → Cloudinary)
app.post('/api/historial/:id/fotos', authMiddleware, async (req, res) => {
  if (!cloudinary || !process.env.CLOUDINARY_CLOUD_NAME)
    return res.status(503).json({ error: 'Cloudinary no configurado. Ejecuta: npm install cloudinary y agrega las variables de entorno.' });
  try {
    const { imagen } = req.body;   // data URL base64
    if (!imagen) return res.status(400).json({ error: 'Falta el campo imagen' });

    const result = await cloudinary.uploader.upload(imagen, {
      folder:    'bgarage/historial',
      public_id: `${req.params.id}_${Date.now()}`,
      overwrite: false,
    });

    const doc = await FichaHistorial.findByIdAndUpdate(
      req.params.id,
      { $push: { fotos: result.secure_url } },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Ficha no encontrada' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar foto de una ficha
app.delete('/api/historial/:id/fotos', authMiddleware, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Falta el campo url' });
    const doc = await FichaHistorial.findByIdAndUpdate(
      req.params.id,
      { $pull: { fotos: url } },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Ficha no encontrada' });

    // Intentar eliminar de Cloudinary también
    if (cloudinary && process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const publicId = url.split('/').slice(-2).join('/').replace(/\.[^.]+$/, '');
        await cloudinary.uploader.destroy(publicId);
      } catch (_) { /* no crítico */ }
    }
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar ficha completa
app.delete('/api/historial/:id', authMiddleware, async (req, res) => {
  try {
    await FichaHistorial.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK SPA
// ─────────────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────────────────────
// INICIO SERVIDOR
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅  BGarage CRM → http://localhost:${PORT}`);
});
