-- Kosmonautas: avatar armado por rasgos (lib/avatar/kosmonautas.ts).
-- 1. Suma el estilo 'kosmonauta' (la lista debe coincidir con AVATAR_STYLES de
--    lib/avatar/generator.ts; hay un test que lo comprueba).
-- 2. Su semilla es un código canónico "k1.<7 posiciones>" (sin ceros a la izquierda).
-- 3. Cada Kosmonauta es de una sola persona.

alter table public.profiles drop constraint if exists profiles_avatar_style_known;
alter table public.profiles
  add constraint profiles_avatar_style_known
    check (avatar_style is null or avatar_style in
      ('astronaut', 'planet', 'constellation', 'rocket', 'nebula', 'portal', 'eclipse', 'kosmonauta'));

alter table public.profiles drop constraint if exists profiles_kosmonauta_code;
alter table public.profiles
  add constraint profiles_kosmonauta_code
    check (avatar_style is distinct from 'kosmonauta' or avatar_seed ~ '^k1(\.(0|[1-9][0-9]?)){7}$');

create unique index if not exists profiles_kosmonauta_key
  on public.profiles (avatar_seed) where avatar_style = 'kosmonauta';
