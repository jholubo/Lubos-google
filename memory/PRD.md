# PRD - Lubo's Tiramisú (Logística)

## Problema Original
Aplicación de logística para la tienda de tiramisú (Lubo's Tiramisú).

## Requerimientos Centrales
- **Gestión de Usuarios:** Roles de Vendedor, Delivery y Administrador.
- **Diseño:** Interfaz moderna estilo "Bento".
- **Vendedor:** Creación de pedidos, gestión de clientes, cálculo de delivery automático (Haversine, máx 9km) + opción Pickup.
- **Delivery:** Panel optimizado para móviles (PWA). Visualización exclusiva de sus ganancias.
- **Administrador:** Filtros por fecha, métricas divididas por ingreso de productos/delivery, heatmap por monto de ventas, configuración de punto central.
- **Optimizaciones Móviles:** Botón "atrás" cierra modales, auto-polling, sesión persistente hasta medianoche VE, sonido diferenciado.

## Cuentas de Prueba
Ver `/app/memory/test_credentials.md` (jhonny / ivan / oscar).

## Lo Implementado (Feb 2026)
- Cálculo Haversine + Punto central configurable por Admin.
- Heatmap de ventas por monto (puntos individuales).
- Login con ojo de visibilidad, isotipo .webp.
- CRUD Clientes (Admin + inline en Vendor).
- Hook `useBackButtonClose` para botón atrás móvil.
- Expiración de sesión a medianoche Venezuela.
- Auto-polling cada 8s.
- BCV Scraping oficial vía BeautifulSoup como fuente primaria.
- Flujo "Pickup": pedidos sin ubicación, banners y estados.
- Carga de imágenes para sabores (base64).
- Desglose Producto/Delivery/Total en métricas Admin y cards Vendor.
- Métricas económicas solo pedidos con estado distinto a `sin_pagar`/`cancelado`.
- **[Feb 2026]** DeliveryDashboard ahora oculta totales y precios de productos → solo muestra ganancia (`delivery_fee`) y lista de productos a entregar.
- **[Feb 2026]** Fix precisión de mapa de pedidos (~300m offset): `parse_coords_from_url` (backend + frontend) ahora prioriza `!3d!4d` (pin real) sobre `@` (cámara del mapa). Añadido pin arrastrable en el mini-mapa de "Nuevo pedido" para ajuste manual; `OrderCreate` acepta `lat`/`lng` opcionales como override.
- **[Feb 2026]** OrderForm: picker de cliente y botón "+ Nuevo" siempre visibles (antes ocultos si "Solo cotizacion" ON). Al seleccionar/crear cliente, `isQuote` se desactiva automáticamente.
- **[Feb 2026]** Búsqueda fuzzy de clientes (nueva util `lib/searchUtils.js`): normaliza acentos y mayúsculas, matching por subcadenas multi-palabra en orden libre. Aplicado en OrderForm (cmdk `filter`), AdminDashboard (lista clientes) y VendorDashboard (picker + lista).
- **[Feb 2026]** DeliveryMap: reemplazado CSS `resize-y` (no funciona en Safari/iOS en `<div>`) por drag handle JS con eventos mouse + touch. Doble clic restablece altura. Compatible con todos los navegadores.
- **[Feb 2026]** Notificaciones sonoras: mejora para Safari. `AudioContext` compartido y resumido en el primer gesto del usuario; audio unlock retry hasta success; MP3 con `playsinline` + `load()` explícito; fallback WebAudio sintético (bip agudo para venta / grave para bocina) si el MP3 cross-origin falla.
- **[Feb 2026]** Nueva escala de delivery (`services/geo.py` + `admin/ConfigSection.js`): $1.00 tarifa plana 0-2 km, +$0.40 por km después. Sin redondeo.
- **[Feb 2026]** Mini-mapa de "Nuevo pedido" ahora dibuja la ruta real por calles (Google Directions) desde la tienda hasta el pin, con `fitBounds` automático. Fallback a línea recta punteada si Directions API no está habilitada. Badge de estado ("Ruta por calles" / "Línea aproximada").
- **[Feb 2026]** Consistencia de ubicación vendedor↔delivery: cuando el usuario arrastra el pin al crear pedido, el backend reescribe `delivery_address` a URL canónica `https://www.google.com/maps/?q=lat,lng` (pin fijo sin snap). Delivery ahora prioriza abrir esa URL exacta; fallback a `?q=lat,lng` en vez del anterior `search/?api=1` que hacía snap a negocios cercanos.
- **[Feb 2026]** Auto-update BCV: nuevo scheduler async en `services/bcv.py` (`bcv_scheduler_loop`) arrancado desde `server.py`. Actualiza tasa diaria a las 6:00 AM `America/Caracas`. Reintentos horarios si la fuente falla.
- **[Feb 2026]** Removido visualmente el bell de notificaciones del header (`components/Layout.js`). Sonidos siguen funcionando; solo se ocultó el UI.
- **[Feb 2026]** Fotos de perfil de usuarios: nuevo campo `photo_data_url` en modelo User (base64 comprimido a 240x240 JPEG). Nuevo util `lib/imageUtils.js::fileToCompressedDataUrl`. Nuevo componente `Avatar` reutilizable. Admins suben/quitan fotos desde Config → Equipo. Fotos aparecen en el header (usuario actual) y en la fila de Pedidos (avatar del delivery). Backend endpoint `PUT /api/users/{id}` acepta `photo_data_url`. `AuthContext` expone `refreshUser()` para refrescar tras subir foto propia. Response de `/api/orders` enriquecido con `delivery_photo_url` (batch lookup, sin N+1).
- **[Feb 2026]** Nuevos campos de pedido: `velitas` (bool), `receiver_name`, `receiver_phone`. Toggles + campos en OrderForm; se persisten en DB.
- **[Feb 2026]** OrderForm rediseñado a 2 columnas (`grid-cols-[1fr_360px]` en desktop): formulario a la izquierda, panel resumen sticky a la derecha con nombre de cliente, chips de velitas/recibe, resumen de totales y botón Guardar. Móvil se stackea.
- **[Feb 2026]** Vista de delivery ahora muestra 2da tarjeta "Recibe otra persona" con botón WhatsApp que abre chat con mensaje pre-armado; además muestra badge de velitas si aplica.
- **[Feb 2026]** Pedidos (Admin): borde amarillo de 4px a la izquierda en filas Pickup, ícono de vela cuando `velitas=true`, avatar circular del delivery al lado del nombre.
- **[Feb 2026]** DeliveryMap: nuevo botón **"Encuadrar"** (rojo vino) que hace `fitBounds` a la tienda + todos los pedidos visibles. Prop `defaultHeight` configurable.
- **[Feb 2026]** Sidebar rediseñada (`components/Sidebar.js`): incluye logo, avatar del usuario (tamaño 80px, con foto), rol + nombre, nav vertical, `RecordsBar` y footer con BCV + sonido + logout. `Layout.js` se simplifica a solo un top-bar mínimo para móvil.
- **[Feb 2026]** Panel Pedidos (Admin): mapa movido a la **derecha** full-height (grid `xl:grid-cols-[1fr_520px]`, sticky). Lista de pedidos al centro-izquierda.
- **[Feb 2026]** OrderForm: mini-mapa movido de la sección delivery al panel sticky de la derecha, junto al resumen del pedido.
- **[Feb 2026]** Sidebar colapsable + fija-viewport (`fixed left-0 top-0 h-screen`): botón chevron toggle, estado persistido en localStorage (`lubos-sidebar-collapsed`). Custom event `lubos:sidebar-toggle` + hook `useSidebarCollapsed()` para que main content ajuste `padding-left` (60px collapsed / 240px expanded). Layout se simplificó a solo top-bar móvil.
- **[Feb 2026]** DeliveryMap prop `minimal={true}` (usado en Pedidos): oculta header + botones Centrar/Expandir; solo muestra el mapa full-height con botón "Encuadrar" flotante bottom-center. En AdminDashboard el aside del mapa tiene un handle de resize horizontal en el borde izquierdo (arrastra ← → para redimensionar de 360px a 900px; doble clic restablece a 520px; persistido en localStorage).
- **[Feb 2026]** OrderForm layout invertido: panel resumen sticky a la IZQUIERDA (300px) con customer + items + chips arriba, y minimapa + summary + botón Guardar anclados abajo (`mt-auto`). El formulario ocupa el espacio restante a la derecha.
- **[Feb 2026 - Iter 12]** Cotizaciones ficticias: toggle "Solo cotizacion" en OrderForm (sin cliente, no descuenta stock). Banner "Cotizaciones pendientes" en Admin con botón "Retomar" que pre-carga items en el form y usa nuevo endpoint `POST /api/quotes/{id}/convert`.
- **[Feb 2026 - Iter 12]** Fecha de entrega programada: pills "En cola (ASAP)" vs "Programar" + input datetime-local en OrderForm (usa `scheduled_for`).
- **[Feb 2026 - Iter 12]** Historial de movimientos de stock: modal accesible desde cada flavor card en Admin > Sabores. Permite +/- con descripción, muestra resultado calculado y lista de movimientos previos con usuario y fecha.
- **[Feb 2026 - Iter 12]** Delivery > Mis Pedidos: agregado botón "Llamar" (protocolo `tel:`) junto a WhatsApp y Ruta. También en cards de "Disponibles".
- **[Feb 2026 - Iter 12]** Fix: íconos de género (♂/♀) en OrderForm renderizaban texto literal `\u2642`/`\u2640`; ahora usan HTML entities.
- **[Feb 2026]** Cotizaciones ficticias: campo opcional `quote_description` (input justo bajo el toggle) para identificar la cotización; se muestra en la lista de "Cotizaciones pendientes" del Admin.
- **[Feb 2026]** Mapa: ícono de casa "TIENDA" (círculo granate + halo + label) en el punto central configurado. Disponible en Admin/Vendor (Pedidos) y Delivery (Disponibles). El mapa se muestra incluso sin pedidos cuando hay punto central configurado.
- **[Feb 2026]** Check "Preparado" por pedido (admin & vendor) con `PATCH /orders/{id}/prepared`. Guarda `prepared`, `prepared_at`, `prepared_by_name` para saber quien armo cada pedido.
- **[Feb 2026]** UX programar entrega: clic en "Programar" (OrderForm) pre-rellena el input con la fecha/hora actual. EditOrderDialog tiene botón "Ahora" inline junto al input datetime.
- **[Feb 2026]** Pedidos (Admin):
  - Quitado chip y status "Sin Pagar" del listado (ya se maneja en panel "Esperando pago").
  - Gradient sutil derecha→izquierda por estado (ámbar pendiente, azul en_camino, verde entregado, rojo cancelado) → blanco.
  - Cada card ahora muestra badge "Programada para X" y notas del pedido (visibles para quien arma el pedido).
- **[Feb 2026]** Resumen:
  - Quitada métrica "Cancelacion".
  - "Recurrentes" ahora cuenta clientes del periodo que ya tenían compras anteriores al inicio del periodo (cambio en backend: `repeat_in_period` en `/dashboard/report`).
- **[Feb 2026]** Bug fixes UI Pedidos (iter 13): preparado optimistic update (instantáneo), badges informativas con `pointer-events-none` (sin hover feo), sabores sin stock visibles con badge "AGOTADO".
- **[Feb 2026]** Pedidos (iter siguiente): acciones compactas en pill `[✎ ✕ 🗑]`, gradients fixed con valores Tailwind válidos, filtro tipo Ambos/Delivery/Pickup, divisores entre pedidos más visibles.
- **[Feb 2026]** **Refactor backend (iter 14)**: `server.py` 2009→49 líneas. Dividido en `core/` (config, db, security, middleware), `models/schemas.py`, `services/` (geo, bcv, reports), `routes/` (auth, users, customers, flavors, orders, notifications, settings, finance, dashboard, delivery, zones), `seed.py`. Contratos JSON, endpoints, side-effects y schemas Pydantic IDÉNTICOS. Regresión testing_agent: 40/40 backend + 3/3 logins + 6/6 tabs admin.
- **[Feb 2026]** Pedidos (Admin) UX final:
  - Filtros unificados en una sola fila: chips de estado + Desde/Hasta a la IZQUIERDA, toggle Delivery/Pickup/Ambos a la DERECHA (`justify-between`, wrap responsive). `data-testid="orders-filters-bar"`.
  - Metadatos operativos en cada tarjeta como chips estilo notas (icono + info visible), rendereados condicionalmente: `CalendarClock` "Programado: {fecha}", `Cake` "Con velitas", `UserRound` "Recibe: {nombre · teléfono}", `FileText` notas. Chips agrupados en `flex flex-wrap gap-1.5` debajo del cliente/items. Testids: `order-scheduled-{id}`, `order-velitas-{id}`, `order-receiver-{id}`, `order-notes-{id}`, `order-meta-{id}`.
  - Removidos el badge duplicado de `scheduled_for` y el span mini de velitas del header (ahora solo chips).
  - Avatar del delivery en cada tarjeta agrandado de 32px → 48px.
- **[Feb 2026]** Fix mapa "Nuevo pedido": el contenedor usaba `min-h-[280px] h-full` que hacía que `height:100%` del GoogleMap colapsara a 0px (sólo se veían los chips). Cambiado a `h-[220px] md:h-[280px]` explícito en `OrderForm.js::AddressMiniMap`.
- **[Feb 2026]** Performance (>1500 pedidos):
  - Backend: `/api/orders/` cap a **90 días** por defecto cuando no hay `date_from`/`date_to` explícito; `to_list(1000)` → `to_list(500)`.
  - Backend: índices MongoDB creados al `startup` sobre `orders.created_at`, compuestos por `(is_quote, created_at)`, `(delivery_id, status, created_at)`, `(status, order_type)`, y unique en `id` para `orders/customers/users/flavors`; también `notifications.created_at`.
  - Frontend AdminDashboard/VendorDashboard: `loadAll` dividido en `loadFast` (pedidos + stats) y `loadSlow` (flavors/users/settings). Polling **4s → 12s**; los datos "quietos" solo se recargan al montar/enfocar (no en cada tick).
  - Frontend DeliveryDashboard: polling **3s → 8s**; `/settings` sacado del polling (solo al montar/enfocar).

## Arquitectura
- Backend: FastAPI modular: `/app/backend/{server.py, core/, models/, services/, routes/, seed.py}`. Mongo via Motor async (`core/db.py`). Auth JWT (`core/security.py`).
- Frontend: React + Tailwind + Shadcn + Google Maps JS API. Pages en `/app/frontend/src/pages/`.
- DB: MongoDB. Colecciones: users, customers, flavors, orders, notifications, settings, delivery_zones, stock_movements.

## Roadmap (Backlog Priorizado)

### P1
- Panel de rendimiento para Deliverys (facturación/ganancias del día por delivery).
- Barras de Récord Diario/Mensual con sonido especial al romperlo.
- Métodos de pago en pedidos (Pago Móvil, Zelle, Efectivo USD/Bs).
- Cierre de Caja diario exportable a PDF/WhatsApp.
- UX: pre-cargar también `delivery_address`, `notes`, `delivery_fee` al "Retomar" cotización (ya parcialmente hecho — validar).
- Convert quote: avisar al admin si algún sabor de la cotización quedó con stock insuficiente (hoy se omite silenciosamente la decrementación).

### P2
- Botón "Pegar ubicación rápida" o integración con whatsapp-web.js.
- Alertas de stock bajo al admin.
- Sistema de Fidelización/Recompensas (premio al pedido 10).
- Cotizaciones también en VendorDashboard (hoy banner + Retomar solo en Admin).

### P3
- Notificaciones Push Nativas (Web Push API) para delivery en background.
- Mapa Panorama y Ruta Combinada de entregas.

## Refactor Backlog
- `DeliveryDashboard.js` y `VendorDashboard.js` son largos; ya se extrajo `OrderForm.js`. Se puede continuar dividiendo si crecen más.
