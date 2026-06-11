export interface DxfValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  stats: {
    entities: number;
    polylines: number;
    texts: number;
    lines: number;
    blocks: number;
    inserts: number;
  };
}

export function validateDXF(dxf: string): DxfValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!dxf.includes('SECTION') || !dxf.includes('ENDSEC')) {
    errors.push('Missing SECTION/ENDSEC');
  }
  if (!dxf.includes('EOF')) {
    errors.push('Missing EOF');
  }
  if (!dxf.includes('HEADER')) {
    errors.push('Missing HEADER section');
  }
  if (!dxf.includes('ENTITIES')) {
    errors.push('Missing ENTITIES section');
  }
  if (!dxf.includes('AC1027') && !dxf.includes('AC1009')) {
    warnings.push('DXF version is not declared as AC1027 or AC1009');
  }
  if (!dxf.includes('$INSUNITS')) {
    warnings.push('DXF units are not declared');
  }

  const polylines = countEntity(dxf, 'LWPOLYLINE');
  const texts = countEntity(dxf, 'TEXT');
  const lines = countEntity(dxf, 'LINE');
  const circles = countEntity(dxf, 'CIRCLE');
  const blocks = countEntity(dxf, 'BLOCK');
  const inserts = countEntity(dxf, 'INSERT');

  if (polylines + lines + circles + inserts === 0) {
    warnings.push('No supported geometry entities found');
  }

  if (dxf.includes('BLOCKS') && blocks === 0) {
    warnings.push('DXF declares BLOCKS but contains no BLOCK definitions');
  }

  if (blocks > 0 && inserts === 0) {
    warnings.push('DXF contains BLOCK definitions but no INSERT entities');
  }

  const polylineBlocks = dxf.split(/\r?\n0\r?\nLWPOLYLINE\r?\n/).slice(1);
  for (let index = 0; index < polylineBlocks.length; index += 1) {
    const block = polylineBlocks[index].split(/\r?\n0\r?\n/)[0] ?? '';
    if (!/\r?\n70\r?\n1(?:\r?\n|$)/.test(`\n${block}`)) {
      warnings.push(`LWPOLYLINE #${index + 1} may be open`);
    }
  }

  const skippedLeads = dxf.match(/LEAD_SKIPPED[^\r\n]*/g) ?? [];
  warnings.push(...skippedLeads);

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    stats: {
      entities: polylines + texts + lines + circles,
      polylines,
      texts,
      lines,
      blocks,
      inserts,
    },
  };
}

function countEntity(dxf: string, name: string): number {
  const pattern = new RegExp(`(?:^|\\r?\\n)${name}\\r?\\n`, 'g');
  return dxf.match(pattern)?.length ?? 0;
}
