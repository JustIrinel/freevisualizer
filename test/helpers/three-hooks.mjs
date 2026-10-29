const vendor = new URL('../../public/vendor/three/', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('three.module.min.js', vendor).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL(specifier.slice('three/'.length), vendor).href, shortCircuit: true };
  return next(specifier, context);
}
