# Revelox

## ¿Qué es Revelox?

Revelox es una plataforma diseñada para ayudar a las personas a conocerse antes de establecer vínculos importantes.

Cada usuario construye un perfil mediante tarjetas. Cada tarjeta representa una dimensión específica de su identidad y contiene una redacción escrita por el propio titular.

Los visitantes pueden desbloquear individualmente las tarjetas mediante un pago en XNO (Nano), descubriendo progresivamente quién es realmente esa persona.

El objetivo no es responder preguntas aisladas, sino construir una imagen mental cada vez más completa del titular.

---

# Propósito

Las personas solemos construir relaciones importantes con información limitada.

Una amistad, una relación de pareja, una sociedad, una contratación o una colaboración suelen comenzar con conversaciones superficiales y una imagen incompleta de la otra persona.

Revelox nace para reducir esa incertidumbre.

Permite que cada persona revele voluntariamente quién es, cómo piensa, qué siente, qué ha vivido, cuáles son sus valores, sus aspiraciones y las personas que han marcado su vida.

Así, cualquier visitante puede descubrir progresivamente su identidad antes de decidir si desea establecer un vínculo más profundo.

Revelox no pretende sustituir la experiencia de conocer a alguien.

Pretende hacer que ese proceso sea más consciente, transparente e informado.

Porque cuanto mejor conocemos a una persona, mejores decisiones podemos tomar sobre los vínculos que construimos con ella.

---

# Filosofía

Las tarjetas no existen para hacer preguntas.

Existen para revelar partes de la identidad humana.

Cada tarjeta representa una dimensión distinta del titular.

Mientras más tarjetas descubre un visitante, más completa es la imagen mental que construye sobre esa persona.

---

# Reglas de las tarjetas

* Deben describir al titular.
* Deben comenzar por "Mi..." o "Yo".
* Cada tarjeta representa una única dimensión de la identidad.
* Deben permitir una redacción libre.
* Cada tarjeta debe contener un mínimo de 100 palabras.
* No existe límite máximo.
* Deben despertar curiosidad.
* Deben ayudar a comprender mejor al titular.

---

# Criterios para crear nuevas tarjetas

Toda nueva tarjeta deberá cumplir las siguientes condiciones:

* Representar una dimensión de la identidad humana que todavía no exista.
* No duplicar otra tarjeta.
* Generar suficiente curiosidad como para justificar un pago.
* Ayudar a construir una imagen más completa del titular.
* Mantener relevancia con el paso del tiempo.

Si no cumple todas estas condiciones, no debe formar parte de Revelox.

---

# Principio de calidad

Una tarjeta mediocre vale menos que no tener tarjeta.

La calidad siempre tendrá prioridad sobre la cantidad.

---

# Visión

Revelox aspira a convertirse en el mapa de identidad humana más completo del mundo.

No pretende medir popularidad.

No pretende recopilar datos.

Pretende ayudar a las personas a conocerse mejor antes de decidir construir relaciones importantes.

---

# Despliegue en VPS

Desde el servidor:

```bash
cd /root/revelox
npm run deploy:vps
```

El script descarga la última versión de GitHub, instala dependencias, compila la web, publica `dist` en Nginx y reinicia la API.

Variables opcionales:

```bash
APP_DIR=/root/revelox WEB_DIR=/var/www/revelox BRANCH=main SERVICE_NAME=revelox-api npm run deploy:vps
```
