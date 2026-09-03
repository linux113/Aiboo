// demo/memory-store.mjs — DEMO-ONLY in-memory persistence adapter.
// Lets the full backend run where no MongoDB is available (this sandbox /
// quick demos). NOT for production: data is volatile and per-process.
// It replaces each model's static methods with array-backed equivalents
// supporting the exact query surface the app uses (find/sort/skip/limit/
// lean/populate/select, findOne, findById[AndUpdate|AndDelete],
// findOneAndUpdate, countDocuments, create, doc.save()).
import bcrypt from 'bcryptjs';

const listeners = new Map(); // modelName -> docs array
const oid = (n) => `demo_${String(n).padStart(8, '0')}`;
let counter = 1;

const clone = (d) => (d && typeof d === 'object' ? JSON.parse(JSON.stringify(d)) : d);

function matches(doc, filter = {}) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      if (!cond.some((sub) => matches(doc, sub))) return false;
      continue;
    }
    let val = doc;
    for (const part of key.split('.')) val = val?.[part];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$ne' in cond && val === cond.$ne) return false;
      if ('$in' in cond && !cond.$in.includes(val)) return false;
      if ('$gte' in cond && !(new Date(val) >= new Date(cond.$gte))) return false;
      if ('$lte' in cond && !(new Date(val) <= new Date(cond.$lte))) return false;
      if ('$regex' in cond && !new RegExp(cond.$regex, cond.$options?.includes('i') ? 'i' : '').test(String(val ?? ''))) return false;
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function sortDocs(docs, spec = {}) {
  const out = [...docs];
  for (const key of Object.keys(spec).reverse()) {
    const dir = spec[key] === -1 ? -1 : 1;
    out.sort((a, b) => {
      const av = key.split('.').reduce((o, k) => o?.[k], a);
      const bv = key.split('.').reduce((o, k) => o?.[k], b);
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
    });
  }
  return out;
}

const chain = (docs) => {
  const state = { docs };
  const api = {
    sort: (s) => { state.docs = sortDocs(state.docs, s); return api; },
    skip: (n) => { state.docs = state.docs.slice(n); return api; },
    limit: (n) => { state.docs = state.docs.slice(0, n); return api; },
    lean: () => Promise.resolve(state.docs.map(clone)),
    populate: () => api,
    select: () => api,
    then: (res, rej) => Promise.resolve(state.docs.map(clone)).then(res, rej),
    catch: (fn) => Promise.resolve(state.docs.map(clone)).catch(fn),
  };
  return api;
};

function attachSave(doc, modelName) {
  doc.save = async function save() {
    const arr = listeners.get(modelName);
    const i = arr.findIndex((d) => d._id === doc._id);
    if (i >= 0) arr[i] = clone(doc);
    return doc;
  };
  return doc;
}

export function adaptModel(Model, modelName, opts = {}) {
  const docs = [];
  listeners.set(modelName, docs);

  Model.find = (filter = {}) => chain(docs.filter((d) => matches(d, filter)));
  // findOne supports .lean()/.select() chaining and await (soar uses findOne().lean())
  const singleChain = (doc) => {
    // resolve to a MUTABLE clone carrying save() — callers like approveIncident do
    // `incident.status = x; await incident.save()` and expect it persisted.
    // Instance methods (User.matchPassword) live as own function props on the stored
    // doc; JSON-clone drops them, so copy function props back over the clone.
    const resolve = () => {
      if (!doc) return null;
      const d = attachSave(clone(doc), modelName);
      for (const k of Object.keys(doc)) {
        if (typeof doc[k] === 'function' && d[k] === undefined) d[k] = doc[k];
      }
      return d;
    };
    const api = {
      lean: () => Promise.resolve(doc ? clone(doc) : null),
      select: () => api,
      then: (res, rej) => Promise.resolve(resolve()).then(res, rej),
      catch: (fn) => Promise.resolve(resolve()).catch(fn),
    };
    return api;
  };
  Model.findOne = (filter = {}) => singleChain(docs.find((d) => matches(d, filter)));
  // findById resolves to a SINGLE document (or null), like mongoose — not the list chain
  Model.findById = (id) => singleChain(docs.find((d) => String(d._id) === String(id)));
  Model.findOneAndUpdate = async (filter, update, opts2 = {}) => {
    const i = docs.findIndex((d) => matches(d, filter));
    if (i < 0) return opts2.new ? null : null;
    const set = update.$set ?? update;
    Object.assign(docs[i], clone(set));
    return clone(docs[i]);
  };
  Model.findByIdAndUpdate = async (id, update, opts2 = {}) => {
    const i = docs.findIndex((d) => String(d._id) === String(id));
    if (i < 0) return null;
    const set = update.$set ?? update;
    Object.assign(docs[i], clone(set));
    return clone(docs[i]);
  };
  Model.findByIdAndDelete = Model.findOneAndDelete = async (idOrFilter) => {
    const i = typeof idOrFilter === 'string'
      ? docs.findIndex((d) => String(d._id) === idOrFilter)
      : docs.findIndex((d) => matches(d, idOrFilter));
    return i < 0 ? null : clone(docs.splice(i, 1)[0]);
  };
  Model.countDocuments = async (filter = {}) => docs.filter((d) => matches(d, filter)).length;
  Model.deleteMany = async (filter = {}) => {
    let n = 0;
    for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], filter)) { docs.splice(i, 1); n++; }
    return { deletedCount: n };
  };
  // Apply mongoose schema defaults for paths the caller omitted (e.g. Playbook.enabled).
  // Real mongoose fills these in on create(); the demo store must too, or filters
  // like { enabled: true } will never match documents created without the field.
  const applyDefaults = (doc) => {
    const paths = Model.schema?.paths;
    if (!paths) return doc;
    for (const [key, type] of Object.entries(paths)) {
      if (key.includes('.') || key === '_id' || doc[key] !== undefined) continue;
      const def = type?.defaultValue;
      if (def === undefined) continue;
      doc[key] = typeof def === 'function' && !(def instanceof Date) ? def() : def;
    }
    return doc;
  };

  Model.create = async (data) => {
    const doc = applyDefaults({ _id: oid(counter++), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...clone(data) });
    if (opts.hashPassword && typeof doc.password === 'string' && !doc.password.startsWith('$2')) {
      doc.password = await bcrypt.hash(doc.password, 10);
    }
    if (opts.hashPassword) {
      const plain = data.password;
      doc.matchPassword = (pw) => bcrypt.compare(pw, doc.password);
      // keep unhashed original off the store
      void plain;
    }
    docs.unshift(doc);
    return opts.returnPlain === false ? doc : clone(doc);
  };
  // keep save()/matchPassword workable on returned docs
  const origCreate = Model.create;
  Model.create = async (data) => {
    const doc = await origCreate(data);
    if (opts.hashPassword) doc.matchPassword = (pw) => bcrypt.compare(pw, doc.password);
    return attachSave(doc, modelName);
  };
  return docs;
}

/** Patch mongoose so server.js boots without a real MongoDB. */
export function installMemoryPersistence(modelModules) {
  for (const [name, mod, opts] of modelModules) adaptModel(mod.default, name, opts ?? {});
}
