import { BASE_URL, baseUrl, resolveImportMap, resolveIfNotPlainOrUrl, IMPORT_MAP } from '../common.js';
import { importMap } from './import-maps.js';
import { errMsg } from '../err-msg.js';

export interface ISystemResolve {
  resolve(id: string, parentUrl?: string): string;
  [IMPORT_MAP]: object;
  [BASE_URL]: string;
}

export function mixinSystemResolve(target: ISystemResolve) {

  target.resolve = function (id, parentUrl) {
    parentUrl = parentUrl || !process.env.SYSTEM_BROWSER && this[BASE_URL] || baseUrl;
    return resolveImportMap((!process.env.SYSTEM_BROWSER && this[IMPORT_MAP] || importMap), resolveIfNotPlainOrUrl(id, parentUrl) || id, parentUrl) || throwUnresolved(id, parentUrl);
  };

}

function throwUnresolved(id, parentUrl) {
  throw Error(errMsg(8, process.env.SYSTEM_PRODUCTION ? [id, parentUrl].join(', ') : "Unable to resolve bare specifier '" + id + (parentUrl ? "' from " + parentUrl : "'")));
}
