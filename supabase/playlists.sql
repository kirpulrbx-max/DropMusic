-- Playlists de la comunidad de DropMusic. Pégalo en Supabase > SQL Editor y pulsa "Run".
-- Cualquiera puede verlas; solo una cuenta con sesión puede publicar, y cada quien solo puede
-- cambiar o borrar las suyas. Las canciones se guardan como una lista JSON (solo datos públicos de
-- Spotify: id, título, artista, álbum, duración y portada).

create table if not exists public.community_playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name text not null default 'Alguien de DropMusic' check (char_length(owner_name) between 1 and 40),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  cover text not null default '' check (char_length(cover) <= 500),
  tracks jsonb not null default '[]' check (jsonb_typeof(tracks) = 'array' and jsonb_array_length(tracks) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists community_playlists_created_at on public.community_playlists (created_at desc);

alter table public.community_playlists enable row level security;

drop policy if exists "Todos ven las playlists" on public.community_playlists;
create policy "Todos ven las playlists" on public.community_playlists
  for select to anon, authenticated using (true);

drop policy if exists "Cada quien publica las suyas" on public.community_playlists;
create policy "Cada quien publica las suyas" on public.community_playlists
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "Cada quien cambia las suyas" on public.community_playlists;
create policy "Cada quien cambia las suyas" on public.community_playlists
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Cada quien borra las suyas, y los admin cualquiera" on public.community_playlists;
create policy "Cada quien borra las suyas, y los admin cualquiera" on public.community_playlists
  for delete to authenticated using (owner_id = auth.uid() or public.is_admin());
