# Revelox

Plataforma de perfiles con respuestas desbloqueables mediante Nano (XNO).

## Stack inicial

- React 19
- TypeScript
- Vite
- lucide-react

## Comandos

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Flujo actual

- El login abre la wallet y detecta automaticamente la cuenta que paga.
- El backend valida el pago confirmado antes de iniciar la sesion.
- Cada wallet tiene un unico perfil y un enlace fijo derivado de su direccion.
- Revelox controla un catalogo plano y permanente de preguntas.
- El creador responde solo las preguntas que desea publicar y define su precio.
- Puede editar, agregar o eliminar sus respuestas sin cambiar el enlace.
- El enlace aparece al iniciar sesion y no cambia al editar las respuestas.
- El perfil publico oculta las respuestas y solicita el pago a la wallet del dueño.
- El backend valida remitente, receptor e importe antes de revelar una respuesta.
- Cada hash de pago solo puede utilizarse una vez.

## Cuestionario

El cuestionario actual funciona como plantilla base mientras se define una
version definitiva. Es plano, no secuencial, y cada pregunta funciona como un
formulario independiente con campos obligatorios y precio propio en XNO.

Preguntas actuales:

- Nombre completo.
- Fecha de nacimiento.
- Numero de contacto.
- Ciudad y barrio de residencia.

Revelox añade una fraccion unica al importe de cada solicitud durante 15 minutos.
Esto permite identificar automaticamente la wallet que pago sin pedir su
direccion manualmente.

## Verificacion Nano

La API consulta primero el nodo configurado en `NANO_RPC_URL`. Si el nodo falla,
se demora o todavia no encuentra el pago exacto, consulta las URLs separadas por
coma en `NANO_RPC_FALLBACK_URLS`.

```env
NANO_RPC_URL=http://127.0.0.1:7076
NANO_RPC_FALLBACK_URLS=https://rpc.nano.to
NANO_RPC_TIMEOUT_MS=8000
```

Para desarrollo, `npm run dev` inicia Vite y la API local. Los perfiles, sesiones
y hashes usados se guardan en `server/data/revelox.json`, excluido de Git.

## Limitaciones actuales

- El almacenamiento local JSON debe sustituirse por una base de datos antes de
  escalar o desplegar varias instancias.
- Las respuestas se guardan fuera del enlace, pero aun no estan cifradas en reposo.
- La autenticacion demuestra un pago desde la wallet, no una firma criptografica.

## Tasa XNO/USD

La referencia visible `1 XNO = X USD` se edita manualmente en:

```ts
src/config/xnoRate.ts
```

Actualiza el valor de `xnoUsdRate` segun el precio diario de Nano.

## Compra de XNO

El enlace a la tienda externa del creador se configura en:

```env
VITE_XNO_CREATOR_STORE_URL=https://direccion-de-la-tienda.example
```

## Proximos pasos sugeridos

- Base de datos y cifrado de respuestas.
- Autenticacion del dueño mediante prueba de control de la wallet.
- Panel para administrar el catalogo plano de preguntas.
- Historial de desbloqueos por visitante.
