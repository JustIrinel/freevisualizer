// Minimal XML parser for fixture files (GDTF description.xml, QLC+ .qxf).
// Handles elements, attributes, text, comments, CDATA, <?…?> and <!DOCTYPE>.
// Pure module: works in the browser and in Node (tests).

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** @returns root element { name, attrs, children, text } */
export function parseXml(src) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt + 4); i = i < 0 ? n : i + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') { i = src.indexOf('>', lt + 1); i = i < 0 ? n : i + 1; continue; }
    const gt = findTagEnd(src, lt);
    const body = src.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const m = /^([^\s/>]+)/.exec(inner);
    if (!m) continue;
    const name = m[1].includes(':') ? m[1].split(':').pop() : m[1];
    const attrs = {};
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = re.exec(inner.slice(m[1].length)))) attrs[a[1]] = decode(a[3] ?? a[4] ?? '');
    const el = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  for (const el of walk(root)) el.text = el.text.trim();
  return root.children.find((c) => c.name) || root;
}

function findTagEnd(src, from) {
  let q = null;
  for (let j = from + 1; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return j;
  }
  return src.length - 1;
}

function* walk(node) {
  yield node;
  for (const c of node.children) yield* walk(c);
}

/** First direct child named `name`. */
export function child(node, name) {
  return node ? node.children.find((c) => c.name === name) || null : null;
}

/** All direct children named `name`. */
export function children(node, name) {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** All descendants named `name` (depth first). */
export function descendants(node, name) {
  const out = [];
  if (!node) return out;
  for (const el of walk(node)) if (el !== node && el.name === name) out.push(el);
  return out;
}
