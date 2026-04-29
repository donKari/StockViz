/**
 * ═══════════════════════════════════════════════════════════════
 *  STOCKVIZ — API Layer (supabase-api.js)
 *  Ce fichier encapsule tous les appels à Supabase.
 *  Importé dans stock.html via <script src="supabase-api.js">
 * ═══════════════════════════════════════════════════════════════
 */

// ── CONFIG — Remplace avec tes vraies valeurs (identiques à auth.html)
const SUPABASE_URL     = 'https://VOTRE_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'VOTRE_ANON_KEY';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ════════════════════════════════════════════
   AUTH HELPERS
════════════════════════════════════════════ */

/** Récupère la session courante */
async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

/** Récupère l'utilisateur courant */
async function getUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

/** Récupère le profil (prénom, plan…) */
async function getProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (error) console.error('getProfile:', error);
  return data;
}

/** Mise à jour du profil */
async function updateProfile(userId, updates) {
  const { error } = await sb.from('profiles').update(updates).eq('id', userId);
  if (error) console.error('updateProfile:', error);
  return !error;
}

/** Déconnexion */
async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'auth.html';
}

/* ════════════════════════════════════════════
   SPACES CRUD
════════════════════════════════════════════ */

async function loadSpaces(userId) {
  const { data, error } = await sb
    .from('spaces')
    .select('*, products(*)')
    .eq('user_id', userId)
    .order('position')
    .order('created_at', { ascending: true });
  if (error) { console.error('loadSpaces:', error); return []; }

  // Renomme max_qty → max pour compatibilité avec le code existant
  return (data || []).map(s => ({
    ...s,
    alertThreshold: s.alert_threshold,
    products: (s.products || []).map(p => ({
      ...p,
      max: p.max_qty,
      alert: p.alert
    }))
  }));
}

async function createSpace(userId, space) {
  const { data, error } = await sb.from('spaces').insert({
    user_id: userId,
    name: space.name,
    icon: space.icon,
    color: space.color,
    type: space.type || 'general',
    description: space.desc || '',
    alert_threshold: space.alertThreshold || 20
  }).select().single();
  if (error) { console.error('createSpace:', error); return null; }
  return { ...data, alertThreshold: data.alert_threshold, products: [] };
}

async function updateSpace(spaceId, updates) {
  const mapped = {};
  if (updates.name !== undefined) mapped.name = updates.name;
  if (updates.icon !== undefined) mapped.icon = updates.icon;
  if (updates.color !== undefined) mapped.color = updates.color;
  if (updates.alertThreshold !== undefined) mapped.alert_threshold = updates.alertThreshold;
  if (updates.desc !== undefined) mapped.description = updates.desc;

  const { error } = await sb.from('spaces').update(mapped).eq('id', spaceId);
  if (error) console.error('updateSpace:', error);
  return !error;
}

async function deleteSpace(spaceId) {
  const { error } = await sb.from('spaces').delete().eq('id', spaceId);
  if (error) console.error('deleteSpace:', error);
  return !error;
}

/* ════════════════════════════════════════════
   PRODUCTS CRUD
════════════════════════════════════════════ */

async function createProduct(userId, spaceId, product) {
  const { data, error } = await sb.from('products').insert({
    user_id: userId,
    space_id: spaceId,
    name: product.name,
    qty: product.qty || 0,
    max_qty: product.max || 1,
    unit: product.unit || '',
    alert: product.alert || 20
  }).select().single();
  if (error) { console.error('createProduct:', error); return null; }
  return { ...data, max: data.max_qty };
}

async function updateProduct(productId, updates) {
  const mapped = {};
  if (updates.name !== undefined)  mapped.name    = updates.name;
  if (updates.qty !== undefined)   mapped.qty     = updates.qty;
  if (updates.max !== undefined)   mapped.max_qty = updates.max;
  if (updates.unit !== undefined)  mapped.unit    = updates.unit;
  if (updates.alert !== undefined) mapped.alert   = updates.alert;

  const { error } = await sb.from('products').update(mapped).eq('id', productId);
  if (error) console.error('updateProduct:', error);
  return !error;
}

async function deleteProduct(productId) {
  const { error } = await sb.from('products').delete().eq('id', productId);
  if (error) console.error('deleteProduct:', error);
  return !error;
}

/* ════════════════════════════════════════════
   HISTORY
════════════════════════════════════════════ */

async function logHistory(userId, entry) {
  const { error } = await sb.from('history').insert({
    user_id: userId,
    space_id: entry.spaceId || null,
    product_id: entry.productId || null,
    action: entry.action,
    product_name: entry.productName,
    space_name: entry.spaceName,
    qty_before: entry.qtyBefore,
    qty_after: entry.qtyAfter,
    max_qty: entry.maxQty
  });
  if (error) console.error('logHistory:', error);
}

async function loadHistory(userId, limit = 100) {
  const { data, error } = await sb
    .from('history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('loadHistory:', error); return []; }
  return data || [];
}

/* ════════════════════════════════════════════
   REALTIME SUBSCRIPTIONS (optionnel)
   Permet à plusieurs onglets/utilisateurs
   de voir les mises à jour en direct.
════════════════════════════════════════════ */

function subscribeToChanges(userId, onUpdate) {
  return sb
    .channel('stockviz-changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'products',
      filter: `user_id=eq.${userId}`
    }, onUpdate)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'spaces',
      filter: `user_id=eq.${userId}`
    }, onUpdate)
    .subscribe();
}
