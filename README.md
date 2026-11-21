# ByDrop

Pasa archivos y texto entre tu PC, tu móvil y tu iPad, al estilo AirDrop. Es una web que se instala como una app.

**HECHO POR @BYALVARO__**

## Cómo funciona

| Modo | Para qué | Límite |
|---|---|---|
| **Nube** | Textos, enlaces, fotos y documentos. Se guardan y aparecen al instante en tus otros dispositivos. Se borran solos a la hora que elijas (24 h si no eliges nada). | 50 MB por archivo, 1 GB en total (plan gratis de Supabase) |
| **Directo** | Archivos grandes (vídeos, hasta 2 GB o más). Van de un dispositivo a otro sin pasar por la nube. | Los dos dispositivos tienen que tener ByDrop abierto |
| **Sala para amigos** | Pasarle algo a un amigo sin que tenga cuenta: escanea el QR o pone el código. | Igual que Directo |
| **Enlace para un amigo** | Cualquier cosa de tu nube → menú `···` → «Crear enlace». El enlace deja de funcionar cuando el elemento caduca. | — |

## Instalación (unos 10 minutos, solo una vez)

### 1. Crear el proyecto en Supabase
1. Entra en **supabase.com** → *Start your project* (puedes registrarte con GitHub).
2. **New project** → nombre `bydrop`, pon una contraseña cualquiera y la región **West EU (Ireland)** o **Central EU (Frankfurt)** → *Create*.
3. Cuando termine de crearse: menú izquierdo → **SQL Editor** → *New query* → pega **todo** el archivo `supabase/setup.sql` → **Run**. Tiene que salir «Success».

### 2. Crear tu usuario
1. Menú izquierdo → **Authentication** → **Users** → **Add user** → *Create new user*.
2. Pon tu correo y una contraseña y marca **Auto Confirm User** → *Create user*.
3. Para que nadie más pueda registrarse y gastar tu espacio: **Authentication** → **Sign In / Providers** (o *Settings*) → desactiva **Allow new users to sign up** → *Save*.

### 3. Conectar la app con Supabase
1. **Project Settings** (rueda dentada) → **Data API**: copia la **Project URL**.
2. **Project Settings** → **API Keys**: copia la **Publishable key** (si no aparece, usa la *anon public* de la pestaña *Legacy*).
3. Abre `config.js` y pega las dos:
   ```js
   export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_...';
   ```
   La clave *publishable* puede ir en la web sin problema: está hecha para eso, y la seguridad la ponen las reglas del `setup.sql`.

### 4. Subirlo a GitHub Pages
1. En GitHub → **New repository** → nombre `ByDrop`, **Public** → *Create*.
2. *uploading an existing file* → arrastra **todo el contenido** de esta carpeta (no la carpeta en sí) → *Commit*.
3. **Settings** → **Pages** → *Source: Deploy from a branch* → rama `main`, carpeta `/ (root)` → *Save*.
4. En un minuto la tendrás en: **https://byalvaroo.github.io/ByDrop/**

### 5. Instalarla en cada dispositivo
- **iPhone / iPad:** abre el enlace en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.
- **Android:** Chrome → menú ⋮ → **Instalar aplicación**.
- **PC:** Chrome o Edge → icono de instalar en la barra de direcciones.

Inicia sesión una vez en cada dispositivo y listo. Te recomiendo cambiar el nombre de cada uno en Ajustes (⚙️), por ejemplo «iPad de Álvaro».

## Trucos
- **PC:** arrastra archivos a la ventana o pega capturas con **Ctrl+V**. **Enter** envía y **Shift+Enter** hace un salto de línea.
- **Móvil/iPad:** el botón 📋 pega lo que tengas copiado. Al descargar se abre la hoja de compartir: «Guardar imagen» las manda a Fotos y «Guardar en Archivos» a Archivos.
- Si añades un archivo de más de 50 MB, la app te propone mandarlo en **Directo**.
- Entre tus propios dispositivos, Directo acepta los envíos solo, como AirDrop. Los amigos de una sala tienen que aceptar.

## Cosas a tener en cuenta
- **Supabase pausa los proyectos gratis tras 7 días sin uso.** Si te pasa, entra en supabase.com y dale a *Restore project*. Usándola a menudo no ocurre.
- **Directo** va mejor con los dos dispositivos en la **misma Wi-Fi**. Entre redes distintas (por ejemplo, datos móviles) suele funcionar, pero algunas redes lo bloquean.
- Mientras se envía o recibe algo en Directo, **deja la app abierta** (la pantalla no se apaga sola). En el iPad, los archivos muy grandes (más de 1–2 GB) dependen de la memoria que tenga libre.
- **Para actualizar la app** después de cambiar archivos, sube el número de `VERSION` en `sw.js` (por ejemplo `bydrop-v2`). La versión nueva se carga la siguiente vez que abras la app.

## Archivos
```
index.html            estructura
styles.css            diseño (claro/oscuro automático)
app.js                lógica principal (nube, salas, ajustes)
js/direct.js          envío directo (WebRTC)
js/util.js            utilidades
config.js             ← tus datos de Supabase
sw.js                 caché para que abra al instante
manifest.webmanifest  para instalarla como app
icons/                iconos
supabase/setup.sql    ← pegar en Supabase
```
