'use strict';

const express  = require('express');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const path     = require('path');
const mongoose = require('mongoose');

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

app.use(express.json({ limit: '2mb' }));
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

const reparacionSchema = new mongoose.Schema({
  numero:       { type: Number, index: true },
  fechaIngreso: { type: Date, default: Date.now },
  cliente:      { type: String, required: [true, 'El cliente es obligatorio'], trim: true },
  telefono:     { type: String, trim: true, default: '' },
  marca:        { type: String, trim: true, default: '' },
  modelo:       { type: String, trim: true, default: '' },
  anio:         { type: String, trim: true, default: '' },
  patente:      { type: String, trim: true, uppercase: true, default: '' },
  km:           { type: String, trim: true, default: '' },
  tipo:         { type: String, required: [true, 'El tipo de reparación es obligatorio'], trim: true },
  descripcion:  { type: String, default: '' },
  estado:       { type: String, enum: ['presupuesto_enviado', 'en_reparacion', 'entregado'], default: 'presupuesto_enviado' },
  fechaEntrega: { type: Date, default: null },
  notas:        { type: String, default: '' },
  items:        { type: [itemSchema], default: [] }
}, { timestamps: true });

// Contador auto-incremental para números de presupuesto / reparación
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 }
});
const Counter     = mongoose.model('Counter',     counterSchema);
const Presupuesto = mongoose.model('Presupuesto', presupuestoSchema);
const Reparacion  = mongoose.model('Reparacion',  reparacionSchema);

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
    const doc = await Reparacion.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: 'Reparación no encontrada' });
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
