/**
 * Python data models — ORM entities, their columns and relationships, read
 * from module outlines so both parser tiers classify the same way.
 *
 * Entities are ORM models: SQLAlchemy (classic `Column` and 2.0
 * `Mapped`/`mapped_column`, on a `DeclarativeBase` subclass, a
 * `declarative_base()` result or `db.Model`), Django `models.Model`
 * subclasses, and SQLModel classes declared `table=True`. Abstract bases are
 * not entities; their fields are inherited. Pydantic classes are request and
 * response schemas; they are the data model only when the project has no ORM
 * model, as Zod schemas are for a JavaScript project with no ORM.
 *
 * Relationship attributes are relationships, not columns. Each relationship
 * carries its cardinality, and its two sides (`back_populates`, a foreign key
 * and the collection pointing back) produce one edge.
 *
 * @implements docguard.python-extraction#FR-005
 * @implements docguard.python-extraction#FR-006
 * @implements docguard.python-extraction#FR-007
 * @implements docguard.python-extraction#FR-008
 */
import { relative } from 'node:path';
import { findPythonFiles, loadPythonOutlines, PythonIndex, refTail } from './py-outline.mjs';

const SQLA_COLUMN = new Set(['Column', 'mapped_column']);
const SQLA_RELATION = new Set(['relationship', 'relation']);
const SQLA_NOT_COLUMN = new Set(['column_property', 'synonym', 'deferred', 'composite', 'association_proxy', 'query_expression', 'with_expression']);
const DJANGO_RELATION = new Set(['ForeignKey', 'OneToOneField', 'ManyToManyField', 'ParentalKey', 'ParentalManyToManyField']);
const DJANGO_SKIP = new Set(['GenericForeignKey', 'GenericRelation', 'ManyToManyField', 'ParentalManyToManyField']);
const COLLECTIONS = new Set(['List', 'list', 'Set', 'set', 'FrozenSet', 'frozenset', 'Sequence', 'MutableSequence', 'Iterable', 'Collection', 'Tuple', 'tuple', 'DynamicMapped', 'WriteOnlyMapped', 'AppenderQuery']);
const WRAPPERS = new Set(['Mapped', 'Annotated', 'Final', 'Required', 'NotRequired', 'ReadOnly']);

/**
 * The Python types an annotation names.
 * @returns {{type: string, optional: boolean, collection: boolean, target: string|null}}
 */
export function pythonType(expr) {
  const none = { type: '', optional: false, collection: false, target: null };
  if (!expr) return none;
  switch (expr.t) {
    case 'ref': {
      const tail = expr.v.split('.').pop();
      return { type: tail, optional: false, collection: false, target: tail };
    }
    case 'str': {
      // A forward reference: parse the simple forms ("User", "Optional[User]").
      const m = expr.v.trim();
      const opt = m.match(/^(?:Optional\[(.+)\]|(.+?)\s*\|\s*None)$/);
      const name = (opt ? opt[1] || opt[2] : m).trim();
      const list = name.match(/^(?:List|list|Set|set|Sequence)\[["']?(\w+)["']?\]$/);
      if (list) return { type: `list[${list[1]}]`, optional: !!opt, collection: true, target: list[1] };
      return { type: name.split('.').pop(), optional: !!opt, collection: false, target: /^\w+$/.test(name) ? name : null };
    }
    case 'const':
      return expr.v === null ? { type: 'None', optional: true, collection: false, target: null } : none;
    case 'bin': {
      if (expr.op !== '|') return none;
      const parts = [];
      const flat = e => (e?.t === 'bin' && e.op === '|' ? (flat(e.l), flat(e.r)) : parts.push(e));
      flat(expr);
      return union(parts);
    }
    case 'sub': {
      const tail = refTail(expr.value) || '';
      const inner = expr.index || [];
      if (WRAPPERS.has(tail)) return pythonType(inner[0]);
      if (tail === 'ClassVar') return { ...none, type: 'ClassVar' };
      if (tail === 'Optional') return { ...pythonType(inner[0]), optional: true };
      if (tail === 'Union') return union(inner);
      if (COLLECTIONS.has(tail)) {
        const item = pythonType(inner[0]);
        return { type: `${tail}[${item.type || '…'}]`, optional: false, collection: true, target: item.target };
      }
      return { type: tail, optional: false, collection: false, target: tail };
    }
    default:
      return none;
  }
}

function union(members) {
  const kinds = members.map(pythonType);
  const optional = kinds.some(k => k.type === 'None');
  const rest = kinds.filter(k => k.type !== 'None');
  if (rest.length === 1) return { ...rest[0], optional: optional || rest[0].optional };
  return { type: 'Union', optional, collection: false, target: null };
}

const constValue = e => (e?.t === 'const' ? e.v : undefined);

/**
 * Scan Python models.
 * @returns {{ entities: object[], schemas: object[], relationships: object[], scanTier: object }}
 */
export function scanPythonModels(dir) {
  const files = findPythonFiles(dir);
  const { byFile, scanTier } = loadPythonOutlines(files, 'models');
  const index = new PythonIndex(dir, byFile);

  const classes = [];
  for (const [file, rec] of byFile) {
    for (const s of rec.outline.body) if (s.k === 'class') classes.push({ file, stmt: s, tier: rec.tier, tierReason: rec.tierReason });
  }
  const byId = new Map(classes.map(c => [`${c.file}::${c.stmt.name}`, c]));

  // Resolve a base expression to a project class, or describe it.
  const baseOf = (file, expr) => {
    const dotted = expr?.t === 'ref' ? expr.v : null;
    if (!dotted) return { kind: 'other' };
    const b = index.resolveRef(file, dotted);
    if (b?.kind === 'class' && b.rest.length === 0) return { kind: 'class', cls: byId.get(`${b.file}::${b.stmt.name}`) };
    if (b?.kind === 'assign') {
      const v = b.stmt.value;
      const fn = v?.t === 'call' ? refTail(v.fn) : null;
      // Base = declarative_base() / registry().generate_base(); db.Model with db = SQLAlchemy()
      if (b.rest.length === 0 && (fn === 'declarative_base' || fn === 'generate_base')) return { kind: 'marker', marker: 'sqlalchemy' };
      if (b.rest.join('.') === 'Model' && (fn === 'SQLAlchemy' || fn === 'Flask-SQLAlchemy')) return { kind: 'marker', marker: 'sqlalchemy' };
    }
    const tail = dotted.split('.').pop();
    const module = b?.kind === 'external' ? b.module || '' : '';
    if (tail === 'DeclarativeBase' || tail === 'DeclarativeBaseNoMeta') return { kind: 'marker', marker: 'sqlalchemy' };
    if (tail === 'Model' && (/^django\b/.test(module) || /(?:^|\.)models\.Model$/.test(dotted))) return { kind: 'marker', marker: 'django' };
    if (tail === 'Model' && /(?:^|\.)db\.Model$/.test(dotted)) return { kind: 'marker', marker: 'sqlalchemy' };
    if (tail === 'SQLModel') return { kind: 'marker', marker: 'sqlmodel' };
    if (tail === 'BaseSettings') return { kind: 'marker', marker: 'settings' };
    if (tail === 'BaseModel' || tail === 'RootModel') return { kind: 'marker', marker: 'pydantic' };
    // Unresolvable `Base` / `Model` (defined outside the scanned tree): the
    // name convention the scanners have always honoured.
    if (!b || b.kind === 'external') {
      if (tail === 'Base') return { kind: 'marker', marker: 'sqlalchemy' };
      if (tail === 'Model') return { kind: 'marker', marker: 'orm-model' };
    }
    return { kind: 'other' };
  };

  const PRIORITY = ['settings', 'sqlmodel', 'django', 'sqlalchemy', 'orm-model', 'pydantic'];
  const familyCache = new Map();
  const familyOf = (c, seen = new Set()) => {
    const id = `${c.file}::${c.stmt.name}`;
    if (familyCache.has(id)) return familyCache.get(id);
    if (seen.has(id)) return null;
    seen.add(id);
    const found = new Set();
    for (const base of c.stmt.bases || []) {
      const r = baseOf(c.file, base);
      if (r.kind === 'marker') found.add(r.marker);
      else if (r.kind === 'class' && r.cls) { const f = familyOf(r.cls, seen); if (f) found.add(f); }
    }
    const family = PRIORITY.find(p => found.has(p)) || null;
    familyCache.set(id, family);
    return family;
  };

  const ancestors = (c, seen = new Set()) => {
    const out = [];
    for (const base of c.stmt.bases || []) {
      const r = baseOf(c.file, base);
      if (r.kind === 'class' && r.cls && !seen.has(r.cls)) {
        seen.add(r.cls);
        out.push(...ancestors(r.cls, seen), r.cls);
      }
    }
    return out;
  };

  const bodyAssign = (c, name) => (c.stmt.body || []).find(s => s.k === 'assign' && s.targets.includes(name));
  const isAbstract = (c, family) => {
    if (family === 'django') {
      const meta = (c.stmt.body || []).find(s => s.k === 'class' && s.name === 'Meta');
      const abs = meta && (meta.body || []).find(s => s.k === 'assign' && s.targets.includes('abstract'));
      return constValue(abs?.value) === true;
    }
    return constValue(bodyAssign(c, '__abstract__')?.value) === true;
  };

  // Fields and relationship ends of one class body.
  const readBody = (c, family, owner) => {
    const fields = [];
    const ends = [];
    for (const s of c.stmt.body || []) {
      if (s.k !== 'assign' || s.aug) continue;
      const name = s.targets[0];
      if (!name || /^__.*__$/.test(name) || name === 'model_config' || name === 'objects') continue;
      if (family === 'django') readDjango(name, s, owner, fields, ends);
      else if (family === 'sqlalchemy' || family === 'orm-model' || (family === 'sqlmodel' && sqlmodelTable(c))) readSqlalchemy(name, s, owner, fields, ends, family === 'sqlmodel');
      else readPydantic(name, s, fields);
    }
    return { fields, ends };
  };

  const sqlmodelTable = c => constValue(c.stmt.keywords?.table) === true;

  const entities = [];
  const schemas = [];
  const ends = [];
  const tableToClass = new Map();
  for (const c of classes) {
    const family = familyOf(c);
    if (!family || family === 'settings') continue;
    const name = c.stmt.name;
    const merged = new Map();
    const ownEnds = [];
    for (const anc of [...ancestors(c), c]) {
      const r = readBody(anc, family, name);
      for (const f of r.fields) merged.set(f.name, f);
      ownEnds.push(...r.ends);
    }
    const fields = [...merged.values()];
    const record = { name, fields, file: relative(dir, c.file).replace(/\\/g, '/'), tier: c.tier, tierReason: c.tierReason, line: c.stmt.line };
    const orm = family === 'django' || family === 'sqlalchemy' || family === 'orm-model' || (family === 'sqlmodel' && sqlmodelTable(c));
    if (orm) {
      if (isAbstract(c, family)) continue;
      const table = bodyAssign(c, '__tablename__');
      const hasTable = !!table || !!bodyAssign(c, '__table__');
      // A SQLAlchemy class with neither a table nor columns of its own is a
      // declarative base or a mixin, not a table.
      if (family !== 'django' && !hasTable && !fields.length) continue;
      if (table?.value?.t === 'str') tableToClass.set(table.value.v, name);
      entities.push({ ...record, source: family === 'orm-model' ? 'sqlalchemy' : family });
      ends.push(...ownEnds);
    } else if (fields.length) {
      schemas.push({ ...record, source: 'pydantic' });
    }
  }

  const entityNames = new Set(entities.map(e => e.name));
  for (const e of ends) if (e.table && !e.to) e.to = tableToClass.get(e.table) || null;
  const relationships = mergeEnds(ends.filter(e => e.to && entityNames.has(e.from) && entityNames.has(e.to)));

  // No ORM model anywhere: the Pydantic schemas are the data model.
  const modelEntities = entities.length ? entities : schemas;
  return { entities: modelEntities, schemas: entities.length ? schemas : [], relationships, scanTier };
}

function readSqlalchemy(name, s, owner, fields, ends, sqlmodel) {
  const v = s.value;
  const ann = pythonType(s.ann);
  const call = v?.t === 'call' ? v : null;
  const fn = call ? refTail(call.fn) : null;
  if (fn && SQLA_RELATION.has(fn)) {
    const first = call.args[0];
    const target = first?.t === 'str' ? first.v.split('.').pop() : first?.t === 'ref' ? first.v.split('.').pop() : ann.target;
    const uselist = constValue(call.kw?.uselist);
    const collection = uselist === false ? false : uselist === true ? true : s.ann ? ann.collection : null;
    ends.push({ from: owner, to: target, field: name, collection, m2m: !!call.kw?.secondary, oneToOne: uselist === false });
    return;
  }
  if (fn && SQLA_NOT_COLUMN.has(fn)) return;
  const isColumn = (fn && SQLA_COLUMN.has(fn)) || (!call && s.ann && refTail(s.ann.value || s.ann) === 'Mapped' && !ann.collection)
    || (sqlmodel && s.ann && (!call || fn === 'Field'));
  if (!isColumn) return;
  let sqlType = null;
  let fk = null;
  for (const a of call && fn !== 'Field' ? call.args : []) {
    if (a?.t === 'call' && refTail(a.fn) === 'ForeignKey') { fk = a.args[0]?.t === 'str' ? a.args[0].v : null; continue; }
    if (!sqlType && a?.t === 'ref') sqlType = refTail(a);
    else if (!sqlType && a?.t === 'call') sqlType = refTail(a.fn);
  }
  if (call && fn === 'Field' && call.kw?.foreign_key?.t === 'str') fk = call.kw.foreign_key.v;
  const nullable = constValue(call?.kw?.nullable);
  const primaryKey = constValue(call?.kw?.primary_key) === true;
  // Classic Column() is nullable unless told otherwise; a Mapped[] annotation
  // says it with Optional[...] / `| None`.
  const required = primaryKey ? true
    : nullable === true ? false
      : nullable === false ? true
        : s.ann ? !ann.optional : false;
  const field = { name, type: sqlType || ann.type || '', required, description: '' };
  if (primaryKey) field.primaryKey = true;
  if (constValue(call?.kw?.unique) === true) field.unique = true;
  fields.push(field);
  if (fk) ends.push({ from: owner, to: null, table: fk.split('.')[0], field: name, fk: true });
}

function readDjango(name, s, owner, fields, ends) {
  const call = s.value?.t === 'call' ? s.value : null;
  const fn = call ? refTail(call.fn) : null;
  if (!fn || !(fn.endsWith('Field') || DJANGO_RELATION.has(fn) || fn === 'GenericForeignKey')) return;
  if (DJANGO_RELATION.has(fn)) {
    const target = call.args[0] || call.kw?.to;
    let to = null;
    if (target?.t === 'str') to = target.v === 'self' ? owner : target.v.split('.').pop();
    else if (target?.t === 'ref') to = target.v.split('.').pop();
    ends.push({ from: owner, to, field: name, fk: fn === 'ForeignKey' || fn === 'ParentalKey', oneToOne: fn === 'OneToOneField', m2m: fn.includes('ManyToMany') });
  }
  if (DJANGO_SKIP.has(fn)) return;
  const field = { name, type: fn, required: constValue(call.kw?.null) !== true, description: '' };
  if (constValue(call.kw?.primary_key) === true) field.primaryKey = true;
  if (constValue(call.kw?.unique) === true) field.unique = true;
  fields.push(field);
}

function readPydantic(name, s, fields) {
  if (!s.ann || name.startsWith('_')) return;
  const ann = pythonType(s.ann);
  if (ann.type === 'ClassVar') return;
  const v = s.value;
  let hasDefault = !!v && !(v.t === 'const' && v.v === '...');
  if (v?.t === 'call' && refTail(v.fn) === 'Field') {
    const first = v.args[0];
    hasDefault = (first && !(first.t === 'const' && first.v === '...')) || !!v.kw?.default || !!v.kw?.default_factory;
    if (v.kw?.default?.t === 'const' && v.kw.default.v === '...') hasDefault = false;
  }
  fields.push({ name, type: ann.type, required: !ann.optional && !hasDefault, description: '' });
}

/**
 * Merge relationship ends into one edge per related pair.
 *
 * - many-to-many: a `secondary=` relationship or a ManyToManyField;
 * - one-to-one: `uselist=False` or a OneToOneField;
 * - one-to-many: a collection on one side, or a foreign key / scalar on the
 *   other (the many side). The label is the collection's field when there is
 *   one, else the many side's field.
 * - an end whose cardinality nothing establishes stays `related`.
 */
export function mergeEnds(ends) {
  const byPair = new Map();
  for (const e of ends) {
    const key = [e.from, e.to].sort().join('\u0000');
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(e);
  }
  const cmp = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.field < b.field ? -1 : a.field > b.field ? 1 : 0);
  const out = [];
  for (const list of byPair.values()) {
    list.sort(cmp);
    const m2m = list.find(e => e.m2m);
    if (m2m) { out.push({ from: m2m.from, to: m2m.to, type: 'many-to-many', field: m2m.field }); continue; }
    const o2o = list.find(e => e.oneToOne);
    if (o2o) { out.push({ from: o2o.from, to: o2o.to, type: 'one-to-one', field: o2o.field }); continue; }
    const coll = list.find(e => e.collection === true);
    if (coll) { out.push({ from: coll.from, to: coll.to, type: 'one-to-many', field: coll.field }); continue; }
    const many = list.find(e => e.fk) || list.find(e => e.collection === false);
    if (many) {
      const scalar = list.find(e => e.from === many.from && e.collection === false) || many;
      out.push({ from: many.to, to: many.from, type: 'one-to-many', field: scalar.field });
      continue;
    }
    const first = list[0];
    out.push({ from: first.from, to: first.to, type: 'related', field: first.field });
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}
