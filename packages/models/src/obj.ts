/**
 * `objLoader`: Wavefront OBJ models with three's `OBJLoader`, with their materials.
 */
import { flatten, type ModelLoader } from '@boardui/viewer';
import { LoaderUtils } from 'three';

/**
 * Loads OBJ files with their materials: those of the `mtllib` files they name (fetched next to
 * the OBJ's URL) and `newmtl` definitions inside the OBJ itself (as EasyEDA writes them). OBJ
 * has no units: the model is taken as it is, Y up in metres; correct it with the reference's
 * transform (e.g. `scale: 0.001` for millimetres). three's OBJ and MTL loaders are imported with
 * the first OBJ file.
 */
export function objLoader(): ModelLoader {
  return {
    async load(data, { ref, signal }) {
      const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
        import('three/addons/loaders/OBJLoader.js'),
        import('three/addons/loaders/MTLLoader.js'),
      ]);
      const text = new TextDecoder().decode(data);
      const loader = new OBJLoader();
      const mtl = [...inlineMaterials(text)];
      const base = ref.url ? LoaderUtils.extractUrlBase(ref.url) : '';
      for (const [, name] of text.matchAll(/^mtllib\s+(.+?)\s*$/gm)) {
        if (!base) continue;
        try {
          const response = await fetch(new URL(name as string, base), { signal });
          if (response.ok) mtl.push(await response.text());
        } catch (error) {
          signal.throwIfAborted();
          void error; // A missing material file leaves the default material.
        }
      }
      if (mtl.length) {
        const materials = new MTLLoader().parse(mtl.join('\n'), base);
        materials.preload();
        loader.setMaterials(materials);
      }
      // OBJLoader warns about every line it doesn't know: drop the inline materials.
      return { parts: flatten(loader.parse(text.replace(MTL_LINES, ''))) };
    },
  };
}

const MTL_KEYWORDS = /^(newmtl|K[ade]|Ns|Ni|d|Tr|illum|map_\w+|endmtl)$/;
const MTL_LINES = /^[ \t]*(newmtl|K[ade]|Ns|Ni|d|Tr|illum|map_\w+|endmtl)\b.*$/gm;

/** The `newmtl` blocks of an OBJ file, as MTL text. */
function* inlineMaterials(text: string): Generator<string> {
  const lines = text.split(/\r?\n/);
  let block: string[] | null = null;
  for (const line of lines) {
    const keyword = /^\s*(\S+)/.exec(line)?.[1];
    if (keyword === 'newmtl') {
      if (block) yield block.join('\n');
      block = [line];
    } else if (block && keyword && MTL_KEYWORDS.test(keyword)) {
      if (keyword !== 'endmtl') block.push(line);
    } else if (block && keyword) {
      yield block.join('\n');
      block = null;
    }
  }
  if (block) yield block.join('\n');
}
