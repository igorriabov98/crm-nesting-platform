import assert from 'node:assert/strict';
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

console.log('[step-assembly-path] nested NEXT_ASSEMBLY_USAGE_OCCURRENCE paths passed');
