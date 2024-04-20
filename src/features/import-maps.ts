/*
 * SystemJS browser attachments for script and import map processing
 */
import { baseUrl, resolveAndComposeImportMap, hasDocument, resolveUrl } from '../common.js';

import { errMsg } from '../err-msg.js';

export var importMap = { imports: {}, scopes: {}, depcache: {}, integrity: {} };

// TODO: this is not happening at the moment
// if (hasDocument) {
//   processScripts();
//   window.addEventListener('DOMContentLoaded', processScripts);
// }


function extendImportMap(importMap: object, newMapText: string, newMapUrl: string) {
  var newMap = {};
  try {
    newMap = JSON.parse(newMapText);
  } catch (err) {
    console.warn(Error((process.env.SYSTEM_PRODUCTION ? errMsg('W5') : errMsg('W5', "systemjs-importmap contains invalid JSON") + '\n\n' + newMapText + '\n')));
  }
  resolveAndComposeImportMap(newMap, newMapUrl, importMap);
}

export interface IHasImportMaps {
  import: (id: string) => Promise<any>;
  prepareImport: (doProcessScripts?: boolean) => Promise<void>;
  addImportMap: (newMap: object, mapBase?: string) => void;
  fetch?: (url: string | RequestInfo, opts?: RequestInit & { passThrough: boolean }) => Promise<Response>;
}

export interface MixinImportMapsArgs {
  /**
   * If true, process scripts immediately
   */
  processFirst: boolean;

  getScripts: () => Iterable<IScript>;
}

export interface IScript {
  sp: boolean;
  type: string;
  src: string;
  onerror: () => void;
  dispatchEvent: (event: Event) => void;
  integrity: string;
  fetchPriority: RequestPriority;
  innerHTML: string;
}


export function mixinImportMaps(system: IHasImportMaps, args: MixinImportMapsArgs) {

  let {
    processFirst,
    getScripts
  } = args || (() => { throw new Error('Invalid arguments'); })();

  let importMapPromise = Promise.resolve();

  function processScripts() {

    for (const script of getScripts()) {

      if (script.sp) // sp marker = systemjs processed
        return;

      // TODO: deprecate systemjs-module in next major now that we have auto import
      if (script.type === 'systemjs-module') {
        script.sp = true;

        if (!script.src)
          return;

        const url = script.src.slice(0, 7) === 'import:' ? script.src.slice(7) : resolveUrl(script.src, baseUrl);
        system
          .import(url)
          .catch((e) => {

            // TODO: TEST THIS
            // if there is a script load error, dispatch an "error" event
            // on the script tag.
            if (e.message.indexOf('https://github.com/systemjs/systemjs/blob/main/docs/errors.md#3') > -1)
              script.dispatchEvent(new Event('error', { bubbles: false, cancelable: false }));

            return Promise.reject(e);
          });
      }
      else if (script.type === 'systemjs-importmap') {
        script.sp = true;

        const fetchPromise = (async () => {

          let text = '';

          if (script.src) {
            const opts: RequestInit = {
              integrity: script.integrity,
              priority: script.fetchPriority,
            };

            try {
              text = await (() => {
                if (system.fetch)
                  return system.fetch(script.src, { ...opts, passThrough: true })
                else
                  return fetch(script.src, opts);
              })()
                .then((res) => res.text());
            }
            catch (err) {
              err.message = errMsg('W4', process.env.SYSTEM_PRODUCTION ? script.src : 'Error fetching systemjs-import map ' + script.src) + '\n' + err.message;
              console.warn(err);

              // TODO: should this be a dispatch event?
              if (typeof script.onerror === 'function') {
                script.onerror();
              }

              text = '{}';
            }

          }
          else
            text = script.innerHTML;

          return text;

        })();

        importMapPromise = importMapPromise
          .then(() => fetchPromise)
          .then(text => {
            extendImportMap(importMap, text, script.src || baseUrl);
          });

      }

    }
  }

  system.prepareImport = (doProcessScripts?: boolean) => {
    if (processFirst || doProcessScripts) {
      processScripts();
      processFirst = false;
    }
    return importMapPromise;
  };

  system.addImportMap = (newMap: object, mapBase?: string) => {
    resolveAndComposeImportMap(newMap, mapBase || baseUrl, importMap);
  };

}
