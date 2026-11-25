import { describe, expect, it } from 'vitest';
import { shaderExcerpt } from './glDebug';

describe('Gestionnaire d\'erreurs GLSL', () => {
  it('extrait les lignes fautives avec contexte numéroté', () => {
    const src = Array.from({ length: 20 }, (_, i) => `line${i + 1};`).join('\n');
    const log = "ERROR: 0:10: 'foo' : undeclared identifier\nERROR: 0:15: syntax error";
    const ex = shaderExcerpt(src, log, 1);
    expect(ex).toContain('>>  10| line10;');
    expect(ex).toContain('>>  15| line15;');
    expect(ex).toContain('   9| line9;');
    expect(ex).not.toContain('line3;');
  });
});
