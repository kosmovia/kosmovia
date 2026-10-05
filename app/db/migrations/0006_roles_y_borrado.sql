-- Kosmovia · roles de comunidad y borrado.
-- 1) Nuevo rol 'moderator' en members (owner > admin > moderator > member).
--    Hoy un moderador puede lo mismo que un miembro; despues moderara mensajes.
-- 2) Borrar una comunidad borra sus miembros, canales y mensajes; borrar un
--    canal borra sus mensajes. (0001 ya los declara ON DELETE CASCADE; aqui se
--    reafirma por si una base quedo con otra regla. Los pagos NO dependen de
--    comunidades y no se tocan.)
--
-- Idempotente: se puede volver a correr sin romper nada.

-- ---------------------------------------------------------------------------
-- Rol 'moderator': se reemplaza el CHECK de members.role.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  -- Cualquier CHECK anterior sobre la columna role (el de 0001 no tenia nombre).
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.members'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%role%'
  loop
    execute format('alter table public.members drop constraint %I', r.conname);
  end loop;
end
$$;

alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('owner', 'admin', 'moderator', 'member'));

-- ---------------------------------------------------------------------------
-- Borrado en cascada: members/channels -> communities y messages -> channels.
-- Solo se rehace la llave foranea que NO sea ya ON DELETE CASCADE, con el mismo
-- nombre y la misma columna.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.conname,
           c.conrelid::regclass  as tabla,
           a.attname             as columna,
           c.confrelid::regclass as destino
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and c.confdeltype <> 'c'
      and (
        (c.conrelid = 'public.members'::regclass  and c.confrelid = 'public.communities'::regclass) or
        (c.conrelid = 'public.channels'::regclass and c.confrelid = 'public.communities'::regclass) or
        (c.conrelid = 'public.messages'::regclass and c.confrelid = 'public.channels'::regclass)
      )
  loop
    execute format(
      'alter table %s drop constraint %I, add constraint %I foreign key (%I) references %s (id) on delete cascade',
      r.tabla, r.conname, r.conname, r.columna, r.destino
    );
  end loop;
end
$$;
