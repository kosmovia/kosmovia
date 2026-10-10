-- Kosmovia · Aprende Stellar: lecciones con preguntas y misiones prácticas.
--
-- El contenido de las lecciones vive en el código (lib/core/academia-content.ts)
-- y las respuestas se corrigen en el servidor. Aquí solo se guarda el progreso:
--   academia_progress: la mejor nota de cada lección. `completed_at` se llena la
--     primera vez que se saca 3 de 4 o más (da 50 XP, una sola vez).
--   academia_missions: las misiones prácticas ya verificadas (100 XP cada una,
--     una sola vez).
-- El XP y las insignias NO se guardan: se calculan contando lo completado.
--
-- Idempotente: se puede volver a correr sin romper nada.

create table if not exists public.academia_progress (
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  lesson_id    text not null,
  best_score   integer not null default 0,
  completed_at timestamptz null,
  updated_at   timestamptz not null default now(),
  primary key (profile_id, lesson_id)
);

alter table public.academia_progress drop constraint if exists academia_progress_lesson_id_format;
alter table public.academia_progress add constraint academia_progress_lesson_id_format
  check (lesson_id ~ '^[a-z0-9-]{1,40}$');
alter table public.academia_progress drop constraint if exists academia_progress_score_range;
alter table public.academia_progress add constraint academia_progress_score_range
  check (best_score between 0 and 10);

create table if not exists public.academia_missions (
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  mission_id   text not null,
  completed_at timestamptz not null default now(),
  primary key (profile_id, mission_id)
);

alter table public.academia_missions drop constraint if exists academia_missions_mission_id_format;
alter table public.academia_missions add constraint academia_missions_mission_id_format
  check (mission_id ~ '^[a-z0-9-]{1,40}$');

-- Para la tabla de posiciones de una comunidad (se cruza con members).
create index if not exists academia_progress_completed_idx
  on public.academia_progress (profile_id) where completed_at is not null;
