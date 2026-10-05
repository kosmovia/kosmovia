-- Kosmovia · foto de comunidad.
-- Una imagen chica (el navegador la recorta y la achica a 256 px) guardada como
-- data URL. El servidor ya revisó el tipo real por sus bytes y el tamaño; este
-- CHECK es la última barrera: solo webp/png/jpeg en base64 y ~64 KB como máximo.

alter table public.communities add column if not exists image text;

alter table public.communities drop constraint if exists communities_image_format;
alter table public.communities add constraint communities_image_format check (
  image is null
  or (image ~ '^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$' and char_length(image) <= 90000)
);
