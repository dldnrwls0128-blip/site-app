/** IndexedDB 래퍼 — 기획 v0.3 스키마 */
export const DB_NAME = "hyeonjang-gwanri";
export const DB_VERSION = 2;
export const STORES = [
  "sites",
  "locations",
  "trades",
  "records",
  "media",
  "checklistTemplates",
  "drawings",
  "specOverrides",
];

export function uid() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

let _dbp;

export function openDb() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: "id" });
        if (name === "records") {
          store.createIndex("by_location", "locationId", { unique: false });
          store.createIndex("by_trade", "tradeId", { unique: false });
          store.createIndex("by_type", "type", { unique: false });
          store.createIndex("by_created", "createdAt", { unique: false });
        } else if (name === "media") {
          store.createIndex("by_record", "recordId", { unique: false });
        } else if (name === "locations") {
          store.createIndex("by_site", "siteId", { unique: false });
          store.createIndex("by_parent", "parentId", { unique: false });
        } else if (name === "drawings") {
          store.createIndex("by_location", "locationId", { unique: false });
          store.createIndex("by_trade", "tradeId", { unique: false });
        } else if (name === "checklistTemplates") {
          store.createIndex("by_trade", "tradeId", { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbp;
}

function complete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function add(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).add(value);
  await complete(tx);
  return value;
}

export async function put(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await complete(tx);
  return value;
}

export async function get(store, id) {
  const db = await openDb();
  return request(db.transaction(store, "readonly").objectStore(store).get(id));
}

export async function getAll(store) {
  const db = await openDb();
  return request(db.transaction(store, "readonly").objectStore(store).getAll());
}

export async function remove(store, id) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(id);
  await complete(tx);
}

export async function clearStore(store) {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).clear();
  await complete(tx);
}

export async function getByIndex(store, index, key) {
  const db = await openDb();
  return request(
    db.transaction(store, "readonly").objectStore(store).index(index).getAll(key)
  );
}

/** 백업 복원: 모든 저장소를 교체한다. */
export async function replaceAll(payload) {
  const db = await openDb();
  const tx = db.transaction(STORES, "readwrite");
  for (const name of STORES) {
    const os = tx.objectStore(name);
    os.clear();
    for (const row of payload[name] || []) os.put(row);
  }
  await complete(tx);
}

export async function counts() {
  const db = await openDb();
  const tx = db.transaction(STORES, "readonly");
  const out = {};
  await Promise.all(
    STORES.map(async (name) => {
      out[name] = await request(tx.objectStore(name).count());
    })
  );
  await complete(tx);
  return out;
}

export async function isEmpty() {
  const sites = await getAll("sites");
  return sites.length === 0;
}

/** 첫 실행용 샘플 데이터 */
export async function seedIfEmpty() {
  if (!(await isEmpty())) return false;

  const siteId = uid();
  const site = { id: siteId, name: "샘플현장" };

  const tradeNames = ["철근", "거푸집", "콘크리트", "방수", "조적", "마감", "전기", "설비", "소방"];
  const trades = tradeNames.map((name, i) => ({ id: uid(), name, order: i + 1 }));

  function loc(partial) {
    return { id: uid(), siteId, parentId: null, type: "동", name: "", order: 0, ...partial };
  }
  const dong101 = loc({ type: "동", name: "101동", order: 1 });
  const dong102 = loc({ type: "동", name: "102동", order: 2 });
  const dongCommon = loc({ type: "동", name: "공용", order: 100, isCommon: true });
  // 동별로 최상층을 다르게: 101동 1~2층, 102동 1~3층
  const floors = [];
  const units = [];
  function addFloors(dong, fromN, toN, unitCount) {
    for (let n = fromN; n <= toN; n++) {
      const f = loc({ type: "층", name: `${n}층`, parentId: dong.id, order: n, floorNo: n });
      floors.push(f);
      for (let i = 1; i <= unitCount; i++) {
        units.push(loc({ type: "호수", name: `${n}${String(i).padStart(2, "0")}호`, parentId: f.id, order: i }));
      }
    }
  }
  addFloors(dong101, 1, 2, 2);
  addFloors(dong102, 1, 3, 2);
  const core = loc({ type: "구역", name: "코어", parentId: floors[0].id, order: 9 });
  const locations = [dong101, dong102, dongCommon, ...floors, ...units, core];

  let templates = [];
  try {
    const { seedTemplates } = await import("./templates.js");
    templates = await seedTemplates(trades);
  } catch (e) {
    console.warn("기본 템플릿 로드 실패, 비워 둡니다.", e);
  }

  const db = await openDb();
  const tx = db.transaction(STORES, "readwrite");
  tx.objectStore("sites").add(site);
  for (const l of locations) tx.objectStore("locations").add(l);
  for (const tr of trades) tx.objectStore("trades").add(tr);
  for (const c of templates) tx.objectStore("checklistTemplates").put(c);
  await complete(tx);

  const firstFloor = floors[0];
  const firstUnit = units.find((u) => u.parentId === firstFloor.id);
  const rebar = trades.find((x) => x.name === "철근") || trades[0];
  return { siteId, locationId: firstUnit?.id || firstFloor.id, tradeId: rebar.id, floorId: firstFloor.id, dongId: dong101.id };
}

export async function loadAll() {
  const lists = await Promise.all(STORES.map((s) => getAll(s)));
  const out = {};
  STORES.forEach((s, i) => { out[s] = lists[i]; });
  return out;
}
