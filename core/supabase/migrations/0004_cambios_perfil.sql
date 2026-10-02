-- Límites de cambio en el perfil:
--   @usuario: una vez cada 24 horas.
--   Kosmonauta (avatar_seed / avatar_style): una vez cada 3 días.
-- El primer cambio después de crear el perfil está permitido. Las fechas las
-- pone solo este trigger: un cliente no puede escribirlas ni borrarlas.

alter table public.profiles
  add column if not exists username_changed_at timestamptz,
  add column if not exists avatar_changed_at timestamptz;

create or replace function public.profiles_change_cooldown()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is distinct from old.username then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '24 hours' then
      raise exception 'cooldown:username'
        using errcode = 'P0001', hint = 'El @usuario se puede cambiar una vez cada 24 horas.';
    end if;
    new.username_changed_at := now();
  else
    new.username_changed_at := old.username_changed_at;
  end if;

  if new.avatar_seed is distinct from old.avatar_seed or new.avatar_style is distinct from old.avatar_style then
    if old.avatar_changed_at is not null and old.avatar_changed_at > now() - interval '3 days' then
      raise exception 'cooldown:avatar'
        using errcode = 'P0001', hint = 'El avatar se puede cambiar una vez cada 3 dias.';
    end if;
    new.avatar_changed_at := now();
  else
    new.avatar_changed_at := old.avatar_changed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_change_cooldown on public.profiles;
create trigger profiles_change_cooldown
  before update on public.profiles
  for each row execute function public.profiles_change_cooldown();

-- Al crear el perfil las fechas quedan vacías (no se pueden fijar desde afuera).
create or replace function public.profiles_change_cooldown_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.username_changed_at := null;
  new.avatar_changed_at := null;
  return new;
end;
$$;

drop trigger if exists profiles_change_cooldown_insert on public.profiles;
create trigger profiles_change_cooldown_insert
  before insert on public.profiles
  for each row execute function public.profiles_change_cooldown_insert();
