import { pathToFileURL } from 'node:url';

// ¿Este archivo se ejecutó directamente (node archivo.js) y no fue importado por un test?
// Funciona igual en Linux (Docker) y en Windows.
export const isMain = (metaUrl) => !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;
