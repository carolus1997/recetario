-- 0002: permisos, RLS completa, alta de hogar y almacenamiento de fotos.
-- Ejecutar DESPUES de 0001_esquema_borrador.sql.

-- ===== Helpers =====
create or replace function recipe_household(r uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from recipes where id = r;
$$;

create or replace function ingredient_household(i uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from ingredients where id = i;
$$;

create or replace function is_household_owner(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members
                 where household_id = h and user_id = auth.uid() and role = 'owner');
$$;

-- updated_at automatico
create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger recipes_touch before update on recipes
  for each row execute function touch_updated_at();

-- ===== Alta de hogar y de miembros (sin abrir insert directo) =====
create or replace function create_household(h_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  insert into households (name) values (h_name) returning id into hid;
  insert into household_members (household_id, user_id, role) values (hid, auth.uid(), 'owner');
  return hid;
end $$;

-- El propietario añade a otra persona (que ya tenga cuenta) por su correo.
create or replace function add_household_member(h uuid, member_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not is_household_owner(h) then raise exception 'solo el propietario puede anadir miembros'; end if;
  select id into uid from auth.users where lower(email) = lower(member_email);
  if uid is null then raise exception 'no existe un usuario con ese correo'; end if;
  insert into household_members (household_id, user_id, role)
    values (h, uid, 'member') on conflict do nothing;
end $$;

revoke all on function create_household(text) from public, anon;
revoke all on function add_household_member(uuid, text) from public, anon;
grant execute on function create_household(text) to authenticated;
grant execute on function add_household_member(uuid, text) to authenticated;

-- ===== Permisos de la Data API (no se conceden automaticamente) =====
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- Tablas que no se escriben desde el cliente:
revoke insert, update, delete on units from authenticated;
revoke insert, update, delete on households, household_members from authenticated;
grant update (name) on households to authenticated;

-- ===== Activar RLS en todo =====
alter table households enable row level security;
alter table household_members enable row level security;
alter table units enable row level security;
alter table ingredients enable row level security;
alter table ingredient_aliases enable row level security;
alter table ingredient_unit_conversions enable row level security;
alter table ingredient_yields enable row level security;
alter table recipes enable row level security;
alter table recipe_steps enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_images enable row level security;
alter table recipe_sources enable row level security;
alter table recipe_revisions enable row level security;
alter table tags enable row level security;
alter table recipe_tags enable row level security;
alter table user_favorites enable row level security;

-- ===== Politicas =====
create policy households_select on households for select using (is_household_member(id));
create policy households_update on households for update
  using (is_household_owner(id)) with check (is_household_owner(id));

create policy members_select on household_members for select using (is_household_member(household_id));

create policy units_select on units for select to authenticated using (true);

create policy ingredients_all on ingredients
  using (is_household_member(household_id)) with check (is_household_member(household_id));
create policy aliases_all on ingredient_aliases
  using (is_household_member(household_id)) with check (is_household_member(household_id));
create policy conversions_all on ingredient_unit_conversions
  using (is_household_member(ingredient_household(ingredient_id)))
  with check (is_household_member(ingredient_household(ingredient_id)));
create policy yields_all on ingredient_yields
  using (is_household_member(ingredient_household(from_ingredient_id)))
  with check (is_household_member(ingredient_household(from_ingredient_id))
              and ingredient_household(from_ingredient_id) = ingredient_household(to_ingredient_id));

-- recipes ya tiene recipes_member_all (0001)
create policy steps_all on recipe_steps
  using (is_household_member(recipe_household(recipe_id)))
  with check (is_household_member(recipe_household(recipe_id)));
create policy recipe_ingredients_all on recipe_ingredients
  using (is_household_member(recipe_household(recipe_id)))
  with check (is_household_member(recipe_household(recipe_id)));
create policy images_all on recipe_images
  using (is_household_member(recipe_household(recipe_id)))
  with check (is_household_member(recipe_household(recipe_id)));
create policy sources_all on recipe_sources
  using (is_household_member(recipe_household(recipe_id)))
  with check (is_household_member(recipe_household(recipe_id)));
create policy revisions_all on recipe_revisions
  using (is_household_member(recipe_household(recipe_id)))
  with check (is_household_member(recipe_household(recipe_id)));

create policy tags_all on tags
  using (is_household_member(household_id)) with check (is_household_member(household_id));
create policy recipe_tags_all on recipe_tags
  using (is_household_member(recipe_household(recipe_id)))
  with check (is_household_member(recipe_household(recipe_id)));

create policy favorites_own on user_favorites
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_household_member(recipe_household(recipe_id)));

-- ===== Fotos: bucket privado, ruta "<household_id>/<recipe_id>/<archivo>" =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy recipe_images_select on storage.objects for select to authenticated
  using (bucket_id = 'recipe-images'
         and is_household_member(((storage.foldername(name))[1])::uuid));
create policy recipe_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-images'
         and is_household_member(((storage.foldername(name))[1])::uuid));
create policy recipe_images_update on storage.objects for update to authenticated
  using (bucket_id = 'recipe-images'
         and is_household_member(((storage.foldername(name))[1])::uuid));
create policy recipe_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'recipe-images'
         and is_household_member(((storage.foldername(name))[1])::uuid));

-- ===== Realtime =====
alter publication supabase_realtime add table recipes, recipe_ingredients, recipe_steps, recipe_images;
