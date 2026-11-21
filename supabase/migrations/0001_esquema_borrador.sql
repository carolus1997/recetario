-- Esquema BORRADOR (v0.2, validado contra 5 recetas) para Supabase / PostgreSQL
-- Pendiente de validar con recetas reales. No ejecutar en producción.

create extension if not exists pgcrypto;

-- ===== Hogares y miembros =====
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  primary key (household_id, user_id)
);

-- Helper para RLS
create or replace function is_household_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members
                 where household_id = h and user_id = auth.uid());
$$;

-- ===== Ingredientes =====
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,                -- nombre normalizado
  category text,
  common_units text[] default '{}',
  allergens text[] not null default '{}',
  parent_ingredient_id uuid references ingredients(id) on delete set null, -- alimento base (garbanzo <- garbanzos cocidos)
  state text check (state in ('crudo','seco','cocido','congelado','en_conserva')),
  notes text,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  alias text not null,
  unique (household_id, alias)
);

-- ===== Recetas =====
create table recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  parent_recipe_id uuid references recipes(id) on delete cascade, -- variantes (un nivel)
  variant_label text,
  title text not null,
  description text,
  servings numeric check (servings > 0),
  prep_minutes int check (prep_minutes >= 0),
  cook_minutes int check (cook_minutes >= 0),
  category text,
  difficulty text check (difficulty in ('facil','media','dificil')),
  appliances text[] not null default '{}',
  storage_days int check (storage_days >= 0),
  freezable boolean,                 -- null = no se sabe
  storage_notes text,
  notes text,
  version int not null default 1,          -- control de concurrencia
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_recipe_id is null or variant_label is not null)
);
create index on recipes (household_id, updated_at desc);
create index on recipes (parent_recipe_id);

create table recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  section text,
  body text not null,
  temperature_c int,
  timer_min_seconds int check (timer_min_seconds > 0),
  timer_max_seconds int check (timer_max_seconds >= timer_min_seconds),
  unique (recipe_id, position)
);

create table units (
  code text primary key,                       -- 'g','ml','cucharada','lomo'...
  label_es text not null,                      -- texto visible; el codigo es el identificador estable
  kind text not null check (kind in ('mass','volume','count','spoon')),
  to_base numeric                              -- a g (mass) o ml (volume/spoon); null si no hay equivalencia fiable
);
insert into units (code, label_es, kind, to_base) values
  ('g','g','mass',1),('kg','kg','mass',1000),('ml','ml','volume',1),('l','l','volume',1000),
  ('cucharadita','cucharadita','spoon',5),('cucharada','cucharada','spoon',15),('taza','taza','volume',240),
  ('unidad','unidad','count',null),('diente','diente','count',null),('hoja','hoja','count',null),
  ('lomo','lomo','count',null),('pizca','pizca','count',null);
-- Regla: solo se convierte dentro de la misma magnitud (g<->kg, ml<->l<->cucharada).
-- Volumen->masa y unidad->masa dependen del ingrediente:
create table ingredient_unit_conversions (
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  unit text not null references units(code),
  grams_per_unit numeric not null check (grams_per_unit > 0),
  source text,
  primary key (ingredient_id, unit)
);
-- Regla: no convertir entre estados (seco/crudo <-> cocido) sin factor de rendimiento.
create table ingredient_yields (
  from_ingredient_id uuid not null references ingredients(id) on delete cascade,
  to_ingredient_id uuid not null references ingredients(id) on delete cascade,
  to_per_from numeric not null check (to_per_from > 0),  -- g cocido por g seco
  source text,
  primary key (from_ingredient_id, to_ingredient_id)
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null, -- nulo si sin normalizar
  position int not null,
  section text,
  original_text text,            -- texto tal como se importó/escribió
  display_name text,             -- nombre mostrado si difiere del normalizado
  quantity_min numeric,
  quantity_max numeric,
  unit text references units(code),
  alt_quantity numeric,          -- ej. 4 lomos (aprox. 600 g)
  alt_unit text references units(code),
  quantity_text text,            -- "al gusto", "una pizca", "un chorreón"
  preparation text,              -- "picada fina"
  is_optional boolean not null default false,
  check (quantity_max is null or quantity_min is null or quantity_max >= quantity_min)
);
create index on recipe_ingredients (recipe_id);
create index on recipe_ingredients (ingredient_id);

-- ===== Fotos =====
create table recipe_images (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  step_id uuid references recipe_steps(id) on delete set null,
  cooking_log_id uuid,                       -- reservado: historial futuro
  storage_path text not null,                -- bucket privado
  origin text not null default 'user' check (origin in ('user','imported')),
  is_cover boolean not null default false,
  position int not null default 0,
  width int, height int, bytes int,
  created_at timestamptz not null default now()
);
create unique index one_cover_per_recipe on recipe_images (recipe_id) where is_cover;

-- ===== Procedencia, revisiones =====
create table recipe_sources (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  kind text not null check (kind in ('manual','chatgpt','url','json','paste')),
  url text,
  original_content text,
  imported_at timestamptz not null default now()
);

create table recipe_revisions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,       -- receta + ingredientes + pasos
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (recipe_id, version)
);

-- ===== Etiquetas y favoritos =====
create table tags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  kind text not null default 'otro' check (kind in ('momento','dieta','cocina','tecnica','otro')),
  unique (household_id, name)
);
create table recipe_tags (
  recipe_id uuid not null references recipes(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (recipe_id, tag_id)
);
create table user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  primary key (user_id, recipe_id)
);

-- ===== RLS (patrón; replicar en todas las tablas) =====
alter table recipes enable row level security;
create policy recipes_member_all on recipes
  using (is_household_member(household_id))
  with check (is_household_member(household_id));
-- Tablas hijas (steps, ingredients, images...): política vía join a recipes.
-- Storage: política por prefijo de ruta "<household_id>/<recipe_id>/...".
