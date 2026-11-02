-- Base de datos de cuentas de DropMusic. Pégalo en Supabase > SQL Editor y pulsa "Run".
-- Crea los perfiles (plan y rol de cada cuenta), el registro de pagos y las reglas de acceso:
-- cada persona solo puede leer su propio perfil y nadie puede darse Pro a sí mismo; eso solo lo
-- hacen la función paypal-capture (después de comprobar el pago) o una cuenta admin.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  plan text not null default 'free' check (plan in ('free', 'pro')),
  pro_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  order_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(10, 2) not null,
  currency text not null,
  created_at timestamptz not null default now()
);

-- Correos que reciben el rol admin al registrarse (o ahora mismo, si ya tienen cuenta).
create table if not exists public.admin_emails (
  email text primary key
);

alter table public.profiles enable row level security;
alter table public.payments enable row level security;
alter table public.admin_emails enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Solo las cuentas con sesión la usan (en las reglas de acceso); sin sesión no hace falta.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Cada quien lee su perfil" on public.profiles;
create policy "Cada quien lee su perfil" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "Los admin cambian planes" on public.profiles;
create policy "Los admin cambian planes" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Cada quien ve sus pagos" on public.payments;
create policy "Cada quien ve sus pagos" on public.payments
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Un admin no puede cambiarse el rol a sí mismo ni a otros desde la app: el rol solo se toca aquí.
create or replace function public.protect_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'El rol solo se cambia desde el panel de Supabase.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_role on public.profiles;
create trigger protect_role before update on public.profiles
  for each row execute function public.protect_role();

-- Cada cuenta nueva recibe su perfil Free (o admin con Pro si su correo está en admin_emails).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin boolean := exists (select 1 from public.admin_emails where lower(email) = lower(new.email));
begin
  insert into public.profiles (id, email, role, plan)
  values (new.id, new.email, case when admin then 'admin' else 'user' end, case when admin then 'pro' else 'free' end)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Solo la llama el trigger, nunca la API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
