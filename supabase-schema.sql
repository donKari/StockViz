-- ═══════════════════════════════════════════════════════════════
--  STOCKVIZ — Schéma Supabase
--  Colle ce SQL dans : Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════

-- 1. Table des espaces (rayons / zones)
CREATE TABLE IF NOT EXISTS spaces (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  icon        TEXT DEFAULT '📦',
  color       TEXT DEFAULT '#1D9E75',
  type        TEXT DEFAULT 'general',
  description TEXT DEFAULT '',
  alert_threshold INTEGER DEFAULT 20,
  position    INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table des produits
CREATE TABLE IF NOT EXISTS products (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  space_id    UUID REFERENCES spaces(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  qty         INTEGER DEFAULT 0,
  max_qty     INTEGER DEFAULT 1,
  unit        TEXT DEFAULT '',
  alert       INTEGER DEFAULT 20,
  position    INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Table d'historique des mouvements
CREATE TABLE IF NOT EXISTS history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  space_id    UUID REFERENCES spaces(id) ON DELETE SET NULL,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,       -- 'use', 'restock', 'create', 'delete'
  product_name TEXT NOT NULL,
  space_name  TEXT NOT NULL,
  qty_before  INTEGER,
  qty_after   INTEGER,
  max_qty     INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Table profil utilisateur (sync avec auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name   TEXT,
  plan        TEXT DEFAULT 'free',  -- 'free' | 'pro'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS) — Chaque user ne voit QUE ses données
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE spaces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policies spaces
CREATE POLICY "spaces: own data" ON spaces
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Policies products
CREATE POLICY "products: own data" ON products
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Policies history
CREATE POLICY "history: own data" ON history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Policies profiles
CREATE POLICY "profiles: own data" ON profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ═══════════════════════════════════════════════════════════════
--  TRIGGER — Crée auto un profil à l'inscription
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════
--  TRIGGER — updated_at automatique
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER spaces_updated_at   BEFORE UPDATE ON spaces   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
--  INDEX pour performances
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS spaces_user_idx    ON spaces(user_id);
CREATE INDEX IF NOT EXISTS products_space_idx ON products(space_id);
CREATE INDEX IF NOT EXISTS products_user_idx  ON products(user_id);
CREATE INDEX IF NOT EXISTS history_user_idx   ON history(user_id);
CREATE INDEX IF NOT EXISTS history_date_idx   ON history(created_at DESC);
