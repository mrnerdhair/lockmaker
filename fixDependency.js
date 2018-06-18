const fs = require("fs");
const mkdirp = require("mkdirp");
const path = require("path");
const ssri = require("ssri");
const util = require("util");
const fetch = require("node-fetch").default;
const { curry, mapValuesAsync } = require("./support");

const checkIntegrity = exports.doIntegrityCheck = async (path, integrity) => {
  try {
    await ssri.checkStream(fs.createReadStream(path), integrity, {error: true});
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    if (e.code !== "EINTEGRITY") throw e;
    return false;
  }
};

const fixDependency = exports.fixDependency = exports.default = async (archivePath, validPaths, lockMap, metadata, depName) => {
  const retval = Object.assign({}, metadata);
  const targetKey = (metadata.resolved ? "resolved" : "version");
  if (typeof metadata[targetKey] !== "string") return retval;

  const matches = metadata[targetKey].match(/^https?:\/\/(?:[^\/]*\/)*(.*)$/i);
  if (matches) {
    if (typeof matches[1] !== "string") throw new Error(`Could not extract path from dependency: ${metadata[targetKey]}`);
    const depUri = matches[0];
    let depFileName = matches[1];

    //console.log(`Processing ${depName}...`);

    if (typeof metadata.integrity === "string") {
      const shortHash = ssri.parse(Array.from(metadata.integrity.split(/\s+/)).reverse()[0], {single: true})
        .hexDigest()
        .substr(0, 9)
      depFileName =  `${path.basename(depFileName, path.extname(depFileName))}-${shortHash}${path.extname(depFileName)}`;
    }

    const nameParts = depName.split("/");
    const depPath = path.resolve(path.join(archivePath, ...(nameParts.slice(0, nameParts.length - 1)), depFileName));

    await util.promisify(mkdirp)(path.dirname(depPath));

    // Take a lock on the path
    if (lockMap.has(depPath)) await lockMap.get(depPath);
    let lockResolver;
    lockMap.set(depPath, new Promise(resolve => lockResolver = resolve));

    try {
      if (!validPaths.has(depPath)) {
        if (await util.promisify(fs.exists)(depPath)) {
          if (typeof metadata.integrity !== "string") {
            validPaths.add(depPath);
            console.log(`No integrity information for archived copy of ${path.relative(archivePath, depPath)}; using anyway.`);
          } else if (await checkIntegrity(depPath, metadata.integrity)) {
            validPaths.add(depPath);
            console.log(`Archived copy of ${path.relative(archivePath, depPath)} passed integrity check.`);
          } else {
            console.log(`Integrity check for archived copy of ${path.relative(archivePath, depPath)} failed; will redownload.`);
            await util.promisify(fs.unlink)(depPath);
          }
        }

        if (!validPaths.has(depPath)) {
          console.log(`Archive does not contain ${path.relative(archivePath, depPath)}; downloading from ${depUri}`);
          const fetchStream = (await fetch(depUri)).body;
          const partPath = `${depPath}.part`;
          await new Promise(resolve => fetchStream.pipe(fs.createWriteStream(partPath)).once("finish", resolve));

          if (typeof metadata.integrity !== "string" || await checkIntegrity(partPath, metadata.integrity)) {
            await util.promisify(fs.rename)(partPath, depPath);
            validPaths.add(depPath);
            console.log(`Download for ${path.relative(archivePath, depPath)} complete, integrity check passed.`);
          } else {
            await util.promisify(fs.unlink)(partPath);
            throw new Error(`Downloaded ${depFileName} from ${depUri}, but it failed the integrity check!`);
          }
        }
      }

      if (validPaths.has(depPath)) {
        //console.log(`Switching '${targetKey}' to archived copy of ${path.relative(archivePath, depPath)}.`);
        Object.assign(retval, {
          [targetKey]: `file:${path.join(archivePath, path.relative(archivePath, depPath)).replace(/\\/g, "/")}`
        });
      }
    } finally {
      lockResolver();
    }
  } else if (metadata[targetKey].match(/^file:.*$/i)) {
    const filePath = path.resolve(metadata[targetKey].slice(5));
    if (!validPaths.has(filePath)) {
      if (typeof metadata.integrity !== "string") {
        validPaths.add(filePath);
      } else {
        // Take a lock on the path
        if (lockMap.has(filePath)) await lockMap.get(filePath);
        let lockResolver;
        lockMap.set(filePath, new Promise(resolve => lockResolver = resolve));

        try {
          if (await checkIntegrity(filePath, metadata.integrity)) {
            validPaths.add(filePath);
            console.log(`${path.relative(archivePath, filePath).substr(0, 2 + path.sep.length) !== `..${path.sep}` ? path.relative(archivePath, filePath) : filePath} passed integrity check.`);
          } else {
            throw new Error(`${filePath} failed integrity check!`);
          }
        } finally {
          lockResolver();
        }
      }
    }
  }

  if (retval.dependencies) retval.dependencies = await mapValuesAsync(retval.dependencies, curry(fixDependency, archivePath, validPaths, lockMap));

  return retval;
}
