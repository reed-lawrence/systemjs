/*
 * SystemJS Core
 *
 * Provides
 * - System.import
 * - System.register support for
 *     live bindings, function hoisting through circular references,
 *     reexports, dynamic import, import.meta.url, top-level await
 * - System.getRegister to get the registration
 * - Symbol.toStringTag support in Module objects
 * - Hookable System.createContext to customize import.meta
 * - System.onload(err, id, deps) handler for tracing / hot-reloading
 *
 * Core comes with no System.prototype.resolve or
 * System.prototype.instantiate implementations
 */
import { IMPORT_MAP, hasSymbol, BASE_URL } from './common.js';
import { errMsg } from './err-msg';
import { IHasImportMaps, mixinImportMaps } from './features/import-maps.js';
import { ISystemResolve, mixinSystemResolve } from './features/resolve.js';

var toStringTag = hasSymbol && Symbol.toStringTag;
export const REGISTRY = hasSymbol ? Symbol() : '@';

export class SystemJSCore implements IHasImportMaps, ISystemResolve {
  constructor() {
    
    this[REGISTRY] = {};

    mixinSystemResolve(this);

    mixinImportMaps(this, {
      processFirst: false,
      getScripts: () => {
        console.log('getScripts');
        return [];
      }
    });

  }

  declare prepareImport: IHasImportMaps['prepareImport'];
  declare addImportMap: IHasImportMaps['addImportMap'];
  declare resolve: ISystemResolve['resolve'];
  declare [IMPORT_MAP]: object;
  declare [BASE_URL]: string;

  async import(id: string, parentUrl?: object, meta?: object) {
    var loader = this;

    if (typeof parentUrl === 'object') {
      meta = parentUrl;
      parentUrl = undefined;
    }

    await loader.prepareImport();
    id = await loader.resolve(id, parentUrl, meta);

    return Promise.resolve(loader.prepareImport())
      .then(function () {
        return loader.resolve(id, parentUrl, meta);
      })
      .then(function (id) {
        var load = getOrCreateLoad(loader, id, undefined, meta);
        return load.C || topLevelLoad(loader, load);
      });
  };

  /**
   * Hookable createContext function -> allowing eg custom import meta
   * @param parentId 
   * @returns 
   */
  createContext(parentId) {
    var loader = this;
    return {
      url: parentId,
      resolve: function (id, parentUrl) {
        return Promise.resolve(loader.resolve(id, parentUrl || parentId));
      }
    };
  };

  /**
   * provided for tracing / hot-reloading
   * TODO: supress in production
   * @param err 
   * @param id 
   * @param deps 
   */
  onload(err, id, deps) {

  }

  #lastRegister;
  register(deps, declare, metas) {
    this.#lastRegister = [deps, declare, metas];
  }

  /**
   * getRegister provides the last anonymous System.register call
   */
  getRegister() {
    var prev = this.#lastRegister;
    this.#lastRegister = undefined;
    return prev;
  }


}

function loadToId(load) {
  return load.id;
}

function triggerOnload(loader, load, err, isErrSource) {
  loader.onload(err, load.id, load.d && load.d.map(loadToId), !!isErrSource);
  if (err)
    throw err;
}


export function getOrCreateLoad(loader, id, firstParentUrl, meta) {
  var load = loader[REGISTRY][id];
  if (load)
    return load;

  var importerSetters = [];
  var ns = Object.create(null);
  if (toStringTag)
    Object.defineProperty(ns, toStringTag, { value: 'Module' });

  var instantiatePromise = Promise.resolve()
    .then(function () {
      return loader.instantiate(id, firstParentUrl, meta);
    })
    .then(function (registration) {
      if (!registration)
        throw Error(errMsg(2, process.env.SYSTEM_PRODUCTION ? id : 'Module ' + id + ' did not instantiate'));
      function _export(name, value) {
        // note if we have hoisted exports (including reexports)
        load.h = true;
        var changed = false;
        if (typeof name === 'string') {
          if (!(name in ns) || ns[name] !== value) {
            ns[name] = value;
            changed = true;
          }
        }
        else {
          for (var p in name) {
            var value = name[p];
            if (!(p in ns) || ns[p] !== value) {
              ns[p] = value;
              changed = true;
            }
          }

          if (name && name.__esModule) {
            ns.__esModule = name.__esModule;
          }
        }
        if (changed)
          for (var i = 0; i < importerSetters.length; i++) {
            var setter = importerSetters[i];
            if (setter) setter(ns);
          }
        return value;
      }
      var declared = registration[1](_export, registration[1].length === 2 ? {
        import: function (importId, meta) {
          return loader.import(importId, id, meta);
        },
        meta: loader.createContext(id)
      } : undefined);
      load.e = declared.execute || function () { };
      return [registration[0], declared.setters || [], registration[2] || []];
    }, function (err) {
      load.e = null;
      load.er = err;
      if (!process.env.SYSTEM_PRODUCTION) triggerOnload(loader, load, err, true);
      throw err;
    });

  var linkPromise = instantiatePromise
    .then(function (instantiation) {
      return Promise.all(instantiation[0].map(function (dep, i) {
        var setter = instantiation[1][i];
        var meta = instantiation[2][i];
        return Promise.resolve(loader.resolve(dep, id))
          .then(function (depId) {
            var depLoad = getOrCreateLoad(loader, depId, id, meta);
            // depLoad.I may be undefined for already-evaluated
            return Promise.resolve(depLoad.I)
              .then(function () {
                if (setter) {
                  depLoad.i.push(setter);
                  // only run early setters when there are hoisted exports of that module
                  // the timing works here as pending hoisted export calls will trigger through importerSetters
                  if (depLoad.h || !depLoad.I)
                    setter(depLoad.n);
                }
                return depLoad;
              });
          });
      }))
        .then(function (depLoads) {
          load.d = depLoads;
        });
    });
  if (!process.env.SYSTEM_BROWSER)
    linkPromise.catch(function () { });

  // Capital letter = a promise function
  return load = loader[REGISTRY][id] = {
    id: id,
    // importerSetters, the setters functions registered to this dependency
    // we retain this to add more later
    i: importerSetters,
    // module namespace object
    n: ns,
    // extra module information for import assertion
    // shape like: { assert: { type: 'xyz' } }
    m: meta,

    // instantiate
    I: instantiatePromise,
    // link
    L: linkPromise,
    // whether it has hoisted exports
    h: false,

    // On instantiate completion we have populated:
    // dependency load records
    d: undefined,
    // execution function
    e: undefined,

    // On execution we have populated:
    // the execution error if any
    er: undefined,
    // in the case of TLA, the execution promise
    E: undefined,

    // On execution, L, I, E cleared

    // Promise for top-level completion
    C: undefined,

    // parent instantiator / executor
    p: undefined
  };
}

function instantiateAll(loader, load, parent, loaded) {
  if (!loaded[load.id]) {
    loaded[load.id] = true;
    // load.L may be undefined for already-instantiated
    return Promise.resolve(load.L)
      .then(function () {
        if (!load.p || load.p.e === null)
          load.p = parent;
        return Promise.all(load.d.map(function (dep) {
          return instantiateAll(loader, dep, parent, loaded);
        }));
      })
      .catch(function (err) {
        if (load.er)
          throw err;
        load.e = null;
        if (!process.env.SYSTEM_PRODUCTION) triggerOnload(loader, load, err, false);
        throw err;
      });
  }
}

function topLevelLoad(loader, load) {
  return load.C = instantiateAll(loader, load, load, {})
    .then(function () {
      return postOrderExec(loader, load, {});
    })
    .then(function () {
      return load.n;
    });
}

// the closest we can get to call(undefined)
var nullContext = Object.freeze(Object.create(null));

// returns a promise if and only if a top-level await subgraph
// throws on sync errors
function postOrderExec(loader, load, seen) {
  if (seen[load.id])
    return;
  seen[load.id] = true;

  if (!load.e) {
    if (load.er)
      throw load.er;
    if (load.E)
      return load.E;
    return;
  }

  // From here we're about to execute the load.
  // Because the execution may be async, we pop the `load.e` first.
  // So `load.e === null` always means the load has been executed or is executing.
  // To inspect the state:
  // - If `load.er` is truthy, the execution has threw or has been rejected;
  // - otherwise, either the `load.E` is a promise, means it's under async execution, or
  // - the `load.E` is null, means the load has completed the execution or has been async resolved.
  var exec = load.e;
  load.e = null;

  // deps execute first, unless circular
  var depLoadPromises;
  load.d.forEach(function (depLoad) {
    try {
      var depLoadPromise = postOrderExec(loader, depLoad, seen);
      if (depLoadPromise)
        (depLoadPromises = depLoadPromises || []).push(depLoadPromise);
    }
    catch (err) {
      load.er = err;
      if (!process.env.SYSTEM_PRODUCTION) triggerOnload(loader, load, err, false);
      throw err;
    }
  });
  if (depLoadPromises)
    return Promise.all(depLoadPromises).then(doExec);

  return doExec();

  function doExec() {
    try {
      var execPromise = exec.call(nullContext);
      if (execPromise) {
        execPromise = execPromise.then(function () {
          load.C = load.n;
          load.E = null; // indicates completion
          if (!process.env.SYSTEM_PRODUCTION) triggerOnload(loader, load, null, true);
        }, function (err) {
          load.er = err;
          load.E = null;
          if (!process.env.SYSTEM_PRODUCTION) triggerOnload(loader, load, err, true);
          throw err;
        });
        return load.E = execPromise;
      }
      // (should be a promise, but a minify optimization to leave out Promise.resolve)
      load.C = load.n;
      load.L = load.I = undefined;
    }
    catch (err) {
      load.er = err;
      throw err;
    }
    finally {
      if (!process.env.SYSTEM_PRODUCTION) triggerOnload(loader, load, load.er, true);
    }
  }
}