/**
 * Registry client — CLI side.
 *
 * All registry data is fetched from the Kenji API (kenjiprotocol.com).
 * No direct GitHub calls. Local disk cache (10 min TTL) to avoid hammering the API.
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const { globalKenji } = require('./paths');

const API_BASE = 'https://kenjiprotocol.com';
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/* ------------------------------
   CACHE HELPERS
------------------------------- */

async function getCachePath() {
  await fs.ensureDir(globalKenji);
  return path.join(globalKenji, 'registry-cache.json');
}

async function readCache() {
  const cachePath = await getCachePath();
  if (!(await fs.pathExists(cachePath))) return null;
  const stat = await fs.stat(cachePath);
  if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
  try {
    return await fs.readJson(cachePath);
  } catch {
    return null;
  }
}

async function writeCache(items) {
  const cachePath = await getCachePath();
  await fs.writeJson(cachePath, items, { spaces: 2 });
}

/* ------------------------------
   FETCH ALL — calls /api/search with no query
------------------------------- */

async function fetchAllItems() {
  const cached = await readCache();
  if (cached) return cached;

  try {
    const res = await axios.get(`${API_BASE}/api/search`, {
      params: { q: '' },
      timeout: 10000
    });
    const items = Array.isArray(res.data) ? res.data : [];
    await writeCache(items);
    return items;
  } catch (err) {
    console.error('Registry API unreachable:', err.message);
    return [];
  }
}

/* ------------------------------
   SEARCH — calls /api/search?q=
------------------------------- */

async function searchRegistry(query) {
  try {
    const res = await axios.get(`${API_BASE}/api/search`, {
      params: { q: query },
      timeout: 10000
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    // Fall back to local cache + filter on error
    const cached = await readCache();
    if (!cached) return [];
    const q = query.toLowerCase();
    return cached.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.namespace?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.tags?.join(' ').toLowerCase().includes(q)
    );
  }
}

/* ------------------------------
   RESOLVE — calls /api/info?name= with cache fallback
------------------------------- */

async function resolveRegistryItem(ref) {
  // Normalise to namespace/name
  const name = ref.includes('/') ? ref : `kenji/${ref}`;

  try {
    const res = await axios.get(`${API_BASE}/api/info`, {
      params: { name },
      timeout: 6000
    });
    if (res.status === 404) return null;
    return res.data ?? null;
  } catch (err) {
    if (err.response?.status === 404) return null;

    // Fall back to local cache
    const items = await readCache();
    if (!items) return null;
    const [namespace, itemName] = name.split('/');
    const found = items.find(
      (i) =>
        i.namespace?.toLowerCase() === namespace.toLowerCase() &&
        i.name?.toLowerCase() === itemName.toLowerCase()
    );
    return found ?? null;
  }
}

/* ------------------------------
   CACHED REGISTRY (compatibility shim for stacks / install)
   Returns { skills: [], stacks: [] } shape for legacy callers.
------------------------------- */

async function getRegistryCached() {
  const items = await fetchAllItems();
  return {
    skills: items.filter((i) => i.type === 'skill'),
    stacks: items.filter((i) => i.type === 'stack')
  };
}

module.exports = {
  searchRegistry,
  resolveRegistryItem,
  getRegistryCached,
  fetchAllItems
};
