import type { OpenCascadeInstance } from 'opencascade.js/dist/node';

type InitOpenCascade = typeof import('opencascade.js/dist/node').default;

type OpenCascadeNodeModule = {
  default: InitOpenCascade;
};

const importEsm = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<OpenCascadeNodeModule>;

let occInstance: OpenCascadeInstance | null = null;
let occLoading: Promise<OpenCascadeInstance> | null = null;

export async function getOCC(): Promise<OpenCascadeInstance> {
  if (occInstance) {
    return occInstance;
  }

  if (!occLoading) {
    occLoading = importEsm('opencascade.js/dist/node.js')
      .then(({ default: initOpenCascade }) => initOpenCascade())
      .then((loaded) => {
        occInstance = loaded;
        return loaded;
      })
      .catch((error) => {
        occLoading = null;
        throw error;
      });
  }

  return occLoading;
}
