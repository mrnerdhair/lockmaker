#!/usr/bin/env node
process.on("unhandledRejection", (x) => { throw x; });
(async ()=>{
  const path = require("path");
  const util = require("util");
  const fs = require("fs");

  function isConstructable(fn) {
    if (!(main instanceof Function) || fn === Symbol) return false;
    try {
      return !!(new (new Proxy(fn, { construct() { return {}; } }))());
    } catch {
      return false;
    }
  }

  const mainPath = path.join(__dirname, JSON.parse(await util.promisify(fs.readFile)(path.resolve(__dirname, "package.json"), "utf8")).main);
  const main = await require(mainPath);

  const argParser = (main.argParser instanceof Function ? main.argParser : (...args) => args.slice(2));
  const args = argParser(...process.argv) || [];

  if (isConstructable(main)) return await new main(...(Array.isArray(args) ? args : [args]));
  if (main instanceof Function) return await main(...(Array.isArray(args) ? args : [args]));
  if (isConstructable(main.default)) return await new main.default(...(Array.isArray(args) ? args : [args]));
  if (main.default instanceof Function) return await main.default(...(Array.isArray(args) ? args : [args]));
  return main;
})();
