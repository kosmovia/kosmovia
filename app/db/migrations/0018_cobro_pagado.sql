-- Un cobro (mensaje `[COBRO_B2B:...]`) se paga UNA sola vez: el primero que paga
-- lo cierra para todos.
--
-- Antes, "pagado" solo vivía en el estado de React de quien pagaba: al recargar
-- la página el botón volvía, y otro miembro del canal nunca se enteraba. La
-- tabla `payments` registraba el pago pero no a qué cobro correspondía, así que
-- no había dato con el que impedirlo.
--
-- El índice único parcial es la regla: dos personas pagando a la vez no pueden
-- quedar ambas registradas, lo decide la base y no el cliente. Ojo: el pago ya
-- salió en Stellar antes de llegar acá, así que esto impide el registro doble,
-- no la transferencia doble. Cerrar eso del todo requiere liquidar el cobro en
-- un contrato (etapa C).
--
-- `on delete set null`: si se borra el mensaje del cobro, el pago sigue siendo
-- un pago (la plata se movió); solo pierde a qué cobro apuntaba.

alter table public.payments
  add column if not exists invoice_message_id uuid references public.messages (id) on delete set null;

create unique index if not exists payments_invoice_message_key
  on public.payments (invoice_message_id)
  where invoice_message_id is not null;
