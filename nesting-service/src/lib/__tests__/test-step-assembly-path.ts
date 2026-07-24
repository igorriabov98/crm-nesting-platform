import assert from 'node:assert/strict';
import { extractMeshMetadata } from '../step-parser';
import { extractStepOccurrenceMetadata } from '../step-source-names';

const step = Buffer.from(`
ISO-10303-21;
DATA;
#1=PRODUCT('ЛЕДА.228.00.000 Изделие','','',());
#2=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#1,.NOT_KNOWN.);
#3=PRODUCT_DEFINITION('design','',#2,$);
#4=PRODUCT('ЛЕДА.228.02.000 Крышка передняя','','',());
#5=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#4,.NOT_KNOWN.);
#6=PRODUCT_DEFINITION('design','',#5,$);
#7=PRODUCT('ЛЕДА.122.01.001 Лист','','',());
#8=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#7,.NOT_KNOWN.);
#9=PRODUCT_DEFINITION('design','',#8,$);
#10=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#3,#6,$);
#11=NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','','',#6,#9,$);
ENDSEC;
END-ISO-10303-21;
`, 'utf8');

const metadata = extractStepOccurrenceMetadata(step);
assert.deepEqual(metadata.get(0), {
  name: 'ЛЕДА.228.02.000 Крышка передняя',
  assemblyPath: [
    'ЛЕДА.228.00.000 Изделие',
    'ЛЕДА.228.02.000 Крышка передняя',
  ],
});
assert.deepEqual(metadata.get(1), {
  name: 'ЛЕДА.122.01.001 Лист',
  assemblyPath: [
    'ЛЕДА.228.00.000 Изделие',
    'ЛЕДА.228.02.000 Крышка передняя',
    'ЛЕДА.122.01.001 Лист',
  ],
});

const translatorRootStep = Buffer.from(`
ISO-10303-21;
DATA;
#21=PRODUCT('Open CASCADE STEP translator 7.9 3','','',());
#22=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#21,.NOT_KNOWN.);
#23=PRODUCT_DEFINITION('design','',#22,$);
#24=PRODUCT('ЛЕДА.228.02.000 Крышка передняя','','',());
#25=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#24,.NOT_KNOWN.);
#26=PRODUCT_DEFINITION('design','',#25,$);
#27=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#23,#26,$);
ENDSEC;
END-ISO-10303-21;
`, 'utf8');
const translatorMetadata = extractStepOccurrenceMetadata(translatorRootStep);
assert.deepEqual(translatorMetadata.get(0), {
  name: 'ЛЕДА.228.02.000 Крышка передняя',
  assemblyPath: ['ЛЕДА.228.02.000 Крышка передняя'],
});

const treeMetadata = extractMeshMetadata({
  name: 'Open CASCADE STEP translator 7.9 3',
  children: [{
    name: 'ЛЕДА.228.02.000 Крышка передняя',
    meshes: [0],
  }],
});
assert.deepEqual(treeMetadata.get(0), {
  name: 'ЛЕДА.228.02.000 Крышка передняя',
  assemblyPath: ['ЛЕДА.228.02.000 Крышка передняя'],
});
assert.deepEqual(extractMeshMetadata({
  name: 'Open CASCADE STEP translator 7.9 3',
  meshes: [0],
}).get(0), {
  name: 'Open CASCADE STEP translator 7.9 3',
  assemblyPath: [],
});

console.log('[step-assembly-path] nested paths retain real assemblies and omit translator roots');
