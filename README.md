# BGarage CRM — Taller Automotriz

Sistema de gestión para taller: presupuestos, reparaciones (kanban) e informes PDF.

## Stack
- **Backend**: Node.js + Express + Mongoose
- **Base de datos**: MongoDB Atlas (persistencia real)
- **Auth**: JWT + SHA-256
- **Deploy**: Railway

---

## Variables de entorno requeridas

| Variable       | Descripción                              | Ejemplo                                      |
|----------------|------------------------------------------|----------------------------------------------|
| `JWT_SECRET`   | Clave secreta para firmar tokens JWT     | `bgarage_xK9mL_2025!algoClaveLargo`          |
| `MONGODB_URI`  | String de conexión MongoDB Atlas         | `mongodb+srv://user:pass@cluster.mongodb.net/bgarage` |

---

## Deploy en Railway

1. Sube el proyecto a GitHub
2. En Railway → New Project → Deploy from GitHub repo
3. Ve a **Variables** y agrega `JWT_SECRET` y `MONGODB_URI`
4. Railway detecta automáticamente Node.js y corre `npm start`

---

## Correr localmente

Crea un archivo `.env` en la raíz:
```
JWT_SECRET=cualquier_clave_larga_y_secreta
MONGODB_URI=mongodb+srv://usuario:clave@cluster0.xxxxx.mongodb.net/bgarage
```

Instala dependencias e inicia:
```bash
npm install
npm run dev    # con nodemon (recarga automática)
# o
npm start      # producción
```

Abre http://localhost:3000

---

## Usuarios por defecto

| Usuario  | Contraseña   |
|----------|-------------|
| bastian  | Bgarage2024 |
| admin    | admin123    |

> Cambia las contraseñas en `index.js` antes de publicar.

---

## Estructura del proyecto

```
bgarage/
├── index.js          ← servidor Express + MongoDB + JWT
├── package.json
├── .gitignore
├── README.md
└── public/
    └── index.html    ← frontend completo (sin frameworks)
```
