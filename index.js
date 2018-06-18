const fs = require("fs");
const path = require("path");
const ssri = require("ssri");
const util = require("util");
const autocommander = require("./autocommander").default;
const fixDependency = require("./fixDependency").default;
const { curry, mapValuesAsync } = require("./support");

exports.argParser = async (...argv) => {
  autocommander
    .option("-p, --package-path [path]", "Path to the package to process", ".")
    .option("-a, --archive-path [path]", "Where to store the archived package files", "archived-packages")
    .option("--no-purge-archive", "Don't purge unused files from the archive")
    .option("-s, --shrinkwrap-path [path]", "Path to save updated shrinkwrap file", "package-lock.json");

  autocommander.command("install")
    .description("Sets up hooks in package.json and runs initial dependency download.")
    .action(install);

  autocommander.command("uninstall")
    .description("Removes hooks in package.json.")
    .action(uninstall);

  autocommander.command("preshrinkwrap")
    .description("Removes npm-shrinkwrap.json before npm's shrinkwrap operation so package-lock.json gets updated properly.")
    .action(preshrinkwrap);

  autocommander.command("postshrinkwrap")
    .description("Downloads missing packages to the archive and updates package-lock.json.")
    .action(postshrinkwrap);

  autocommander.command("postpack")
    .description("Renames packed tarball so it has the appropriate short-hash in the filename.")
    .action(postpack);

  return autocommander.parse(argv);
};

const install = exports.install = async function(opts){
  const packagePath = path.resolve(opts.packagePath);
  console.log(`Using package directory ${packagePath}`);
  await util.promisify(fs.access)(packagePath);

  const packageInfoPath = path.join(packagePath, "package.json");
  const packageInfo = JSON.parse(await util.promisify(fs.readFile)(packageInfoPath, {encoding: "utf8"}));
  console.log(`Loaded package.json from ${packageInfoPath}.`);

  const cmdName = JSON.parse(await util.promisify(fs.readFile)(path.join(__dirname, "package.json"), {encoding: "utf8"})).name;

  packageInfo.scripts.preshrinkwrap = packageInfo.scripts.preshrinkwrap || `${cmdName} preshrinkwrap`;
  packageInfo.scripts.postshrinkwrap = packageInfo.scripts.postshrinkwrap || `${cmdName} postshrinkwrap`;

  await util.promisify(fs.writeFile)(packageInfoPath, JSON.stringify(packageInfo, null, 2), {encoding: "utf8"});
  console.log(`Wrote updated package.json.`);

  await preshrinkwrap(opts);
  await postshrinkwrap(opts);
};

const uninstall = exports.uninstall = async function(opts){
  const packagePath = path.resolve(opts.packagePath);
  console.log(`Using package directory ${packagePath}`);
  await util.promisify(fs.access)(packagePath);

  const packageInfoPath = path.join(packagePath, "package.json");
  const packageInfo = JSON.parse(await util.promisify(fs.readFile)(packageInfoPath, {encoding: "utf8"}));
  console.log(`Loaded package.json from ${packageInfoPath}.`);

  const cmdName = JSON.parse(await util.promisify(fs.readFile)(path.join(__dirname, "package.json"), {encoding: "utf8"})).name;

  if (packageInfo.scripts.preshrinkwrap === `${cmdName} preshrinkwrap`) delete packageInfo.scripts.preshrinkwrap;
  if (packageInfo.scripts.postshrinkwrap === `${cmdName} postshrinkwrap`) delete packageInfo.scripts.postshrinkwrap;

  await util.promisify(fs.writeFile)(packageInfoPath, JSON.stringify(packageInfo, null, 2), {encoding: "utf8"});
  console.log(`Wrote updated package.json.`);
};

const postpack = exports.postpack = async function(opts){
  const packagePath = path.resolve(opts.packagePath);
  console.log(`Using package directory ${packagePath}`);
  await util.promisify(fs.access)(packagePath);

  const packageInfoPath = path.join(packagePath, "package.json");
  const packageInfo = JSON.parse(await util.promisify(fs.readFile)(packageInfoPath, {encoding: "utf8"}));
  console.log(`Loaded package.json from ${packageInfoPath}.`);

  const packPath = path.resolve(packagePath, `${packageInfo.name}-${packageInfo.version}.tgz`);
  if (await util.promisify(fs.exists)(packPath)) {
    const shortHash = ssri.parse(await ssri.fromStream(fs.createReadStream(packPath)), {single: true}).hexDigest().substr(0, 9);
    const newPackPath = path.resolve(path.dirname(packPath), `${path.basename(packPath, path.extname(packPath))}-${shortHash}${path.extname(packPath)}`);
    console.log(`Moving ${packPath} to ${newPackPath}.`);
    await util.promisify(fs.rename)(packPath, newPackPath);
  } else {
    console.log(`No packed file found at ${packPath}.`);
  }
};

const preshrinkwrap = exports.preshrinkwrap = async function(opts){
  const packagePath = path.resolve(opts.packagePath);
  console.log(`Using package directory ${packagePath}`);
  await util.promisify(fs.access)(packagePath);

  const shrinkwrapPath = path.join(packagePath, "npm-shrinkwrap.json");
  if (await util.promisify(fs.exists)(shrinkwrapPath)) {
    console.log("Removing npm-shrinkwrap.json.");
    await util.promisify(fs.unlink)(shrinkwrapPath);
  }
};

const postshrinkwrap = exports.postshrinkwrap = async function(opts){
  const packagePath = path.resolve(opts.packagePath);
  console.log(`Using package directory ${packagePath}`);
  await util.promisify(fs.access)(packagePath);

  const archivePath = path.resolve(opts.packagePath, opts.archivePath);
  console.log(`Using archive directory ${opts.archivePath}`);

  let archivePathStats;
  try {
    archivePathStats = await util.promisify(fs.stat)(archivePath);
  } catch {
    await util.promisify(fs.mkdir)(archivePath);
    archivePathStats = await util.promisify(fs.stat)(archivePath);
  }
  if (!archivePathStats.isDirectory) {
    throw new Error(`${archivePath} is not a directory.`);
  }
  await util.promisify(fs.access)(archivePath)

  const lockfilePath = path.join(packagePath, "package-lock.json");
  const lockfile = JSON.parse(await util.promisify(fs.readFile)(lockfilePath, {encoding: "utf8"}));
  if (lockfile.lockfileVersion !== 1) throw new Error("Unsupported lockfile version");
  console.log(`Loaded lockfile from ${lockfilePath}.`);

  const validPaths = new Set();
  const lockMap = new Map();
  if (typeof lockfile.dependencies === "object") {
    console.log("Checking for cached dependencies...");
    lockfile.dependencies = await mapValuesAsync(lockfile.dependencies, curry(fixDependency, path.relative(packagePath, archivePath), validPaths, lockMap));
  }

  if (opts.purgeArchive) {
    const purgable = (await readdirRecursiveNoHidden(archivePath)).filter(x => x && !validPaths.has(x));

    if (purgable.length > 0) {
      console.log("Purging unused files from archive:");
      purgable.map(x => path.relative(archivePath, x)).forEach(x => console.log(x));
      await Promise.all(
        purgable.map(async x => {
          try {
            await util.promisify(fs.unlink)(x)
          } catch {
            console.error(`Couldn't remove ${x}`);
          }
        })
      );
    }
  }

  const shrinkwrapPath = path.join(packagePath, opts.shrinkwrapPath);
  await util.promisify(fs.writeFile)(shrinkwrapPath, JSON.stringify(lockfile, null, 2), {encoding: "utf8"});
  console.log(`Wrote ${shrinkwrapPath}.`);
};

const readdirRecursiveNoHidden = async (dirPath) => ((await Promise.all(
  (await util.promisify(fs.readdir)(dirPath, {encoding: "utf8"}))
  .map(x => path.resolve(dirPath, x))
  .filter(x => !path.basename(x).startsWith("."))
  .map(async x => {
    try {
      const stats = await util.promisify(fs.stat)(x);
      return (stats.isFile() ? x : (stats.isDirectory() ? await readdirRecursiveNoHidden(x) : x));
    } catch (e) {
      return undefined;
    }
  })
)).reduce((acc, x) => (acc.push(...(Array.isArray(x) ? x : [x])), acc), []));
