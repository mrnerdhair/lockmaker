const commander = require("commander");
const fs = require("fs");
const path = require("path");

const wrapCommand = command => new Proxy(command, {
  get(obj, prop) {
    if (prop === "action" && prop in obj) {
      const action = obj.action.bind(obj);
      return (fn, ...args) => {
        const wrappedFn = (...args) => {
          if (args.length > 0) {
            args[args.length - 1] = wrapCommand(args[args.length - 1]);
          }
          fn(...args);
        };
        return action(wrappedFn, ...args);
      };
    }
    if (prop === "command" && prop in obj) {
      const command = obj.command.bind(obj);
      return (...args) => {
        return wrapCommand(command(...args));
      };
    }
    if (prop in obj) return obj[prop];
    if ("parent" in obj) {
      const parent = obj.parent;
      if (prop in parent) {
        const retval = parent[prop];
        if (retval instanceof Function) return retval.bind(parent);
        return retval;
      }
    }
    return undefined;
  }
});

exports.default = (() => {
  const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), { encoding: "utf8" }));

  if (packageInfo.name) commander.name(packageInfo.name);
  if (packageInfo.version) commander.version(packageInfo.version);
  if (packageInfo.description) commander.description(packageInfo.description);

  return wrapCommand(commander);
})();
