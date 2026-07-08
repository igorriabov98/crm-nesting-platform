import * as fs from 'node:fs';
import * as path from 'node:path';
import { getOCC } from '../brep/occ-loader';
import { detectSheetMetalTopology, type SheetMetalTopology } from '../brep/bend-detector';
import type {
  Message_ProgressRange,
  STEPControl_Reader,
  TopExp_Explorer,
  TopoDS_Shape,
  TopoDS_Solid,
} from 'opencascade.js/dist/node';

type Deletable = {
  delete(): void;
};

export const fixturesDir = path.join(__dirname, 'fixtures');

export async function detectFixtureTopology(fileName: string): Promise<SheetMetalTopology | null> {
  const oc = await getOCC();
  const inputPath = `/test-${fileName.replace(/[^a-zA-Z0-9._-]+/g, '_')}`;
  let reader: STEPControl_Reader | null = null;
  let progress: Message_ProgressRange | null = null;
  let shape: TopoDS_Shape | null = null;
  let explorer: TopExp_Explorer | null = null;
  let solid: TopoDS_Solid | null = null;

  try {
    oc.FS.writeFile(inputPath, new Uint8Array(fs.readFileSync(path.join(fixturesDir, fileName))));
    reader = new oc.STEPControl_Reader_1();
    const status = reader.ReadFile(inputPath);
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`STEP read failed: ${fileName}`);
    }

    progress = new oc.Message_ProgressRange_1();
    reader.TransferRoots(progress);
    shape = reader.OneShape();
    const topAbs = oc.TopAbs_ShapeEnum as unknown as {
      TopAbs_SOLID: Parameters<TopExp_Explorer['Init']>[1];
      TopAbs_SHAPE: Parameters<TopExp_Explorer['Init']>[2];
    };
    explorer = new oc.TopExp_Explorer_1();
    explorer.Init(shape, topAbs.TopAbs_SOLID, topAbs.TopAbs_SHAPE);

    if (!explorer.More()) {
      return null;
    }

    solid = oc.TopoDS.Solid_1(explorer.Current());
    return detectSheetMetalTopology({ oc, shape: solid });
  } finally {
    safeDelete(solid);
    safeDelete(explorer);
    safeDelete(shape);
    safeDelete(progress);
    safeDelete(reader);
    try {
      oc.FS.unlink(inputPath);
    } catch {
      // Ignore cleanup errors from the in-memory FS.
    }
  }
}

function safeDelete(value: Deletable | null | undefined): void {
  if (value) {
    value.delete();
  }
}
